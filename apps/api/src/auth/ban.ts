import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { memberships } from "@plyrs/db/control-plane";
import { blockMembership, blockUser } from "./blocklist";
import { revokeUserPats } from "./pat";

export interface CutOffResult {
  disconnected: number;
  // 失効させた PAT の id(監査は呼び出し元が書く)
  revokedTokens: string[];
}

// §7 引き継ぎ事項: blockUser(KV)だけでは確立済みソケットが切れない。
// BAN は必ず該当テナント DO の disconnectUser と併呼する。M1-3a: PAT も全テナント分を失効させる
export async function banUserEverywhere(env: Env, userId: string): Promise<CutOffResult> {
  await blockUser(env.BLOCKLIST, userId);
  const revokedTokens = await revokeUserPats(env.DB, userId, new Date());
  const rows = await drizzle(env.DB)
    .select({ tenantId: memberships.tenantId })
    .from(memberships)
    .where(eq(memberships.userId, userId));
  // 加入テナントごとの disconnect は互いに独立しているので並列実行する(失敗時の挙動は
  // 逐次 await と同じ fail-fast — いずれかが reject すれば Promise.all も即座に reject する)。
  const counts = await Promise.all(
    rows.map((row) => {
      const stub = env.TENANT_DO.get(env.TENANT_DO.idFromName(row.tenantId));
      return stub.disconnectUser(userId);
    }),
  );
  return { disconnected: counts.reduce((sum, n) => sum + n, 0), revokedTokens };
}

export async function revokeMembership(
  env: Env,
  userId: string,
  tenantId: string,
): Promise<CutOffResult> {
  await drizzle(env.DB)
    .delete(memberships)
    .where(and(eq(memberships.userId, userId), eq(memberships.tenantId, tenantId)));
  return cutOffMembership(env, userId, tenantId);
}

// membership 行を消したあとの即時失効(発行済みトークンのブロック + PAT の失効 + 確立済みソケットの切断)。
// 行の削除を条件付きで行う呼び出し元(案 G 4.5 の最後の owner の保護)も同じ後始末を使う。
export async function cutOffMembership(
  env: Env,
  userId: string,
  tenantId: string,
): Promise<CutOffResult> {
  await blockMembership(env.BLOCKLIST, userId, tenantId);
  const revokedTokens = await revokeUserPats(env.DB, userId, new Date(), tenantId);
  const stub = env.TENANT_DO.get(env.TENANT_DO.idFromName(tenantId));
  const disconnected = await stub.disconnectUser(userId);
  return { disconnected, revokedTokens };
}
