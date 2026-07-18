import { ASSET_TYPE_KEY, type FieldDefinition } from "@plyrs/metamodel";
import { loadAllContentTypeRows } from "./content-types";

// Phase 10: 特権コンソールの健全性チェック(design-spec §7 の確定事項 / §14 のレガシー状態)。
// 管理オンデマンド呼び出し前提のフルスキャン(DO 内 SQLite なので実テナント規模では許容。
// 公開経路からは呼ばれない)。
export interface HealthReport {
  // §7: archived かつ公開中(published_snapshots が残ったまま status だけ archived になった)一覧
  archivedPublished: { recordId: string; type: string; publishedAt: string }[];
  // §14-1: レガシー user 型 'asset'(ensureAssetContentType がシステム型への昇格を断念した状態)
  legacyAssetType: boolean;
  // §13: 旧形式(非構造)richtext を持つ record(validate-on-write が保存不能にする)
  legacyRichtextRecords: { recordId: string; type: string; fieldKey: string }[];
}

interface ArchivedPublishedRow extends Record<string, SqlStorageValue> {
  record_id: string;
  type: string;
  published_at: string;
}

function loadArchivedPublished(sql: SqlStorage): HealthReport["archivedPublished"] {
  return sql
    .exec<ArchivedPublishedRow>(
      `SELECT r.id AS record_id, r.type AS type, s.published_at AS published_at
       FROM records r JOIN published_snapshots s ON s.record_id = r.id
       WHERE r.status = 'archived' AND r.deleted_at IS NULL`,
    )
    .toArray()
    .map((row) => ({ recordId: row.record_id, type: row.type, publishedAt: row.published_at }));
}

function hasLegacyAssetType(sql: SqlStorage): boolean {
  return (
    sql
      .exec<{ source: string }>(
        "SELECT source FROM content_types WHERE key = ? AND source != 'system'",
        ASSET_TYPE_KEY,
      )
      .toArray().length > 0
  );
}

function richtextFieldKeys(fields: FieldDefinition[]): string[] {
  return fields.filter((field) => field.type === "richtext").map((field) => field.key);
}

// §13 の構造検証(record-schema.ts の richTextEnvelopeSchema)と同じ判定: envelope が object で
// doc.type が string なら新形式。それ以外(素の文字列・doc 欠落等)は旧形式とみなす。
function isLegacyRichTextValue(value: unknown): boolean {
  if (typeof value !== "object" || value === null) {
    return true;
  }
  const doc = (value as { doc?: unknown }).doc;
  return !(
    typeof doc === "object" &&
    doc !== null &&
    typeof (doc as { type?: unknown }).type === "string"
  );
}

function safeParseObject(raw: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

interface RecordDataRow extends Record<string, SqlStorageValue> {
  id: string;
  data: string;
}

function loadLegacyRichtextRecords(sql: SqlStorage): HealthReport["legacyRichtextRecords"] {
  const found: HealthReport["legacyRichtextRecords"] = [];
  for (const typeRow of loadAllContentTypeRows(sql)) {
    const keys = richtextFieldKeys(typeRow.fields);
    if (keys.length === 0) {
      continue;
    }
    const rows = sql
      .exec<RecordDataRow>(
        "SELECT id, data FROM records WHERE type = ? AND deleted_at IS NULL",
        typeRow.key,
      )
      .toArray();
    for (const row of rows) {
      const data = safeParseObject(row.data);
      if (data === null) {
        continue;
      }
      for (const fieldKey of keys) {
        const value = data[fieldKey];
        if (value !== null && value !== undefined && isLegacyRichTextValue(value)) {
          found.push({ recordId: row.id, type: typeRow.key, fieldKey });
        }
      }
    }
  }
  return found;
}

export function healthCheckCore(sql: SqlStorage): HealthReport {
  return {
    archivedPublished: loadArchivedPublished(sql),
    legacyAssetType: hasLegacyAssetType(sql),
    legacyRichtextRecords: loadLegacyRichtextRecords(sql),
  };
}

interface AssetDataRow extends Record<string, SqlStorageValue> {
  data: string;
}

// 孤児 R2 検出の参照側: 現存する asset record が指す r2_key の全集合。
export function listAssetR2KeysCore(sql: SqlStorage): string[] {
  const rows = sql
    .exec<AssetDataRow>(
      "SELECT data FROM records WHERE type = ? AND deleted_at IS NULL",
      ASSET_TYPE_KEY,
    )
    .toArray();
  const keys: string[] = [];
  for (const row of rows) {
    const data = safeParseObject(row.data);
    const key = data?.["r2_key"];
    if (typeof key === "string") {
      keys.push(key);
    }
  }
  return keys;
}
