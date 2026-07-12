import { describe, expect, it } from "vitest";
import { fieldDefinitionSchema } from "./field-types";

describe("fieldDefinitionSchema", () => {
  it("accepts a minimal text field", () => {
    const result = fieldDefinitionSchema.safeParse({ key: "title", type: "text" });
    expect(result.success).toBe(true);
  });

  it("accepts a text field with maxLength / indexed / unique config", () => {
    const result = fieldDefinitionSchema.safeParse({
      key: "slug",
      type: "text",
      required: true,
      config: { maxLength: 200, indexed: true, unique: true },
    });
    expect(result.success).toBe(true);
  });

  it("rejects a key that collides with a system field", () => {
    const result = fieldDefinitionSchema.safeParse({ key: "createdAt", type: "text" });
    expect(result.success).toBe(false);
  });

  it("rejects a key that is not snake_case", () => {
    for (const key of ["Title", "1title", "my-field", "my.field"]) {
      expect(fieldDefinitionSchema.safeParse({ key, type: "text" }).success).toBe(false);
    }
  });

  it("rejects unknown config keys (strict objects)", () => {
    const result = fieldDefinitionSchema.safeParse({
      key: "title",
      type: "text",
      config: { maxLenght: 10 },
    });
    expect(result.success).toBe(false);
  });

  it("rejects indexed/unique on a json field (opaque escape hatch)", () => {
    const result = fieldDefinitionSchema.safeParse({
      key: "meta",
      type: "json",
      config: { indexed: true },
    });
    expect(result.success).toBe(false);
  });

  it("accepts a select field and rejects duplicate option values", () => {
    const base = {
      key: "category",
      type: "select",
      config: {
        options: [
          { value: "tech", label: "Tech" },
          { value: "life", label: "Life" },
        ],
        multiple: true,
        indexed: true,
      },
    };
    expect(fieldDefinitionSchema.safeParse(base).success).toBe(true);

    const dup = {
      ...base,
      config: {
        ...base.config,
        options: [
          { value: "tech", label: "Tech" },
          { value: "tech", label: "Tech again" },
        ],
      },
    };
    expect(fieldDefinitionSchema.safeParse(dup).success).toBe(false);
  });

  it("accepts a relation field with full config", () => {
    const result = fieldDefinitionSchema.safeParse({
      key: "authors",
      type: "relation",
      required: true,
      config: {
        allowedTypes: ["author"],
        cardinality: "many",
        ordered: true,
        snapshotEmbed: "id",
      },
    });
    expect(result.success).toBe(true);
  });

  it("rejects a relation field with empty allowedTypes or missing cardinality", () => {
    expect(
      fieldDefinitionSchema.safeParse({
        key: "authors",
        type: "relation",
        config: { allowedTypes: [], cardinality: "many" },
      }).success,
    ).toBe(false);
    expect(
      fieldDefinitionSchema.safeParse({
        key: "authors",
        type: "relation",
        config: { allowedTypes: ["author"] },
      }).success,
    ).toBe(false);
  });

  it("accepts richtext and datetime fields", () => {
    expect(fieldDefinitionSchema.safeParse({ key: "body", type: "richtext" }).success).toBe(true);
    expect(
      fieldDefinitionSchema.safeParse({
        key: "published_at",
        type: "datetime",
        config: { indexed: true },
      }).success,
    ).toBe(true);
  });
});
