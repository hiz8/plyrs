import { and, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { v7 as uuidv7 } from "uuid";
import { superSessions } from "@plyrs/db/control-plane";
import { generateSessionToken, sha256Hex } from "./session";

// design-spec §11.6: 特権は通常セッションと別テーブル・別 cookie。TTL も短め(7 日)。
const SUPER_SESSION_TTL_DAYS = 7;

export const SUPER_SESSION_COOKIE = "__Host-plyrs_super_session";

export async function createSuperSession(
  d1: D1Database,
  adminId: string,
  now: Date,
): Promise<{ token: string; expiresAt: string }> {
  const token = generateSessionToken();
  const expiresAt = new Date(now.getTime() + SUPER_SESSION_TTL_DAYS * 86_400_000).toISOString();
  await drizzle(d1)
    .insert(superSessions)
    .values({
      id: uuidv7(),
      tokenHash: await sha256Hex(token),
      adminId,
      expiresAt,
      createdAt: now.toISOString(),
    });
  return { token, expiresAt };
}

export async function lookupSuperSession(
  d1: D1Database,
  token: string,
  now: Date,
): Promise<{ adminId: string } | null> {
  const rows = await drizzle(d1)
    .select({ adminId: superSessions.adminId, expiresAt: superSessions.expiresAt })
    .from(superSessions)
    .where(
      and(eq(superSessions.tokenHash, await sha256Hex(token)), isNull(superSessions.revokedAt)),
    )
    .limit(1);
  const row = rows[0];
  if (row === undefined || row.expiresAt <= now.toISOString()) {
    return null;
  }
  return { adminId: row.adminId };
}

export async function revokeSuperSession(d1: D1Database, token: string, now: Date): Promise<void> {
  await drizzle(d1)
    .update(superSessions)
    .set({ revokedAt: now.toISOString() })
    .where(eq(superSessions.tokenHash, await sha256Hex(token)));
}
