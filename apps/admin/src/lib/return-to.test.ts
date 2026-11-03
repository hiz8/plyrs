import { describe, expect, it } from "vitest";
import { safeReturnTo } from "./return-to";

describe("safeReturnTo", () => {
  it("同一オリジンの /oauth/t/:tenantId/authorize だけを通す(クエリ付きも)", () => {
    expect(safeReturnTo("/oauth/t/abc/authorize")).toBe("/oauth/t/abc/authorize");
    expect(safeReturnTo("/oauth/t/abc/authorize?client_id=x&state=s")).toBe(
      "/oauth/t/abc/authorize?client_id=x&state=s",
    );
  });

  it("別オリジンや他のパスは捨てる(オープンリダイレクト対策)", () => {
    expect(safeReturnTo("https://evil.example/")).toBeNull();
    expect(safeReturnTo("//evil.example")).toBeNull();
    expect(safeReturnTo("/tenants")).toBeNull();
    expect(safeReturnTo("/oauth/t/abc/oauth/token")).toBeNull();
    expect(safeReturnTo("/oauth/t/abc/authorize/../x")).toBeNull();
    expect(safeReturnTo("/oauth/t/abc/authorize?x=1\r\nSet-Cookie:a")).toBeNull();
    expect(safeReturnTo("/oauth/t/abc/authorize#frag")).toBeNull();
    expect(safeReturnTo(42)).toBeNull();
    expect(safeReturnTo(undefined)).toBeNull();
  });
});
