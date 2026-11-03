import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { app } from "../src/index";
import {
  ACCESS_TOKEN_TTL,
  createTenantAuthServer,
  OAUTH_SCOPES,
  tenantIssuer,
  tenantResource,
} from "../src/oauth/server";
import {
  ADMIN_ORIGIN,
  API_ORIGIN,
  authorize,
  CTX,
  insertTenant,
  oauthEnv,
  registerClient,
} from "./oauth-helpers";

// M3-1(design-spec 16.2・16.3、決定 47): テナント別の OAuth 認可サーバー。issuer は admin オリジンの
// `/oauth/t/:tenantId`、resource は api オリジンの `/mcp/t/:tenantId`。metadata・DCR・認可コード + PKCE・
// 別インスタンス / 別テナントでの検証・未設定時の 503 を固定する。

function metadataUrl(tenantId: string): string {
  return `${ADMIN_ORIGIN}/.well-known/oauth-authorization-server/oauth/t/${tenantId}`;
}

describe("OAuth 認可サーバー(/oauth/t/:tenantId)", () => {
  it("Authorization Server Metadata をテナント別 issuer 配下で返し、CIMD と DCR を宣言する", async () => {
    const tenantId = await insertTenant();
    const res = await app.request(metadataUrl(tenantId), {}, oauthEnv(), CTX);
    expect(res.status).toBe(200);
    const meta = await res.json<Record<string, unknown>>();
    const issuer = tenantIssuer(ADMIN_ORIGIN, tenantId);
    expect(meta["issuer"]).toBe(issuer);
    expect(meta["authorization_endpoint"]).toBe(`${issuer}/authorize`);
    expect(meta["token_endpoint"]).toBe(`${issuer}/oauth/token`);
    expect(meta["registration_endpoint"]).toBe(`${issuer}/oauth/register`);
    expect(meta["protected_resources"]).toEqual([tenantResource(API_ORIGIN, tenantId)]);
    expect(meta["scopes_supported"]).toEqual([...OAUTH_SCOPES]);
    expect(meta["code_challenge_methods_supported"]).toEqual(["S256"]);
    // global_fetch_strictly_public(wrangler.jsonc の compatibility_flags)が無いと true にならない
    expect(meta["client_id_metadata_document_supported"]).toBe(true);
  });

  it("DCR(/oauth/register)で公開クライアントを登録できる", async () => {
    const tenantId = await insertTenant();
    const clientId = await registerClient(tenantId);
    expect(clientId.length).toBeGreaterThan(0);
  });

  it("認可コード + PKCE で token を得て、別インスタンスで検証できる(状態は KV にある)", async () => {
    const tenantId = await insertTenant();
    const issued = await authorize(tenantId, ["record:read", "record:write"]);
    expect(issued.expires_in).toBeLessThanOrEqual(ACCESS_TOKEN_TTL);
    expect(issued.refresh_token).toBeDefined();
    const other = createTenantAuthServer(oauthEnv(), tenantId);
    expect(other).not.toBeNull();
    const validated = await other!.validateToken(
      tenantResource(API_ORIGIN, tenantId),
      issued.access_token,
      oauthEnv(),
    );
    expect(validated).not.toBeNull();
    expect(validated!.props).toEqual({ userId: issued.userId, tenantId, role: "editor" });
    expect(validated!.scope).toEqual(["record:read", "record:write"]);
    expect(validated!.userId).toBe(issued.userId);
    expect(validated!.expiresAt - Math.floor(Date.now() / 1000)).toBeLessThanOrEqual(
      ACCESS_TOKEN_TTL,
    );
  });

  it("別テナントの認可サーバーでは同じ token が null(audience はテナントの resource に束縛される)", async () => {
    const tenantId = await insertTenant();
    const otherTenantId = await insertTenant();
    const issued = await authorize(tenantId, ["record:read"]);
    const other = createTenantAuthServer(oauthEnv(), otherTenantId);
    expect(
      await other!.validateToken(
        tenantResource(API_ORIGIN, otherTenantId),
        issued.access_token,
        oauthEnv(),
      ),
    ).toBeNull();
  });

  it("ADMIN_ORIGIN / API_ORIGIN が未設定なら metadata も token も 503(not_configured)", async () => {
    const tenantId = await insertTenant();
    for (const missing of [{ ADMIN_ORIGIN: undefined }, { API_ORIGIN: undefined }]) {
      const testEnv = oauthEnv(missing);
      const meta = await app.request(metadataUrl(tenantId), {}, testEnv, CTX);
      expect(meta.status).toBe(503);
      expect(await meta.json()).toEqual({ error: "not_configured", what: expect.any(String) });
      const token = await app.request(
        `${tenantIssuer(ADMIN_ORIGIN, tenantId)}/oauth/token`,
        { method: "POST", body: new URLSearchParams({ grant_type: "authorization_code" }) },
        testEnv,
        CTX,
      );
      expect(token.status).toBe(503);
      expect(createTenantAuthServer(testEnv, tenantId)).toBeNull();
    }
  });

  it("wrangler.jsonc のトップレベルに OAUTH_KV がある(vitest の binding)", () => {
    expect(env.OAUTH_KV).toBeDefined();
  });
});
