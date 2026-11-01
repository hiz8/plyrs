import { OAuthError } from "@cloudflare/workers-oauth-provider";
import { isBlocked, isMembershipBlocked } from "../auth/blocklist";
import { isPatShaped, verifyPat } from "../auth/pat";
import type { Role } from "../auth/permissions";
import type { McpAuth } from "../do/authorize";

// design-spec 16.3(決定 49、M1-3b): MCP の入口の認証。PAT を検証して認可コンテキスト McpAuth に合流させ、
// 既存 JWT と同じ BLOCKLIST 照会(blocked:user / blocked:membership)を適用する。M3-3 で OAuth の分岐が
// ここに入り、同じ McpAuth に合流する(M0-3 の試作 spike/mcp-oauth を本実装に移したもの)。

export type McpGateResult =
  | { ok: true; auth: McpAuth }
  | { ok: false; code: "unauthenticated" | "blocked"; status: 401 | 403 };

export async function authenticateMcpToken(
  env: Env,
  tenantId: string,
  token: string,
  now: Date = new Date(),
): Promise<McpGateResult> {
  // 接頭辞で振り分ける。PAT の形でなければ M1 では常に unauthenticated(OAuth は M3-3)
  if (!isPatShaped(token)) {
    return { ok: false, code: "unauthenticated", status: 401 };
  }
  const pat = await verifyPat(env.DB, tenantId, token, now);
  if (pat === null) {
    return { ok: false, code: "unauthenticated", status: 401 };
  }
  if (await isBlocked(env.BLOCKLIST, pat.userId)) {
    return { ok: false, code: "blocked", status: 403 };
  }
  if (await isMembershipBlocked(env.BLOCKLIST, pat.userId, tenantId)) {
    return { ok: false, code: "blocked", status: 403 };
  }
  return {
    ok: true,
    auth: {
      userId: pat.userId,
      role: pat.role,
      tenantId,
      exp: pat.expiresAt,
      scopes: pat.scopes,
      tokenId: pat.tokenId,
      tokenKind: "pat",
    },
  };
}

// OAuthResourceServer の ctx.props に載せる値。ハンドラはここから McpAuth を組み立て直す
export interface McpTokenProps {
  userId: string;
  tenantId: string;
  role: Role;
  tokenId: string;
  tokenKind: McpAuth["tokenKind"];
}

export interface ValidatedMcpToken {
  props: McpTokenProps;
  audience: string;
  expiresAt?: number;
  scope?: string[];
  userId?: string;
  clientId?: string;
}

// OAuthResourceServer の validateToken に差し込む形。null は 401 の challenge、blocked は
// OAuthError(403)で表現する(ライブラリが WWW-Authenticate を出す)
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
      const { auth } = result;
      return {
        props: {
          userId: auth.userId,
          tenantId,
          role: auth.role,
          tokenId: auth.tokenId,
          tokenKind: auth.tokenKind,
        },
        audience: resource,
        expiresAt: auth.exp,
        scope: auth.scopes,
        userId: auth.userId,
      };
    };
}
