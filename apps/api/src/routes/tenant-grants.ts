import { Hono } from "hono";
import { writeAudit } from "../audit";
import type { GateVariables } from "../middleware/tenant-gate";
import { listTenantGrants, revokeTenantGrant } from "../oauth/grants";
import { requireCurrent } from "./tenant-settings";

// design-spec 16.3(M3-5): OAuth の付与(接続中のアプリ)の一覧・失効。tenant-tokens.ts(PAT)と同じく
// 所有者(member:manage)だけで、D1 の現在のロールで確かめ直す。付与の実体は OAUTH_KV にあり DO は起こさない。

type GateEnv = { Bindings: Env; Variables: GateVariables };

export const tenantGrantsRoutes = new Hono<GateEnv>()
  .get("/:tenantId/oauth-grants", async (c) => {
    const denied = await requireCurrent(c, "member:manage");
    if (denied !== null) {
      return denied;
    }
    return c.json({ grants: await listTenantGrants(c.env, c.req.param("tenantId")) });
  })
  .delete("/:tenantId/oauth-grants/:userId/:grantId", async (c) => {
    const denied = await requireCurrent(c, "member:manage");
    if (denied !== null) {
      return denied;
    }
    const tenantId = c.req.param("tenantId");
    const userId = c.req.param("userId");
    const grantId = c.req.param("grantId");
    if (!(await revokeTenantGrant(c.env, tenantId, userId, grantId))) {
      return c.json({ error: "not_found" }, 404);
    }
    await writeAudit(c.env.DB, {
      actorId: c.get("auth").userId,
      action: "oauth.revoke",
      targetType: "oauth_grant",
      targetId: grantId,
      detail: { tenantId, userId },
    });
    return c.json({ ok: true });
  });
