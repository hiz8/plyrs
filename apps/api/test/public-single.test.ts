import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { app } from "../src/index";
import type { TenantDO } from "../src/tenant-do";
import { auth, uuid } from "./fixtures";
import { asWriteResult } from "./rpc-unwrap";
import {
  authorType,
  deliverJobs,
  freshTenantSlug,
  postType,
  seedTenant,
  writeAndPublish,
} from "./public-helpers";

const author1 = uuid(410);
const author2 = uuid(411);
const author3 = uuid(412); // 書くが publish しない（ソフト参照の不在側）
const post1 = uuid(413);

describe("public single fetch (§12.4)", () => {
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
    const jobs = [
      await writeAndPublish(stub, tenantId, "author", author1, { name: "著者1", slug: "a-one" }),
      await writeAndPublish(stub, tenantId, "author", author2, { name: "著者2", slug: "a-two" }),
    ];
    const unpublished = asWriteResult(
      await stub.writeRecord(
        "author",
        { recordId: author3, input: { name: "未公開", slug: "a-three" } },
        auth("owner1"),
      ),
    );
    if (!unpublished.ok) {
      throw new Error("author3 write failed");
    }
    jobs.push(
      await writeAndPublish(stub, tenantId, "post", post1, {
        title: "最初の投稿",
        slug: "first-post",
        rating: 5,
        featured: true,
        event_at: "2026-07-10T00:00:00.000Z",
        category: "tech",
        tags: ["x", "y"],
        authors: [
          { type: "author", id: author1 },
          { type: "author", id: author2 },
          { type: "author", id: author3 },
        ],
      }),
    );
    await deliverJobs(jobs);
  });

  it("returns the public shape by id, without internal values", async () => {
    const response = await app.request(`/public/v1/${tenantSlug}/records/post/${post1}`, {}, env);
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      id: post1,
      type: "post",
      slug: "first-post",
      fields: { title: "最初の投稿", rating: 5, category: "tech" },
    });
    expect(typeof body["publishedAt"]).toBe("string");
    // 裁定（2026-07-14 #3）: include なしでも関係フィールドは ID 配列として fields に現れる
    // （書き込み順 = ordinal 順。未公開の author3 の ID も残る）
    expect((body["fields"] as Record<string, unknown>)["authors"]).toStrictEqual([
      author1,
      author2,
      author3,
    ]);
    for (const internal of ["sourceVersion", "publishSeq", "projectedAt", "data"]) {
      expect(body).not.toHaveProperty(internal);
    }
    expect(response.headers.get("etag")).toMatch(/^W\/"\d+"$/u);
    expect(response.headers.get("cache-control")).toContain("s-maxage=");
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("returns the same record by slug", async () => {
    const response = await app.request(
      `/public/v1/${tenantSlug}/records/post/slug/first-post`,
      {},
      env,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { id: string };
    expect(body.id).toBe(post1);
  });

  // # 入り slug とその前置 slug がキャッシュキー上で衝突しないことの回帰テスト。
  it("does not collide cache keys between a slug containing '#' and its prefix slug", async () => {
    const trickyId = uuid(414);
    const plainId = uuid(415);
    await deliverJobs([
      await writeAndPublish(stub, tenantId, "post", trickyId, {
        title: "罠あり",
        slug: "trick#one",
      }),
      await writeAndPublish(stub, tenantId, "post", plainId, {
        title: "罠なし",
        slug: "trick",
      }),
    ]);
    const tricky = await app.request(
      `/public/v1/${tenantSlug}/records/post/slug/trick%23one`,
      {},
      env,
    );
    expect(tricky.status).toBe(200);
    const trickyBody = (await tricky.json()) as { fields: { title: string } };
    expect(trickyBody.fields.title).toBe("罠あり");
    const plain = await app.request(`/public/v1/${tenantSlug}/records/post/slug/trick`, {}, env);
    expect(plain.status).toBe(200);
    // 先行リクエストのキャッシュ済み本文（罠あり）が返ってこないこと
    const plainBody = (await plain.json()) as { fields: { title: string } };
    expect(plainBody.fields.title).toBe("罠なし");
  });

  it("404s when the id exists under a different type (url must tell the truth)", async () => {
    const response = await app.request(`/public/v1/${tenantSlug}/records/author/${post1}`, {}, env);
    expect(response.status).toBe(404);
  });

  it("404s for an unpublished record and an unknown tenant", async () => {
    expect(
      (await app.request(`/public/v1/${tenantSlug}/records/author/${author3}`, {}, env)).status,
    ).toBe(404);
    expect(
      (await app.request(`/public/v1/no-such-tenant/records/post/${post1}`, {}, env)).status,
    ).toBe(404);
  });

  it("expands include=authors into included[], dropping unpublished targets", async () => {
    const response = await app.request(
      `/public/v1/${tenantSlug}/records/post/${post1}?include=authors`,
      {},
      env,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      fields: { authors: unknown[] };
      included: { id: string }[];
    };
    // レコード内の参照値は ID のまま（3 件とも残る）
    expect(body.fields.authors.length).toBe(3);
    // included には公開済みの 2 件だけ（author3 はソフト参照で不在）
    expect(body.included.map((record) => record.id).sort()).toStrictEqual(
      [author1, author2].sort(),
    );
  });

  it("rejects include of a non-relation field and unknown params", async () => {
    expect(
      (await app.request(`/public/v1/${tenantSlug}/records/post/${post1}?include=title`, {}, env))
        .status,
    ).toBe(400);
    expect(
      (await app.request(`/public/v1/${tenantSlug}/records/post/${post1}?foo=1`, {}, env)).status,
    ).toBe(400);
  });

  it("answers 304 to a matching If-None-Match", async () => {
    const first = await app.request(`/public/v1/${tenantSlug}/records/post/${post1}`, {}, env);
    const etag = first.headers.get("etag");
    if (etag === null) {
      throw new Error("no etag");
    }
    const second = await app.request(
      `/public/v1/${tenantSlug}/records/post/${post1}`,
      { headers: { "if-none-match": etag } },
      env,
    );
    expect(second.status).toBe(304);
  });

  it("answers CORS preflight", async () => {
    const response = await app.request(
      `/public/v1/${tenantSlug}/records/post/${post1}`,
      {
        method: "OPTIONS",
        headers: { origin: "https://example.com", "access-control-request-method": "GET" },
      },
      env,
    );
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
  });
});
