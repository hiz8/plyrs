import { env, runInDurableObject, evictDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { handleModuleJob, type ModuleQueueJob } from "../src/modules/events";
import { ensureEnabledModuleTypes, upsertModuleEnablement } from "../src/modules/enablement";
import type { ModuleManifest } from "../src/modules/manifest";
import type { ModuleDefinition } from "../src/modules/registry";
import { asModuleSummaries } from "../src/rpc-unwrap";
import type { AuthContext } from "../src/do/authorize";

function stub(name: string) {
  return env.TENANT_DO.get(env.TENANT_DO.idFromName(name));
}

function owner(tenantId: string): AuthContext {
  return { userId: "u-owner", role: "owner", tenantId };
}

// Important fix（レビュー指摘）用の注入マニフェスト: 既存の system 型 'asset' と key が
// 衝突する contentType を持たせ、applyModuleTypes → registerContentTypeCore が forbidden を
// 返して throw する経路を作る(§4.2 の allowSystem 未許可チェックに引っかかる)。
const ASSET_COLLISION_MANIFEST: ModuleManifest = {
  moduleId: "demo",
  version: 1,
  name: "デモ",
  contentTypes: [
    {
      id: "00000000-0000-7000-8000-00000d000001",
      key: "asset", // 既存の system 型と衝突させる
      name: "衝突デモ型",
      fields: [],
      source: "system",
      version: 1,
    },
  ],
  permissions: [],
  typeWriteGuards: {},
  publicWriteTypes: [],
};

const DEMO_MODULE: ModuleDefinition = { manifest: ASSET_COLLISION_MANIFEST };

async function markStale(tenant: ReturnType<typeof stub>): Promise<void> {
  await runInDurableObject(tenant, async (_instance, state) => {
    state.storage.sql.exec(
      "UPDATE module_registry SET applied_version = 0 WHERE module_id = 'booking'",
    );
  });
}

describe("型定義再配布 (design-spec §4.2)", () => {
  it("module_sync ジョブが applied_version を現行へ引き上げる", async () => {
    const tenantId = "redis-sync-1";
    const tenant = stub(tenantId);
    await tenant.enableModule(tenantId, "booking", owner(tenantId));
    await markStale(tenant);
    const job: ModuleQueueJob = { kind: "module_sync", tenantId, moduleId: "booking" };
    await handleModuleJob(env, job);
    const modules = asModuleSummaries(await tenant.listModules());
    expect(modules[0]).toMatchObject({ moduleId: "booking", appliedVersion: 1 });
  });

  it("module_redistribute が D1 ミラーの有効テナントへ module_sync をファンアウトする", async () => {
    const now = new Date().toISOString();
    await env.DB.prepare(
      "INSERT OR REPLACE INTO tenant_modules (tenant_id, module_id, enabled, updated_at) VALUES ('redis-fan-1', 'booking', 1, ?), ('redis-fan-2', 'booking', 0, ?)",
    )
      .bind(now, now)
      .run();
    const sent: ModuleQueueJob[] = [];
    const fanoutEnv = {
      ...env,
      MODULES_QUEUE: { send: async (job: ModuleQueueJob) => void sent.push(job) },
    } as unknown as Env; // テスト専用: send だけ観測するフェイク(境界 cast)
    await handleModuleJob(fanoutEnv, { kind: "module_redistribute", moduleId: "booking" });
    expect(sent).toEqual([{ kind: "module_sync", tenantId: "redis-fan-1", moduleId: "booking" }]);
  });

  it("無効テナントへの module_sync は no-op(型を勝手に足さない)", async () => {
    const tenantId = "redis-sync-disabled";
    const tenant = stub(tenantId);
    await tenant.ping();
    await handleModuleJob(env, { kind: "module_sync", tenantId, moduleId: "booking" });
    const modules = asModuleSummaries(await tenant.listModules());
    expect(modules[0]).toMatchObject({ enabled: false, appliedVersion: 0 });
  });

  it("同一 version の module_sync 再配達は書き込まない(updated_at 不変・冪等)", async () => {
    const tenantId = "redis-sync-idempotent";
    const tenant = stub(tenantId);
    await tenant.enableModule(tenantId, "booking", owner(tenantId));
    const readUpdatedAt = async () =>
      runInDurableObject(tenant, async (_instance, state) =>
        state.storage.sql
          .exec<{ updated_at: string }>(
            "SELECT updated_at FROM module_registry WHERE module_id = 'booking'",
          )
          .one(),
      );
    const before = await readUpdatedAt();
    // Queues は at-least-once。既に現行 version が適用済みの module_sync が再配達されても
    // module_registry へは一切書き込まないはず(§4.2 の冪等制約)。
    await handleModuleJob(env, { kind: "module_sync", tenantId, moduleId: "booking" });
    const after = await readUpdatedAt();
    expect(after.updated_at).toBe(before.updated_at);
  });

  it("DO 起床時の遅延再適用が applied_version を追い付かせる(Queues を待たない安全網)", async () => {
    const tenantId = "redis-lazy";
    const tenant = stub(tenantId);
    await tenant.enableModule(tenantId, "booking", owner(tenantId));
    await markStale(tenant);
    await evictDurableObject(tenant);
    await tenant.ping(); // constructor の ensureEnabledModuleTypes が走る
    const modules = asModuleSummaries(await tenant.listModules());
    expect(modules[0]).toMatchObject({ appliedVersion: 1 });
  });
});

describe("ensureEnabledModuleTypes の防御 (Important fix)", () => {
  it("applyModuleTypes が throw してもモジュール単位でスキップし DO 起動を継続する(テナント全損の回避)", async () => {
    const tenantId = "mod-guard-demo-1";
    const tenant = stub(tenantId);
    await tenant.ping(); // system asset 型を含む通常初期化を先に走らせる

    await runInDurableObject(tenant, async (_instance, state) => {
      upsertModuleEnablement(state.storage.sql, {
        moduleId: "demo",
        enabled: true,
        appliedVersion: 0,
        permissions: { grants: {}, typeWriteGuards: {} },
        now: new Date().toISOString(),
      });
    });

    // 注入 registry を使った直接呼び出し: applyModuleTypes → registerContentTypeCore が
    // 'asset' との system 衝突で forbidden を返し throw する経路を通す。
    const changed = await runInDurableObject(tenant, async (_instance, state) =>
      ensureEnabledModuleTypes(state.storage.sql, new Date().toISOString(), { demo: DEMO_MODULE }),
    );
    expect(changed).toBe(false); // throw を捕捉してスキップしたので変更なし

    await runInDurableObject(tenant, async (_instance, state) => {
      const row = state.storage.sql
        .exec<{ applied_version: number }>(
          "SELECT applied_version FROM module_registry WHERE module_id = 'demo'",
        )
        .one();
      expect(row.applied_version).toBe(0); // 進んでいない
    });
  });

  it("実コンストラクタ経路も生存する(demo は静的 MODULE_REGISTRY 未定義のため単に skip される)", async () => {
    const tenantId = "mod-guard-demo-2";
    const tenant = stub(tenantId);
    await tenant.ping();
    await runInDurableObject(tenant, async (_instance, state) => {
      upsertModuleEnablement(state.storage.sql, {
        moduleId: "demo",
        enabled: true,
        appliedVersion: 0,
        permissions: { grants: {}, typeWriteGuards: {} },
        now: new Date().toISOString(),
      });
    });
    await evictDurableObject(tenant);
    // 注: 実運用の静的 MODULE_REGISTRY(registry.ts)には 'demo' が定義されていないため、
    // constructor 経由の ensureEnabledModuleTypes は module === undefined で単に continue する
    // ―― ここで固定するのは「未定義モジュールの行が残っていても DO 起動を落とさない」ことで
    // あり、上のテストが固定する「throw を捕捉してスキップする」防御そのものは
    // (登録済みモジュールの version bump でしか再現できないため)この経路では再現できない。
    await expect(tenant.ping()).resolves.toBe("pong");
  });
});
