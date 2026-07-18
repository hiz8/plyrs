import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { app } from "../src/index";
import { blockUser } from "../src/auth/blocklist";
import { verifyTenantToken } from "../src/auth/jwt";
import { SESSION_COOKIE } from "../src/auth/session";
import { fakeLimiter } from "./rate-limit-helper";

// 共有ストレージ（--no-isolate）ではファイル間でも衝突しないよう、実行ごとのランダム接頭辞を混ぜる
const RUN_ID = crypto.randomUUID().slice(0, 8);
let n = 0;
function unique(prefix: string): string {
  n += 1;
  return `${prefix}${RUN_ID}-${n}`;
}

// §6: AUTH_LIMITER は実体が本物の Miniflare シミュレート ratelimit(limit=10/period=60)。
// --no-isolate のテストランでは全ファイルが同じバケットを共有するため、signup/login を
// 何度も叩くこのファイルは常にこの env を使う(素の env だと他テストの呼び出し数次第で 429 が混入する)。
const testEnv: Env = { ...env, AUTH_LIMITER: fakeLimiter(true) };

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
  const res = await app.request(
    "/auth/signup",
    json({ email, password: "hunter2hunter2" }),
    testEnv,
  );
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
      testEnv,
    );
    expect(first.status).toBe(201);
    const setCookie = first.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(`${SESSION_COOKIE}=`);
    expect(setCookie).toContain("HttpOnly");
    const second = await app.request(
      "/auth/signup",
      json({ email, password: "hunter2hunter2" }),
      testEnv,
    );
    expect(second.status).toBe(409);
  });

  it("logs in with correct credentials and rejects wrong ones", async () => {
    const email = `${unique("login")}@example.com`;
    await app.request("/auth/signup", json({ email, password: "hunter2hunter2" }), testEnv);
    const ok = await app.request(
      "/auth/login",
      json({ email, password: "hunter2hunter2" }),
      testEnv,
    );
    expect(ok.status).toBe(200);
    const bad = await app.request(
      "/auth/login",
      json({ email, password: "wrong-password" }),
      testEnv,
    );
    expect(bad.status).toBe(401);
  });

  it("rejects malformed bodies via validation", async () => {
    const res = await app.request(
      "/auth/signup",
      json({ email: "not-an-email", password: "short" }),
      testEnv,
    );
    expect(res.status).toBe(400);
  });

  it("revokes the session on logout", async () => {
    const { cookie } = await signupAndLogin();
    const out = await app.request("/auth/logout", json({}, cookie), testEnv);
    expect(out.status).toBe(200);
    const denied = await app.request(
      "/auth/token",
      json({ tenantId: crypto.randomUUID() }, cookie),
      testEnv,
    );
    expect(denied.status).toBe(401);
  });

  it("creates a tenant with an owner membership and unique slug", async () => {
    const { cookie } = await signupAndLogin();
    const slug = unique("blog-");
    const created = await app.request("/v1/tenants", json({ name: "Blog", slug }, cookie), testEnv);
    expect(created.status).toBe(201);
    const dup = await app.request("/v1/tenants", json({ name: "Blog2", slug }, cookie), testEnv);
    expect(dup.status).toBe(409);
    const anon = await app.request("/v1/tenants", json({ name: "X", slug: unique("s-") }), testEnv);
    expect(anon.status).toBe(401);
  });

  it("issues a 15-minute tenant JWT to members only (G5)", async () => {
    const { userId, cookie } = await signupAndLogin();
    const created = await app.request(
      "/v1/tenants",
      json({ name: "T", slug: unique("t-") }, cookie),
      testEnv,
    );
    const { tenantId } = (await created.json()) as { tenantId: string };

    const issued = await app.request("/auth/token", json({ tenantId }, cookie), testEnv);
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
    const denied = await app.request("/auth/token", json({ tenantId }, outsider.cookie), testEnv);
    expect(denied.status).toBe(403);
  });

  it("refuses tokens to blocked users (design-spec §11.2)", async () => {
    const { userId, cookie } = await signupAndLogin();
    const created = await app.request(
      "/v1/tenants",
      json({ name: "B", slug: unique("b-") }, cookie),
      testEnv,
    );
    const { tenantId } = (await created.json()) as { tenantId: string };
    await blockUser(env.BLOCKLIST, userId);
    const denied = await app.request("/auth/token", json({ tenantId }, cookie), testEnv);
    expect(denied.status).toBe(403);
  });

  it("lists the session user's tenants with roles (Phase 6a)", async () => {
    const { cookie } = await signupAndLogin();
    const slugB = unique("b-");
    const slugA = unique("a-");
    await app.request("/v1/tenants", json({ name: "B", slug: slugB }, cookie), testEnv);
    await app.request("/v1/tenants", json({ name: "A", slug: slugA }, cookie), testEnv);
    const res = await app.request("/auth/tenants", { headers: { cookie } }, testEnv);
    expect(res.status).toBe(200);
    const { tenants } = (await res.json()) as {
      tenants: { id: string; slug: string; name: string; role: string }[];
    };
    expect(tenants.map((t) => t.slug)).toStrictEqual([slugA, slugB]);
    expect(tenants.map((t) => t.name)).toStrictEqual(["A", "B"]);
    expect(tenants.every((t) => t.role === "owner")).toBe(true);
    expect(tenants.every((t) => t.id.length === 36)).toBe(true);
  });

  it("rejects anonymous and blocked users on /auth/tenants", async () => {
    const anon = await app.request("/auth/tenants", {}, testEnv);
    expect(anon.status).toBe(401);
    const { userId, cookie } = await signupAndLogin();
    await blockUser(env.BLOCKLIST, userId);
    const denied = await app.request("/auth/tenants", { headers: { cookie } }, testEnv);
    expect(denied.status).toBe(403);
  });

  it("rejects login for a globally blocked user", async () => {
    const email = `${unique("blocked")}@example.com`;
    const signup = await app.request(
      "/auth/signup",
      json({ email, password: "hunter2hunter2" }),
      testEnv,
    );
    const { userId } = (await signup.json()) as { userId: string };
    await blockUser(env.BLOCKLIST, userId);
    const denied = await app.request(
      "/auth/login",
      json({ email, password: "hunter2hunter2" }),
      testEnv,
    );
    expect(denied.status).toBe(403);
    expect(await denied.json()).toMatchObject({ error: "blocked" });
  });
});
