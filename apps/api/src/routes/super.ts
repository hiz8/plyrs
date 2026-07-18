import { zValidator } from "@hono/zod-validator";
import { asc, count, eq, like } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { memberships, tenants, users } from "@plyrs/db/control-plane";
import { writeAudit } from "../audit";
import { banUserEverywhere, revokeMembership } from "../auth/ban";
import { unblockUser } from "../auth/blocklist";
import { normalizeEmail } from "../auth/email";
import { deleteTenantCascade } from "../ops/tenant-delete";
import { superGate, type SuperGateVariables } from "../middleware/super-gate";
import { TENANT_SLUG_MAX_LENGTH, TENANT_SLUG_PATTERN } from "./tenants";

const createTenantSchema = z.object({
  name: z.string().min(1).max(100),
  slug: z.string().regex(TENANT_SLUG_PATTERN).max(TENANT_SLUG_MAX_LENGTH),
  ownerEmail: z.email().max(254).optional(),
});

export const superRoutes = new Hono<{ Bindings: Env; Variables: SuperGateVariables }>()
  .use("*", superGate)
  .get("/tenants", async (c) => {
    const db = drizzle(c.env.DB);
    const rows = await db
      .select({
        id: tenants.id,
        slug: tenants.slug,
        name: tenants.name,
        createdAt: tenants.createdAt,
        memberCount: count(memberships.userId),
      })
      .from(tenants)
      .leftJoin(memberships, eq(memberships.tenantId, tenants.id))
      .groupBy(tenants.id)
      .orderBy(asc(tenants.slug));
    return c.json({ tenants: rows });
  })
  // 裁定 9: テナント作成は super 専用。ownerEmail 指定時は既存ユーザーを owner に任命する。
  .post("/tenants", zValidator("json", createTenantSchema), async (c) => {
    const { name, slug, ownerEmail } = c.req.valid("json");
    const db = drizzle(c.env.DB);
    const dup = await db
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.slug, slug))
      .limit(1);
    if (dup.length > 0) {
      return c.json({ error: "slug_taken" }, 409);
    }
    let ownerId: string | null = null;
    if (ownerEmail !== undefined) {
      const owner = (
        await db
          .select({ id: users.id })
          .from(users)
          .where(eq(users.email, normalizeEmail(ownerEmail)))
          .limit(1)
      )[0];
      if (owner === undefined) {
        return c.json({ error: "unknown_owner" }, 404);
      }
      ownerId = owner.id;
    }
    const now = new Date().toISOString();
    const tenantId = uuidv7();
    // db.batch の型引数は可変長配列だと煩雑になる(要素数が ownerId の有無で変わる)ため、
    // 作成は低頻度・一意索引(idx_tenants_slug)が原子性を守ることから逐次 await に分解する
    // (ブリーフ注記どおり)。
    await db.insert(tenants).values({ id: tenantId, slug, name, createdAt: now });
    if (ownerId !== null) {
      await db
        .insert(memberships)
        .values({ userId: ownerId, tenantId, role: "owner", createdAt: now });
    }
    await writeAudit(c.env.DB, {
      actorId: c.get("superAdmin").adminId,
      action: "tenant.create",
      targetType: "tenant",
      targetId: tenantId,
      detail: { slug, name, ownerId },
    });
    return c.json({ tenantId }, 201);
  })
  // slug は不変(§14-3 の凍結 embed URL 問題があるため rename は name のみ)。
  .patch(
    "/tenants/:tenantId",
    zValidator("json", z.object({ name: z.string().min(1).max(100) })),
    async (c) => {
      const tenantId = c.req.param("tenantId");
      const { name } = c.req.valid("json");
      const db = drizzle(c.env.DB);
      const row = (
        await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.id, tenantId)).limit(1)
      )[0];
      if (row === undefined) {
        return c.json({ error: "not_found" }, 404);
      }
      await db.update(tenants).set({ name }).where(eq(tenants.id, tenantId));
      await writeAudit(c.env.DB, {
        actorId: c.get("superAdmin").adminId,
        action: "tenant.rename",
        targetType: "tenant",
        targetId: tenantId,
        detail: { name },
      });
      return c.json({ ok: true });
    },
  )
  .delete("/tenants/:tenantId", async (c) => {
    const tenantId = c.req.param("tenantId");
    const db = drizzle(c.env.DB);
    const row = (
      await db
        .select({ id: tenants.id, slug: tenants.slug })
        .from(tenants)
        .where(eq(tenants.id, tenantId))
        .limit(1)
    )[0];
    if (row === undefined) {
      return c.json({ error: "not_found" }, 404);
    }
    await deleteTenantCascade(c.env, row);
    await writeAudit(c.env.DB, {
      actorId: c.get("superAdmin").adminId,
      action: "tenant.delete",
      targetType: "tenant",
      targetId: tenantId,
      detail: { slug: row.slug },
    });
    return c.json({ ok: true });
  })
  .get("/users", async (c) => {
    const q = c.req.query("q") ?? "";
    const db = drizzle(c.env.DB);
    const rows = await db
      .select({
        id: users.id,
        email: users.email,
        createdAt: users.createdAt,
        membershipCount: count(memberships.tenantId),
      })
      .from(users)
      .leftJoin(memberships, eq(memberships.userId, users.id))
      .where(q === "" ? undefined : like(users.email, `%${q}%`))
      .groupBy(users.id)
      .orderBy(asc(users.email))
      .limit(100);
    return c.json({ users: rows });
  })
  .post("/users/:userId/ban", async (c) => {
    const userId = c.req.param("userId");
    const { disconnected } = await banUserEverywhere(c.env, userId);
    await writeAudit(c.env.DB, {
      actorId: c.get("superAdmin").adminId,
      action: "user.ban",
      targetType: "user",
      targetId: userId,
      detail: { disconnected },
    });
    return c.json({ ok: true, disconnected });
  })
  .post("/users/:userId/unban", async (c) => {
    const userId = c.req.param("userId");
    await unblockUser(c.env.BLOCKLIST, userId);
    await writeAudit(c.env.DB, {
      actorId: c.get("superAdmin").adminId,
      action: "user.unban",
      targetType: "user",
      targetId: userId,
    });
    return c.json({ ok: true });
  })
  .get("/tenants/:tenantId/members", async (c) => {
    const rows = await drizzle(c.env.DB)
      .select({
        userId: memberships.userId,
        email: users.email,
        role: memberships.role,
        createdAt: memberships.createdAt,
      })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(eq(memberships.tenantId, c.req.param("tenantId")))
      .orderBy(asc(users.email));
    return c.json({ members: rows });
  })
  .delete("/tenants/:tenantId/members/:userId", async (c) => {
    const tenantId = c.req.param("tenantId");
    const userId = c.req.param("userId");
    const { disconnected } = await revokeMembership(c.env, userId, tenantId);
    await writeAudit(c.env.DB, {
      actorId: c.get("superAdmin").adminId,
      action: "membership.revoke",
      targetType: "membership",
      targetId: `${userId}:${tenantId}`,
      detail: { disconnected },
    });
    return c.json({ ok: true, disconnected });
  });
