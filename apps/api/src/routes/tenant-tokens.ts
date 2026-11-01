import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { writeAudit } from "../audit";
import {
  defaultExpiryDays,
  issuePat,
  listPats,
  maxExpiryDays,
  PAT_NAME_MAX_LENGTH,
  PAT_SCOPES,
  READ_ONLY_MAX_DAYS,
  revokePat,
} from "../auth/pat";
import type { GateVariables } from "../middleware/tenant-gate";
import { requireCurrent } from "./tenant-settings";

// design-spec 16.3(M1-3a): PAT の発行・一覧・失効。発行できるのは所有者だけ(16.12 の限定公開の条件)で、
// tenant-settings.ts と同じく D1 の現在のロールで確かめ直す。発行対象は自分自身(他人の PAT は作れない)。
// 一覧と失効は所有者がテナント全員分を扱える。コントロールプレーン D1 だけを扱うため DO は起こさない。

type GateEnv = { Bindings: Env; Variables: GateVariables };

const issueSchema = z.object({
  name: z.string().trim().min(1).max(PAT_NAME_MAX_LENGTH),
  scopes: z
    .array(z.enum(PAT_SCOPES))
    .min(1)
    .refine((scopes) => new Set(scopes).size === scopes.length, { message: "duplicate scope" }),
  expiresInDays: z.number().int().min(1).max(READ_ONLY_MAX_DAYS).optional(),
});

export const tenantTokensRoutes = new Hono<GateEnv>()
  .get("/:tenantId/tokens", async (c) => {
    const denied = await requireCurrent(c, "member:manage");
    if (denied !== null) {
      return denied;
    }
    return c.json({ tokens: await listPats(c.env.DB, c.req.param("tenantId")) });
  })
  .post("/:tenantId/tokens", zValidator("json", issueSchema), async (c) => {
    const denied = await requireCurrent(c, "member:manage");
    if (denied !== null) {
      return denied;
    }
    const { name, scopes } = c.req.valid("json");
    const expiresInDays = c.req.valid("json").expiresInDays ?? defaultExpiryDays(scopes);
    // 書き込みスコープを含むトークンは期限を短くする(16.3)
    if (expiresInDays > maxExpiryDays(scopes)) {
      return c.json({ error: "expiry_too_long", maxDays: maxExpiryDays(scopes) }, 400);
    }
    const tenantId = c.req.param("tenantId");
    const userId = c.get("auth").userId;
    const now = new Date();
    const issued = await issuePat(c.env.DB, { userId, tenantId, name, scopes, expiresInDays }, now);
    await writeAudit(c.env.DB, {
      actorId: userId,
      action: "token.issue",
      targetType: "pat",
      targetId: issued.id,
      detail: { tenantId, name, scopes, expiresAt: issued.expiresAt },
    });
    // token はこの応答にしか現れない
    return c.json(issued, 201);
  })
  .delete("/:tenantId/tokens/:id", async (c) => {
    const denied = await requireCurrent(c, "member:manage");
    if (denied !== null) {
      return denied;
    }
    const tenantId = c.req.param("tenantId");
    const tokenId = c.req.param("id");
    const revoked = await revokePat(c.env.DB, tenantId, tokenId, new Date());
    if (!revoked) {
      return c.json({ error: "not_found" }, 404);
    }
    await writeAudit(c.env.DB, {
      actorId: c.get("auth").userId,
      action: "token.revoke",
      targetType: "pat",
      targetId: tokenId,
      detail: { tenantId },
    });
    return c.json({ ok: true });
  });
