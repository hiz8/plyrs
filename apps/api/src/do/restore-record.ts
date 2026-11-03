import { loadContentTypeByKey } from "./content-types";
import { loadVersion, type HistoryActor } from "./history";
import type { WriteRecordResult } from "./types";
import { loadRecord, writeRecordCore, type WriteDeps } from "./write-record";

// 16.5(M2-4): record_restore。履歴の版の data / status を writeRecord に通して現在にする
// (validate-on-write の対象なので、型定義が変わっていれば validation_failed になりうる)。
// 削除済み record は deleted_at を NULL に戻してから書く(削除の取り消し)。
export type RestoreRecordResult =
  | WriteRecordResult
  | { ok: false; code: "not_found"; message: string };

export function restoreRecordCore(
  deps: WriteDeps,
  recordId: string,
  historySeq: number,
  history: HistoryActor,
): RestoreRecordResult {
  const version = loadVersion(deps.sql, recordId, historySeq);
  if (version === null) {
    return {
      ok: false,
      code: "not_found",
      message: `history version not found: ${recordId}#${historySeq}`,
    };
  }
  const prev = loadRecord(deps.sql, recordId);
  if (prev === null) {
    return { ok: false, code: "not_found", message: `record not found: ${recordId}` };
  }
  const contentType = loadContentTypeByKey(deps.sql, prev.type);
  if (contentType === null) {
    return { ok: false, code: "unknown_type", message: `unknown content type: ${prev.type}` };
  }
  const wasDeleted = prev.deletedAt !== null;
  if (wasDeleted) {
    deps.sql.exec("UPDATE records SET deleted_at = NULL WHERE id = ?", recordId);
  }
  const result = writeRecordCore(
    deps,
    contentType,
    {
      recordId,
      input: version.data,
      status: version.status,
      ...history,
      restoredFrom: historySeq,
    },
    // 削除済みからの復元は data が同じでも seq を進めて同期へ流す
    { force: wasDeleted },
  );
  if (!result.ok && wasDeleted) {
    // writeRecordCore は失敗を例外にしないので、トランザクションに頼らず自分で戻す
    deps.sql.exec("UPDATE records SET deleted_at = ? WHERE id = ?", prev.deletedAt, recordId);
  }
  return result;
}
