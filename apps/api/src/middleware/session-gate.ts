import { getCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import { isBlocked } from "../auth/blocklist";
import { lookupSessionUser, revokeSession, SESSION_COOKIE } from "../auth/session";

export type SessionGateVariables = { session: { userId: string; email: string } };

// §11.2: 利用者のセッション cookie を要るルート(/auth/token・/auth/tenants・/auth/me)の共通前置き。
// superGate と同型で、cookie → D1 照会 → blocklist の順と 401/403 の応答形をここ 1 か所に固定する。
export const sessionGate = createMiddleware<{
  Bindings: Env;
  Variables: SessionGateVariables;
}>(async (c, next) => {
  const token = getCookie(c, SESSION_COOKIE);
  const now = new Date();
  const session = token === undefined ? null : await lookupSessionUser(c.env.DB, token, now);
  if (token === undefined || session === null) {
    return c.json({ error: "unauthenticated" }, 401);
  }
  if (session.email === null) {
    // users 行が無いのにセッションだけ残っている異常状態。ログに残し、セッションを失効させて
    // 以後の照会を止める(ログインし直しても invalid_credentials になるだけで原因が追えないため)
    console.error(`session without user row: userId=${session.userId}`);
    await revokeSession(c.env.DB, token, now);
    return c.json({ error: "unauthenticated" }, 401);
  }
  if (await isBlocked(c.env.BLOCKLIST, session.userId)) {
    return c.json({ error: "blocked" }, 403);
  }
  c.set("session", { userId: session.userId, email: session.email });
  await next();
});
