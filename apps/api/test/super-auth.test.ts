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
  // 並行リクエストの TOCTOU 対策(単文アトミック化)の回帰テスト。super_admins が空の状態から
  // 異なる email で bootstrap を 2 本同時発火し、片方だけが 201・もう片方が 403 になることを
  // 確認する(既存の「二回目 bootstrap 403」テストは逐次呼び出しのため、早期 SELECT チェック
  // だけで通ってしまい、単文化を SELECT+INSERT の 2 文実装へ「整理」する回帰を検知できない)。
  // このテストは super_admins が空であることが前提のため、下の lifecycle テストより先に置き、
  // 勝者の行を自前で後始末して空の状態へ戻す(afterAll の掃除規律と同じ)。
  it("allows only one of two concurrent bootstraps with different emails", async () => {
    const e = testEnv();
    const credsA = { email: "RaceA@Example.com", password: "race-a-password-123" };
    const credsB = { email: "RaceB@Example.com", password: "race-b-password-123" };
    const [r1, r2] = await Promise.all([
      app.request(post("/super-auth/bootstrap", credsA), undefined, e),
      app.request(post("/super-auth/bootstrap", credsB), undefined, e),
    ]);
    expect([r1.status, r2.status].toSorted()).toEqual([201, 403]);
    const winner = r1.status === 201 ? r1 : r2;
    const { adminId } = (await winner.json()) as { adminId: string };
    const db = drizzle(env.DB);
    await db.delete(superSessions).where(eq(superSessions.adminId, adminId));
    await db.delete(superAdmins).where(eq(superAdmins.id, adminId));
  });

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

  // 並行リクエストの TOCTOU 対策(CAS)の回帰テスト。同一 totp コードで 2 リクエストを真に
  // 並行発火し、片方だけが 200(セッション発行)・もう片方が 401 になることを確認する。
  // CAS の WHERE totp_last_counter < counter を外して(無条件 UPDATE に戻して)同じテストを
  // 実行すると、この harness では 3/3 回とも 200/200(セッション二重発行)が再現することを
  // 実装時に確認済み — 単発リクエストの「totp_last_counter を先回りして書き換えてから 1 回
  // ログインする」形の検証は、早期チェック(counter <= totpLastCounter)だけで 401 になって
  // しまい CAS 自体の効果を判別できないため、実際に並行させる形にしている。
  it("allows only one of two concurrent logins presenting the same totp code", async () => {
    const e = testEnv();
    const db = drizzle(env.DB);
    // 先行の lifecycle テストで bootstrap 済みの CREDS admin を使う(このファイルは 1 worker 内で
    // 直列実行されるため、この時点で必ず存在する)。
    const admin = (
      await db
        .select({ id: superAdmins.id, totpSecret: superAdmins.totpSecret })
        .from(superAdmins)
        .where(eq(superAdmins.email, "root@example.com"))
        .limit(1)
    )[0];
    if (admin === undefined) {
      throw new Error(
        "root@example.com super admin fixture missing (bootstrap test must run first)",
      );
    }
    // 先行テストで totp_last_counter が既に進んでいる。verifyTotpCode の許容ドリフトは
    // 現在時刻 ±1 window しかないため、時刻オフセットで「未消費の window」を探すのではなく、
    // totp_last_counter 自体を現在時刻の counter より確実に低い値へ巻き戻してから、
    // 「現在時刻」のコード(ドリフト 0 で最も確実に一致する)を使う。
    await db.update(superAdmins).set({ totpLastCounter: 0 }).where(eq(superAdmins.id, admin.id));
    const code = await generateTotpCode(admin.totpSecret, Date.now());
    const [r1, r2] = await Promise.all([
      app.request(post("/super-auth/login", { ...CREDS, totpCode: code }), undefined, e),
      app.request(post("/super-auth/login", { ...CREDS, totpCode: code }), undefined, e),
    ]);
    expect([r1.status, r2.status].toSorted()).toEqual([200, 401]);
  });
});
