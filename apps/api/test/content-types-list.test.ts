import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { app } from "../src/index";
import { articleType, validArticleInput } from "./fixtures";

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
    env,
  );
  const cookie = (signup.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  const created = await app.request(
    "/v1/tenants",
    json({ name: "T", slug: unique("t-") }, { cookie }),
    env,
  );
  const { tenantId } = (await created.json()) as { tenantId: string };
  const issued = await app.request("/auth/token", json({ tenantId }, { cookie }), env);
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
    expect(contentTypes.map((t) => t.key)).toStrictEqual(["article"]);
    expect(contentTypes[0]?.version).toBe(1);
  });

  it("returns an empty list for a fresh tenant", async () => {
    const { tenantId, bearer } = await bootstrapTenant();
    const res = await app.request(
      `/v1/t/${tenantId}/content-types`,
      { headers: { authorization: bearer } },
      env,
    );
    expect(res.status).toBe(200);
    const { contentTypes } = (await res.json()) as { contentTypes: unknown[] };
    expect(contentTypes).toStrictEqual([]);
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
