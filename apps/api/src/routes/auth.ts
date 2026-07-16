import { zValidator } from "@hono/zod-validator";
import { and, asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { memberships, tenants, users } from "@plyrs/db/control-plane";
import { isBlocked } from "../auth/blocklist";
import { signTenantToken, TOKEN_TTL } from "../auth/jwt";
import { hashPassword, verifyPassword } from "../auth/password";
import { isRole } from "../auth/permissions";
import { createSession, lookupSession, revokeSession, SESSION_COOKIE } from "../auth/session";

const credentialsSchema = z.object({
  email: z.email().max(254),
  password: z.string().min(12).max(128),
});

const SESSION_COOKIE_OPTIONS = {
  path: "/",
  httpOnly: true,
  secure: true,
  sameSite: "Strict",
  maxAge: 30 * 86_400,
} as const;

export const authRoutes = new Hono<{ Bindings: Env }>()
  .post("/signup", zValidator("json", credentialsSchema), async (c) => {
    const { email, password } = c.req.valid("json");
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
    const { email, password } = c.req.valid("json");
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
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
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
  });
