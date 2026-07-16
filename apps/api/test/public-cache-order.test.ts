import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/d1";
import { tenants } from "@plyrs/db/control-plane";
import { app } from "../src/index";

// Phase 5c housekeeping: cache.match をクエリ検証（カタログ読み込み含む）より前段に移した。
// ウォームキャッシュのヒット時には投影 D1 に一切触れないことを、PROJECTION_DB を
// 「触ったら throw する」バインディングに差し替えた env で実証する（キャッシュキーは全
// パラメータを含むため、ヒット = 同一パラメータで過去に 200 を返した、であり検証省略は安全）。

const RUN_ID = crypto.randomUUID().slice(0, 8);

async function seedTenant(slug: string): Promise<string> {
  const tenantId = crypto.randomUUID();
  await drizzle(env.DB)
    .insert(tenants)
    .values({ id: tenantId, slug, name: slug, createdAt: new Date().toISOString() });
  return tenantId;
}

function poisonedProjectionDb(): D1Database {
  return new Proxy({} as D1Database, {
    get() {
      throw new Error("PROJECTION_DB must not be touched on a cache hit");
    },
  });
}

describe("edge cache ordering (Phase 5c)", () => {
  it("serves a warm list from cache without touching the projection DB", async () => {
    const slug = `cache-order-${RUN_ID}`;
    const tenantId = await seedTenant(slug);
    await env.PROJECTION_DB.prepare(
      "INSERT INTO projected_records (tenant_id, record_id, type, slug, published_at, data, source_version, publish_seq, projected_at) VALUES (?1, ?2, 'post', NULL, '2026-07-16T00:00:00.000Z', ?3, 1, 1, 0)",
    )
      .bind(tenantId, crypto.randomUUID(), JSON.stringify({ title: "t" }))
      .run();
    const cold = await app.request(`/public/v1/${slug}/records/post`, {}, env);
    expect(cold.status).toBe(200);
    const warm = await app.request(
      `/public/v1/${slug}/records/post`,
      {},
      { ...env, PROJECTION_DB: poisonedProjectionDb() },
    );
    expect(warm.status).toBe(200);
    const body = (await warm.json()) as { items: unknown[] };
    expect(body.items.length).toBe(1);
  });

  it("serves a warm single record from cache without touching the projection DB", async () => {
    const slug = `cache-order-one-${RUN_ID}`;
    const tenantId = await seedTenant(slug);
    const recordId = crypto.randomUUID();
    await env.PROJECTION_DB.prepare(
      "INSERT INTO projected_records (tenant_id, record_id, type, slug, published_at, data, source_version, publish_seq, projected_at) VALUES (?1, ?2, 'post', NULL, '2026-07-16T00:00:00.000Z', ?3, 1, 1, 0)",
    )
      .bind(tenantId, recordId, JSON.stringify({ title: "t" }))
      .run();
    const cold = await app.request(`/public/v1/${slug}/records/post/${recordId}`, {}, env);
    expect(cold.status).toBe(200);
    const warm = await app.request(
      `/public/v1/${slug}/records/post/${recordId}`,
      {},
      { ...env, PROJECTION_DB: poisonedProjectionDb() },
    );
    expect(warm.status).toBe(200);
  });

  it("serves a warm filtered list from cache without touching the projection DB", async () => {
    const slug = `cache-order-filter-${RUN_ID}`;
    const tenantId = await seedTenant(slug);
    const recordId = crypto.randomUUID();
    const filterValue = "hello";
    await env.PROJECTION_DB.prepare(
      "INSERT INTO projection_fields (tenant_id, type, field_key, kind, multi, projected_at) VALUES (?1, 'post', 'title', 'text', 0, 0)",
    )
      .bind(tenantId)
      .run();
    await env.PROJECTION_DB.prepare(
      "INSERT INTO projected_records (tenant_id, record_id, type, slug, published_at, data, source_version, publish_seq, projected_at) VALUES (?1, ?2, 'post', NULL, '2026-07-16T00:00:00.000Z', ?3, 1, 1, 0)",
    )
      .bind(tenantId, recordId, JSON.stringify({ title: filterValue }))
      .run();
    await env.PROJECTION_DB.prepare(
      "INSERT INTO projection_index (tenant_id, type, field_key, value_text, record_id) VALUES (?1, 'post', 'title', ?2, ?3)",
    )
      .bind(tenantId, filterValue, recordId)
      .run();
    const url = `/public/v1/${slug}/records/post?filter[title]=${filterValue}`;
    const cold = await app.request(url, {}, env);
    expect(cold.status).toBe(200);
    const coldBody = (await cold.json()) as { items: unknown[] };
    expect(coldBody.items.length).toBe(1);
    const warm = await app.request(url, {}, { ...env, PROJECTION_DB: poisonedProjectionDb() });
    expect(warm.status).toBe(200);
    const warmBody = (await warm.json()) as { items: unknown[] };
    expect(warmBody.items.length).toBe(1);
  });

  it("serves a warm single record with include from cache without touching the projection DB", async () => {
    const slug = `cache-order-include-${RUN_ID}`;
    const tenantId = await seedTenant(slug);
    const postId = crypto.randomUUID();
    const authorId = crypto.randomUUID();
    await env.PROJECTION_DB.prepare(
      "INSERT INTO projection_fields (tenant_id, type, field_key, kind, multi, projected_at) VALUES (?1, 'post', 'authors', 'relation', 1, 0)",
    )
      .bind(tenantId)
      .run();
    await env.PROJECTION_DB.prepare(
      "INSERT INTO projected_records (tenant_id, record_id, type, slug, published_at, data, source_version, publish_seq, projected_at) VALUES (?1, ?2, 'post', NULL, '2026-07-16T00:00:00.000Z', ?3, 1, 1, 0)",
    )
      .bind(tenantId, postId, JSON.stringify({ title: "t" }))
      .run();
    await env.PROJECTION_DB.prepare(
      "INSERT INTO projected_records (tenant_id, record_id, type, slug, published_at, data, source_version, publish_seq, projected_at) VALUES (?1, ?2, 'author', NULL, '2026-07-16T00:00:00.000Z', ?3, 1, 1, 0)",
    )
      .bind(tenantId, authorId, JSON.stringify({ name: "a" }))
      .run();
    await env.PROJECTION_DB.prepare(
      "INSERT INTO projected_relations (tenant_id, source_id, source_field, target_type, target_id, ordinal, origin) VALUES (?1, ?2, 'authors', 'author', ?3, 0, 'field')",
    )
      .bind(tenantId, postId, authorId)
      .run();
    const url = `/public/v1/${slug}/records/post/${postId}?include=authors`;
    const cold = await app.request(url, {}, env);
    expect(cold.status).toBe(200);
    const warm = await app.request(url, {}, { ...env, PROJECTION_DB: poisonedProjectionDb() });
    expect(warm.status).toBe(200);
  });

  it("still rejects malformed queries (validation now runs inside the cache producer)", async () => {
    const slug = `cache-order-bad-${RUN_ID}`;
    await seedTenant(slug);
    const res = await app.request(`/public/v1/${slug}/records/post?filter[nope]=1`, {}, env);
    expect(res.status).toBe(400);
    // 400 はキャッシュされない: 2 回目も 400
    const again = await app.request(`/public/v1/${slug}/records/post?filter[nope]=1`, {}, env);
    expect(again.status).toBe(400);
  });
});
