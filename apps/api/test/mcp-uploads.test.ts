import { env, runInDurableObject } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { memberships, personalAccessTokens, tenants, users } from "@plyrs/db/control-plane";
import { blockUser } from "../src/auth/blocklist";
import { issuePat, revokePat } from "../src/auth/pat";
import { generateSessionToken, sha256Hex } from "../src/auth/session";
import type { McpAuth } from "../src/do/authorize";
import { revokeTenantGrant } from "../src/oauth/grants";
import { authorize, oauthEnv } from "./oauth-helpers";
import { MAX_ASSET_SIZE_BYTES } from "../src/assets/store";
import { loadHistory } from "../src/do/history";
import { app } from "../src/index";
import { fakeLimiter } from "./rate-limit-helper";

// M4-4(design-spec 16.11、決定 51): asset_upload が発行する使い切りのアップロード URL。
// 二重使用・期限切れ・別テナントへの付け替え・発行後の BAN(Review Focus 3)

const ORIGIN = "https://api.example";
const CTX = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
const PROTOCOL = "2026-07-28";
const TEST_ENV = { ...env, MCP_LIMITER: fakeLimiter(true), MCP_IP_LIMITER: fakeLimiter(true) };

const PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x10, 0x00, 0x00, 0x00, 0x08, 0x08, 0x06, 0x00, 0x00, 0x00,
]);

interface Tenant {
  tenantId: string;
  userId: string;
  writePat: string;
  writePatId: string;
  readPat: string;
}

// asset の record の最初の版の経路と tokenId(M5a-3)
async function firstHistory(tenantId: string, recordId: string) {
  const stub = env.TENANT_DO.get(env.TENANT_DO.idFromName(tenantId));
  return runInDurableObject(stub, (_instance, state) => {
    const items = loadHistory(state.storage.sql, recordId, { limit: 10 }).items;
    const first = items[items.length - 1];
    return { via: first?.via, tokenId: first?.tokenId };
  });
}

async function setupTenant(): Promise<Tenant> {
  const tenantId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const now = new Date().toISOString();
  const db = drizzle(env.DB);
  await db
    .insert(tenants)
    .values({ id: tenantId, slug: `u-${tenantId}`, name: "U", createdAt: now });
  await db
    .insert(users)
    .values({ id: userId, email: `${userId}@example.com`, passwordHash: "h", createdAt: now });
  await db.insert(memberships).values({ userId, tenantId, role: "editor", createdAt: now });
  const issue = async (scopes: string[]) =>
    issuePat(
      env.DB,
      { userId, tenantId, name: "p", scopes: scopes as never, expiresInDays: 1 },
      new Date(),
    );
  const write = await issue(["record:read", "record:write"]);
  return {
    tenantId,
    userId,
    writePat: write.token,
    writePatId: write.id,
    readPat: (await issue(["record:read"])).token,
  };
}

async function callRaw(t: Tenant, name: string, args: Record<string, unknown>, token: string) {
  return app.request(
    `${ORIGIN}/mcp/t/${t.tenantId}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": PROTOCOL,
        "mcp-method": "tools/call",
        "mcp-name": name,
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name,
          arguments: args,
          _meta: {
            "io.modelcontextprotocol/protocolVersion": PROTOCOL,
            "io.modelcontextprotocol/clientCapabilities": {},
          },
        },
      }),
    },
    TEST_ENV,
    CTX,
  );
}

type ToolResult = {
  result?: { isError?: boolean; structuredContent?: Record<string, unknown> };
};

async function issueUpload(t: Tenant): Promise<string> {
  const res = await callRaw(
    t,
    "asset_upload",
    { filename: "hero.png", contentType: "image/png" },
    t.writePat,
  );
  expect(res.status).toBe(200);
  const json = await res.json<ToolResult>();
  expect(json.result?.isError, JSON.stringify(json)).toBeUndefined();
  const url = json.result?.structuredContent?.["uploadUrl"];
  expect(typeof url).toBe("string");
  return url as string;
}

function post(url: string, body: BodyInit, headers: Record<string, string> = {}) {
  return app.request(
    url,
    { method: "POST", headers: { "content-type": "image/png", ...headers }, body },
    TEST_ENV,
    CTX,
  );
}

let a: Tenant;
let b: Tenant;

beforeAll(async () => {
  a = await setupTenant();
  b = await setupTenant();
});

describe("asset_upload とアップロード URL", () => {
  it("発行した URL に PNG を POST すると 201 で asset が作られ、record_get で読める", async () => {
    const url = await issueUpload(a);
    expect(url.startsWith(`${ORIGIN}/mcp/t/${a.tenantId}/uploads/`)).toBe(true);
    const res = await post(url, PNG);
    expect(res.status, await res.clone().text()).toBe(201);
    const { assetId } = await res.json<{ assetId: string }>();
    const got = await callRaw(a, "record_get", { recordId: assetId }, a.readPat);
    const json = await got.json<ToolResult>();
    expect(json.result?.structuredContent).toMatchObject({
      type: "asset",
      data: {
        filename: "hero.png",
        content_type: "image/png",
        size: PNG.byteLength,
        width: 16,
        height: 8,
      },
    });
    expect(await env.ASSETS.head(`${a.tenantId}/${assetId}`)).not.toBeNull();
    // M5a-3: 履歴の経路は mcp で、tokenId は発行に使った PAT の行 ID
    expect(await firstHistory(a.tenantId, assetId)).toEqual({ via: "mcp", tokenId: a.writePatId });
  });

  it("同じ URL への 2 回目は 410", async () => {
    const url = await issueUpload(a);
    expect((await post(url, PNG)).status).toBe(201);
    const second = await post(url, PNG);
    expect(second.status).toBe(410);
    expect(await second.json()).toEqual({ error: "used" });
  });

  it("期限を過ぎたトークンは 410", async () => {
    const url = await issueUpload(a);
    const stub = env.TENANT_DO.get(env.TENANT_DO.idFromName(a.tenantId));
    await runInDurableObject(stub, async (_instance, state) => {
      state.storage.sql.exec(
        "UPDATE asset_upload_tokens SET expires_at = ? WHERE used_at IS NULL",
        new Date(Date.now() - 1000).toISOString(),
      );
    });
    const res = await post(url, PNG);
    expect(res.status).toBe(410);
    expect(await res.json()).toEqual({ error: "expired" });
  });

  it("別テナントのパスに同じトークンを出すと 404 で、元のテナントではまだ使える", async () => {
    const url = await issueUpload(a);
    const moved = url.replace(`/mcp/t/${a.tenantId}/`, `/mcp/t/${b.tenantId}/`);
    expect((await post(moved, PNG)).status).toBe(404);
    expect((await post(url, PNG)).status).toBe(201);
  });

  it("発行後に BAN された利用者のトークンは 403 で、R2 に何も残らない", async () => {
    const c = await setupTenant();
    const url = await issueUpload(c);
    await blockUser(env.BLOCKLIST, c.userId);
    const res = await post(url, PNG);
    expect(res.status).toBe(403);
    const listed = await env.ASSETS.list({ prefix: `${c.tenantId}/` });
    expect(listed.objects).toHaveLength(0);
  });

  it("20 MiB を超える本文は 413(Content-Length の前検査と、読みながらの打ち切り)", async () => {
    const declared = await issueUpload(a);
    const big = await post(declared, PNG, { "content-length": String(MAX_ASSET_SIZE_BYTES + 1) });
    expect(big.status).toBe(413);
    const streamed = await issueUpload(a);
    const chunk = new Uint8Array(1024 * 1024);
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent > MAX_ASSET_SIZE_BYTES) {
          controller.close();
          return;
        }
        sent += chunk.byteLength;
        controller.enqueue(chunk);
      },
    });
    const res = await app.request(
      streamed,
      { method: "POST", body: stream, duplex: "half" } as RequestInit,
      TEST_ENV,
      CTX,
    );
    expect(res.status).toBe(413);
  });

  it("存在しないテナントのパスは DO を起こさずに 404", async () => {
    const url = await issueUpload(a);
    const ghost = crypto.randomUUID();
    const moved = url.replace(`/mcp/t/${a.tenantId}/`, `/mcp/t/${ghost}/`);
    expect((await post(moved, PNG)).status).toBe(404);
    // 元のテナントのトークンは使われていない
    expect((await post(url, PNG)).status).toBe(201);
  });

  it("Origin 付きの POST と、形の違うトークンは拒否する", async () => {
    const url = await issueUpload(a);
    expect((await post(url, PNG, { origin: "https://evil.example" })).status).toBe(403);
    expect((await post(`${ORIGIN}/mcp/t/${a.tenantId}/uploads/short`, PNG)).status).toBe(404);
    // Origin で拒否したトークンは使われていない
    expect((await post(url, PNG)).status).toBe(201);
  });

  it("record:read だけの PAT で asset_upload は入口で 403", async () => {
    const res = await callRaw(
      a,
      "asset_upload",
      { filename: "x.png", contentType: "image/png" },
      a.readPat,
    );
    expect(res.status).toBe(403);
    expect(res.headers.get("www-authenticate")).toContain('scope="record:write"');
  });

  it("SVG は入力の検査で拒否する", async () => {
    const res = await callRaw(
      a,
      "asset_upload",
      { filename: "x.svg", contentType: "image/svg+xml" },
      a.writePat,
    );
    const json = await res.json<ToolResult>();
    expect(json.result?.isError).toBe(true);
  });
});

describe("asset_import_url(M4-5)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("公開 URL の PNG を取り込み、assetId が record_get で読める", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(PNG, { status: 200, headers: { "content-type": "image/png" } }),
      );
    const res = await callRaw(
      a,
      "asset_import_url",
      { url: "https://images.example.com/photos/spring.png" },
      a.writePat,
    );
    const json = await res.json<ToolResult>();
    expect(json.result?.isError, JSON.stringify(json)).toBeUndefined();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const assetId = json.result?.structuredContent?.["assetId"] as string;
    expect(json.result?.structuredContent).toMatchObject({
      contentType: "image/png",
      size: PNG.byteLength,
    });
    const got = await callRaw(a, "record_get", { recordId: assetId }, a.readPat);
    expect((await got.json<ToolResult>()).result?.structuredContent).toMatchObject({
      type: "asset",
      data: { filename: "spring.png", content_type: "image/png", width: 16, height: 8 },
    });
    expect(await firstHistory(a.tenantId, assetId)).toEqual({ via: "mcp", tokenId: a.writePatId });
  });

  it("許されない URL は url_not_allowed の業務エラーで、fetch を呼ばない", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const res = await callRaw(
      a,
      "asset_import_url",
      { url: "https://169.254.169.254/latest/meta-data/" },
      a.writePat,
    );
    const json = await res.json<ToolResult>();
    expect(json.result?.isError).toBe(true);
    expect(json.result?.structuredContent).toMatchObject({ error: { code: "url_not_allowed" } });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("record:read だけの PAT は入口で 403", async () => {
    const res = await callRaw(
      a,
      "asset_import_url",
      { url: "https://images.example.com/a.png" },
      a.readPat,
    );
    expect(res.status).toBe(403);
  });
});

// M5a-4(Review Focus 4): 発行後の失効と降格。どれも本文を読む前に 403 で、R2 に何も残らず、2 回目は 410
describe("アップロードの受け取りで発行に使ったトークンとロールを引き直す(M5a-4)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function expectRejected(t: Tenant, url: string, error: string): Promise<void> {
    const putSpy = vi.spyOn(TEST_ENV.ASSETS, "put");
    const res = await post(url, PNG);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error });
    expect(putSpy).not.toHaveBeenCalled();
    const listed = await env.ASSETS.list({ prefix: `${t.tenantId}/` });
    expect(listed.objects).toHaveLength(0);
    expect((await post(url, PNG)).status).toBe(410);
  }

  async function setRole(t: Tenant, role: "viewer" | "editor"): Promise<void> {
    await drizzle(env.DB)
      .update(memberships)
      .set({ role })
      .where(and(eq(memberships.userId, t.userId), eq(memberships.tenantId, t.tenantId)));
  }

  it("発行後に PAT を失効すると 403 token_revoked", async () => {
    const t = await setupTenant();
    const url = await issueUpload(t);
    expect(await revokePat(env.DB, t.tenantId, t.writePatId, new Date())).toBe(true);
    await expectRejected(t, url, "token_revoked");
  });

  it("発行後に PAT の期限が過ぎると 403 token_revoked", async () => {
    const t = await setupTenant();
    const url = await issueUpload(t);
    await drizzle(env.DB)
      .update(personalAccessTokens)
      .set({ expiresAt: new Date(Date.now() - 1000).toISOString() })
      .where(eq(personalAccessTokens.id, t.writePatId));
    await expectRejected(t, url, "token_revoked");
  });

  it("発行後にロールを viewer に下げると 403 forbidden で、本文を読まない", async () => {
    const t = await setupTenant();
    const url = await issueUpload(t);
    await setRole(t, "viewer");
    await expectRejected(t, url, "forbidden");
  });

  it("発行後に会員から外すと 403 token_revoked", async () => {
    const t = await setupTenant();
    const url = await issueUpload(t);
    await drizzle(env.DB)
      .delete(memberships)
      .where(and(eq(memberships.userId, t.userId), eq(memberships.tenantId, t.tenantId)));
    await expectRejected(t, url, "token_revoked");
  });

  // OAuth の受け取りは DO の createAssetUpload に McpAuth(tokenKind: oauth)を直接渡して発行する
  async function issueOauthUpload(tenantId: string, auth: McpAuth): Promise<string> {
    const token = generateSessionToken();
    const stub = env.TENANT_DO.get(env.TENANT_DO.idFromName(tenantId));
    const created = await stub.createAssetUpload(
      {
        tokenHash: await sha256Hex(token),
        filename: "o.png",
        contentType: "image/png",
        expiresAt: new Date(Date.now() + 600_000).toISOString(),
      },
      auth,
    );
    expect(created).toEqual({ ok: true });
    return `${ORIGIN}/mcp/t/${tenantId}/uploads/${token}`;
  }

  async function oauthTenant() {
    const t = await setupTenant();
    const testEnv = oauthEnv();
    const issued = await authorize(t.tenantId, ["record:read", "record:write"], {
      userId: t.userId,
      role: "editor",
      env: testEnv,
    });
    const grantId = issued.access_token.split(":")[1] ?? "";
    const auth: McpAuth = {
      userId: t.userId,
      role: "editor",
      tenantId: t.tenantId,
      scopes: ["record:read", "record:write"],
      tokenId: grantId,
      tokenKind: "oauth",
      exp: Math.floor(Date.now() / 1000) + 3600,
    };
    return { t, testEnv, grantId, auth, clientId: issued.clientId };
  }

  it("OAuth の付与が残っていれば受け取れ、履歴の tokenId はグラント ID", async () => {
    const { t, grantId, auth } = await oauthTenant();
    const url = await issueOauthUpload(t.tenantId, auth);
    const res = await post(url, PNG);
    expect(res.status, await res.clone().text()).toBe(201);
    const { assetId } = await res.json<{ assetId: string }>();
    expect(await firstHistory(t.tenantId, assetId)).toEqual({ via: "mcp", tokenId: grantId });
  });

  it("発行後に OAuth の付与を失効すると 403 token_revoked で、付与の確認は KV の get 1 回(list しない)", async () => {
    const { t, testEnv, grantId, auth } = await oauthTenant();
    const url = await issueOauthUpload(t.tenantId, auth);
    expect(await revokeTenantGrant(testEnv, t.tenantId, t.userId, grantId)).toBe(true);
    const getSpy = vi.spyOn(TEST_ENV.OAUTH_KV, "get");
    const listSpy = vi.spyOn(TEST_ENV.OAUTH_KV, "list");
    await expectRejected(t, url, "token_revoked");
    expect(getSpy.mock.calls.filter(([key]) => String(key).startsWith("grant:"))).toHaveLength(1);
    expect(listSpy).not.toHaveBeenCalled();
  });

  it("tokenId が clientId(grantId を取り出せなかった形)の OAuth で発行した受け取りは 403 token_revoked", async () => {
    const { t, auth, clientId } = await oauthTenant();
    const url = await issueOauthUpload(t.tenantId, { ...auth, tokenId: clientId });
    await expectRejected(t, url, "token_revoked");
  });
});
