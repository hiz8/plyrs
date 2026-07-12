import { describe, expect, it } from "vitest";
import { contentTypeDefinitionSchema } from "./content-type";

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
});
