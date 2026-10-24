import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_UPLOAD_BYTES } from "./media";
import { DONE_HOLD_MS, createUploadStore, uploadStoreFor, useUploads } from "./use-uploads";

interface Deferred {
  file: File;
  resolve: (id: string) => void;
  reject: (cause: unknown) => void;
}

// upload の呼び出しごとに、手で解決する Promise を作る
function deferredUpload() {
  const calls: Deferred[] = [];
  const upload = (file: File) =>
    new Promise<{ id: string }>((resolve, reject) => {
      calls.push({ file, resolve: (id) => resolve({ id }), reject });
    });
  return { calls, upload };
}

const file = (name: string, size = 10) => new File([new Uint8Array(size)], name);
const statuses = (store: ReturnType<typeof createUploadStore>) =>
  store.getSnapshot().entries.map((entry) => entry.item.status);

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("createUploadStore", () => {
  it("start で queued → uploading → done と進み、3 秒後に done が消える", async () => {
    const { calls, upload } = deferredUpload();
    const onDone = vi.fn();
    const store = createUploadStore(upload, { onDone });
    const a = file("a.png");
    const b = file("b.png");
    const settled = store.start([a, b]);
    expect(statuses(store)).toStrictEqual(["uploading", "queued"]);
    expect(store.getSnapshot().progress).toStrictEqual({ done: 0, total: 2, failed: 0 });

    calls[0]?.resolve("asset-a");
    await vi.advanceTimersByTimeAsync(0);
    expect(statuses(store)).toStrictEqual(["done", "uploading"]);
    expect([...store.getSnapshot().doneIds]).toStrictEqual(["asset-a"]);
    expect(onDone).toHaveBeenCalledWith("asset-a", a);
    expect(store.getSnapshot().progress).toStrictEqual({ done: 1, total: 2, failed: 0 });

    calls[1]?.resolve("asset-b");
    const summary = await settled;
    expect(summary.succeeded).toBe(2);
    expect(store.getSnapshot().progress).toBeNull();
    expect(store.getSnapshot().entries).toHaveLength(2);

    await vi.advanceTimersByTimeAsync(DONE_HOLD_MS);
    expect(store.getSnapshot().entries).toHaveLength(0);
    expect(store.getSnapshot().doneIds.size).toBe(0);
  });

  it("onSettled は start ごとの完了で呼ばれる", async () => {
    const { calls, upload } = deferredUpload();
    const onSettled = vi.fn();
    const store = createUploadStore(upload, { onSettled });
    const settled = store.start([file("a.png")]);
    calls[0]?.resolve("x");
    await settled;
    expect(onSettled).toHaveBeenCalledTimes(1);
    expect(onSettled.mock.calls[0]?.[0]).toMatchObject({ succeeded: 1, failed: 0 });
  });

  it("同じ内容のあいだは getSnapshot が同じ参照を返す", async () => {
    const { calls, upload } = deferredUpload();
    const store = createUploadStore(upload);
    const empty = store.getSnapshot();
    expect(store.getSnapshot()).toBe(empty);
    void store.start([file("a.png")]);
    const running = store.getSnapshot();
    expect(running).not.toBe(empty);
    expect(store.getSnapshot()).toBe(running);
    calls[0]?.resolve("x");
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getSnapshot()).not.toBe(running);
  });

  it("subscribe した購読は変化で呼ばれ、解除後は呼ばれない", () => {
    const { upload } = deferredUpload();
    const store = createUploadStore(upload);
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    void store.start([file("a.png")]);
    expect(listener).toHaveBeenCalled();
    listener.mockClear();
    unsubscribe();
    void store.start([file("b.png")]);
    expect(listener).not.toHaveBeenCalled();
  });

  it("start を重ねると entries は連結される", async () => {
    const { calls, upload } = deferredUpload();
    const store = createUploadStore(upload);
    void store.start([file("a.png")]);
    void store.start([file("b.png")]);
    expect(store.getSnapshot().entries.map((entry) => entry.item.file.name)).toStrictEqual([
      "a.png",
      "b.png",
    ]);
    expect(calls).toHaveLength(2);
  });

  it("20 MB 超は rejected で残り、remove で消える", async () => {
    const { upload } = deferredUpload();
    const store = createUploadStore(upload);
    await store.start([file("big.bin", MAX_UPLOAD_BYTES + 1)]);
    const entry = store.getSnapshot().entries[0];
    expect(entry?.item).toMatchObject({ status: "failed", reason: "too_large" });
    await vi.advanceTimersByTimeAsync(DONE_HOLD_MS * 2);
    expect(store.getSnapshot().entries).toHaveLength(1);
    store.remove(entry?.key ?? "");
    expect(store.getSnapshot().entries).toHaveLength(0);
  });

  it("failed は retry で同じ位置のまま送り直される", async () => {
    const { calls, upload } = deferredUpload();
    const store = createUploadStore(upload);
    const first = store.start([file("a.png"), file("b.png")]);
    calls[0]?.reject(new Error("boom"));
    await vi.advanceTimersByTimeAsync(0);
    calls[1]?.resolve("asset-b");
    await first;
    expect(statuses(store)).toStrictEqual(["failed", "done"]);
    const failedKey = store.getSnapshot().entries[0]?.key ?? "";

    store.retry(failedKey);
    expect(statuses(store)).toStrictEqual(["uploading", "done"]);
    expect(store.getSnapshot().entries[0]?.key).toBe(failedKey);
    calls[2]?.resolve("asset-a");
    await vi.advanceTimersByTimeAsync(0);
    expect(statuses(store)).toStrictEqual(["done", "done"]);
  });

  it("cancel で残りの queued が消え、進行中の 1 件が終わると progress が null になる", async () => {
    const { calls, upload } = deferredUpload();
    const store = createUploadStore(upload);
    const settled = store.start([file("a.png"), file("b.png"), file("c.png")]);
    store.cancel();
    expect(store.getSnapshot().progress).not.toBeNull();
    expect(statuses(store)).toStrictEqual(["uploading"]);
    calls[0]?.resolve("asset-a");
    await settled;
    expect(calls).toHaveLength(1);
    expect(statuses(store)).toStrictEqual(["done"]);
    expect(store.getSnapshot().progress).toBeNull();
  });

  it("cancel のあとの start は新しく送れる", async () => {
    const { calls, upload } = deferredUpload();
    const store = createUploadStore(upload);
    const first = store.start([file("a.png")]);
    store.cancel();
    calls[0]?.resolve("asset-a");
    await first;
    const second = store.start([file("b.png")]);
    expect(calls).toHaveLength(2);
    calls[1]?.resolve("asset-b");
    expect((await second).succeeded).toBe(1);
  });
});

describe("useUploads", () => {
  it("unmount しても進行中のアップロードは続き、再 mount で状態が残る", async () => {
    const { calls, upload } = deferredUpload();
    const onDone = vi.fn();
    const store = createUploadStore(upload, { onDone });
    const first = renderHook(() => useUploads(store));
    let settled: Promise<unknown> = Promise.resolve();
    act(() => {
      settled = store.start([file("a.png")]);
    });
    expect(first.result.current.entries).toHaveLength(1);
    first.unmount();

    calls[0]?.resolve("asset-a");
    await settled;
    expect(store.getSnapshot().entries[0]?.item.status).toBe("done");
    expect(onDone).toHaveBeenCalledWith("asset-a", expect.any(File));

    const second = renderHook(() => useUploads(store));
    expect(second.result.current.entries[0]?.item.status).toBe("done");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DONE_HOLD_MS);
    });
    expect(second.result.current.entries).toHaveLength(0);
  });
});

describe("uploadStoreFor", () => {
  it("同じ tenantId で同じ store を返し、別の tenantId では別の store", () => {
    const { upload } = deferredUpload();
    expect(uploadStoreFor("t-same", upload)).toBe(uploadStoreFor("t-same", upload));
    expect(uploadStoreFor("t-one", upload)).not.toBe(uploadStoreFor("t-two", upload));
  });
});
