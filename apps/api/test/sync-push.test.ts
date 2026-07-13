import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { ClientChange, ServerMessage } from "@plyrs/sync-protocol";
import { articleType, auth, uuid, validArticleInput } from "./fixtures";
import { asRecordSnapshot } from "./rpc-unwrap";
import { nextMessage, nextMessages, openSyncSocket } from "./ws-helpers";

const TENANT = "018f2b6a-7a0a-7000-8000-0000000000d1";

function freshStub() {
  return env.TENANT_DO.get(env.TENANT_DO.idFromName(crypto.randomUUID()));
}

function socketAuth(userId: string, role: "owner" | "editor" | "viewer" = "editor") {
  return { userId, role, tenantId: TENANT, exp: Math.floor(Date.now() / 1000) + 900 };
}

function change(overrides: Partial<ClientChange> = {}): ClientChange {
  return {
    changeId: crypto.randomUUID(),
    recordId: uuid(90),
    typeKey: "article",
    op: "upsert",
    input: validArticleInput(),
    changedFields: Object.keys(validArticleInput()),
    baseFieldVersions: {},
    ...overrides,
  };
}

async function hello(socket: WebSocket): Promise<void> {
  socket.send(JSON.stringify({ type: "hello", checkpoint: 0 }));
  await nextMessages(socket, 2);
}

function ackOf(message: ServerMessage) {
  return message.type === "ack" ? message.result : null;
}

describe("sync push", () => {
  let stub: ReturnType<typeof freshStub>;

  beforeEach(async () => {
    stub = freshStub();
    await stub.registerContentType(articleType(), auth("admin"));
  });

  it("applies a create and acks with the stored record", async () => {
    const { socket } = await openSyncSocket(stub, socketAuth("editor-1"));
    await hello(socket);

    const pushed = change();
    socket.send(JSON.stringify({ type: "push", changes: [pushed] }));
    const ack = await nextMessage(socket);

    expect(ack).toMatchObject({ type: "ack", changeId: pushed.changeId });
    const result = ackOf(ack);
    expect(result?.ok).toBe(true);
    if (result?.ok) {
      expect(result.record.id).toBe(uuid(90));
      expect(result.record.seq).toBeGreaterThan(0);
      expect(result.record.input["authors"]).toEqual(validArticleInput()["authors"]);
      expect(result.record.updatedBy).toBe("editor-1");
    }
    expect(asRecordSnapshot(await stub.getRecord(uuid(90)))).not.toBeNull();
    socket.close(1000, "done");
  });

  it("merges a concurrent edit to a different field", async () => {
    const { socket } = await openSyncSocket(stub, socketAuth("editor-1"));
    await hello(socket);
    socket.send(JSON.stringify({ type: "push", changes: [change()] }));
    await nextMessage(socket);

    // サーバー側で title を先に進める（別クライアント相当）
    await stub.writeRecord(
      "article",
      { recordId: uuid(90), input: { ...validArticleInput(), title: "server wins" } },
      auth("editor-2"),
    );

    const stale = change({
      input: { ...validArticleInput(), slug: "client-slug" },
      changedFields: ["slug"],
      baseFieldVersions: { slug: 1 },
    });
    socket.send(JSON.stringify({ type: "push", changes: [stale] }));
    const ack = await nextMessage(socket);
    const result = ackOf(ack);
    expect(result?.ok).toBe(true);
    if (result?.ok) {
      expect(result.record.input["slug"]).toBe("client-slug");
      expect(result.record.input["title"]).toBe("server wins");
    }
    socket.close(1000, "done");
  });

  it("rejects a stale richtext edit as a conflict without writing", async () => {
    const { socket } = await openSyncSocket(stub, socketAuth("editor-1"));
    await hello(socket);
    socket.send(JSON.stringify({ type: "push", changes: [change()] }));
    await nextMessage(socket);

    await stub.writeRecord(
      "article",
      {
        recordId: uuid(90),
        input: { ...validArticleInput(), body: { schemaVersion: 1, doc: { server: true } } },
      },
      auth("editor-2"),
    );

    const stale = change({
      input: { ...validArticleInput(), body: { schemaVersion: 1, doc: { client: true } } },
      changedFields: ["body"],
      baseFieldVersions: { body: 1 },
    });
    socket.send(JSON.stringify({ type: "push", changes: [stale] }));
    const result = ackOf(await nextMessage(socket));
    expect(result?.ok).toBe(false);
    if (result?.ok === false) {
      expect(result.code).toBe("conflict");
      expect(result.conflicts?.[0]?.fieldKey).toBe("body");
    }
    const stored = asRecordSnapshot(await stub.getRecord(uuid(90)));
    expect(stored?.data["body"]).toEqual({ schemaVersion: 1, doc: { server: true } });
    socket.close(1000, "done");
  });

  it("acks a delete and broadcasts the tombstone", async () => {
    const writer = await openSyncSocket(stub, socketAuth("editor-1"));
    const watcher = await openSyncSocket(stub, socketAuth("editor-2"));
    await hello(writer.socket);
    await hello(watcher.socket);

    writer.socket.send(JSON.stringify({ type: "push", changes: [change()] }));
    await nextMessage(writer.socket);
    await nextMessage(watcher.socket); // change broadcast

    const removal = change({ op: "delete", input: {}, changedFields: [], baseFieldVersions: {} });
    writer.socket.send(JSON.stringify({ type: "push", changes: [removal] }));
    const ack = await nextMessage(writer.socket);
    const broadcast = await nextMessage(watcher.socket);

    const result = ackOf(ack);
    expect(result?.ok).toBe(true);
    if (result?.ok) {
      expect(result.record.deletedAt).not.toBeNull();
    }
    expect(broadcast.type).toBe("change");
    if (broadcast.type === "change") {
      expect(broadcast.record.deletedAt).not.toBeNull();
    }
    writer.socket.close(1000, "done");
    watcher.socket.close(1000, "done");
  });

  it("broadcasts an applied change to other sockets but not the sender", async () => {
    const writer = await openSyncSocket(stub, socketAuth("editor-1"));
    const watcher = await openSyncSocket(stub, socketAuth("editor-2"));
    await hello(writer.socket);
    await hello(watcher.socket);

    const pushed = change();
    writer.socket.send(JSON.stringify({ type: "push", changes: [pushed] }));
    const ack = await nextMessage(writer.socket);
    const broadcast = await nextMessage(watcher.socket);

    expect(ack.type).toBe("ack");
    expect(broadcast.type).toBe("change");
    if (broadcast.type === "change") {
      expect(broadcast.record.id).toBe(uuid(90));
    }
    writer.socket.close(1000, "done");
    watcher.socket.close(1000, "done");
  });

  it("does not echo the broadcast back to the sender", async () => {
    const writer = await openSyncSocket(stub, socketAuth("editor-1"));
    const watcher = await openSyncSocket(stub, socketAuth("editor-2"));
    await hello(writer.socket);
    await hello(watcher.socket);

    writer.socket.send(JSON.stringify({ type: "push", changes: [change()] }));
    const ack = await nextMessage(writer.socket);
    expect(ack.type).toBe("ack");
    // watcher は change を受け取る
    expect((await nextMessage(watcher.socket)).type).toBe("change");
    // sender には change が来ない（次のメッセージを待って落ちることを確認）
    await expect(nextMessage(writer.socket, 300)).rejects.toThrow();

    writer.socket.close(1000, "done");
    watcher.socket.close(1000, "done");
  });

  it("denies a viewer's push with forbidden and writes nothing", async () => {
    const { socket } = await openSyncSocket(stub, socketAuth("mallory", "viewer"));
    await hello(socket);
    socket.send(JSON.stringify({ type: "push", changes: [change({ recordId: uuid(91) })] }));
    const result = ackOf(await nextMessage(socket));
    expect(result?.ok).toBe(false);
    if (result?.ok === false) {
      expect(result.code).toBe("forbidden");
    }
    expect(asRecordSnapshot(await stub.getRecord(uuid(91)))).toBeNull();
    socket.close(1000, "done");
  });

  it("acks each change in a batch independently", async () => {
    const { socket } = await openSyncSocket(stub, socketAuth("editor-1"));
    await hello(socket);
    const good = change({ recordId: uuid(92) });
    const bad = change({ recordId: uuid(93), typeKey: "no_such_type" });
    socket.send(JSON.stringify({ type: "push", changes: [good, bad] }));
    const [first, second] = await nextMessages(socket, 2);

    expect(ackOf(first)?.ok).toBe(true);
    const secondResult = ackOf(second);
    expect(secondResult?.ok).toBe(false);
    if (secondResult?.ok === false) {
      expect(secondResult.code).toBe("unknown_type");
    }
    socket.close(1000, "done");
  });
});
