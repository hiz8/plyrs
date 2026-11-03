import { OAuthResourceServer } from "@cloudflare/workers-oauth-provider";
import {
  createMcpHandler,
  DEFAULT_MAX_REQUEST_BODY_SIZE,
  isJsonContentType,
  readRequestBody,
} from "@modelcontextprotocol/server";
import { Hono } from "hono";
import type { McpAuth } from "../do/authorize";
import { mcpTokenValidator, type McpTokenProps } from "../middleware/mcp-gate";
import { tenantIssuer, tenantResource } from "../oauth/server";
import { buildMcpServer } from "./server";

// design-spec 16.2(決定 48、M1-5): MCP の入口 `/mcp/t/:tenantId`。api Worker の直接オリジンで受け、
// OAuthResourceServer(決定 49)をホストにして PAT を検証する(401 の challenge・PRM・403 はライブラリが出す)。
// 入口の順序: POST のみ(405) → Origin の許可リスト → 接続元 IP の Rate Limiting(未認証の連打で
// D1 の PAT 照会を無制限に起こさないため。/auth と同じ考え方)→ トークン検証 → ヘッダと本文の照合
// (-32020)→ ツール名単位の Rate Limiting → SDK(server/discover・tools/list・tools/call)。

export const MCP_REQUIRED_SCOPES = ["record:read"];

// Rate Limiting の仮置き(limit 60 / period 60 は wrangler.jsonc の MCP_LIMITER 側)。超過時の Retry-After
const RETRY_AFTER_SECONDS = "60";
// 仕様 2026-07-28 の予約コード: ヘッダと本文の不一致
const HEADER_MISMATCH = -32020;

function jsonRpcError(status: number, code: number, message: string, id: unknown = null): Response {
  return Response.json({ jsonrpc: "2.0", id, error: { code, message } }, { status });
}

interface ParsedRpc {
  id: unknown;
  method: string | undefined;
  // Mcp-Name と照合する値(tools/call のツール名、resources/read の uri)
  name: string | undefined;
  // Rate Limiting のキーに使うツール名(tools/call だけ。uri は数が無限なのでキーにしない)
  tool: string | undefined;
}

function readRpc(body: unknown): ParsedRpc {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { id: null, method: undefined, name: undefined, tool: undefined };
  }
  const record = body as Record<string, unknown>;
  const params = record["params"];
  const paramsRecord =
    typeof params === "object" && params !== null ? (params as Record<string, unknown>) : {};
  const nameLike = paramsRecord["name"] ?? paramsRecord["uri"];
  const tool = paramsRecord["name"];
  return {
    id: record["id"] ?? null,
    method: typeof record["method"] === "string" ? record["method"] : undefined,
    name: typeof nameLike === "string" ? nameLike : undefined,
    tool: typeof tool === "string" ? tool : undefined,
  };
}

// 16.2(論点 E4): Mcp-Method / Mcp-Name を本文と照合する。SDK も同じ照合をするが、Rate Limiting の
// キーに使うヘッダの値を SDK より前に信用できる形にしておくため、入口でも行う。
export function headerMismatch(request: Request, rpc: ParsedRpc): string | null {
  const method = request.headers.get("mcp-method");
  if (method !== null && rpc.method !== undefined && method.trim() !== rpc.method) {
    return `Mcp-Method "${method}" does not match body method "${rpc.method}"`;
  }
  const name = request.headers.get("mcp-name");
  if (name !== null && rpc.name !== undefined && name.trim() !== rpc.name) {
    return `Mcp-Name "${name}" does not match body params "${rpc.name}"`;
  }
  return null;
}

function authFromProps(
  props: McpTokenProps,
  scope: string[],
  expiresAt: number | undefined,
): McpAuth {
  return {
    userId: props.userId,
    role: props.role,
    tenantId: props.tenantId,
    exp: expiresAt ?? 0,
    scopes: scope.filter((s): s is McpAuth["scopes"][number] => s.length > 0),
    tokenId: props.tokenId,
    tokenKind: props.tokenKind,
  };
}

async function serveMcp(
  request: Request,
  env: Env,
  tenantId: string,
  auth: McpAuth,
): Promise<Response> {
  // 本文は入口で読んで SDK に parsedBody で渡す(ヘッダとの照合と Rate Limiting を SDK より前に行うため)。
  // parsedBody は SDK の本文サイズ上限を通らないので、SDK と同じ readRequestBody で上限(4 MiB)を守る
  if (!isJsonContentType(request.headers.get("content-type"))) {
    return jsonRpcError(
      415,
      -32000,
      "Unsupported Media Type: Content-Type must be application/json",
    );
  }
  const read = await readRequestBody(request, DEFAULT_MAX_REQUEST_BODY_SIZE);
  if (read.tooLarge) {
    return jsonRpcError(413, -32000, "Payload Too Large: the request body exceeds 4 MiB");
  }
  let body: unknown;
  try {
    body = JSON.parse(read.text);
  } catch {
    return jsonRpcError(400, -32700, "Parse error: the request body is not valid JSON");
  }
  const rpc = readRpc(body);
  const mismatch = headerMismatch(request, rpc);
  if (mismatch !== null) {
    return jsonRpcError(
      400,
      HEADER_MISMATCH,
      `Bad Request: the request headers and body disagree: ${mismatch}`,
      rpc.id,
    );
  }
  // 16.1 / 16.2: 読み取りも DO を起こすのでツール名単位で制限する。未構成は fail-closed
  // (公開 write と同じ方針)。キーは テナント:利用者:ツール名(tools/call 以外はメソッド名。
  // resources/read の uri をキーにすると uri の数だけ枠が増えるので使わない)
  const limiter = env.MCP_LIMITER;
  if (limiter === undefined) {
    return jsonRpcError(503, -32000, "Service Unavailable: rate limiter is not configured", rpc.id);
  }
  const limitKey = `${tenantId}:${auth.userId}:${rpc.tool ?? rpc.method ?? "unknown"}`;
  const { success } = await limiter.limit({ key: limitKey });
  if (!success) {
    const res = jsonRpcError(429, -32000, "Too Many Requests", rpc.id);
    res.headers.set("retry-after", RETRY_AFTER_SECONDS);
    return res;
  }
  // 仕様 2026-07-28 のみ(未決事項「旧版プロトコルのクライアントへの対応」の仮置き)。
  // 廃止済みの initialize や GET/DELETE のセッション運用は受けない
  const handler = createMcpHandler(() => buildMcpServer({ env, tenantId, auth }), {
    legacy: "reject",
    onerror: (error) => console.warn("mcp", tenantId, error.message),
  });
  return handler.fetch(request, {
    parsedBody: body,
    authInfo: {
      token: "",
      clientId: auth.tokenKind === "pat" ? `pat:${auth.tokenId}` : auth.tokenId,
      scopes: auth.scopes,
      expiresAt: auth.exp,
    },
  });
}

// OAuthResourceServer は tenantId ごとに組み立てる(構築コストは無視できる。M0-3 結果 2 節)
// ADMIN_ORIGIN(テナント別 issuer の元)が未設定なら組み立てない。ライブラリは相対パスの issuer を
// 例外(500)にするが、設定事故として MCP_LIMITER と同じ 503 に揃える(呼び出し側で判定する)
export function createTenantResourceServer(
  origin: string,
  adminOrigin: string,
  tenantId: string,
): OAuthResourceServer<Env, McpTokenProps> {
  return new OAuthResourceServer<Env, McpTokenProps>({
    resourceMetadata: {
      resource: tenantResource(origin, tenantId),
      authorization_servers: [tenantIssuer(adminOrigin, tenantId)],
      resource_name: "plyrs MCP",
    },
    requiredScopes: MCP_REQUIRED_SCOPES,
    validateToken: mcpTokenValidator(tenantId),
    handler: {
      fetch: (request, env, ctx) =>
        serveMcp(
          request,
          env,
          tenantId,
          authFromProps(ctx.props, ctx.auth.scope, ctx.auth.expiresAt),
        ),
    },
  });
}

function originOf(request: Request): string {
  return new URL(request.url).origin;
}

// Hono の c.executionCtx は独自の最小型(waitUntil / passThroughOnException)で宣言されるが、
// 実体は Worker の fetch に渡された ExecutionContext そのもの。OAuthResourceServer の
// fetch は workers-types の完全な型を要求するので、ここで一箇所だけ型を戻す。
export function workerContext(c: { executionCtx: unknown }): ExecutionContext {
  return c.executionCtx as ExecutionContext;
}

function notConfigured(what: string): Response {
  return Response.json({ error: "not_configured", what }, { status: 503 });
}

export const mcpRoutes = new Hono<{ Bindings: Env }>().all("/t/:tenantId", async (c) => {
  if (c.req.method !== "POST") {
    // 旧クライアントの GET(SSE)/ DELETE(セッション終了)は受けない。Mcp-Session-Id は無視する
    return c.json({ error: "method_not_allowed" }, 405, { allow: "POST" });
  }
  const adminOrigin = c.env.ADMIN_ORIGIN;
  if (adminOrigin === undefined) {
    return notConfigured("ADMIN_ORIGIN");
  }
  // ブラウザからの直接呼び出しは想定しない。Origin が付いていれば許可リスト(admin のオリジン)だけを通す
  const origin = c.req.header("origin");
  if (origin !== undefined && origin !== adminOrigin) {
    return c.json({ error: "forbidden_origin" }, 403);
  }
  // 未認証の要求が D1 の PAT 照会(SHA-256 + memberships の join)を無制限に起こさないよう、トークン
  // 検証の前に接続元 IP 単位で制限する(ローカル/テストは "unknown" に縮退)。未構成は fail-closed
  const ipLimiter = c.env.MCP_IP_LIMITER;
  if (ipLimiter === undefined) {
    return notConfigured("MCP_IP_LIMITER");
  }
  const { success } = await ipLimiter.limit({ key: c.req.header("cf-connecting-ip") ?? "unknown" });
  if (!success) {
    return c.json({ error: "rate_limited" }, 429, { "retry-after": RETRY_AFTER_SECONDS });
  }
  const tenantId = c.req.param("tenantId");
  const server = createTenantResourceServer(originOf(c.req.raw), adminOrigin, tenantId);
  return server.fetch(c.req.raw, c.env, workerContext(c));
});

// RFC 9728 の PRM(/.well-known/oauth-protected-resource/mcp/t/:tenantId)。index.ts から流す
export function serveProtectedResourceMetadata(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  tenantId: string,
): Promise<Response> {
  if (env.ADMIN_ORIGIN === undefined) {
    return Promise.resolve(notConfigured("ADMIN_ORIGIN"));
  }
  return createTenantResourceServer(originOf(request), env.ADMIN_ORIGIN, tenantId).fetch(
    request,
    env,
    ctx,
  );
}
