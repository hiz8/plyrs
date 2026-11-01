// spike(M0-3): PAT(Personal Access Token)の検証経路。design-spec 16.3 — D1 にハッシュ・スコープ・
// 有効期限を保存し、Worker の入口で検証して OAuth と同じ認可コンテキストに合流させる。
// 本実装(M1-3b)では drizzle のスキーマとマイグレーションにする。ここではテストが生の SQL で表を作る。
import type { Operation, Role } from "../auth/permissions";
import { isRole } from "../auth/permissions";
import { generateSessionToken, sha256Hex } from "../auth/session";

export const PAT_PREFIX = "plyrs_pat_";

export const PAT_TABLE_SQL = `CREATE TABLE IF NOT EXISTS personal_access_tokens (
  id TEXT PRIMARY KEY NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  scopes TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
)`;

export function isPatShaped(token: string): boolean {
  return token.startsWith(PAT_PREFIX);
}

export async function issuePat(
  d1: D1Database,
  input: { id: string; userId: string; tenantId: string; scopes: Operation[]; expiresAt: Date },
): Promise<string> {
  const token = `${PAT_PREFIX}${generateSessionToken()}`;
  await d1
    .prepare(
      "INSERT INTO personal_access_tokens (id, token_hash, user_id, tenant_id, scopes, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(
      input.id,
      await sha256Hex(token),
      input.userId,
      input.tenantId,
      input.scopes.join(" "),
      input.expiresAt.toISOString(),
    )
    .run();
  return token;
}

export interface VerifiedPat {
  tokenId: string;
  userId: string;
  tenantId: string;
  // ロールは PAT に焼き込まず、検証のたびに memberships から引く(ロール変更が即時に効果を持つ)
  role: Role;
  scopes: Operation[];
  expiresAt: number;
}

// 1 回の D1 照会(memberships を join)で、ハッシュ一致・未失効・期限内・テナント一致・会員であることを判定
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
      `SELECT p.id, p.user_id, p.scopes, p.expires_at, m.role
       FROM personal_access_tokens p
       JOIN memberships m ON m.user_id = p.user_id AND m.tenant_id = p.tenant_id
       WHERE p.token_hash = ? AND p.tenant_id = ? AND p.revoked_at IS NULL AND p.expires_at > ?`,
    )
    .bind(await sha256Hex(token), tenantId, now.toISOString())
    .first<{ id: string; user_id: string; scopes: string; expires_at: string; role: string }>();
  if (row === null || !isRole(row.role)) {
    return null;
  }
  return {
    tokenId: row.id,
    userId: row.user_id,
    tenantId,
    role: row.role,
    scopes: row.scopes.split(" ").filter((s): s is Operation => s.length > 0),
    expiresAt: Math.floor(new Date(row.expires_at).getTime() / 1000),
  };
}
