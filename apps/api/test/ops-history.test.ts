import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import type { McpAuth } from "../src/do/authorize";
import { articleType, auth, uuid, validArticleInput } from "./fixtures";
import { asInvokeResult, asPublishResult, asWriteResult } from "./rpc-unwrap";

// 16.5(M2-4): record_history / record_compare / record_restore の invoke 経路

const TENANT = uuid(730);
const RECORD = uuid(731);

const stub = env.TENANT_DO.get(env.TENANT_DO.idFromName(TENANT));
const owner = { ...auth("owner", "owner"), tenantId: TENANT };

function mcpAuth(overrides: Partial<McpAuth> = {}): McpAuth {
  return {
    userId: "agent",
    role: "editor",
    tenantId: TENANT,
    exp: Math.floor(Date.now() / 1000) + 3600,
    scopes: ["record:read"],
    tokenId: uuid(739),
    tokenKind: "pat",
    ...overrides,
  };
}

async function write(input: Record<string, unknown>, who = owner) {
  const result = asWriteResult(await stub.writeRecord("article", { recordId: RECORD, input }, who));
  expect(result.ok).toBe(true);
}

beforeAll(async () => {
  expect((await stub.registerContentType(articleType(), owner)).ok).toBe(true);
  await write(validArticleInput()); // 版 1(owner)
  await write(
    { ...validArticleInput(), title: "二版" },
    { ...auth("editor", "editor"), tenantId: TENANT },
  ); // 版 2
  expect(asPublishResult(await stub.publishRecord(TENANT, TENANT, RECORD, owner)).ok).toBe(true); // 版 3 publish
  await write({ ...validArticleInput(), title: "三版", slug: "third" }); // 版 4(owner)
});

describe("record_history", () => {
  it("新しい順に返し、cursor で続きを取れる", async () => {
    const first = asInvokeResult(
      await stub.invoke("record_history", { recordId: RECORD, limit: 2 }, mcpAuth()),
    );
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const page = first.output as {
      items: { historySeq: number; kind: string; via: string }[];
      nextCursor: string;
    };
    expect(page.items.map((i) => [i.historySeq, i.kind])).toEqual([
      [4, "write"],
      [3, "publish"],
    ]);
    expect(page.items[0]?.via).toBe("rest");
    const second = asInvokeResult(
      await stub.invoke(
        "record_history",
        { recordId: RECORD, limit: 2, cursor: page.nextCursor },
        mcpAuth(),
      ),
    );
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    const rest = second.output as { items: { historySeq: number }[]; nextCursor: string | null };
    expect(rest.items.map((i) => i.historySeq)).toEqual([2, 1]);
    // ページが limit ちょうどなら cursor を返す(続きが空かはもう 1 回で分かる。record_list と同じ方式)
    expect(rest.nextCursor).toBe("1");
    const last = asInvokeResult(
      await stub.invoke(
        "record_history",
        { recordId: RECORD, limit: 2, cursor: rest.nextCursor },
        mcpAuth(),
      ),
    );
    expect(last.ok && last.output).toEqual({ items: [], nextCursor: null });
  });

  it("無い record は not_found", async () => {
    const result = asInvokeResult(
      await stub.invoke("record_history", { recordId: uuid(799) }, mcpAuth()),
    );
    expect(result).toMatchObject({ ok: false, code: "not_found" });
  });
});

describe("record_compare", () => {
  it("published と現在の差分(title と slug)", async () => {
    const result = asInvokeResult(
      await stub.invoke("record_compare", { recordId: RECORD, from: "published" }, mcpAuth()),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output).toMatchObject({
      from: { ref: "published", sourceVersion: 2 },
      to: { ref: "current", version: 3 },
      fields: [
        { key: "slug", before: validArticleInput()["slug"], after: "third" },
        { key: "title", before: "二版", after: "三版" },
      ],
    });
  });

  it("版 1 と版 3(publish 版 = 版 2 の内容)の差分は title だけ。relation は input 形式で比べるので差分に出ない", async () => {
    const result = asInvokeResult(
      await stub.invoke("record_compare", { recordId: RECORD, from: 1, to: 3 }, mcpAuth()),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output).toMatchObject({
      from: { ref: "history", historySeq: 1, version: 1 },
      to: { ref: "history", historySeq: 3, version: 2 },
      fields: [{ key: "title", before: validArticleInput()["title"], after: "二版" }],
    });
  });

  it("未公開の record の published は not_published", async () => {
    const other = uuid(732);
    expect(
      asWriteResult(
        await stub.writeRecord(
          "article",
          { recordId: other, input: { ...validArticleInput(), slug: "other" } },
          owner,
        ),
      ).ok,
    ).toBe(true);
    const result = asInvokeResult(
      await stub.invoke("record_compare", { recordId: other, from: "published" }, mcpAuth()),
    );
    expect(result).toMatchObject({ ok: false, code: "not_published" });
  });
});

describe("record_restore の権限", () => {
  it("record:read だけのスコープでは insufficient_scope", async () => {
    const result = asInvokeResult(
      await stub.invoke("record_restore", { recordId: RECORD, historySeq: 1 }, mcpAuth()),
    );
    expect(result).toMatchObject({ ok: false, code: "insufficient_scope" });
  });

  it("viewer のロールでは forbidden(スコープがあっても増えない)", async () => {
    const result = asInvokeResult(
      await stub.invoke(
        "record_restore",
        { recordId: RECORD, historySeq: 1 },
        mcpAuth({ role: "viewer", scopes: ["record:read", "record:write"] }),
      ),
    );
    expect(result).toMatchObject({ ok: false, code: "forbidden" });
  });
});
