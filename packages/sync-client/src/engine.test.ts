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
    // checkpoint だけ残っていてもストアが空だと信用されない（Fix 4）ので、耐久実装なら
    // 前回起動から生き残っているはずのレコードを、start() の前に入れておく。
    target.store.apply(record({ id: "prior", seq: 1 }));

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

  it("ignores a stored checkpoint and bootstraps from 0 when the store holds no records (no record persistence)", async () => {
    await storage.saveCheckpoint(50);
    const target = engine();

    await target.start();

    expect(socket.parsed()[0]).toEqual({ type: "hello", checkpoint: 0 });
    expect(target.checkpoint).toBe(0);
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
    // checkpoint だけ残っていてもストアが空だと信用されない（Fix 4）ので、start() の
    // 前にレコードを入れて checkpoint 50 が生き残るようにしておく。
    target.store.apply(record({ seq: 40 }));
    await target.start();

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

  it("is not poisoned by the previous round's sync when the server resets", async () => {
    await storage.saveCheckpoint(50);
    const target = engine();
    // checkpoint だけ残っていてもストアが空だと信用されない（Fix 4）ので、start() の
    // 前にレコードを入れて checkpoint 50 が生き残るようにしておく。
    target.store.apply(record({ seq: 40 }));
    await target.start();

    // reset を告げる welcome と、旧ラウンドの sync{complete} を同一ティックで配信する
    socket.deliver({
      type: "welcome",
      protocolVersion: 1,
      contentTypes: [articleType],
      serverSeq: 5,
    });
    socket.deliver({ type: "sync", records: [], serverSeq: 5, complete: true });

    await vi.waitFor(() =>
      expect(socket.parsed()).toContainEqual({ type: "hello", checkpoint: 0 }),
    );
    // 旧ラウンドの sync に checkpoint を巻き戻されていない
    expect(target.checkpoint).toBe(0);
    expect(await storage.loadCheckpoint()).toBe(0);
    expect(target.store.get("r1")).toBeUndefined();

    // リセット後の welcome + sync で正しく再同期できる
    socket.deliver({
      type: "welcome",
      protocolVersion: 1,
      contentTypes: [articleType],
      serverSeq: 5,
    });
    socket.deliver({ type: "sync", records: [record({ seq: 3 })], serverSeq: 5, complete: true });
    await vi.waitFor(() => expect(target.checkpoint).toBe(5));
    expect(target.store.get("r1")?.seq).toBe(3);
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

  it("does not resend an in-flight change on every push, and resends all pending after a reconnect", async () => {
    const target = engine();
    await bootstrap(target);

    void target.push(change("c1"));
    await vi.waitFor(() =>
      expect(socket.parsed()).toContainEqual({ type: "push", changes: [change("c1")] }),
    );
    void target.push(change("c2"));
    await vi.waitFor(() =>
      expect(socket.parsed()).toContainEqual({ type: "push", changes: [change("c2")] }),
    );

    const pushMessages = socket
      .parsed()
      .filter((message) => (message as { type: string }).type === "push");
    // c1 は一度しか送られない（[c1] の次が [c1, c2] のような累積再送にならない）
    expect(pushMessages).toEqual([
      { type: "push", changes: [change("c1")] },
      { type: "push", changes: [change("c2")] },
    ]);

    // どちらも ack が届かないまま切断・再接続する
    const next = new FakeSocket();
    socket.close(1006, "network");
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

    // 新しいソケットでは inFlight がリセットされ、未 ack の両方が再送される
    await vi.waitFor(() =>
      expect(next.parsed()).toContainEqual({
        type: "push",
        changes: [change("c1"), change("c2")],
      }),
    );
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

  it("terminates without reconnecting when blocked (4003), draining the outbox", async () => {
    const target = engine();
    await bootstrap(target);
    const pushed = target.push(change("c4"));
    // close は（実物同様）非同期に発火するため、棄却ハンドラを先に張っておく。
    // 後から張ると failAll の棄却が一瞬ハンドラ不在になり unhandled rejection として報告される。
    const rejected = expect(pushed).rejects.toThrow(/blocked/);

    socket.close(CLOSE_CODES.blocked, "blocked");

    await vi.waitFor(() => expect(target.status).toBe("closed"));
    await rejected;
    // サーバーに確定的に拒否された場合は、接続できないだけの場合と違って
    // 永続化済みアウトボックスも空にする（意図した非対称性）。
    expect(await storage.loadOutbox()).toHaveLength(0);
  });

  it("ignores keepalive pongs", async () => {
    const target = engine();
    await bootstrap(target);
    expect(() => socket.emit("message", { data: KEEPALIVE_PONG })).not.toThrow();
    expect(target.status).toBe("ready");
  });

  it("retries the reconnect with backoff and goes offline (status closed, outbox intact) when the delays run out", async () => {
    let attempts = 0;
    const failing = new SyncEngine({
      connect: async () => {
        attempts += 1;
        if (attempts === 1) {
          return socket;
        }
        throw new Error("connect failed");
      },
      storage,
      reconnectDelaysMs: [0, 0],
    });
    await failing.start();
    socket.close(1006, "network");
    await vi.waitFor(() => expect(failing.status).toBe("closed"));
    // 初回 connect（start）で 1 回、reconnect ループが delays[0]・delays[1] を
    // 使い切ってなお失敗し、delays[2] が undefined になった時点で打ち切る。
    // つまり reconnect 内の connect 呼び出しは 3 回、合計で 1 + 3 = 4 回。
    expect(attempts).toBe(4);
    // 接続できないだけ（サーバーからの拒否ではない）なので、アウトボックスは
    // 空のまま失敗させたりしない（この時点では何も enqueue していないので空が期待値）。
    expect(await storage.loadOutbox()).toHaveLength(0);
  });

  it("closes a socket that opens after stop() instead of orphaning it, and stays closed", async () => {
    let resolveConnect!: (socket: WebSocketLike) => void;
    const pendingConnect = new Promise<WebSocketLike>((resolve) => {
      resolveConnect = resolve;
    });
    const target = new SyncEngine({
      connect: () => pendingConnect,
      storage,
    });

    const startPromise = target.start();
    // open() は connect() の gate を await 中。ここで stop() を割り込ませる。
    await vi.waitFor(() => expect(target.status).toBe("connecting"));
    await target.stop();
    expect(target.status).toBe("closed");

    // gate がここで解決する = stop() の後に遅れて開いたソケット
    resolveConnect(socket);
    await startPromise;

    // 孤児にせず閉じて捨てている（世代が古いので this.socket には代入されない）
    expect(socket.readyState).toBe(3);
    expect(target.status).toBe("closed");
  });

  it("retries a first connect that always fails with backoff and ends closed, keeping the pending push unresolved and persisted", async () => {
    let attempts = 0;
    const target = new SyncEngine({
      connect: async () => {
        attempts += 1;
        throw new Error("offline");
      },
      storage,
      reconnectDelaysMs: [0, 0],
    });

    const startPromise = target.start();
    const pushed = target.push(change("c9"));
    // 新しい意味論では「接続できない」は「拒否された」ではないので、push() の
    // Promise は解決も棄却もされず保留のまま残る（楽観的な表示を維持するため）。
    let settled = false;
    void pushed.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );

    // start() は接続失敗時にも reject しない。status/outbox が失敗のシグナルになる。
    await expect(startPromise).resolves.toBeUndefined();
    expect(target.status).toBe("closed");
    // delays[0]・delays[1] を使い切ってなお失敗し、delays[2] が undefined になった
    // 時点で打ち切る。つまり connect 呼び出しは 3 回。
    expect(attempts).toBe(3);
    // マイクロタスクを一巡させても push() は未解決のまま（= unhandled rejection も出ない）
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(settled).toBe(false);
    expect(await storage.loadOutbox()).toHaveLength(1);
  });

  it("keeps the persisted outbox through an offline cold start and re-sends it once connect succeeds (data-loss regression guard)", async () => {
    // リロード前の engine が enqueue した想定で、未送信の変更を先に永続化しておく。
    await storage.saveOutbox([change("c-cold")]);

    let shouldFail = true;
    const target = new SyncEngine({
      connect: async () => {
        if (shouldFail) {
          throw new Error("offline");
        }
        return socket;
      },
      storage,
      reconnectDelaysMs: [0, 0],
    });

    await target.start();
    expect(target.status).toBe("closed");
    // データ消失の回帰ガード: バックオフを使い切ってもアウトボックスは残る
    expect(await storage.loadOutbox()).toHaveLength(1);

    // 接続できるようになったら、次の start() で永続化済みの変更を再送する
    shouldFail = false;
    await target.start();
    socket.deliver({
      type: "welcome",
      protocolVersion: 1,
      contentTypes: [articleType],
      serverSeq: 0,
    });
    socket.deliver({ type: "sync", records: [], serverSeq: 0, complete: true });
    await vi.waitFor(() => expect(target.status).toBe("ready"));

    await vi.waitFor(() =>
      expect(socket.parsed()).toContainEqual({
        type: "push",
        changes: [change("c-cold")],
      }),
    );
  });

  it("closes the previously connected socket when start() is called again while connected", async () => {
    const target = engine();
    await bootstrap(target);
    expect(socket.readyState).toBe(1);

    const next = new FakeSocket();
    (target as unknown as { options: { connect: () => Promise<WebSocketLike> } }).options.connect =
      async () => next;

    await target.start();

    // 孤児にせず前のソケットを明示的に閉じている
    expect(socket.readyState).toBe(3);
  });

  it("falls back to closed (keeping the outbox) without an unhandled rejection when refreshToken rejects", async () => {
    const refreshToken = vi.fn(async () => {
      throw new Error("refresh failed");
    });
    const target = engine({ refreshToken });
    await bootstrap(target);
    const pushed = target.push(change("c5"));
    await vi.waitFor(() => expect(socket.sent.length).toBeGreaterThan(1));

    socket.close(CLOSE_CODES.tokenExpired, "token_expired");

    await vi.waitFor(() => expect(target.status).toBe("closed"));
    expect(refreshToken).toHaveBeenCalledTimes(1);
    expect(await storage.loadOutbox()).toHaveLength(1);

    // push() の Promise は保留のまま（棄却されない）= unhandled rejection が出ない
    let settled = false;
    void pushed.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(settled).toBe(false);
  });
});

describe("engine core independence", () => {
  it("does not import @tanstack/db or partysocket (including subpaths)", async () => {
    const { readFile } = await import("node:fs/promises");
    const forbidden = ["@tanstack/db", "partysocket"];
    // static import / side-effect import / re-export / dynamic import をすべて拾う。
    // コメント内の言及では誤検知しない（specifier のクォートを伴う形だけを見る）。
    const specifierPattern = /(?:from\s*|import\s*|import\(\s*)["']([^"']+)["']/g;
    // transport.ts は import を1つも持たない（型と定数のみ）ので、パーサ生存確認からは除外する
    const filesWithoutImports = new Set(["transport.ts"]);

    for (const file of ["engine.ts", "store.ts", "outbox.ts", "storage.ts", "transport.ts"]) {
      const source = await readFile(new URL(file, import.meta.url), "utf8");
      const specifiers = [...source.matchAll(specifierPattern)].map((match) => match[1]);
      // パーサが生きていること自体を確認する（空振り合格を防ぐ）
      if (!filesWithoutImports.has(file)) {
        expect(specifiers.length).toBeGreaterThan(0);
      }
      for (const specifier of specifiers) {
        for (const pkg of forbidden) {
          expect(specifier === pkg || specifier?.startsWith(`${pkg}/`)).toBe(false);
        }
      }
    }
  });
});
