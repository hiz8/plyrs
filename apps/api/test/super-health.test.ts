import { env, runInDurableObject } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { afterEach, describe, expect, it } from "vitest";
import { v7 as uuidv7 } from "uuid";
import { auditLogs } from "@plyrs/db/control-plane";
import { app } from "../src/index";
import { articleType, auth, validArticleInput } from "./fixtures";
import { resetSuperAdmins, superEnv, superLogin } from "./super-login";
import { asPublishResult, asWriteResult } from "./rpc-unwrap";

afterEach(resetSuperAdmins);

function jsonReq(method: string, path: string, cookie: string, body?: unknown): Request {
  return new Request(`https://api.test${path}`, {
    method,
    headers: { "content-type": "application/json", cookie },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe("tenant health check", () => {
  it("reports archived-published, legacy asset type and legacy richtext", async () => {
    const tenantId = crypto.randomUUID();
    const stub = env.TENANT_DO.get(env.TENANT_DO.idFromName(tenantId));
    const recordId = uuidv7();

    const registered = await stub.registerContentType(articleType(), auth("owner1"));
    expect(registered.ok).toBe(true);

    const written = asWriteResult(
      await stub.writeRecord("article", { recordId, input: validArticleInput() }, auth("owner1")),
    );
    expect(written.ok).toBe(true);

    const published = asPublishResult(
      await stub.publishRecord(tenantId, tenantId, recordId, auth("owner1")),
    );
    expect(published.ok).toBe(true);

    // status を archived へ(公開は publish 時点の凍結スナップショットなので影響を受けない — §7)
    const archived = asWriteResult(
      await stub.writeRecord(
        "article",
        { recordId, input: validArticleInput(), status: "archived" },
        auth("owner1"),
      ),
    );
    expect(archived.ok).toBe(true);

    // asset-ownership.test.ts と同じ様式: system 型として自動登録済みの 'asset' 行を
    // 無関係な user 型の行へ直接差し替える(Phase 8 以前からのテナントを模擬)。
    // さらに article record の richtext フィールド(body)を旧形式(非構造の生文字列)へ直接書き換える。
    await runInDurableObject(stub, async (_instance, state) => {
      state.storage.sql.exec(
        "UPDATE content_types SET id = ?, source = 'user', fields = '[]' WHERE key = 'asset'",
        uuidv7(),
      );
      const row = state.storage.sql
        .exec<{ data: string }>("SELECT data FROM records WHERE id = ?", recordId)
        .toArray()[0];
      const data = JSON.parse(row?.data ?? "{}") as Record<string, unknown>;
      data["body"] = "plain string";
      state.storage.sql.exec(
        "UPDATE records SET data = ? WHERE id = ?",
        JSON.stringify(data),
        recordId,
      );
    });

    const { cookie } = await superLogin();
    const res = await app.request(
      `/super/v1/tenants/${tenantId}/health`,
      { headers: { cookie } },
      superEnv(),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      archivedPublished: { recordId: string; type: string; publishedAt: string }[];
      legacyAssetType: boolean;
      legacyRichtextRecords: { recordId: string; type: string; fieldKey: string }[];
    };
    expect(body.archivedPublished).toContainEqual(
      expect.objectContaining({ recordId, type: "article" }),
    );
    expect(body.legacyAssetType).toBe(true);
    expect(body.legacyRichtextRecords).toContainEqual({
      recordId,
      type: "article",
      fieldKey: "body",
    });
  });
});

describe("orphan R2 asset detection", () => {
  it("detects and deletes orphan R2 binaries but refuses referenced or foreign keys", async () => {
    const tenantId = crypto.randomUUID();
    const otherTenantId = crypto.randomUUID();
    const stub = env.TENANT_DO.get(env.TENANT_DO.idFromName(tenantId));

    // 参照済み asset: アップロード経路と同じ規約(r2_key = `${tenantId}/${assetId}`)で
    // createAssetRecord RPC + ASSETS.put を直接叩く(routes/tenant.ts の POST /assets と同型)。
    const assetId = uuidv7();
    const referencedKey = `${tenantId}/${assetId}`;
    await env.ASSETS.put(referencedKey, Uint8Array.from([1, 2, 3]));
    const created = asWriteResult(
      await stub.createAssetRecord(
        {
          recordId: assetId,
          input: { filename: "a.png", content_type: "image/png", size: 3, r2_key: referencedKey },
        },
        auth("owner1"),
      ),
    );
    expect(created.ok).toBe(true);

    // 孤児: R2 にはあるが asset record が無い
    const orphanKey = `${tenantId}/orphan-1`;
    await env.ASSETS.put(orphanKey, Uint8Array.from([9, 9]));
    // 他テナント接頭辞: 一覧には出ない(list prefix)。DELETE ガードの直接検証用。
    const foreignKey = `${otherTenantId}/x`;
    await env.ASSETS.put(foreignKey, Uint8Array.from([7]));

    const { cookie, adminId } = await superLogin();
    const e = superEnv();

    const listed = await app.request(
      `/super/v1/tenants/${tenantId}/orphan-assets`,
      { headers: { cookie } },
      e,
    );
    expect(listed.status).toBe(200);
    const { orphans } = (await listed.json()) as { orphans: { key: string; size: number }[] };
    expect(orphans).toEqual([{ key: orphanKey, size: 2 }]);

    const deleted = await app.request(
      jsonReq("DELETE", `/super/v1/tenants/${tenantId}/orphan-assets`, cookie, {
        keys: [orphanKey],
      }),
      undefined,
      e,
    );
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toEqual({ ok: true, deleted: 1 });
    expect(await env.ASSETS.get(orphanKey)).toBeNull();
    const actions = await drizzle(env.DB)
      .select({ action: auditLogs.action, actorId: auditLogs.actorId })
      .from(auditLogs);
    expect(actions).toContainEqual({ action: "orphan_assets.delete", actorId: adminId });

    // §14 の教訓: 他テナント接頭辞のキーは帰属ガードで 400(assetKeyBelongsToTenant)
    const foreign = await app.request(
      jsonReq("DELETE", `/super/v1/tenants/${tenantId}/orphan-assets`, cookie, {
        keys: [foreignKey],
      }),
      undefined,
      e,
    );
    expect(foreign.status).toBe(400);
    expect(await foreign.json()).toEqual({ error: "foreign_key" });
    expect(await env.ASSETS.get(foreignKey)).not.toBeNull();

    // 参照中の key は削除直前の再照会で拒否される(レース対策)
    const referenced = await app.request(
      jsonReq("DELETE", `/super/v1/tenants/${tenantId}/orphan-assets`, cookie, {
        keys: [referencedKey],
      }),
      undefined,
      e,
    );
    expect(referenced.status).toBe(400);
    expect(await referenced.json()).toEqual({ error: "still_referenced" });
    expect(await env.ASSETS.get(referencedKey)).not.toBeNull();
  });
});
