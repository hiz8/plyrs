import { Hono } from "hono";
import { workerContext } from "../mcp/route";
import { createTenantAuthServer } from "./server";

// design-spec 16.2(決定 47、M3-1): 認可サーバーの入口。admin オリジンの `/oauth/t/:tenantId/...` と
// `/.well-known/oauth-authorization-server/oauth/t/:tenantId` が admin から api へ転送されてここに来る
// (要求の URL は admin オリジンのまま。ライブラリは issuer と要求の URL を照合する)。
// `/authorize` だけはアプリ側の責務(同意画面。M3-2)で、それ以外(oauth/token・oauth/register・
// metadata)はライブラリの fetch に任せる。

function notConfigured(what: string): Response {
  return Response.json({ error: "not_configured", what }, { status: 503 });
}

function serve(request: Request, env: Env, ctx: ExecutionContext, tenantId: string) {
  const server = createTenantAuthServer(env, tenantId);
  if (server === null) {
    return Promise.resolve(notConfigured("ADMIN_ORIGIN / API_ORIGIN"));
  }
  return server.fetch(request, env, ctx);
}

export const oauthRoutes = new Hono<{ Bindings: Env }>()
  // M3-2 で同意画面に置き換える
  .all("/t/:tenantId/authorize", (c) => c.json({ error: "not_implemented" }, 501))
  .all("/t/:tenantId/*", (c) => serve(c.req.raw, c.env, workerContext(c), c.req.param("tenantId")));

// RFC 8414 の Authorization Server Metadata(issuer にパスがあるので well-known の後ろに issuer のパスが続く)
export function serveAuthorizationServerMetadata(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  tenantId: string,
): Promise<Response> {
  return serve(request, env, ctx, tenantId);
}
