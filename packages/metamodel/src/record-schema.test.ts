import { describe, expect, it } from "vitest";
import type { ContentTypeDefinition } from "./content-type";
import { buildRecordInputSchema, splitRecordInput } from "./record-schema";

const UUID = (n: number) => `018f2b6a-7a0a-7000-8000-00000000000${n}`;

const articleType: ContentTypeDefinition = {
  id: UUID(1),
  key: "article",
  name: "記事",
  source: "user",
  version: 1,
  fields: [
    { key: "title", type: "text", required: true, config: { maxLength: 200 } },
    { key: "published_at", type: "datetime", config: { indexed: true } },
    {
      key: "category",
      type: "select",
      config: {
        options: [
          { value: "tech", label: "Tech" },
          { value: "life", label: "Life" },
        ],
        multiple: true,
      },
    },
    { key: "body", type: "richtext" },
    {
      key: "authors",
      type: "relation",
      required: true,
      config: { allowedTypes: ["author"], cardinality: "many", ordered: true },
    },
    {
      key: "hero",
      type: "relation",
      config: { allowedTypes: ["asset"], cardinality: "one", snapshotEmbed: "value" },
    },
  ],
};

const validInput = {
  title: "こんにちは",
  published_at: "2026-07-12T00:00:00Z",
  category: ["tech"],
  body: { schemaVersion: 1, doc: { type: "doc", content: [] } },
  authors: [
    { type: "author", id: UUID(2) },
    { type: "author", id: UUID(3) },
  ],
  hero: { type: "asset", id: UUID(4) },
};

describe("buildRecordInputSchema", () => {
  it("accepts a fully valid input", () => {
    expect(buildRecordInputSchema(articleType).safeParse(validInput).success).toBe(true);
  });

  it("rejects when a required field is missing", () => {
    const { title: _title, ...rest } = validInput;
    expect(buildRecordInputSchema(articleType).safeParse(rest).success).toBe(false);
  });

  it("accepts when an optional field is absent", () => {
    const { hero: _hero, published_at: _p, ...rest } = validInput;
    expect(buildRecordInputSchema(articleType).safeParse(rest).success).toBe(true);
  });

  it("rejects a datetime with a timezone offset (UTC 'Z' only)", () => {
    const result = buildRecordInputSchema(articleType).safeParse({
      ...validInput,
      published_at: "2026-07-12T09:00:00+09:00",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a select value outside the declared options", () => {
    const result = buildRecordInputSchema(articleType).safeParse({
      ...validInput,
      category: ["sports"],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a relation ref whose type is not in allowedTypes", () => {
    const result = buildRecordInputSchema(articleType).safeParse({
      ...validInput,
      hero: { type: "author", id: UUID(2) },
    });
    expect(result.success).toBe(false);
  });

  it("rejects text longer than maxLength", () => {
    const result = buildRecordInputSchema(articleType).safeParse({
      ...validInput,
      title: "a".repeat(201),
    });
    expect(result.success).toBe(false);
  });

  it("preserves unknown keys (lazy conformance: 未知フィールドは保持)", () => {
    const result = buildRecordInputSchema(articleType).safeParse({
      ...validInput,
      legacy_field: "old value",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data["legacy_field"]).toBe("old value");
    }
  });

  it("rejects an uppercase UUID in a relation ref", () => {
    const result = buildRecordInputSchema(articleType).safeParse({
      ...validInput,
      hero: { type: "asset", id: UUID(4).toUpperCase() },
    });
    expect(result.success).toBe(false);
  });
});

describe("splitRecordInput", () => {
  it("separates relation fields from data fields", () => {
    const { data, relations } = splitRecordInput(articleType, {
      ...validInput,
      legacy_field: "old value",
    });

    expect(Object.keys(data).toSorted()).toEqual([
      "body",
      "category",
      "legacy_field",
      "published_at",
      "title",
    ]);
    expect(relations).toEqual([
      {
        fieldKey: "authors",
        refs: [
          { type: "author", id: UUID(2) },
          { type: "author", id: UUID(3) },
        ],
      },
      { fieldKey: "hero", refs: [{ type: "asset", id: UUID(4) }] },
    ]);
  });

  it("normalizes cardinality 'one' into a single-element ref list", () => {
    const { relations } = splitRecordInput(articleType, validInput);
    const hero = relations.find((r) => r.fieldKey === "hero");
    expect(hero?.refs).toHaveLength(1);
  });

  it("omits absent relation fields", () => {
    const { hero: _hero, ...rest } = validInput;
    const { relations } = splitRecordInput(articleType, rest);
    expect(relations.map((r) => r.fieldKey)).toEqual(["authors"]);
  });
});
