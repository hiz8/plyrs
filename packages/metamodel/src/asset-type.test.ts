import { describe, expect, it } from "vitest";
import { contentTypeDefinitionSchema } from "./content-type";
import {
  ASSET_SYSTEM_MANAGED_FIELD_KEYS,
  ASSET_TYPE_DEFINITION,
  ASSET_TYPE_ID,
  ASSET_TYPE_KEY,
} from "./asset-type";

describe("ASSET_TYPE_DEFINITION (Phase 8 裁定 2)", () => {
  it("is a valid system content type definition", () => {
    const parsed = contentTypeDefinitionSchema.safeParse(ASSET_TYPE_DEFINITION);
    expect(parsed.success).toBe(true);
    expect(ASSET_TYPE_DEFINITION.key).toBe(ASSET_TYPE_KEY);
    expect(ASSET_TYPE_DEFINITION.id).toBe(ASSET_TYPE_ID);
    expect(ASSET_TYPE_DEFINITION.source).toBe("system");
  });

  it("declares every system-managed key as a field", () => {
    const fieldKeys = ASSET_TYPE_DEFINITION.fields.map((field) => field.key);
    for (const key of ASSET_SYSTEM_MANAGED_FIELD_KEYS) {
      expect(fieldKeys).toContain(key);
    }
    // alt / caption はユーザー編集可のためシステム管理キーに含めない(論点E)
    expect(ASSET_SYSTEM_MANAGED_FIELD_KEYS).not.toContain("alt");
    expect(ASSET_SYSTEM_MANAGED_FIELD_KEYS).not.toContain("caption");
  });

  it("requires the storage-critical fields", () => {
    const required = ASSET_TYPE_DEFINITION.fields
      .filter((field) => field.required === true)
      .map((field) => field.key);
    expect(required.toSorted()).toEqual(["content_type", "filename", "r2_key", "size"]);
  });
});
