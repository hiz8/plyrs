import { describe, expect, it } from "vitest";
import { consentScopes, renderConsentPage } from "./consent-page";

// M3-2(design-spec 16.3、論点 C5): 同意画面の純関数。スコープの選択肢はロールの範囲(allowedScopes)、
// record:publish は所有者にだけ出し、要求されていても既定で外す。クライアント由来の文字列はエスケープする。

describe("consentScopes", () => {
  it("所有者には 5 つ出し、要求された record:read だけ checked、record:publish は要求されても unchecked", () => {
    expect(consentScopes("owner", ["record:read", "record:publish"])).toEqual([
      { value: "record:read", checked: true },
      { value: "record:write", checked: false },
      { value: "record:delete", checked: false },
      { value: "record:publish", checked: false },
      { value: "type:manage", checked: false },
    ]);
  });

  it("編集者には record:publish と type:manage を出さない(要求されても落とす)", () => {
    expect(consentScopes("editor", ["record:read", "type:manage"])).toEqual([
      { value: "record:read", checked: true },
      { value: "record:write", checked: false },
      { value: "record:delete", checked: false },
    ]);
  });

  it("閲覧者には record:read だけ", () => {
    expect(consentScopes("viewer", [])).toEqual([{ value: "record:read", checked: false }]);
  });
});

function page(overrides: Partial<Parameters<typeof renderConsentPage>[0]> = {}): string {
  return renderConsentPage({
    details: {
      clientId: "c1",
      clientName: "Some App",
      redirectUri: "http://localhost:3333/callback",
      redirectHost: "localhost",
      redirectIsLoopback: false,
      scope: ["record:read"],
    },
    handle: "h-1",
    scopes: [
      { value: "record:read", checked: true },
      { value: "record:write", checked: false },
    ],
    tenantName: "ブログ",
    email: "me@example.com",
    ...overrides,
  });
}

describe("renderConsentPage", () => {
  it("クライアント名をエスケープする", () => {
    const html = page({
      details: {
        clientId: "c1",
        clientName: "<b>evil</b>",
        redirectUri: "http://localhost:3333/callback",
        redirectHost: "localhost",
        redirectIsLoopback: false,
        scope: [],
      },
    });
    expect(html).toContain("&lt;b&gt;evil&lt;/b&gt;");
    expect(html).not.toContain("<b>evil</b>");
  });

  it("loopback の送り先には警告を出す", () => {
    expect(page()).not.toContain("このパソコン上のアプリ");
    expect(
      page({
        details: {
          clientId: "c1",
          clientName: "App",
          redirectUri: "http://127.0.0.1:1/cb",
          redirectHost: "127.0.0.1",
          redirectIsLoopback: true,
          scope: [],
        },
      }),
    ).toContain("このパソコン上のアプリ");
  });

  it("CIMD の発行元があれば表示し、無ければ自己申告の注記を出す", () => {
    expect(page()).toContain("自己登録");
    const cimd = page({
      details: {
        clientId: "https://app.example/.well-known/oauth-client",
        clientName: "App",
        clientDomain: "app.example",
        redirectUri: "https://app.example/cb",
        redirectHost: "app.example",
        redirectIsLoopback: false,
        scope: [],
      },
    });
    expect(cimd).toContain("app.example");
    expect(cimd).not.toContain("自己登録");
  });

  it("checked のスコープだけ checked 属性が付き、handle と送り先・テナント名・メールを含む", () => {
    const html = page();
    expect(html).toMatch(/name="scope"\s+value="record:read"[^>]*checked/);
    expect(html).not.toMatch(/name="scope"\s+value="record:write"[^>]*checked/);
    expect(html).toContain('name="handle" value="h-1"');
    expect(html).toContain("localhost");
    expect(html).toContain("ブログ");
    expect(html).toContain("me@example.com");
  });
});
