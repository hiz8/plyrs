import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { afterAll, describe, expect, it } from "vitest";
import { auditLogs, superAdmins, superSessions } from "@plyrs/db/control-plane";
import { generateTotpCode } from "../src/auth/totp";
import { app } from "../src/index";
import { fakeLimiter } from "./rate-limit-helper";

const testEnv = (): Env => ({ ...env, AUTH_LIMITER: fakeLimiter(true) }) as Env;

function post(path: string, body: unknown, cookie?: string): Request {
  return new Request(`https://api.test${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
}
const CREDS = { email: "Root@Example.com", password: "super-password-123" };

function cookieOf(res: Response): string {
  const raw = res.headers.get("set-cookie") ?? "";
  return raw.split(";")[0] ?? "";
}

// このファイルは共有 D1(--no-isolate)の super_admins に行を作る。放置すると後続タスクの
// /super-auth/status 前提(bootstrapped: false 等)や super_admins を使うテストを汚染するため、
// describe 末尾で bootstrap した行と紐づく super_sessions を掃除する(tenant_modules と同じ規律)。
let createdAdminId: string | undefined;

afterAll(async () => {
  if (createdAdminId !== undefined) {
    const db = drizzle(env.DB);
    await db.delete(superSessions).where(eq(superSessions.adminId, createdAdminId));
    await db.delete(superAdmins).where(eq(superAdmins.id, createdAdminId));
  }
});

describe("super auth", () => {
  it("runs the bootstrap → totp login → me → logout lifecycle", async () => {
    const e = testEnv();
    expect(await (await app.request("/super-auth/status", {}, e)).json()).toEqual({
      bootstrapped: false,
    });

    const boot = await app.request(post("/super-auth/bootstrap", CREDS), undefined, e);
    expect(boot.status).toBe(201);
    const { adminId, totpSecret, otpauthUri } = (await boot.json()) as {
      adminId: string;
      totpSecret: string;
      otpauthUri: string;
    };
    createdAdminId = adminId;
    expect(otpauthUri).toContain(totpSecret);
    expect(await (await app.request("/super-auth/status", {}, e)).json()).toEqual({
      bootstrapped: true,
    });
    expect((await app.request(post("/super-auth/bootstrap", CREDS), undefined, e)).status).toBe(
      403,
    );

    // email は小文字化されて保存され、ログインは大文字でも通る
    const badPw = await app.request(
      post("/super-auth/login", { ...CREDS, password: "wrong-password-123", totpCode: "000000" }),
      undefined,
      e,
    );
    expect(badPw.status).toBe(401);

    const code = await generateTotpCode(totpSecret, Date.now());
    const login = await app.request(
      post("/super-auth/login", { ...CREDS, totpCode: code }),
      undefined,
      e,
    );
    expect(login.status).toBe(200);
    const cookie = cookieOf(login);
    expect(cookie).toContain("__Host-plyrs_super_session=");

    // 同じコードの再使用(リプレイ)は拒否
    const replay = await app.request(
      post("/super-auth/login", { ...CREDS, totpCode: code }),
      undefined,
      e,
    );
    expect(replay.status).toBe(401);

    // 次の window のコードは counter が前進しているので通る
    const nextCode = await generateTotpCode(totpSecret, Date.now() + 30_000);
    const second = await app.request(
      post("/super-auth/login", { ...CREDS, totpCode: nextCode }),
      undefined,
      e,
    );
    expect(second.status).toBe(200);

    const me = await app.request("/super-auth/me", { headers: { cookie } }, e);
    expect(await me.json()).toEqual({ adminId, email: "root@example.com" });

    const logout = await app.request(
      new Request("https://api.test/super-auth/logout", { method: "POST", headers: { cookie } }),
      undefined,
      e,
    );
    expect(logout.status).toBe(200);
    expect((await app.request("/super-auth/me", { headers: { cookie } }, e)).status).toBe(401);

    const actions = (
      await drizzle(env.DB).select({ action: auditLogs.action }).from(auditLogs)
    ).map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining(["super.bootstrap", "super.login"]));
  });

  it("rejects an unknown totp and rate-limits login", async () => {
    // bootstrap 済み前提の状態はテストファイル内で作る(共有 D1 のため既存 admin がいれば skip 不要
    // — このファイルは 1 worker 内で直列実行される)
    const e = testEnv();
    const wrong = await app.request(
      post("/super-auth/login", { ...CREDS, totpCode: "123456" }),
      undefined,
      e,
    );
    expect(wrong.status).toBe(401);
    const limited = { ...env, AUTH_LIMITER: fakeLimiter(false) } as Env;
    const res = await app.request(
      post("/super-auth/login", { ...CREDS, totpCode: "123456" }),
      undefined,
      limited,
    );
    expect(res.status).toBe(429);
  });
});
