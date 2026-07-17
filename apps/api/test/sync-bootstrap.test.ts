import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { ServerMessage, SyncRecord } from "@plyrs/sync-protocol";
import { articleType, auth, uuid, validArticleInput } from "./fixtures";
import { asWriteResult } from "./rpc-unwrap";
import { nextMessage, nextMessages, openSyncSocket } from "./ws-helpers";

const TENANT = "018f2b6a-7a0a-7000-8000-0000000000c1";

function freshStub() {
  return env.TENANT_DO.get(env.TENANT_DO.idFromName(crypto.randomUUID()));
}

function socketAuth(userId = "editor-1") {
  return {
    userId,
    role: "editor" as const,
    tenantId: TENANT,
    exp: Math.floor(Date.now() / 1000) + 900,
  };
}

function recordsOf(message: ServerMessage): SyncRecord[] {
  return message.type === "sync" ? message.records : [];
}

describe("sync bootstrap", () => {
  let stub: ReturnType<typeof freshStub>;

  beforeEach(async () => {
    stub = freshStub();
    await stub.registerContentType(articleType(), auth("admin"));
  });

  it("sends welcome with content types, then the full record set", async () => {
    const write = asWriteResult(
      await stub.writeRecord(
        "article",
        { recordId: uuid(80), input: validArticleInput() },
        auth("editor-1"),
      ),
    );
    expect(write.ok).toBe(true);

    const { socket } = await openSyncSocket(stub, socketAuth());
    socket.send(JSON.stringify({ type: "hello", checkpoint: 0 }));
    const [welcome, sync] = await nextMessages(socket, 2);

    expect(welcome).toMatchObject({ type: "welcome", protocolVersion: 1 });
    if (welcome.type === "welcome") {
      // Phase 8 裁定 2: システム asset 型が key 昇順で article の次に自動登録される
      expect(welcome.contentTypes.map((type) => type.key)).toEqual(["article", "asset"]);
      expect(welcome.serverSeq).toBeGreaterThan(0);
    }

    expect(sync).toMatchObject({ type: "sync", complete: true });
    const records = recordsOf(sync);
    expect(records).toHaveLength(1);
    expect(records[0]?.id).toBe(uuid(80));
    // relations が input に統合されている（Phase 2 申し送りの継ぎ目の解消）
    expect(records[0]?.input["authors"]).toEqual(validArticleInput()["authors"]);
    expect(records[0]?.input["hero"]).toEqual(validArticleInput()["hero"]);
    expect(records[0]?.input["title"]).toBe("こんにちは");
    expect(records[0]?.fieldVersions["title"]).toBe(1);
    socket.close(1000, "done");
  });

  it("returns only records past the checkpoint", async () => {
    await stub.writeRecord(
      "article",
      { recordId: uuid(81), input: validArticleInput() },
      auth("editor-1"),
    );
    const second = asWriteResult(
      await stub.writeRecord(
        "article",
        { recordId: uuid(82), input: { ...validArticleInput(), slug: "second" } },
        auth("editor-1"),
      ),
    );
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    const checkpoint = second.record.seq - 1;

    const { socket } = await openSyncSocket(stub, socketAuth());
    socket.send(JSON.stringify({ type: "hello", checkpoint }));
    const [, sync] = await nextMessages(socket, 2);
    const records = recordsOf(sync);
    expect(records.map((record) => record.id)).toEqual([uuid(82)]);
    socket.close(1000, "done");
  });

  it("delivers tombstones for records deleted after the checkpoint", async () => {
    await stub.writeRecord(
      "article",
      { recordId: uuid(83), input: validArticleInput() },
      auth("editor-1"),
    );
    const deleted = await stub.deleteRecord(uuid(83), auth("editor-1"));
    expect(deleted.ok).toBe(true);

    const { socket } = await openSyncSocket(stub, socketAuth());
    socket.send(JSON.stringify({ type: "hello", checkpoint: 0 }));
    const [, sync] = await nextMessages(socket, 2);
    const records = recordsOf(sync);
    expect(records).toHaveLength(1);
    expect(records[0]?.id).toBe(uuid(83));
    expect(records[0]?.deletedAt).not.toBeNull();
    expect(records[0]?.input).toEqual({});
    socket.close(1000, "done");
  });

  it("closes the socket on a malformed message", async () => {
    const { socket } = await openSyncSocket(stub, socketAuth());
    const closed = new Promise<{ code: number }>((resolve) => {
      socket.addEventListener("close", (event: CloseEvent) => resolve({ code: event.code }), {
        once: true,
      });
    });
    socket.send("{not json");
    expect((await closed).code).toBe(4002);
  });

  it("answers a second hello with a fresh snapshot (idempotent)", async () => {
    const { socket } = await openSyncSocket(stub, socketAuth());
    socket.send(JSON.stringify({ type: "hello", checkpoint: 0 }));
    await nextMessages(socket, 2);
    socket.send(JSON.stringify({ type: "hello", checkpoint: 0 }));
    const welcome = await nextMessage(socket);
    expect(welcome.type).toBe("welcome");
    socket.close(1000, "done");
  });
});
