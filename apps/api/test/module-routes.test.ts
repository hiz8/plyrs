import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/d1";
import { memberships } from "@plyrs/db/control-plane";
import { app } from "../src/index";
import { insertTenantWithOwner } from "./create-tenant";
import { fakeLimiter } from "./rate-limit-helper";

// §6: AUTH_LIMITER は本物の Miniflare シミュレート ratelimit(--no-isolate で全ファイル共有)。
// signup を叩く setupTenant はこの env を使う(素の env だと他テストの呼び出し数次第で 429 が混入する)。
const authEnv: Env = { ...env, AUTH_LIMITER: fakeLimiter(true) };

// gate.test.ts の bootstrapTenant / grantMembership 様式(共有ストレージ対策のランダム接頭辞込み)
const RUN_ID = crypto.randomUUID().slice(0, 8);
let n = 0;
function unique(prefix: string): string {
  n += 1;
  return `${prefix}${RUN_ID}-${n}`;
}

function json(body: unknown, headers: Record<string, string> = {}): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  };
}

async function setupTenant(): Promise<{
  tenantId: string;
  ownerToken: string;
  viewerToken: string;
}> {
  const signup = await app.request(
    "/auth/signup",
    json({ email: `${unique("owner")}@example.com`, password: "hunter2hunter2" }),
    authEnv,
  );
  const { userId } = (await signup.json()) as { userId: string };
  const cookie = (signup.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  const { tenantId } = await insertTenantWithOwner(userId, { slug: unique("t-") });
  const issued = await app.request("/auth/token", json({ tenantId }, { cookie }), authEnv);
  const { token: ownerToken } = (await issued.json()) as { token: string };

  const viewerSignup = await app.request(
    "/auth/signup",
    json({ email: `${unique("viewer")}@example.com`, password: "hunter2hunter2" }),
    authEnv,
  );
  const { userId: viewerId } = (await viewerSignup.json()) as { userId: string };
  const viewerCookie = (viewerSignup.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  await drizzle(env.DB)
    .insert(memberships)
    .values({ userId: viewerId, tenantId, role: "viewer", createdAt: new Date().toISOString() });
  const viewerIssued = await app.request(
    "/auth/token",
    json({ tenantId }, { cookie: viewerCookie }),
    authEnv,
  );
  const { token: viewerToken } = (await viewerIssued.json()) as { token: string };
  return { tenantId, ownerToken, viewerToken };
}

describe("モジュール管理 API", () => {
  it("enable → 一覧 → disable が HTTP で一巡し、D1 ミラーが更新される", async () => {
    const { tenantId, ownerToken } = await setupTenant();
    const enable = await app.request(
      `/v1/t/${tenantId}/modules/booking/enable`,
      { method: "POST", headers: { authorization: `Bearer ${ownerToken}` } },
      env,
    );
    expect(enable.status).toBe(200);
    const list = await app.request(
      `/v1/t/${tenantId}/modules`,
      { headers: { authorization: `Bearer ${ownerToken}` } },
      env,
    );
    const { modules } = (await list.json()) as {
      modules: { moduleId: string; enabled: boolean }[];
    };
    expect(modules).toEqual([
      expect.objectContaining({ moduleId: "booking", enabled: true, appliedVersion: 1 }),
    ]);
    const mirror = await env.DB.prepare(
      "SELECT enabled FROM tenant_modules WHERE tenant_id = ? AND module_id = 'booking'",
    )
      .bind(tenantId)
      .first<{ enabled: number }>();
    expect(mirror?.enabled).toBe(1);

    const disable = await app.request(
      `/v1/t/${tenantId}/modules/booking/disable`,
      { method: "POST", headers: { authorization: `Bearer ${ownerToken}` } },
      env,
    );
    expect(disable.status).toBe(200);
    const mirrorAfter = await env.DB.prepare(
      "SELECT enabled FROM tenant_modules WHERE tenant_id = ? AND module_id = 'booking'",
    )
      .bind(tenantId)
      .first<{ enabled: number }>();
    expect(mirrorAfter?.enabled).toBe(0);
  });

  it("viewer の enable は 403、未知モジュールは 404", async () => {
    const { tenantId, ownerToken, viewerToken } = await setupTenant();
    const forbidden = await app.request(
      `/v1/t/${tenantId}/modules/booking/enable`,
      { method: "POST", headers: { authorization: `Bearer ${viewerToken}` } },
      env,
    );
    expect(forbidden.status).toBe(403);
    const unknown = await app.request(
      `/v1/t/${tenantId}/modules/ghost/enable`,
      { method: "POST", headers: { authorization: `Bearer ${ownerToken}` } },
      env,
    );
    expect(unknown.status).toBe(404);
  });
});
