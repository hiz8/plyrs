import { env, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { v7 as uuidv7 } from "uuid";
import { app } from "../src/index";
import { fakeLimiter } from "./rate-limit-helper";

// 最終レビュー指摘(important, merge blocker): r2_key のテナント所有権ガード。
//
// 再現したい実テナント状態は「Phase 8 デプロイ以前から key='asset' のユーザー型を持つ
// テナント」(ensure-asset-type.ts の分岐コメント参照)。この状態では assetGuardHook が
// 完全に不発になり(source !== 'system' のため)、クライアントが任意の r2_key を書き込める。
//
// この状態は公開 API からは再現できない: DO 構築(blockConcurrencyWhile 内)は必ず
// ensureAssetContentType を先に走らせ、既存の key='asset' 行が無ければ system 型を
// 即座に確保してしまう。既存テストの様式(content-types.test.ts / smoke.test.ts の
// runInDurableObject + 直接 SQL)にならい、構築済み DO の content_types 行を直接
// 書き換えて legacy 状態を模擬したうえで、以降は通常の HTTP 経路だけを叩く。
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

// §6: AUTH_LIMITER は本物の Miniflare シミュレート ratelimit(--no-isolate で全ファイル共有)。
// signup を叩く setupTenant はこの env を使う(素の env だと他テストの呼び出し数次第で 429 が混入する)。
const authEnv: Env = { ...env, AUTH_LIMITER: fakeLimiter(true) };

async function setupTenant(): Promise<{
  tenantId: string;
  headers: { authorization: string };
}> {
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
  return { tenantId, headers: { authorization: `Bearer ${token}` } };
}

// system 型として自動登録済みの 'asset' 行を、無関係な user 型の行へ直接差し替える。
// source が 'system' でなくなることで assetGuardHook が完全に不発になる(ensure-asset-type.ts
// の分岐が守ろうとしている、Phase 8 以前からのテナントと同じ形)。
async function downgradeAssetTypeToLegacyUserType(tenantId: string): Promise<void> {
  const stub = env.TENANT_DO.get(env.TENANT_DO.idFromName(tenantId));
  await stub.ping(); // DO を構築済みにする(system 型の自動登録を先に完了させる)
  await runInDurableObject(stub, async (_instance, state) => {
    state.storage.sql.exec(
      "UPDATE content_types SET id = ?, source = 'user', fields = '[]' WHERE key = 'asset'",
      uuidv7(),
    );
  });
}

async function writeForeignAsset(
  tenantId: string,
  headers: { authorization: string },
  recordId: string,
  foreignR2Key: string,
): Promise<void> {
  const write = await app.request(
    `/v1/t/${tenantId}/records/asset/${recordId}`,
    { ...json({ input: { r2_key: foreignR2Key } }, headers), method: "PUT" },
    env,
  );
  // legacy user 型では assetGuardHook が働かないため、通常なら forbidden になる
  // r2_key の新規書き込みがそのまま通ってしまう ―― これが最終レビュー指摘の前提そのもの。
  expect(write.status).toBe(200);
}

describe("r2_key のテナント所有権ガード (最終レビュー指摘)", () => {
  it("認証付きプレビュー配信: 他テナント接頭辞の r2_key は 404", async () => {
    const { tenantId, headers } = await setupTenant();
    await downgradeAssetTypeToLegacyUserType(tenantId);

    const recordId = uuidv7();
    const foreignR2Key = `${uuidv7()}/${uuidv7()}`;
    await writeForeignAsset(tenantId, headers, recordId, foreignR2Key);
    await env.ASSETS.put(foreignR2Key, Uint8Array.from([9, 9, 9]));

    const preview = await app.request(
      `/v1/t/${tenantId}/assets/${recordId}/file`,
      { headers },
      env,
    );
    expect(preview.status).toBe(404);
  });

  it("DELETE の R2 片付け: 他テナント接頭辞の r2_key は削除されない", async () => {
    const { tenantId, headers } = await setupTenant();
    await downgradeAssetTypeToLegacyUserType(tenantId);

    const recordId = uuidv7();
    const foreignR2Key = `${uuidv7()}/${uuidv7()}`;
    await writeForeignAsset(tenantId, headers, recordId, foreignR2Key);
    await env.ASSETS.put(foreignR2Key, Uint8Array.from([9, 9, 9]));

    const del = await app.request(
      `/v1/t/${tenantId}/records/${recordId}`,
      { method: "DELETE", headers },
      env,
    );
    // レコード削除自体は成立する(ガードが止めるのは R2 側の片付けだけ)
    expect(del.status).toBe(200);
    expect(await env.ASSETS.get(foreignR2Key)).not.toBeNull();
  });
});
