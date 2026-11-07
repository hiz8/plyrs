import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { beforeAll, describe, expect, it } from "vitest";
import { memberships, tenants, users } from "@plyrs/db/control-plane";
import { issuePat } from "../src/auth/pat";
import { app } from "../src/index";
import { articleType, auth, uuid, validArticleInput } from "./fixtures";
import { fakeLimiter } from "./rate-limit-helper";
import { asInvokeResult, asPublicationState, asWriteResult } from "./rpc-unwrap";

// M4-2(design-spec 16.8、決定 50): publish / unpublish の確認。elicitation を宣言するクライアントには
// MRTR の input_required で確認を求め、宣言しないクライアントは拒否して人に回す。requestState は HMAC で
// 保護し、テナント・利用者・トークンに束縛する

const ORIGIN = "https://api.example";
const CTX = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
const PROTOCOL = "2026-07-28";

let tenantId: string;
let userId: string;
let publishPat: string;
let otherPat: string;
let writePat: string;

async function issue(scopes: string[]): Promise<string> {
  return (
    await issuePat(
      env.DB,
      { userId, tenantId, name: "p", scopes: scopes as never, expiresInDays: 1 },
      new Date(),
    )
  ).token;
}

async function newRecord(n: number): Promise<string> {
  const recordId = uuid(n);
  const stub = env.TENANT_DO.get(env.TENANT_DO.idFromName(tenantId));
  const written = asWriteResult(
    await stub.writeRecord(
      "article",
      { recordId, input: { ...validArticleInput(), title: "春の記事\n二行目", slug: `s-${n}` } },
      { ...auth("owner", "owner"), tenantId },
    ),
  );
  expect(written.ok).toBe(true);
  return recordId;
}

beforeAll(async () => {
  tenantId = crypto.randomUUID();
  userId = crypto.randomUUID();
  const now = new Date().toISOString();
  const db = drizzle(env.DB);
  await db
    .insert(tenants)
    .values({ id: tenantId, slug: `c-${tenantId}`, name: "C", createdAt: now });
  await db
    .insert(users)
    .values({ id: userId, email: `${userId}@example.com`, passwordHash: "h", createdAt: now });
  await db.insert(memberships).values({ userId, tenantId, role: "owner", createdAt: now });
  publishPat = await issue(["record:read", "record:write", "record:publish"]);
  otherPat = await issue(["record:read", "record:write", "record:publish"]);
  writePat = await issue(["record:read", "record:write"]);
  const stub = env.TENANT_DO.get(env.TENANT_DO.idFromName(tenantId));
  expect(
    (await stub.registerContentType(articleType(), { ...auth("owner", "owner"), tenantId })).ok,
  ).toBe(true);
});

interface CallOptions {
  token?: string;
  elicitation?: boolean;
  retry?: { inputResponses: Record<string, unknown>; requestState: string };
}

async function callRaw(name: string, args: Record<string, unknown>, options: CallOptions = {}) {
  const body = {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: {
      name,
      arguments: args,
      ...options.retry,
      _meta: {
        "io.modelcontextprotocol/protocolVersion": PROTOCOL,
        "io.modelcontextprotocol/clientCapabilities":
          options.elicitation === true ? { elicitation: { form: {} } } : {},
      },
    },
  };
  return app.request(
    `${ORIGIN}/mcp/t/${tenantId}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": PROTOCOL,
        "mcp-method": "tools/call",
        "mcp-name": name,
        authorization: `Bearer ${options.token ?? publishPat}`,
      },
      body: JSON.stringify(body),
    },
    { ...env, MCP_LIMITER: fakeLimiter(true), MCP_IP_LIMITER: fakeLimiter(true) },
    CTX,
  );
}

type RpcResult = {
  result?: {
    isError?: boolean;
    resultType?: string;
    inputRequests?: Record<string, { method?: string; params?: { message?: string } }>;
    requestState?: string;
    structuredContent?: Record<string, unknown>;
  };
  error?: { code: number; message: string };
};

async function call(name: string, args: Record<string, unknown>, options: CallOptions = {}) {
  const res = await callRaw(name, args, options);
  expect(res.status, await res.clone().text()).toBe(200);
  return res.json<RpcResult>();
}

async function published(recordId: string): Promise<boolean> {
  const stub = env.TENANT_DO.get(env.TENANT_DO.idFromName(tenantId));
  return asPublicationState(await stub.getPublication(recordId)).published;
}

const accept = { confirm: { action: "accept", content: { confirm: true } } };

describe("publish の確認(MRTR の elicitation)", () => {
  it("elicitation を宣言しないクライアントは confirmation_unavailable で、公開されない", async () => {
    const recordId = await newRecord(901);
    const json = await call("record_publish", { recordId });
    expect(json.result?.isError).toBe(true);
    expect(json.result?.structuredContent).toMatchObject({
      error: { code: "confirmation_unavailable" },
    });
    expect(await published(recordId)).toBe(false);
  });

  it("宣言すると input_required で確認を求め、承諾を付けて送り直すと公開される", async () => {
    const recordId = await newRecord(902);
    const first = await call("record_publish", { recordId }, { elicitation: true });
    expect(first.result?.resultType).toBe("input_required");
    const message = first.result?.inputRequests?.["confirm"]?.params?.message ?? "";
    // 改行は空白に潰した record 名
    expect(message).toContain("「春の記事 二行目」");
    expect(message).toContain("公開しますか");
    const requestState = first.result?.requestState ?? "";
    expect(requestState).not.toBe("");
    expect(await published(recordId)).toBe(false);
    const second = await call(
      "record_publish",
      { recordId },
      { elicitation: true, retry: { inputResponses: accept, requestState } },
    );
    expect(second.result?.isError, JSON.stringify(second)).toBeUndefined();
    expect(second.result?.structuredContent).toMatchObject({ recordId });
    expect(await published(recordId)).toBe(true);
  });

  // M5a-6: フォームの初期値は true。照合は明示の confirm: true だけ(16.8 の人の確認を弱めない)
  it("requestedSchema の confirm は default: true", async () => {
    const recordId = await newRecord(910);
    const first = await call("record_publish", { recordId }, { elicitation: true });
    const params = first.result?.inputRequests?.["confirm"]?.params as
      | { requestedSchema?: { properties?: Record<string, Record<string, unknown>> } }
      | undefined;
    expect(params?.requestedSchema?.properties?.["confirm"]).toMatchObject({
      type: "boolean",
      default: true,
    });
  });

  for (const [label, content] of [
    ["confirm: false", { confirm: false }],
    ["confirm の欠けた", {}],
  ] as const) {
    it(`${label} Accept は declined で公開されない`, async () => {
      const recordId = await newRecord(label === "confirm: false" ? 911 : 912);
      const first = await call("record_publish", { recordId }, { elicitation: true });
      const second = await call(
        "record_publish",
        { recordId },
        {
          elicitation: true,
          retry: {
            inputResponses: { confirm: { action: "accept", content } },
            requestState: first.result?.requestState ?? "",
          },
        },
      );
      expect(second.result?.structuredContent).toMatchObject({ error: { code: "declined" } });
      expect(await published(recordId)).toBe(false);
    });
  }

  it("断ると declined で公開されない", async () => {
    const recordId = await newRecord(903);
    const first = await call("record_publish", { recordId }, { elicitation: true });
    const second = await call(
      "record_publish",
      { recordId },
      {
        elicitation: true,
        retry: {
          inputResponses: { confirm: { action: "decline" } },
          requestState: first.result?.requestState ?? "",
        },
      },
    );
    expect(second.result?.structuredContent).toMatchObject({ error: { code: "declined" } });
    expect(await published(recordId)).toBe(false);
  });

  it("別のトークンで requestState を流用すると拒否され、公開されない(Review Focus 2)", async () => {
    const recordId = await newRecord(904);
    const first = await call("record_publish", { recordId }, { elicitation: true });
    const json = await call(
      "record_publish",
      { recordId },
      {
        token: otherPat,
        elicitation: true,
        retry: { inputResponses: accept, requestState: first.result?.requestState ?? "" },
      },
    );
    expect(json.error?.code).toBe(-32602);
    expect(await published(recordId)).toBe(false);
  });

  it("別の record に付け替えると state_mismatch で、どちらも公開されない(Review Focus 2)", async () => {
    const a = await newRecord(905);
    const b = await newRecord(906);
    const first = await call("record_publish", { recordId: a }, { elicitation: true });
    const json = await call(
      "record_publish",
      { recordId: b },
      {
        elicitation: true,
        retry: { inputResponses: accept, requestState: first.result?.requestState ?? "" },
      },
    );
    expect(json.result?.structuredContent).toMatchObject({ error: { code: "state_mismatch" } });
    expect(await published(a)).toBe(false);
    expect(await published(b)).toBe(false);
  });

  it("確認の後に record が更新されると record_changed で、公開されない", async () => {
    const recordId = await newRecord(910);
    const first = await call("record_publish", { recordId }, { elicitation: true });
    const stub = env.TENANT_DO.get(env.TENANT_DO.idFromName(tenantId));
    const updated = asWriteResult(
      await stub.writeRecord(
        "article",
        {
          recordId,
          input: { ...validArticleInput(), title: "差し替えた記事", slug: "s-910" },
        },
        { ...auth("editor", "editor"), userId: "someone-else", tenantId },
      ),
    );
    expect(updated.ok, JSON.stringify(updated)).toBe(true);
    const json = await call(
      "record_publish",
      { recordId },
      {
        elicitation: true,
        retry: { inputResponses: accept, requestState: first.result?.requestState ?? "" },
      },
    );
    expect(json.result?.structuredContent).toMatchObject({ error: { code: "record_changed" } });
    expect(await published(recordId)).toBe(false);
  });

  it("公開した後に人が取り下げると、同じ確認の送り直しは record_changed で再公開されない", async () => {
    const recordId = await newRecord(911);
    const first = await call("record_publish", { recordId }, { elicitation: true });
    const retry = {
      elicitation: true,
      retry: { inputResponses: accept, requestState: first.result?.requestState ?? "" },
    };
    await call("record_publish", { recordId }, retry);
    expect(await published(recordId)).toBe(true);
    const stub = env.TENANT_DO.get(env.TENANT_DO.idFromName(tenantId));
    const unpublished = asInvokeResult(
      await stub.invoke("record_unpublish", { recordId }, { ...auth("owner", "owner"), tenantId }),
    );
    expect(unpublished.ok).toBe(true);
    expect(await published(recordId)).toBe(false);
    const json = await call("record_publish", { recordId }, retry);
    expect(json.result?.structuredContent).toMatchObject({ error: { code: "record_changed" } });
    expect(await published(recordId)).toBe(false);
  });

  it("改ざんした requestState は -32602", async () => {
    const recordId = await newRecord(907);
    const first = await call("record_publish", { recordId }, { elicitation: true });
    const state = first.result?.requestState ?? "";
    const tampered = `${state.slice(0, -2)}${state.endsWith("A") ? "B" : "A"}A`;
    const json = await call(
      "record_publish",
      { recordId },
      { elicitation: true, retry: { inputResponses: accept, requestState: tampered } },
    );
    expect(json.error?.code).toBe(-32602);
    expect(await published(recordId)).toBe(false);
  });

  it("record:publish の無い PAT は確認より前に入口で insufficient_scope の業務エラー(決定 55)", async () => {
    const recordId = await newRecord(908);
    const res = await callRaw(
      "record_publish",
      { recordId },
      { token: writePat, elicitation: true },
    );
    expect(res.status).toBe(200);
    const json = await res.json<{
      result?: { isError?: boolean; inputRequests?: unknown; structuredContent?: unknown };
    }>();
    expect(json.result?.isError).toBe(true);
    expect(json.result?.inputRequests).toBeUndefined();
    expect(json.result?.structuredContent).toMatchObject({
      error: { code: "insufficient_scope", details: { required: "record:publish" } },
    });
    expect(await published(recordId)).toBe(false);
  });

  it("unpublish も確認を通ってから取り下げる", async () => {
    const recordId = await newRecord(909);
    const first = await call("record_publish", { recordId }, { elicitation: true });
    await call(
      "record_publish",
      { recordId },
      {
        elicitation: true,
        retry: { inputResponses: accept, requestState: first.result?.requestState ?? "" },
      },
    );
    expect(await published(recordId)).toBe(true);
    const ask = await call("record_unpublish", { recordId }, { elicitation: true });
    expect(ask.result?.inputRequests?.["confirm"]?.params?.message).toContain("取り下げますか");
    await call(
      "record_unpublish",
      { recordId },
      {
        elicitation: true,
        retry: { inputResponses: accept, requestState: ask.result?.requestState ?? "" },
      },
    );
    expect(await published(recordId)).toBe(false);
  });
});
