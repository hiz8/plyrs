import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { v7 as uuidv7 } from "uuid";
import { app } from "../src/index";
import { handleProjectionJob } from "../src/projection/consumer";
import { asProjectionPayload } from "../src/rpc-unwrap";
import { fakeLimiter } from "./rate-limit-helper";

// §6: AUTH_LIMITER は本物の Miniflare シミュレート ratelimit(--no-isolate で全ファイル共有)。
// signup を叩く setupTenant はこの env を使う(素の env だと他テストの呼び出し数次第で 429 が混入する)。
const authEnv: Env = { ...env, AUTH_LIMITER: fakeLimiter(true) };

// 共有ストレージ（--no-isolate）ではファイル間でも衝突しないよう、実行ごとのランダム接頭辞を混ぜる
// (既存 HTTP e2e テストの様式: asset-upload.test.ts / content-types-list.test.ts の
// setupTenant/bootstrapTenant に合わせる)
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

// 公開 API のテナント解決は KV/コントロールプレーン D1 を引くため、実 HTTP ブートストラップで
// 作られた実 slug が必要(§12.7)。publish も同じテナントの HTTP ルートを通すことで、
// 凍結 embed URL(/public/v1/:slug/...)が実際の slug と一致する(routes/tenant.ts の
// POST /:tenantId/records/:recordId/publish がコントロールプレーン D1 から slug を引く)。
async function setupTenant(): Promise<{
  tenantId: string;
  tenantSlug: string;
  headers: { authorization: string };
}> {
  const email = `${unique("owner")}@example.com`;
  const signup = await app.request(
    "/auth/signup",
    json({ email, password: "hunter2hunter2" }),
    authEnv,
  );
  const cookie = (signup.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  const tenantSlug = unique("t-");
  const created = await app.request(
    "/v1/tenants",
    json({ name: "T", slug: tenantSlug }, { cookie }),
    authEnv,
  );
  const { tenantId } = (await created.json()) as { tenantId: string };
  const issued = await app.request("/auth/token", json({ tenantId }, { cookie }), authEnv);
  const { token } = (await issued.json()) as { token: string };
  return { tenantId, tenantSlug, headers: { authorization: `Bearer ${token}` } };
}

const PNG_HEADER = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x03, 0x20, 0x00, 0x00, 0x02, 0x58, 0x08, 0x06, 0x00, 0x00, 0x00,
]);

// 型 id は HTTP 経由の登録でも contentTypeDefinitionSchema が要求する(uuid 必須)。
// 実 UUID である必要はなく、テナントごとに独立した DO なので固定値の使い回しで問題ない
// (publish.test.ts の mediaArticleType と同じ様式)。
function mediaArticleType(): Record<string, unknown> {
  return {
    id: "018f2b6a-7a0a-7000-8000-00000000c001",
    key: "media_article",
    name: "メディア記事",
    source: "user",
    version: 1,
    fields: [
      { key: "title", type: "text", required: true },
      {
        key: "hero",
        type: "relation",
        config: { allowedTypes: ["asset"], cardinality: "one", snapshotEmbed: "value" },
      },
    ],
  };
}

// snapshotEmbed 未宣言の関係フィールドを持つ型(後方互換の回帰確認用)
function plainArticleType(): Record<string, unknown> {
  return {
    id: "018f2b6a-7a0a-7000-8000-00000000c002",
    key: "plain_article",
    name: "プレーン記事",
    source: "user",
    version: 1,
    fields: [
      { key: "title", type: "text", required: true },
      {
        key: "hero",
        type: "relation",
        config: { allowedTypes: ["asset"], cardinality: "one" },
      },
    ],
  };
}

// アセットをアップロードし、alt / width / height が凍結対象として揃った状態にして返す
// (アップロード API は alt を受け付けないため、ユーザー編集可フィールドとして
// 汎用の書き込みルートで追記する — asset-guard.test.ts が検証済みの規約)。
async function uploadAssetWithAlt(
  tenantId: string,
  headers: { authorization: string },
): Promise<string> {
  const upload = await app.request(
    `/v1/t/${tenantId}/assets?filename=hero.png`,
    { method: "POST", headers: { ...headers, "content-type": "image/png" }, body: PNG_HEADER },
    env,
  );
  expect(upload.status).toBe(201);
  const { record } = (await upload.json()) as {
    record: { id: string; data: Record<string, unknown> };
  };
  const assetId = record.id;
  const patched = await app.request(
    `/v1/t/${tenantId}/records/asset/${assetId}`,
    {
      method: "PUT",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({
        input: {
          filename: record.data["filename"],
          content_type: record.data["content_type"],
          size: record.data["size"],
          r2_key: record.data["r2_key"],
          width: record.data["width"],
          height: record.data["height"],
          alt: "ヒーロー",
        },
      }),
    },
    env,
  );
  expect(patched.status).toBe(200);
  return assetId;
}

async function projectRecord(tenantId: string, recordId: string): Promise<void> {
  const stub = env.TENANT_DO.get(env.TENANT_DO.idFromName(tenantId));
  const payload = asProjectionPayload(await stub.getProjectionPayload(recordId));
  if (payload === null) {
    throw new Error("expected a projection payload");
  }
  await handleProjectionJob(
    env,
    {
      jobType: "upsert",
      tenantId,
      recordId,
      sourceVersion: payload.sourceVersion,
      publishSeq: payload.publishSeq,
    },
    Date.now(),
  );
}

describe("embed の投影と公開 API (Phase 8 裁定 4)", () => {
  it("projects the frozen embed and serves it inline on the public API", async () => {
    const { tenantId, tenantSlug, headers } = await setupTenant();

    const registered = await app.request(
      `/v1/t/${tenantId}/content-types`,
      {
        method: "PUT",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify(mediaArticleType()),
      },
      env,
    );
    expect(registered.status).toBe(200);

    const assetId = await uploadAssetWithAlt(tenantId, headers);

    const articleId = uuidv7();
    const written = await app.request(
      `/v1/t/${tenantId}/records/media_article/${articleId}`,
      {
        method: "PUT",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({
          input: { title: "記事", hero: { type: "asset", id: assetId } },
        }),
      },
      env,
    );
    expect(written.status).toBe(200);

    const published = await app.request(
      `/v1/t/${tenantId}/records/${articleId}/publish`,
      { method: "POST", headers },
      env,
    );
    expect(published.status).toBe(200);

    // カスケードで asset も同じトランザクションで publish 済み(Task 6)。両方の
    // upsert ジョブを投影 D1 へ反映する。
    await projectRecord(tenantId, assetId);
    await projectRecord(tenantId, articleId);

    const single = await app.request(
      `/public/v1/${tenantSlug}/records/media_article/${articleId}`,
      {},
      env,
    );
    expect(single.status).toBe(200);
    const body = (await single.json()) as { fields: Record<string, unknown> };
    expect(body.fields["hero"]).toEqual([
      {
        id: assetId,
        url: `/public/v1/${tenantSlug}/assets/${assetId}`,
        filename: "hero.png",
        contentType: "image/png",
        alt: "ヒーロー",
        width: 800,
        height: 600,
      },
    ]);

    // include=hero でも fields の形は変わらない(include は included[] の同梱だけを制御)
    const withInclude = await app.request(
      `/public/v1/${tenantSlug}/records/media_article/${articleId}?include=hero`,
      {},
      env,
    );
    expect(withInclude.status).toBe(200);
    const includedBody = (await withInclude.json()) as {
      fields: Record<string, unknown>;
      included: { id: string; type: string }[];
    };
    expect(includedBody.fields["hero"]).toEqual(body.fields["hero"]);
    expect(includedBody.included).toHaveLength(1);
    expect(includedBody.included[0]).toMatchObject({ id: assetId, type: "asset" });
  });

  it("keeps plain id arrays for relations without snapshotEmbed value", async () => {
    const { tenantId, tenantSlug, headers } = await setupTenant();

    const registered = await app.request(
      `/v1/t/${tenantId}/content-types`,
      {
        method: "PUT",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify(plainArticleType()),
      },
      env,
    );
    expect(registered.status).toBe(200);

    const assetId = await uploadAssetWithAlt(tenantId, headers);

    const articleId = uuidv7();
    const written = await app.request(
      `/v1/t/${tenantId}/records/plain_article/${articleId}`,
      {
        method: "PUT",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({
          input: { title: "記事", hero: { type: "asset", id: assetId } },
        }),
      },
      env,
    );
    expect(written.status).toBe(200);

    const published = await app.request(
      `/v1/t/${tenantId}/records/${articleId}/publish`,
      { method: "POST", headers },
      env,
    );
    expect(published.status).toBe(200);

    await projectRecord(tenantId, assetId);
    await projectRecord(tenantId, articleId);

    const single = await app.request(
      `/public/v1/${tenantSlug}/records/plain_article/${articleId}`,
      {},
      env,
    );
    expect(single.status).toBe(200);
    const body = (await single.json()) as { fields: Record<string, unknown> };
    expect(body.fields["hero"]).toEqual([assetId]);
  });
});
