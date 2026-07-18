import { zValidator } from "@hono/zod-validator";
import { asc, count, desc, eq, like } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import {
  auditLogs,
  deadLetters,
  memberships,
  tenantModules,
  tenants,
  users,
} from "@plyrs/db/control-plane";
import { assetKeyBelongsToTenant } from "../assets/ownership";
import { writeAudit } from "../audit";
import { banUserEverywhere, revokeMembership } from "../auth/ban";
import { unblockUser } from "../auth/blocklist";
import { normalizeEmail } from "../auth/email";
import { superAuthContext } from "../auth/super-context";
import type { ModuleQueueJob } from "../modules/events";
import { MODULE_REGISTRY } from "../modules/registry";
import { deleteTenantCascade } from "../ops/tenant-delete";
import { superGate, type SuperGateVariables } from "../middleware/super-gate";
import type { ProjectionJob } from "../projection/jobs";
import { asHealthReport, asReprojectResult, asStringArray } from "../rpc-unwrap";
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
    // カスケード開始前に "start" を記録する(best-effort にしない): 途中で throw しても
    // 破壊が始まった事実は監査に残る。成功後に "complete" を追記する。
    await writeAudit(c.env.DB, {
      actorId: c.get("superAdmin").adminId,
      action: "tenant.delete",
      targetType: "tenant",
      targetId: tenantId,
      detail: { slug: row.slug, phase: "start" },
    });
    await deleteTenantCascade(c.env, row);
    await writeAudit(c.env.DB, {
      actorId: c.get("superAdmin").adminId,
      action: "tenant.delete",
      targetType: "tenant",
      targetId: tenantId,
      detail: { slug: row.slug, phase: "complete" },
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
  })
  // design-spec §7 の確定事項(archived かつ公開中)/ §14(レガシー user 型 asset・旧形式 richtext)
  // の点検。DO 内 SQLite のフルスキャンなので管理オンデマンド呼び出し前提(tenant-do.ts 参照)。
  .get("/tenants/:tenantId/health", async (c) => {
    const tenantId = c.req.param("tenantId");
    const stub = c.env.TENANT_DO.get(c.env.TENANT_DO.idFromName(tenantId));
    return c.json(asHealthReport(await stub.healthCheck()));
  })
  .get("/tenants/:tenantId/orphan-assets", async (c) => {
    const tenantId = c.req.param("tenantId");
    const stub = c.env.TENANT_DO.get(c.env.TENANT_DO.idFromName(tenantId));
    const referenced = new Set(asStringArray(await stub.listAssetR2Keys()));
    const orphans: { key: string; size: number }[] = [];
    let cursor: string | undefined;
    do {
      const listing = await c.env.ASSETS.list({ prefix: `${tenantId}/`, cursor });
      for (const object of listing.objects) {
        if (!referenced.has(object.key)) {
          orphans.push({ key: object.key, size: object.size });
        }
      }
      cursor = listing.truncated ? listing.cursor : undefined;
    } while (cursor !== undefined);
    return c.json({ orphans });
  })
  .delete(
    "/tenants/:tenantId/orphan-assets",
    zValidator("json", z.object({ keys: z.array(z.string().min(1)).min(1).max(100) })),
    async (c) => {
      const tenantId = c.req.param("tenantId");
      const { keys } = c.req.valid("json");
      // §14 の教訓: asset 系の新経路には必ず帰属ガードを併設する
      if (!keys.every((key) => assetKeyBelongsToTenant(key, tenantId))) {
        return c.json({ error: "foreign_key" }, 400);
      }
      const stub = c.env.TENANT_DO.get(c.env.TENANT_DO.idFromName(tenantId));
      const referenced = new Set(asStringArray(await stub.listAssetR2Keys()));
      if (keys.some((key) => referenced.has(key))) {
        return c.json({ error: "still_referenced" }, 400); // 削除直前の再照会(レース対策)
      }
      await c.env.ASSETS.delete(keys);
      await writeAudit(c.env.DB, {
        actorId: c.get("superAdmin").adminId,
        action: "orphan_assets.delete",
        targetType: "tenant",
        targetId: tenantId,
        detail: { keys },
      });
      return c.json({ ok: true, deleted: keys.length });
    },
  )
  // §12.3b: テナント単位の再投影を super が起動する。第2段認可(型×操作)は owner 相当の
  // 合成 AuthContext(superAuthContext)で飛び越える(design-spec §11.6)。
  .post("/tenants/:tenantId/reproject", async (c) => {
    const tenantId = c.req.param("tenantId");
    const stub = c.env.TENANT_DO.get(c.env.TENANT_DO.idFromName(tenantId));
    const result = asReprojectResult(
      await stub.startReprojection(
        tenantId,
        superAuthContext(c.get("superAdmin").adminId, tenantId),
      ),
    );
    if (!result.ok) {
      return c.json(result, 403);
    }
    await writeAudit(c.env.DB, {
      actorId: c.get("superAdmin").adminId,
      action: "reproject.start",
      targetType: "tenant",
      targetId: tenantId,
      detail: { epoch: result.epoch },
    });
    return c.json(result);
  })
  // モジュールカタログ(コード内静的レジストリ)+ 有効化テナント数(D1 ミラー集計)。
  .get("/modules", async (c) => {
    const counts = await drizzle(c.env.DB)
      .select({ moduleId: tenantModules.moduleId, enabledTenants: count() })
      .from(tenantModules)
      .where(eq(tenantModules.enabled, 1))
      .groupBy(tenantModules.moduleId);
    const byId = new Map(counts.map((row) => [row.moduleId, row.enabledTenants]));
    const modules = Object.values(MODULE_REGISTRY).map((definition) => ({
      moduleId: definition.manifest.moduleId,
      version: definition.manifest.version,
      name: definition.manifest.name,
      enabledTenants: byId.get(definition.manifest.moduleId) ?? 0,
    }));
    return c.json({ modules });
  })
  // §15-1: 型定義再配布のトリガー(機構は Phase 9 で完成済み — ここが「誰がいつ積むか」)
  .post("/modules/:moduleId/redistribute", async (c) => {
    const moduleId = c.req.param("moduleId");
    if (!(moduleId in MODULE_REGISTRY)) {
      return c.json({ error: "unknown_module" }, 404);
    }
    await c.env.MODULES_QUEUE.send({ kind: "module_redistribute", moduleId });
    await writeAudit(c.env.DB, {
      actorId: c.get("superAdmin").adminId,
      action: "module.redistribute",
      targetType: "module",
      targetId: moduleId,
    });
    return c.json({ ok: true }, 202);
  })
  // Phase 10: DLQ は D1 退避(dead_letters)。一覧は failed_at 降順・最大 200 件。
  .get("/dead-letters", async (c) => {
    const rows = await drizzle(c.env.DB)
      .select()
      .from(deadLetters)
      .orderBy(desc(deadLetters.failedAt))
      .limit(200);
    return c.json({ deadLetters: rows });
  })
  .post("/dead-letters/:id/replay", async (c) => {
    const id = c.req.param("id");
    const row = (
      await drizzle(c.env.DB).select().from(deadLetters).where(eq(deadLetters.id, id)).limit(1)
    )[0];
    if (row === undefined) {
      return c.json({ error: "not_found" }, 404);
    }
    // producer binding は環境ローカル(env 分割後もこの判定は名前の前方一致で安定)
    const producer: Queue<ProjectionJob | ModuleQueueJob> = row.queue.startsWith("plyrs-modules")
      ? c.env.MODULES_QUEUE
      : c.env.PROJECTION_QUEUE;
    // row.body は parkDeadLetter が自前で serialize した値なので信頼できる境界(cast)
    await producer.send(JSON.parse(row.body) as ProjectionJob | ModuleQueueJob);
    await drizzle(c.env.DB)
      .update(deadLetters)
      .set({ replayedAt: new Date().toISOString() })
      .where(eq(deadLetters.id, id));
    await writeAudit(c.env.DB, {
      actorId: c.get("superAdmin").adminId,
      action: "dlq.replay",
      targetType: "dead_letter",
      targetId: id,
      detail: { queue: row.queue },
    });
    return c.json({ ok: true });
  })
  .delete("/dead-letters/:id", async (c) => {
    const id = c.req.param("id");
    const result = await drizzle(c.env.DB).delete(deadLetters).where(eq(deadLetters.id, id));
    if (result.meta.changes === 0) {
      return c.json({ error: "not_found" }, 404);
    }
    await writeAudit(c.env.DB, {
      actorId: c.get("superAdmin").adminId,
      action: "dlq.discard",
      targetType: "dead_letter",
      targetId: id,
    });
    return c.json({ ok: true });
  })
  // §11.6: 監査ログの一覧。append-only なので参照専用(削除 API は無い)。直近 200 件。
  .get("/audit-logs", async (c) => {
    const rows = await drizzle(c.env.DB)
      .select()
      .from(auditLogs)
      .orderBy(desc(auditLogs.createdAt))
      .limit(200);
    return c.json({ auditLogs: rows });
  });
