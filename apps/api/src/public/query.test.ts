import { describe, expect, it } from "vitest";
import type { Catalog } from "./catalog";
import { encodeCursor } from "./cursor";
import { DEFAULT_LIMIT, parseInclude, parseListQuery } from "./query";

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
