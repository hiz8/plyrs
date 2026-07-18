import { describe, expect, it } from "vitest";
import { assetKeyBelongsToTenant } from "./ownership";

describe("assetKeyBelongsToTenant", () => {
  it("accepts a key prefixed with the tenant id", () => {
    expect(assetKeyBelongsToTenant("t1/asset-1", "t1")).toBe(true);
  });

  it("rejects a key prefixed with a different tenant id", () => {
    expect(assetKeyBelongsToTenant("t2/asset-1", "t1")).toBe(false);
  });

  it("rejects a merely-prefix-matching id without the separator", () => {
    // "t1" は "t10/..." の文字列先頭に現れるが、区切り "/" が無ければ別テナント
    expect(assetKeyBelongsToTenant("t10/asset-1", "t1")).toBe(false);
  });

  it("rejects an empty key", () => {
    expect(assetKeyBelongsToTenant("", "t1")).toBe(false);
  });
});
