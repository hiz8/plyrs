import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { app } from "../src/index";
import { insertTenantWithOwner } from "./create-tenant";
import { articleType, auth, uuid, validArticleInput } from "./fixtures";
import { authorType, postType, writeAndPublish } from "./public-helpers";
import { fakeLimiter } from "./rate-limit-helper";
import { asPublicationsPage } from "./rpc-unwrap";

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
  const { userId } = (await signup.json()) as { userId: string };
  const cookie = (signup.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  const { tenantId } = await insertTenantWithOwner(userId, { slug: unique("t-") });
  const issued = await app.request("/auth/token", json({ tenantId }, { cookie }), authEnv);
  const { token } = (await issued.json()) as { token: string };
  return { tenantId, bearer: `Bearer ${token}` };
}

async function putType(tenantId: string, bearer: string, type: unknown): Promise<void> {
  const res = await app.request(
    `/v1/t/${tenantId}/content-types`,
    {
      method: "PUT",
      headers: { "content-type": "application/json", authorization: bearer },
      body: JSON.stringify(type),
    },
    env,
  );
  expect(res.status).toBe(200);
}

async function writeRecord(
  tenantId: string,
  bearer: string,
  typeKey: string,
  recordId: string,
  slug: string,
): Promise<void> {
  const res = await app.request(
    `/v1/t/${tenantId}/records/${typeKey}/${recordId}`,
    {
      method: "PUT",
      headers: { "content-type": "application/json", authorization: bearer },
      body: JSON.stringify({ input: { ...validArticleInput(), slug } }),
    },
    env,
  );
  expect(res.status).toBe(200);
}

async function postAction(
  tenantId: string,
  bearer: string,
  recordId: string,
  action: "publish" | "unpublish",
): Promise<void> {
  const res = await app.request(
    `/v1/t/${tenantId}/records/${recordId}/${action}`,
    { method: "POST", headers: { authorization: bearer } },
    env,
  );
  expect(res.status).toBe(200);
}

async function getPublication(tenantId: string, bearer: string, recordId: string) {
  const res = await app.request(
    `/v1/t/${tenantId}/records/${recordId}/publication`,
    { headers: { authorization: bearer } },
    env,
  );
  expect(res.status).toBe(200);
  return (await res.json()) as { published: boolean; sourceVersion?: number };
}

interface PublicationsPage {
  publications: { recordId: string; publishedAt: string; sourceVersion: number }[];
  nextCursor: string | null;
}

async function listPublications(tenantId: string, bearer: string, query = "") {
  const res = await app.request(
    `/v1/t/${tenantId}/publications${query}`,
    { headers: { authorization: bearer } },
    env,
  );
  expect(res.status).toBe(200);
  return (await res.json()) as PublicationsPage;
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
    await putType(tenantId, bearer, articleType());
    const recordId = crypto.randomUUID();
    await writeRecord(tenantId, bearer, "article", recordId, "a");

    expect(await getPublication(tenantId, bearer, recordId)).toStrictEqual({ published: false });
    await postAction(tenantId, bearer, recordId, "publish");
    const state = await getPublication(tenantId, bearer, recordId);
    expect(state.published).toBe(true);
    expect(state.sourceVersion).toBe(1);
    await postAction(tenantId, bearer, recordId, "unpublish");
    expect(await getPublication(tenantId, bearer, recordId)).toStrictEqual({ published: false });
  });

  it("requires authentication", async () => {
    const { tenantId } = await bootstrapTenant();
    const res = await app.request(`/v1/t/${tenantId}/records/whatever/publication`, {}, env);
    expect(res.status).toBe(401);
  });
});

describe("GET /v1/t/:tenantId/publications (案 D 9 章)", () => {
  it("returns published records per type (or all types) without the snapshot body", async () => {
    const { tenantId, bearer } = await bootstrapTenant();
    await putType(tenantId, bearer, articleType());
    await putType(tenantId, bearer, {
      ...articleType(),
      id: crypto.randomUUID(),
      key: "news",
      name: "お知らせ",
    });
    const articleA = crypto.randomUUID();
    const articleB = crypto.randomUUID();
    const draft = crypto.randomUUID();
    const news = crypto.randomUUID();
    await writeRecord(tenantId, bearer, "article", articleA, "a");
    await writeRecord(tenantId, bearer, "article", articleB, "b");
    await writeRecord(tenantId, bearer, "article", draft, "draft");
    await writeRecord(tenantId, bearer, "news", news, "n");
    await postAction(tenantId, bearer, articleA, "publish");
    await postAction(tenantId, bearer, articleB, "publish");
    await postAction(tenantId, bearer, news, "publish");

    const articles = await listPublications(tenantId, bearer, "?type=article");
    expect(articles.nextCursor).toBeNull();
    expect(articles.publications.map((p) => p.recordId).toSorted()).toStrictEqual(
      [articleA, articleB].toSorted(),
    );
    for (const publication of articles.publications) {
      expect(Object.keys(publication).toSorted()).toStrictEqual([
        "publishedAt",
        "recordId",
        "sourceVersion",
      ]);
      expect(publication.sourceVersion).toBe(1);
      expect(Number.isNaN(Date.parse(publication.publishedAt))).toBe(false);
    }

    const all = await listPublications(tenantId, bearer);
    const allIds = all.publications.map((p) => p.recordId);
    expect(allIds.toSorted()).toStrictEqual([articleA, articleB, news].toSorted());
    // 並びは record_id の昇順(作成順の約束ではない)
    expect(allIds).toStrictEqual(allIds.toSorted());
    expect(await listPublications(tenantId, bearer, "?type=")).toStrictEqual(all);
  });

  it("pages with a record_id cursor and rejects a bad limit", async () => {
    const { tenantId, bearer } = await bootstrapTenant();
    await putType(tenantId, bearer, articleType());
    const ids = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
    for (const [i, id] of ids.entries()) {
      await writeRecord(tenantId, bearer, "article", id, `p${i}`);
      await postAction(tenantId, bearer, id, "publish");
    }
    const first = await listPublications(tenantId, bearer, "?type=article&limit=2");
    expect(first.publications).toHaveLength(2);
    expect(first.nextCursor).toBe(first.publications[1]?.recordId);
    const second = await listPublications(
      tenantId,
      bearer,
      `?type=article&limit=2&cursor=${first.nextCursor ?? ""}`,
    );
    expect(second.nextCursor).toBeNull();
    expect([...first.publications, ...second.publications].map((p) => p.recordId)).toStrictEqual(
      ids.toSorted(),
    );

    for (const limit of ["0", "1001", "abc"]) {
      const res = await app.request(
        `/v1/t/${tenantId}/publications?limit=${limit}`,
        { headers: { authorization: bearer } },
        env,
      );
      expect(res.status).toBe(400);
    }
  });

  it("drops a record after unpublish and returns an empty list for unknown types", async () => {
    const { tenantId, bearer } = await bootstrapTenant();
    await putType(tenantId, bearer, articleType());
    const recordId = crypto.randomUUID();
    await writeRecord(tenantId, bearer, "article", recordId, "x");
    await postAction(tenantId, bearer, recordId, "publish");
    const before = await listPublications(tenantId, bearer, "?type=article");
    expect(before.publications.map((p) => p.recordId)).toStrictEqual([recordId]);
    await postAction(tenantId, bearer, recordId, "unpublish");
    expect((await listPublications(tenantId, bearer, "?type=article")).publications).toStrictEqual(
      [],
    );
    expect((await listPublications(tenantId, bearer, "?type=nope")).publications).toStrictEqual([]);
  });

  it("requires authentication", async () => {
    const { tenantId } = await bootstrapTenant();
    const res = await app.request(`/v1/t/${tenantId}/publications`, {}, env);
    expect(res.status).toBe(401);
  });
});

describe("TenantDO.listPublications (案 D 9 章)", () => {
  it("treats an empty type as all types, same as the HTTP route", async () => {
    const tenantId = crypto.randomUUID();
    const stub = env.TENANT_DO.get(env.TENANT_DO.idFromName(tenantId));
    await stub.registerContentType(authorType(), auth("owner1"));
    await stub.registerContentType(postType(), auth("owner1"));
    await writeAndPublish(stub, tenantId, "author", uuid(470), { name: "著者" });
    await writeAndPublish(stub, tenantId, "post", uuid(471), {
      title: "記事",
      slug: "post",
      authors: [],
    });
    const all = asPublicationsPage(await stub.listPublications({ limit: 10 }));
    expect(all.publications.map((p) => p.recordId)).toStrictEqual([uuid(470), uuid(471)]);
    expect(asPublicationsPage(await stub.listPublications({ type: "", limit: 10 }))).toStrictEqual(
      all,
    );
    const posts = asPublicationsPage(await stub.listPublications({ type: "post", limit: 10 }));
    expect(posts.publications.map((p) => p.recordId)).toStrictEqual([uuid(471)]);
  });
});
