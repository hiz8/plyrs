import { env } from "cloudflare:workers";
import { MemorySyncStorage, SyncEngine } from "@plyrs/sync-client";
import type { ClientChange } from "@plyrs/sync-protocol";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { articleType, auth, uuid, validArticleInput } from "./fixtures";
import { openSyncSocket } from "./ws-helpers";

const TENANT = "018f2b6a-7a0a-7000-8000-0000000000f1";

function freshStub() {
  return env.TENANT_DO.get(env.TENANT_DO.idFromName(crypto.randomUUID()));
}

function socketAuth(userId: string) {
  return {
    userId,
    role: "editor" as const,
    tenantId: TENANT,
    exp: Math.floor(Date.now() / 1000) + 900,
  };
}

function change(recordId: string, overrides: Partial<ClientChange> = {}): ClientChange {
  return {
    changeId: crypto.randomUUID(),
    recordId,
    typeKey: "article",
    op: "upsert",
    input: validArticleInput(),
    changedFields: Object.keys(validArticleInput()),
    baseFieldVersions: {},
    ...overrides,
  };
}

describe("sync client against the real DO", () => {
  let stub: ReturnType<typeof freshStub>;

  beforeEach(async () => {
    stub = freshStub();
    await stub.registerContentType(articleType(), auth("admin"));
  });

  function engineFor(userId: string) {
    return new SyncEngine({
      connect: async () => {
        const { socket } = await openSyncSocket(stub, socketAuth(userId));
        return socket;
      },
      storage: new MemorySyncStorage(),
    });
  }

  it("bootstraps from the server and receives the content types", async () => {
    await stub.writeRecord(
      "article",
      { recordId: uuid(60), input: validArticleInput() },
      auth("seed"),
    );

    const types: string[] = [];
    const engine = new SyncEngine({
      connect: async () => (await openSyncSocket(stub, socketAuth("editor-1"))).socket,
      storage: new MemorySyncStorage(),
      onContentTypes: (received) => types.push(...received.map((type) => type.key)),
    });

    await engine.start();
    await vi.waitFor(() => expect(engine.status).toBe("ready"), { timeout: 5000 });

    expect(types).toContain("article");
    expect(engine.store.get(uuid(60))?.input["title"]).toBe("こんにちは");
    // relations が input に統合されて届く
    expect(engine.store.get(uuid(60))?.input["authors"]).toEqual(validArticleInput()["authors"]);
    expect(engine.checkpoint).toBeGreaterThan(0);
    await engine.stop();
  });

  it("pushes a record and resolves with the server's confirmed version", async () => {
    const engine = engineFor("editor-1");
    await engine.start();
    await vi.waitFor(() => expect(engine.status).toBe("ready"), { timeout: 5000 });

    const confirmed = await engine.push(change(uuid(61)));
    expect(confirmed.id).toBe(uuid(61));
    expect(confirmed.seq).toBeGreaterThan(0);
    expect(confirmed.updatedBy).toBe("editor-1");
    expect(engine.store.get(uuid(61))?.input["title"]).toBe("こんにちは");
    await engine.stop();
  });

  it("rejects a push the server refuses (validation)", async () => {
    const engine = engineFor("editor-1");
    await engine.start();
    await vi.waitFor(() => expect(engine.status).toBe("ready"), { timeout: 5000 });

    const invalid = change(uuid(62), {
      input: { ...validArticleInput(), title: "" },
      changedFields: ["title"],
    });
    await expect(engine.push(invalid)).rejects.toMatchObject({ code: "validation_failed" });
    await engine.stop();
  });

  it("receives another client's change over the socket", async () => {
    const engine = engineFor("editor-1");
    await engine.start();
    await vi.waitFor(() => expect(engine.status).toBe("ready"), { timeout: 5000 });

    await stub.writeRecord(
      "article",
      { recordId: uuid(63), input: { ...validArticleInput(), slug: "other" } },
      auth("editor-2"),
    );

    await vi.waitFor(() => expect(engine.store.get(uuid(63))).toBeDefined(), { timeout: 5000 });
    expect(engine.store.get(uuid(63))?.updatedBy).toBe("editor-2");
    await engine.stop();
  });

  it("resumes from its checkpoint when the same engine (and store) reconnects, receiving only the delta", async () => {
    const storage = new MemorySyncStorage();
    const first = new SyncEngine({
      connect: async () => (await openSyncSocket(stub, socketAuth("editor-1"))).socket,
      storage,
    });
    await first.start();
    await vi.waitFor(() => expect(first.status).toBe("ready"), { timeout: 5000 });
    await first.push(change(uuid(64)));
    // checkpoint はサーバーの `sync` complete を受けてのみ前進する契約（roadmap §7:
    // Phase 4a 完了時の申し送り）。push の ack 単体では前進しないため、この push を
    // checkpoint に反映させるには一度張り直して新しい hello ラウンドトリップを経由する。
    await first.stop();
    await first.start();
    await vi.waitFor(() => expect(first.status).toBe("ready"), { timeout: 5000 });
    const checkpoint = first.checkpoint;
    await first.stop();

    // 切断中にサーバー側で1件増える
    await stub.writeRecord(
      "article",
      { recordId: uuid(65), input: { ...validArticleInput(), slug: "while-away" } },
      auth("editor-2"),
    );

    // 同一 engine（store を保持したまま）で再接続する。checkpoint 以降だけが届く
    // （切断中の変更は入り、既に持っている record は再送されない）。
    await first.start();
    await vi.waitFor(() => expect(first.status).toBe("ready"), { timeout: 5000 });

    expect(first.checkpoint).toBeGreaterThan(checkpoint);
    expect(first.store.get(uuid(65))).toBeDefined();
    expect(first.store.get(uuid(64))?.input["title"]).toBe("こんにちは");
    await first.stop();
  });

  it("does a full resync instead of trusting a persisted checkpoint when a fresh engine has no records (record persistence gap guard)", async () => {
    // MemorySyncStorage は checkpoint とアウトボックスしか永続化しない（record は持たない）。
    // ページ再読み込み相当の新しい SyncEngine インスタンスは store が空なので、checkpoint
    // だけ引き継いでも Fix 4 のガードにより信用されず、hello checkpoint:0 で全レコードを
    // 取り直す。持ち越した checkpoint を信用して差分だけ受け取ると、以前の record が
    // 二度と届かず UI から消えたままになる。
    const storage = new MemorySyncStorage();
    const first = new SyncEngine({
      connect: async () => (await openSyncSocket(stub, socketAuth("editor-1"))).socket,
      storage,
    });
    await first.start();
    await vi.waitFor(() => expect(first.status).toBe("ready"), { timeout: 5000 });
    await first.push(change(uuid(64)));
    await first.stop();
    await first.start();
    await vi.waitFor(() => expect(first.status).toBe("ready"), { timeout: 5000 });
    const checkpoint = first.checkpoint;
    await first.stop();

    await stub.writeRecord(
      "article",
      { recordId: uuid(65), input: { ...validArticleInput(), slug: "while-away" } },
      auth("editor-2"),
    );

    const resumed = new SyncEngine({
      connect: async () => (await openSyncSocket(stub, socketAuth("editor-1"))).socket,
      storage,
    });
    await resumed.start();
    await vi.waitFor(() => expect(resumed.status).toBe("ready"), { timeout: 5000 });

    expect(resumed.checkpoint).toBeGreaterThan(checkpoint);
    expect(resumed.store.get(uuid(65))).toBeDefined();
    // store が空だったので全再同期になり、以前の record も欠落せずに戻ってくる
    expect(resumed.store.get(uuid(64))).toBeDefined();
    await resumed.stop();
  });
});
