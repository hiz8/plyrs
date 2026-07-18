import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { auditLogs, memberships, tenants, users } from "@plyrs/db/control-plane";
import { app } from "../src/index";
import { resetSuperAdmins, superEnv, superLogin } from "./super-login";

afterEach(resetSuperAdmins);

function jsonReq(method: string, path: string, cookie: string, body?: unknown): Request {
  return new Request(`https://api.test${path}`, {
    method,
    headers: { "content-type": "application/json", cookie },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

// 最終ブランチレビュー: カスケード途中失敗からの再実行が収束することを検証するための
// フェイク。実 ASSETS に委譲しつつ、最初の1回だけ .list() を throw する
// (deleteTenantCascade が R2 削除段で使う呼び出し)。
function assetsFailFirstList(real: R2Bucket): R2Bucket {
  let thrown = false;
  return new Proxy(real, {
    get(target, prop, receiver) {
      if (prop === "list" && !thrown) {
        thrown = true;
        return () => {
          throw new Error("simulated ASSETS.list failure");
        };
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as R2Bucket;
}

describe("super tenant CRUD", () => {
  it("requires the super session", async () => {
    expect((await app.request("/super/v1/tenants", {}, superEnv())).status).toBe(401);
  });

  it("self-serve tenant creation is gone", async () => {
    const res = await app.request(
      new Request("https://api.test/v1/tenants", {
        method: "POST",
        body: JSON.stringify({ name: "x", slug: "x" }),
      }),
      undefined,
      superEnv(),
    );
    expect(res.status).toBe(404); // 裁定 9: super 専用化
  });

  it("creates, lists, renames a tenant and assigns an owner by email", async () => {
    const { cookie } = await superLogin();
    const e = superEnv();
    const ownerEmail = `owner+${crypto.randomUUID()}@x.com`;
    await drizzle(env.DB).insert(users).values({
      id: crypto.randomUUID(),
      email: ownerEmail,
      passwordHash: "h",
      createdAt: new Date().toISOString(),
    });

    const missingOwner = await app.request(
      jsonReq("POST", "/super/v1/tenants", cookie, {
        name: "T",
        slug: "sup-a",
        ownerEmail: "nobody@x.com",
      }),
      undefined,
      e,
    );
    expect(missingOwner.status).toBe(404);

    const created = await app.request(
      jsonReq("POST", "/super/v1/tenants", cookie, {
        name: "T",
        slug: "sup-a",
        ownerEmail: ownerEmail.toUpperCase(),
      }),
      undefined,
      e,
    );
    expect(created.status).toBe(201);
    const { tenantId } = (await created.json()) as { tenantId: string };
    const member = await drizzle(env.DB)
      .select()
      .from(memberships)
      .where(eq(memberships.tenantId, tenantId));
    expect(member).toMatchObject([{ role: "owner" }]);

    const dup = await app.request(
      jsonReq("POST", "/super/v1/tenants", cookie, { name: "T2", slug: "sup-a" }),
      undefined,
      e,
    );
    expect(dup.status).toBe(409);

    const listed = (await (
      await app.request("/super/v1/tenants", { headers: { cookie } }, e)
    ).json()) as {
      tenants: { id: string; memberCount: number }[];
    };
    expect(listed.tenants.find((t) => t.id === tenantId)?.memberCount).toBe(1);

    const renamed = await app.request(
      jsonReq("PATCH", `/super/v1/tenants/${tenantId}`, cookie, { name: "T renamed" }),
      undefined,
      e,
    );
    expect(renamed.status).toBe(200);
    const actions = (
      await drizzle(env.DB).select({ action: auditLogs.action }).from(auditLogs)
    ).map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining(["tenant.create", "tenant.rename"]));
  });

  it("deletes a tenant with full cascade", async () => {
    const { cookie } = await superLogin();
    const e = superEnv();
    const created = await app.request(
      jsonReq("POST", "/super/v1/tenants", cookie, { name: "Del", slug: "sup-del" }),
      undefined,
      e,
    );
    const { tenantId } = (await created.json()) as { tenantId: string };
    // 消される対象を作っておく: KV キャッシュ / R2 オブジェクト / 投影行
    await env.TENANT_SLUGS.put(`tenant-slug:sup-del`, JSON.stringify({ id: tenantId }));
    await env.ASSETS.put(`${tenantId}/some-asset`, "bytes");
    // packages/db/src/projection.ts の実カラム(status / published_by は存在しない)に合わせる
    await env.PROJECTION_DB.prepare(
      "INSERT INTO projected_records (tenant_id, record_id, type, slug, published_at, data, source_version, publish_seq, projected_at) VALUES (?1, ?2, 't', NULL, '2026-01-01T00:00:00.000Z', '{}', 1, 1, 1)",
    )
      .bind(tenantId, crypto.randomUUID())
      .run();

    const res = await app.request(
      jsonReq("DELETE", `/super/v1/tenants/${tenantId}`, cookie),
      undefined,
      e,
    );
    expect(res.status).toBe(200);
    expect(
      await drizzle(env.DB).select().from(tenants).where(eq(tenants.id, tenantId)),
    ).toHaveLength(0);
    expect(await env.TENANT_SLUGS.get("tenant-slug:sup-del")).toBeNull();
    expect((await env.ASSETS.list({ prefix: `${tenantId}/` })).objects).toHaveLength(0);
    const projected = await env.PROJECTION_DB.prepare(
      "SELECT COUNT(*) AS n FROM projected_records WHERE tenant_id = ?1",
    )
      .bind(tenantId)
      .first<{ n: number }>();
    expect(projected?.n).toBe(0);
    const actions = (
      await drizzle(env.DB).select({ action: auditLogs.action }).from(auditLogs)
    ).map((r) => r.action);
    expect(actions).toContain("tenant.delete");
  });

  it("recovers from a mid-cascade failure when the DELETE is retried", async () => {
    const { cookie } = await superLogin();
    const e = superEnv();
    const created = await app.request(
      jsonReq("POST", "/super/v1/tenants", cookie, { name: "Retry", slug: "sup-retry" }),
      undefined,
      e,
    );
    const { tenantId } = (await created.json()) as { tenantId: string };
    await env.TENANT_SLUGS.put(`tenant-slug:sup-retry`, JSON.stringify({ id: tenantId }));
    await env.ASSETS.put(`${tenantId}/some-asset`, "bytes");
    await env.PROJECTION_DB.prepare(
      "INSERT INTO projected_records (tenant_id, record_id, type, slug, published_at, data, source_version, publish_seq, projected_at) VALUES (?1, ?2, 't', NULL, '2026-01-01T00:00:00.000Z', '{}', 1, 1, 1)",
    )
      .bind(tenantId, crypto.randomUUID())
      .run();

    // 1 回目: R2 の list が 1 回だけ throw する env で殴る → 500。tenants 行は最後段まで
    // 削除しない設計なので、この時点でも残っている(再実行が存在チェックで 404 にならない)。
    const flaky = await app.request(
      jsonReq("DELETE", `/super/v1/tenants/${tenantId}`, cookie),
      undefined,
      { ...e, ASSETS: assetsFailFirstList(env.ASSETS) },
    );
    expect(flaky.status).toBe(500);
    expect(
      await drizzle(env.DB).select().from(tenants).where(eq(tenants.id, tenantId)),
    ).toHaveLength(1);

    // 2 回目: 通常 env で同じ DELETE を再実行 → 200 に収束する。
    const retried = await app.request(
      jsonReq("DELETE", `/super/v1/tenants/${tenantId}`, cookie),
      undefined,
      e,
    );
    expect(retried.status).toBe(200);
    expect(
      await drizzle(env.DB).select().from(tenants).where(eq(tenants.id, tenantId)),
    ).toHaveLength(0);
    expect(await env.TENANT_SLUGS.get("tenant-slug:sup-retry")).toBeNull();
    expect((await env.ASSETS.list({ prefix: `${tenantId}/` })).objects).toHaveLength(0);
    const projected = await env.PROJECTION_DB.prepare(
      "SELECT COUNT(*) AS n FROM projected_records WHERE tenant_id = ?1",
    )
      .bind(tenantId)
      .first<{ n: number }>();
    expect(projected?.n).toBe(0);

    // 監査: カスケード開始前に書く "start" が2回(1回目の失敗分 + 2回目)、
    // カスケード成功後に書く "complete" が1回だけ残る。
    const deleteAudits = (
      await drizzle(env.DB)
        .select({ detail: auditLogs.detail })
        .from(auditLogs)
        .where(eq(auditLogs.targetId, tenantId))
    ).map((row) => JSON.parse(row.detail ?? "{}") as { phase?: string });
    expect(deleteAudits.filter((d) => d.phase === "start")).toHaveLength(2);
    expect(deleteAudits.filter((d) => d.phase === "complete")).toHaveLength(1);
  });
});
