import { and, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { v7 as uuidv7 } from "uuid";
import { personalAccessTokens } from "@plyrs/db/control-plane";
import { isRole, type Operation, type Role } from "./permissions";
import { generateSessionToken, sha256Hex } from "./session";

// design-spec 16.3(決定 49、M1-3a): PAT の発行・検証・失効。D1 にはハッシュ・スコープ・有効期限
// だけを保存し、raw token は発行応答の 1 回しか返さない。接頭辞は限定公開中(16.12)は変えうる。
export const PAT_PREFIX = "plyrs_pat_";

// PAT に付けられるスコープ(用語集「スコープ」: 名前は DO の Operation と同じ)
export const PAT_SCOPES = [
  "record:read",
  // M5c(決定 57): 変更を提案として置く。直接は書けない
  "record:propose",
  "record:write",
  "record:delete",
  "record:publish",
  "type:manage",
] as const satisfies readonly Operation[];

export type PatScope = (typeof PAT_SCOPES)[number];

export const PAT_NAME_MAX_LENGTH = 100;

// 未決事項「PAT の有効期限の上限」の仮置き: 読み取りのみは 365 日、書き込みスコープを 1 つでも含めば
// 90 日(OAuth の refresh が無いぶん、漏えいの影響を期限で押さえる)
export const READ_ONLY_MAX_DAYS = 365;
export const WRITE_MAX_DAYS = 90;
export const READ_ONLY_DEFAULT_DAYS = 90;
export const WRITE_DEFAULT_DAYS = 30;

export function isPatShaped(token: string): boolean {
  return token.startsWith(PAT_PREFIX);
}

// ロールごとに付与できるスコープ。record:publish と type:manage は所有者だけ(16.3 論点 C5)。
// M3-2 の同意画面も同じ規則を使う
export function allowedScopes(role: Role): PatScope[] {
  switch (role) {
    case "owner":
      return [...PAT_SCOPES];
    case "editor":
      return ["record:read", "record:propose", "record:write", "record:delete"];
    default:
      return ["record:read"];
  }
}

// 発行ルートが現在のロールと照合する。allowedScopes に無いスコープを返す(空なら発行できる)
export function disallowedScopes(role: Role, scopes: readonly PatScope[]): PatScope[] {
  const allowed = new Set<PatScope>(allowedScopes(role));
  return scopes.filter((scope) => !allowed.has(scope));
}

export function isReadOnly(scopes: readonly Operation[]): boolean {
  return scopes.every((scope) => scope === "record:read");
}

export function maxExpiryDays(scopes: readonly Operation[]): number {
  return isReadOnly(scopes) ? READ_ONLY_MAX_DAYS : WRITE_MAX_DAYS;
}

export function defaultExpiryDays(scopes: readonly Operation[]): number {
  return isReadOnly(scopes) ? READ_ONLY_DEFAULT_DAYS : WRITE_DEFAULT_DAYS;
}

export interface IssuePatInput {
  userId: string;
  tenantId: string;
  name: string;
  scopes: readonly PatScope[];
  expiresInDays: number;
}

export async function issuePat(
  d1: D1Database,
  input: IssuePatInput,
  now: Date,
): Promise<{ id: string; token: string; expiresAt: string }> {
  const id = uuidv7();
  const token = `${PAT_PREFIX}${generateSessionToken()}`;
  const expiresAt = new Date(now.getTime() + input.expiresInDays * 86_400_000).toISOString();
  await drizzle(d1)
    .insert(personalAccessTokens)
    .values({
      id,
      tokenHash: await sha256Hex(token),
      userId: input.userId,
      tenantId: input.tenantId,
      name: input.name,
      scopes: input.scopes.join(" "),
      expiresAt,
      createdAt: now.toISOString(),
    });
  return { id, token, expiresAt };
}

export interface VerifiedPat {
  tokenId: string;
  userId: string;
  tenantId: string;
  // ロールは PAT に焼き込まず、検証のたびに memberships から引く(ロール変更が即時に反映される)
  role: Role;
  scopes: Operation[];
  expiresAt: number; // 秒
}

// last_used_at の更新は best-effort で 1 時間に 1 回に間引く(検証のたびに D1 へ書かない)
const LAST_USED_THROTTLE_MS = 60 * 60_000;

// 1 回の D1 照会(memberships を join)で、ハッシュ一致・テナント一致・未失効・期限内・会員であることを判定
export async function verifyPat(
  d1: D1Database,
  tenantId: string,
  token: string,
  now: Date,
): Promise<VerifiedPat | null> {
  if (!isPatShaped(token)) {
    return null;
  }
  const row = await d1
    .prepare(
      `SELECT p.id, p.user_id, p.scopes, p.expires_at, p.last_used_at, m.role
       FROM personal_access_tokens p
       JOIN memberships m ON m.user_id = p.user_id AND m.tenant_id = p.tenant_id
       WHERE p.token_hash = ? AND p.tenant_id = ? AND p.revoked_at IS NULL AND p.expires_at > ?`,
    )
    .bind(await sha256Hex(token), tenantId, now.toISOString())
    .first<{
      id: string;
      user_id: string;
      scopes: string;
      expires_at: string;
      last_used_at: string | null;
      role: string;
    }>();
  if (row === null || !isRole(row.role)) {
    return null;
  }
  const lastUsedMs = row.last_used_at === null ? Number.NaN : Date.parse(row.last_used_at);
  if (!(now.getTime() - lastUsedMs < LAST_USED_THROTTLE_MS)) {
    try {
      await d1
        .prepare("UPDATE personal_access_tokens SET last_used_at = ? WHERE id = ?")
        .bind(now.toISOString(), row.id)
        .run();
    } catch (error) {
      console.error("pat last_used_at update failed", row.id, error);
    }
  }
  return {
    tokenId: row.id,
    userId: row.user_id,
    tenantId,
    role: row.role,
    scopes: row.scopes.split(" ").filter((s): s is Operation => s.length > 0),
    expiresAt: Math.floor(Date.parse(row.expires_at) / 1000),
  };
}

export interface PatSummary {
  id: string;
  userId: string;
  name: string;
  scopes: string[];
  expiresAt: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

// token_hash は返さない
export async function listPats(d1: D1Database, tenantId: string): Promise<PatSummary[]> {
  const rows = await drizzle(d1)
    .select({
      id: personalAccessTokens.id,
      userId: personalAccessTokens.userId,
      name: personalAccessTokens.name,
      scopes: personalAccessTokens.scopes,
      expiresAt: personalAccessTokens.expiresAt,
      createdAt: personalAccessTokens.createdAt,
      lastUsedAt: personalAccessTokens.lastUsedAt,
      revokedAt: personalAccessTokens.revokedAt,
    })
    .from(personalAccessTokens)
    .where(eq(personalAccessTokens.tenantId, tenantId))
    .orderBy(personalAccessTokens.createdAt);
  return rows.map((row) => ({ ...row, scopes: row.scopes.split(" ").filter((s) => s.length > 0) }));
}

// 失効は revoked_at を立てる(行は残し、一覧に失効済みとして出す)。テナントが違う・既に失効済みなら false
export async function revokePat(
  d1: D1Database,
  tenantId: string,
  tokenId: string,
  now: Date,
): Promise<boolean> {
  const updated = await drizzle(d1)
    .update(personalAccessTokens)
    .set({ revokedAt: now.toISOString() })
    .where(
      and(
        eq(personalAccessTokens.id, tokenId),
        eq(personalAccessTokens.tenantId, tenantId),
        isNull(personalAccessTokens.revokedAt),
      ),
    )
    .returning({ id: personalAccessTokens.id });
  return updated.length > 0;
}

// 会員資格を失った人の PAT をまとめて失効させる(tenantId を省くと全テナント)。会員を外す・BAN の
// 後始末に使う。KV のブロックは最長 20 分で消えるが、PAT は 365 日生きうるので revoked_at を立てる
// (再招待の unblockMembership で蘇らない)。失効させた id を返し、監査は呼び出し元が書く
export async function revokeUserPats(
  d1: D1Database,
  userId: string,
  now: Date,
  tenantId?: string,
): Promise<string[]> {
  const updated = await drizzle(d1)
    .update(personalAccessTokens)
    .set({ revokedAt: now.toISOString() })
    .where(
      and(
        eq(personalAccessTokens.userId, userId),
        tenantId === undefined ? undefined : eq(personalAccessTokens.tenantId, tenantId),
        isNull(personalAccessTokens.revokedAt),
      ),
    )
    .returning({ id: personalAccessTokens.id });
  return updated.map((row) => row.id);
}
