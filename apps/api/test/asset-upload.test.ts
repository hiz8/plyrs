import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { ASSET_TYPE_KEY } from "@plyrs/metamodel";
import { app } from "../src/index";

// 共有ストレージ（--no-isolate）ではファイル間でも衝突しないよう、実行ごとのランダム接頭辞を混ぜる
// (既存 HTTP e2e テストの様式: content-types-list.test.ts / publish.test.ts の bootstrapTenant に合わせる)
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

describe("アセットのアップロードとプレビュー (Phase 8 裁定 1, 3)", () => {
  it("uploads a binary, creates the asset record, and stores the R2 object", async () => {
    const { tenantId, headers } = await setupTenant();
    const response = await app.request(
      `/v1/t/${tenantId}/assets?filename=hero.png`,
      { method: "POST", headers: { ...headers, "content-type": "image/png" }, body: PNG_HEADER },
      env,
    );
    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      ok: true;
      record: { id: string; type: string; data: Record<string, unknown> };
    };
    expect(body.record.type).toBe(ASSET_TYPE_KEY);
    expect(body.record.data["filename"]).toBe("hero.png");
    expect(body.record.data["content_type"]).toBe("image/png");
    expect(body.record.data["size"]).toBe(PNG_HEADER.byteLength);
    expect(body.record.data["width"]).toBe(800);
    expect(body.record.data["height"]).toBe(600);
    expect(body.record.data["r2_key"]).toBe(`${tenantId}/${body.record.id}`);

    const stored = await env.ASSETS.get(`${tenantId}/${body.record.id}`);
    expect(stored).not.toBeNull();
  });

  it("rejects a missing filename and an empty body", async () => {
    const { tenantId, headers } = await setupTenant();
    const noName = await app.request(
      `/v1/t/${tenantId}/assets`,
      { method: "POST", headers, body: PNG_HEADER },
      env,
    );
    expect(noName.status).toBe(400);
    const empty = await app.request(
      `/v1/t/${tenantId}/assets?filename=a.bin`,
      { method: "POST", headers, body: new Uint8Array(0) },
      env,
    );
    expect(empty.status).toBe(400);
  });

  it("rejects a body over the size limit with 413", async () => {
    const { tenantId, headers } = await setupTenant();
    const huge = new Uint8Array(20 * 1024 * 1024 + 1);
    const response = await app.request(
      `/v1/t/${tenantId}/assets?filename=big.bin`,
      { method: "POST", headers, body: huge },
      env,
    );
    expect(response.status).toBe(413);
  });

  it("serves the authenticated preview and 404s for unknown assets", async () => {
    const { tenantId, headers } = await setupTenant();
    const upload = await app.request(
      `/v1/t/${tenantId}/assets?filename=hero.png`,
      { method: "POST", headers: { ...headers, "content-type": "image/png" }, body: PNG_HEADER },
      env,
    );
    const { record } = (await upload.json()) as { record: { id: string } };

    const preview = await app.request(
      `/v1/t/${tenantId}/assets/${record.id}/file`,
      { headers },
      env,
    );
    expect(preview.status).toBe(200);
    expect(preview.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await preview.arrayBuffer())).toEqual(PNG_HEADER);

    const missing = await app.request(
      `/v1/t/${tenantId}/assets/018f2b6a-7a0a-7000-8000-00000000dead/file`,
      { headers },
      env,
    );
    expect(missing.status).toBe(404);
  });

  it("deletes the R2 object when the asset record is deleted over HTTP", async () => {
    const { tenantId, headers } = await setupTenant();
    const upload = await app.request(
      `/v1/t/${tenantId}/assets?filename=hero.png`,
      { method: "POST", headers: { ...headers, "content-type": "image/png" }, body: PNG_HEADER },
      env,
    );
    const { record } = (await upload.json()) as { record: { id: string } };

    const del = await app.request(
      `/v1/t/${tenantId}/records/${record.id}`,
      { method: "DELETE", headers },
      env,
    );
    expect(del.status).toBe(200);
    expect(await env.ASSETS.get(`${tenantId}/${record.id}`)).toBeNull();
  });
});
