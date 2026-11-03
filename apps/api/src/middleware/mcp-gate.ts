import { OAuthError, type OAuthResourceTokenValidation } from "@cloudflare/workers-oauth-provider";
import { isBlocked, isMembershipBlocked } from "../auth/blocklist";
import { isPatShaped, PAT_SCOPES, type PatScope, verifyPat } from "../auth/pat";
import { isRole, type Role } from "../auth/permissions";
import type { McpAuth } from "../do/authorize";
import {
  createTenantAuthServer,
  type McpGrantProps,
  oauthOrigins,
  tenantResource,
} from "../oauth/server";

// design-spec 16.3(決定 49、M1-3b・M3-3): MCP の入口の認証。PAT と OAuth の access token を同じ認可
// コンテキスト McpAuth に合流させ、既存 JWT と同じ BLOCKLIST 照会(blocked:user / blocked:membership)を
// どちらにも適用する。振り分けは接頭辞で決め、`plyrs_pat_` のトークンは OAuth 側の validateToken に渡さない
// (Review Focus 5)。OAuth のロールはグラントの props(同意時に固定、refresh で読み直す。M3-4)から取る。

export type McpGateResult =
  | { ok: true; auth: McpAuth }
  | { ok: false; code: "unauthenticated" | "blocked"; status: 401 | 403 };

// 認証済みで BLOCKLIST 照会前のトークンの素性(PAT と OAuth で共通の形)
type Verified = Pick<McpAuth, "userId" | "role" | "exp" | "scopes" | "tokenId" | "tokenKind">;

// access token は `userId:grantId:secret`(ライブラリの storage-schema)。グラント ID を失効の単位
// (管理画面の「接続中のアプリ」、M3-5)にするため 2 要素目を取り出す。1 要素目が検証結果の userId と
// 違う形は信用しない
export function oauthGrantId(token: string, userId: string): string | null {
  const parts = token.split(":");
  const grantId = parts[1];
  if (parts.length !== 3 || parts[0] !== userId || grantId === undefined || grantId.length === 0) {
    return null;
  }
  return grantId;
}

function isScope(value: string): value is PatScope {
  return (PAT_SCOPES as readonly string[]).includes(value);
}

async function verifyOAuth(
  env: Env,
  tenantId: string,
  token: string,
  resource: string,
): Promise<Verified | null> {
  // ADMIN_ORIGIN / API_ORIGIN が無ければ認可サーバーが無いので、OAuth の token は常に unauthenticated。
  // resource(入口の URL から組んだ値)が API_ORIGIN のテナントの resource と違えば、ライブラリは
  // TypeError(503)にするが、ここでは設定の不一致として unauthenticated に揃える
  const origins = oauthOrigins(env);
  const server = createTenantAuthServer(env, tenantId);
  if (
    origins === null ||
    server === null ||
    resource !== tenantResource(origins.apiOrigin, tenantId)
  ) {
    return null;
  }
  // audience(= このテナントの resource)と期限はライブラリが見る。props は自分が同意時に入れた値だが、
  // 別テナントの入口に同じ KV の token が来る形(Review Focus 1)は tenantId で二重に閉じる
  const validated = await server.validateToken<McpGrantProps>(resource, token, env);
  if (validated === null) {
    return null;
  }
  const props = validated.props;
  if (props.tenantId !== tenantId || props.userId !== validated.userId || !isRole(props.role)) {
    return null;
  }
  return {
    userId: props.userId,
    role: props.role,
    exp: validated.expiresAt,
    scopes: validated.scope.filter(isScope),
    tokenId: oauthGrantId(token, validated.userId) ?? validated.clientId,
    tokenKind: "oauth",
  };
}

async function verifyPatToken(
  env: Env,
  tenantId: string,
  token: string,
  now: Date,
): Promise<Verified | null> {
  const pat = await verifyPat(env.DB, tenantId, token, now);
  if (pat === null) {
    return null;
  }
  return {
    userId: pat.userId,
    role: pat.role,
    exp: pat.expiresAt,
    scopes: pat.scopes,
    tokenId: pat.tokenId,
    tokenKind: "pat",
  };
}

export async function authenticateMcpToken(
  env: Env,
  tenantId: string,
  token: string,
  resource: string,
  now: Date = new Date(),
): Promise<McpGateResult> {
  const verified = isPatShaped(token)
    ? await verifyPatToken(env, tenantId, token, now)
    : await verifyOAuth(env, tenantId, token, resource);
  if (verified === null) {
    return { ok: false, code: "unauthenticated", status: 401 };
  }
  if (await isBlocked(env.BLOCKLIST, verified.userId)) {
    return { ok: false, code: "blocked", status: 403 };
  }
  if (await isMembershipBlocked(env.BLOCKLIST, verified.userId, tenantId)) {
    return { ok: false, code: "blocked", status: 403 };
  }
  return { ok: true, auth: { ...verified, tenantId } };
}

// OAuthResourceServer の ctx.props に載せる値。ハンドラはここから McpAuth を組み立て直す
export interface McpTokenProps {
  userId: string;
  tenantId: string;
  role: Role;
  tokenId: string;
  tokenKind: McpAuth["tokenKind"];
}

// OAuthResourceServer の validateToken に差し込む形(戻り値の型はライブラリの
// OAuthResourceTokenValidation をそのまま使い、手書きで追従しない)。null は 401 の challenge、
// blocked は OAuthError(403)で表現する(ライブラリが WWW-Authenticate を出す)
export function mcpTokenValidator(tenantId: string) {
  return (env: Env) =>
    async (
      resource: string,
      token: string,
    ): Promise<OAuthResourceTokenValidation<McpTokenProps> | null> => {
      const result = await authenticateMcpToken(env, tenantId, token, resource);
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
