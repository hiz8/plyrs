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
    engine = new SyncEngine({ connect: async () => socket, storage: new MemorySyncStorage() });
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
});
