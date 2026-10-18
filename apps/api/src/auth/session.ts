import { and, eq, isNotNull, isNull, lte, ne, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { sessions, superSessions, users } from "@plyrs/db/control-plane";
import { v7 as uuidv7 } from "uuid";

// design-spec §11.2: セッションの真実源は中央 D1。トークンは 32byte 不透明値を
// base64url で配り、D1 には SHA-256 ハッシュのみ保存（D1 流出時もセッション奪取不能）。
const SESSION_TTL_DAYS = 30;

// §6: __Host- prefix は Secure・Path=/・Domain 属性なしを cookie 仕様として強制させる
// (ブラウザが検証する)。secure な cookie 設定と食い違うと発行そのものが失敗する防御。
export const SESSION_COOKIE = "__Host-plyrs_session";

function toBase64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

export function generateSessionToken(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function createSession(
  d1: D1Database,
  userId: string,
  now: Date,
): Promise<{ token: string; expiresAt: string }> {
  const token = generateSessionToken();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_DAYS * 86_400_000).toISOString();
  await drizzle(d1)
    .insert(sessions)
    .values({
      id: uuidv7(),
      tokenHash: await sha256Hex(token),
      userId,
      expiresAt,
      createdAt: now.toISOString(),
    });
  return { token, expiresAt };
}

// セッション判定(token_hash 一致・未失効・期限内)の唯一の実装。users を left join し、利用者の
// メールアドレスも 1 回の D1 照会で引く(/auth/me が sessions → users を直列に引かずに済むように)。
// email が null なら users 行が無い。
export async function lookupSessionUser(
  d1: D1Database,
  token: string,
  now: Date,
): Promise<{ userId: string; email: string | null } | null> {
  const rows = await drizzle(d1)
    .select({ userId: sessions.userId, expiresAt: sessions.expiresAt, email: users.email })
    .from(sessions)
    .leftJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, await sha256Hex(token)), isNull(sessions.revokedAt)))
    .limit(1);
  const row = rows[0];
  if (row === undefined || row.expiresAt <= now.toISOString()) {
    return null;
  }
  return { userId: row.userId, email: row.email };
}

export async function lookupSession(
  d1: D1Database,
  token: string,
  now: Date,
): Promise<{ userId: string } | null> {
  const session = await lookupSessionUser(d1, token, now);
  return session === null ? null : { userId: session.userId };
}

export async function revokeSession(d1: D1Database, token: string, now: Date): Promise<void> {
  await drizzle(d1)
    .update(sessions)
    .set({ revokedAt: now.toISOString() })
    .where(eq(sessions.tokenHash, await sha256Hex(token)));
}

// 案 G 6.2: パスワード変更時に、操作した端末以外のセッションをすべて失効させる。
// 発行済みの短命 JWT(最大 15 分)は対象外 — /auth/token での再発行ができなくなる時点で止まる。
export async function revokeOtherSessions(
  d1: D1Database,
  userId: string,
  keepToken: string,
  now: Date,
): Promise<number> {
  const result = await drizzle(d1)
    .update(sessions)
    .set({ revokedAt: now.toISOString() })
    .where(
      and(
        eq(sessions.userId, userId),
        isNull(sessions.revokedAt),
        ne(sessions.tokenHash, await sha256Hex(keepToken)),
      ),
    );
  return result.meta.changes;
}

// §6: 期限切れ・失効済みセッションの掃除(cron から呼ぶ)。
export async function purgeExpiredSessions(d1: D1Database, now: Date): Promise<void> {
  const iso = now.toISOString();
  const db = drizzle(d1);
  await db.batch([
    db.delete(sessions).where(or(lte(sessions.expiresAt, iso), isNotNull(sessions.revokedAt))),
    db
      .delete(superSessions)
      .where(or(lte(superSessions.expiresAt, iso), isNotNull(superSessions.revokedAt))),
  ]);
}
