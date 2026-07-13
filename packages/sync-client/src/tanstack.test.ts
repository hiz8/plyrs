import type { ContentTypeDefinition } from "@plyrs/metamodel";
import type { SyncRecord } from "@plyrs/sync-protocol";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SyncEngine } from "./engine";
import { MemorySyncStorage } from "./storage";
import { CollectionRegistry } from "./tanstack";
import type { WebSocketLike } from "./transport";

// transport.ts の WebSocketLike はイベント型を持たない（unknown を直接使う。engine.test.ts の
// FakeSocket と同じ流儀）。ブリーフは `SocketEvent` 型のインポートを想定していたが、
// transport.ts はそれをエクスポートしていない（独立性テストが守るエンジンコアなので追加しない）。
class SilentSocket implements WebSocketLike {
  readyState = 1;
  readonly sent: string[] = [];
  private readonly listeners = new Map<string, ((event: unknown) => void)[]>();
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.readyState = 3;
  }
  addEventListener(type: string, listener: (event: unknown) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  removeEventListener(): void {
    return;
  }
  emit(type: string, event: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }
}

const articleType: ContentTypeDefinition = {
  id: "018f2b6a-7a0a-7000-8000-000000000001",
  key: "article",
  name: "記事",
  source: "user",
  version: 1,
  fields: [{ key: "title", type: "text", required: true }],
};

const noteType: ContentTypeDefinition = {
  ...articleType,
  id: "018f2b6a-7a0a-7000-8000-000000000002",
  key: "note",
  name: "ノート",
};

function record(overrides: Partial<SyncRecord> = {}): SyncRecord {
  return {
    id: "r1",
    type: "article",
    input: { title: "hello" },
    fieldVersions: { title: 1 },
    status: "draft",
    seq: 3,
    version: 1,
    deletedAt: null,
    updatedAt: "2026-07-13T00:00:00Z",
    updatedBy: "u1",
    ...overrides,
  };
}

describe("CollectionRegistry", () => {
  let socket: SilentSocket;
  let engine: SyncEngine;
  let registry: CollectionRegistry;

  beforeEach(async () => {
    socket = new SilentSocket();
    // onStoreChange を registry.applyStoreChange に配線する（ドキュメント化された契約）。
    // registry はこの直後に代入されるが、コールバックは実際にストア変更が起きるまで
    // 呼ばれないため、クロージャ経由の前方参照で問題ない。
    engine = new SyncEngine({
      connect: async () => socket,
      storage: new MemorySyncStorage(),
      onStoreChange: (change) => registry.applyStoreChange(change),
    });
    registry = new CollectionRegistry(engine);
    await engine.start();
  });

  it("creates one collection per content type at runtime", () => {
    registry.sync([articleType, noteType]);
    expect(registry.keys().toSorted()).toEqual(["article", "note"]);
    expect(registry.get("article")).toBeDefined();
    expect(registry.get("nope")).toBeUndefined();
  });

  it("keeps the existing collection when a type is re-delivered", () => {
    registry.sync([articleType]);
    const first = registry.get("article");
    registry.sync([articleType, noteType]);
    expect(registry.get("article")).toBe(first);
  });

  it("writes synced records into the collection and marks it ready", () => {
    registry.sync([articleType]);
    registry.markReady();
    registry.applyStoreChange({ kind: "upsert", record: record() });

    const collection = registry.get("article");
    expect(collection?.get("r1")?.input["title"]).toBe("hello");
    expect(collection?.status).not.toBe("loading");
  });

  it("removes a record from the collection on a tombstone", () => {
    registry.sync([articleType]);
    registry.markReady();
    registry.applyStoreChange({ kind: "upsert", record: record() });
    registry.applyStoreChange({ kind: "delete", recordId: "r1", typeKey: "article" });
    expect(registry.get("article")?.get("r1")).toBeUndefined();
  });

  it("ignores store changes for an unknown type", () => {
    registry.sync([articleType]);
    expect(() =>
      registry.applyStoreChange({ kind: "upsert", record: record({ type: "unknown" }) }),
    ).not.toThrow();
  });

  it("pushes an optimistic insert and merges the acked record before resolving", async () => {
    registry.sync([articleType]);
    registry.markReady();
    const pushSpy = vi.spyOn(engine, "push");

    const collection = registry.get("article");
    const tx = collection?.insert(record({ id: "new", input: { title: "draft" } }));

    await vi.waitFor(() => expect(pushSpy).toHaveBeenCalledTimes(1));
    const pushed = pushSpy.mock.calls[0]?.[0];
    expect(pushed?.typeKey).toBe("article");
    expect(pushed?.recordId).toBe("new");
    expect(pushed?.op).toBe("upsert");

    // ack が返ると確定レコードが同期状態にマージされ、Promise が解決する
    socket.emit("message", {
      data: JSON.stringify({
        type: "ack",
        changeId: pushed?.changeId,
        result: { ok: true, record: record({ id: "new", seq: 7, input: { title: "confirmed" } }) },
      }),
    });

    await tx?.isPersisted.promise;
    expect(collection?.get("new")?.input["title"]).toBe("confirmed");
  });

  it("rolls back the optimistic overlay when the server rejects the change", async () => {
    registry.sync([articleType]);
    registry.markReady();
    const pushSpy = vi.spyOn(engine, "push");

    const collection = registry.get("article");
    const tx = collection?.insert(record({ id: "bad", input: { title: "" } }));
    await vi.waitFor(() => expect(pushSpy).toHaveBeenCalledTimes(1));
    const changeId = pushSpy.mock.calls[0]?.[0]?.changeId;

    socket.emit("message", {
      data: JSON.stringify({
        type: "ack",
        changeId,
        result: { ok: false, code: "validation_failed", message: "title: required" },
      }),
    });

    await expect(tx?.isPersisted.promise).rejects.toBeDefined();
    expect(collection?.get("bad")).toBeUndefined();
  });

  it("removes the record for good when a delete is pushed and acked", async () => {
    registry.sync([articleType]);
    registry.markReady();
    registry.applyStoreChange({ kind: "upsert", record: record() });
    expect(registry.get("article")?.get("r1")).toBeDefined();

    const pushSpy = vi.spyOn(engine, "push");
    const collection = registry.get("article");
    const tx = collection?.delete("r1");

    await vi.waitFor(() => expect(pushSpy).toHaveBeenCalledTimes(1));
    const pushed = pushSpy.mock.calls[0]?.[0];
    expect(pushed?.op).toBe("delete");

    socket.emit("message", {
      data: JSON.stringify({
        type: "ack",
        changeId: pushed?.changeId,
        result: {
          ok: true,
          record: record({ seq: 9, deletedAt: "2026-07-13T02:00:00Z", input: {} }),
        },
      }),
    });

    await tx?.isPersisted.promise;
    // 確定した削除が同期状態に反映され、レコードが復活しない
    expect(collection?.get("r1")).toBeUndefined();
    await vi.waitFor(() => expect(collection?.get("r1")).toBeUndefined());
  });

  it("classifies a remote upsert for an already-synced key as an update", () => {
    registry.sync([articleType]);
    registry.markReady();
    registry.applyStoreChange({ kind: "upsert", record: record({ seq: 1 }) });
    expect(() =>
      registry.applyStoreChange({
        kind: "upsert",
        record: record({ seq: 2, input: { title: "v2" } }),
      }),
    ).not.toThrow();
    expect(registry.get("article")?.get("r1")?.input["title"]).toBe("v2");
  });
});

describe("CollectionRegistry wired to the engine", () => {
  it("merges a confirmed mutation exactly once and keeps it after the handler resolves", async () => {
    const socket = new SilentSocket();
    let registry!: CollectionRegistry;
    const engine = new SyncEngine({
      connect: async () => socket,
      storage: new MemorySyncStorage(),
      onContentTypes: (types) => registry.sync(types),
      onReady: () => registry.markReady(),
      onStoreChange: (change) => registry.applyStoreChange(change),
    });
    registry = new CollectionRegistry(engine);
    await engine.start();

    socket.emit("message", {
      data: JSON.stringify({
        type: "welcome",
        protocolVersion: 1,
        contentTypes: [articleType],
        serverSeq: 0,
      }),
    });
    socket.emit("message", {
      data: JSON.stringify({ type: "sync", records: [], serverSeq: 0, complete: true }),
    });
    await vi.waitFor(() => expect(engine.status).toBe("ready"));

    const applySpy = vi.spyOn(registry, "applyStoreChange");
    const collection = registry.get("article");
    const tx = collection?.insert(record({ id: "new", input: { title: "draft" } }));
    await vi.waitFor(() => expect(socket.sent.some((raw) => raw.includes('"push"'))).toBe(true));

    const pushed = JSON.parse(socket.sent.find((raw) => raw.includes('"push"')) as string) as {
      changes: { changeId: string }[];
    };
    const changeId = pushed.changes[0]?.changeId;

    socket.emit("message", {
      data: JSON.stringify({
        type: "ack",
        changeId,
        result: { ok: true, record: record({ id: "new", seq: 7, input: { title: "confirmed" } }) },
      }),
    });

    await tx?.isPersisted.promise;
    expect(collection?.get("new")?.input["title"]).toBe("confirmed");
    // 確定レコードのマージは1回だけ（アダプタ境界で数える。engine 境界で数えると
    // アダプタ内の二重書き込みを検出できない）
    const mergesForNew = applySpy.mock.calls.filter(([change]) =>
      change.kind === "upsert" ? change.record.id === "new" : change.recordId === "new",
    );
    expect(mergesForNew).toHaveLength(1);
  });

  it("drops records the server no longer has after a reset", async () => {
    const socket = new SilentSocket();
    let registry!: CollectionRegistry;
    const storage = new MemorySyncStorage();
    await storage.saveCheckpoint(50);
    const engine = new SyncEngine({
      connect: async () => socket,
      storage,
      onContentTypes: (types) => registry.sync(types),
      onReady: () => registry.markReady(),
      onStoreChange: (change) => registry.applyStoreChange(change),
      onReset: () => registry.reset(),
    });
    registry = new CollectionRegistry(engine);
    await engine.start();

    // 通常のブートストラップで1件入る
    socket.emit("message", {
      data: JSON.stringify({
        type: "welcome",
        protocolVersion: 1,
        contentTypes: [articleType],
        serverSeq: 60,
      }),
    });
    socket.emit("message", {
      data: JSON.stringify({
        type: "sync",
        records: [record({ id: "ghost", seq: 55 })],
        serverSeq: 60,
        complete: true,
      }),
    });
    await vi.waitFor(() => expect(registry.get("article")?.get("ghost")).toBeDefined());

    // サーバーリセット（serverSeq が手元 checkpoint より小さい）
    socket.emit("message", {
      data: JSON.stringify({
        type: "welcome",
        protocolVersion: 1,
        contentTypes: [articleType],
        serverSeq: 1,
      }),
    });

    // リセットで同期状態が空になり、ゴーストが残らない
    await vi.waitFor(() => expect(registry.get("article")?.get("ghost")).toBeUndefined());
  });
});
