import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { memberships, tenants, users } from "@plyrs/db/control-plane";
import { issuePat } from "../src/auth/pat";
import { app } from "../src/index";
import { ADMIN_ORIGIN, authorize } from "./oauth-helpers";
import { fakeLimiter } from "./rate-limit-helper";

// M1-5(design-spec 16.2): MCP の入口 /mcp/t/:tenantId。POST のみ・Origin 検証・OAuthResourceServer の
// 401 と PRM・ヘッダと本文の照合(-32020)・Mcp-Name 単位の Rate Limiting(429 / 未構成は 503)。
// 2026-07-28 の封筒で送る。2025 年版(initialize から始める)は決定 56 の describe で確かめる。

const ORIGIN = "https://api.example";
// app.request は ExecutionContext を渡さないと OAuthResourceServer が 500 になる
const CTX = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
const PROTOCOL = "2026-07-28";
const LEGACY_PROTOCOL = "2025-11-25";
const NOW = new Date();

let tenantId: string;
let otherTenantId: string;
let userId: string;
let pat: string;
let foreignPat: string;
// record:read を持たない PAT(M3 の時点で MCP に出ている操作は全部 record:read を要するので、外して試す)
let writeOnlyPat: string;

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
  userId = a.userId;
  otherTenantId = b.tenantId;
  writeOnlyPat = (
    await issuePat(env.DB, { ...a, name: "w", scopes: ["record:write"], expiresInDays: 1 }, NOW)
  ).token;
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
  ipLimiter?: RateLimit | null;
  tenant?: string;
  body?: unknown;
  env?: Partial<Env>;
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
  const ipLimiter = options.ipLimiter === undefined ? fakeLimiter(true) : options.ipLimiter;
  const testEnv = {
    ...env,
    ...(limiter === null ? { MCP_LIMITER: undefined } : { MCP_LIMITER: limiter }),
    ...(ipLimiter === null ? { MCP_IP_LIMITER: undefined } : { MCP_IP_LIMITER: ipLimiter }),
    ...options.env,
  };
  return app.request(
    `${ORIGIN}/mcp/t/${options.tenant ?? tenantId}`,
    { method: "POST", headers, body: JSON.stringify(body) },
    testEnv,
    CTX,
  );
}

// SDK の旧版の経路は SSE(`event: message` + `data:` 1 行)で答える
async function legacyResult(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  const line = text.split("\n").find((l) => l.startsWith("data:"));
  expect(line, text).toBeDefined();
  const json = JSON.parse((line ?? "").slice(5)) as {
    result?: Record<string, unknown>;
    error?: unknown;
  };
  expect(json.error, JSON.stringify(json)).toBeUndefined();
  return json.result ?? {};
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

  it("未認証の連打は接続元 IP の Rate Limiting(PAT 検証の前)で 429 になる。未構成は 503", async () => {
    const keys: string[] = [];
    const recording = {
      limit: async ({ key }: { key: string }) => (keys.push(key), { success: false }),
    } as RateLimit;
    const limited = await post(
      "server/discover",
      {},
      { ipLimiter: recording, headers: { "cf-connecting-ip": "203.0.113.9" } },
    );
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("60");
    expect(keys).toEqual(["203.0.113.9"]);
    const missing = await post("server/discover", {}, { token: pat, ipLimiter: null });
    expect(missing.status).toBe(503);
  });

  it("ADMIN_ORIGIN 未設定は入口も PRM も 503(壊れた issuer を返さない)", async () => {
    const entry = await post(
      "server/discover",
      {},
      { token: pat, env: { ADMIN_ORIGIN: undefined } },
    );
    expect(entry.status).toBe(503);
    const prm = await app.request(
      `${ORIGIN}/.well-known/oauth-protected-resource/mcp/t/${tenantId}`,
      {},
      { ...env, ADMIN_ORIGIN: undefined },
      CTX,
    );
    expect(prm.status).toBe(503);
  });

  it("Rate Limiting のキーはテナント・利用者・ツール名(tools/call 以外はメソッド名)", async () => {
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
    // resources/read の uri をキーにすると uri の数だけ枠が増えるので、メソッド名で 1 つにまとめる
    await post(
      "resources/read",
      { uri: "plyrs://types/anything-goes" },
      { token: pat, limiter: recording, headers: { "mcp-name": "plyrs://types/anything-goes" } },
    );
    expect(keys[0]).toMatch(new RegExp(`^${tenantId}:[0-9a-f-]{36}:tools/list$`));
    expect(keys[1]).toMatch(new RegExp(`^${tenantId}:[0-9a-f-]{36}:type_list$`));
    expect(keys[2]).toMatch(new RegExp(`^${tenantId}:[0-9a-f-]{36}:resources/read$`));
  });

  it("本文は SDK と同じ上限(4 MiB)で、超えると 413。JSON 以外の Content-Type は 415", async () => {
    const padding = "x".repeat(4 * 1024 * 1024);
    const huge = await post(
      "tools/list",
      {},
      { token: pat, body: { ...envelope("tools/list"), padding } },
    );
    expect(huge.status).toBe(413);
    const text = await post(
      "tools/list",
      {},
      { token: pat, headers: { "content-type": "text/plain" } },
    );
    expect(text.status).toBe(415);
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

  // 決定 56(M5b): 2025 年版(initialize から始めるクライアント)も stateless で受ける。応答は SDK の
  // 旧版の経路が SSE で返す。セッションは持たない
  describe("2025 年版のクライアント(決定 56)", () => {
    async function legacy(body: unknown, options: CallOptions & { version?: string } = {}) {
      // 2025 年版は Mcp-Method / Mcp-Name を送らない。initialize は MCP-Protocol-Version も送らない
      const version = options.version ?? LEGACY_PROTOCOL;
      const headers: Record<string, string> = {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...(version === "" ? {} : { "mcp-protocol-version": version }),
        ...(options.token === undefined ? {} : { authorization: `Bearer ${options.token}` }),
      };
      const limiter = options.limiter ?? fakeLimiter(true);
      return app.request(
        `${ORIGIN}/mcp/t/${tenantId}`,
        { method: "POST", headers, body: JSON.stringify(body) },
        { ...env, MCP_LIMITER: limiter, MCP_IP_LIMITER: fakeLimiter(true) },
        CTX,
      );
    }

    it("initialize は 2025-11-25 と 2025-03-26 に 200 で答え、Mcp-Session-Id を出さない", async () => {
      for (const protocolVersion of ["2025-11-25", "2025-03-26"]) {
        const res = await legacy(
          {
            jsonrpc: "2.0",
            id: 1,
            method: "initialize",
            params: {
              protocolVersion,
              capabilities: {},
              clientInfo: { name: "x", version: "0" },
            },
          },
          { token: pat, version: "" },
        );
        expect(res.status, protocolVersion).toBe(200);
        expect(res.headers.get("mcp-session-id")).toBeNull();
        const result = await legacyResult(res);
        expect(result["protocolVersion"]).toBe(protocolVersion);
        expect(result["serverInfo"]).toMatchObject({ name: "plyrs" });
      }
    });

    it("notifications/initialized は 202", async () => {
      const res = await legacy(
        { jsonrpc: "2.0", method: "notifications/initialized" },
        { token: pat },
      );
      expect(res.status).toBe(202);
    });

    it("封筒なしの tools/list と tools/call が通る", async () => {
      const list = await legacyResult(
        await legacy({ jsonrpc: "2.0", id: 2, method: "tools/list" }, { token: pat }),
      );
      const names = (list["tools"] as { name: string }[]).map((tool) => tool.name);
      expect(names.slice(0, 2)).toEqual(["type_list", "type_get"]);
      const call = await legacyResult(
        await legacy(
          {
            jsonrpc: "2.0",
            id: 3,
            method: "tools/call",
            params: { name: "type_list", arguments: {} },
          },
          { token: pat },
        ),
      );
      expect(call["isError"]).toBeUndefined();
      expect(call["structuredContent"]).toHaveProperty("types");
    });

    it("PAT のスコープ不足は 2025 年版でも入口の業務エラーで、Rate Limiting の枠を使わない", async () => {
      const keys: string[] = [];
      const recording = {
        limit: async ({ key }: { key: string }) => (keys.push(key), { success: true }),
      } as RateLimit;
      const res = await legacy(
        {
          jsonrpc: "2.0",
          id: 4,
          method: "tools/call",
          params: { name: "record_create", arguments: {} },
        },
        { token: pat, limiter: recording },
      );
      expect(res.status).toBe(200);
      const json = await res.json<{ result: Record<string, unknown> }>();
      expect(json.result["isError"]).toBe(true);
      expect(json.result["structuredContent"]).toMatchObject({
        error: { code: "insufficient_scope", details: { required: "record:write" } },
      });
      expect(keys).toEqual([]);
    });

    it("JSON-RPC のバッチ(配列)は SDK に渡さず 400 / -32600", async () => {
      const keys: string[] = [];
      const recording = {
        limit: async ({ key }: { key: string }) => (keys.push(key), { success: true }),
      } as RateLimit;
      const res = await legacy(
        [
          { jsonrpc: "2.0", id: 5, method: "tools/list" },
          {
            jsonrpc: "2.0",
            id: 6,
            method: "tools/call",
            params: { name: "record_create", arguments: {} },
          },
        ],
        { token: pat, limiter: recording, version: "2025-03-26" },
      );
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: { code: -32600 } });
      expect(keys).toEqual([]);
    });
  });

  // M3-3(決定 49): OAuth の access token は PAT と同じ入口・同じ認可コンテキストに合流する。
  // 認可サーバーの resource は API_ORIGIN(= この入口のオリジン)で組むので、env を上書きして渡す
  const OAUTH_ENV = { ADMIN_ORIGIN, API_ORIGIN: ORIGIN };

  it("PRM と AS metadata は OPTIONS(preflight)に 204 と CORS ヘッダで応える(M3 の見送り指摘 (f))", async () => {
    for (const path of [
      `/.well-known/oauth-protected-resource/mcp/t/${tenantId}`,
      `/.well-known/oauth-authorization-server/oauth/t/${tenantId}`,
    ]) {
      const res = await app.request(
        path,
        {
          method: "OPTIONS",
          headers: { origin: "https://client.example", "access-control-request-method": "GET" },
        },
        { ...env, ...OAUTH_ENV },
      );
      expect(res.status).toBe(204);
      expect(res.headers.get("access-control-allow-origin")).toBe("*");
      expect(res.headers.get("access-control-allow-methods")).toContain("GET");
      expect(res.headers.get("access-control-allow-headers")).toContain("mcp-protocol-version");
    }
  });

  it("OAuth の access token で tools/list が 200。別テナントで発行した token は 401", async () => {
    const issued = await authorize(tenantId, ["record:read"], { userId, role: "owner" });
    const res = await post("tools/list", {}, { token: issued.access_token, env: OAUTH_ENV });
    expect(res.status).toBe(200);
    const foreign = await authorize(otherTenantId, ["record:read"]);
    const denied = await post("tools/list", {}, { token: foreign.access_token, env: OAUTH_ENV });
    expect(denied.status).toBe(401);
  });

  // 決定 55(M5a-5、Review Focus 5): PAT は再認可できないので、スコープ不足は HTTP 200 の業務エラーで
  // 対処を返す。SDK の手前で返すので DO も Rate Limiting の枠も使わない(TENANT_DO を偽物にし、limit の
  // 呼び出しを数える。limit は SDK より前にあるので、呼ばれなければ buildMcpServer も起きていない)
  it("PAT のスコープ不足の tools/call は HTTP 200 の業務エラーで、DO も Rate Limiting も使わない", async () => {
    const limit = vi.fn(async () => ({ success: true }));
    const doGet = vi.fn();
    const res = await post(
      "tools/call",
      { name: "record_get", arguments: { id: crypto.randomUUID() } },
      {
        token: writeOnlyPat,
        body: envelope("tools/call", { name: "record_get", arguments: {} }, 42),
        limiter: { limit } as unknown as RateLimit,
        env: {
          TENANT_DO: { get: doGet, idFromName: vi.fn() } as unknown as Env["TENANT_DO"],
        },
      },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") ?? "").toContain("application/json");
    const json = await res.json<{
      id: unknown;
      result: {
        isError: boolean;
        content: { type: string; text: string }[];
        structuredContent: {
          error: { code: string; message: string; details: Record<string, unknown> };
        };
      };
    }>();
    expect(json.id).toBe(42);
    expect(json.result.isError).toBe(true);
    expect(json.result.structuredContent.error).toMatchObject({
      code: "insufficient_scope",
      details: { required: "record:read", tokenKind: "pat" },
    });
    expect(json.result.structuredContent.error.message).toContain("所有者に");
    expect(json.result.content[0]?.text).toContain("record:read");
    expect(doGet).not.toHaveBeenCalled();
    expect(limit).not.toHaveBeenCalled();
  });

  it("OAuth のスコープ不足は 403 insufficient_scope(必要なスコープと PRM を challenge に出す)", async () => {
    const issued = await authorize(tenantId, ["record:write"], { userId, role: "owner" });
    const res = await post(
      "tools/call",
      { name: "record_get", arguments: { id: crypto.randomUUID() } },
      { token: issued.access_token, env: OAUTH_ENV },
    );
    expect(res.status).toBe(403);
    const challenge = res.headers.get("www-authenticate") ?? "";
    expect(challenge).toContain('error="insufficient_scope"');
    expect(challenge).toContain('scope="record:read"');
    expect(challenge).toContain(
      `resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/mcp/t/${tenantId}"`,
    );
    // M3 の見送り指摘 (i): WWW-Authenticate は ASCII しか運べないので、ヘッダには英文の説明を載せる
    expect(challenge).toContain('error_description="Re-authorize with record:read.');
  });

  it("OAuth のスコープ不足は再認可(step-up)を案内する。tools/list と未知のツール名は対象外", async () => {
    const issued = await authorize(tenantId, ["record:write"], { userId, role: "owner" });
    const options = { token: issued.access_token, env: OAUTH_ENV };
    const res = await post(
      "tools/call",
      { name: "record_get", arguments: { id: crypto.randomUUID() } },
      options,
    );
    expect(res.status).toBe(403);
    const body = await res.json<{ error: string; error_description?: string }>();
    expect(body.error_description).toContain("再認可");
    expect((await post("tools/list", {}, options)).status).toBe(200);
    // MCP に出ていない名前は SDK の unknown tool(JSON-RPC のエラー)に任せる
    const unknown = await post("tools/call", { name: "nope", arguments: {} }, options);
    expect(unknown.status).not.toBe(403);
  });
});
