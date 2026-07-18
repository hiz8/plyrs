import { createMiddleware } from "hono/factory";

export const MIN_JWT_SECRET_LENGTH = 32;

// §6: 短い JWT_SECRET での運用を fail-closed で拒否する。公開 read(/public/v1)は
// JWT 不使用のためこのガードの外(可用性を巻き込まない)。
export const requireSaneSecret = createMiddleware<{ Bindings: Env }>(async (c, next) => {
  const secret = c.env.JWT_SECRET;
  if (typeof secret !== "string" || secret.length < MIN_JWT_SECRET_LENGTH) {
    return c.json({ error: "misconfigured" }, 500);
  }
  await next();
});
