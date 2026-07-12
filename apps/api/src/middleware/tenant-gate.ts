import { createMiddleware } from "hono/factory";
import { isBlocked } from "../auth/blocklist";
import { verifyTenantToken } from "../auth/jwt";
import type { AuthContext } from "../do/authorize";

export type GateVariables = { auth: AuthContext & { tenantId: string } };

// design-spec §11.5 第1段: JWT 署名検証 + tenant 照合のみで DO への到達を判定する
// （D1 を引かない）。§11.2 のブロックリスト照会（KV）もここ。通らなければ DO を起こさない。
export const tenantGate = createMiddleware<{ Bindings: Env; Variables: GateVariables }>(
  async (c, next) => {
    const header = c.req.header("authorization") ?? "";
    if (!header.startsWith("Bearer ")) {
      return c.json({ error: "unauthenticated" }, 401);
    }
    const claims = await verifyTenantToken(c.env.JWT_SECRET, header.slice("Bearer ".length));
    if (claims === null) {
      return c.json({ error: "unauthenticated" }, 401);
    }
    if (claims.tenantId !== c.req.param("tenantId")) {
      return c.json({ error: "wrong_tenant" }, 403);
    }
    if (await isBlocked(c.env.BLOCKLIST, claims.userId)) {
      return c.json({ error: "blocked" }, 403);
    }
    c.set("auth", { userId: claims.userId, role: claims.role, tenantId: claims.tenantId });
    await next();
  },
);
