import { env, runInDurableObject } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { beforeAll, describe, expect, it } from "vitest";
import { memberships, tenants, users } from "@plyrs/db/control-plane";
import { blockUser } from "../src/auth/blocklist";
import { issuePat } from "../src/auth/pat";
import { MAX_ASSET_SIZE_BYTES } from "../src/assets/store";
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
  readPat: string;
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
    (
      await issuePat(
        env.DB,
        { userId, tenantId, name: "p", scopes: scopes as never, expiresInDays: 1 },
        new Date(),
      )
    ).token;
  return {
    tenantId,
    userId,
    writePat: await issue(["record:read", "record:write"]),
    readPat: await issue(["record:read"]),
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
