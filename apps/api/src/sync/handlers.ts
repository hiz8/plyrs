import {
  PROTOCOL_VERSION,
  resolveSyncWrite,
  type ClientChange,
  type ServerMessage,
} from "@plyrs/sync-protocol";
import { requireOperation, type AuthContext } from "../do/authorize";
import { loadContentTypeByKey, rowToDefinition } from "../do/content-types";
import { deleteRecordCore } from "../do/delete-record";
import { loadRecord, writeRecordCore } from "../do/write-record";
import { moduleWriteDenial } from "../modules/enablement";
import {
  currentServerSeq,
  loadAllContentTypes,
  loadSyncRecord,
  loadSyncRecordsSince,
  SYNC_PAGE_SIZE,
} from "./records";

// G1: content_types は seq を消費しない別チャネル。welcome で全量を配る。
// G2: records は seq チェックポイントの差分（トゥームストーン込み）をページで配る。
export function handleHello(sql: SqlStorage, checkpoint: number): ServerMessage[] {
  const serverSeq = currentServerSeq(sql);
  const messages: ServerMessage[] = [
    {
      type: "welcome",
      protocolVersion: PROTOCOL_VERSION,
      contentTypes: loadAllContentTypes(sql),
      serverSeq,
    },
  ];

  let cursor = checkpoint;
  for (;;) {
    const records = loadSyncRecordsSince(sql, cursor, SYNC_PAGE_SIZE);
    const complete = records.length < SYNC_PAGE_SIZE;
    messages.push({ type: "sync", records, serverSeq, complete });
    if (complete) {
      return messages;
    }
    const last = records[records.length - 1];
    if (last === undefined) {
      return messages;
    }
    cursor = last.seq;
  }
}

export interface PushDeps {
  sql: SqlStorage;
  nextSeq: () => number;
  now: () => string;
  newRelationId: () => string;
  nextPublishSeq: () => number;
  // Phase 9: writeRecordCore へそのまま渡る WriteDeps の追加 seam(afterWrite の emit と
  // モジュール alarm 予約)。push 経路も writeRecordCore を通るため同じ seam を持つ。
  newEventId?: () => string;
  scheduleModuleAlarm?: (moduleId: string, dueAtMs: number) => void;
}

export interface PushOutcome {
  acks: ServerMessage[];
  broadcasts: ServerMessage[];
}

// 第2段認可は RPC 入口と同じく「先頭」で判定する（Phase 2 申し送りの内容確認オラクル対策）。
export function handlePush(
  deps: PushDeps,
  changes: ClientChange[],
  auth: AuthContext,
): PushOutcome {
  const acks: ServerMessage[] = [];
  const broadcasts: ServerMessage[] = [];

  for (const change of changes) {
    const operation = change.op === "delete" ? "record:delete" : "record:write";
    const denial = requireOperation(auth, operation);
    if (denial !== null) {
      acks.push({
        type: "ack",
        changeId: change.changeId,
        result: { ok: false, code: denial.code, message: denial.message },
      });
      continue;
    }

    const contentTypeRow = loadContentTypeByKey(deps.sql, change.typeKey);
    if (contentTypeRow === null) {
      acks.push({
        type: "ack",
        changeId: change.changeId,
        result: {
          ok: false,
          code: "unknown_type",
          message: `unknown content type: ${change.typeKey}`,
        },
      });
      continue;
    }

    // §11.5: モジュール権限ガードは requireOperation と同じ「先頭」(no-op 判定・検証より前)
    const moduleDenial = moduleWriteDenial(deps.sql, contentTypeRow, auth.role);
    if (moduleDenial !== null) {
      acks.push({
        type: "ack",
        changeId: change.changeId,
        result: { ok: false, code: moduleDenial.code, message: moduleDenial.message },
      });
      continue;
    }

    if (change.op === "delete") {
      // CRITICAL fix（レビュー指摘）: delete は change.typeKey という「クライアント申告」を
      // 信用できない。write は writeRecordCore 内の prev.type !== contentType.key 検査で
      // 詐称が閉じるが、delete（deleteRecordCore）には対がなく recordId だけで tombstone する。
      // 実 record を引き、その実型に対してモジュール write ガードを再判定する
      // (apps/api/src/tenant-do.ts の HTTP deleteRecord の既存ガードと同型)。
      const target = loadRecord(deps.sql, change.recordId);
      if (target !== null) {
        const actualType = loadContentTypeByKey(deps.sql, target.type);
        if (actualType !== null) {
          const actualModuleDenial = moduleWriteDenial(deps.sql, actualType, auth.role);
          if (actualModuleDenial !== null) {
            acks.push({
              type: "ack",
              changeId: change.changeId,
              result: {
                ok: false,
                code: actualModuleDenial.code,
                message: actualModuleDenial.message,
              },
            });
            continue;
          }
        }
      }
      // outbox 行の id 空間は relations と同じでよい（どちらも新規 uuidv7 の払い出しに過ぎない）
      const deleted = deleteRecordCore(
        {
          sql: deps.sql,
          nextSeq: deps.nextSeq,
          now: deps.now,
          newId: deps.newRelationId,
          nextPublishSeq: deps.nextPublishSeq,
        },
        change.recordId,
        auth.userId,
      );
      if (!deleted.ok) {
        acks.push({
          type: "ack",
          changeId: change.changeId,
          result: { ok: false, code: deleted.code, message: deleted.message },
        });
        continue;
      }
      const tombstone = loadSyncRecord(deps.sql, change.recordId);
      if (tombstone !== null) {
        acks.push({
          type: "ack",
          changeId: change.changeId,
          result: { ok: true, record: tombstone },
        });
        broadcasts.push({ type: "change", record: tombstone });
      }
      continue;
    }

    const current = loadSyncRecord(deps.sql, change.recordId);
    const resolution = resolveSyncWrite(rowToDefinition(contentTypeRow), change, current);
    if (resolution.kind === "conflict") {
      acks.push({
        type: "ack",
        changeId: change.changeId,
        result: {
          ok: false,
          code: "conflict",
          message: "manual resolution required for rich text fields",
          conflicts: resolution.conflicts,
        },
      });
      continue;
    }

    const written = writeRecordCore(deps, contentTypeRow, {
      recordId: change.recordId,
      input: resolution.input,
      actor: auth.userId,
      ...(change.status === undefined ? {} : { status: change.status }),
    });
    if (!written.ok) {
      acks.push({
        type: "ack",
        changeId: change.changeId,
        result: { ok: false, code: written.code, message: written.message },
      });
      continue;
    }

    const stored = loadSyncRecord(deps.sql, change.recordId);
    if (stored !== null) {
      acks.push({ type: "ack", changeId: change.changeId, result: { ok: true, record: stored } });
      if (written.applied) {
        broadcasts.push({ type: "change", record: stored });
      }
    }
  }

  return { acks, broadcasts };
}
