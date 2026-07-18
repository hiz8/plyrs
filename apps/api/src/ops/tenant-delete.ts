import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { memberships, tenantModules, tenants } from "@plyrs/db/control-plane";
import { blockMembership } from "../auth/blocklist";

// 削除順序(最終ブランチレビューで再実行可能性のために確定): ①memberships の SELECT(旧
// メンバー一覧を保存)→ memberships / tenant_modules を db.batch で削除(新規トークン発行を
// ここで止める — /auth/token は membership 不在で not_a_member)。②旧メンバー全員に
// blockMembership(§6 裁定の TTL 1200s が JWT 900s の生存窓を覆う。旧 JWT の復活ウィンドウを
// 封鎖する)。③DO wipeTenant(接続切断込み)。④投影 D1 5 テーブル削除。⑤R2 prefix 削除。
// ⑥tenants 行の削除(最後段 — 行が残っている間は再 DELETE が存在チェックを通り、途中失敗
// しても再実行だけで収束する)。⑦KV tenant-slug 削除は tenants 行削除の後(先に消すと公開
// read が D1 から正キャッシュ 300s を再形成してしまう。行が消えた後なら以後は負キャッシュに
// 落ちる)。各段は冪等。
export async function deleteTenantCascade(
  env: Env,
  tenant: { id: string; slug: string },
): Promise<void> {
  const db = drizzle(env.DB);
  const formerMembers = await db
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(eq(memberships.tenantId, tenant.id));
  await db.batch([
    db.delete(memberships).where(eq(memberships.tenantId, tenant.id)),
    db.delete(tenantModules).where(eq(tenantModules.tenantId, tenant.id)),
  ]);
  for (const member of formerMembers) {
    await blockMembership(env.BLOCKLIST, member.userId, tenant.id);
  }
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
  await db.delete(tenants).where(eq(tenants.id, tenant.id));
  await env.TENANT_SLUGS.delete(`tenant-slug:${tenant.slug}`);
}
