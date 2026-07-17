import { describe, expect, it } from "vitest";
import type { Catalog } from "./catalog";
import { encodeCursor } from "./cursor";
import { DEFAULT_LIMIT, parseInclude, parseListQuery } from "./query";
import { buildListQuery } from "./sql";

function catalog(): Catalog {
  return new Map([
    ["slug", { kind: "text", multi: false }],
    ["rating", { kind: "num", multi: false }],
    ["featured", { kind: "bool", multi: false }],
    ["event_at", { kind: "date", multi: false }],
    ["tags", { kind: "text", multi: true }],
    ["authors", { kind: "relation", multi: true }],
    // ユーザーが published_at という索引フィールドを宣言したケース（システム列と同名）
    ["published_at", { kind: "date", multi: false }],
  ]);
}

function emptyCatalog(): Catalog {
  return new Map();
}

// Finding 1 の bind 予算テスト専用: MAX_FILTERS(8) 個の別フィールドにフィルタを掛けるための
// scalar フィールドが多いカタログ。
function manyFieldCatalog(): Catalog {
  const map: Catalog = new Map();
  for (let i = 0; i < 8; i += 1) {
    map.set(`f${i}`, { kind: "text", multi: false });
  }
  map.set("sortfield", { kind: "text", multi: false });
  return map;
}

describe("parseListQuery (§12.4 の語彙)", () => {
  it("defaults to -published_at (system column), limit 20, no filters", () => {
    const parsed = parseListQuery({}, emptyCatalog());
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.query).toStrictEqual({
      filters: [],
      sort: { fieldKey: "published_at", column: "published_at", direction: "desc" },
      limit: DEFAULT_LIMIT,
      cursor: null,
      include: [],
    });
  });

  it("routes scalar filters to the typed column, any-of within a key", () => {
    const parsed = parseListQuery(
      { "filter[rating]": ["3", "5"], "filter[slug]": ["hello"] },
      catalog(),
    );
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.query.filters).toContainEqual({
      target: "index",
      fieldKey: "rating",
      column: "value_num",
      values: [3, 5],
    });
    expect(parsed.query.filters).toContainEqual({
      target: "index",
      fieldKey: "slug",
      column: "value_text",
      values: ["hello"],
    });
  });

  it("parses boolean filters as true/false onto value_num", () => {
    const parsed = parseListQuery({ "filter[featured]": ["true"] }, catalog());
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.query.filters).toStrictEqual([
      { target: "index", fieldKey: "featured", column: "value_num", values: [1] },
    ]);
  });

  it("routes relation fields to a membership filter", () => {
    const parsed = parseListQuery({ "filter[authors]": ["a1", "a2"] }, catalog());
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.query.filters).toStrictEqual([
      { target: "relations", fieldKey: "authors", values: ["a1", "a2"] },
    ]);
  });

  it("rejects filters on fields absent from the catalog (索引宣言済みに限る)", () => {
    expect(parseListQuery({ "filter[title]": ["x"] }, catalog()).ok).toBe(false);
  });

  it("rejects malformed scalar values (bad number / bad boolean)", () => {
    expect(parseListQuery({ "filter[rating]": ["abc"] }, catalog()).ok).toBe(false);
    expect(parseListQuery({ "filter[featured]": ["yes"] }, catalog()).ok).toBe(false);
  });

  it("rejects unknown query params (無制限クエリは許さない)", () => {
    expect(parseListQuery({ utm_source: ["x"] }, catalog()).ok).toBe(false);
    expect(parseListQuery({ "fitler[slug]": ["x"] }, catalog()).ok).toBe(false);
  });

  it("sorts by an indexed single-value field, both directions", () => {
    const asc = parseListQuery({ sort: ["rating"] }, catalog());
    const desc = parseListQuery({ sort: ["-rating"] }, catalog());
    if (!asc.ok || !desc.ok) throw new Error("expected ok");
    expect(asc.query.sort).toStrictEqual({
      fieldKey: "rating",
      column: "value_num",
      direction: "asc",
    });
    expect(desc.query.sort.direction).toBe("desc");
  });

  it("prefers a user-declared indexed field over the system published_at (shadowing)", () => {
    const parsed = parseListQuery({ sort: ["-published_at"] }, catalog());
    if (!parsed.ok) throw new Error(parsed.error);
    // カタログにあるのでシステム列ではなく projection_index の value_date を使う
    expect(parsed.query.sort).toStrictEqual({
      fieldKey: "published_at",
      column: "value_date",
      direction: "desc",
    });
    // カタログに無ければシステム列へフォールバック
    const fallback = parseListQuery({ sort: ["-published_at"] }, emptyCatalog());
    if (!fallback.ok) throw new Error(fallback.error);
    expect(fallback.query.sort.column).toBe("published_at");
  });

  it("rejects sorting on multi-value / relation / undeclared fields", () => {
    expect(parseListQuery({ sort: ["tags"] }, catalog()).ok).toBe(false); // 複数値は未定義
    expect(parseListQuery({ sort: ["authors"] }, catalog()).ok).toBe(false);
    expect(parseListQuery({ sort: ["title"] }, catalog()).ok).toBe(false);
    expect(parseListQuery({ sort: ["!!"] }, catalog()).ok).toBe(false);
  });

  it("validates limit as an integer within 1..100", () => {
    const ok = parseListQuery({ limit: ["100"] }, emptyCatalog());
    if (!ok.ok) throw new Error(ok.error);
    expect(ok.query.limit).toBe(100);
    expect(parseListQuery({ limit: ["0"] }, emptyCatalog()).ok).toBe(false);
    expect(parseListQuery({ limit: ["101"] }, emptyCatalog()).ok).toBe(false);
    expect(parseListQuery({ limit: ["2.5"] }, emptyCatalog()).ok).toBe(false);
    expect(parseListQuery({ limit: ["-1"] }, emptyCatalog()).ok).toBe(false);
  });

  it("accepts a cursor whose key type matches the sort column", () => {
    const token = encodeCursor({ k: 5, id: "r1" });
    const parsed = parseListQuery({ sort: ["-rating"], cursor: [token] }, catalog());
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.query.cursor).toStrictEqual({ k: 5, id: "r1" });
  });

  it("rejects a cursor whose key type mismatches the sort column", () => {
    const stringKey = encodeCursor({ k: "2026-01-01", id: "r1" });
    expect(parseListQuery({ sort: ["-rating"], cursor: [stringKey] }, catalog()).ok).toBe(false);
    const numberKey = encodeCursor({ k: 5, id: "r1" });
    expect(parseListQuery({ cursor: [numberKey] }, emptyCatalog()).ok).toBe(false); // 既定は文字列
    expect(parseListQuery({ cursor: ["///not-a-cursor"] }, emptyCatalog()).ok).toBe(false);
  });

  it("validates include against relation fields and normalizes order", () => {
    const parsed = parseListQuery({ include: ["authors"] }, catalog());
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.query.include).toStrictEqual(["authors"]);
    expect(parseListQuery({ include: ["tags"] }, catalog()).ok).toBe(false); // relation ではない
    expect(parseListQuery({ include: ["ghost"] }, catalog()).ok).toBe(false);
  });

  it("rejects repeated reserved params", () => {
    expect(parseListQuery({ limit: ["5", "10"] }, emptyCatalog()).ok).toBe(false);
  });
});

// Finding 1（critical）: フィルタ値の総数が D1 の 1 クエリのバインド上限（100）を突破しうる。
// buildListQuery の最悪形は 6 固定バインド（tenant/type 2 + カーソル 2 + limit 1 + 索引ソート
// フィールド 1）+ フィルタごとの定数 3（scalar フィルタが relation より重い）× MAX_FILTERS(8) +
// フィルタ値の総数。旧語彙（MAX_FILTERS=8 × MAX_FILTER_VALUES=20/filter、総数無制限）だと
// 8 filters × 20 values = 160 が素通りし、6 + 24 + 160 = 190 バインドで D1 の上限を超える。
describe("parseListQuery: MAX_TOTAL_FILTER_VALUES（D1 バインド予算、Finding 1）", () => {
  it("rejects when the total filter value count exceeds the D1 bind budget (60)", () => {
    // 4 フィールド × 20 値 = 80 > 60
    const twenty = Array.from({ length: 20 }, (_, i) => `v${i}`);
    const parsed = parseListQuery(
      { "filter[f0]": twenty, "filter[f1]": twenty, "filter[f2]": twenty, "filter[f3]": twenty },
      manyFieldCatalog(),
    );
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.error).toMatch(/too many filter values/);
    }
  });

  it("accepts exactly the total filter value budget (60)", () => {
    const twenty = Array.from({ length: 20 }, (_, i) => `v${i}`);
    const parsed = parseListQuery(
      { "filter[f0]": twenty, "filter[f1]": twenty, "filter[f2]": twenty },
      manyFieldCatalog(),
    );
    expect(parsed.ok).toBe(true);
  });
});

describe("buildListQuery: D1 バインド予算（Finding 1）", () => {
  it("keeps the bind count within D1's 100/query cap for the worst allowed query", () => {
    // 語彙が許す最大形: フィルタ 8 個（MAX_FILTERS）× 値の総数 60（MAX_TOTAL_FILTER_VALUES）＋
    // 索引ソート（+1 バインド）＋ カーソル（+2 バインド）。
    const params: Record<string, string[]> = {
      sort: ["-sortfield"],
      cursor: [encodeCursor({ k: "cur", id: "r000" })],
    };
    // 60 を 8 フィルタへできるだけ均等に配る（8,8,8,8,7,7,7,7 = 60）
    const base = Math.floor(60 / 8);
    const remainder = 60 % 8;
    for (let i = 0; i < 8; i += 1) {
      const count = base + (i < remainder ? 1 : 0);
      params[`filter[f${i}]`] = Array.from({ length: count }, (_, j) => `v${i}-${j}`);
    }
    const parsed = parseListQuery(params, manyFieldCatalog());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error(parsed.error);
    const built = buildListQuery("tenant-1", "post", parsed.query);
    expect(built.binds.length).toBeLessThanOrEqual(100);
  });
});

describe("parseListQuery: date format validation (Phase 5c)", () => {
  it("validates date filter values against the write-side format (Phase 5c)", () => {
    const cat: Catalog = new Map([["published_at", { kind: "date", multi: false }]]);
    const bad = parseListQuery({ "filter[published_at]": ["not-a-date"] }, cat);
    expect(bad.ok).toBe(false);
    // metamodel（record-schema）は UTC 'Z' のみ受理する。オフセット付きは書き込めない値なので 400
    const offset = parseListQuery({ "filter[published_at]": ["2026-07-12T09:00:00+09:00"] }, cat);
    expect(offset.ok).toBe(false);
    const good = parseListQuery({ "filter[published_at]": ["2026-07-12T00:00:00Z"] }, cat);
    expect(good.ok).toBe(true);
    const fractional = parseListQuery(
      { "filter[published_at]": ["2026-07-12T00:00:00.123Z"] },
      cat,
    );
    expect(fractional.ok).toBe(true);
  });
});

describe("parseInclude", () => {
  it("splits, trims, dedupes, and sorts", () => {
    const result = parseInclude(" authors ,authors", catalog());
    if (!result.ok) throw new Error(result.error);
    expect(result.include).toStrictEqual(["authors"]);
  });

  it("rejects empty and non-relation fields", () => {
    expect(parseInclude("", catalog()).ok).toBe(false);
    expect(parseInclude("slug", catalog()).ok).toBe(false);
  });
});
