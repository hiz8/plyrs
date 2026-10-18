import { describe, expect, it } from "vitest";
import type { FieldDefinition } from "@plyrs/metamodel";
import {
  buildDefinition,
  displayOf,
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

describe("relation snapshotEmbed (Phase 8 裁定 4)", () => {
  it("round-trips embedValue through draft and definition", () => {
    const field: FieldDefinition = {
      key: "hero",
      type: "relation",
      config: { allowedTypes: ["asset"], cardinality: "one", snapshotEmbed: "value" },
    };
    const draft = toFieldDraft(field);
    expect(draft.embedValue).toBe(true);
    const built = buildDefinition({
      id: "018f2b6a-7a0a-7000-8000-00000000e001",
      key: "article",
      name: "記事",
      drafts: [draft],
      version: 1,
    });
    expect(built.ok).toBe(true);
    if (built.ok) {
      const rebuilt = built.definition.fields[0];
      expect(rebuilt?.type === "relation" && rebuilt.config.snapshotEmbed).toBe("value");
    }
  });

  it("rejects embedValue for non-asset allowedTypes with a readable error", () => {
    const draft = {
      ...emptyFieldDraft(),
      key: "author",
      type: "relation" as const,
      allowedTypes: "author",
      embedValue: true,
    };
    const built = buildDefinition({
      id: "018f2b6a-7a0a-7000-8000-00000000e002",
      key: "article",
      name: "記事",
      drafts: [draft],
      version: 1,
    });
    expect(built.ok).toBe(false);
    if (!built.ok) {
      expect(built.errors.join("\n")).toContain("snapshotEmbed");
    }
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
      description: null,
      titleField: null,
      listColumns: null,
      menuOrder: null,
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

describe("display metadata (案 E 2 章)", () => {
  const summary = {
    id: uuid,
    key: "event",
    name: "イベント",
    fields: [
      { key: "title", type: "text", label: "タイトル", description: "一覧に出ます" },
      { key: "subtitle", type: "text" },
      { key: "starts_at", type: "datetime", label: "開始日時" },
    ] satisfies FieldDefinition[],
    source: "user" as const,
    pluginId: null,
    createdAt: "2026-10-17T00:00:00Z",
    updatedAt: "2026-10-17T00:00:00Z",
    version: 3,
    description: "イベントの告知",
    titleField: "subtitle",
    listColumns: ["starts_at", "subtitle"],
    menuOrder: 2,
  };

  it("summaryToDefinition carries the type display items", () => {
    expect(summaryToDefinition(summary)).toMatchObject({
      description: "イベントの告知",
      titleField: "subtitle",
      listColumns: ["starts_at", "subtitle"],
      menuOrder: 2,
    });
  });

  it("round-trips field label/description through the drafts", () => {
    const drafts = summary.fields.map(toFieldDraft);
    expect(drafts[0]).toMatchObject({ label: "タイトル", description: "一覧に出ます" });
    const built = buildDefinition({ id: uuid, key: "event", name: "イベント", drafts, version: 3 });
    expect(built.ok).toBe(true);
    if (built.ok) {
      expect(built.definition.fields).toStrictEqual(summary.fields);
    }
  });

  it("omits blank label/description", () => {
    const draft = { ...emptyFieldDraft(), key: "title", label: "  ", description: "" };
    const built = buildDefinition({ id: uuid, key: "x", name: "X", drafts: [draft], version: 1 });
    expect(built.ok && built.definition.fields[0]).toStrictEqual({ key: "title", type: "text" });
  });

  it("keeps the existing type display items when editing", () => {
    const built = buildDefinition({
      id: uuid,
      key: "event",
      name: "イベント",
      drafts: summary.fields.map(toFieldDraft),
      version: 3,
      display: displayOf(summary),
    });
    expect(built.ok && built.definition).toMatchObject({
      description: "イベントの告知",
      titleField: "subtitle",
      listColumns: ["starts_at", "subtitle"],
      menuOrder: 2,
    });
  });

  it("drops titleField/listColumns whose fields were removed or retyped", () => {
    const drafts = summary.fields
      .filter((field) => field.key !== "starts_at")
      .map(toFieldDraft)
      .map((draft) => (draft.key === "subtitle" ? { ...draft, type: "number" as const } : draft));
    const built = buildDefinition({
      id: uuid,
      key: "event",
      name: "イベント",
      drafts,
      version: 3,
      display: displayOf(summary),
    });
    expect(built.ok).toBe(true);
    if (built.ok) {
      expect(built.definition).not.toHaveProperty("titleField");
      expect(built.definition.listColumns).toStrictEqual(["subtitle"]);
      expect(built.definition.description).toBe("イベントの告知");
    }
  });

  it("displayOf returns nothing for a new type", () => {
    expect(displayOf(null)).toStrictEqual({});
  });
});
