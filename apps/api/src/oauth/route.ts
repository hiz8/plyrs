import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import { tenants } from "@plyrs/db/control-plane";
import { workerContext } from "../mcp/route";
import { handleAuthorizeGet, handleAuthorizePost } from "./consent";
import { createTenantAuthServer } from "./server";

// design-spec 16.2(決定 47、M3-1): 認可サーバーの入口。admin オリジンの `/oauth/t/:tenantId/...` と
// `/.well-known/oauth-authorization-server/oauth/t/:tenantId` が admin から api へ転送されてここに来る
// (要求の URL は admin オリジンのまま。ライブラリは issuer と要求の URL を照合する)。
// `/authorize` だけはアプリ側の責務(同意画面。M3-2)で、それ以外(oauth/token・oauth/register・
// metadata)はライブラリの fetch に任せる。

function notConfigured(what: string): Response {
  return Response.json({ error: "not_configured", what }, { status: 503 });
}

// Rate Limiting の仮置き(mcp/route.ts と同じ)。超過時の Retry-After
const RETRY_AFTER_SECONDS = "60";

// 入口の共通の門(レビュー修正 Important 1): DCR と token endpoint は未認証のまま OAUTH_KV に書く / 読み、
// /authorize は CIMD の外向き fetch を起こすので、/mcp と同じく接続元 IP 単位の Rate Limiting を KV 到達の
// 前に置く(未構成は fail-closed)。tenantId は D1 の tenants で実在を確かめ、無ければ 404(任意の文字列で
// metadata や DCR が応答しない)。通れば null
export async function guardOauthEntry(
  request: Request,
  env: Env,
  tenantId: string,
): Promise<Response | null> {
  const ipLimiter = env.MCP_IP_LIMITER;
  if (ipLimiter === undefined) {
    return notConfigured("MCP_IP_LIMITER");
  }
  const { success } = await ipLimiter.limit({
    key: request.headers.get("cf-connecting-ip") ?? "unknown",
  });
  if (!success) {
    return Response.json(
      { error: "rate_limited" },
      { status: 429, headers: { "retry-after": RETRY_AFTER_SECONDS } },
    );
  }
  const row = (
    await drizzle(env.DB)
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1)
  )[0];
  if (row === undefined) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  return null;
}

function serve(request: Request, env: Env, ctx: ExecutionContext, tenantId: string) {
  const server = createTenantAuthServer(env, tenantId);
  if (server === null) {
    return Promise.resolve(notConfigured("ADMIN_ORIGIN / API_ORIGIN"));
  }
  return server.fetch(request, env, ctx);
}

export const oauthRoutes = new Hono<{ Bindings: Env }>()
  .use("/t/:tenantId/*", async (c, next) => {
    const denied = await guardOauthEntry(c.req.raw, c.env, c.req.param("tenantId") ?? "");
    if (denied !== null) {
      return denied;
    }
    await next();
  })
  // 同意画面(M3-2)。ライブラリの fetch は authorize を扱わないので、その前に登録する
  .get("/t/:tenantId/authorize", handleAuthorizeGet)
  .post("/t/:tenantId/authorize", handleAuthorizePost)
  .all("/t/:tenantId/*", (c) => serve(c.req.raw, c.env, workerContext(c), c.req.param("tenantId")));

// RFC 8414 の Authorization Server Metadata(issuer にパスがあるので well-known の後ろに issuer のパスが続く)
export async function serveAuthorizationServerMetadata(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  tenantId: string,
): Promise<Response> {
  const denied = await guardOauthEntry(request, env, tenantId);
  return denied ?? serve(request, env, ctx, tenantId);
}
