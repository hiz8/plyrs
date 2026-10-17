import { zValidator } from "@hono/zod-validator";
import { and, asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono, type Context } from "hono";
import { z } from "zod";
import { memberships, tenants, users } from "@plyrs/db/control-plane";
import { writeAudit } from "../audit";
import { cutOffMembership } from "../auth/ban";
import { unblockMembership } from "../auth/blocklist";
import { normalizeEmail } from "../auth/email";
import { can, isRole, ROLES, type Operation } from "../auth/permissions";
import type { GateVariables } from "../middleware/tenant-gate";

// 案 G 3・4 章: テナントの owner がサイト名とメンバーを自分で管理する API。
// 運営者用(/super/v1/tenants/:tenantId/...)とは分け、tenantGate(design-spec §11.5 第 1 段)の
// 配下に置く。コントロールプレーン D1 だけを扱うため DO は起こさない(剥奪時の切断を除く)。

type GateEnv = { Bindings: Env; Variables: GateVariables };

const SITE_NAME_MAX_LENGTH = 100; // 運営者の rename と同じ上限

const roleSchema = z.enum(ROLES);

// JWT の role は最大 15 分古い。ロールを下げられた直後の owner が操作し続けられないよう、
// JWT で弾けるものは D1 を引かずに弾き、通ったものは D1 の現在のロールで確かめ直す。
async function requireCurrent(c: Context<GateEnv>, operation: Operation): Promise<Response | null> {
  const auth = c.get("auth");
  if (!can(auth.role, operation)) {
    return c.json({ error: "forbidden" }, 403);
  }
  const row = (
    await drizzle(c.env.DB)
      .select({ role: memberships.role })
      .from(memberships)
      .where(and(eq(memberships.userId, auth.userId), eq(memberships.tenantId, auth.tenantId)))
      .limit(1)
  )[0];
  if (row === undefined || !isRole(row.role) || !can(row.role, operation)) {
    return c.json({ error: "forbidden" }, 403);
  }
  return null;
}

function membershipTarget(userId: string, tenantId: string): string {
  return `${userId}:${tenantId}`;
}

async function findMember(
  d1: D1Database,
  tenantId: string,
  userId: string,
): Promise<{ userId: string; email: string; role: string; createdAt: string } | undefined> {
  return (
    await drizzle(d1)
      .select({
        userId: memberships.userId,
        email: users.email,
        role: memberships.role,
        createdAt: memberships.createdAt,
      })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, userId)))
      .limit(1)
  )[0];
}

// 案 G 4.5: 最後の owner を外す・下げることはできない。件数の確認と更新を 1 文にまとめ、
// 2 人の owner が同時に互いを下げる競合でも owner が 0 人にならないようにする。
const KEEPS_AN_OWNER =
  "(role != 'owner' OR (SELECT COUNT(*) FROM memberships WHERE tenant_id = ?1 AND role = 'owner') > 1)";

export const tenantSettingsRoutes = new Hono<GateEnv>()
  .patch(
    "/:tenantId/site",
    zValidator("json", z.object({ name: z.string().trim().min(1).max(SITE_NAME_MAX_LENGTH) })),
    async (c) => {
      const denied = await requireCurrent(c, "site:manage");
      if (denied !== null) {
        return denied;
      }
      const tenantId = c.req.param("tenantId");
      const { name } = c.req.valid("json");
      // slug は不変(§14-3)。変えるのは名前だけ
      await drizzle(c.env.DB).update(tenants).set({ name }).where(eq(tenants.id, tenantId));
      await writeAudit(c.env.DB, {
        actorId: c.get("auth").userId,
        action: "site.rename",
        targetType: "tenant",
        targetId: tenantId,
        detail: { name },
      });
      return c.json({ ok: true, name });
    },
  )
  .get("/:tenantId/members", async (c) => {
    const denied = await requireCurrent(c, "member:manage");
    if (denied !== null) {
      return denied;
    }
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
      .orderBy(asc(memberships.createdAt), asc(users.email));
    return c.json({ members: rows });
  })
  // 案 G 4.2: 招待メールは送れないため、登録済みのユーザーだけを追加できる
  .post(
    "/:tenantId/members",
    zValidator("json", z.object({ email: z.email().max(254), role: roleSchema })),
    async (c) => {
      const denied = await requireCurrent(c, "member:manage");
      if (denied !== null) {
        return denied;
      }
      const tenantId = c.req.param("tenantId");
      const { email, role } = c.req.valid("json");
      const db = drizzle(c.env.DB);
      const user = (
        await db
          .select({ id: users.id })
          .from(users)
          .where(eq(users.email, normalizeEmail(email)))
          .limit(1)
      )[0];
      if (user === undefined) {
        return c.json({ error: "user_not_found" }, 404);
      }
      const createdAt = new Date().toISOString();
      const inserted = await c.env.DB.prepare(
        "INSERT INTO memberships (user_id, tenant_id, role, created_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING",
      )
        .bind(user.id, tenantId, role, createdAt)
        .run();
      if (inserted.meta.changes === 0) {
        return c.json({ error: "already_member" }, 409);
      }
      // 直前に外した人を戻す場合、剥奪時のブロック(最大 20 分)が残っているとトークンを
      // 発行できない。追加は owner の明示的な操作なので、ここで解除する
      await unblockMembership(c.env.BLOCKLIST, user.id, tenantId);
      await writeAudit(c.env.DB, {
        actorId: c.get("auth").userId,
        action: "member.add",
        targetType: "membership",
        targetId: membershipTarget(user.id, tenantId),
        detail: { role },
      });
      return c.json({ member: await findMember(c.env.DB, tenantId, user.id) }, 201);
    },
  )
  // 案 G 4.3: 新しいロールはトークンの再発行時(最大 15 分後)に反映される
  .patch(
    "/:tenantId/members/:userId",
    zValidator("json", z.object({ role: roleSchema })),
    async (c) => {
      const denied = await requireCurrent(c, "member:manage");
      if (denied !== null) {
        return denied;
      }
      const tenantId = c.req.param("tenantId");
      const userId = c.req.param("userId");
      const { role } = c.req.valid("json");
      const before = await findMember(c.env.DB, tenantId, userId);
      if (before === undefined) {
        return c.json({ error: "not_found" }, 404);
      }
      const updated = await c.env.DB.prepare(
        `UPDATE memberships SET role = ?3 WHERE tenant_id = ?1 AND user_id = ?2 AND (?3 = 'owner' OR ${KEEPS_AN_OWNER})`,
      )
        .bind(tenantId, userId, role)
        .run();
      if (updated.meta.changes === 0) {
        return c.json({ error: "last_owner" }, 409);
      }
      await writeAudit(c.env.DB, {
        actorId: c.get("auth").userId,
        action: "member.role_change",
        targetType: "membership",
        targetId: membershipTarget(userId, tenantId),
        detail: { from: before.role, to: role },
      });
      return c.json({ member: { ...before, role } });
    },
  )
  // 案 G 4.4: 外したメンバーの発行済みトークンと接続も即時に無効化する(運営者の剥奪と同じ)
  .delete("/:tenantId/members/:userId", async (c) => {
    const denied = await requireCurrent(c, "member:manage");
    if (denied !== null) {
      return denied;
    }
    const tenantId = c.req.param("tenantId");
    const userId = c.req.param("userId");
    const before = await findMember(c.env.DB, tenantId, userId);
    if (before === undefined) {
      return c.json({ error: "not_found" }, 404);
    }
    const deleted = await c.env.DB.prepare(
      `DELETE FROM memberships WHERE tenant_id = ?1 AND user_id = ?2 AND ${KEEPS_AN_OWNER}`,
    )
      .bind(tenantId, userId)
      .run();
    if (deleted.meta.changes === 0) {
      return c.json({ error: "last_owner" }, 409);
    }
    const { disconnected } = await cutOffMembership(c.env, userId, tenantId);
    await writeAudit(c.env.DB, {
      actorId: c.get("auth").userId,
      action: "member.remove",
      targetType: "membership",
      targetId: membershipTarget(userId, tenantId),
      detail: { role: before.role, disconnected },
    });
    return c.json({ ok: true, disconnected });
  });
