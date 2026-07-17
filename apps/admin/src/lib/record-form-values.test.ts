import type { ContentTypeDefinition } from "@plyrs/metamodel";
import { describe, expect, it } from "vitest";
import {
  fromDraftValues,
  parseRelationDraftKey,
  relationDraftKey,
  toDraftValues,
} from "./record-form-values";

const contentType: ContentTypeDefinition = {
  id: "018f2b6a-7a0a-7000-8000-000000000001",
  key: "article",
  name: "記事",
  source: "user",
  version: 1,
  fields: [
    { key: "title", type: "text", required: true },
    { key: "count", type: "number", config: { integer: true } },
    { key: "featured", type: "boolean" },
    { key: "published_at", type: "datetime" },
    { key: "meta", type: "json" },
    {
      key: "tags",
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
      config: { allowedTypes: ["author"], cardinality: "many", ordered: true },
    },
    {
      key: "hero",
      type: "relation",
      config: { allowedTypes: ["asset"], cardinality: "one" },
    },
  ],
};

const authorRef = { type: "author", id: "018f2b6a-7a0a-7000-8000-000000000002" };
const heroRef = { type: "asset", id: "018f2b6a-7a0a-7000-8000-000000000003" };

describe("relationDraftKey", () => {
  it("round-trips a relation ref", () => {
    expect(parseRelationDraftKey(relationDraftKey(authorRef))).toStrictEqual(authorRef);
  });

  it("rejects malformed keys", () => {
    expect(parseRelationDraftKey("no-separator")).toBeNull();
    expect(parseRelationDraftKey("id-only")).toBeNull();
  });
});

describe("toDraftValues", () => {
  it("maps input values to UI drafts per field type", () => {
    const draft = toDraftValues(contentType, {
      title: "hello",
      count: 3,
      featured: true,
      published_at: "2026-07-17T00:00:00Z",
      meta: { a: 1 },
      tags: ["tech"],
      body: { schemaVersion: 1, doc: {} },
      authors: [authorRef],
      hero: heroRef,
    });
    expect(draft["title"]).toBe("hello");
    expect(draft["count"]).toBe("3");
    expect(draft["featured"]).toBe(true);
    expect(draft["published_at"]).toBe("2026-07-17T00:00:00Z");
    expect(draft["meta"]).toBe(JSON.stringify({ a: 1 }, null, 2));
    expect(draft["tags"]).toStrictEqual(["tech"]);
    expect(draft["body"]).toStrictEqual({ schemaVersion: 1, doc: {} });
    expect(draft["authors"]).toStrictEqual([relationDraftKey(authorRef)]);
    expect(draft["hero"]).toBe(relationDraftKey(heroRef));
  });

  it("maps absent values to empty drafts", () => {
    const draft = toDraftValues(contentType, {});
    expect(draft["title"]).toBe("");
    expect(draft["count"]).toBe("");
    expect(draft["featured"]).toBe(false);
    expect(draft["meta"]).toBe("");
    expect(draft["tags"]).toStrictEqual([]);
    expect(draft["authors"]).toStrictEqual([]);
    expect(draft["hero"]).toBe("");
  });
});

describe("fromDraftValues", () => {
  const fullDraft = () =>
    toDraftValues(contentType, {
      title: "hello",
      count: 3,
      featured: false,
      tags: ["tech"],
      authors: [authorRef],
    });

  it("converts drafts back into a valid input", () => {
    const result = fromDraftValues(contentType, fullDraft(), {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.input).toStrictEqual({
      title: "hello",
      count: 3,
      featured: false,
      tags: ["tech"],
      authors: [authorRef],
    });
  });

  it("omits empty optional values instead of writing empty strings", () => {
    const result = fromDraftValues(contentType, fullDraft(), {});
    if (!result.ok) throw new Error("expected ok");
    expect("published_at" in result.input).toBe(false);
    expect("meta" in result.input).toBe(false);
    expect("hero" in result.input).toBe(false);
  });

  it("preserves unknown keys and richtext from the base input (遅延適合 §4.2)", () => {
    const base = {
      legacy_field: "keep me",
      body: { schemaVersion: 1, doc: { type: "doc" } },
    };
    const result = fromDraftValues(contentType, fullDraft(), base);
    if (!result.ok) throw new Error("expected ok");
    expect(result.input["legacy_field"]).toBe("keep me");
    expect(result.input["body"]).toStrictEqual({ schemaVersion: 1, doc: { type: "doc" } });
  });

  it("reports parse errors per field before schema validation", () => {
    const draft = { ...fullDraft(), count: "abc", meta: "{broken" };
    const result = fromDraftValues(contentType, draft, {});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.fieldErrors["count"]).toMatch(/数値/);
    expect(result.fieldErrors["meta"]).toMatch(/JSON/);
  });

  it("maps zod issues to field errors (required text)", () => {
    const draft = { ...fullDraft(), title: "" };
    const result = fromDraftValues(contentType, draft, {});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.fieldErrors["title"]).toBeDefined();
  });

  it("rejects a non-Z datetime through the schema", () => {
    const draft = { ...fullDraft(), published_at: "2026-07-17T09:00:00+09:00" };
    const result = fromDraftValues(contentType, draft, {});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.fieldErrors["published_at"]).toBeDefined();
  });
});
