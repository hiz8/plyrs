import { getCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import { lookupSuperSession, SUPER_SESSION_COOKIE } from "../auth/super-session";

export type SuperGateVariables = { superAdmin: { adminId: string } };

// §11.6: super ルートは JWT を使わず、毎リクエスト super セッション cookie を D1 照会する
// (低頻度の管理操作で D1 1 回は許容。JWT 面を増やさない — 計画の設計確定事項)。
export const superGate = createMiddleware<{ Bindings: Env; Variables: SuperGateVariables }>(
  async (c, next) => {
    const token = getCookie(c, SUPER_SESSION_COOKIE);
    const session =
      token === undefined ? null : await lookupSuperSession(c.env.DB, token, new Date());
    if (session === null) {
      return c.json({ error: "unauthenticated" }, 401);
    }
    c.set("superAdmin", { adminId: session.adminId });
    await next();
  },
);
