import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { v7 as uuidv7 } from "uuid";
import { asAssetUsage, asOrphanIds, asRegisterResult, asWriteResult } from "../src/rpc-unwrap";
import type { AuthContext } from "../src/do/authorize";
import { app } from "../src/index";

const OWNER: AuthContext = { userId: "u-owner", role: "owner" };

function stub(name: string) {
  return env.TENANT_DO.get(env.TENANT_DO.idFromName(name));
}

const galleryType = {
  id: "018f2b6a-7a0a-7000-8000-00000000d001",
  key: "gallery",
  name: "ギャラリー",
  source: "user",
  version: 1,
  fields: [
    { key: "title", type: "text", required: true },
    {
      key: "images",
      type: "relation",
      config: { allowedTypes: ["asset"], cardinality: "many" },
    },
    { key: "body", type: "richtext" },
  ],
};

function assetInput(r2Key: string): Record<string, unknown> {
  return { filename: "a.png", content_type: "image/png", size: 10, r2_key: r2Key };
}

async function createAsset(tenant: ReturnType<typeof stub>): Promise<string> {
  const id = uuidv7();
  const result = asWriteResult(
    await tenant.createAssetRecord({ recordId: id, input: assetInput(`t/${id}`) }, OWNER),
  );
  expect(result.ok).toBe(true);
  return id;
}

// 共有ストレージ（--no-isolate）ではファイル間でも衝突しないよう、実行ごとのランダム接頭辞を混ぜる
// (既存 HTTP e2e テストの様式: asset-upload.test.ts の setupTenant に合わせる)
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

async function setupTenant(): Promise<{
  tenantId: string;
  headers: { authorization: string };
}> {
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
  return { tenantId, headers: { authorization: `Bearer ${token}` } };
}

const PNG_HEADER = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x03, 0x20, 0x00, 0x00, 0x02, 0x58, 0x08, 0x06, 0x00, 0x00, 0x00,
]);

describe("orphan 検出と使用箇所 (Phase 8 裁定 6 / design-spec §6)", () => {
  it("lists only assets with no inbound relations as orphans", async () => {
    const tenant = stub("asset-usage-orphans");
    asRegisterResult(await tenant.registerContentType(galleryType, OWNER));
    const used = await createAsset(tenant);
    const orphan = await createAsset(tenant);
    const galleryId = uuidv7();
    asWriteResult(
      await tenant.writeRecord(
        "gallery",
        { recordId: galleryId, input: { title: "G", images: [{ type: "asset", id: used }] } },
        OWNER,
      ),
    );
    const orphanIds = asOrphanIds(await tenant.listAssetOrphanIds());
    expect(orphanIds).toContain(orphan);
    expect(orphanIds).not.toContain(used);
  });

  it("counts body-origin references (画像ノード / mention) as usage", async () => {
    const tenant = stub("asset-usage-body");
    asRegisterResult(await tenant.registerContentType(galleryType, OWNER));
    const inBody = await createAsset(tenant);
    const galleryId = uuidv7();
    asWriteResult(
      await tenant.writeRecord(
        "gallery",
        {
          recordId: galleryId,
          input: {
            title: "G",
            body: {
              schemaVersion: 1,
              doc: {
                type: "doc",
                content: [
                  {
                    type: "assetImage",
                    attrs: { recordType: "asset", recordId: inBody, label: "a.png" },
                  },
                ],
              },
            },
          },
        },
        OWNER,
      ),
    );
    expect(asOrphanIds(await tenant.listAssetOrphanIds())).not.toContain(inBody);
    const usage = asAssetUsage(await tenant.listAssetUsage(inBody));
    expect(usage).toEqual([
      { sourceId: galleryId, sourceType: "gallery", sourceField: "body", origin: "body" },
    ]);
  });

  it("excludes deleted assets from the orphan list", async () => {
    const tenant = stub("asset-usage-deleted");
    const deleted = await createAsset(tenant);
    asWriteResult(await tenant.deleteRecord(deleted, OWNER));
    expect(asOrphanIds(await tenant.listAssetOrphanIds())).not.toContain(deleted);
  });

  it("serves orphan and usage over HTTP", async () => {
    const { tenantId, headers } = await setupTenant();

    const registered = await app.request(
      `/v1/t/${tenantId}/content-types`,
      {
        method: "PUT",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify(galleryType),
      },
      env,
    );
    expect(registered.status).toBe(200);

    const upload = await app.request(
      `/v1/t/${tenantId}/assets?filename=a.png`,
      { method: "POST", headers: { ...headers, "content-type": "image/png" }, body: PNG_HEADER },
      env,
    );
    expect(upload.status).toBe(201);
    const { record } = (await upload.json()) as { record: { id: string } };
    const assetId = record.id;

    const orphanBefore = await app.request(`/v1/t/${tenantId}/assets/orphans`, { headers }, env);
    expect(orphanBefore.status).toBe(200);
    const beforeBody = (await orphanBefore.json()) as { orphanIds: string[] };
    expect(beforeBody.orphanIds).toContain(assetId);

    const galleryId = uuidv7();
    const written = await app.request(
      `/v1/t/${tenantId}/records/gallery/${galleryId}`,
      {
        method: "PUT",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({
          input: { title: "G", images: [{ type: "asset", id: assetId }] },
        }),
      },
      env,
    );
    expect(written.status).toBe(200);

    const orphanAfter = await app.request(`/v1/t/${tenantId}/assets/orphans`, { headers }, env);
    expect(orphanAfter.status).toBe(200);
    const afterBody = (await orphanAfter.json()) as { orphanIds: string[] };
    expect(afterBody.orphanIds).not.toContain(assetId);

    const usageRes = await app.request(
      `/v1/t/${tenantId}/assets/${assetId}/usage`,
      { headers },
      env,
    );
    expect(usageRes.status).toBe(200);
    const usageBody = (await usageRes.json()) as {
      usage: { sourceId: string; sourceType: string | null; sourceField: string; origin: string }[];
    };
    expect(usageBody.usage).toEqual([
      { sourceId: galleryId, sourceType: "gallery", sourceField: "images", origin: "field" },
    ]);
  });
});
