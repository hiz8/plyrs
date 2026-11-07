import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { beforeAll, describe, expect, it } from "vitest";
import { memberships, tenants, users } from "@plyrs/db/control-plane";
import { issuePat } from "../src/auth/pat";
import { app } from "../src/index";
import { UNTRUSTED_PREFACE } from "../src/mcp/server";
import { articleType, auth, uuid, validArticleInput } from "./fixtures";
import { fakeLimiter } from "./rate-limit-helper";
import { asWriteResult } from "./rpc-unwrap";

// 16.8(M5c、決定 57): MCP に出す提案のツールと、提案への導線(PAT のスコープ不足の案内)

const ORIGIN = "https://api.example";
const CTX = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
const PROTOCOL = "2026-07-28";
const RECORD = uuid(850);

let tenantId: string;
let userId: string;
let proposePat: string;
let writePat: string;
let readPat: string;

async function issue(scopes: string[]): Promise<string> {
  return (
    await issuePat(
      env.DB,
      { userId, tenantId, name: "p", scopes: scopes as never, expiresInDays: 1 },
      new Date(),
    )
  ).token;
}

beforeAll(async () => {
  tenantId = crypto.randomUUID();
  userId = crypto.randomUUID();
  const now = new Date().toISOString();
  const db = drizzle(env.DB);
  await db
    .insert(tenants)
    .values({ id: tenantId, slug: `p-${tenantId}`, name: "P", createdAt: now });
  await db
    .insert(users)
    .values({ id: userId, email: `${userId}@example.com`, passwordHash: "h", createdAt: now });
  await db.insert(memberships).values({ userId, tenantId, role: "owner", createdAt: now });
  proposePat = await issue(["record:read", "record:propose"]);
  writePat = await issue(["record:read", "record:write"]);
  readPat = await issue(["record:read"]);
  const stub = env.TENANT_DO.get(env.TENANT_DO.idFromName(tenantId));
  const owner = { ...auth("owner", "owner"), tenantId };
  expect((await stub.registerContentType(articleType(), owner)).ok).toBe(true);
  expect(
    asWriteResult(
      await stub.writeRecord("article", { recordId: RECORD, input: validArticleInput() }, owner),
    ).ok,
  ).toBe(true);
});

async function rpc(method: string, params: Record<string, unknown>, token: string) {
  const res = await app.request(
    `${ORIGIN}/mcp/t/${tenantId}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": PROTOCOL,
        "mcp-method": method,
        ...(typeof params["name"] === "string" ? { "mcp-name": params["name"] } : {}),
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method,
        params: {
          ...params,
          _meta: {
            "io.modelcontextprotocol/protocolVersion": PROTOCOL,
            "io.modelcontextprotocol/clientCapabilities": {},
          },
        },
      }),
    },
    { ...env, MCP_LIMITER: fakeLimiter(true), MCP_IP_LIMITER: fakeLimiter(true) },
    CTX,
  );
  expect(res.status, await res.clone().text()).toBe(200);
  const json = await res.json<{ result?: Record<string, unknown>; error?: unknown }>();
  expect(json.error, JSON.stringify(json)).toBeUndefined();
  return json.result ?? {};
}

async function call(name: string, args: Record<string, unknown>, token: string) {
  return (await rpc("tools/call", { name, arguments: args }, token)) as {
    content: { type: string; text?: string }[];
    structuredContent?: Record<string, unknown>;
    isError?: boolean;
  };
}

describe("提案のツール(M5c)", () => {
  it("tools/list に proposal_create / list / get が record_unpublish の後・asset_upload の前に並び、accept / reject は出ない", async () => {
    const tools = (await rpc("tools/list", {}, readPat))["tools"] as Record<string, unknown>[];
    const names = tools.map((t) => t["name"]);
    const from = names.indexOf("record_unpublish");
    expect(names.slice(from, from + 5)).toEqual([
      "record_unpublish",
      "proposal_create",
      "proposal_list",
      "proposal_get",
      "asset_upload",
    ]);
    expect(names).not.toContain("proposal_accept");
    expect(names).not.toContain("proposal_reject");
  });

  it("record:propose の PAT の record_update は insufficient_scope で、message と details が proposal_create を案内する", async () => {
    const result = await call(
      "record_update",
      { recordId: RECORD, input: { title: "x" }, baseFieldVersions: {} },
      proposePat,
    );
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      error: {
        code: "insufficient_scope",
        details: { required: "record:write", tokenKind: "pat", alternative: "proposal_create" },
      },
    });
    expect(result.content[0]?.text).toContain("proposal_create");
    // record:propose の無い PAT には案内を付けない
    const plain = await call(
      "record_update",
      { recordId: RECORD, input: { title: "x" }, baseFieldVersions: {} },
      readPat,
    );
    expect(plain.structuredContent).toMatchObject({
      error: { code: "insufficient_scope", details: { required: "record:write" } },
    });
    const plainError = plain.structuredContent?.["error"] as Record<
      string,
      Record<string, unknown>
    >;
    expect(plainError["details"]?.["alternative"]).toBeUndefined();
    expect(plain.content[0]?.text).not.toContain("proposal_create");
  });

  it("record:propose の PAT で提案を作り、読める。本文は前置きで始まる。record:write だけの PAT は提案できない", async () => {
    const created = await call(
      "proposal_create",
      {
        proposalId: uuid(851),
        kind: "update",
        recordId: RECORD,
        input: { body: "## 見出し\n\n提案" },
        note: "見出しを足す",
      },
      proposePat,
    );
    expect(created.isError, JSON.stringify(created)).toBeUndefined();
    expect(created.content[0]?.text?.startsWith(UNTRUSTED_PREFACE)).toBe(true);
    expect(created.content[0]?.text).toContain(uuid(851));
    expect(created.structuredContent).toMatchObject({ id: uuid(851), state: "open" });
    expect(created.structuredContent?.["fields"]).toHaveLength(1);

    const got = await call("proposal_get", { proposalId: uuid(851) }, proposePat);
    expect(got.isError).toBeUndefined();
    expect(got.content[0]?.text?.startsWith(UNTRUSTED_PREFACE)).toBe(true);
    expect(got.content[0]?.text).toContain("open");

    const list = await call("proposal_list", { state: "open" }, proposePat);
    expect(list.isError).toBeUndefined();
    expect(list.content[0]?.text?.startsWith(UNTRUSTED_PREFACE)).toBe(true);
    expect(list.structuredContent?.["items"]).toHaveLength(1);

    const denied = await call(
      "proposal_create",
      { proposalId: uuid(852), kind: "update", recordId: RECORD, input: { title: "x" } },
      writePat,
    );
    expect(denied.structuredContent).toMatchObject({
      error: { code: "insufficient_scope", details: { required: "record:propose" } },
    });
  });
});
