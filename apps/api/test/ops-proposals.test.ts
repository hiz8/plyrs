import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { McpAuth } from "../src/do/authorize";
import { loadHistory } from "../src/do/history";
import { loadProposal } from "../src/do/proposals";
import type { RecordSnapshot } from "../src/do/types";
import {
  BOOKING_RESERVATION_KEY,
  BOOKING_RESOURCE_KEY,
  BOOKING_SLOT_KEY,
} from "../src/modules/booking/manifest";
import { articleType, auth, uuid, validArticleInput } from "./fixtures";
import { asInvokeResult, asPublicationState, asWriteResult } from "./rpc-unwrap";

// 16.8(M5c、決定 57): 提案(change set)の操作。proposal_create / list / get はエージェント(record:propose)、
// proposal_accept / reject は管理画面の人(record:write など)が invoke で呼ぶ

const TENANT = uuid(760);
const RECORD = uuid(761);
const SLUG = "props";

function freshStub() {
  return env.TENANT_DO.get(env.TENANT_DO.idFromName(crypto.randomUUID()));
}

const owner = { ...auth("owner", "owner"), tenantId: TENANT };
const editor = { ...auth("editor", "editor"), tenantId: TENANT };
const viewer = { ...auth("viewer", "viewer"), tenantId: TENANT };

function agent(overrides: Partial<McpAuth> = {}): McpAuth {
  return {
    userId: "agent",
    role: "editor",
    tenantId: TENANT,
    exp: Math.floor(Date.now() / 1000) + 3600,
    scopes: ["record:read", "record:propose"],
    tokenId: uuid(769),
    tokenKind: "pat",
    ...overrides,
  };
}

function output<T>(result: ReturnType<typeof asInvokeResult>): T {
  expect(result.ok, JSON.stringify(result)).toBe(true);
  if (!result.ok) throw new Error(result.message);
  return result.output as T;
}

interface ProposalOut {
  id: string;
  recordId: string;
  type: string;
  kind: string;
  state: string;
  changedFields: string[];
  status: string | null;
  baseVersion: number;
  currentVersion: number | null;
  stale: boolean;
  note: string | null;
  actor: string;
  via: string;
  tokenId: string | null;
  resolvedBy: string | null;
  resolutionNote: string | null;
  resultHistorySeq: number | null;
  input: Record<string, unknown> | null;
  fields: { key: string; before: unknown; after: unknown }[];
}

const updateInput = (proposalId = uuid(770)) => ({
  proposalId,
  kind: "update",
  recordId: RECORD,
  input: { title: "提案のタイトル", body: "## 見出し\n\n提案の本文" },
  note: "見出しを足した",
});

describe("提案の操作", () => {
  let stub: ReturnType<typeof freshStub>;

  beforeEach(async () => {
    stub = freshStub();
    expect((await stub.registerContentType(articleType(), owner)).ok).toBe(true);
    const written = asWriteResult(
      await stub.writeRecord("article", { recordId: RECORD, input: validArticleInput() }, owner),
    );
    expect(written.ok).toBe(true);
  });

  it("update の提案は open で、現在 → 提案の差分を持ち、record の version は進まない", async () => {
    const created = output<ProposalOut>(
      await stub.invoke("proposal_create", updateInput(), agent()),
    );
    expect(created).toMatchObject({
      id: uuid(770),
      kind: "update",
      state: "open",
      stale: false,
      baseVersion: 1,
      currentVersion: 1,
      note: "見出しを足した",
      actor: "agent",
      via: "mcp",
      tokenId: uuid(769),
      changedFields: ["title", "body"],
    });
    // Markdown は解決済みの具体値で持つ
    expect(created.input?.["body"]).toMatchObject({ doc: { type: "doc" } });
    expect(created.fields.map((f) => f.key)).toEqual(["body", "title"]);
    expect(created.fields.find((f) => f.key === "title")).toMatchObject({
      before: "こんにちは",
      after: "提案のタイトル",
    });
    const record = output<RecordSnapshot>(
      await stub.invoke("record_get", { recordId: RECORD }, agent()),
    );
    expect(record.version).toBe(1);
    expect(record.data["title"]).toBe("こんにちは");
  });

  it("採用は採用した人の actor・via rest で record を更新し、履歴の版に proposalId が付く", async () => {
    output<ProposalOut>(await stub.invoke("proposal_create", updateInput(), agent()));
    const accepted = output<{ proposal: ProposalOut; record: RecordSnapshot | null }>(
      await stub.invoke("proposal_accept", { proposalId: uuid(770) }, editor, { tenantSlug: SLUG }),
    );
    expect(accepted.proposal).toMatchObject({
      state: "accepted",
      resolvedBy: "editor",
      resultHistorySeq: expect.any(Number),
    });
    expect(accepted.record).toMatchObject({ version: 2, updatedBy: "editor" });
    expect(accepted.record?.data["title"]).toBe("提案のタイトル");
    await runInDurableObject(stub, (_instance, state) => {
      const head = loadHistory(state.storage.sql, RECORD, { limit: 1 }).items[0];
      expect(head).toMatchObject({
        historySeq: accepted.proposal.resultHistorySeq,
        actor: "editor",
        via: "rest",
        proposalId: uuid(770),
        changedFields: ["body", "title"],
      });
    });
  });

  it("提案の後に人が record を直すと stale になり、採用は提案のフィールドだけを上書きする(Review Focus 1)", async () => {
    output<ProposalOut>(
      await stub.invoke(
        "proposal_create",
        { ...updateInput(), input: { body: "## 見出し\n\n提案の本文" } },
        agent(),
      ),
    );
    const human = asWriteResult(
      await stub.writeRecord(
        "article",
        { recordId: RECORD, input: { ...validArticleInput(), title: "人が直した" } },
        owner,
      ),
    );
    expect(human.ok).toBe(true);
    const got = output<ProposalOut>(
      await stub.invoke("proposal_get", { proposalId: uuid(770) }, agent()),
    );
    expect(got).toMatchObject({ stale: true, baseVersion: 1, currentVersion: 2 });
    const accepted = output<{ proposal: ProposalOut; record: RecordSnapshot | null }>(
      await stub.invoke("proposal_accept", { proposalId: uuid(770) }, owner, { tenantSlug: SLUG }),
    );
    expect(accepted.record?.data["title"]).toBe("人が直した");
    expect(accepted.record?.data["body"]).toMatchObject({ doc: { type: "doc" } });
    expect(accepted.record?.version).toBe(3);
  });

  it("create の提案は採用で record を作る。先に同じ recordId の record ができていれば already_exists で open のまま(Review Focus 2)", async () => {
    const newId = uuid(771);
    const input = {
      proposalId: uuid(772),
      kind: "create",
      recordId: newId,
      type: "article",
      input: { ...validArticleInput(), slug: "proposed" },
      status: "in_review",
    };
    const created = output<ProposalOut>(await stub.invoke("proposal_create", input, agent()));
    expect(created).toMatchObject({ baseVersion: 0, currentVersion: null, stale: false });
    expect(created.fields.find((f) => f.key === "title")).toMatchObject({
      before: undefined,
      after: "こんにちは",
    });
    const accepted = output<{ proposal: ProposalOut; record: RecordSnapshot | null }>(
      await stub.invoke("proposal_accept", { proposalId: uuid(772) }, editor, { tenantSlug: SLUG }),
    );
    expect(accepted.record).toMatchObject({ id: newId, version: 1, status: "in_review" });

    // 別の create の提案の recordId で、人が先に record を作ってしまった
    const otherId = uuid(773);
    output<ProposalOut>(
      await stub.invoke(
        "proposal_create",
        {
          ...input,
          proposalId: uuid(774),
          recordId: otherId,
          input: { ...input.input, slug: "p2" },
        },
        agent(),
      ),
    );
    expect(
      asWriteResult(
        await stub.writeRecord(
          "article",
          { recordId: otherId, input: { ...validArticleInput(), slug: "human" } },
          owner,
        ),
      ).ok,
    ).toBe(true);
    const got = output<ProposalOut>(
      await stub.invoke("proposal_get", { proposalId: uuid(774) }, agent()),
    );
    expect(got).toMatchObject({ stale: true, currentVersion: 1 });
    const failed = asInvokeResult(
      await stub.invoke("proposal_accept", { proposalId: uuid(774) }, editor, { tenantSlug: SLUG }),
    );
    expect(failed).toMatchObject({ ok: false, code: "already_exists" });
    expect(
      output<ProposalOut>(await stub.invoke("proposal_get", { proposalId: uuid(774) }, agent()))
        .state,
    ).toBe("open");
  });

  it("delete の提案は editor が採用できる。publish は record:publish が要り、unpublish は公開中の record にしか出せない(Review Focus 3)", async () => {
    output<ProposalOut>(
      await stub.invoke(
        "proposal_create",
        { proposalId: uuid(775), kind: "publish", recordId: RECORD },
        agent(),
      ),
    );
    const forbidden = asInvokeResult(
      await stub.invoke("proposal_accept", { proposalId: uuid(775) }, viewer, { tenantSlug: SLUG }),
    );
    expect(forbidden).toMatchObject({ ok: false, code: "forbidden" });
    const published = output<{ proposal: ProposalOut; record: RecordSnapshot | null }>(
      await stub.invoke("proposal_accept", { proposalId: uuid(775) }, owner, { tenantSlug: SLUG }),
    );
    expect(published.proposal.state).toBe("accepted");
    expect(asPublicationState(await stub.getPublication(RECORD))).toMatchObject({
      published: true,
      publishedBy: "owner",
    });
    await runInDurableObject(stub, (_instance, state) => {
      const head = loadHistory(state.storage.sql, RECORD, { limit: 1 }).items[0];
      expect(head).toMatchObject({ kind: "publish", proposalId: uuid(775) });
    });

    const unpublishOk = output<ProposalOut>(
      await stub.invoke(
        "proposal_create",
        { proposalId: uuid(776), kind: "unpublish", recordId: RECORD },
        agent(),
      ),
    );
    expect(unpublishOk.state).toBe("open");

    output<ProposalOut>(
      await stub.invoke(
        "proposal_create",
        { proposalId: uuid(777), kind: "delete", recordId: RECORD },
        agent(),
      ),
    );
    const deleted = output<{ proposal: ProposalOut; record: RecordSnapshot | null }>(
      await stub.invoke("proposal_accept", { proposalId: uuid(777) }, editor, { tenantSlug: SLUG }),
    );
    expect(deleted.record?.deletedAt).not.toBeNull();

    // 削除で公開も下りた後の unpublish の提案は、公開中でないので出せない
    const notPublished = asInvokeResult(
      await stub.invoke(
        "proposal_create",
        { proposalId: uuid(778), kind: "unpublish", recordId: RECORD },
        agent(),
      ),
    );
    expect(notPublished).toMatchObject({ ok: false, code: "record_deleted" });
  });

  it("unpublish の提案は未公開の record には not_published", async () => {
    const result = asInvokeResult(
      await stub.invoke(
        "proposal_create",
        { proposalId: uuid(779), kind: "unpublish", recordId: RECORD },
        agent(),
      ),
    );
    expect(result).toMatchObject({ ok: false, code: "not_published" });
  });

  it("同じ proposalId の再送は同じ内容なら既存の行、違えば already_exists(Review Focus 4)", async () => {
    const first = output<ProposalOut>(await stub.invoke("proposal_create", updateInput(), agent()));
    const again = output<ProposalOut>(await stub.invoke("proposal_create", updateInput(), agent()));
    expect(again.id).toBe(first.id);
    const different = asInvokeResult(
      await stub.invoke(
        "proposal_create",
        { ...updateInput(), input: { ...updateInput().input, title: "別の" } },
        agent(),
      ),
    );
    expect(different).toMatchObject({ ok: false, code: "already_exists" });
    const otherNote = asInvokeResult(
      await stub.invoke("proposal_create", { ...updateInput(), note: "別の説明" }, agent()),
    );
    expect(otherNote).toMatchObject({ ok: false, code: "already_exists" });
    // 採用済みでも同じ内容の再送は同じ行を返す
    output(
      await stub.invoke("proposal_accept", { proposalId: uuid(770) }, owner, { tenantSlug: SLUG }),
    );
    const afterAccept = output<ProposalOut>(
      await stub.invoke("proposal_create", updateInput(), agent()),
    );
    expect(afterAccept).toMatchObject({ id: first.id, state: "accepted" });
  });

  it("処理済みの提案は再び採用・却下できず、却下の理由が残る", async () => {
    output<ProposalOut>(await stub.invoke("proposal_create", updateInput(), agent()));
    const rejected = output<{ proposal: ProposalOut }>(
      await stub.invoke(
        "proposal_reject",
        { proposalId: uuid(770), reason: "見出しは不要" },
        editor,
      ),
    );
    expect(rejected.proposal).toMatchObject({
      state: "rejected",
      resolvedBy: "editor",
      resolutionNote: "見出しは不要",
    });
    expect(
      asInvokeResult(await stub.invoke("proposal_reject", { proposalId: uuid(770) }, editor)),
    ).toMatchObject({ ok: false, code: "proposal_not_open" });
    expect(
      asInvokeResult(
        await stub.invoke("proposal_accept", { proposalId: uuid(770) }, editor, {
          tenantSlug: SLUG,
        }),
      ),
    ).toMatchObject({ ok: false, code: "proposal_not_open" });
    expect(
      asInvokeResult(await stub.invoke("proposal_get", { proposalId: uuid(700) }, agent())),
    ).toMatchObject({ ok: false, code: "not_found" });
  });

  it("proposal_list は新しい順で、state と recordId で絞れ、cursor で続きが取れる", async () => {
    const other = uuid(780);
    expect(
      asWriteResult(
        await stub.writeRecord(
          "article",
          { recordId: other, input: { ...validArticleInput(), slug: "other" } },
          owner,
        ),
      ).ok,
    ).toBe(true);
    for (const [n, recordId] of [
      [781, RECORD],
      [782, other],
      [783, RECORD],
    ] as const) {
      output(
        await stub.invoke(
          "proposal_create",
          { proposalId: uuid(n), kind: "update", recordId, input: { title: `t${n}` } },
          agent(),
        ),
      );
    }
    output(await stub.invoke("proposal_reject", { proposalId: uuid(782) }, editor));
    const all = output<{ items: ProposalOut[]; nextCursor: string | null }>(
      await stub.invoke("proposal_list", {}, agent()),
    );
    expect(all.items.map((p) => p.id)).toEqual([uuid(783), uuid(782), uuid(781)]);
    expect(all.nextCursor).toBeNull();
    const open = output<{ items: ProposalOut[]; nextCursor: string | null }>(
      await stub.invoke("proposal_list", { state: "open", limit: 1 }, agent()),
    );
    expect(open.items.map((p) => p.id)).toEqual([uuid(783)]);
    expect(open.nextCursor).toBe(uuid(783));
    const next = output<{ items: ProposalOut[]; nextCursor: string | null }>(
      await stub.invoke(
        "proposal_list",
        { state: "open", limit: 1, cursor: open.nextCursor },
        agent(),
      ),
    );
    expect(next.items.map((p) => p.id)).toEqual([uuid(781)]);
    const byRecord = output<{ items: ProposalOut[] }>(
      await stub.invoke("proposal_list", { recordId: other }, agent()),
    );
    expect(byRecord.items.map((p) => p.id)).toEqual([uuid(782)]);
  });

  it("スコープ: record:read だけでは提案できず、record:propose だけでは採用できない", async () => {
    expect(
      asInvokeResult(
        await stub.invoke("proposal_create", updateInput(), agent({ scopes: ["record:read"] })),
      ),
    ).toMatchObject({ ok: false, code: "insufficient_scope" });
    output(await stub.invoke("proposal_create", updateInput(), agent()));
    expect(
      asInvokeResult(
        await stub.invoke("proposal_accept", { proposalId: uuid(770) }, agent(), {
          tenantSlug: SLUG,
        }),
      ),
    ).toMatchObject({ ok: false, code: "insufficient_scope" });
    // 入力の不足: update に input が無い、create に type が無い
    expect(
      asInvokeResult(
        await stub.invoke(
          "proposal_create",
          { proposalId: uuid(784), kind: "update", recordId: RECORD },
          agent(),
        ),
      ),
    ).toMatchObject({ ok: false, code: "invalid_input" });
    expect(
      asInvokeResult(
        await stub.invoke(
          "proposal_create",
          { proposalId: uuid(785), kind: "create", recordId: uuid(786), input: {} },
          agent(),
        ),
      ),
    ).toMatchObject({ ok: false, code: "invalid_input" });
    // 検証に通らない提案は作れない(必須の authors を外す)
    expect(
      asInvokeResult(
        await stub.invoke(
          "proposal_create",
          {
            proposalId: uuid(787),
            kind: "create",
            recordId: uuid(788),
            type: "article",
            input: { title: "x" },
          },
          agent(),
        ),
      ),
    ).toMatchObject({ ok: false, code: "validation_failed" });
  });

  it("モジュール型(booking.reservation)への editor の提案はモジュールのガードで拒否される", async () => {
    await stub.enableModule(TENANT, "booking", owner);
    await stub.writeRecord(
      BOOKING_RESOURCE_KEY,
      { recordId: uuid(790), input: { name: "会議室" } },
      owner,
    );
    await stub.writeRecord(
      BOOKING_SLOT_KEY,
      {
        recordId: uuid(791),
        input: {
          resource: { type: BOOKING_RESOURCE_KEY, id: uuid(790) },
          starts_at: "2026-08-01T10:00:00Z",
          ends_at: "2026-08-01T11:00:00Z",
          capacity: 1,
        },
      },
      owner,
    );
    const result = asInvokeResult(
      await stub.invoke(
        "proposal_create",
        {
          proposalId: uuid(792),
          kind: "create",
          type: BOOKING_RESERVATION_KEY,
          recordId: uuid(793),
          input: {
            slot: { type: BOOKING_SLOT_KEY, id: uuid(791) },
            name: "予約者",
            email: "r@example.com",
            state: "pending",
          },
        },
        agent(),
      ),
    );
    expect(result).toMatchObject({ ok: false, code: "forbidden" });
  });

  it("採用・却下から 90 日過ぎた行は次の proposal_create のついでに消え、open の行は残る", async () => {
    output(await stub.invoke("proposal_create", updateInput(uuid(794)), agent()));
    output(await stub.invoke("proposal_reject", { proposalId: uuid(794) }, editor));
    output(await stub.invoke("proposal_create", updateInput(uuid(795)), agent()));
    const old = new Date(Date.now() - 91 * 24 * 60 * 60_000).toISOString();
    await runInDurableObject(stub, (_instance, state) => {
      state.storage.sql.exec("UPDATE proposals SET resolved_at = ? WHERE id = ?", old, uuid(794));
    });
    output(await stub.invoke("proposal_create", updateInput(uuid(796)), agent()));
    await runInDurableObject(stub, (_instance, state) => {
      expect(loadProposal(state.storage.sql, uuid(794))).toBeNull();
      expect(loadProposal(state.storage.sql, uuid(795))?.state).toBe("open");
    });
  });
});
