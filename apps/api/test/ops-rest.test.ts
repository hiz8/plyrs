import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { v7 as uuidv7 } from "uuid";
import type { AuthContext } from "../src/do/authorize";
import { app } from "../src/index";
import { asWriteResult } from "../src/rpc-unwrap";
import { insertTenantWithOwner } from "./create-tenant";
import { articleType, validArticleInput } from "./fixtures";
import { fakeLimiter } from "./rate-limit-helper";

// 16.4(M2-4): 操作カタログの REST の生成面 POST /v1/t/:tenantId/ops/:op

const authEnv: Env = { ...env, AUTH_LIMITER: fakeLimiter(true) };
const RUN_ID = crypto.randomUUID().slice(0, 8);

function json(body: unknown, headers: Record<string, string> = {}): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  };
}

let tenantId: string;
let headers: { authorization: string };
const recordId = uuidv7();

beforeAll(async () => {
  const email = `ops-rest-${RUN_ID}@example.com`;
  const signup = await app.request(
    "/auth/signup",
    json({ email, password: "hunter2hunter2" }),
    authEnv,
  );
  const { userId } = (await signup.json()) as { userId: string };
  const cookie = (signup.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  ({ tenantId } = await insertTenantWithOwner(userId, { slug: `ops-rest-${RUN_ID}` }));
  const issued = await app.request("/auth/token", json({ tenantId }, { cookie }), authEnv);
  const { token } = (await issued.json()) as { token: string };
  headers = { authorization: `Bearer ${token}` };
  const owner: AuthContext = { userId, role: "owner", tenantId };
  const stub = env.TENANT_DO.get(env.TENANT_DO.idFromName(tenantId));
  expect((await stub.registerContentType(articleType(), owner)).ok).toBe(true);
  expect(
    asWriteResult(
      await stub.writeRecord("article", { recordId, input: validArticleInput() }, owner),
    ).ok,
  ).toBe(true);
});

describe("POST /v1/t/:tenantId/ops/:op", () => {
  it("record_history を JWT で呼べる", async () => {
    const response = await app.request(
      `/v1/t/${tenantId}/ops/record_history`,
      json({ recordId }, headers),
      env,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      ok: boolean;
      output: { items: { kind: string; via: string }[] };
    };
    expect(body.ok).toBe(true);
    expect(body.output.items.map((i) => [i.kind, i.via])).toEqual([["write", "rest"]]);
  });

  it("type_list(via が mcp のみ)は 404", async () => {
    const response = await app.request(`/v1/t/${tenantId}/ops/type_list`, json({}, headers), env);
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ ok: false, code: "unknown_operation" });
  });

  it("不正な input は 400 と issues", async () => {
    const response = await app.request(
      `/v1/t/${tenantId}/ops/record_history`,
      json({ recordId: "not-a-uuid" }, headers),
      env,
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { ok: boolean; code: string; issues: unknown[] };
    expect(body).toMatchObject({ ok: false, code: "invalid_input" });
    expect(body.issues.length).toBeGreaterThan(0);
  });

  it("record_restore を REST から呼べ、無い版は 404", async () => {
    const response = await app.request(
      `/v1/t/${tenantId}/ops/record_restore`,
      json({ recordId, historySeq: 1 }, headers),
      env,
    );
    expect(response.status).toBe(200);
    const missing = await app.request(
      `/v1/t/${tenantId}/ops/record_restore`,
      json({ recordId, historySeq: 42 }, headers),
      env,
    );
    expect(missing.status).toBe(404);
  });

  it("認証なしは 401", async () => {
    const response = await app.request(
      `/v1/t/${tenantId}/ops/record_history`,
      json({ recordId }),
      env,
    );
    expect(response.status).toBe(401);
  });
});
