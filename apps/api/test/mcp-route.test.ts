import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { beforeAll, describe, expect, it } from "vitest";
import { memberships, tenants, users } from "@plyrs/db/control-plane";
import { issuePat } from "../src/auth/pat";
import { app } from "../src/index";
import { fakeLimiter } from "./rate-limit-helper";

// M1-5(design-spec 16.2): MCP の入口 /mcp/t/:tenantId。POST のみ・Origin 検証・OAuthResourceServer の
// 401 と PRM・ヘッダと本文の照合(-32020)・Mcp-Name 単位の Rate Limiting(429 / 未構成は 503)。
// 仕様 2026-07-28 のみ(廃止済みの initialize は送らない)。

const ORIGIN = "https://api.example";
// app.request は ExecutionContext を渡さないと OAuthResourceServer が 500 になる
const CTX = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
const PROTOCOL = "2026-07-28";
const NOW = new Date();

let tenantId: string;
let otherTenantId: string;
let pat: string;
let foreignPat: string;

async function setupTenant(): Promise<{ tenantId: string; userId: string }> {
  const id = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const now = NOW.toISOString();
  const db = drizzle(env.DB);
  await db.insert(tenants).values({ id, slug: `s-${id}`, name: "S", createdAt: now });
  await db
    .insert(users)
    .values({ id: userId, email: `${userId}@example.com`, passwordHash: "h", createdAt: now });
  await db.insert(memberships).values({ userId, tenantId: id, role: "owner", createdAt: now });
  return { tenantId: id, userId };
}

beforeAll(async () => {
  const a = await setupTenant();
  const b = await setupTenant();
  tenantId = a.tenantId;
  otherTenantId = b.tenantId;
  pat = (
    await issuePat(env.DB, { ...a, name: "t", scopes: ["record:read"], expiresInDays: 1 }, NOW)
  ).token;
  foreignPat = (
    await issuePat(env.DB, { ...b, name: "t", scopes: ["record:read"], expiresInDays: 1 }, NOW)
  ).token;
});

function envelope(method: string, params: Record<string, unknown> = {}, id = 1) {
  return {
    jsonrpc: "2.0",
    id,
    method,
    params: {
      ...params,
      _meta: {
        "io.modelcontextprotocol/protocolVersion": PROTOCOL,
        "io.modelcontextprotocol/clientCapabilities": {},
      },
    },
  };
}

interface CallOptions {
  token?: string;
  headers?: Record<string, string>;
  limiter?: RateLimit | null;
  tenant?: string;
  body?: unknown;
}

async function post(
  method: string,
  params: Record<string, unknown> = {},
  options: CallOptions = {},
) {
  const body = options.body ?? envelope(method, params);
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    "mcp-protocol-version": PROTOCOL,
    "mcp-method": method,
    ...(typeof params["name"] === "string" ? { "mcp-name": params["name"] } : {}),
    ...(options.token === undefined ? {} : { authorization: `Bearer ${options.token}` }),
    ...options.headers,
  };
  const limiter = options.limiter === undefined ? fakeLimiter(true) : options.limiter;
  const testEnv = {
    ...env,
    ...(limiter === null ? { MCP_LIMITER: undefined } : { MCP_LIMITER: limiter }),
  };
  return app.request(
    `${ORIGIN}/mcp/t/${options.tenant ?? tenantId}`,
    { method: "POST", headers, body: JSON.stringify(body) },
    testEnv,
    CTX,
  );
}

async function rpcResult(res: Response): Promise<Record<string, unknown>> {
  expect(res.headers.get("content-type") ?? "").toContain("application/json");
  const json = await res.json<{ result?: Record<string, unknown>; error?: unknown }>();
  expect(json.error, JSON.stringify(json)).toBeUndefined();
  return json.result ?? {};
}

describe("/mcp/t/:tenantId の入口", () => {
  it("未認証の POST は 401 で、WWW-Authenticate に PRM の URL と scope が付く", async () => {
    const res = await post("tools/list");
    expect(res.status).toBe(401);
    const challenge = res.headers.get("www-authenticate") ?? "";
    expect(challenge).toContain(
      `resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/mcp/t/${tenantId}"`,
    );
    expect(challenge).toContain('scope="record:read"');
  });

  it("PRM は resource(api の直接オリジン)と authorization_servers(admin のテナント別 issuer)を返す", async () => {
    const res = await app.request(
      `${ORIGIN}/.well-known/oauth-protected-resource/mcp/t/${tenantId}`,
      {},
      env,
      CTX,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      resource: `${ORIGIN}/mcp/t/${tenantId}`,
      authorization_servers: [`${env.ADMIN_ORIGIN}/oauth/t/${tenantId}`],
      scopes_supported: ["record:read"],
    });
  });

  it("GET / DELETE は 405 で Allow: POST(Mcp-Session-Id は無視する)", async () => {
    for (const method of ["GET", "DELETE"]) {
      const res = await app.request(
        `${ORIGIN}/mcp/t/${tenantId}`,
        { method, headers: { authorization: `Bearer ${pat}`, "mcp-session-id": "x" } },
        env,
        CTX,
      );
      expect(res.status, method).toBe(405);
      expect(res.headers.get("allow")).toBe("POST");
    }
  });

  it("Origin 付きの要求は許可リスト(admin のオリジン)以外を 403 にする", async () => {
    const evil = await post(
      "server/discover",
      {},
      { token: pat, headers: { origin: "https://evil.example" } },
    );
    expect(evil.status).toBe(403);
    const admin = await post(
      "server/discover",
      {},
      { token: pat, headers: { origin: env.ADMIN_ORIGIN ?? "" } },
    );
    expect(admin.status).toBe(200);
  });

  it("Mcp-Method / Mcp-Name と本文の不一致は 400 と JSON-RPC -32020", async () => {
    const wrongName = await post(
      "tools/call",
      { name: "type_list", arguments: {} },
      { token: pat, headers: { "mcp-name": "record_get" } },
    );
    expect(wrongName.status).toBe(400);
    expect(await wrongName.json()).toMatchObject({ error: { code: -32020 } });
    const wrongMethod = await post(
      "tools/list",
      {},
      { token: pat, headers: { "mcp-method": "tools/call" } },
    );
    expect(wrongMethod.status).toBe(400);
    expect(await wrongMethod.json()).toMatchObject({ error: { code: -32020 } });
  });

  it("Rate Limiting: 超過は 429 + Retry-After、未構成は 503(fail-closed)", async () => {
    const limited = await post("tools/list", {}, { token: pat, limiter: fakeLimiter(false) });
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("60");
    const missing = await post("tools/list", {}, { token: pat, limiter: null });
    expect(missing.status).toBe(503);
  });

  it("Rate Limiting のキーはテナント・利用者・Mcp-Name(無ければ Mcp-Method)", async () => {
    const keys: string[] = [];
    const recording = {
      limit: async ({ key }: { key: string }) => (keys.push(key), { success: true }),
    } as RateLimit;
    await post("tools/list", {}, { token: pat, limiter: recording });
    await post(
      "tools/call",
      { name: "type_list", arguments: {} },
      { token: pat, limiter: recording },
    );
    expect(keys[0]).toMatch(new RegExp(`^${tenantId}:[0-9a-f-]{36}:tools/list$`));
    expect(keys[1]).toMatch(new RegExp(`^${tenantId}:[0-9a-f-]{36}:type_list$`));
  });

  it("別テナントの PAT は 401", async () => {
    const res = await post("tools/list", {}, { token: foreignPat });
    expect(res.status).toBe(401);
    expect(otherTenantId).not.toBe(tenantId);
  });

  // tools/list は M1-6 でツールを登録してから検証する(ツール未登録の McpServer は -32601 を返す)
  it("server/discover が 2026-07-28 と serverInfo を返す", async () => {
    const discover = await rpcResult(await post("server/discover", {}, { token: pat }));
    expect(discover["supportedVersions"]).toContain(PROTOCOL);
    const meta = discover["_meta"] as Record<string, unknown>;
    expect(meta["io.modelcontextprotocol/serverInfo"]).toMatchObject({ name: "plyrs" });
    expect(discover["cacheScope"]).toBe("private");
  });

  it("廃止済みの initialize(封筒なし)は仕様 2026-07-28 の入口では受けない", async () => {
    const res = await post(
      "initialize",
      {},
      {
        token: pat,
        body: {
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-11-25",
            capabilities: {},
            clientInfo: { name: "x", version: "0" },
          },
        },
        headers: { "mcp-protocol-version": "2025-11-25" },
      },
    );
    expect(res.status).toBe(400);
  });
});
