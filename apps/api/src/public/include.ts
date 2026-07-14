import { toPublicRecord, type ProjectedRecordRow, type PublicRecord } from "./serialize";
import { placeholders } from "./sql";

// §12.5: 公開経路の関係解決は projected_relations に対してのみ行う。参照先が投影に無ければ
// （未公開 / 取り下げ済み）その参照は黙って不在になる（ソフト参照。エラーにしない）。
// 展開は field 由来のみ（body 由来のリンクはレコード本文の関心。Phase 7）。

const CHUNK_SIZE = 50; // D1 のバインド上限（100/クエリ）への安全マージン

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

export async function expandIncludes(
  db: D1Database,
  tenantId: string,
  sourceIds: string[],
  includeFields: string[],
): Promise<PublicRecord[]> {
  if (sourceIds.length === 0 || includeFields.length === 0) {
    return [];
  }
  const targetIds = new Set<string>();
  for (const sourceChunk of chunk(sourceIds, CHUNK_SIZE)) {
    const { results } = await db
      .prepare(
        "SELECT DISTINCT target_id FROM projected_relations WHERE tenant_id = ? AND origin = 'field'" +
          ` AND source_field IN (${placeholders(includeFields.length)})` +
          ` AND source_id IN (${placeholders(sourceChunk.length)})`,
      )
      .bind(tenantId, ...includeFields, ...sourceChunk)
      .all<{ target_id: string }>();
    for (const row of results) {
      targetIds.add(row.target_id);
    }
  }
  const included: PublicRecord[] = [];
  for (const idChunk of chunk([...targetIds], CHUNK_SIZE)) {
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
  included.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return included;
}
