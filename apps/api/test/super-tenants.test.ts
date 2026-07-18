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
});
