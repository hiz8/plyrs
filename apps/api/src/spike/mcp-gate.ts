// spike(M0-3): MCP 入口の認証。PAT と OAuth を同じ認可コンテキストに合流させ、既存 JWT と同じ
// BLOCKLIST 照会(blocked:user / blocked:membership)を両経路に適用する(design-spec 16.3)。
import { OAuthError } from "@cloudflare/workers-oauth-provider";
import { isBlocked, isMembershipBlocked } from "../auth/blocklist";
import type { Operation } from "../auth/permissions";
import type { SocketAuth } from "../sync/session";
import { createTenantAuthServer, tenantResource, type ValidatedMcpToken } from "./mcp-auth-server";
import { isPatShaped, verifyPat } from "./pat";

// 既存の認可コンテキスト {userId, role, tenantId, exp} に scopes / tokenId / via を足す(16.3)
export interface McpAuth extends SocketAuth {
  scopes: Operation[];
  tokenId: string;
  via: "pat" | "oauth";
}

export type McpGateResult =
  | { ok: true; auth: McpAuth }
  | { ok: false; code: "unauthenticated" | "blocked"; status: 401 | 403 };

export async function authenticateMcpToken(
  env: Env,
  tenantId: string,
  token: string,
  now: Date = new Date(),
): Promise<McpGateResult> {
  let auth: McpAuth;
  if (isPatShaped(token)) {
    const pat = await verifyPat(env.DB, tenantId, token, now);
    if (pat === null) {
      return { ok: false, code: "unauthenticated", status: 401 };
    }
    auth = {
      userId: pat.userId,
      role: pat.role,
      tenantId,
      exp: pat.expiresAt,
      scopes: pat.scopes,
      tokenId: pat.tokenId,
      via: "pat",
    };
  } else {
    const validated = await createTenantAuthServer(tenantId).validateToken<
      ValidatedMcpToken["props"]
    >(tenantResource(tenantId), token, env);
    if (validated === null || validated.props.tenantId !== tenantId) {
      return { ok: false, code: "unauthenticated", status: 401 };
    }
    auth = {
      userId: validated.userId,
      role: validated.props.role,
      tenantId,
      exp: validated.expiresAt,
      scopes: validated.scope.filter((s): s is Operation => s.length > 0),
      // grant 単位で失効させるため、token 文字列ではなく userId:grantId を識別子にする
      tokenId: `${validated.userId}:${validated.clientId}`,
      via: "oauth",
    };
  }
  if (await isBlocked(env.BLOCKLIST, auth.userId)) {
    return { ok: false, code: "blocked", status: 403 };
  }
  if (await isMembershipBlocked(env.BLOCKLIST, auth.userId, tenantId)) {
    return { ok: false, code: "blocked", status: 403 };
  }
  return { ok: true, auth };
}

// OAuthResourceServer の validateToken に差し込む形。403(blocked)は OAuthError で表現する
export function mcpTokenValidator(tenantId: string) {
  return (env: Env) =>
    async (resource: string, token: string): Promise<ValidatedMcpToken | null> => {
      const result = await authenticateMcpToken(env, tenantId, token);
      if (!result.ok) {
        if (result.code === "blocked") {
          throw new OAuthError("invalid_token", { description: "blocked", statusCode: 403 });
        }
        return null;
      }
      return {
        props: { userId: result.auth.userId, tenantId, role: result.auth.role },
        audience: resource,
        expiresAt: result.auth.exp,
        scope: result.auth.scopes,
        userId: result.auth.userId,
      };
    };
}
