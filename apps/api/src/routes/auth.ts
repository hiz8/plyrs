import { zValidator } from "@hono/zod-validator";
import { and, asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { memberships, tenants, users } from "@plyrs/db/control-plane";
import { isBlocked } from "../auth/blocklist";
import { normalizeEmail } from "../auth/email";
import { signTenantToken, TOKEN_TTL } from "../auth/jwt";
import { hashPassword, verifyPassword } from "../auth/password";
import { isRole } from "../auth/permissions";
import { checkAuthRateLimit } from "../auth/rate-limit";
import { createSession, lookupSession, revokeSession, SESSION_COOKIE } from "../auth/session";
import { verifyTurnstile } from "../modules/turnstile";

const credentialsSchema = z.object({
  email: z.email().max(254),
  password: z.string().min(12).max(128),
  turnstileToken: z.string().max(2048).optional(),
});

const SESSION_COOKIE_OPTIONS = {
  path: "/",
  httpOnly: true,
  secure: true,
  sameSite: "Strict",
  maxAge: 30 * 86_400,
} as const;

// §6: 認証系エンドポイント専用の Turnstile。AUTH_TURNSTILE_SECRET_KEY 未設定なら不要
// (optional 設計 — 本番有効化は手順書)。設定時は token 必須、siteverify 失敗は 403。
async function requireAuthTurnstile(
  env: Env,
  token: string | undefined,
  ip: string | undefined,
): Promise<"ok" | "required" | "failed"> {
  const secret = env.AUTH_TURNSTILE_SECRET_KEY;
  if (secret === undefined || secret === "") {
    return "ok"; // 未設定なら不要(optional 設計 — 本番有効化は手順書)
  }
  if (token === undefined) {
    return "required";
  }
  return (await verifyTurnstile(secret, token, ip ?? null)) ? "ok" : "failed";
}

export const authRoutes = new Hono<{ Bindings: Env }>()
  .post("/signup", zValidator("json", credentialsSchema), async (c) => {
    const ip = c.req.header("cf-connecting-ip");
    const decision = await checkAuthRateLimit(c.env, ip);
    if (decision !== "ok") {
      return decision === "limited"
        ? c.json({ error: "rate_limited" }, 429)
        : c.json({ error: "rate_limiter_unavailable" }, 503);
    }
    const turnstile = await requireAuthTurnstile(c.env, c.req.valid("json").turnstileToken, ip);
    if (turnstile !== "ok") {
      return turnstile === "required"
        ? c.json({ error: "turnstile_required" }, 400)
        : c.json({ error: "turnstile_failed" }, 403);
    }
    const email = normalizeEmail(c.req.valid("json").email);
    const { password } = c.req.valid("json");
    const db = drizzle(c.env.DB);
    const existing = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    if (existing.length > 0) {
      return c.json({ error: "email_taken" }, 409);
    }
    const now = new Date();
    const userId = uuidv7();
    await db.insert(users).values({
      id: userId,
      email,
      passwordHash: await hashPassword(password),
      createdAt: now.toISOString(),
    });
    const { token } = await createSession(c.env.DB, userId, now);
    setCookie(c, SESSION_COOKIE, token, SESSION_COOKIE_OPTIONS);
    return c.json({ userId }, 201);
  })
  .post("/login", zValidator("json", credentialsSchema), async (c) => {
    const ip = c.req.header("cf-connecting-ip");
    const decision = await checkAuthRateLimit(c.env, ip);
    if (decision !== "ok") {
      return decision === "limited"
        ? c.json({ error: "rate_limited" }, 429)
        : c.json({ error: "rate_limiter_unavailable" }, 503);
    }
    const turnstile = await requireAuthTurnstile(c.env, c.req.valid("json").turnstileToken, ip);
    if (turnstile !== "ok") {
      return turnstile === "required"
        ? c.json({ error: "turnstile_required" }, 400)
        : c.json({ error: "turnstile_failed" }, 403);
    }
    const email = normalizeEmail(c.req.valid("json").email);
    const { password } = c.req.valid("json");
    const row = (
      await drizzle(c.env.DB).select().from(users).where(eq(users.email, email)).limit(1)
    )[0];
    if (row === undefined || !(await verifyPassword(password, row.passwordHash))) {
      return c.json({ error: "invalid_credentials" }, 401);
    }
    const now = new Date();
    const { token } = await createSession(c.env.DB, row.id, now);
    setCookie(c, SESSION_COOKIE, token, SESSION_COOKIE_OPTIONS);
    return c.json({ userId: row.id });
  })
  .post("/logout", async (c) => {
    const token = getCookie(c, SESSION_COOKIE);
    if (token !== undefined) {
      await revokeSession(c.env.DB, token, new Date());
    }
    // __Host- prefix は Secure 必須(setCookie と同じ属性で削除しないとブラウザが cookie を認識しない)
    deleteCookie(c, SESSION_COOKIE, { path: "/", secure: true });
    return c.json({ ok: true });
  })
  // G5: セッション cookie（D1 真実源）を提示して短命 JWT を再発行する
  .post("/token", zValidator("json", z.object({ tenantId: z.uuid() })), async (c) => {
    const token = getCookie(c, SESSION_COOKIE);
    const session = token === undefined ? null : await lookupSession(c.env.DB, token, new Date());
    if (session === null) {
      return c.json({ error: "unauthenticated" }, 401);
    }
    if (await isBlocked(c.env.BLOCKLIST, session.userId)) {
      return c.json({ error: "blocked" }, 403);
    }
    const { tenantId } = c.req.valid("json");
    const membership = (
      await drizzle(c.env.DB)
        .select({ role: memberships.role })
        .from(memberships)
        .where(and(eq(memberships.userId, session.userId), eq(memberships.tenantId, tenantId)))
        .limit(1)
    )[0];
    if (membership === undefined || !isRole(membership.role)) {
      return c.json({ error: "not_a_member" }, 403);
    }
    const jwt = await signTenantToken(c.env.JWT_SECRET, {
      userId: session.userId,
      tenantId,
      role: membership.role,
    });
    return c.json({ token: jwt, expiresIn: TOKEN_TTL });
  })
  // Phase 6a: 管理画面のテナント選択（slug→tenantId の解決元）。セッション cookie で認証し、
  // membership を tenants に join して返す。/auth/token と同じく blocked ユーザーは 403。
  .get("/tenants", async (c) => {
    const token = getCookie(c, SESSION_COOKIE);
    const session = token === undefined ? null : await lookupSession(c.env.DB, token, new Date());
    if (session === null) {
      return c.json({ error: "unauthenticated" }, 401);
    }
    if (await isBlocked(c.env.BLOCKLIST, session.userId)) {
      return c.json({ error: "blocked" }, 403);
    }
    const rows = await drizzle(c.env.DB)
      .select({ id: tenants.id, slug: tenants.slug, name: tenants.name, role: memberships.role })
      .from(memberships)
      .innerJoin(tenants, eq(memberships.tenantId, tenants.id))
      .where(eq(memberships.userId, session.userId))
      .orderBy(asc(tenants.slug));
    return c.json({ tenants: rows });
  })
  // §6: フロントエンドが signup/login フォームに Turnstile ウィジェットを出すかどうかの判定材料。
  // secret key と違い site key は公開情報(未設定なら Turnstile 無効の合図として null)。
  .get("/turnstile-config", (c) => c.json({ siteKey: c.env.AUTH_TURNSTILE_SITE_KEY ?? null }));
