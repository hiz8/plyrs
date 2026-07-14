import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { app } from "../src/index";
import type { TenantDO } from "../src/tenant-do";
import { auth, uuid } from "./fixtures";
import {
  authorType,
  deliverJobs,
  freshTenantSlug,
  postType,
  seedTenant,
  writeAndPublish,
} from "./public-helpers";

const post1 = uuid(450);
const post2 = uuid(451);

describe("public edge cache (§12.6: Cache API + 短 TTL・パージなし)", () => {
  let tenantId: string;
  let tenantSlug: string;
  let stub: DurableObjectStub<TenantDO>;

  beforeEach(async () => {
    tenantId = crypto.randomUUID();
    tenantSlug = freshTenantSlug();
    await seedTenant(tenantId, tenantSlug);
    stub = env.TENANT_DO.get(env.TENANT_DO.idFromName(tenantId));
    await stub.registerContentType(authorType(), auth("owner1"));
    await stub.registerContentType(postType(), auth("owner1"));
    await deliverJobs([
      await writeAndPublish(stub, tenantId, "post", post1, {
        title: "キャッシュ対象",
        slug: "cached",
        authors: [],
      }),
    ]);
  });

  it("serves the cached single body within the TTL even if the projection changes", async () => {
    const path = `/public/v1/${tenantSlug}/records/post/${post1}`;
    const first = await app.request(path, {}, env);
    expect(first.status).toBe(200);
    const firstBody = await first.text();
    // 投影を直接書き換える（派生ストアなのでテスト操作として正当）
    await env.PROJECTION_DB.prepare(
      'UPDATE projected_records SET data = \'{"title":"改変後"}\' WHERE tenant_id = ?1 AND record_id = ?2',
    )
      .bind(tenantId, post1)
      .run();
    const second = await app.request(path, {}, env);
    expect(await second.text()).toBe(firstBody); // TTL 内はキャッシュが答える
  });

  it("normalizes the query string into one cache key (param order irrelevant)", async () => {
    const first = await app.request(
      `/public/v1/${tenantSlug}/records/post?limit=5&sort=-published_at`,
      {},
      env,
    );
    expect(first.status).toBe(200);
    const firstBody = await first.text();
    await env.PROJECTION_DB.prepare(
      'UPDATE projected_records SET data = \'{"title":"改変後2"}\' WHERE tenant_id = ?1 AND record_id = ?2',
    )
      .bind(tenantId, post1)
      .run();
    const reordered = await app.request(
      `/public/v1/${tenantSlug}/records/post?sort=-published_at&limit=5`,
      {},
      env,
    );
    expect(await reordered.text()).toBe(firstBody); // 並び替えても同じキャッシュキー
  });

  it("does not cache a 404 (the record appears as soon as the projection lands)", async () => {
    const path = `/public/v1/${tenantSlug}/records/post/${post2}`;
    expect((await app.request(path, {}, env)).status).toBe(404);
    await deliverJobs([
      await writeAndPublish(stub, tenantId, "post", post2, {
        title: "後から公開",
        slug: "late-pub",
        authors: [],
      }),
    ]);
    expect((await app.request(path, {}, env)).status).toBe(200);
  });
});
