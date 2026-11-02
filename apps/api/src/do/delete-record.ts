import { recordHistory, type HistoryActor } from "./history";
import { loadRecordInput } from "../sync/records";
import { cascadeUnpublish } from "./publish";
import { removeFromIndex } from "./search";
import type { RecordSnapshot } from "./types";
import { loadRecord } from "./write-record";

export type DeleteRecordResult =
  | { ok: true; record: RecordSnapshot }
  | { ok: false; code: "not_found" | "already_deleted" | "forbidden"; message: string };

export interface DeleteDeps {
  sql: SqlStorage;
  nextSeq: () => number;
  now: () => string;
  newId: () => string;
  nextPublishSeq: () => number;
  // 16.5(M2-3b): 削除の版(削除前の data を全文で残し、record_restore に使う)
  history: HistoryActor;
}

// G2: 削除はトゥームストーン。row は同期の削除伝搬（Phase 4）のために残す。
export function deleteRecordCore(deps: DeleteDeps, recordId: string): DeleteRecordResult {
  const actor = deps.history.actor;
  const prev = loadRecord(deps.sql, recordId);
  if (prev === null) {
    return { ok: false, code: "not_found", message: `record not found: ${recordId}` };
  }
  if (prev.deletedAt !== null) {
    return { ok: false, code: "already_deleted", message: `record already deleted: ${recordId}` };
  }
  // 削除前の本文(relations 込み)。relations 行は下で消えるので先に組み立てる
  const input = loadRecordInput(deps.sql, prev);
  const now = deps.now();
  const seq = deps.nextSeq();
  const version = prev.version + 1;
  deps.sql.exec(
    "UPDATE records SET deleted_at = ?, updated_at = ?, updated_by = ?, seq = ?, version = ? WHERE id = ?",
    now,
    now,
    actor,
    seq,
    version,
    recordId,
  );
  deps.sql.exec("DELETE FROM relations WHERE source_id = ?", recordId);
  // 16.9(M2-9): 削除済みは検索に出さない(復元は writeRecordCore が索引に戻す)
  removeFromIndex(deps.sql, recordId);
  recordHistory(deps.sql, now, {
    ...deps.history,
    recordId,
    kind: "delete",
    version,
    status: prev.status,
    data: input,
    fieldVersions: prev.fieldVersions,
  });
  // 決定（2026-07-13）: 削除された実体が公開され続ける事故を構造的に防ぐ。
  // archive（ワークフロー軸）は仕様どおり強制 unpublish しない — delete だけが強制する。
  // 履歴は上の delete の版と重複するので cascadeUnpublish には history を渡さない
  cascadeUnpublish(
    { sql: deps.sql, now: () => now, newId: deps.newId, nextPublishSeq: deps.nextPublishSeq },
    recordId,
  );
  return {
    ok: true,
    record: { ...prev, deletedAt: now, updatedAt: now, updatedBy: actor, seq, version },
  };
}
