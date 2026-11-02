import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import type { McpAuth } from "../src/do/authorize";
import { ensureSearchIndex, reindexAll, searchRecords, searchText } from "../src/do/search";
import { articleType, auth, uuid, validArticleInput } from "./fixtures";
import {
  asDeleteResult,
  asInvokeResult,
  asReindexResult,
  asRegisterResult,
  asWriteResult,
} from "./rpc-unwrap";

// 16.9(M2-9): 下書きを含む全文検索。FTS5(trigram)の索引を書き込み・削除・復元で保ち、
// record_search から読む。公開側(公開用 DB)の全文検索は引き続き非目標。

const TENANT = uuid(760);
const FIRST = uuid(761);
const SECOND = uuid(762);
const stub = env.TENANT_DO.get(env.TENANT_DO.idFromName(TENANT));
const owner = { ...auth("owner", "owner"), tenantId: TENANT };

const paragraph = (text: string) => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

function mcpAuth(overrides: Partial<McpAuth> = {}): McpAuth {
  return {
    userId: "agent",
    role: "editor",
    tenantId: TENANT,
    exp: Math.floor(Date.now() / 1000) + 3600,
    scopes: ["record:read"],
    tokenId: uuid(769),
    tokenKind: "pat",
    ...overrides,
  };
}

async function search(input: Record<string, unknown>) {
  const result = asInvokeResult(await stub.invoke("record_search", input, mcpAuth()));
  expect(result.ok, JSON.stringify(result)).toBe(true);
  if (!result.ok) throw new Error("unreachable");
  return result.output as {
    items: { id: string; type: string; title?: string; snippet: string }[];
  };
}

async function write(recordId: string, input: Record<string, unknown>) {
  const result = asWriteResult(await stub.writeRecord("article", { recordId, input }, owner));
  expect(result.ok, JSON.stringify(result)).toBe(true);
}

beforeAll(async () => {
  expect(asRegisterResult(await stub.registerContentType(articleType(), owner)).ok).toBe(true);
  await write(FIRST, {
    ...validArticleInput(),
    title: "朝の散歩",
    slug: "walk",
    body: { schemaVersion: 1, doc: paragraph("全文検索の対象になる本文です。") },
  });
  await write(SECOND, {
    ...validArticleInput(),
    title: "夜の読書",
    slug: "read",
    body: { schemaVersion: 1, doc: paragraph("別の記事の本文。") },
  });
});

describe("searchText", () => {
  it("text と richtext のプレーンテキストだけを空白区切りで連結する(json / relation / 数値は含めない)", () => {
    const text = searchText(articleType(), {
      title: "見出し",
      slug: "slug-x",
      published_at: "2026-07-12T00:00:00Z",
      tags: ["tech"],
      body: { schemaVersion: 1, doc: paragraph("本文") },
      authors: [{ type: "author", id: uuid(2) }],
      gone: "型定義に無いフィールド",
    });
    expect(text).toBe("見出し slug-x 本文");
  });
});

describe("record_search", () => {
  it("本文の語(3 文字以上)で見つかり、snippet に該当箇所が入る", async () => {
    const { items } = await search({ query: "検索の対象" });
    expect(items.map((i) => i.id)).toEqual([FIRST]);
    expect(items[0]).toMatchObject({ type: "article", title: "朝の散歩" });
    expect(items[0]?.snippet).toContain("[検索の対象]");
  });

  it("2 文字以下の問い合わせでも部分一致で見つかる", async () => {
    const { items } = await search({ query: "読書" });
    expect(items.map((i) => i.id)).toEqual([SECOND]);
    expect(items[0]?.snippet).toContain("読書");
  });

  it("複数の語は AND、型で絞れる、見つからなければ空", async () => {
    expect((await search({ query: "本文 記事" })).items.map((i) => i.id)).toEqual([SECOND]);
    expect((await search({ query: "本文", type: "article" })).items).toHaveLength(2);
    expect((await search({ query: "本文", type: "author" })).items).toHaveLength(0);
    expect((await search({ query: "存在しない語" })).items).toHaveLength(0);
  });

  it("引用符や FTS の記号を含む問い合わせでも構文エラーにならない", async () => {
    expect((await search({ query: 'NOT "本文" OR *' })).items).toHaveLength(0);
    expect((await search({ query: "本文*" })).items).toHaveLength(0);
  });

  it("削除すると出なくなり、復元すると戻る", async () => {
    const deleted = asDeleteResult(await stub.deleteRecord(FIRST, owner));
    expect(deleted.ok).toBe(true);
    expect((await search({ query: "散歩" })).items).toHaveLength(0);
    const history = asInvokeResult(
      await stub.invoke("record_history", { recordId: FIRST }, mcpAuth()),
    );
    expect(history.ok).toBe(true);
    if (!history.ok) return;
    const versions = (history.output as { items: { historySeq: number; kind: string }[] }).items;
    const last = versions.find((v) => v.kind === "write");
    const restored = asInvokeResult(
      await stub.invoke(
        "record_restore",
        { recordId: FIRST, historySeq: last?.historySeq },
        mcpAuth({ scopes: ["record:read", "record:write"] }),
      ),
    );
    expect(restored.ok, JSON.stringify(restored)).toBe(true);
    expect((await search({ query: "散歩" })).items.map((i) => i.id)).toEqual([FIRST]);
  });

  it("record:read が無ければ insufficient_scope", async () => {
    const result = asInvokeResult(
      await stub.invoke("record_search", { query: "本文" }, mcpAuth({ scopes: [] })),
    );
    expect(result.ok).toBe(false);
    expect(!result.ok && result.code).toBe("insufficient_scope");
  });
});

describe("再索引", () => {
  it("reindexAll は現在の型定義で抽出し直し、型定義から外れたフィールドの文字列を落とす", async () => {
    // いったん extra フィールドを型に足して書き、型から外す。record の data には残る(§4.2 の
    // 遅延マイグレーション)が、索引は書き込み時のまま extra の文字列を持ち続ける
    const withExtra = {
      ...articleType(),
      fields: [...articleType().fields, { key: "extra", type: "text" as const }],
    };
    expect(asRegisterResult(await stub.registerContentType(withExtra, owner)).ok).toBe(true);
    await write(SECOND, {
      ...validArticleInput(),
      title: "夜の読書",
      slug: "read",
      body: { schemaVersion: 1, doc: paragraph("別の記事の本文。") },
      extra: "消える文字列",
    });
    expect((await search({ query: "消える文字列" })).items.map((i) => i.id)).toEqual([SECOND]);
    expect(asRegisterResult(await stub.registerContentType(articleType(), owner)).ok).toBe(true);
    expect((await search({ query: "消える文字列" })).items.map((i) => i.id)).toEqual([SECOND]);
    await runInDurableObject(stub, (_instance, state) => {
      const sql = state.storage.sql;
      const indexed = reindexAll(sql);
      expect(indexed).toBe(2);
      expect(searchRecords(sql, { query: "消える文字列", limit: 20 }).items).toHaveLength(0);
      expect(searchRecords(sql, { query: "夜の読書", limit: 20 }).items).toHaveLength(1);
    });
  });

  it("ensureSearchIndex は do_config.search_indexed が無いときだけ全件を索引に入れる", async () => {
    await runInDurableObject(stub, (_instance, state) => {
      const sql = state.storage.sql;
      expect(ensureSearchIndex(sql)).toBeNull();
      sql.exec("DELETE FROM records_fts");
      sql.exec("DELETE FROM do_config WHERE key = 'search_indexed'");
      expect(searchRecords(sql, { query: "本文", limit: 20 }).items).toHaveLength(0);
      expect(ensureSearchIndex(sql)).toBe(2);
      expect(searchRecords(sql, { query: "本文", limit: 20 }).items).toHaveLength(2);
      expect(ensureSearchIndex(sql)).toBeNull();
    });
  });

  it("reindexSearch RPC は projection:rebuild を要し、件数を返す", async () => {
    const denied = asReindexResult(
      await stub.reindexSearch({ ...auth("editor", "editor"), tenantId: TENANT }),
    );
    expect(denied.ok).toBe(false);
    const result = asReindexResult(await stub.reindexSearch(owner));
    expect(result).toEqual({ ok: true, indexed: 2 });
  });
});
