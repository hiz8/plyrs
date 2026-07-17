import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { ClientChange, ServerMessage } from "@plyrs/sync-protocol";
import { OUTBOX_SWEEP } from "../src/do/alarms";
import type { ProjectionJob } from "../src/projection/jobs";
import { articleType, auth, uuid, validArticleInput } from "./fixtures";
import {
  asProjectionPayload,
  asPublishResult,
  asRecordSnapshot,
  asWriteResult,
} from "./rpc-unwrap";
import { nextMessage, nextMessages, openSyncSocket } from "./ws-helpers";

// Finding B（レビュー指摘・MINOR）: push 経路の armSweep が未検証だった。drainOutbox の
// PROJECTION_QUEUE.send() を確実に失敗させる偽の Queue で、送出が失敗しても outbox 行と
// アラーム登録が生き残ること（= sweeper が拾い直せること）を固定する。
function failingQueue(): Queue<ProjectionJob> {
  return {
    metrics: () => Promise.resolve({ backlogCount: 0, backlogBytes: 0 }),
    send: async () => {
      throw new Error("queue send failed (test double)");
    },
    sendBatch: async () => {
      throw new Error("sendBatch is not used by the push path");
    },
  };
}

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
        input: {
          ...validArticleInput(),
          body: {
            schemaVersion: 1,
            doc: {
              type: "doc",
              content: [{ type: "paragraph", content: [{ type: "text", text: "server" }] }],
            },
          },
        },
      },
      auth("editor-2"),
    );

    const stale = change({
      input: {
        ...validArticleInput(),
        body: {
          schemaVersion: 1,
          doc: {
            type: "doc",
            content: [{ type: "paragraph", content: [{ type: "text", text: "client" }] }],
          },
        },
      },
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
    expect(stored?.data["body"]).toEqual({
      schemaVersion: 1,
      doc: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "server" }] }],
      },
    });
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

  it("cascades unpublish when a published record is deleted over the sync socket (裁定 2026-07-13)", async () => {
    const recordId = uuid(650);
    const written = asWriteResult(
      await stub.writeRecord("article", { recordId, input: validArticleInput() }, auth("admin")),
    );
    expect(written.ok).toBe(true);
    const published = asPublishResult(
      await stub.publishRecord(TENANT, TENANT, recordId, auth("admin")),
    );
    expect(published.ok).toBe(true);

    const { socket } = await openSyncSocket(stub, socketAuth("editor-1"));
    await hello(socket);

    const removal = change({
      recordId,
      op: "delete",
      input: {},
      changedFields: [],
      baseFieldVersions: {},
    });
    socket.send(JSON.stringify({ type: "push", changes: [removal] }));
    const result = ackOf(await nextMessage(socket));
    expect(result?.ok).toBe(true);

    expect(asProjectionPayload(await stub.getProjectionPayload(recordId))).toBeNull();
    // CRITICAL fix（レビュー指摘）: push 経路の delete も他の RPC 経路と同じく sweep を張って
    // outbox を排出しなければならない。「sent = 0 のまま残る」を正としていた旧アサーションは
    // バグ（排出されない）を固定してしまっていた ―― 実際に送出済み（sent = 1）で、未送出が
    // 0 件であることを固定する。
    expect(await stub.pendingOutbox()).toBe(0);
    await runInDurableObject(stub, async (_instance, state) => {
      const rows = state.storage.sql
        .exec<{ job_type: string; record_id: string }>(
          "SELECT job_type, record_id FROM outbox WHERE sent = 1 AND job_type = 'delete'",
        )
        .toArray();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ job_type: "delete", record_id: recordId });
    });

    socket.close(1000, "done");
  });

  it("keeps the outbox row and the sweep registration when the push path's queue send fails (Finding B)", async () => {
    const recordId = uuid(651);
    const written = asWriteResult(
      await stub.writeRecord("article", { recordId, input: validArticleInput() }, auth("admin")),
    );
    expect(written.ok).toBe(true);
    const published = asPublishResult(
      await stub.publishRecord(TENANT, TENANT, recordId, auth("admin")),
    );
    expect(published.ok).toBe(true);
    // publish 自身の drain で outbox は既に空。ただし正常系でもレジストリの掃除は sweeper の
    // 仕事なので、この時点ではまだ publish が張った登録が残っている（他のテストと同じ前提）。
    // ここを空にしておかないと、後で見る registry の行が push 由来なのか publish の残骸なのか
    // 区別できず、armSweep を呼ばなくても偶然パスしてしまう（Finding A と同じ穴）。
    expect(await stub.pendingOutbox()).toBe(0);
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    await runInDurableObject(stub, async (_instance, state) => {
      expect(await state.storage.getAlarm()).toBeNull();
    });

    // env は protected フィールドなので型だけ絞ったキャストでアクセスする
    // （@ts-expect-error や any は使わない）。以後この DO インスタンスの send は必ず失敗する。
    await runInDurableObject(stub, async (instance, _state) => {
      const priv = instance as unknown as { env: Env };
      priv.env = { ...priv.env, PROJECTION_QUEUE: failingQueue() };
    });

    const { socket } = await openSyncSocket(stub, socketAuth("editor-1"));
    await hello(socket);

    const removal = change({
      recordId,
      op: "delete",
      input: {},
      changedFields: [],
      baseFieldVersions: {},
    });
    socket.send(JSON.stringify({ type: "push", changes: [removal] }));
    const result = ackOf(await nextMessage(socket));
    // コミット自体は成功している（送出の失敗は ack に影響しない契約）
    expect(result?.ok).toBe(true);

    // (a) 送出に失敗した outbox 行は未送出のまま残る
    expect(await stub.pendingOutbox()).toBe(1);
    // (b) push 経路の armSweep が張った登録が生き残っている
    //     （これが無いと constructor の再アーム保険も見つけるものがなく、行が永遠に取り残される）
    await runInDurableObject(stub, async (_instance, state) => {
      const registry = state.storage.sql
        .exec<{ kind: string }>("SELECT kind FROM alarm_registry WHERE kind = ?", OUTBOX_SWEEP)
        .toArray();
      expect(registry).toHaveLength(1);
    });

    socket.close(1000, "done");
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
