import type { GrantSummary, OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { memberships, users } from "@plyrs/db/control-plane";
import { createTenantAuthServer, oauthOrigins, tenantResource } from "./server";

// design-spec 16.3(M3-5): テナント単位の OAuth の付与(グラント)の一覧と失効。ライブラリは付与を利用者単位
// (grant:<userId>:<grantId>)でしか引けないので、テナントの会員ごとに listUserGrants を呼び、このテナントの
// resource の行だけを残す。会員は先頭 50 人・会員あたり 100 件まで(それ以上は M5 の申し送り)。
// 失効は OAUTH_KV の付与と token を消すので、その access token は MCP の入口で即 401 になる。

export interface TenantGrant {
  id: string;
  userId: string;
  email: string;
  clientId: string;
  clientName: string | null;
  scopes: string[];
  createdAt: string;
  expiresAt: string | null;
  // 同意は済んだが認可コードがまだ交換されていない(クライアントが戻って来ていない)。M3 の見送り指摘 (h)
  pending: boolean;
}

const MEMBER_LIMIT = 50;
// listUserGrants は利用者の全テナントの付与を返すので、cursor で辿ってから resource で絞る(M3 の見送り
// 指摘 (d))。1 ページ 100 件 × 10 ページ = 利用者あたり 1000 件で打ち切る
const GRANT_PAGE_SIZE = 100;
const GRANT_MAX_PAGES = 10;

function belongsTo(grant: GrantSummary, resource: string): boolean {
  const resources = Array.isArray(grant.resource) ? grant.resource : [grant.resource];
  return resources.includes(resource);
}

function isoOf(seconds: number): string {
  return new Date(seconds * 1000).toISOString();
}

// クライアント名は clientId ごとに 1 回だけ引く。CIMD の取得失敗や削除済みのクライアントは null
async function clientNameOf(
  oauth: OAuthHelpers,
  cache: Map<string, string | null>,
  clientId: string,
): Promise<string | null> {
  const cached = cache.get(clientId);
  if (cached !== undefined) {
    return cached;
  }
  let name: string | null = null;
  try {
    name = (await oauth.lookupClient(clientId))?.clientName ?? null;
  } catch {
    name = null;
  }
  cache.set(clientId, name);
  return name;
}

async function allUserGrants(oauth: OAuthHelpers, userId: string): Promise<GrantSummary[]> {
  const grants: GrantSummary[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < GRANT_MAX_PAGES; page += 1) {
    const result = await oauth.listUserGrants(userId, { limit: GRANT_PAGE_SIZE, cursor });
    grants.push(...result.items);
    cursor = result.cursor;
    if (cursor === undefined) {
      break;
    }
  }
  return grants;
}

async function userGrants(
  oauth: OAuthHelpers,
  userId: string,
  resource: string,
): Promise<GrantSummary[]> {
  return (await allUserGrants(oauth, userId)).filter((grant) => belongsTo(grant, resource));
}

// 認可コードが未交換か(M3 の見送り指摘 (h))。GrantSummary には現れないので、ライブラリが OAUTH_KV に置く
// グラントの行(`grant:<userId>:<grantId>`)を読み、交換時に消される authCodeWrappedKey の有無で見る。
// ライブラリの保存形に依存する(oauth-grants.test.ts が固定する)
async function isPending(env: Env, userId: string, grantId: string): Promise<boolean> {
  const stored = await env.OAUTH_KV.get<Record<string, unknown>>(
    `grant:${userId}:${grantId}`,
    "json",
  );
  return stored !== null && typeof stored["authCodeWrappedKey"] === "string";
}

export async function listTenantGrants(env: Env, tenantId: string): Promise<TenantGrant[]> {
  const origins = oauthOrigins(env);
  const server = createTenantAuthServer(env, tenantId);
  if (origins === null || server === null) {
    return [];
  }
  const oauth = server.getOAuthApi(env);
  const resource = tenantResource(origins.apiOrigin, tenantId);
  const members = await drizzle(env.DB)
    .select({ userId: memberships.userId, email: users.email })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.tenantId, tenantId))
    .orderBy(memberships.createdAt)
    .limit(MEMBER_LIMIT);
  const names = new Map<string, string | null>();
  const result: TenantGrant[] = [];
  for (const member of members) {
    for (const grant of await userGrants(oauth, member.userId, resource)) {
      result.push({
        id: grant.id,
        userId: member.userId,
        email: member.email,
        clientId: grant.clientId,
        clientName: await clientNameOf(oauth, names, grant.clientId),
        scopes: grant.scope,
        createdAt: isoOf(grant.createdAt),
        expiresAt: grant.expiresAt === undefined ? null : isoOf(grant.expiresAt),
        pending: await isPending(env, member.userId, grant.id),
      });
    }
  }
  return result.toSorted((a, b) => a.createdAt.localeCompare(b.createdAt));
}

// その利用者のこのテナントの付与に無ければ false(別テナントの付与は消せない。テナント境界)
export async function revokeTenantGrant(
  env: Env,
  tenantId: string,
  userId: string,
  grantId: string,
): Promise<boolean> {
  const origins = oauthOrigins(env);
  const server = createTenantAuthServer(env, tenantId);
  if (origins === null || server === null) {
    return false;
  }
  const oauth = server.getOAuthApi(env);
  const grants = await userGrants(oauth, userId, tenantResource(origins.apiOrigin, tenantId));
  if (!grants.some((grant) => grant.id === grantId)) {
    return false;
  }
  await oauth.revokeGrant(grantId, userId);
  return true;
}

// 会員資格を失った利用者の付与を失効させる(M3 の見送り指摘 (e))。tenantId が null なら全テナント(BAN)。
// access token は BLOCKLIST で、refresh は invalid_grant で既に止まるが、付与が OAUTH_KV に最長 30 日残り
// 所有者の画面にも出続けるので消す。失効させたグラント ID を返し、監査は呼び出し元が書く
export async function revokeUserGrants(
  env: Env,
  userId: string,
  tenantId: string | null,
): Promise<string[]> {
  const origins = oauthOrigins(env);
  // OAUTH_KV は全テナント共有なので、一覧と失効のヘルパーはどのテナントの認可サーバーから取っても同じ
  const server = createTenantAuthServer(env, tenantId ?? "_");
  if (origins === null || server === null) {
    return [];
  }
  const oauth = server.getOAuthApi(env);
  const grants =
    tenantId === null
      ? await allUserGrants(oauth, userId)
      : await userGrants(oauth, userId, tenantResource(origins.apiOrigin, tenantId));
  for (const grant of grants) {
    await oauth.revokeGrant(grant.id, userId);
  }
  return grants.map((grant) => grant.id);
}
