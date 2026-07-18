import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { app } from "../src/index";
import { articleType, validArticleInput } from "./fixtures";
import { fakeLimiter } from "./rate-limit-helper";

// §6: AUTH_LIMITER は本物の Miniflare シミュレート ratelimit(--no-isolate で全ファイル共有)。
// signup を叩く bootstrapTenant はこの env を使う(素の env だと他テストの呼び出し数次第で 429 が混入する)。
const authEnv: Env = { ...env, AUTH_LIMITER: fakeLimiter(true) };

// 共有ストレージ（--no-isolate）ではファイル間でも衝突しないよう、実行ごとのランダム接頭辞を混ぜる
const RUN_ID = crypto.randomUUID().slice(0, 8);
let n = 0;
function unique(prefix: string): string {
  n += 1;
  return `${prefix}${RUN_ID}-${n}`;
}

function json(body: unknown, headers: Record<string, string> = {}): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  };
}

async function bootstrapTenant(): Promise<{ tenantId: string; bearer: string }> {
  const email = `${unique("owner")}@example.com`;
  const signup = await app.request(
    "/auth/signup",
    json({ email, password: "hunter2hunter2" }),
    authEnv,
  );
  const cookie = (signup.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  const created = await app.request(
    "/v1/tenants",
    json({ name: "T", slug: unique("t-") }, { cookie }),
    authEnv,
  );
  const { tenantId } = (await created.json()) as { tenantId: string };
  const issued = await app.request("/auth/token", json({ tenantId }, { cookie }), authEnv);
  const { token } = (await issued.json()) as { token: string };
  return { tenantId, bearer: `Bearer ${token}` };
}

describe("GET /v1/t/:tenantId/content-types (Phase 6a)", () => {
  it("returns registered types to authenticated members", async () => {
    const { tenantId, bearer } = await bootstrapTenant();
    const put = await app.request(
      `/v1/t/${tenantId}/content-types`,
      {
        method: "PUT",
        headers: { "content-type": "application/json", authorization: bearer },
        body: JSON.stringify(articleType()),
      },
      env,
    );
    expect(put.status).toBe(200);
    const res = await app.request(
      `/v1/t/${tenantId}/content-types`,
      { headers: { authorization: bearer } },
      env,
    );
    expect(res.status).toBe(200);
    const { contentTypes } = (await res.json()) as {
      contentTypes: { key: string; name: string; version: number }[];
    };
    // Phase 8 裁定 2: asset はシステム型として全テナントに自動登録される(key 昇順で article の次)
    expect(contentTypes.map((t) => t.key)).toStrictEqual(["article", "asset"]);
    expect(contentTypes[0]?.version).toBe(1);
  });

  it("returns only the system asset type for a fresh tenant", async () => {
    const { tenantId, bearer } = await bootstrapTenant();
    const res = await app.request(
      `/v1/t/${tenantId}/content-types`,
      { headers: { authorization: bearer } },
      env,
    );
    expect(res.status).toBe(200);
    const { contentTypes } = (await res.json()) as {
      contentTypes: { key: string; source: string }[];
    };
    // Phase 8 裁定 2: 新規テナントも DO 構築時にシステム asset 型が自動登録される
    expect(contentTypes.map((t) => t.key)).toStrictEqual(["asset"]);
    expect(contentTypes[0]?.source).toBe("system");
  });

  it("rejects unauthenticated listing (first-stage gate)", async () => {
    const { tenantId } = await bootstrapTenant();
    const res = await app.request(`/v1/t/${tenantId}/content-types`, {}, env);
    expect(res.status).toBe(401);
  });
});

describe("GET /v1/t/:tenantId/records/:recordId/publication (Phase 6b)", () => {
  it("reflects publish and unpublish", async () => {
    const { tenantId, bearer } = await bootstrapTenant();
    await app.request(
      `/v1/t/${tenantId}/content-types`,
      {
        method: "PUT",
        headers: { "content-type": "application/json", authorization: bearer },
        body: JSON.stringify(articleType()),
      },
      env,
    );
    const recordId = crypto.randomUUID();
    const written = await app.request(
      `/v1/t/${tenantId}/records/article/${recordId}`,
      {
        method: "PUT",
        headers: { "content-type": "application/json", authorization: bearer },
        body: JSON.stringify({ input: validArticleInput() }),
      },
      env,
    );
    expect(written.status).toBe(200);

    const before = await app.request(
      `/v1/t/${tenantId}/records/${recordId}/publication`,
      { headers: { authorization: bearer } },
      env,
    );
    expect(before.status).toBe(200);
    expect(await before.json()).toStrictEqual({ published: false });

    const published = await app.request(
      `/v1/t/${tenantId}/records/${recordId}/publish`,
      { method: "POST", headers: { authorization: bearer } },
      env,
    );
    expect(published.status).toBe(200);

    const after = await app.request(
      `/v1/t/${tenantId}/records/${recordId}/publication`,
      { headers: { authorization: bearer } },
      env,
    );
    const state = (await after.json()) as { published: boolean; sourceVersion?: number };
    expect(state.published).toBe(true);
    expect(state.sourceVersion).toBe(1);

    const unpublished = await app.request(
      `/v1/t/${tenantId}/records/${recordId}/unpublish`,
      { method: "POST", headers: { authorization: bearer } },
      env,
    );
    expect(unpublished.status).toBe(200);

    const final = await app.request(
      `/v1/t/${tenantId}/records/${recordId}/publication`,
      { headers: { authorization: bearer } },
      env,
    );
    expect(final.status).toBe(200);
    expect(await final.json()).toStrictEqual({ published: false });
  });

  it("requires authentication", async () => {
    const { tenantId } = await bootstrapTenant();
    const res = await app.request(`/v1/t/${tenantId}/records/whatever/publication`, {}, env);
    expect(res.status).toBe(401);
  });
});
