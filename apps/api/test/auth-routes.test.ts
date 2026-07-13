import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import app from "../src/index";
import { blockUser } from "../src/auth/blocklist";
import { verifyTenantToken } from "../src/auth/jwt";

// 共有ストレージ（--no-isolate）ではファイル間でも衝突しないよう、実行ごとのランダム接頭辞を混ぜる
const RUN_ID = crypto.randomUUID().slice(0, 8);
let n = 0;
function unique(prefix: string): string {
  n += 1;
  return `${prefix}${RUN_ID}-${n}`;
}

function json(body: unknown, cookie?: string): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  };
}

function cookieFrom(res: Response): string {
  return (res.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
}

async function signupAndLogin(): Promise<{ userId: string; cookie: string }> {
  const email = `${unique("user")}@example.com`;
  const res = await app.request("/auth/signup", json({ email, password: "hunter2hunter2" }), env);
  expect(res.status).toBe(201);
  const { userId } = (await res.json()) as { userId: string };
  return { userId, cookie: cookieFrom(res) };
}

describe("auth routes", () => {
  it("signs up, sets a session cookie, and rejects duplicate emails", async () => {
    const email = `${unique("dup")}@example.com`;
    const first = await app.request(
      "/auth/signup",
      json({ email, password: "hunter2hunter2" }),
      env,
    );
    expect(first.status).toBe(201);
    const setCookie = first.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("plyrs_session=");
    expect(setCookie).toContain("HttpOnly");
    const second = await app.request(
      "/auth/signup",
      json({ email, password: "hunter2hunter2" }),
      env,
    );
    expect(second.status).toBe(409);
  });

  it("logs in with correct credentials and rejects wrong ones", async () => {
    const email = `${unique("login")}@example.com`;
    await app.request("/auth/signup", json({ email, password: "hunter2hunter2" }), env);
    const ok = await app.request("/auth/login", json({ email, password: "hunter2hunter2" }), env);
    expect(ok.status).toBe(200);
    const bad = await app.request("/auth/login", json({ email, password: "wrong-password" }), env);
    expect(bad.status).toBe(401);
  });

  it("rejects malformed bodies via validation", async () => {
    const res = await app.request(
      "/auth/signup",
      json({ email: "not-an-email", password: "short" }),
      env,
    );
    expect(res.status).toBe(400);
  });

  it("revokes the session on logout", async () => {
    const { cookie } = await signupAndLogin();
    const out = await app.request("/auth/logout", json({}, cookie), env);
    expect(out.status).toBe(200);
    const denied = await app.request(
      "/auth/token",
      json({ tenantId: crypto.randomUUID() }, cookie),
      env,
    );
    expect(denied.status).toBe(401);
  });

  it("creates a tenant with an owner membership and unique slug", async () => {
    const { cookie } = await signupAndLogin();
    const slug = unique("blog-");
    const created = await app.request("/v1/tenants", json({ name: "Blog", slug }, cookie), env);
    expect(created.status).toBe(201);
    const dup = await app.request("/v1/tenants", json({ name: "Blog2", slug }, cookie), env);
    expect(dup.status).toBe(409);
    const anon = await app.request("/v1/tenants", json({ name: "X", slug: unique("s-") }), env);
    expect(anon.status).toBe(401);
  });

  it("issues a 15-minute tenant JWT to members only (G5)", async () => {
    const { userId, cookie } = await signupAndLogin();
    const created = await app.request(
      "/v1/tenants",
      json({ name: "T", slug: unique("t-") }, cookie),
      env,
    );
    const { tenantId } = (await created.json()) as { tenantId: string };

    const issued = await app.request("/auth/token", json({ tenantId }, cookie), env);
    expect(issued.status).toBe(200);
    const { token, expiresIn } = (await issued.json()) as { token: string; expiresIn: number };
    expect(expiresIn).toBe(900);
    const verified = await verifyTenantToken(env.JWT_SECRET, token);
    expect(verified).toMatchObject({
      userId,
      tenantId,
      role: "owner",
    });
    expect(verified?.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));

    const outsider = await signupAndLogin();
    const denied = await app.request("/auth/token", json({ tenantId }, outsider.cookie), env);
    expect(denied.status).toBe(403);
  });

  it("refuses tokens to blocked users (design-spec §11.2)", async () => {
    const { userId, cookie } = await signupAndLogin();
    const created = await app.request(
      "/v1/tenants",
      json({ name: "B", slug: unique("b-") }, cookie),
      env,
    );
    const { tenantId } = (await created.json()) as { tenantId: string };
    await blockUser(env.BLOCKLIST, userId);
    const denied = await app.request("/auth/token", json({ tenantId }, cookie), env);
    expect(denied.status).toBe(403);
  });
});
