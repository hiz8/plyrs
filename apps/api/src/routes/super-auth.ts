import { zValidator } from "@hono/zod-validator";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { superAdmins } from "@plyrs/db/control-plane";
import { writeAudit } from "../audit";
import { normalizeEmail } from "../auth/email";
import { hashPassword, verifyPassword } from "../auth/password";
import { checkAuthRateLimit } from "../auth/rate-limit";
import {
  createSuperSession,
  revokeSuperSession,
  SUPER_SESSION_COOKIE,
} from "../auth/super-session";
import { generateTotpSecret, otpauthUri, verifyTotpCode } from "../auth/totp";
import { superGate, type SuperGateVariables } from "../middleware/super-gate";

const bootstrapSchema = z.object({
  email: z.email().max(254),
  password: z.string().min(12).max(128),
});
const loginSchema = bootstrapSchema.extend({ totpCode: z.string().regex(/^\d{6}$/) });

const SUPER_COOKIE_OPTIONS = {
  path: "/",
  httpOnly: true,
  secure: true,
  sameSite: "Strict",
  maxAge: 7 * 86_400,
} as const;

type SuperAuthEnv = { Bindings: Env; Variables: SuperGateVariables };

export const superAuthRoutes = new Hono<SuperAuthEnv>()
  .get("/status", async (c) => {
    const row = (
      await drizzle(c.env.DB).select({ id: superAdmins.id }).from(superAdmins).limit(1)
    )[0];
    return c.json({ bootstrapped: row !== undefined });
  })
  // super_admins が空のときだけ有効な初期化経路。secret はこの応答限り(以後表示しない)。
  // TOTP 紛失時の復旧は手動 SQL(docs/deploy.md)。
  .post("/bootstrap", zValidator("json", bootstrapSchema), async (c) => {
    const decision = await checkAuthRateLimit(c.env, c.req.header("cf-connecting-ip"));
    if (decision !== "ok") {
      return decision === "limited"
        ? c.json({ error: "rate_limited" }, 429)
        : c.json({ error: "rate_limiter_unavailable" }, 503);
    }
    const db = drizzle(c.env.DB);
    const existing = (await db.select({ id: superAdmins.id }).from(superAdmins).limit(1))[0];
    if (existing !== undefined) {
      return c.json({ error: "already_bootstrapped" }, 403);
    }
    const { email, password } = c.req.valid("json");
    const normalized = normalizeEmail(email);
    const secret = generateTotpSecret();
    const adminId = uuidv7();
    await db.insert(superAdmins).values({
      id: adminId,
      email: normalized,
      passwordHash: await hashPassword(password),
      totpSecret: secret,
      totpLastCounter: 0,
      createdAt: new Date().toISOString(),
    });
    await writeAudit(c.env.DB, {
      actorId: adminId,
      action: "super.bootstrap",
      targetType: "super_admin",
      targetId: adminId,
    });
    return c.json({ adminId, totpSecret: secret, otpauthUri: otpauthUri(normalized, secret) }, 201);
  })
  // 単段ログイン(パスワード + TOTP を 1 リクエスト。中間状態セッションを持たない)。
  // 失敗理由は区別せず invalid_credentials に畳む(列挙耐性)。
  .post("/login", zValidator("json", loginSchema), async (c) => {
    const decision = await checkAuthRateLimit(c.env, c.req.header("cf-connecting-ip"));
    if (decision !== "ok") {
      return decision === "limited"
        ? c.json({ error: "rate_limited" }, 429)
        : c.json({ error: "rate_limiter_unavailable" }, 503);
    }
    const { email, password, totpCode } = c.req.valid("json");
    const db = drizzle(c.env.DB);
    const row = (
      await db
        .select()
        .from(superAdmins)
        .where(eq(superAdmins.email, normalizeEmail(email)))
        .limit(1)
    )[0];
    if (row === undefined || !(await verifyPassword(password, row.passwordHash))) {
      return c.json({ error: "invalid_credentials" }, 401);
    }
    const counter = await verifyTotpCode(row.totpSecret, totpCode, Date.now());
    if (counter === null || counter <= row.totpLastCounter) {
      return c.json({ error: "invalid_credentials" }, 401); // 不一致もリプレイも同じ応答
    }
    await db
      .update(superAdmins)
      .set({ totpLastCounter: counter })
      .where(eq(superAdmins.id, row.id));
    const now = new Date();
    const { token } = await createSuperSession(c.env.DB, row.id, now);
    setCookie(c, SUPER_SESSION_COOKIE, token, SUPER_COOKIE_OPTIONS);
    await writeAudit(c.env.DB, {
      actorId: row.id,
      action: "super.login",
      targetType: "super_admin",
      targetId: row.id,
    });
    return c.json({ adminId: row.id });
  })
  .post("/logout", async (c) => {
    const token = getCookie(c, SUPER_SESSION_COOKIE);
    if (token !== undefined) {
      await revokeSuperSession(c.env.DB, token, new Date());
    }
    deleteCookie(c, SUPER_SESSION_COOKIE, { path: "/", secure: true });
    return c.json({ ok: true });
  })
  .get("/me", superGate, async (c) => {
    const { adminId } = c.get("superAdmin");
    const row = (
      await drizzle(c.env.DB)
        .select({ email: superAdmins.email })
        .from(superAdmins)
        .where(eq(superAdmins.id, adminId))
        .limit(1)
    )[0];
    return c.json({ adminId, email: row?.email ?? null });
  });
