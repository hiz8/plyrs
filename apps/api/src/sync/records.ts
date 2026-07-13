import type { ContentTypeDefinition, RelationRef, WorkflowStatus } from "@plyrs/metamodel";
import type { SyncRecord } from "@plyrs/sync-protocol";
import { loadContentTypeByKey, rowToDefinition } from "../do/content-types";
import { loadRelationRefs } from "../do/write-record";

export const SYNC_PAGE_SIZE = 100;

interface RawSyncRow extends Record<string, SqlStorageValue> {
  id: string;
  type: string;
  data: string;
  field_versions: string;
  status: string;
  seq: number;
  deleted_at: string | null;
  updated_at: string;
  updated_by: string;
  version: number;
}

interface RawContentTypeRow extends Record<string, SqlStorageValue> {
  id: string;
  key: string;
  name: string;
  fields: string;
  source: string;
  plugin_id: string | null;
  version: number;
}

// 同期の record 表現は relations を統合した「writeRecord の input 形式」。
// これにより getRecord → 編集 → writeRecord の read-modify-write で
// optional relation が無言でクリアされる継ぎ目（Phase 2 申し送り）が消える。
export function buildSyncInput(
  data: Record<string, unknown>,
  relations: Map<string, RelationRef[]>,
  contentType: ContentTypeDefinition | null,
): Record<string, unknown> {
  const input: Record<string, unknown> = { ...data };
  const cardinality = new Map<string, "one" | "many">();
  for (const field of contentType?.fields ?? []) {
    if (field.type === "relation") {
      cardinality.set(field.key, field.config.cardinality);
    }
  }
  for (const [fieldKey, refs] of relations) {
    if (cardinality.get(fieldKey) === "one") {
      const first = refs[0];
      if (first !== undefined) {
        input[fieldKey] = first;
      }
      continue;
    }
    input[fieldKey] = refs;
  }
  return input;
}

function rowToSyncRecord(sql: SqlStorage, row: RawSyncRow): SyncRecord {
  const deletedAt = row.deleted_at;
  const base = {
    id: row.id,
    type: row.type,
    fieldVersions: JSON.parse(row.field_versions) as Record<string, number>,
    status: row.status as WorkflowStatus,
    seq: row.seq,
    version: row.version,
    deletedAt,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  };
  if (deletedAt !== null) {
    // トゥームストーンは中身を運ばない（relations も削除済み）
    return { ...base, input: {} };
  }
  const contentTypeRow = loadContentTypeByKey(sql, row.type);
  const definition = contentTypeRow === null ? null : rowToDefinition(contentTypeRow);
  const relations = loadRelationRefs(sql, row.id);
  const data = JSON.parse(row.data) as Record<string, unknown>;
  return { ...base, input: buildSyncInput(data, relations, definition) };
}

export function loadSyncRecord(sql: SqlStorage, id: string): SyncRecord | null {
  const row = sql.exec<RawSyncRow>("SELECT * FROM records WHERE id = ?", id).toArray()[0];
  return row === undefined ? null : rowToSyncRecord(sql, row);
}

export function loadSyncRecordsSince(
  sql: SqlStorage,
  checkpoint: number,
  limit: number,
): SyncRecord[] {
  const rows = sql
    .exec<RawSyncRow>(
      "SELECT * FROM records WHERE seq > ? ORDER BY seq ASC LIMIT ?",
      checkpoint,
      limit,
    )
    .toArray();
  return rows.map((row) => rowToSyncRecord(sql, row));
}

export function loadAllContentTypes(sql: SqlStorage): ContentTypeDefinition[] {
  const rows = sql
    .exec<RawContentTypeRow>("SELECT * FROM content_types ORDER BY key ASC")
    .toArray();
  return rows.map((row) =>
    rowToDefinition({
      id: row.id,
      key: row.key,
      name: row.name,
      fields: JSON.parse(row.fields),
      source: row.source as "user" | "plugin" | "system",
      pluginId: row.plugin_id,
      createdAt: "",
      updatedAt: "",
      version: row.version,
    }),
  );
}

export function currentServerSeq(sql: SqlStorage): number {
  const row = sql.exec<{ max_seq: number | null }>("SELECT MAX(seq) AS max_seq FROM records").one();
  return row.max_seq ?? 0;
}
