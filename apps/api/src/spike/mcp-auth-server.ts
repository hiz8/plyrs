// spike(M0-3): @cloudflare/workers-oauth-provider v1 の分割 API(OAuthAuthorizationServer /
// OAuthResourceServer)を plyrs の前提(テナント別 URL、admin オリジンのセッション、api Worker への
// 集約)に当てはめる試作。本実装ではない — 結果は docs/superpowers/plans/2026-11-01-m0-3-oauth-spike-result.md。
//
// 設計の骨子:
// - issuer はテナントごとにパスを持つ(`${ADMIN_ORIGIN}/oauth/t/<tenantId>`)。resources は構築時に固定
//   されるため、テナントを URL から決めて OAuthAuthorizationServer を要求ごとに組み立てる。
//   authorize / token / register / well-known がすべて issuer のパス配下に並ぶので、どの入口でも
//   URL だけからテナントが決まる。
// - resource(audience)は api Worker の直接オリジン(`${API_ORIGIN}/mcp/t/<tenantId>`)。
import {
  OAuthAuthorizationServer,
  OAuthResourceServer,
  type OAuthResourceAuth,
  type OAuthResourceContext,
} from "@cloudflare/workers-oauth-provider";
import type { Operation, Role } from "../auth/permissions";

export const ADMIN_ORIGIN = "https://admin.example";
export const API_ORIGIN = "https://api.example";

// design-spec 16.3: DO の Operation をそのままスコープ名にする
export const MCP_SCOPES: readonly Operation[] = [
  "record:read",
  "record:write",
  "record:delete",
  "record:publish",
  "type:manage",
];

// access token は既存 JWT と同じ 15 分(16.3)
export const ACCESS_TOKEN_TTL = 900;

export interface McpGrantProps {
  userId: string;
  tenantId: string;
  role: Role;
}

export function tenantIssuer(tenantId: string): string {
  return `${ADMIN_ORIGIN}/oauth/t/${tenantId}`;
}

export function tenantResource(tenantId: string): string {
  return `${API_ORIGIN}/mcp/t/${tenantId}`;
}

const TENANT_ISSUER_PATH = /^\/oauth\/t\/([0-9a-f-]{36})(\/|$)/;
const TENANT_WELL_KNOWN_PATH =
  /^\/\.well-known\/oauth-authorization-server\/oauth\/t\/([0-9a-f-]{36})$/;

// 認可サーバー側の入口 URL からテナントを決める(authorize / token / register / well-known)
export function tenantFromIssuerPath(pathname: string): string | null {
  const direct = TENANT_ISSUER_PATH.exec(pathname);
  if (direct?.[1] !== undefined) {
    return direct[1];
  }
  const wellKnown = TENANT_WELL_KNOWN_PATH.exec(pathname);
  return wellKnown?.[1] ?? null;
}

export function createTenantAuthServer(
  tenantId: string,
  options: { cimd?: boolean } = {},
): OAuthAuthorizationServer<Env> {
  return new OAuthAuthorizationServer<Env>({
    issuer: tenantIssuer(tenantId),
    resources: [tenantResource(tenantId)],
    scopesSupported: [...MCP_SCOPES],
    accessTokenTTL: ACCESS_TOKEN_TTL,
    // CIMD は global_fetch_strictly_public が必要(README)。有効化の可否はテストで確かめる
    clientIdMetadataDocumentEnabled: options.cimd ?? false,
  });
}

export type McpResourceHandler = (
  request: Request,
  env: Env,
  ctx: OAuthResourceContext<McpGrantProps>,
) => Response | Promise<Response>;

// リソースサーバー(MCP の入口)。validateToken は差し替え可能にして、PAT と OAuth の合流を試す
export function createTenantResourceServer(
  tenantId: string,
  validateToken: (
    env: Env,
    request: Request,
  ) => (resource: string, token: string) => Promise<ValidatedMcpToken | null>,
  handler: McpResourceHandler,
): OAuthResourceServer<Env, McpGrantProps> {
  return new OAuthResourceServer<Env, McpGrantProps>({
    resourceMetadata: {
      resource: tenantResource(tenantId),
      authorization_servers: [tenantIssuer(tenantId)],
      resource_name: "plyrs MCP",
    },
    requiredScopes: ["record:read"],
    validateToken,
    handler: { fetch: handler },
  });
}

export interface ValidatedMcpToken {
  props: McpGrantProps;
  audience: string;
  expiresAt?: number;
  scope?: string[];
  userId?: string;
  clientId?: string;
}

export type { OAuthResourceAuth };
