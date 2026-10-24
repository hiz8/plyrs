import { useSyncExternalStore } from "react";
import type { UploadOptions } from "./admin-api";
import { uploadFiles, type UploadItem, type UploadSummary } from "./media";

// F10: アップロードの進行を画面(React)の外に持つ。ルートが unmount されても uploadFiles は続き、
// 戻ると同じ store を読む。トーストと一覧の invalidate は画面の責務(setOptions で付け替える)。

export interface UploadEntry {
  /** クライアントで振る。同じファイルの状態が変わっても変わらない(タイルの React key) */
  key: string;
  item: UploadItem;
}

export interface UploadsSnapshot {
  /** 表示順。done は DONE_HOLD_MS 後に消え、rejected / failed は操作するまで残る */
  entries: readonly UploadEntry[];
  /** 進行中(queued か uploading が 1 件以上、かつ送信中)のときだけ */
  progress: { done: number; total: number; failed: number } | null;
  /** 表示中の done の assetId(一覧で実レコードを隠す) */
  doneIds: ReadonlySet<string>;
}

export interface UploadStoreOptions {
  onSettled?: (summary: UploadSummary) => void;
  onDone?: (assetId: string, file: File) => void;
}

export interface UploadStore {
  getSnapshot: () => UploadsSnapshot;
  subscribe: (listener: () => void) => () => void;
  start: (files: readonly File[]) => Promise<UploadSummary>;
  retry: (key: string) => void;
  remove: (key: string) => void;
  cancel: () => void;
  setOptions: (options: UploadStoreOptions) => void;
}

export const DONE_HOLD_MS = 3000;

type Upload = (file: File, options: UploadOptions) => Promise<{ id: string }>;

export function createUploadStore(upload: Upload, initial: UploadStoreOptions = {}): UploadStore {
  let options = initial;
  let entries: readonly UploadEntry[] = [];
  let runs = 0;
  // 進行中のまとめ(progress の分母)。送信が一巡して静かになったら捨てる
  let batch = new Set<string>();
  // done の表示が消えても分子に残すため、done になった key を別に持つ
  const batchDone = new Set<string>();
  let controller = new AbortController();
  let seq = 0;
  const listeners = new Set<() => void>();
  const holdTimers = new Map<string, ReturnType<typeof setTimeout>>();

  function compute(): UploadsSnapshot {
    const active = entries.some(
      (entry) => entry.item.status === "queued" || entry.item.status === "uploading",
    );
    const failed = entries.filter(
      (entry) => batch.has(entry.key) && entry.item.status === "failed",
    ).length;
    return {
      entries,
      progress: runs > 0 && active ? { done: batchDone.size, total: batch.size, failed } : null,
      doneIds: new Set(
        entries.flatMap((entry) => (entry.item.status === "done" ? [entry.item.assetId] : [])),
      ),
    };
  }

  let snapshot = compute();
  function emit() {
    snapshot = compute();
    for (const listener of listeners) listener();
  }

  function replaceItem(key: string, item: UploadItem) {
    const previous = entries.find((entry) => entry.key === key);
    if (previous === undefined) return;
    entries = entries.map((entry) => (entry.key === key ? { key, item } : entry));
    if (item.status === "done" && previous.item.status !== "done") {
      holdTimers.set(
        key,
        setTimeout(() => {
          holdTimers.delete(key);
          entries = entries.filter((entry) => entry.key !== key);
          emit();
        }, DONE_HOLD_MS),
      );
      batchDone.add(key);
      options.onDone?.(item.assetId, item.file);
    }
  }

  function run(files: readonly File[], keys: readonly string[]): Promise<UploadSummary> {
    if (controller.signal.aborted) controller = new AbortController();
    runs += 1;
    for (const key of keys) batch.add(key);
    const promise = uploadFiles(files, upload, {
      signal: controller.signal,
      onChange: (items) => {
        items.forEach((item, index) => {
          const key = keys[index];
          if (key !== undefined) replaceItem(key, item);
        });
        emit();
      },
    }).then((summary) => {
      runs -= 1;
      if (runs === 0) {
        batch = new Set();
        batchDone.clear();
      }
      emit();
      options.onSettled?.(summary);
      return summary;
    });
    return promise;
  }

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    start: (files) => {
      const keys = files.map(() => `upload-${++seq}`);
      // uploadFiles の最初の onChange(同期)で実際の状態に置き換わる
      entries = [
        ...entries,
        ...files.map((file, index) => ({
          key: keys[index] ?? "",
          item: { file, status: "queued" } satisfies UploadItem,
        })),
      ];
      return run(files, keys);
    },
    retry: (key) => {
      const target = entries.find((entry) => entry.key === key);
      if (target === undefined || target.item.status !== "failed") return;
      const file = target.item.file;
      entries = entries.map((entry) =>
        entry.key === key ? { key, item: { file, status: "queued" } } : entry,
      );
      void run([file], [key]);
    },
    remove: (key) => {
      const item = entries.find((entry) => entry.key === key)?.item;
      // 送信中のものは止められない
      if (item === undefined || item.status === "uploading") return;
      const timer = holdTimers.get(key);
      if (timer !== undefined) {
        clearTimeout(timer);
        holdTimers.delete(key);
      }
      entries = entries.filter((entry) => entry.key !== key);
      emit();
    },
    cancel: () => {
      controller.abort();
      // 順番待ちのタイルには取り除くボタンが無いので、その場で消す。
      // 中断後の uploadFiles の onChange は replaceItem が無い key を無視するので復活しない
      const dropped = entries.filter((entry) => entry.item.status === "queued");
      if (dropped.length === 0) return;
      for (const entry of dropped) batch.delete(entry.key);
      entries = entries.filter((entry) => entry.item.status !== "queued");
      emit();
    },
    setOptions: (next) => {
      options = next;
    },
  };
}

export function useUploads(store: UploadStore): UploadsSnapshot {
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}

const stores = new Map<string, UploadStore>();

// MediaLibrary はテナントごとに 1 つの store を共有する(ルートの出入りをまたいで進行が残る)
export function uploadStoreFor(tenantId: string, upload: Upload): UploadStore {
  let store = stores.get(tenantId);
  if (store === undefined) {
    store = createUploadStore(upload);
    stores.set(tenantId, store);
  }
  return store;
}

// テスト用。store はモジュールに残るため、テストごとに別の API スタブへ向け直すときに空にする
export function resetUploadStores(): void {
  stores.clear();
}
