import {
  buildRecordInputSchema,
  extractBodyRelations,
  uuidSchema,
  WORKFLOW_STATUSES,
  type RelationRef,
  type WorkflowStatus,
} from "@plyrs/metamodel";
import { assetGuardHook } from "./asset-guard";
import { issuesToMessage, rowToDefinition, type ContentTypeRow } from "./content-types";
import { computeChangeSet } from "./diff";
import { runBeforeWriteHooks, type BeforeWriteHook } from "./hooks";
import { moduleBeforeWriteHooks } from "../modules/hooks";
import { emitModuleEvents } from "../modules/events";
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
  // Phase 9: モジュールイベント(afterWrite 等)の event id 発行 seam。定義のみ、使用は Task 9。
  newEventId?: () => string;
  // Phase 9: モジュール alarm の予約 seam(§9.6)。定義のみ、使用は Task 9。
  scheduleModuleAlarm?: (moduleId: string, dueAtMs: number) => void;
}

const systemBeforeWriteHooks: readonly BeforeWriteHook[] = [assetGuardHook, uniqueCheckHook];

export interface WriteOptions {
  systemWrite?: boolean;
}

export function writeRecordCore(
  deps: WriteDeps,
  contentType: ContentTypeRow,
  params: WriteRecordParams,
  options: WriteOptions = {},
): WriteRecordResult {
  if (!uuidSchema.safeParse(params.recordId).success) {
    return {
      ok: false,
      code: "validation_failed",
      message: `recordId must be a lowercase uuid: ${params.recordId}`,
    };
  }

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
  // computeChangeSet は現行定義の relation フィールドしか見ないため、型定義から外れた
  // フィールドの残存 relation は changedFields に現れない。それを見逃すと「無変更」判定のまま
  // 早期returnし、下の再投影（blanket delete）に到達できず relations が残留し続ける。
  const currentRelationFieldKeys = new Set(change.relationWrites.map((write) => write.fieldKey));
  const staleRelationFieldRemoved = Array.from(prevRelations.entries()).some(
    ([key, refs]) => refs.length > 0 && !currentRelationFieldKeys.has(key),
  );
  const applied =
    prev === null ||
    change.dataChanged ||
    change.changedFields.length > 0 ||
    statusChanged ||
    staleRelationFieldRemoved;
  if (!applied && prev !== null) {
    return { ok: true, record: prev, changedFields: [], applied: false };
  }

  const relationState = new Map<string, readonly RelationRef[]>(
    change.relationWrites.map((write) => [write.fieldKey, write.refs]),
  );
  const rejection = runBeforeWriteHooks(
    [...systemBeforeWriteHooks, ...moduleBeforeWriteHooks(deps.sql)],
    {
      contentType,
      recordId: params.recordId,
      data: change.data,
      prev,
      sql: deps.sql,
      systemWrite: options.systemWrite === true,
      relations: relationState,
      scheduleModuleAlarm: deps.scheduleModuleAlarm,
    },
  );
  if (rejection !== null) {
    return { ok: false, code: rejection.code, message: rejection.message };
  }

  const now = deps.now();
  const fieldVersions: Record<string, number> = { ...prev?.fieldVersions };
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

  // relations は派生データ: この record の field 由来行を全消しして張り直す（design-spec §6）。
  // 型定義から外れた旧フィールドの残骸もここで一掃される。
  deps.sql.exec("DELETE FROM relations WHERE source_id = ? AND origin = 'field'", params.recordId);
  for (const write of change.relationWrites) {
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

  // 本文由来の参照も同じ規約で張り直す(design-spec §6「record を書くたびに張り直す」)。
  // 抽出元は relation 分離後の data(richtext は data 側に残る)。同期の record 組み立て
  // (loadRelationRefs)と公開 read の field マージは origin='field' でフィルタ済みのため、
  // body 行が richtext フィールド値を汚染することはない。
  deps.sql.exec("DELETE FROM relations WHERE source_id = ? AND origin = 'body'", params.recordId);
  for (const write of extractBodyRelations(definition, change.data)) {
    write.refs.forEach((ref, ordinal) => {
      deps.sql.exec(
        "INSERT INTO relations (id, source_id, source_field, target_type, target_id, ordinal, origin) VALUES (?, ?, ?, ?, ?, ?, 'body')",
        deps.newRelationId(),
        params.recordId,
        write.fieldKey,
        ref.type,
        ref.id,
        ordinal,
      );
    });
  }

  // §9.4 ステップ5: afterWrite はコミットと同一トランザクションで積む(排出は呼び出し元)。
  if (deps.newEventId !== undefined) {
    emitModuleEvents(
      deps.sql,
      deps.newEventId,
      now,
      "afterWrite",
      contentType.key,
      params.recordId,
      params.actor,
    );
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
