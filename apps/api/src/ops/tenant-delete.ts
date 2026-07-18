import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { memberships, tenantModules, tenants } from "@plyrs/db/control-plane";

// 削除順序(計画の設計確定事項): control-plane 行(新規トークン発行を止める)→ KV slug cache
// → DO wipe(接続切断込み)→ 投影 D1 → R2。途中失敗は 500 として表面化し、再実行で収束する
// (各段は冪等)。
export async function deleteTenantCascade(
  env: Env,
  tenant: { id: string; slug: string },
): Promise<void> {
  const db = drizzle(env.DB);
  await db.batch([
    db.delete(memberships).where(eq(memberships.tenantId, tenant.id)),
    db.delete(tenantModules).where(eq(tenantModules.tenantId, tenant.id)),
    db.delete(tenants).where(eq(tenants.id, tenant.id)),
  ]);
  await env.TENANT_SLUGS.delete(`tenant-slug:${tenant.slug}`);
  const stub = env.TENANT_DO.get(env.TENANT_DO.idFromName(tenant.id));
  await stub.wipeTenant();
  const tables = [
    "projected_records",
    "projected_relations",
    "projection_index",
    "projection_tombstones",
    "projection_fields",
  ];
  await env.PROJECTION_DB.batch(
    tables.map((table) =>
      env.PROJECTION_DB.prepare(`DELETE FROM ${table} WHERE tenant_id = ?1`).bind(tenant.id),
    ),
  );
  let cursor: string | undefined;
  do {
    const listing = await env.ASSETS.list({ prefix: `${tenant.id}/`, cursor });
    if (listing.objects.length > 0) {
      await env.ASSETS.delete(listing.objects.map((object) => object.key));
    }
    cursor = listing.truncated ? listing.cursor : undefined;
  } while (cursor !== undefined);
}
