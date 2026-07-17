import { describe, expect, it } from "vitest";
import { isApiPath } from "./api-paths";

describe("isApiPath", () => {
  it("matches exact prefixes and their subpaths", () => {
    expect(isApiPath("/auth")).toBe(true);
    expect(isApiPath("/auth/token")).toBe(true);
    expect(isApiPath("/v1")).toBe(true);
    expect(isApiPath("/v1/t/t1/sync")).toBe(true);
  });

  it("does not match lookalike prefixes or app routes", () => {
    expect(isApiPath("/authx")).toBe(false);
    expect(isApiPath("/v10/records")).toBe(false);
    expect(isApiPath("/")).toBe(false);
    expect(isApiPath("/t/blog/content-types")).toBe(false);
    // /public/v1 はヘッドレス契約 = api Worker の直接責務（プロキシしない）
    expect(isApiPath("/public/v1/blog/records/post")).toBe(false);
  });
});
