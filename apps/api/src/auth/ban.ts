import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { memberships } from "@plyrs/db/control-plane";
import { blockMembership, blockUser } from "./blocklist";

// §7 申し送り: blockUser(KV)だけでは確立済みソケットが切れない。
// BAN は必ず該当テナント DO の disconnectUser と併呼する。
export async function banUserEverywhere(
  env: Env,
  userId: string,
): Promise<{ disconnected: number }> {
  await blockUser(env.BLOCKLIST, userId);
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
  return { disconnected: counts.reduce((sum, n) => sum + n, 0) };
}

export async function revokeMembership(
  env: Env,
  userId: string,
  tenantId: string,
): Promise<{ disconnected: number }> {
  await drizzle(env.DB)
    .delete(memberships)
    .where(and(eq(memberships.userId, userId), eq(memberships.tenantId, tenantId)));
  await blockMembership(env.BLOCKLIST, userId, tenantId);
  const stub = env.TENANT_DO.get(env.TENANT_DO.idFromName(tenantId));
  const disconnected = await stub.disconnectUser(userId);
  return { disconnected };
}
