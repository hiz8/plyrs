import { OAuthAuthorizationServer } from "@cloudflare/workers-oauth-provider";
import { PAT_SCOPES } from "../auth/pat";
import type { Role } from "../auth/permissions";

// design-spec 16.2・16.3(決定 47、M3-1): OAuth 2.1 の認可サーバー。@cloudflare/workers-oauth-provider v1 の
// 分割 API(OAuthAuthorizationServer)を api Worker に置く。issuer は admin オリジンのテナント別パス
// (admin が /oauth と /.well-known/oauth-authorization-server を api へ同一オリジン転送する)、resource は
// api オリジンのテナント別 MCP URL(= MCP の入口が PRM で出す resource)。どちらも URL と vars から決まる
// ので、認可サーバーのオブジェクトは要求ごとに組み立てる(構築 0.04 ms、M0-3 結果)。状態は OAUTH_KV にだけある。

// スコープ名は DO の Operation そのもの(16.3)。PAT と同じ集合(auth/pat.ts)
export const OAUTH_SCOPES = PAT_SCOPES;

// access token の TTL は既存 JWT と同じ 15 分(16.3)。refresh token はライブラリ既定の 30 日
export const ACCESS_TOKEN_TTL = 900;

// 同意時にグラントの props に入れる値。validateToken が復号して返し、MCP の入口が McpAuth に合流させる(決定 49)。
// ロールは access token の 15 分の間は固定で、refresh のたびに memberships から読み直す(M3-4)
export interface McpGrantProps {
  userId: string;
  tenantId: string;
  role: Role;
}

// 認可サーバーの issuer(admin オリジンのテナント別パス、16.2)。metadata は
// `${ADMIN_ORIGIN}/.well-known/oauth-authorization-server/oauth/t/:tenantId`
export function tenantIssuer(adminOrigin: string, tenantId: string): string {
  return `${adminOrigin}/oauth/t/${tenantId}`;
}

// MCP の入口 = token の audience(決定 48)
export function tenantResource(apiOrigin: string, tenantId: string): string {
  return `${apiOrigin}/mcp/t/${tenantId}`;
}

export interface OAuthOrigins {
  adminOrigin: string;
  apiOrigin: string;
}

// ADMIN_ORIGIN / API_ORIGIN の両方が無いと issuer と resource を組めない(設定事故は 503 で閉じる)
export function oauthOrigins(env: Env): OAuthOrigins | null {
  if (env.ADMIN_ORIGIN === undefined || env.API_ORIGIN === undefined) {
    return null;
  }
  return { adminOrigin: env.ADMIN_ORIGIN, apiOrigin: env.API_ORIGIN };
}

export function createTenantAuthServer(
  env: Env,
  tenantId: string,
): OAuthAuthorizationServer<Env> | null {
  const origins = oauthOrigins(env);
  if (origins === null) {
    return null;
  }
  const issuer = tenantIssuer(origins.adminOrigin, tenantId);
  return new OAuthAuthorizationServer<Env>({
    issuer,
    // resources は構築時に固定される。テナントを issuer のパスで運ぶのはこのため(決定 47)
    resources: [tenantResource(origins.apiOrigin, tenantId)],
    scopesSupported: [...OAUTH_SCOPES],
    accessTokenTTL: ACCESS_TOKEN_TTL,
    // 登録は CIMD を優先し、DCR(RFC 7591、Deprecated)は fallback として残す(16.3)。CIMD の取得には
    // wrangler.jsonc の compatibility_flags `global_fetch_strictly_public` が要る
    clientIdMetadataDocumentEnabled: true,
    clientRegistrationEndpoint: `${issuer}/oauth/register`,
    // 失敗した検査(internal)は wire には出ない。トークンや本文はログに出さない
    onError({ code, status, internal }) {
      console.warn("oauth", tenantId, code, status, internal.category, internal.reason);
    },
  });
}
