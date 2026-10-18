import { describe, expect, it } from "vitest";
import { contentTypeDefinitionSchema, titleFieldKey } from "./content-type";

const UUID = "018f2b6a-7a0a-7000-8000-000000000001";

const baseType = {
  id: UUID,
  key: "article",
  name: "記事",
  fields: [
    { key: "title", type: "text", required: true },
    { key: "body", type: "richtext" },
  ],
  source: "user",
  version: 1,
};

describe("contentTypeDefinitionSchema", () => {
  it("accepts a valid user type", () => {
    expect(contentTypeDefinitionSchema.safeParse(baseType).success).toBe(true);
  });

  it("rejects duplicate field keys", () => {
    const result = contentTypeDefinitionSchema.safeParse({
      ...baseType,
      fields: [
        { key: "title", type: "text" },
        { key: "title", type: "number" },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a user type key containing a dot (reserved for plugins)", () => {
    const result = contentTypeDefinitionSchema.safeParse({ ...baseType, key: "booking.slot" });
    expect(result.success).toBe(false);
  });

  it("rejects pluginId on a user type", () => {
    const result = contentTypeDefinitionSchema.safeParse({ ...baseType, pluginId: "booking" });
    expect(result.success).toBe(false);
  });

  it("accepts a plugin type with a namespaced key", () => {
    const result = contentTypeDefinitionSchema.safeParse({
      ...baseType,
      key: "booking.slot",
      source: "plugin",
      pluginId: "booking",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a plugin type without pluginId", () => {
    const result = contentTypeDefinitionSchema.safeParse({
      ...baseType,
      key: "booking.slot",
      source: "plugin",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a plugin type whose key is outside its namespace", () => {
    const result = contentTypeDefinitionSchema.safeParse({
      ...baseType,
      key: "mailer.campaign",
      source: "plugin",
      pluginId: "booking",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a non-uuid id and a non-positive version", () => {
    expect(contentTypeDefinitionSchema.safeParse({ ...baseType, id: "not-a-uuid" }).success).toBe(
      false,
    );
    expect(contentTypeDefinitionSchema.safeParse({ ...baseType, version: 0 }).success).toBe(false);
  });

  it("rejects an uppercase UUID id (ids are stored lowercase)", () => {
    const result = contentTypeDefinitionSchema.safeParse({
      ...baseType,
      id: UUID.toUpperCase(),
    });
    expect(result.success).toBe(false);
  });
});

describe("display metadata (案 E 2 章)", () => {
  const withSubtitle = {
    ...baseType,
    fields: [
      {
        key: "title",
        type: "text",
        required: true,
        label: "タイトル",
        description: "一覧に出ます",
      },
      { key: "subtitle", type: "text" },
      { key: "starts_at", type: "datetime", label: "開始日時" },
      { key: "body", type: "richtext" },
    ],
  };

  it("keeps existing definitions valid (all items are optional)", () => {
    const parsed = contentTypeDefinitionSchema.parse(baseType);
    expect(parsed).not.toHaveProperty("description");
    expect(parsed).not.toHaveProperty("titleField");
    expect(parsed.fields[0]).not.toHaveProperty("label");
  });

  it("accepts field label/description and type description/titleField/listColumns/menuOrder", () => {
    const parsed = contentTypeDefinitionSchema.parse({
      ...withSubtitle,
      description: "  お知らせを書きます  ",
      titleField: "subtitle",
      listColumns: ["starts_at", "subtitle"],
      menuOrder: -2,
    });
    expect(parsed.description).toBe("お知らせを書きます");
    expect(parsed.titleField).toBe("subtitle");
    expect(parsed.listColumns).toStrictEqual(["starts_at", "subtitle"]);
    expect(parsed.menuOrder).toBe(-2);
    expect(parsed.fields[0]).toMatchObject({ label: "タイトル", description: "一覧に出ます" });
  });

  it("rejects blank or overlong labels and descriptions", () => {
    const blankLabel = {
      ...baseType,
      fields: [{ key: "title", type: "text", label: "  " }],
    };
    expect(contentTypeDefinitionSchema.safeParse(blankLabel).success).toBe(false);
    const longLabel = {
      ...baseType,
      fields: [{ key: "title", type: "text", label: "あ".repeat(101) }],
    };
    expect(contentTypeDefinitionSchema.safeParse(longLabel).success).toBe(false);
    expect(
      contentTypeDefinitionSchema.safeParse({ ...baseType, description: "x".repeat(1001) }).success,
    ).toBe(false);
  });

  it("rejects a titleField that is missing or not a text field", () => {
    expect(
      contentTypeDefinitionSchema.safeParse({ ...withSubtitle, titleField: "nope" }).success,
    ).toBe(false);
    expect(
      contentTypeDefinitionSchema.safeParse({ ...withSubtitle, titleField: "starts_at" }).success,
    ).toBe(false);
  });

  it("rejects listColumns over the limit, duplicated or pointing to unknown fields", () => {
    const tooMany = { ...withSubtitle, listColumns: ["title", "subtitle", "starts_at", "body"] };
    expect(contentTypeDefinitionSchema.safeParse(tooMany).success).toBe(false);
    const duplicated = { ...withSubtitle, listColumns: ["title", "title"] };
    expect(contentTypeDefinitionSchema.safeParse(duplicated).success).toBe(false);
    const unknown = { ...withSubtitle, listColumns: ["nope"] };
    expect(contentTypeDefinitionSchema.safeParse(unknown).success).toBe(false);
  });

  it("rejects a non-integer menuOrder", () => {
    expect(contentTypeDefinitionSchema.safeParse({ ...baseType, menuOrder: 1.5 }).success).toBe(
      false,
    );
  });
});

describe("titleFieldKey", () => {
  const fields = [
    { key: "code", type: "number" as const },
    { key: "title", type: "text" as const },
    { key: "subtitle", type: "text" as const },
  ];

  it("uses titleField when it points to a text field", () => {
    expect(titleFieldKey({ fields, titleField: "subtitle" })).toBe("subtitle");
  });

  it("falls back to the first text field when titleField is unset or stale", () => {
    expect(titleFieldKey({ fields })).toBe("title");
    expect(titleFieldKey({ fields, titleField: "removed" })).toBe("title");
    expect(titleFieldKey({ fields, titleField: "code" })).toBe("title");
  });

  it("returns undefined when there is no text field", () => {
    expect(titleFieldKey({ fields: [{ key: "code", type: "number" }] })).toBeUndefined();
  });
});
