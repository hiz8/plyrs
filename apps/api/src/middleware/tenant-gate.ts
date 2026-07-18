import { createMiddleware } from "hono/factory";
import { isBlocked, isMembershipBlocked } from "../auth/blocklist";
import { verifyTenantToken } from "../auth/jwt";
import type { AuthContext } from "../do/authorize";
import type { SocketAuth } from "../sync/session";

export type GateVariables = { auth: AuthContext & { tenantId: string } };

export interface GateFailure {
  code: "unauthenticated" | "wrong_tenant" | "blocked";
  status: 401 | 403;
}

// design-spec §11.5 第1段: JWT 署名検証 + tenant 照合 + ブロックリスト照会のみ
// （D1 を引かない）。通らなければ DO を起こさない。HTTP ミドルウェアと WS upgrade の
// 両方がこのコアを使う（トークンの搬送手段だけが違う）。
export async function authenticateTenantToken(
  env: Env,
  tenantId: string,
  token: string,
): Promise<{ ok: true; auth: SocketAuth } | { ok: false; failure: GateFailure }> {
  const claims = await verifyTenantToken(env.JWT_SECRET, token);
  if (claims === null) {
    return { ok: false, failure: { code: "unauthenticated", status: 401 } };
  }
  if (claims.tenantId !== tenantId) {
    return { ok: false, failure: { code: "wrong_tenant", status: 403 } };
  }
  if (await isBlocked(env.BLOCKLIST, claims.userId)) {
    return { ok: false, failure: { code: "blocked", status: 403 } };
  }
  if (await isMembershipBlocked(env.BLOCKLIST, claims.userId, tenantId)) {
    return { ok: false, failure: { code: "blocked", status: 403 } };
  }
  return {
    ok: true,
    auth: {
      userId: claims.userId,
      role: claims.role,
      tenantId: claims.tenantId,
      exp: claims.exp,
    },
  };
}

export const tenantGate = createMiddleware<
  { Bindings: Env; Variables: GateVariables },
  "/:tenantId/*"
>(async (c, next) => {
  const header = c.req.header("authorization") ?? "";
  if (!header.startsWith("Bearer ")) {
    return c.json({ error: "unauthenticated" }, 401);
  }
  const result = await authenticateTenantToken(
    c.env,
    c.req.param("tenantId"),
    header.slice("Bearer ".length),
  );
  if (!result.ok) {
    return c.json({ error: result.failure.code }, result.failure.status);
  }
  c.set("auth", {
    userId: result.auth.userId,
    role: result.auth.role,
    tenantId: result.auth.tenantId,
  });
  await next();
});
