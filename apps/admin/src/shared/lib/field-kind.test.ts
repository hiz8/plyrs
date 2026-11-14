import { describe, expect, it } from "vitest";
import { kindOf } from "./field-kind";

describe("kindOf", () => {
  it("slug / asset / reference を設定から見分ける", () => {
    expect(kindOf({ key: "slug", type: "text", config: { unique: true } })).toBe("slug");
    expect(kindOf({ key: "slug", type: "text" })).toBe("text");
    expect(
      kindOf({
        key: "eyecatch",
        type: "relation",
        config: { allowedTypes: ["asset"], cardinality: "one", snapshotEmbed: "value" },
      }),
    ).toBe("asset");
    expect(
      kindOf({
        key: "authors",
        type: "relation",
        config: { allowedTypes: ["author"], cardinality: "many" },
      }),
    ).toBe("reference");
  });
});
