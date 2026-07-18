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
  let disconnected = 0;
  for (const row of rows) {
    const stub = env.TENANT_DO.get(env.TENANT_DO.idFromName(row.tenantId));
    disconnected += await stub.disconnectUser(userId);
  }
  return { disconnected };
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
