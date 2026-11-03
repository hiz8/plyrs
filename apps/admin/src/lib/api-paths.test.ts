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
    expect(isApiPath("/t/blog/settings/content-types")).toBe(false);
    // /public/v1 はヘッドレス契約 = api Worker の直接責務（プロキシしない）
    expect(isApiPath("/public/v1/blog/records/post")).toBe(false);
  });

  it("forwards the OAuth authorization server (M3-1)", () => {
    expect(isApiPath("/oauth/t/abc/authorize")).toBe(true);
    expect(isApiPath("/oauth/t/abc/oauth/token")).toBe(true);
    expect(isApiPath("/.well-known/oauth-authorization-server/oauth/t/abc")).toBe(true);
    expect(isApiPath("/oauth-x")).toBe(false);
    // PRM は api の直接オリジン(決定 48)。dev 限定の転送は server-routing.ts
    expect(isApiPath("/.well-known/oauth-protected-resource/mcp/t/abc")).toBe(false);
  });

  it("forwards super paths", () => {
    expect(isApiPath("/super-auth/login")).toBe(true);
    expect(isApiPath("/super/v1/tenants")).toBe(true);
    expect(isApiPath("/super")).toBe(false); // ページルートは転送しない
    expect(isApiPath("/super-login")).toBe(false);
  });
});
