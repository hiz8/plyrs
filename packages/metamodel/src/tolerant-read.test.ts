import { describe, expect, it } from "vitest";
import type { ContentTypeDefinition } from "./content-type";
import { tolerantReadData } from "./tolerant-read";

const articleType: ContentTypeDefinition = {
  id: "018f2b6a-7a0a-7000-8000-000000000001",
  key: "article",
  name: "記事",
  source: "user",
  version: 3,
  fields: [
    { key: "title", type: "text", required: true },
    { key: "view_count", type: "number", config: { integer: true } },
    { key: "authors", type: "relation", config: { allowedTypes: ["author"], cardinality: "many" } },
  ],
};

describe("tolerantReadData", () => {
  it("returns valid known fields", () => {
    const result = tolerantReadData(articleType, { title: "hello", view_count: 42 });
    expect(result.values).toEqual({ title: "hello", view_count: 42 });
    expect(result.unknownKeys).toEqual([]);
    expect(result.invalidKeys).toEqual([]);
  });

  it("treats missing fields as absent (even required ones — read is tolerant)", () => {
    const result = tolerantReadData(articleType, {});
    expect(result.values).toEqual({});
    expect(result.invalidKeys).toEqual([]);
  });

  it("treats values that no longer match the current definition as absent, reporting them", () => {
    const result = tolerantReadData(articleType, { title: 123, view_count: "many" });
    expect(result.values).toEqual({});
    expect(result.invalidKeys.sort()).toEqual(["title", "view_count"]);
  });

  it("reports unknown keys without dropping them from the caller's raw data", () => {
    const raw = { title: "hello", legacy_field: "keep me" };
    const result = tolerantReadData(articleType, raw);
    expect(result.values).toEqual({ title: "hello" });
    expect(result.unknownKeys).toEqual(["legacy_field"]);
    expect(raw.legacy_field).toBe("keep me");
  });

  it("skips relation fields (relations are not stored in data)", () => {
    const result = tolerantReadData(articleType, {
      title: "hello",
      authors: [{ type: "author", id: "018f2b6a-7a0a-7000-8000-000000000002" }],
    });
    expect(result.values).toEqual({ title: "hello" });
    // authors は定義済みフィールドなので unknown ではないが、data には本来存在しない
    expect(result.unknownKeys).toEqual([]);
  });
});
