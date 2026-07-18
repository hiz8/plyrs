import { env, runInDurableObject, evictDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { handleModuleJob, type ModuleQueueJob } from "../src/modules/events";
import { asModuleSummaries } from "../src/rpc-unwrap";
import type { AuthContext } from "../src/do/authorize";

function stub(name: string) {
  return env.TENANT_DO.get(env.TENANT_DO.idFromName(name));
}

function owner(tenantId: string): AuthContext {
  return { userId: "u-owner", role: "owner", tenantId };
}

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
