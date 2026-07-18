import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { v7 as uuidv7 } from "uuid";
import { app } from "../src/index";
import { handleProjectionJob } from "../src/projection/consumer";
import { asProjectionPayload } from "../src/rpc-unwrap";
import { insertTenantWithOwner } from "./create-tenant";
import { fakeLimiter } from "./rate-limit-helper";

// §6: AUTH_LIMITER は本物の Miniflare シミュレート ratelimit(--no-isolate で全ファイル共有)。
// signup を叩く setupTenant はこの env を使う(素の env だと他テストの呼び出し数次第で 429 が混入する)。
const authEnv: Env = { ...env, AUTH_LIMITER: fakeLimiter(true) };

// 共有ストレージ（--no-isolate）ではファイル間でも衝突しないよう、実行ごとのランダム接頭辞を混ぜる
// (既存 HTTP e2e テストの様式: asset-projection.test.ts の setupTenant に合わせる)
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
// 作られた実 slug が必要(§12.7)。
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
  const { userId } = (await signup.json()) as { userId: string };
  const cookie = (signup.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  const { tenantId, slug: tenantSlug } = await insertTenantWithOwner(userId, {
    slug: unique("t-"),
  });
  const issued = await app.request("/auth/token", json({ tenantId }, { cookie }), authEnv);
  const { token } = (await issued.json()) as { token: string };
  return { tenantId, tenantSlug, headers: { authorization: `Bearer ${token}` } };
}

const PNG_HEADER = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x03, 0x20, 0x00, 0x00, 0x02, 0x58, 0x08, 0x06, 0x00, 0x00, 0x00,
]);

async function uploadAsset(
  tenantId: string,
  headers: { authorization: string },
  filename: string,
): Promise<{ assetId: string }> {
  const upload = await app.request(
    `/v1/t/${tenantId}/assets?filename=${filename}`,
    { method: "POST", headers: { ...headers, "content-type": "image/png" }, body: PNG_HEADER },
    env,
  );
  expect(upload.status).toBe(201);
  const { record } = (await upload.json()) as { record: { id: string } };
  return { assetId: record.id };
}

// HTTP publish → DO から投影ペイロードを取得 → handleProjectionJob で投影 D1 へ upsert
// (asset-projection.test.ts の projectRecord と同じ様式)。
async function publishAndProject(
  tenantId: string,
  tenantSlug: string,
  headers: { authorization: string },
  recordId: string,
): Promise<void> {
  const published = await app.request(
    `/v1/t/${tenantId}/records/${recordId}/publish`,
    { method: "POST", headers },
    env,
  );
  expect(published.status).toBe(200);

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

describe("公開アセット配信 (Phase 8 裁定 3: DO 非経由・公開ゲート付き)", () => {
  it("serves the binary for a published asset with hardening headers", async () => {
    const { tenantId, tenantSlug, headers } = await setupTenant();
    const { assetId } = await uploadAsset(tenantId, headers, "hero.png");
    // asset を直接 publish → 投影ジョブを処理
    await publishAndProject(tenantId, tenantSlug, headers, assetId);

    const response = await app.request(`/public/v1/${tenantSlug}/assets/${assetId}`, {}, env);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
    expect(response.headers.get("etag")).not.toBeNull();
    expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(0);
  });

  it("404s for an uploaded but unpublished asset (公開ゲート)", async () => {
    const { tenantId, tenantSlug, headers } = await setupTenant();
    const { assetId } = await uploadAsset(tenantId, headers, "hero.png");
    const response = await app.request(`/public/v1/${tenantSlug}/assets/${assetId}`, {}, env);
    expect(response.status).toBe(404);
  });

  it("404s for unknown tenants and malformed asset ids (D1/R2 を引く前に弾く)", async () => {
    const unknownTenant = await app.request(
      "/public/v1/no-such-tenant/assets/018f2b6a-7a0a-7000-8000-00000000dead",
      {},
      env,
    );
    expect(unknownTenant.status).toBe(404);
    const { tenantSlug } = await setupTenant();
    const badId = await app.request(`/public/v1/${tenantSlug}/assets/not-a-uuid`, {}, env);
    expect(badId.status).toBe(404);
  });

  // 最終レビュー指摘(important): r2_key のテナント所有権ガード。projected_records は
  // 投影パイプライン(handleProjectionJob)経由でしか書けないはずだが、投影ゲートは
  // 「行があるか」だけを見るため、data.r2_key の中身までは検証しない ―― ここでは投影 D1 に
  // 直接、他テナント接頭辞の r2_key を持つ行を播種して(このテナントの実バイナリが実在しない
  // ケースと違い、実際に foreign バイナリが R2 に存在する状況を再現する)、ownership.ts の
  // ガードが確実に効くことを確認する。
  it("404s when the projected r2_key does not belong to this tenant (ownership guard)", async () => {
    const { tenantId, tenantSlug } = await setupTenant();
    const assetId = uuidv7();
    const foreignR2Key = `${uuidv7()}/${uuidv7()}`;
    await env.PROJECTION_DB.prepare(
      `INSERT INTO projected_records
         (tenant_id, record_id, type, slug, published_at, data, source_version, projected_at, publish_seq)
       VALUES (?1, ?2, 'asset', NULL, ?3, ?4, 1, ?5, 1)`,
    )
      .bind(
        tenantId,
        assetId,
        new Date().toISOString(),
        JSON.stringify({ r2_key: foreignR2Key, content_type: "image/png" }),
        Date.now(),
      )
      .run();
    // foreign バイナリは実在する(他テナントの本物のオブジェクト) — それでも配信されないことを見る
    await env.ASSETS.put(foreignR2Key, Uint8Array.from([1, 2, 3]));

    const response = await app.request(`/public/v1/${tenantSlug}/assets/${assetId}`, {}, env);
    expect(response.status).toBe(404);
    expect(await env.ASSETS.get(foreignR2Key)).not.toBeNull();
  });
});
