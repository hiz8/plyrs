import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/d1";
import { memberships } from "@plyrs/db/control-plane";
import app from "../src/index";
import { blockUser } from "../src/auth/blocklist";
import { articleType, uuid, validArticleInput } from "./fixtures";

let n = 0;
function unique(prefix: string): string {
  n += 1;
  return `${prefix}${n}`;
}

function json(body: unknown, headers: Record<string, string> = {}): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  };
}

async function bootstrapTenant(): Promise<{
  tenantId: string;
  userId: string;
  bearer: string;
  cookie: string;
}> {
  const email = `${unique("owner")}@example.com`;
  const signup = await app.request(
    "/auth/signup",
    json({ email, password: "hunter2hunter2" }),
    env,
  );
  const { userId } = (await signup.json()) as { userId: string };
  const cookie = (signup.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  const created = await app.request(
    "/v1/tenants",
    json({ name: "T", slug: unique("t-") }, { cookie }),
    env,
  );
  const { tenantId } = (await created.json()) as { tenantId: string };
  const issued = await app.request("/auth/token", json({ tenantId }, { cookie }), env);
  const { token } = (await issued.json()) as { token: string };
  return { tenantId, userId, bearer: `Bearer ${token}`, cookie };
}

async function grantMembership(userId: string, tenantId: string, role: string): Promise<void> {
  await drizzle(env.DB)
    .insert(memberships)
    .values({ userId, tenantId, role, createdAt: new Date().toISOString() });
}

describe("tenant gate + gated DO routes (end to end)", () => {
  it("walks the full journey: type registration, record write, read", async () => {
    const { tenantId, bearer } = await bootstrapTenant();

    const typeRes = await app.request(
      `/v1/t/${tenantId}/content-types`,
      {
        method: "PUT",
        headers: { "content-type": "application/json", authorization: bearer },
        body: JSON.stringify(articleType()),
      },
      env,
    );
    expect(typeRes.status).toBe(200);

    const recordId = uuid(70);
    const writeRes = await app.request(
      `/v1/t/${tenantId}/records/article/${recordId}`,
      {
        method: "PUT",
        headers: { "content-type": "application/json", authorization: bearer },
        body: JSON.stringify({ input: validArticleInput() }),
      },
      env,
    );
    expect(writeRes.status).toBe(200);

    const readRes = await app.request(
      `/v1/t/${tenantId}/records/${recordId}`,
      {
        headers: { authorization: bearer },
      },
      env,
    );
    expect(readRes.status).toBe(200);
    const record = (await readRes.json()) as { type: string; data: Record<string, unknown> };
    expect(record.type).toBe("article");
    expect(record.data["title"]).toBe("こんにちは");
  });

  it("maps DO domain errors to HTTP statuses", async () => {
    const { tenantId, bearer } = await bootstrapTenant();
    const missingType = await app.request(
      `/v1/t/${tenantId}/records/nope/${uuid(71)}`,
      {
        method: "PUT",
        headers: { "content-type": "application/json", authorization: bearer },
        body: JSON.stringify({ input: {} }),
      },
      env,
    );
    expect(missingType.status).toBe(404);
    const missingRecord = await app.request(
      `/v1/t/${tenantId}/records/${uuid(72)}`,
      {
        headers: { authorization: bearer },
      },
      env,
    );
    expect(missingRecord.status).toBe(404);
  });

  it("rejects requests without a token, with a wrong-tenant token, and from blocked users", async () => {
    const a = await bootstrapTenant();
    const b = await bootstrapTenant();

    expect((await app.request(`/v1/t/${a.tenantId}/records/${uuid(73)}`, {}, env)).status).toBe(
      401,
    );

    const crossTenant = await app.request(
      `/v1/t/${a.tenantId}/records/${uuid(73)}`,
      {
        headers: { authorization: b.bearer },
      },
      env,
    );
    expect(crossTenant.status).toBe(403);

    await blockUser(env.BLOCKLIST, a.userId);
    const blocked = await app.request(
      `/v1/t/${a.tenantId}/records/${uuid(73)}`,
      {
        headers: { authorization: a.bearer },
      },
      env,
    );
    expect(blocked.status).toBe(403);
  });

  it("propagates stage-2 denial for viewers as 403 (defense in depth)", async () => {
    const owner = await bootstrapTenant();
    const viewer = await bootstrapTenant(); // 別テナントの owner だが、owner.tenantId では viewer
    await grantMembership(viewer.userId, owner.tenantId, "viewer");
    const issued = await app.request(
      "/auth/token",
      json({ tenantId: owner.tenantId }, { cookie: viewer.cookie }),
      env,
    );
    const { token } = (await issued.json()) as { token: string };

    await app.request(
      `/v1/t/${owner.tenantId}/content-types`,
      {
        method: "PUT",
        headers: { "content-type": "application/json", authorization: owner.bearer },
        body: JSON.stringify(articleType()),
      },
      env,
    );

    const denied = await app.request(
      `/v1/t/${owner.tenantId}/records/article/${uuid(74)}`,
      {
        method: "PUT",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ input: validArticleInput() }),
      },
      env,
    );
    expect(denied.status).toBe(403);
  });

  it("returns 400 for malformed JSON on content-type registration", async () => {
    const { tenantId, bearer } = await bootstrapTenant();
    const res = await app.request(
      `/v1/t/${tenantId}/content-types`,
      {
        method: "PUT",
        headers: { "content-type": "application/json", authorization: bearer },
        body: "{not json",
      },
      env,
    );
    expect(res.status).toBe(400);
  });
});
