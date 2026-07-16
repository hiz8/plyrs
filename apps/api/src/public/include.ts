import { toPublicRecord, type ProjectedRecordRow, type PublicRecord } from "./serialize";
import { chunk, D1_BIND_CHUNK_SIZE, placeholders } from "./sql";

// §12.5: 公開経路の関係解決は projected_relations に対してのみ行う。参照先が投影に無ければ
// （未公開 / 取り下げ済み）その参照は黙って不在になる（ソフト参照。エラーにしない）。
// 展開は field 由来のみ（body 由来のリンクはレコード本文の関心。Phase 7）。

// design-spec §6: 関係は data に入らない（write-record.test.ts で確定済みの不変条件）ので
// toPublicRecord() が返す fields には関係フィールドの値が一切現れない。裁定（2026-07-14 #3）:
// 既定でも関係フィールドは ID 配列として fields に現れる — include は included[] の同梱だけを
// 制御し、fields の形を変えない。未公開参照先の ID も残る（ソフト参照で included にだけ現れない）。
// 単体・一覧の両方から呼ぶ: 対象 record_id 全件の field 由来の関係をチャンク内 1 回で引き、
// record_id → フィールド別 ID 配列 の Map を返す（カタログ不要: 非関係フィールドはそもそも行が無い）。
export async function loadFieldRelationIdsForRecords(
  db: D1Database,
  tenantId: string,
  recordIds: string[],
): Promise<Map<string, Record<string, string[]>>> {
  const byRecord = new Map<string, Record<string, string[]>>();
  for (const idChunk of chunk(recordIds, D1_BIND_CHUNK_SIZE)) {
    const { results } = await db
      .prepare(
        "SELECT source_id, source_field, target_id FROM projected_relations" +
          " WHERE tenant_id = ? AND origin = 'field'" +
          ` AND source_id IN (${placeholders(idChunk.length)})` +
          " ORDER BY source_field, ordinal",
      )
      .bind(tenantId, ...idChunk)
      .all<{ source_id: string; source_field: string; target_id: string }>();
    for (const row of results) {
      const byField = byRecord.get(row.source_id) ?? {};
      const list = byField[row.source_field] ?? [];
      list.push(row.target_id);
      byField[row.source_field] = list;
      byRecord.set(row.source_id, byField);
    }
  }
  return byRecord;
}

// Phase 5c housekeeping: include の対象 ID は loadFieldRelationIdsForRecords の結果から導出する
// （従来は projected_relations をもう一度 DISTINCT で引き直していた = 同一テーブルの二重読み）。
export function collectIncludeTargetIds(
  relationIds: Map<string, Record<string, string[]>>,
  includeFields: string[],
): string[] {
  const targetIds = new Set<string>();
  for (const byField of relationIds.values()) {
    for (const field of includeFields) {
      for (const id of byField[field] ?? []) {
        targetIds.add(id);
      }
    }
  }
  return [...targetIds];
}

export async function expandIncludes(
  db: D1Database,
  tenantId: string,
  targetIds: string[],
): Promise<PublicRecord[]> {
  if (targetIds.length === 0) {
    return [];
  }
  const included: PublicRecord[] = [];
  for (const idChunk of chunk(targetIds, D1_BIND_CHUNK_SIZE)) {
    const { results } = await db
      .prepare(
        "SELECT record_id, type, slug, published_at, data FROM projected_records" +
          ` WHERE tenant_id = ? AND record_id IN (${placeholders(idChunk.length)})`,
      )
      .bind(tenantId, ...idChunk)
      .all<ProjectedRecordRow>();
    for (const row of results) {
      included.push(toPublicRecord(row));
    }
  }
  // 決定的な並び（レスポンス本文の安定 = テスト容易性とキャッシュ効率）
  return included.toSorted((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
