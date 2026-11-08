import {
  insufficientScope,
  type OAuthResourceAuth,
  OAuthResourceServer,
} from "@cloudflare/workers-oauth-provider";
import {
  createMcpHandler,
  DEFAULT_MAX_REQUEST_BODY_SIZE,
  isJsonContentType,
  readRequestBody,
} from "@modelcontextprotocol/server";
import { Hono } from "hono";
import type { McpAuth } from "../do/authorize";
import type { Operation } from "../auth/permissions";
import { mcpTokenValidator, type McpTokenProps } from "../middleware/mcp-gate";
import { tenantIssuer, tenantResource } from "../oauth/server";
import { findOperation, type OpSpec } from "../ops/catalog";
import { missingScope } from "../ops/invoke";
import { buildMcpServer } from "./server";

// design-spec 16.2(決定 48、M1-5): MCP の入口 `/mcp/t/:tenantId`。api Worker の直接オリジンで受け、
// OAuthResourceServer(決定 49)をホストにして PAT / OAuth の token を検証する(401 の challenge・PRM・
// 403 はライブラリが出す)。
// 入口の順序: POST のみ(405) → Origin の許可リスト → 接続元 IP の Rate Limiting(未認証の連打で
// D1 の PAT 照会を無制限に起こさないため。/auth と同じ考え方)→ トークン検証 → ヘッダと本文の照合
// (-32020)→ tools/call のスコープ判定(OAuth は 403 insufficient_scope の step-up、M3-3。PAT は業務エラー、
// 決定 55)→ ツール名単位の Rate Limiting
// → SDK(server/discover・tools/list・tools/call)。

export const MCP_REQUIRED_SCOPES = ["record:read"];

// Rate Limiting の仮置き(limit 60 / period 60 は wrangler.jsonc の MCP_LIMITER 側)。超過時の Retry-After
const RETRY_AFTER_SECONDS = "60";
// 仕様 2026-07-28 の予約コード: ヘッダと本文の不一致
const HEADER_MISMATCH = -32020;
// JSON-RPC の Invalid Request(バッチの拒否に使う)
const INVALID_REQUEST = -32600;

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

// 16.3(M3-3、決定 49): OAuth のスコープ不足は DO を起こす前に 403 insufficient_scope で返し、クライアントが
// 一往復で step-up できるようにする(challenge の scope と resource_metadata はライブラリが組む)。
// PAT は再認可できないので使わない(patScopeFailure。決定 55)
export async function insufficientScopeFor(
  auth: OAuthResourceAuth,
  scope: Operation,
): Promise<Response> {
  // M3 の見送り指摘 (i): WWW-Authenticate は ASCII しか運べず、日本語の説明はヘッダから落ちる。
  // ヘッダには英文を載せ、本文 JSON の error_description は日本語に差し替える
  const header = `Re-authorize with ${scope}.`;
  const description = `${scope} を含めて再認可してください`;
  const res = insufficientScope(auth, [scope], header);
  const body = await res.json<Record<string, unknown>>();
  return Response.json(
    { ...body, error_description: description },
    { status: res.status, headers: res.headers },
  );
}

// 決定 55(M5a-5): PAT のスコープ不足で、エージェントと利用者に示す対処
export function patScopeRemedy(scope: Operation): string {
  return `この接続トークンには ${scope} がありません。所有者に、管理画面の 設定 › 接続中のアプリ で ${scope} を含むトークンを発行してもらい、接続を設定し直してください`;
}

// 決定 55(M5a-5): PAT は再認可できないので、step-up の 403 は役に立たない(G4 で Claude Code は
// 「Insufficient scope」とだけ表示し、対処が届かなかった)。tools/call の結果の業務エラーで対処を返す。
// SDK の手前で JSON-RPC の応答を組むので、buildMcpServer も DO も起こさず、ツール単位の枠も消費しない
// M5c(決定 57): 足りないのが書き込み系で、トークンが record:propose を持つなら、提案(proposal_create)へ
// 導く。再認可を待たずにエージェントが変更を提案の形で残せる
// 提案の kind で代えられる操作だけ(asset_upload や record_restore も record:write だが、提案には無い)
const PROPOSABLE_OPERATIONS: readonly string[] = [
  "record_create",
  "record_update",
  "record_delete",
  "record_publish",
  "record_unpublish",
];

export function canProposeInstead(
  scopes: readonly Operation[],
  operation: string,
  missing: Operation,
): boolean {
  return (
    scopes.includes("record:propose") &&
    PROPOSABLE_OPERATIONS.includes(operation) &&
    missing !== "record:read"
  );
}

export const PROPOSE_INSTEAD_NOTE =
  "このトークンは提案(proposal_create)なら送れます。変更を提案にして、人に採用を依頼してください";

export function patScopeFailure(id: unknown, scope: Operation, canPropose = false): Response {
  const message = canPropose
    ? `${patScopeRemedy(scope)}。${PROPOSE_INSTEAD_NOTE}`
    : patScopeRemedy(scope);
  return Response.json({
    jsonrpc: "2.0",
    id,
    result: {
      content: [{ type: "text", text: `insufficient_scope: ${message}` }],
      structuredContent: {
        error: {
          code: "insufficient_scope",
          message,
          details: {
            required: scope,
            tokenKind: "pat",
            ...(canPropose ? { alternative: "proposal_create" } : {}),
          },
        },
      },
      isError: true,
    },
  });
}

// tools/call が MCP に出ている操作なら、その操作の宣言(無ければ undefined。未知の名前は
// SDK の unknown tool に任せる)
function mcpOperationOf(rpc: ParsedRpc): OpSpec | undefined {
  if (rpc.method !== "tools/call" || rpc.tool === undefined) {
    return undefined;
  }
  const spec = findOperation(rpc.tool);
  return spec !== undefined && spec.via.includes("mcp") ? spec : undefined;
}

async function serveMcp(
  request: Request,
  origin: string,
  env: Env,
  tenantId: string,
  auth: McpAuth,
  resourceAuth: OAuthResourceAuth,
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
  // 決定 56(M5b): JSON-RPC のバッチ(配列)は受けない。以降のヘッダ照合・スコープ判定・Rate Limiting の
  // キーは 1 要求を前提にしていて、配列は素通りしてしまう(2026-07-28 にバッチは無く、SDK の 2025 年版の
  // 経路が受けうるものを入口で止める)
  if (Array.isArray(body)) {
    return jsonRpcError(
      400,
      INVALID_REQUEST,
      "Invalid Request: JSON-RPC batches are not supported",
    );
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
  const spec = mcpOperationOf(rpc);
  const missing = spec === undefined ? null : missingScope(auth, spec);
  if (missing !== null) {
    return auth.tokenKind === "pat"
      ? patScopeFailure(
          rpc.id,
          missing,
          spec !== undefined && canProposeInstead(auth.scopes, spec.name, missing),
        )
      : await insufficientScopeFor(resourceAuth, missing);
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
  // 決定 56(M5b): 仕様 2026-07-28 のみ。廃止済みの initialize や GET/DELETE のセッション運用は受けない
  // (対象のクライアント claude.ai / Claude デスクトップは 2026-07-28 で話す。ChatGPT で必要になったら再検討)
  const handler = createMcpHandler(() => buildMcpServer({ env, tenantId, auth, origin }), {
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
          origin,
          env,
          tenantId,
          authFromProps(ctx.props, ctx.auth.scope, ctx.auth.expiresAt),
          ctx.auth,
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
