import { cascadeUnpublish } from "./publish";
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
}

// G2: 削除はトゥームストーン。row は同期の削除伝搬（Phase 4）のために残す。
export function deleteRecordCore(
  deps: DeleteDeps,
  recordId: string,
  actor: string,
): DeleteRecordResult {
  const prev = loadRecord(deps.sql, recordId);
  if (prev === null) {
    return { ok: false, code: "not_found", message: `record not found: ${recordId}` };
  }
  if (prev.deletedAt !== null) {
    return { ok: false, code: "already_deleted", message: `record already deleted: ${recordId}` };
  }
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
  // 裁定（2026-07-13）: 削除された実体が公開され続ける事故を構造的に防ぐ。
  // archive（ワークフロー軸）は仕様どおり強制 unpublish しない — delete だけが強制する。
  cascadeUnpublish(
    { sql: deps.sql, now: () => now, newId: deps.newId, nextPublishSeq: deps.nextPublishSeq },
    recordId,
  );
  return {
    ok: true,
    record: { ...prev, deletedAt: now, updatedAt: now, updatedBy: actor, seq, version },
  };
}
