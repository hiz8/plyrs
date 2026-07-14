import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import type { ListQuery } from "./query";
import { buildListQuery, placeholders, type ListRow } from "./sql";

// このテスト専用の合成テナント。投影は派生ストアなので直接播種してよい
// （consumer 経由の播種は Task 10 以降の統合テストが担う）。
const tenantId = crypto.randomUUID();

function defaults(): ListQuery {
  return {
    filters: [],
    sort: { fieldKey: "published_at", column: "published_at", direction: "desc" },
    limit: 10,
    cursor: null,
    include: [],
  };
}

async function run(query: ListQuery): Promise<string[]> {
  const built = buildListQuery(tenantId, "post", query);
  const { results } = await env.PROJECTION_DB.prepare(built.sql)
    .bind(...built.binds)
    .all<ListRow>();
  return results.map((row) => row.record_id);
}

beforeAll(async () => {
  // p1: rating 5, category tech / p2: rating 5, category life / p3: rating 3, tech
  // p4: rating 無し / p1 と p2 は author a1 を参照
  const records = [
    ["p1", "2026-07-01T00:00:00.000Z"],
    ["p2", "2026-07-02T00:00:00.000Z"],
    ["p3", "2026-07-03T00:00:00.000Z"],
    ["p4", "2026-07-03T00:00:00.000Z"], // p3 と同時刻（record_id タイブレークの検証）
  ] as const;
  for (const [id, publishedAt] of records) {
    await env.PROJECTION_DB.prepare(
      "INSERT INTO projected_records (tenant_id, record_id, type, slug, published_at, data, source_version, publish_seq, projected_at) VALUES (?1, ?2, 'post', ?2, ?3, '{}', 1, 1, 0)",
    )
      .bind(tenantId, id, publishedAt)
      .run();
  }
  const index = [
    ["p1", "rating", 5],
    ["p2", "rating", 5],
    ["p3", "rating", 3],
  ] as const;
  for (const [id, key, num] of index) {
    await env.PROJECTION_DB.prepare(
      "INSERT INTO projection_index (tenant_id, type, field_key, value_text, value_num, value_date, record_id) VALUES (?1, 'post', ?2, NULL, ?3, NULL, ?4)",
    )
      .bind(tenantId, key, num, id)
      .run();
  }
  const category = [
    ["p1", "tech"],
    ["p2", "life"],
    ["p3", "tech"],
  ] as const;
  for (const [id, value] of category) {
    await env.PROJECTION_DB.prepare(
      "INSERT INTO projection_index (tenant_id, type, field_key, value_text, value_num, value_date, record_id) VALUES (?1, 'post', 'category', ?2, NULL, NULL, ?3)",
    )
      .bind(tenantId, value, id)
      .run();
  }
  for (const source of ["p1", "p2"]) {
    await env.PROJECTION_DB.prepare(
      "INSERT INTO projected_relations (tenant_id, source_id, source_field, target_type, target_id, ordinal, origin) VALUES (?1, ?2, 'authors', 'author', 'a1', 0, 'field')",
    )
      .bind(tenantId, source)
      .run();
  }
});

describe("buildListQuery (実 D1 で実行)", () => {
  it("orders by system published_at desc with record_id tiebreak", async () => {
    expect(await run(defaults())).toStrictEqual(["p4", "p3", "p2", "p1"]);
  });

  it("pages with a keyset cursor over ties", async () => {
    const query = { ...defaults(), limit: 1 };
    // p4 と p3 は同時刻。p4 の後のカーソルで p3 が返る（タイブレークが効く）
    const afterP4 = { ...query, cursor: { k: "2026-07-03T00:00:00.000Z", id: "p4" } };
    expect(await run(afterP4)).toStrictEqual(["p3", "p2"].slice(0, 2)); // limit+1 で 2 行返る
  });

  it("sorts by an indexed numeric field, dropping records without a value", async () => {
    const desc = {
      ...defaults(),
      sort: { fieldKey: "rating", column: "value_num", direction: "desc" } as const,
    };
    expect(await run(desc)).toStrictEqual(["p2", "p1", "p3"]); // p4 は rating 無し → 除外
    const asc = {
      ...defaults(),
      sort: { fieldKey: "rating", column: "value_num", direction: "asc" } as const,
    };
    expect(await run(asc)).toStrictEqual(["p3", "p1", "p2"]);
  });

  it("pages through equal sort values with the record_id tiebreak", async () => {
    const query = {
      ...defaults(),
      sort: { fieldKey: "rating", column: "value_num", direction: "desc" } as const,
      cursor: { k: 5, id: "p2" },
    };
    expect(await run(query)).toStrictEqual(["p1", "p3"]);
  });

  it("applies scalar filters as any-of within a key, AND across keys", async () => {
    const anyOf = {
      ...defaults(),
      filters: [
        { target: "index", fieldKey: "category", column: "value_text", values: ["tech", "life"] },
      ] as ListQuery["filters"],
    };
    expect(await run(anyOf)).toStrictEqual(["p3", "p2", "p1"]);
    const combined = {
      ...defaults(),
      filters: [
        { target: "index", fieldKey: "category", column: "value_text", values: ["tech"] },
        { target: "index", fieldKey: "rating", column: "value_num", values: [5] },
      ] as ListQuery["filters"],
    };
    expect(await run(combined)).toStrictEqual(["p1"]);
  });

  it("applies relation membership filters", async () => {
    const query = {
      ...defaults(),
      filters: [
        { target: "relations", fieldKey: "authors", values: ["a1"] },
      ] as ListQuery["filters"],
    };
    expect(await run(query)).toStrictEqual(["p2", "p1"]);
  });

  it("fetches limit+1 rows so the caller can detect the next page", async () => {
    const built = buildListQuery(tenantId, "post", { ...defaults(), limit: 2 });
    const { results } = await env.PROJECTION_DB.prepare(built.sql)
      .bind(...built.binds)
      .all<ListRow>();
    expect(results.length).toBe(3);
  });

  it("exposes the sort value for index sorts (cursor minting)", async () => {
    const built = buildListQuery(tenantId, "post", {
      ...defaults(),
      sort: { fieldKey: "rating", column: "value_num", direction: "desc" },
    });
    const { results } = await env.PROJECTION_DB.prepare(built.sql)
      .bind(...built.binds)
      .all<ListRow>();
    expect(results[0]?.sort_value).toBe(5);
  });
});

describe("placeholders", () => {
  it("emits comma-separated question marks", () => {
    expect(placeholders(3)).toBe("?, ?, ?");
    expect(placeholders(1)).toBe("?");
  });
});
