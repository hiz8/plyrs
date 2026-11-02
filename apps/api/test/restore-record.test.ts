import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { loadHistory } from "../src/do/history";
import { articleType, auth, uuid, validArticleInput } from "./fixtures";
import { asDeleteResult, asInvokeResult, asRecordSnapshot, asWriteResult } from "./rpc-unwrap";
import { nextMessage, nextMessages, openSyncSocket } from "./ws-helpers";

// 16.5(M2-4): record_restore。履歴の版を writeRecord に通して現在にする(削除の取り消しを含む)

const TENANT = uuid(720);
const RECORD = uuid(721);

function freshStub() {
  return env.TENANT_DO.get(env.TENANT_DO.idFromName(crypto.randomUUID()));
}

const owner = { ...auth("owner", "owner"), tenantId: TENANT };

describe("record_restore", () => {
  let stub: ReturnType<typeof freshStub>;

  beforeEach(async () => {
    stub = freshStub();
    expect((await stub.registerContentType(articleType(), owner)).ok).toBe(true);
    // 版 1(owner)→ 版 2(editor が改題・in_review)→ 版 3(owner が再改題)
    expect(
      asWriteResult(
        await stub.writeRecord("article", { recordId: RECORD, input: validArticleInput() }, owner),
      ).ok,
    ).toBe(true);
    expect(
      asWriteResult(
        await stub.writeRecord(
          "article",
          {
            recordId: RECORD,
            input: { ...validArticleInput(), title: "二版" },
            status: "in_review",
          },
          { ...auth("editor", "editor"), tenantId: TENANT },
        ),
      ).ok,
    ).toBe(true);
    expect(
      asWriteResult(
        await stub.writeRecord(
          "article",
          { recordId: RECORD, input: { ...validArticleInput(), title: "三版" } },
          owner,
        ),
      ).ok,
    ).toBe(true);
  });

  it("版 2 を restore すると data / status がその版になり、restored_from = 2 の restore 版が増える", async () => {
    const result = asInvokeResult(
      await stub.invoke("record_restore", { recordId: RECORD, historySeq: 2 }, owner),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output).toMatchObject({ id: RECORD, version: 4, status: "in_review" });
    expect((result.output as { data: Record<string, unknown> }).data["title"]).toBe("二版");
    // relation フィールドも版から戻る(履歴の data は input 形式)
    const current = asRecordSnapshot(await stub.getRecord(RECORD));
    expect(current?.data["title"]).toBe("二版");
    await runInDurableObject(stub, (_instance, state) => {
      const items = loadHistory(state.storage.sql, RECORD, { limit: 10 }).items;
      expect(items[0]).toMatchObject({
        kind: "restore",
        restoredFrom: 2,
        version: 4,
        actor: "owner",
        via: "rest",
      });
      expect(items).toHaveLength(4);
      const rels = state.storage.sql
        .exec<{ target_id: string }>(
          "SELECT target_id FROM relations WHERE source_id = ? AND source_field = 'authors' ORDER BY ordinal",
          RECORD,
        )
        .toArray();
      expect(rels.map((r) => r.target_id)).toEqual([uuid(2), uuid(3)]);
    });
  });

  it("削除済み record の restore で deleted_at が NULL に戻り、同期の change が届く", async () => {
    expect(asDeleteResult(await stub.deleteRecord(RECORD, owner)).ok).toBe(true);
    const { socket } = await openSyncSocket(stub, {
      userId: "watcher",
      role: "editor",
      tenantId: TENANT,
      exp: Math.floor(Date.now() / 1000) + 900,
    });
    socket.send(JSON.stringify({ type: "hello", checkpoint: 0 }));
    await nextMessages(socket, 2);
    const pending = nextMessage(socket);
    const result = asInvokeResult(
      await stub.invoke("record_restore", { recordId: RECORD, historySeq: 3 }, owner),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output).toMatchObject({ id: RECORD, deletedAt: null });
    const message = await pending;
    expect(message.type).toBe("change");
    if (message.type === "change") {
      expect(message.record.id).toBe(RECORD);
      expect(message.record.deletedAt).toBeNull();
      expect(message.record.input["title"]).toBe("三版");
    }
    const current = asRecordSnapshot(await stub.getRecord(RECORD));
    expect(current?.deletedAt).toBeNull();
    socket.close();
  });

  it("型定義から外れた値の版は validation_failed で、削除済みなら削除のまま", async () => {
    // slug を必須のまま、title を無くす型に差し替える → 版 1〜3 は title を持つが、新しい必須項目が無い
    const changed = {
      ...articleType(),
      version: 2,
      fields: [...articleType().fields, { key: "subtitle", type: "text", required: true }],
    };
    expect((await stub.registerContentType(changed, owner)).ok).toBe(true);
    expect(asDeleteResult(await stub.deleteRecord(RECORD, owner)).ok).toBe(true);
    const result = asInvokeResult(
      await stub.invoke("record_restore", { recordId: RECORD, historySeq: 1 }, owner),
    );
    expect(result).toMatchObject({ ok: false, code: "validation_failed" });
    const current = asRecordSnapshot(await stub.getRecord(RECORD));
    expect(current?.deletedAt).not.toBeNull();
  });

  it("無い版は not_found", async () => {
    const result = asInvokeResult(
      await stub.invoke("record_restore", { recordId: RECORD, historySeq: 99 }, owner),
    );
    expect(result).toMatchObject({ ok: false, code: "not_found" });
  });
});
