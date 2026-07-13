import type { ContentTypeDefinition } from "@plyrs/metamodel";
import type { ClientChange, ServerMessage, SyncRecord } from "@plyrs/sync-protocol";
import { CLOSE_CODES, KEEPALIVE_PONG } from "@plyrs/sync-protocol";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SyncEngine } from "./engine";
import { MemorySyncStorage } from "./storage";
import type { WebSocketLike } from "./transport";

class FakeSocket implements WebSocketLike {
  readyState = 1;
  readonly sent: string[] = [];
  private readonly listeners = new Map<string, ((event: unknown) => void)[]>();

  send(data: string): void {
    this.sent.push(data);
  }

  // 実物の WebSocket は close/message/error をタスクとしてキューイングし、close() の
  // 同期コンテキスト内では発火させない（WHATWG）。フェイクもその挙動に合わせる。
  close(code = 1000, reason = ""): void {
    this.readyState = 3;
    queueMicrotask(() => this.emit("close", { code, reason }));
  }

  addEventListener(type: string, listener: (event: unknown) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  removeEventListener(type: string, listener: (event: unknown) => void): void {
    this.listeners.set(
      type,
      (this.listeners.get(type) ?? []).filter((entry) => entry !== listener),
    );
  }

  emit(type: string, event: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }

  deliver(message: ServerMessage): void {
    this.emit("message", { data: JSON.stringify(message) });
  }

  parsed(): unknown[] {
    return this.sent.map((raw) => JSON.parse(raw));
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

function change(id = "c1"): ClientChange {
  return {
    changeId: id,
    recordId: "r1",
    typeKey: "article",
    op: "upsert",
    input: { title: "hello" },
    changedFields: ["title"],
    baseFieldVersions: {},
  };
}

describe("SyncEngine", () => {
  let socket: FakeSocket;
  let storage: MemorySyncStorage;

  beforeEach(() => {
    socket = new FakeSocket();
    storage = new MemorySyncStorage();
  });

  function engine(overrides: Partial<ConstructorParameters<typeof SyncEngine>[0]> = {}) {
    return new SyncEngine({
      connect: async () => socket,
      storage,
      ...overrides,
    });
  }

  async function bootstrap(target: SyncEngine): Promise<void> {
    await target.start();
    socket.deliver({
      type: "welcome",
      protocolVersion: 1,
      contentTypes: [articleType],
      serverSeq: 3,
    });
    socket.deliver({ type: "sync", records: [record()], serverSeq: 3, complete: true });
    await vi.waitFor(() => expect(target.status).toBe("ready"));
  }

  it("sends hello with the stored checkpoint and applies the bootstrap", async () => {
    await storage.saveCheckpoint(2);
    const onContentTypes = vi.fn();
    const onReady = vi.fn();
    const target = engine({ onContentTypes, onReady });

    await target.start();
    expect(socket.parsed()[0]).toEqual({ type: "hello", checkpoint: 2 });

    socket.deliver({
      type: "welcome",
      protocolVersion: 1,
      contentTypes: [articleType],
      serverSeq: 3,
    });
    socket.deliver({ type: "sync", records: [record()], serverSeq: 3, complete: true });

    await vi.waitFor(() => expect(target.status).toBe("ready"));
    expect(onContentTypes).toHaveBeenCalledWith([articleType]);
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(target.store.get("r1")?.input["title"]).toBe("hello");
    expect(target.checkpoint).toBe(3);
    expect(await storage.loadCheckpoint()).toBe(3);
  });

  it("does not advance the checkpoint until complete is true", async () => {
    const target = engine();
    await target.start();
    socket.deliver({
      type: "welcome",
      protocolVersion: 1,
      contentTypes: [articleType],
      serverSeq: 9,
    });
    socket.deliver({ type: "sync", records: [record({ seq: 4 })], serverSeq: 9, complete: false });
    expect(target.checkpoint).toBe(0);

    socket.deliver({
      type: "sync",
      records: [record({ id: "r2", seq: 9 })],
      serverSeq: 9,
      complete: true,
    });
    await vi.waitFor(() => expect(target.checkpoint).toBe(9));
  });

  it("resets to a full resync when the server's seq is behind the checkpoint", async () => {
    await storage.saveCheckpoint(50);
    const target = engine();
    await target.start();
    target.store.apply(record({ seq: 40 }));

    socket.deliver({
      type: "welcome",
      protocolVersion: 1,
      contentTypes: [articleType],
      serverSeq: 5,
    });

    await vi.waitFor(() =>
      expect(socket.parsed()).toContainEqual({ type: "hello", checkpoint: 0 }),
    );
    expect(target.store.get("r1")).toBeUndefined();
    expect(target.checkpoint).toBe(0);
  });

  it("applies broadcast changes idempotently", async () => {
    const onStoreChange = vi.fn();
    const target = engine({ onStoreChange });
    await bootstrap(target);
    onStoreChange.mockClear();

    socket.deliver({ type: "change", record: record({ seq: 8, input: { title: "updated" } }) });
    expect(target.store.get("r1")?.input["title"]).toBe("updated");
    expect(onStoreChange).toHaveBeenCalledTimes(1);

    // 重複配信（同じ seq）は無視される
    socket.deliver({ type: "change", record: record({ seq: 8, input: { title: "updated" } }) });
    expect(onStoreChange).toHaveBeenCalledTimes(1);
  });

  it("resolves a push when the ack arrives", async () => {
    const target = engine();
    await bootstrap(target);

    const pushed = target.push(change());
    await vi.waitFor(() =>
      expect(socket.parsed()).toContainEqual({ type: "push", changes: [change()] }),
    );

    socket.deliver({
      type: "ack",
      changeId: "c1",
      result: { ok: true, record: record({ seq: 11, input: { title: "confirmed" } }) },
    });
    const confirmed = await pushed;
    expect(confirmed.seq).toBe(11);
    expect(target.store.get("r1")?.input["title"]).toBe("confirmed");
  });

  it("rejects a push with a conflict ack", async () => {
    const target = engine();
    await bootstrap(target);

    const pushed = target.push(change("c2"));
    socket.deliver({
      type: "ack",
      changeId: "c2",
      result: {
        ok: false,
        code: "conflict",
        message: "manual resolution required",
        conflicts: [{ fieldKey: "body", baseVersion: 1, currentVersion: 4 }],
      },
    });
    await expect(pushed).rejects.toMatchObject({ code: "conflict" });
  });

  it("redelivers pending changes after a reconnect", async () => {
    const target = engine();
    await bootstrap(target);
    const pushed = target.push(change("c3"));
    await vi.waitFor(() => expect(socket.sent.length).toBeGreaterThan(1));

    const next = new FakeSocket();
    socket.close(1006, "network");
    // 再接続後のソケットに差し替わる
    (target as unknown as { options: { connect: () => Promise<WebSocketLike> } }).options.connect =
      async () => next;

    await vi.waitFor(() => expect(next.parsed()[0]).toEqual({ type: "hello", checkpoint: 3 }));
    next.deliver({
      type: "welcome",
      protocolVersion: 1,
      contentTypes: [articleType],
      serverSeq: 3,
    });
    next.deliver({ type: "sync", records: [], serverSeq: 3, complete: true });

    await vi.waitFor(() =>
      expect(next.parsed()).toContainEqual({ type: "push", changes: [change("c3")] }),
    );
    next.deliver({
      type: "ack",
      changeId: "c3",
      result: { ok: true, record: record({ seq: 12 }) },
    });
    await expect(pushed).resolves.toMatchObject({ seq: 12 });
  });

  it("refreshes the token and reconnects on close 4001", async () => {
    const refreshToken = vi.fn(async () => undefined);
    const target = engine({ refreshToken });
    await bootstrap(target);

    const next = new FakeSocket();
    (target as unknown as { options: { connect: () => Promise<WebSocketLike> } }).options.connect =
      async () => next;
    socket.close(CLOSE_CODES.tokenExpired, "token_expired");

    await vi.waitFor(() => expect(refreshToken).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(next.parsed()[0]).toEqual({ type: "hello", checkpoint: 3 }));
  });

  it("terminates without reconnecting when blocked (4003)", async () => {
    const target = engine();
    await bootstrap(target);
    const pushed = target.push(change("c4"));
    // close は（実物同様）非同期に発火するため、棄却ハンドラを先に張っておく。
    // 後から張ると failAll の棄却が一瞬ハンドラ不在になり unhandled rejection として報告される。
    const rejected = expect(pushed).rejects.toThrow(/blocked/);

    socket.close(CLOSE_CODES.blocked, "blocked");

    await vi.waitFor(() => expect(target.status).toBe("closed"));
    await rejected;
  });

  it("ignores keepalive pongs", async () => {
    const target = engine();
    await bootstrap(target);
    expect(() => socket.emit("message", { data: KEEPALIVE_PONG })).not.toThrow();
    expect(target.status).toBe("ready");
  });
});

describe("engine core independence", () => {
  it("does not import @tanstack/db or partysocket", async () => {
    const { readFile } = await import("node:fs/promises");
    // 生の部分文字列ではなく import 文だけを見る（コメント内の言及で誤検知しないため）
    const importPattern = /(?:^|\n)\s*import[^;]*?from\s*["']([^"']+)["']/g;
    for (const file of ["engine.ts", "store.ts", "outbox.ts", "storage.ts", "transport.ts"]) {
      const source = await readFile(new URL(file, import.meta.url), "utf8");
      const specifiers = [...source.matchAll(importPattern)].map((match) => match[1]);
      expect(specifiers).not.toContain("@tanstack/db");
      expect(specifiers).not.toContain("partysocket");
    }
  });
});
