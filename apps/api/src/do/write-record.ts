import {
  buildRecordInputSchema,
  WORKFLOW_STATUSES,
  type RelationRef,
  type WorkflowStatus,
} from "@plyrs/metamodel";
import { issuesToMessage, rowToDefinition, type ContentTypeRow } from "./content-types";
import { computeChangeSet } from "./diff";
import { runBeforeWriteHooks, type BeforeWriteHook } from "./hooks";
import { uniqueCheckHook } from "./unique-check";
import type { RecordSnapshot, WriteRecordParams, WriteRecordResult } from "./types";

interface RawRecordRow extends Record<string, SqlStorageValue> {
  id: string;
  type: string;
  data: string;
  field_versions: string;
  status: string;
  seq: number;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
  created_by: string;
  updated_by: string;
  version: number;
}

function rowToSnapshot(row: RawRecordRow): RecordSnapshot {
  return {
    id: row.id,
    type: row.type,
    data: JSON.parse(row.data) as Record<string, unknown>,
    fieldVersions: JSON.parse(row.field_versions) as Record<string, number>,
    status: row.status as WorkflowStatus,
    seq: row.seq,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    deletedAt: row.deleted_at,
  };
}

export function loadRecord(sql: SqlStorage, id: string): RecordSnapshot | null {
  const row = sql.exec<RawRecordRow>("SELECT * FROM records WHERE id = ?", id).toArray()[0];
  return row === undefined ? null : rowToSnapshot(row);
}

export function loadRelationRefs(sql: SqlStorage, sourceId: string): Map<string, RelationRef[]> {
  const rows = sql
    .exec<{ source_field: string; target_type: string; target_id: string }>(
      "SELECT source_field, target_type, target_id FROM relations WHERE source_id = ? AND origin = 'field' ORDER BY source_field, ordinal",
      sourceId,
    )
    .toArray();
  const map = new Map<string, RelationRef[]>();
  for (const row of rows) {
    const list = map.get(row.source_field) ?? [];
    list.push({ type: row.target_type, id: row.target_id });
    map.set(row.source_field, list);
  }
  return map;
}

export interface WriteDeps {
  sql: SqlStorage;
  nextSeq: () => number;
  now: () => string;
  newRelationId: () => string;
}

const systemBeforeWriteHooks: readonly BeforeWriteHook[] = [uniqueCheckHook];

export function writeRecordCore(
  deps: WriteDeps,
  contentType: ContentTypeRow,
  params: WriteRecordParams,
): WriteRecordResult {
  if (
    params.status !== undefined &&
    !(WORKFLOW_STATUSES as readonly string[]).includes(params.status)
  ) {
    return { ok: false, code: "invalid_status", message: `invalid status: ${params.status}` };
  }

  const definition = rowToDefinition(contentType);
  const parsed = buildRecordInputSchema(definition).safeParse(params.input);
  if (!parsed.success) {
    return { ok: false, code: "validation_failed", message: issuesToMessage(parsed.error.issues) };
  }

  const prev = loadRecord(deps.sql, params.recordId);
  if (prev !== null && prev.deletedAt !== null) {
    return { ok: false, code: "record_deleted", message: `record is deleted: ${params.recordId}` };
  }
  if (prev !== null && prev.type !== contentType.key) {
    return {
      ok: false,
      code: "validation_failed",
      message: `record ${params.recordId} belongs to type '${prev.type}'`,
    };
  }

  const prevRelations =
    prev === null ? new Map<string, RelationRef[]>() : loadRelationRefs(deps.sql, params.recordId);
  const change = computeChangeSet(
    definition,
    parsed.data as Record<string, unknown>,
    prev?.data ?? null,
    prevRelations,
  );

  const nextStatus: WorkflowStatus = params.status ?? prev?.status ?? "draft";
  const statusChanged = prev !== null && nextStatus !== prev.status;
  const applied =
    prev === null || change.dataChanged || change.changedFields.length > 0 || statusChanged;
  if (!applied && prev !== null) {
    return { ok: true, record: prev, changedFields: [], applied: false };
  }

  const rejection = runBeforeWriteHooks(systemBeforeWriteHooks, {
    contentType,
    recordId: params.recordId,
    data: change.data,
    prev,
    sql: deps.sql,
  });
  if (rejection !== null) {
    return { ok: false, code: rejection.code, message: rejection.message };
  }

  const now = deps.now();
  const fieldVersions: Record<string, number> = { ...(prev?.fieldVersions ?? {}) };
  for (const key of change.changedFields) {
    fieldVersions[key] = (fieldVersions[key] ?? 0) + 1;
  }
  const seq = deps.nextSeq();
  const version = (prev?.version ?? 0) + 1;
  const dataJson = JSON.stringify(change.data);
  const fieldVersionsJson = JSON.stringify(fieldVersions);

  if (prev === null) {
    deps.sql.exec(
      "INSERT INTO records (id, type, data, field_versions, status, seq, deleted_at, created_at, updated_at, created_by, updated_by, version) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)",
      params.recordId,
      contentType.key,
      dataJson,
      fieldVersionsJson,
      nextStatus,
      seq,
      now,
      now,
      params.actor,
      params.actor,
      version,
    );
  } else {
    deps.sql.exec(
      "UPDATE records SET data = ?, field_versions = ?, status = ?, seq = ?, updated_at = ?, updated_by = ?, version = ? WHERE id = ?",
      dataJson,
      fieldVersionsJson,
      nextStatus,
      seq,
      now,
      params.actor,
      version,
      params.recordId,
    );
  }

  // relations は派生データ: 全 relation フィールドを削除→再挿入で再投影（design-spec §6）
  for (const write of change.relationWrites) {
    deps.sql.exec(
      "DELETE FROM relations WHERE source_id = ? AND source_field = ?",
      params.recordId,
      write.fieldKey,
    );
    write.refs.forEach((ref, ordinal) => {
      deps.sql.exec(
        "INSERT INTO relations (id, source_id, source_field, target_type, target_id, ordinal, origin) VALUES (?, ?, ?, ?, ?, ?, 'field')",
        deps.newRelationId(),
        params.recordId,
        write.fieldKey,
        ref.type,
        ref.id,
        ordinal,
      );
    });
  }

  const record: RecordSnapshot = {
    id: params.recordId,
    type: contentType.key,
    data: change.data,
    fieldVersions,
    status: nextStatus,
    seq,
    version,
    createdAt: prev?.createdAt ?? now,
    updatedAt: now,
    createdBy: prev?.createdBy ?? params.actor,
    updatedBy: params.actor,
    deletedAt: null,
  };
  return { ok: true, record, changedFields: change.changedFields, applied: true };
}
