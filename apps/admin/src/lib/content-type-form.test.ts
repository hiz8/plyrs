import { describe, expect, it } from "vitest";
import type { FieldDefinition } from "@plyrs/metamodel";
import {
  buildDefinition,
  emptyFieldDraft,
  summaryToDefinition,
  toFieldDraft,
} from "./content-type-form";

const uuid = "018f2b6a-7a0a-7000-8000-000000000001";

describe("toFieldDraft / buildDefinition round-trip", () => {
  const fields: FieldDefinition[] = [
    { key: "title", type: "text", required: true, config: { maxLength: 200, unique: true } },
    { key: "count", type: "number", config: { integer: true, indexed: true } },
    { key: "featured", type: "boolean", config: { indexed: true } },
    { key: "published_at", type: "datetime", config: { indexed: true } },
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
        indexed: true,
      },
    },
    { key: "body", type: "richtext" },
    {
      key: "authors",
      type: "relation",
      required: true,
      config: { allowedTypes: ["author", "team"], cardinality: "many", ordered: true },
    },
  ];

  it("survives a full round-trip for every palette type", () => {
    const drafts = fields.map(toFieldDraft);
    const result = buildDefinition({ id: uuid, key: "article", name: "記事", drafts, version: 1 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.definition.fields).toStrictEqual(fields);
    expect(result.definition).toMatchObject({
      id: uuid,
      key: "article",
      source: "user",
      version: 1,
    });
  });

  it("parses select options from 'value=label' lines and defaults label to value", () => {
    const draft = {
      ...emptyFieldDraft(),
      key: "tags",
      type: "select" as const,
      optionsText: "tech=Tech\nlife",
    };
    const result = buildDefinition({ id: uuid, key: "t", name: "T", drafts: [draft], version: 1 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const field = result.definition.fields[0];
    expect(field).toMatchObject({
      type: "select",
      config: {
        options: [
          { value: "tech", label: "Tech" },
          { value: "life", label: "life" },
        ],
      },
    });
  });

  it("rejects a select without options", () => {
    const draft = { ...emptyFieldDraft(), key: "tags", type: "select" as const, optionsText: "" };
    const result = buildDefinition({ id: uuid, key: "t", name: "T", drafts: [draft], version: 1 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(" ")).toMatch(/tags/);
  });

  it("rejects a relation without allowed types and parses comma separated types", () => {
    const missing = {
      ...emptyFieldDraft(),
      key: "rel",
      type: "relation" as const,
      allowedTypes: "",
    };
    expect(
      buildDefinition({ id: uuid, key: "t", name: "T", drafts: [missing], version: 1 }).ok,
    ).toBe(false);
    const ok = {
      ...emptyFieldDraft(),
      key: "rel",
      type: "relation" as const,
      allowedTypes: " author , asset ",
    };
    const result = buildDefinition({ id: uuid, key: "t", name: "T", drafts: [ok], version: 1 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.definition.fields[0]).toMatchObject({
      config: { allowedTypes: ["author", "asset"], cardinality: "one" },
    });
  });

  it("rejects duplicate field keys via the content type schema", () => {
    const a = { ...emptyFieldDraft(), key: "dup" };
    const b = { ...emptyFieldDraft(), key: "dup" };
    const result = buildDefinition({ id: uuid, key: "t", name: "T", drafts: [a, b], version: 1 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(" ")).toMatch(/duplicate/);
  });

  it("rejects an invalid number in maxLength", () => {
    const draft = { ...emptyFieldDraft(), key: "title", maxLength: "abc" };
    const result = buildDefinition({ id: uuid, key: "t", name: "T", drafts: [draft], version: 1 });
    expect(result.ok).toBe(false);
  });
});

describe("summaryToDefinition", () => {
  it("drops row-only columns and null pluginId", () => {
    const definition = summaryToDefinition({
      id: uuid,
      key: "article",
      name: "記事",
      fields: [],
      source: "user",
      pluginId: null,
      createdAt: "2026-07-17T00:00:00Z",
      updatedAt: "2026-07-17T00:00:00Z",
      version: 4,
    });
    expect(definition).toStrictEqual({
      id: uuid,
      key: "article",
      name: "記事",
      fields: [],
      source: "user",
      version: 4,
    });
  });
});
