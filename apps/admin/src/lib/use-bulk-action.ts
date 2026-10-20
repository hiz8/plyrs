import { useCallback, useRef, useState } from "react";
import { runBulk, type BulkResult } from "./content-list";
import { BULK_LABELS } from "./labels";

export type BulkKind = "publish" | "unpublish" | "status" | "delete";

export interface BulkProgress {
  kind: BulkKind;
  done: number;
  total: number;
}

export interface BulkFailure {
  kind: BulkKind;
  ids: string[];
}

export interface BulkActionState {
  /** 実行中 */
  progress: BulkProgress | null;
  /** 直近の一部失敗(次の実行で消える) */
  failure: BulkFailure | null;
  run: (
    kind: BulkKind,
    ids: readonly string[],
    action: (id: string) => Promise<void>,
  ) => Promise<BulkResult>;
  /** 残りを中止(実行中の 1 件は待つ) */
  cancel: () => void;
  /** 失敗の記憶を捨てる(実行中は何もしない)。選択の解除やクエリ変更で呼ぶ */
  dismiss: () => void;
  /** failure の ids で同じ action を再実行する */
  retry: () => Promise<BulkResult> | null;
}

// 一括操作の進捗・中止・失敗分の再試行。実行中の run は二重に始めず、実行中の Promise を返す
export function useBulkAction(): BulkActionState {
  const [progress, setProgress] = useState<BulkProgress | null>(null);
  const [failure, setFailure] = useState<BulkFailure | null>(null);
  const running = useRef<Promise<BulkResult> | null>(null);
  const controller = useRef<AbortController | null>(null);
  const lastAction = useRef<((id: string) => Promise<void>) | null>(null);
  // retry を安定させるため、failure の最新値も ref に持つ
  const failureRef = useRef<BulkFailure | null>(null);

  const run = useCallback<BulkActionState["run"]>((kind, ids, action) => {
    if (running.current !== null) {
      return running.current;
    }
    const abort = new AbortController();
    controller.current = abort;
    lastAction.current = action;
    failureRef.current = null;
    setFailure(null);
    setProgress({ kind, done: 0, total: ids.length });
    const promise = runBulk(ids, action, {
      signal: abort.signal,
      onProgress: (done, total) => setProgress({ kind, done, total }),
    })
      .then((result) => {
        const next =
          result.failed.length > 0 ? { kind, ids: result.failed.map((f) => f.id) } : null;
        failureRef.current = next;
        setFailure(next);
        return result;
      })
      .finally(() => {
        running.current = null;
        controller.current = null;
        setProgress(null);
      });
    running.current = promise;
    return promise;
  }, []);

  const cancel = useCallback(() => {
    controller.current?.abort();
  }, []);

  const dismiss = useCallback(() => {
    if (running.current !== null) return;
    failureRef.current = null;
    setFailure(null);
  }, []);

  const retry = useCallback((): Promise<BulkResult> | null => {
    const current = failureRef.current;
    const action = lastAction.current;
    if (current === null || action === null || running.current !== null) {
      return null;
    }
    return run(current.kind, current.ids, action);
  }, [run]);

  return { progress, failure, run, cancel, dismiss, retry };
}

export function bulkResultMessage(
  kind: BulkKind,
  result: BulkResult,
): { tone: "success" | "danger"; title: string } {
  const ok = result.succeeded.length;
  const failed = result.failed.length;
  if (failed === 0) {
    return { tone: "success", title: BULK_LABELS.resultDone(ok, kind) };
  }
  if (ok === 0) {
    return { tone: "danger", title: BULK_LABELS.resultFailed(failed, kind) };
  }
  return {
    tone: "danger",
    title: `${BULK_LABELS.resultDone(ok, kind)}${BULK_LABELS.sentenceJoin}${BULK_LABELS.resultFailed(failed, kind)}`,
  };
}
