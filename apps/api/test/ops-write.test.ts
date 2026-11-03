import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { McpAuth } from "../src/do/authorize";
import { loadHistory } from "../src/do/history";
import {
  BOOKING_RESERVATION_KEY,
  BOOKING_RESOURCE_KEY,
  BOOKING_SLOT_KEY,
} from "../src/modules/booking/manifest";
import type { RecordSnapshot } from "../src/do/types";
import { articleType, auth, uuid, validArticleInput } from "./fixtures";
import { asInvokeResult, asPublicationState } from "./rpc-unwrap";
import { nextMessage, nextMessages, openSyncSocket } from "./ws-helpers";

// 16.4 / 16.6 / 16.7(M2-7a): 書き込み操作(record_create / update / delete / publish / unpublish)

const TENANT = uuid(740);
const RECORD = uuid(741);

function freshStub() {
  return env.TENANT_DO.get(env.TENANT_DO.idFromName(crypto.randomUUID()));
}

const owner = { ...auth("owner", "owner"), tenantId: TENANT };

function mcpAuth(overrides: Partial<McpAuth> = {}): McpAuth {
  return {
    userId: "agent",
    role: "editor",
    tenantId: TENANT,
    exp: Math.floor(Date.now() / 1000) + 3600,
    scopes: ["record:read", "record:write", "record:publish", "record:delete"],
    tokenId: uuid(749),
    tokenKind: "pat",
    ...overrides,
  };
}

const createInput = () => ({ type: "article", recordId: RECORD, input: validArticleInput() });

function output<T>(result: ReturnType<typeof asInvokeResult>): T {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.message);
  return result.output as T;
}

describe("書き込み操作", () => {
  let stub: ReturnType<typeof freshStub>;

  beforeEach(async () => {
    stub = freshStub();
    expect((await stub.registerContentType(articleType(), owner)).ok).toBe(true);
  });

  it("record_create は作成し、同じ内容の再送は同じ snapshot、内容が違えば already_exists", async () => {
    const created = output<RecordSnapshot>(
      await stub.invoke("record_create", createInput(), mcpAuth()),
    );
    expect(created).toMatchObject({ id: RECORD, version: 1, status: "draft" });
    const again = output<RecordSnapshot>(
      await stub.invoke("record_create", createInput(), mcpAuth()),
    );
    expect(again.version).toBe(1);
    const different = asInvokeResult(
      await stub.invoke(
        "record_create",
        { ...createInput(), input: { ...validArticleInput(), title: "違う" } },
        mcpAuth(),
      ),
    );
    expect(different).toMatchObject({ ok: false, code: "already_exists" });
    // 履歴には MCP 経路の版が 1 つ(再送は書かない)
    await runInDurableObject(stub, (_instance, state) => {
      const items = loadHistory(state.storage.sql, RECORD, { limit: 10 }).items;
      expect(items.map((i) => [i.via, i.tokenId, i.actor])).toEqual([["mcp", uuid(749), "agent"]]);
    });
  });

  it("record_update は strict で判定し、古い baseFieldVersions は conflict に現在値を添える", async () => {
    const created = output<RecordSnapshot>(
      await stub.invoke("record_create", createInput(), mcpAuth()),
    );
    // 人が管理画面(REST 相当の RPC)で title を直す → title の版が 2 になる
    await stub.writeRecord(
      "article",
      { recordId: RECORD, input: { ...validArticleInput(), title: "人が直した" } },
      owner,
    );
    const stale = asInvokeResult(
      await stub.invoke(
        "record_update",
        {
          recordId: RECORD,
          input: { title: "エージェント" },
          baseFieldVersions: created.fieldVersions,
        },
        mcpAuth(),
      ),
    );
    expect(stale).toMatchObject({ ok: false, code: "conflict" });
    if (stale.ok) return;
    const details = stale.details as { conflicts: unknown[]; current: RecordSnapshot };
    expect(details.conflicts).toEqual([{ fieldKey: "title", baseVersion: 1, currentVersion: 2 }]);
    expect(details.current.data["title"]).toBe("人が直した");
    expect(details.current.fieldVersions["title"]).toBe(2);
    // baseFieldVersions の欠け(0 と見る)も conflict
    const missing = asInvokeResult(
      await stub.invoke(
        "record_update",
        { recordId: RECORD, input: { title: "x" }, baseFieldVersions: {} },
        mcpAuth(),
      ),
    );
    expect(missing).toMatchObject({ ok: false, code: "conflict" });
    // 現在の fieldVersions で再適用すると通り、title の版が上がる
    const fresh = output<RecordSnapshot>(
      await stub.invoke(
        "record_update",
        {
          recordId: RECORD,
          input: { title: "再適用" },
          baseFieldVersions: details.current.fieldVersions,
        },
        mcpAuth(),
      ),
    );
    expect(fresh.fieldVersions["title"]).toBe(3);
    expect(fresh.data["title"]).toBe("再適用");
    // 他のフィールド(slug・relation)は現在値が保たれる(マージ)
    expect(fresh.data["slug"]).toBe(validArticleInput()["slug"]);
  });

  it("Markdown で作った record の同じ内容の再送は既存を返し、ブロック操作で 1 段落だけ差し替えられる(M4-1a)", async () => {
    const markdownInput = () => ({
      ...createInput(),
      input: { ...validArticleInput(), body: "## 見出し\n\n一段落目\n\n二段落目" },
    });
    const created = output<RecordSnapshot>(
      await stub.invoke("record_create", markdownInput(), mcpAuth()),
    );
    const again = output<RecordSnapshot>(
      await stub.invoke("record_create", markdownInput(), mcpAuth()),
    );
    expect(again.version).toBe(created.version);
    const body = created.data["body"] as { doc: { content: { attrs: { id: string } }[] } };
    const secondId = body.doc.content[1]!.attrs.id;
    const updated = output<RecordSnapshot>(
      await stub.invoke(
        "record_update",
        {
          recordId: RECORD,
          input: { body: { blocks: [{ op: "replace", id: secondId, markdown: "差し替えた" }] } },
          baseFieldVersions: created.fieldVersions,
        },
        mcpAuth(),
      ),
    );
    const blocks = (updated.data["body"] as { doc: { content: unknown[] } }).doc.content;
    expect(JSON.stringify(blocks[1])).toContain("差し替えた");
    expect(JSON.stringify(blocks[1])).toContain(secondId);
    expect(JSON.stringify(blocks[2])).toContain("二段落目");
  });

  it("Markdown の javascript: / data: のリンクは書き込めない(validate-on-write で拒否)", async () => {
    for (const href of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html,x"]) {
      const result = asInvokeResult(
        await stub.invoke(
          "record_create",
          { ...createInput(), input: { ...validArticleInput(), body: `[x](${href})` } },
          mcpAuth(),
        ),
      );
      expect(result.ok, href).toBe(false);
      expect(result.ok ? "" : result.code).toBe("validation_failed");
    }
  });

  it("古い baseFieldVersions のブロック操作は、消されたブロックを指していても block_not_found ではなく conflict(Review Focus 1)", async () => {
    const created = output<RecordSnapshot>(
      await stub.invoke(
        "record_create",
        { ...createInput(), input: { ...validArticleInput(), body: "一\n\n二" } },
        mcpAuth(),
      ),
    );
    const body = created.data["body"] as { doc: { content: { attrs: { id: string } }[] } };
    const secondId = body.doc.content[1]!.attrs.id;
    // 人が二段落目を消す
    await stub.writeRecord(
      "article",
      {
        recordId: RECORD,
        input: {
          ...validArticleInput(),
          body: {
            ...(created.data["body"] as object),
            doc: { type: "doc", content: [body.doc.content[0]] },
          },
        },
      },
      owner,
    );
    const stale = asInvokeResult(
      await stub.invoke(
        "record_update",
        {
          recordId: RECORD,
          input: { body: { blocks: [{ op: "replace", id: secondId, markdown: "x" }] } },
          baseFieldVersions: created.fieldVersions,
        },
        mcpAuth(),
      ),
    );
    expect(stale).toMatchObject({ ok: false, code: "conflict" });
  });

  it("空の many-relation [] で作った record の同じ内容の再送は already_exists にならない(ロードマップ 9 章)", async () => {
    const withRelated = {
      ...articleType(),
      id: uuid(760),
      key: "note",
      fields: [
        { key: "title", type: "text" as const, required: true },
        {
          key: "related",
          type: "relation" as const,
          config: { allowedTypes: ["article"], cardinality: "many" as const },
        },
      ],
    };
    expect((await stub.registerContentType(withRelated, owner)).ok).toBe(true);
    const input = { type: "note", recordId: uuid(761), input: { title: "t", related: [] } };
    output<RecordSnapshot>(await stub.invoke("record_create", input, mcpAuth()));
    const again = asInvokeResult(await stub.invoke("record_create", input, mcpAuth()));
    expect(again.ok).toBe(true);
  });

  it("record_update は無い record を not_found、削除済みを record_deleted にする", async () => {
    const missing = asInvokeResult(
      await stub.invoke(
        "record_update",
        { recordId: uuid(799), input: {}, baseFieldVersions: {} },
        mcpAuth(),
      ),
    );
    expect(missing).toMatchObject({ ok: false, code: "not_found" });
    output(await stub.invoke("record_create", createInput(), mcpAuth()));
    output(await stub.invoke("record_delete", { recordId: RECORD }, mcpAuth()));
    const deleted = asInvokeResult(
      await stub.invoke(
        "record_update",
        { recordId: RECORD, input: {}, baseFieldVersions: {} },
        mcpAuth(),
      ),
    );
    expect(deleted).toMatchObject({ ok: false, code: "record_deleted" });
  });

  it("record_delete は冪等(2 回目も ok で同じ deletedAt)", async () => {
    output(await stub.invoke("record_create", createInput(), mcpAuth()));
    const first = output<{ recordId: string; deletedAt: string }>(
      await stub.invoke("record_delete", { recordId: RECORD }, mcpAuth()),
    );
    const second = output<{ recordId: string; deletedAt: string }>(
      await stub.invoke("record_delete", { recordId: RECORD }, mcpAuth()),
    );
    expect(second).toEqual(first);
  });

  it("expect(確認時の版と history_seq)が今と違えば publish / unpublish は record_changed で何もしない(16.8)", async () => {
    output(await stub.invoke("record_create", createInput(), mcpAuth()));
    // 作成で history_seq 1
    const draft = { version: 1, historySeq: 1 };
    const stale = asInvokeResult(
      await stub.invoke("record_publish", { recordId: RECORD }, mcpAuth(), {
        tenantSlug: "t",
        expect: { ...draft, version: 0 },
      }),
    );
    expect(stale).toMatchObject({ ok: false, code: "record_changed" });
    expect(asPublicationState(await stub.getPublication(RECORD)).published).toBe(false);
    output(
      await stub.invoke("record_publish", { recordId: RECORD }, mcpAuth(), {
        tenantSlug: "t",
        expect: draft,
      }),
    );
    // 公開 → 取り下げで版も公開状態も元に戻るが、history_seq は進むので同じ確認は使い回せない
    output(await stub.invoke("record_unpublish", { recordId: RECORD }, mcpAuth()));
    const reused = asInvokeResult(
      await stub.invoke("record_publish", { recordId: RECORD }, mcpAuth(), {
        tenantSlug: "t",
        expect: draft,
      }),
    );
    expect(reused).toMatchObject({ ok: false, code: "record_changed" });
    expect(asPublicationState(await stub.getPublication(RECORD)).published).toBe(false);
    output(
      await stub.invoke("record_publish", { recordId: RECORD }, mcpAuth(), { tenantSlug: "t" }),
    );
    const unpublishStale = asInvokeResult(
      await stub.invoke("record_unpublish", { recordId: RECORD }, mcpAuth(), { expect: draft }),
    );
    expect(unpublishStale).toMatchObject({ ok: false, code: "record_changed" });
    expect(asPublicationState(await stub.getPublication(RECORD)).published).toBe(true);
  });

  it("record_publish は outbox に積み、同じ版の再 publish は何も書かない。unpublish の未公開は ok", async () => {
    output(await stub.invoke("record_create", createInput(), mcpAuth()));
    const none = output<{ sourceVersion: number | null }>(
      await stub.invoke("record_unpublish", { recordId: RECORD }, mcpAuth()),
    );
    expect(none.sourceVersion).toBeNull();
    const published = output<{ sourceVersion: number; publishedAt: string }>(
      await stub.invoke("record_publish", { recordId: RECORD }, mcpAuth(), { tenantSlug: "t" }),
    );
    expect(published.sourceVersion).toBe(1);
    const state = asPublicationState(await stub.getPublication(RECORD));
    expect(state.published).toBe(true);
    const again = output<{ sourceVersion: number; publishedAt: string }>(
      await stub.invoke("record_publish", { recordId: RECORD }, mcpAuth(), { tenantSlug: "t" }),
    );
    expect(again).toEqual(published);
    await runInDurableObject(stub, (_instance, state2) => {
      const rows = state2.storage.sql
        .exec<{ n: number }>("SELECT COUNT(*) AS n FROM outbox WHERE record_id = ?", RECORD)
        .one();
      expect(rows.n).toBe(1); // 再 publish で増えない
      const items = loadHistory(state2.storage.sql, RECORD, { limit: 10 }).items;
      expect(items.map((i) => i.kind)).toEqual(["publish", "write"]);
    });
    const unpublished = output<{ sourceVersion: number | null }>(
      await stub.invoke("record_unpublish", { recordId: RECORD }, mcpAuth()),
    );
    expect(unpublished.sourceVersion).toBe(1);
  });

  it("record_update の status 変更は現在の fieldVersions を全部見ていなければ conflict(人の直前の判断を黙って戻さない)", async () => {
    const created = output<RecordSnapshot>(
      await stub.invoke("record_create", createInput(), mcpAuth()),
    );
    // 人が管理画面で状態を進める(REST 相当)
    const human = asInvokeResult(
      await stub.invoke(
        "record_update",
        {
          recordId: RECORD,
          input: { title: "人が直した" },
          changedFields: ["title"],
          baseFieldVersions: created.fieldVersions,
          status: "in_review",
        },
        { ...auth("editor", "editor"), tenantId: TENANT },
      ),
    );
    expect(human.ok).toBe(true);
    // エージェントは古い fieldVersions のまま status だけ戻そうとする → conflict
    const stale = asInvokeResult(
      await stub.invoke(
        "record_update",
        {
          recordId: RECORD,
          input: {},
          changedFields: [],
          baseFieldVersions: created.fieldVersions,
          status: "draft",
        },
        mcpAuth(),
      ),
    );
    expect(stale).toMatchObject({ ok: false, code: "conflict" });
    expect(!stale.ok && (stale.details as { conflicts: { fieldKey: string }[] }).conflicts).toEqual(
      expect.arrayContaining([expect.objectContaining({ fieldKey: "title" })]),
    );
    // 現在の fieldVersions を見ていれば status だけの変更も通る
    const current = output<RecordSnapshot>(
      await stub.invoke("record_get", { recordId: RECORD }, mcpAuth()),
    );
    const fresh = output<RecordSnapshot>(
      await stub.invoke(
        "record_update",
        {
          recordId: RECORD,
          input: {},
          changedFields: [],
          baseFieldVersions: current.fieldVersions,
          status: "draft",
        },
        mcpAuth(),
      ),
    );
    expect(fresh.status).toBe("draft");
  });

  it("公開中 record の record_delete / record_unpublish は outbox に取り下げを積む(Review Focus 4)", async () => {
    const outboxCount = () =>
      runInDurableObject(
        stub,
        (_instance, state) =>
          state.storage.sql
            .exec<{ n: number }>("SELECT COUNT(*) AS n FROM outbox WHERE record_id = ?", RECORD)
            .one().n,
      );
    output(await stub.invoke("record_create", createInput(), mcpAuth()));
    output(
      await stub.invoke("record_publish", { recordId: RECORD }, mcpAuth(), { tenantSlug: "t" }),
    );
    expect(await outboxCount()).toBe(1);
    output(await stub.invoke("record_unpublish", { recordId: RECORD }, mcpAuth()));
    expect(await outboxCount()).toBe(2);
    expect(asPublicationState(await stub.getPublication(RECORD)).published).toBe(false);
    output(
      await stub.invoke("record_publish", { recordId: RECORD }, mcpAuth(), { tenantSlug: "t" }),
    );
    expect(await outboxCount()).toBe(3);
    output(await stub.invoke("record_delete", { recordId: RECORD }, mcpAuth()));
    expect(await outboxCount()).toBe(4);
    expect(asPublicationState(await stub.getPublication(RECORD)).published).toBe(false);
  });

  it("record:write だけのスコープで publish は insufficient_scope", async () => {
    output(await stub.invoke("record_create", createInput(), mcpAuth()));
    const result = asInvokeResult(
      await stub.invoke(
        "record_publish",
        { recordId: RECORD },
        mcpAuth({ scopes: ["record:write"] }),
        { tenantSlug: "t" },
      ),
    );
    expect(result).toMatchObject({ ok: false, code: "insufficient_scope" });
  });

  it("接続中の同期ソケットに create / update / delete の change が届く", async () => {
    const { socket } = await openSyncSocket(stub, {
      userId: "watcher",
      role: "editor",
      tenantId: TENANT,
      exp: Math.floor(Date.now() / 1000) + 900,
    });
    socket.send(JSON.stringify({ type: "hello", checkpoint: 0 }));
    await nextMessages(socket, 2);
    let pending = nextMessage(socket);
    const created = output<RecordSnapshot>(
      await stub.invoke("record_create", createInput(), mcpAuth()),
    );
    let message = await pending;
    expect(message.type).toBe("change");
    if (message.type === "change") expect(message.record.id).toBe(RECORD);
    pending = nextMessage(socket);
    output(
      await stub.invoke(
        "record_update",
        { recordId: RECORD, input: { title: "更新" }, baseFieldVersions: created.fieldVersions },
        mcpAuth(),
      ),
    );
    message = await pending;
    if (message.type === "change") expect(message.record.input["title"]).toBe("更新");
    pending = nextMessage(socket);
    output(await stub.invoke("record_delete", { recordId: RECORD }, mcpAuth()));
    message = await pending;
    if (message.type === "change") expect(message.record.deletedAt).not.toBeNull();
    socket.close();
  });

  it("モジュール型(booking.reservation)を editor が書くとモジュールのガードで拒否される", async () => {
    await stub.enableModule(TENANT, "booking", owner);
    await stub.writeRecord(
      BOOKING_RESOURCE_KEY,
      { recordId: uuid(500), input: { name: "会議室" } },
      owner,
    );
    await stub.writeRecord(
      BOOKING_SLOT_KEY,
      {
        recordId: uuid(501),
        input: {
          resource: { type: BOOKING_RESOURCE_KEY, id: uuid(500) },
          starts_at: "2026-08-01T10:00:00Z",
          ends_at: "2026-08-01T11:00:00Z",
          capacity: 1,
        },
      },
      owner,
    );
    const result = asInvokeResult(
      await stub.invoke(
        "record_create",
        {
          type: BOOKING_RESERVATION_KEY,
          recordId: uuid(600),
          input: {
            slot: { type: BOOKING_SLOT_KEY, id: uuid(501) },
            name: "予約者",
            email: "r@example.com",
            state: "pending",
          },
        },
        mcpAuth({ role: "editor" }),
      ),
    );
    expect(result).toMatchObject({ ok: false, code: "forbidden" });
  });
});
