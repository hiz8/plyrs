// 案 D 6 章: 一括操作はレコードごとの API(公開・取り下げ)や同期の書き込みを 1 件ずつ順に行う。
// 一部が失敗しても残りは続け、成功と失敗を分けて返す(失敗したものを選択状態で残すため)。
export interface BulkResult {
  succeeded: string[];
  failed: { id: string; cause: unknown }[];
  /** 中止で手を付けなかったもの */
  skipped: string[];
}

export interface RunBulkOptions {
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
}

// 中止: 実行中の 1 件は待ち、残りを skipped にする(処理済みは戻さない)
export async function runBulk(
  ids: readonly string[],
  action: (id: string) => Promise<void>,
  options: RunBulkOptions = {},
): Promise<BulkResult> {
  const { onProgress, signal } = options;
  const result: BulkResult = { succeeded: [], failed: [], skipped: [] };
  for (const [index, id] of ids.entries()) {
    if (signal?.aborted === true) {
      result.skipped.push(...ids.slice(index));
      break;
    }
    try {
      await action(id);
      result.succeeded.push(id);
    } catch (cause) {
      result.failed.push({ id, cause });
    }
    onProgress?.(index + 1, ids.length);
  }
  return result;
}
