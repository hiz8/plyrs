import { evictDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { articleType, auth, uuid, validArticleInput } from "./fixtures";
import { asWriteResult } from "./rpc-unwrap";
import { closeInfo, nextMessage, nextMessages, openSyncSocket } from "./ws-helpers";

const TENANT = "018f2b6a-7a0a-7000-8000-0000000000e1";

function freshStub() {
  return env.TENANT_DO.get(env.TENANT_DO.idFromName(crypto.randomUUID()));
}

function socketAuth(userId: string, expSeconds: number) {
  return { userId, role: "editor" as const, tenantId: TENANT, exp: expSeconds };
}

function future() {
  return Math.floor(Date.now() / 1000) + 900;
}

describe("sync lifecycle", () => {
  let stub: ReturnType<typeof freshStub>;

  beforeEach(async () => {
    stub = freshStub();
    await stub.registerContentType(articleType(), auth("admin"));
  });

  it("closes a socket whose token expired after connecting (Phase 3 handoff)", async () => {
    const expired = Math.floor(Date.now() / 1000) - 60;
    const { socket } = await openSyncSocket(stub, socketAuth("editor-1", expired));
    const closed = closeInfo(socket);
    socket.send(JSON.stringify({ type: "hello", checkpoint: 0 }));
    expect((await closed).code).toBe(4001);
  });

  it("disconnects an established socket when the user is banned", async () => {
    const userId = "018f2b6a-7a0a-7000-8000-0000000000e2";
    const { socket } = await openSyncSocket(stub, socketAuth(userId, future()));
    socket.send(JSON.stringify({ type: "hello", checkpoint: 0 }));
    await nextMessages(socket, 2);

    const closed = closeInfo(socket);
    expect(await stub.disconnectUser(userId)).toBe(1);
    const info = await closed;
    expect(info.code).toBe(4003);
    expect(info.reason).toBe("blocked");
    expect(await stub.countSockets(`user:${userId}`)).toBe(0);
  });

  it("re-delivers content types to open sockets when a type is registered", async () => {
    const { socket } = await openSyncSocket(stub, socketAuth("editor-1", future()));
    socket.send(JSON.stringify({ type: "hello", checkpoint: 0 }));
    await nextMessages(socket, 2);

    const noteType = {
      ...articleType(),
      id: uuid(70),
      key: "note",
      fields: [{ key: "title", type: "text" as const, required: true }],
    };
    // リスナーを先に張る: RPC を await している間に届くメッセージを取りこぼさない
    const received = nextMessage(socket);
    const registered = await stub.registerContentType(noteType, auth("admin"));
    expect(registered.ok).toBe(true);

    const message = await received;
    expect(message.type).toBe("content-types");
    if (message.type === "content-types") {
      expect(message.contentTypes.map((type) => type.key).toSorted()).toEqual([
        "article",
        "asset",
        "note",
      ]);
    }
    socket.close(1000, "done");
  });

  it("survives hibernation: the socket stays usable and auth is restored from the attachment", async () => {
    // 退避前に1件書いておく: constructor の MAX(seq) 復元が壊れていれば seq が巻き戻る
    const before = asWriteResult(
      await stub.writeRecord(
        "article",
        { recordId: uuid(94), input: validArticleInput() },
        auth("editor-1"),
      ),
    );
    expect(before.ok).toBe(true);
    const seqBefore = before.ok ? before.record.seq : 0;

    const { socket } = await openSyncSocket(stub, socketAuth("editor-1", future()));
    socket.send(JSON.stringify({ type: "hello", checkpoint: 0 }));
    await nextMessages(socket, 2);

    await evictDurableObject(stub, { webSockets: "hibernate" });

    socket.send(
      JSON.stringify({
        type: "push",
        changes: [
          {
            changeId: crypto.randomUUID(),
            recordId: uuid(95),
            typeKey: "article",
            op: "upsert",
            input: validArticleInput(),
            changedFields: Object.keys(validArticleInput()),
            baseFieldVersions: {},
          },
        ],
      }),
    );
    const ack = await nextMessage(socket);
    expect(ack.type).toBe("ack");
    if (ack.type === "ack" && ack.result.ok) {
      expect(ack.result.record.updatedBy).toBe("editor-1");
      // seq はハイバネーション復帰後も単調に続く（constructor が MAX(seq) から復元）
      expect(ack.result.record.seq).toBeGreaterThan(seqBefore);
    }
    socket.close(1000, "done");
  });

  it("stops broadcasting to a socket whose token expired and closes it", async () => {
    const live = await openSyncSocket(stub, socketAuth("editor-1", future()));
    const stale = await openSyncSocket(
      stub,
      socketAuth("editor-2", Math.floor(Date.now() / 1000) - 60),
    );
    const staleClosed = closeInfo(stale.socket);

    // リスナーを先に張る: RPC を await している間に届くメッセージを取りこぼさない
    const message = nextMessage(live.socket);
    const written = asWriteResult(
      await stub.writeRecord(
        "article",
        { recordId: uuid(96), input: validArticleInput() },
        auth("editor-3"),
      ),
    );
    expect(written.ok).toBe(true);

    // 生きているソケットには届く
    expect((await message).type).toBe("change");
    // 失効ソケットは配信されず 4001 で閉じられる
    expect((await staleClosed).code).toBe(4001);

    live.socket.close(1000, "done");
  });

  it("broadcasts HTTP/RPC writes and deletes to live sockets", async () => {
    const { socket } = await openSyncSocket(stub, socketAuth("editor-1", future()));
    socket.send(JSON.stringify({ type: "hello", checkpoint: 0 }));
    await nextMessages(socket, 2);

    const created = nextMessage(socket);
    await stub.writeRecord(
      "article",
      { recordId: uuid(97), input: validArticleInput() },
      auth("editor-2"),
    );
    const createMessage = await created;
    expect(createMessage.type).toBe("change");
    if (createMessage.type === "change") {
      expect(createMessage.record.id).toBe(uuid(97));
      expect(createMessage.record.deletedAt).toBeNull();
    }

    const removed = nextMessage(socket);
    await stub.deleteRecord(uuid(97), auth("editor-2"));
    const deleteMessage = await removed;
    expect(deleteMessage.type).toBe("change");
    if (deleteMessage.type === "change") {
      expect(deleteMessage.record.deletedAt).not.toBeNull();
    }

    socket.close(1000, "done");
  });
});
