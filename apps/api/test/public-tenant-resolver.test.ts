import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { resolveTenantId } from "../src/public/tenant-resolver";

async function seedTenant(id: string, slug: string): Promise<void> {
  await env.DB.prepare("INSERT INTO tenants (id, slug, name, created_at) VALUES (?1, ?2, ?3, ?4)")
    .bind(id, slug, `tenant ${slug}`, "2026-07-14T00:00:00.000Z")
    .run();
}

function freshSlug(): string {
  return `t-${crypto.randomUUID().slice(0, 12)}`;
}

describe("resolveTenantId (design-spec §12.7 / G3)", () => {
  it("resolves a known slug through the control-plane D1", async () => {
    const id = crypto.randomUUID();
    const slug = freshSlug();
    await seedTenant(id, slug);
    expect(await resolveTenantId(env, slug)).toBe(id);
  });

  it("serves repeat lookups from KV (D1 row can disappear, the answer stays)", async () => {
    const id = crypto.randomUUID();
    const slug = freshSlug();
    await seedTenant(id, slug);
    expect(await resolveTenantId(env, slug)).toBe(id);
    await env.DB.prepare("DELETE FROM tenants WHERE id = ?1").bind(id).run();
    // KV にキャッシュ済みなので、D1 から消えても TTL 内は解決できる（結果整合を受容）
    expect(await resolveTenantId(env, slug)).toBe(id);
  });

  it("caches a miss (a slug created right after keeps 404ing until the TTL)", async () => {
    const slug = freshSlug();
    expect(await resolveTenantId(env, slug)).toBeNull();
    await seedTenant(crypto.randomUUID(), slug);
    // 負キャッシュが効いている（未知 slug 連打でコントロールプレーン D1 を叩かせない）
    expect(await resolveTenantId(env, slug)).toBeNull();
  });

  it("returns null for an unknown slug", async () => {
    expect(await resolveTenantId(env, freshSlug())).toBeNull();
  });
});
