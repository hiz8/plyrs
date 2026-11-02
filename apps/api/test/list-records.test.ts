import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import type { McpAuth } from "../src/do/authorize";
import {
  buildListRecordsQuery,
  parseRecordListInput,
  recordListInputSchema,
} from "../src/do/list-records";
import { articleType, auth, uuid, validArticleInput } from "./fixtures";
import { asInvokeResult, asWriteResult } from "./rpc-unwrap";

// M1-2(design-spec 16.9): DO の一覧 RPC record_list。フィルタ・ソートは索引宣言済み + システム列に限り、
// cursor は (sort key, seq) の keyset、削除済みは除き下書きは含む(Review Focus 5)。

const TENANT = uuid(720);

function mcpAuth(): McpAuth {
  return {
    userId: "agent",
    role: "viewer",
    tenantId: TENANT,
    exp: Math.floor(Date.now() / 1000) + 3600,
    scopes: ["record:read"],
    tokenId: uuid(721),
    tokenKind: "pat",
  };
}

interface Summary {
  id: string;
  type: string;
  status: string;
  seq: number;
  version: number;
  updatedAt: string;
  title?: string;
}

const stub = env.TENANT_DO.get(env.TENANT_DO.idFromName(TENANT));
const owner = { ...auth("owner", "owner"), tenantId: TENANT };

async function list(input: Record<string, unknown>) {
  const result = asInvokeResult(await stub.invoke("record_list", input, mcpAuth()));
  if (!result.ok) {
    return result;
  }
  return {
    ok: true as const,
    ...(result.output as { items: Summary[]; nextCursor: string | null }),
  };
}

beforeAll(async () => {
  expect((await stub.registerContentType(articleType(), owner)).ok).toBe(true);
  // 12 件: slug は a00..a11、published_at は i が偶数なら 2026 年、奇数なら 2025 年
  for (let i = 0; i < 12; i++) {
    const input = {
      ...validArticleInput(),
      title: `記事 ${i}`,
      slug: `a${String(i).padStart(2, "0")}`,
      published_at: `${i % 2 === 0 ? "2026" : "2025"}-01-${String(i + 1).padStart(2, "0")}T00:00:00Z`,
    };
    const status = i < 3 ? "ready" : "draft";
    const written = asWriteResult(
      await stub.writeRecord("article", { recordId: uuid(730 + i), input, status }, owner),
    );
    expect(written.ok).toBe(true);
  }
  // 1 件削除(a11)
  expect((await stub.deleteRecord(uuid(741), owner)).ok).toBe(true);
});

// Zod(recordListInputSchema)は invoke の runOperation が通す。ここでは解決(列・値・cursor)だけを見る
function resolve(input: Record<string, unknown>) {
  return parseRecordListInput(articleType(), recordListInputSchema.parse(input));
}

describe("recordListInputSchema(Zod)", () => {
  it("limit は上限 100、status は重複を畳み、状態の種類数を超える配列は受けない", () => {
    expect(recordListInputSchema.safeParse({ type: "article", limit: 101 }).success).toBe(false);
    expect(recordListInputSchema.safeParse({ type: "article", limit: 0 }).success).toBe(false);
    expect(
      recordListInputSchema.parse({ type: "article", status: ["draft", "draft"] }).status,
    ).toEqual(["draft"]);
    expect(
      recordListInputSchema.safeParse({
        type: "article",
        status: ["draft", "draft", "draft", "draft", "draft"],
      }).success,
    ).toBe(false);
  });
});

describe("parseRecordListInput(純関数)", () => {
  it("索引宣言の無いフィールドでのフィルタ・ソートは invalid_input", () => {
    expect(resolve({ type: "article", filter: { title: ["x"] } })).toMatchObject({
      ok: false,
      code: "invalid_input",
    });
    expect(resolve({ type: "article", sort: { field: "tags", direction: "asc" } })).toMatchObject({
      ok: false,
      code: "invalid_input",
    });
  });

  it("limit は既定 20", () => {
    const ok = resolve({ type: "article" });
    expect(ok.ok && ok.query.limit).toBe(20);
  });

  it("フィルタ値の総数は公開 API と同じ上限(60)で、超えると invalid_input", () => {
    const slugs = Array.from({ length: 20 }, (_, i) => `a${i}`);
    const dates = Array.from(
      { length: 20 },
      (_, i) => `2026-01-${String(i + 1).padStart(2, "0")}T00:00:00Z`,
    );
    const filter = { slug: slugs, published_at: dates, updatedAt: dates, createdAt: dates };
    expect(resolve({ type: "article", filter })).toMatchObject({
      ok: false,
      code: "invalid_input",
      message: "too many filter values",
    });
    const within = { slug: slugs, published_at: dates, updatedAt: dates };
    expect(resolve({ type: "article", filter: within })).toMatchObject({ ok: true });
  });

  it("datetime の値は ISO8601 UTC だけを受ける", () => {
    expect(resolve({ type: "article", filter: { published_at: ["2026-01-01"] } })).toMatchObject({
      ok: false,
      code: "invalid_input",
    });
  });
});

describe("buildListRecordsQuery(純関数)", () => {
  it("生成列・システム列・cursor を WHERE に積み、ユーザー入力は補間しない", () => {
    const parsed = resolve({
      type: "article",
      filter: { slug: ["a01", "a02"] },
      status: ["draft"],
      sort: { field: "published_at", direction: "asc" },
      limit: 5,
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    const built = buildListRecordsQuery(parsed.query, { k: "2025-01-02T00:00:00Z", seq: 3 });
    // 次ページの cursor に使うソートキーを最初から選ぶ(後から文字列置換で足さない)
    expect(built.sql).toContain("SELECT g_article_published_at AS sort_value, id,");
    expect(built.sql).toContain("deleted_at IS NULL");
    expect(built.sql).toContain("g_article_slug IN (?, ?)");
    expect(built.sql).toContain("status IN (?)");
    expect(built.sql).toContain("(g_article_published_at, seq) > (?, ?)");
    expect(built.sql).toContain("ORDER BY g_article_published_at ASC, seq ASC LIMIT ?");
    expect(built.sql).toContain("json_extract(data, '$.title') AS title");
    expect(built.binds).toEqual(["article", "draft", "a01", "a02", "2025-01-02T00:00:00Z", 3, 6]);
    expect(built.sql).not.toContain("a01");
  });
});

describe("record_list(DO)", () => {
  it("既定は updatedAt の降順で削除済みを除き、本文を返さずタイトルを添える", async () => {
    const page = await list({ type: "article" });
    expect(page.ok).toBe(true);
    if (!page.ok) {
      return;
    }
    expect(page.items).toHaveLength(11);
    expect(page.items.map((r) => r.id)).not.toContain(uuid(741));
    expect(page.items[0]).toMatchObject({ type: "article", title: "記事 10" });
    expect(page.items[0]).not.toHaveProperty("data");
    expect(page.nextCursor).toBeNull();
  });

  it("索引宣言済みフィールドの any-of と複数フィールドの AND", async () => {
    const anyOf = await list({ type: "article", filter: { slug: ["a01", "a02", "a11"] } });
    expect(anyOf.ok && anyOf.items.map((r) => r.title).toSorted()).toEqual(["記事 1", "記事 2"]);
    const and = await list({
      type: "article",
      filter: { slug: ["a01", "a02"], published_at: ["2025-01-02T00:00:00Z"] },
    });
    expect(and.ok && and.items.map((r) => r.title)).toEqual(["記事 1"]);
  });

  it("status の絞り込み", async () => {
    const ready = await list({ type: "article", status: ["ready"] });
    expect(ready.ok && ready.items).toHaveLength(3);
  });

  it("索引宣言の無いフィールドは invalid_input", async () => {
    expect(await list({ type: "article", filter: { title: ["記事 1"] } })).toMatchObject({
      ok: false,
      code: "invalid_input",
    });
  });

  it("cursor で続きを取り、重複も欠落もない", async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page = await list({
        type: "article",
        sort: { field: "published_at", direction: "asc" },
        limit: 4,
        ...(cursor === null ? {} : { cursor }),
      });
      expect(page.ok).toBe(true);
      if (!page.ok) {
        return;
      }
      seen.push(...page.items.map((r) => r.id));
      cursor = page.nextCursor;
      pages += 1;
    } while (cursor !== null);
    expect(pages).toBe(3);
    expect(new Set(seen).size).toBe(11);
  });

  it("壊れた cursor は invalid_input", async () => {
    expect(await list({ type: "article", cursor: "!!!" })).toMatchObject({
      ok: false,
      code: "invalid_input",
    });
  });

  it("未知の型は not_found、1 件もない型は空", async () => {
    expect(await list({ type: "nope" })).toMatchObject({ ok: false, code: "not_found" });
    const empty = await list({ type: "article", status: ["archived"] });
    expect(empty.ok && empty.items).toEqual([]);
  });
});
