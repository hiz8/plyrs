import { and, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { sessions } from "@plyrs/db/control-plane";
import { v7 as uuidv7 } from "uuid";

// design-spec §11.2: セッションの真実源は中央 D1。トークンは 32byte 不透明値を
// base64url で配り、D1 には SHA-256 ハッシュのみ保存（D1 流出時もセッション奪取不能）。
const SESSION_TTL_DAYS = 30;

export const SESSION_COOKIE = "plyrs_session";

function toBase64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function createSession(
  d1: D1Database,
  userId: string,
  now: Date,
): Promise<{ token: string; expiresAt: string }> {
  const raw = crypto.getRandomValues(new Uint8Array(32));
  const token = toBase64Url(raw);
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

export async function lookupSession(
  d1: D1Database,
  token: string,
  now: Date,
): Promise<{ userId: string } | null> {
  const rows = await drizzle(d1)
    .select({ userId: sessions.userId, expiresAt: sessions.expiresAt })
    .from(sessions)
    .where(and(eq(sessions.tokenHash, await sha256Hex(token)), isNull(sessions.revokedAt)))
    .limit(1);
  const row = rows[0];
  if (row === undefined || row.expiresAt <= now.toISOString()) {
    return null;
  }
  return { userId: row.userId };
}

export async function revokeSession(d1: D1Database, token: string, now: Date): Promise<void> {
  await drizzle(d1)
    .update(sessions)
    .set({ revokedAt: now.toISOString() })
    .where(eq(sessions.tokenHash, await sha256Hex(token)));
}
