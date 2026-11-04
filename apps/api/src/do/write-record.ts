import {
  ALLOWED_LINK_SCHEMES,
  buildRecordInputSchema,
  canonicalJson,
  richTextEnvelopeSchema,
  type ContentTypeDefinition,
  newUnsafeLinks,
  ensureRecordBlockIds,
  extractBodyRelations,
  uuidSchema,
  WORKFLOW_STATUSES,
  type RelationRef,
  type WorkflowStatus,
} from "@plyrs/metamodel";
import { checkRichTextVocabulary } from "@plyrs/richtext";
import { assetGuardHook } from "./asset-guard";
import { issuesToMessage, rowToDefinition, type ContentTypeRow } from "./content-types";
import { computeChangeSet } from "./diff";
import { recordHistory } from "./history";
import { runBeforeWriteHooks, type BeforeWriteHook } from "./hooks";
import { indexRecord, searchText } from "./search";
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
  // 決定 54(M5a-2): unique の引き当て用カラムを足し終えているか。省略は偽(走査。安全側)
  lookupReady?: boolean;
}

function invalidRichText(
  definition: ContentTypeDefinition,
  input: Record<string, unknown>,
  prev: Record<string, unknown> | null,
): string | null {
  for (const field of definition.fields) {
    if (field.type !== "richtext" || input[field.key] === undefined) {
      continue;
    }
    if (prev !== null && canonicalJson(input[field.key]) === canonicalJson(prev[field.key])) {
      continue;
    }
    const envelope = richTextEnvelopeSchema.safeParse(input[field.key]);
    if (!envelope.success) {
      continue; // 形は buildRecordInputSchema が見ている
    }
    const checked = checkRichTextVocabulary(envelope.data);
    if (!checked.ok) {
      return `${field.key}: ${checked.message}`;
    }
  }
  return null;
}

const systemBeforeWriteHooks: readonly BeforeWriteHook[] = [assetGuardHook, uniqueCheckHook];

export interface WriteOptions {
  systemWrite?: boolean;
  // record_restore(M2-4): 削除済み record の復元は data が同じでも書き込みとして扱う
  // (deleted_at を戻した変更を seq に乗せて同期へ流すため)
  force?: boolean;
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
  // M2-1(決定 44): リッチテキストの最上位ブロックに安定 ID を永続化する(v1 は版 2 に上がる)。
  // 一括変換はせず、書き込まれた record からこの形になる。重複 ID の振り直しもここで行う
  // (エディタの insertContent 経路や MCP の record_update は重複を解消しないため)。
  const input = ensureRecordBlockIds(definition, parsed.data as Record<string, unknown>).data;

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

  // M4 のレビュー: リッチテキストのリンクの scheme(javascript: などを拒否)。今の値に無かった href
  // だけを見る(既存の値を巻き込むと、本文以外を直す保存まで失敗する)。全経路(同期・REST・MCP)が通る
  const unsafe = newUnsafeLinks(definition, input, prev?.data ?? null);
  if (unsafe.length > 0) {
    return {
      ok: false,
      code: "validation_failed",
      message: unsafe
        .map(
          (link) =>
            `${link.fieldKey}: link href is not allowed (${ALLOWED_LINK_SCHEMES.join(", ")} or a relative URL): ${link.href.slice(0, 80)}`,
        )
        .join("; "),
    };
  }

  const prevRelations =
    prev === null ? new Map<string, RelationRef[]>() : loadRelationRefs(deps.sql, params.recordId);
  // G4: 差分は保存値にも同じ ensureRecordBlockIds を当ててから取る。v1(ID 無し)のまま保存された
  // 本文と、ID を付けた入力をそのまま比べると、本文を変えていなくても body が変更に数えられ
  // fieldVersion が上がる(record_get の導出 ID で読んだ古い baseFieldVersions が不要な conflict になる)。
  // 導出 ID は位置 + 内容で決まるので、内容が同じなら一致する。ID の永続化は他のフィールドの変更と
  // 一緒に保存されるか、本文の次の書き込みで行われる(§4.2 の遅延マイグレーション)
  const prevComparable = prev === null ? null : ensureRecordBlockIds(definition, prev.data).data;
  const change = computeChangeSet(definition, input, prevComparable, prevRelations);

  // M5a-6(16.10): リッチテキストの構造の検査(語彙に無いノード・マーク、既知のノードの余分な属性を拒否)。
  // validate-on-write の Zod はエンベロープの形しか見ないので、全経路(同期・REST・MCP)が通るここで行う。
  // 変わった値だけを見る(既存の不正な本文を巻き込むと、タイトルだけを直す保存まで失敗する)
  const structural = invalidRichText(definition, input, prevComparable);
  if (structural !== null) {
    return { ok: false, code: "validation_failed", message: structural };
  }

  const nextStatus: WorkflowStatus = params.status ?? prev?.status ?? "draft";
  const statusChanged = prev !== null && nextStatus !== prev.status;
  // computeChangeSet は現行定義の relation フィールドしか見ないため、型定義から外れた
  // フィールドの残存 relation は changedFields に現れない。それを見逃すと「無変更」判定のまま
  // 早期returnし、下の relations 行の作り直し（blanket delete）に到達できず relations が残留し続ける。
  const currentRelationFieldKeys = new Set(change.relationWrites.map((write) => write.fieldKey));
  const staleRelationFieldRemoved = Array.from(prevRelations.entries()).some(
    ([key, refs]) => refs.length > 0 && !currentRelationFieldKeys.has(key),
  );
  const applied =
    prev === null ||
    change.dataChanged ||
    change.changedFields.length > 0 ||
    statusChanged ||
    staleRelationFieldRemoved ||
    options.force === true;
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
      lookupReady: deps.lookupReady === true,
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

  // 16.5(M2-3a): 変更履歴。区切り・畳み込み・差分圧縮・保持は history.ts が担う。
  // data は relations を統合した input 形式(record_restore がそのまま書き戻せる形)
  recordHistory(deps.sql, now, {
    recordId: params.recordId,
    kind: params.restoredFrom === undefined ? "write" : "restore",
    version,
    status: nextStatus,
    data: input,
    fieldVersions,
    actor: params.actor,
    via: params.via,
    tokenId: params.tokenId,
    clientId: params.clientId,
    restoredFrom: params.restoredFrom,
  });

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

  // 16.9(M2-9): 全文検索の索引は records の派生データとして同じトランザクションで張り直す
  indexRecord(deps.sql, params.recordId, contentType.key, searchText(definition, change.data));

  // §9.4 ステップ5: afterWrite はコミットと同一トランザクションで積む(送出は呼び出し元)。
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
