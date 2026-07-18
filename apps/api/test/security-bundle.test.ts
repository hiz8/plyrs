import { env } from "cloudflare:test";
import { inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sessions, superSessions } from "@plyrs/db/control-plane";
import { app } from "../src/index";
import { purgeExpiredSessions } from "../src/auth/session";
import { fakeLimiter } from "./rate-limit-helper";

const baseEnv = (): Env => ({ ...env, AUTH_LIMITER: fakeLimiter(true) }) as Env;
const credentials = { email: "Sec@Example.com", password: "password-123456" };

afterEach(() => vi.restoreAllMocks());

describe("§6 security bundle", () => {
  it("fails closed with a short JWT_SECRET", async () => {
    const res = await app.request("/auth/tenants", {}, { ...baseEnv(), JWT_SECRET: "short" });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "misconfigured" });
  });

  it("issues __Host- prefixed session cookies and normalizes email", async () => {
    const res = await app.request(
      "/auth/signup",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(credentials),
      },
      baseEnv(),
    );
    expect(res.status).toBe(201);
    expect(res.headers.get("set-cookie")).toContain("__Host-plyrs_session=");
    // 大文字違いの再 signup は同一 email として 409
    const dup = await app.request(
      "/auth/signup",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...credentials, email: "sec@example.COM" }),
      },
      baseEnv(),
    );
    expect(dup.status).toBe(409);
    // 小文字でログインできる
    const login = await app.request(
      "/auth/login",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "sec@example.com", password: credentials.password }),
      },
      baseEnv(),
    );
    expect(login.status).toBe(200);
  });

  it("rate-limits signup and login", async () => {
    const limited = { ...baseEnv(), AUTH_LIMITER: fakeLimiter(false) } as Env;
    for (const path of ["/auth/signup", "/auth/login"]) {
      const res = await app.request(
        path,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(credentials),
        },
        limited,
      );
      expect(res.status).toBe(429);
    }
    const bare = { ...env, AUTH_LIMITER: undefined } as unknown as Env;
    const res = await app.request(
      "/auth/login",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(credentials),
      },
      bare,
    );
    expect(res.status).toBe(503);
  });

  it("requires Turnstile on signup/login only when AUTH_TURNSTILE_SECRET_KEY is set", async () => {
    const withTurnstile = { ...baseEnv(), AUTH_TURNSTILE_SECRET_KEY: "auth-secret" } as Env;
    const missing = await app.request(
      "/auth/login",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(credentials),
      },
      withTurnstile,
    );
    expect(missing.status).toBe(400);
    expect(await missing.json()).toEqual({ error: "turnstile_required" });

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ success: false }), { status: 200 }),
    );
    const failed = await app.request(
      "/auth/login",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...credentials, turnstileToken: "tok" }),
      },
      withTurnstile,
    );
    expect(failed.status).toBe(403);
  });

  it("exposes turnstile site key config", async () => {
    const none = await app.request("/auth/turnstile-config", {}, baseEnv());
    expect(await none.json()).toEqual({ siteKey: null });
    const configured = await app.request("/auth/turnstile-config", {}, {
      ...baseEnv(),
      AUTH_TURNSTILE_SITE_KEY: "site-1",
    } as Env);
    expect(await configured.json()).toEqual({ siteKey: "site-1" });
  });

  it("purges expired and revoked sessions from both session tables", async () => {
    const db = drizzle(env.DB);
    const now = new Date("2026-07-18T00:00:00Z");
    const past = "2020-01-01T00:00:00.000Z";
    const future = "2030-01-01T00:00:00.000Z";
    await db.insert(sessions).values([
      { id: "s-live", tokenHash: "h1", userId: "u", expiresAt: future, createdAt: past },
      { id: "s-expired", tokenHash: "h2", userId: "u", expiresAt: past, createdAt: past },
      {
        id: "s-revoked",
        tokenHash: "h3",
        userId: "u",
        expiresAt: future,
        createdAt: past,
        revokedAt: past,
      },
    ]);
    await db.insert(superSessions).values([
      { id: "ss-live", tokenHash: "h4", adminId: "a", expiresAt: future, createdAt: past },
      { id: "ss-expired", tokenHash: "h5", adminId: "a", expiresAt: past, createdAt: past },
    ]);
    await purgeExpiredSessions(env.DB, now);
    // このファイルは --no-isolate の共有ストレージ(apps/api/test/apply-migrations.ts 参照)で
    // 実行される。同一ファイルの他の it が本物の signup/login で作った無関係な live session が
    // sessions 表に残っているため、ここで挿入した id だけに絞って検証する(gate.test.ts の
    // unique() 様式と同じ「共有ストレージ汚染を避ける」意図)。
    const sessionIds = ["s-live", "s-expired", "s-revoked"];
    const superSessionIds = ["ss-live", "ss-expired"];
    expect(
      (await db.select().from(sessions).where(inArray(sessions.id, sessionIds))).map((r) => r.id),
    ).toEqual(["s-live"]);
    expect(
      (await db.select().from(superSessions).where(inArray(superSessions.id, superSessionIds))).map(
        (r) => r.id,
      ),
    ).toEqual(["ss-live"]);
    // purge されずに残る s-live/ss-live を後始末する。sessions/superSessions は
    // --no-isolate のテストラン全体で共有されるため、放置すると session.test.ts の
    // 「表の全行が正規のハッシュ形式か」という無関係な既存テストを汚染する。
    await db.delete(sessions).where(inArray(sessions.id, sessionIds));
    await db.delete(superSessions).where(inArray(superSessions.id, superSessionIds));
  });
});
