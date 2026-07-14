// design-spec §12.7 / G3（2026-07-13 裁定）: 公開 read のテナント解決。
// tenantSlug → tenantId をコントロールプレーン D1 + KV キャッシュで解決し、DO は絶対に
// 起こさない。KV は結果整合（〜60s）だが、この対応は slug の付け替えでしか変わらず、
// TTL で陳腐化が有界なので公開経路には十分。

const HIT_TTL_SECONDS = 300;
// KV の最小 TTL は 60s。未知 slug の連打がコントロールプレーン D1 へ素通りするのを防ぐ負キャッシュ
const MISS_TTL_SECONDS = 60;

interface CacheEntry {
  id: string | null; // null = 「存在しない」を覚えた負キャッシュ
}

export async function resolveTenantId(env: Env, slug: string): Promise<string | null> {
  const key = `tenant-slug:${slug}`;
  const cached = await env.TENANT_SLUGS.get<CacheEntry>(key, "json");
  if (cached !== null) {
    return cached.id;
  }
  const row = await env.DB.prepare("SELECT id FROM tenants WHERE slug = ?1")
    .bind(slug)
    .first<{ id: string }>();
  const id = row?.id ?? null;
  await env.TENANT_SLUGS.put(key, JSON.stringify({ id } satisfies CacheEntry), {
    expirationTtl: id === null ? MISS_TTL_SECONDS : HIT_TTL_SECONDS,
  });
  return id;
}
