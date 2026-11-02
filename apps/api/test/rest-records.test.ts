import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { v7 as uuidv7 } from "uuid";
import type { AuthContext } from "../src/do/authorize";
import type { RecordSnapshot } from "../src/do/types";
import { app } from "../src/index";
import { insertTenantWithOwner } from "./create-tenant";
import { articleType, validArticleInput } from "./fixtures";
import { fakeLimiter } from "./rate-limit-helper";

// 16.4 / 16.6(M2-7b): REST の record 書き込みは操作カタログ経由。更新は baseFieldVersions 必須

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
let owner: AuthContext;

beforeAll(async () => {
  const email = `rest-records-${RUN_ID}@example.com`;
  const signup = await app.request(
    "/auth/signup",
    json({ email, password: "hunter2hunter2" }),
    authEnv,
  );
  const { userId } = (await signup.json()) as { userId: string };
  const cookie = (signup.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  ({ tenantId } = await insertTenantWithOwner(userId, { slug: `rest-records-${RUN_ID}` }));
  const issued = await app.request("/auth/token", json({ tenantId }, { cookie }), authEnv);
  const { token } = (await issued.json()) as { token: string };
  headers = { authorization: `Bearer ${token}` };
  owner = { userId, role: "owner", tenantId };
  const stub = env.TENANT_DO.get(env.TENANT_DO.idFromName(tenantId));
  expect((await stub.registerContentType(articleType(), owner)).ok).toBe(true);
});

// slug は一意制約があるので record ごとに変える
let n = 0;
function input(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  n += 1;
  return { ...validArticleInput(), slug: `rest-${RUN_ID}-${n}`, ...overrides };
}

function put(recordId: string, body: unknown) {
  return app.request(
    `/v1/t/${tenantId}/records/article/${recordId}`,
    { ...json(body, headers), method: "PUT" },
    env,
  );
}

describe("PUT /v1/t/:tenantId/records/:typeKey/:recordId", () => {
  it("新規は baseFieldVersions 無しで 200(record_create)", async () => {
    const id = uuidv7();
    const created = await put(id, { input: input() });
    expect(created.status).toBe(200);
    const body = (await created.json()) as { ok: boolean; record: RecordSnapshot };
    expect(body.record).toMatchObject({ id, version: 1 });
  });

  it("既存の更新で baseFieldVersions が無い body は 400", async () => {
    const id = uuidv7();
    const first = input();
    expect((await put(id, { input: first })).status).toBe(200);
    const response = await put(id, { input: { ...first, title: "改題" } });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ ok: false, code: "invalid_input" });
  });

  it("古い baseFieldVersions は 409 conflict で details.current を持ち、現在値で再適用すると 200", async () => {
    const id = uuidv7();
    const first = input();
    const created = (await (await put(id, { input: first })).json()) as {
      record: RecordSnapshot;
    };
    // 人が先に直す
    const stub = env.TENANT_DO.get(env.TENANT_DO.idFromName(tenantId));
    await stub.writeRecord("article", { recordId: id, input: { ...first, title: "人" } }, owner);
    const stale = await put(id, {
      input: { title: "機械" },
      baseFieldVersions: created.record.fieldVersions,
    });
    expect(stale.status).toBe(409);
    const body = (await stale.json()) as {
      code: string;
      details: { conflicts: unknown[]; current: RecordSnapshot };
    };
    expect(body.code).toBe("conflict");
    expect(body.details.current.data["title"]).toBe("人");
    const fresh = await put(id, {
      input: { title: "機械" },
      baseFieldVersions: body.details.current.fieldVersions,
    });
    expect(fresh.status).toBe(200);
    expect(((await fresh.json()) as { record: RecordSnapshot }).record.data["title"]).toBe("機械");
  });

  it("DELETE は 200 で record を返し、2 回目も 200。削除済みへの PUT は 410", async () => {
    const id = uuidv7();
    const original = input();
    expect((await put(id, { input: original })).status).toBe(200);
    const first = await app.request(
      `/v1/t/${tenantId}/records/${id}`,
      { method: "DELETE", headers },
      env,
    );
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ ok: true, record: { id } });
    const second = await app.request(
      `/v1/t/${tenantId}/records/${id}`,
      { method: "DELETE", headers },
      env,
    );
    expect(second.status).toBe(200);
    const gone = await put(id, { input: original, baseFieldVersions: {} });
    expect(gone.status).toBe(410);
  });

  it("publish は 200 で snapshot を返し、同じ版の再 publish も 200", async () => {
    const id = uuidv7();
    expect((await put(id, { input: input() })).status).toBe(200);
    const published = await app.request(
      `/v1/t/${tenantId}/records/${id}/publish`,
      json({}, headers),
      env,
    );
    expect(published.status).toBe(200);
    expect(await published.json()).toMatchObject({
      ok: true,
      snapshot: { recordId: id, sourceVersion: 1 },
    });
    const again = await app.request(
      `/v1/t/${tenantId}/records/${id}/publish`,
      json({}, headers),
      env,
    );
    expect(again.status).toBe(200);
    const unknown = await app.request(
      `/v1/t/${tenantId}/records/${uuidv7()}/publish`,
      json({}, headers),
      env,
    );
    expect(unknown.status).toBe(404);
  });
});
