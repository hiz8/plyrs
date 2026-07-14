import { zValidator } from "@hono/zod-validator";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { memberships, tenants } from "@plyrs/db/control-plane";
import { lookupSession, SESSION_COOKIE } from "../auth/session";

// Finding 2（important）: 公開 read API（routes/public.ts）が tenantSlug を KV/コントロールプレーン
// D1 へ渡す前に同じ規則で早期検証できるよう、slug の形と長さの上限を共有定数として公開する。
export const TENANT_SLUG_PATTERN = /^[a-z][a-z0-9-]*$/;
export const TENANT_SLUG_MAX_LENGTH = 63;

const createTenantSchema = z.object({
  name: z.string().min(1).max(100),
  slug: z.string().regex(TENANT_SLUG_PATTERN).max(TENANT_SLUG_MAX_LENGTH),
});

// 注: テナント作成の特権ゲート（design-spec §11.6）は Phase 10 の管轄。
// 現段階ではログイン済みユーザーなら誰でも作成でき、作成者が owner になる。
export const tenantAdminRoutes = new Hono<{ Bindings: Env }>().post(
  "/",
  zValidator("json", createTenantSchema),
  async (c) => {
    const token = getCookie(c, SESSION_COOKIE);
    const session = token === undefined ? null : await lookupSession(c.env.DB, token, new Date());
    if (session === null) {
      return c.json({ error: "unauthenticated" }, 401);
    }
    const { name, slug } = c.req.valid("json");
    const db = drizzle(c.env.DB);
    const dup = await db
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.slug, slug))
      .limit(1);
    if (dup.length > 0) {
      return c.json({ error: "slug_taken" }, 409);
    }
    const now = new Date().toISOString();
    const tenantId = uuidv7();
    await db.batch([
      db.insert(tenants).values({ id: tenantId, slug, name, createdAt: now }),
      db
        .insert(memberships)
        .values({ userId: session.userId, tenantId, role: "owner", createdAt: now }),
    ]);
    return c.json({ tenantId }, 201);
  },
);
