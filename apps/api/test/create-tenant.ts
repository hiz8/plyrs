import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { v7 as uuidv7 } from "uuid";
import { memberships, tenants } from "@plyrs/db/control-plane";

// Phase 10 裁定 9: self-serve テナント作成(POST /v1/tenants)の撤去に伴い、既存テストが
// 「テナントを 1 つ用意する」ためだけに使っていた HTTP 経路を direct-insert に差し替える
// 共有ヘルパ。HTTP 経由より速く、super_admins のような後始末も不要(各テストが unique() な
// slug を使う限り、control-plane の tenants/memberships はリークしても後続と衝突しない —
// 既存の tenants/memberships もテスト後に消していなかったのと同じ扱い)。
export async function insertTenantWithOwner(
  userId: string,
  overrides: { name?: string; slug?: string } = {},
): Promise<{ tenantId: string; slug: string }> {
  const db = drizzle(env.DB);
  const tenantId = uuidv7();
  const slug = overrides.slug ?? `t-${crypto.randomUUID()}`;
  const name = overrides.name ?? "T";
  const now = new Date().toISOString();
  await db.insert(tenants).values({ id: tenantId, slug, name, createdAt: now });
  await db.insert(memberships).values({ userId, tenantId, role: "owner", createdAt: now });
  return { tenantId, slug };
}
