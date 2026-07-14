import type { FieldDefinition } from "@plyrs/metamodel";
import { describe, expect, it } from "vitest";
import {
  buildProjectionPayload,
  catalogRowsForFields,
  promoteSlug,
  type PublishedSnapshot,
} from "./payload";

const fields: FieldDefinition[] = [
  { key: "title", type: "text", required: true },
  { key: "slug", type: "text", required: true, config: { unique: true, indexed: true } },
  { key: "published_at", type: "datetime", config: { indexed: true } },
  { key: "reading_minutes", type: "number", config: { indexed: true } },
  { key: "featured", type: "boolean", config: { indexed: true } },
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
    config: { allowedTypes: ["author"], cardinality: "many", ordered: true },
  },
];

function snapshot(data: Record<string, unknown>): PublishedSnapshot {
  return {
    recordId: "r1",
    type: "article",
    data,
    relations: [
      { sourceField: "authors", targetType: "author", targetId: "a1", ordinal: 0, origin: "field" },
    ],
    publishedAt: "2026-07-13T00:00:00.000Z",
    publishedBy: "u1",
    sourceVersion: 3,
    publishSeq: 5,
  };
}

describe("buildProjectionPayload", () => {
  it("promotes a unique text field keyed 'slug' into the slug column (G4)", () => {
    expect(promoteSlug(fields, { slug: "hello" })).toBe("hello");
  });

  it("does not promote a 'slug' field that is not declared unique", () => {
    const notUnique: FieldDefinition[] = [{ key: "slug", type: "text" }];
    expect(promoteSlug(notUnique, { slug: "hello" })).toBeNull();
  });

  it("leaves slug null when the value is missing or empty", () => {
    expect(promoteSlug(fields, {})).toBeNull();
    expect(promoteSlug(fields, { slug: "" })).toBeNull();
  });

  it("routes indexed values into the typed columns", () => {
    const payload = buildProjectionPayload(
      fields,
      snapshot({
        title: "t",
        slug: "hello",
        published_at: "2026-07-01T00:00:00.000Z",
        reading_minutes: 7,
        featured: true,
        tags: ["tech", "life"],
      }),
    );
    expect(payload.index).toContainEqual({
      fieldKey: "slug",
      valueText: "hello",
      valueNum: null,
      valueDate: null,
    });
    expect(payload.index).toContainEqual({
      fieldKey: "published_at",
      valueText: null,
      valueNum: null,
      valueDate: "2026-07-01T00:00:00.000Z",
    });
    expect(payload.index).toContainEqual({
      fieldKey: "reading_minutes",
      valueText: null,
      valueNum: 7,
      valueDate: null,
    });
    expect(payload.index).toContainEqual({
      fieldKey: "featured",
      valueText: null,
      valueNum: 1,
      valueDate: null,
    });
  });

  it("emits one row per value for an indexed multi-select (any-of semantics)", () => {
    const payload = buildProjectionPayload(fields, snapshot({ tags: ["tech", "life"] }));
    const tagRows = payload.index.filter((row) => row.fieldKey === "tags");
    expect(tagRows.map((row) => row.valueText)).toStrictEqual(["tech", "life"]);
  });

  it("skips fields that are absent, null, or not indexed", () => {
    const payload = buildProjectionPayload(fields, snapshot({ title: "t", body: { doc: {} } }));
    expect(payload.index).toStrictEqual([]);
  });

  it("skips values whose runtime type does not match the field type (tolerant read)", () => {
    const payload = buildProjectionPayload(
      fields,
      snapshot({ reading_minutes: "seven", featured: "yes", slug: 42 }),
    );
    expect(payload.index).toStrictEqual([]);
    expect(payload.slug).toBeNull();
  });

  it("carries the record, relations, source version, and publish seq through unchanged", () => {
    const payload = buildProjectionPayload(fields, snapshot({ slug: "hello", title: "t" }));
    expect(payload).toMatchObject({
      recordId: "r1",
      type: "article",
      slug: "hello",
      publishedAt: "2026-07-13T00:00:00.000Z",
      sourceVersion: 3,
      publishSeq: 5,
      data: { slug: "hello", title: "t" },
    });
    expect(payload.relations).toStrictEqual([
      { sourceField: "authors", targetType: "author", targetId: "a1", ordinal: 0, origin: "field" },
    ]);
  });

  it("degrades to an empty index when the content type is unknown (fields = [])", () => {
    const payload = buildProjectionPayload([], snapshot({ slug: "hello" }));
    expect(payload.index).toStrictEqual([]);
    expect(payload.slug).toBeNull();
  });
});

// Phase 5b: 公開 read API が「フィルタ/ソート可能なフィールドと型別カラム」を DO 非経由で
// 知るためのカタログ。indexed 宣言済みスカラーと関係フィールドだけが載る = 「フィルタ/ソートは
// 索引宣言済みフィールドに限る」（§12.4）の実体。
describe("catalogRowsForFields", () => {
  it("lists indexed scalar fields with their typed column kind", () => {
    const rows = catalogRowsForFields(fields);
    expect(rows).toContainEqual({ fieldKey: "slug", kind: "text", multi: false });
    expect(rows).toContainEqual({ fieldKey: "published_at", kind: "date", multi: false });
    expect(rows).toContainEqual({ fieldKey: "reading_minutes", kind: "num", multi: false });
    expect(rows).toContainEqual({ fieldKey: "featured", kind: "bool", multi: false });
  });

  it("marks an indexed multi-select as multi (sortable: no, filter: any-of)", () => {
    const rows = catalogRowsForFields(fields);
    expect(rows).toContainEqual({ fieldKey: "tags", kind: "text", multi: true });
  });

  it("always lists relation fields (projected_relations is projected unconditionally)", () => {
    const rows = catalogRowsForFields(fields);
    expect(rows).toContainEqual({ fieldKey: "authors", kind: "relation", multi: true });
  });

  it("omits fields that are not indexed and cannot be filtered", () => {
    const keys = catalogRowsForFields(fields).map((row) => row.fieldKey);
    expect(keys).not.toContain("title"); // indexed 宣言なし
    expect(keys).not.toContain("body"); // richtext は indexed を持てない
  });

  it("rides on buildProjectionPayload", () => {
    const payload = buildProjectionPayload(fields, snapshot({ slug: "hello" }));
    expect(payload.catalog).toStrictEqual(catalogRowsForFields(fields));
  });
});
