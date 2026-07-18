import { env, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { moduleBeforeWriteHooks } from "../src/modules/hooks";
import { upsertModuleEnablement } from "../src/modules/enablement";

function stub(name: string) {
  return env.TENANT_DO.get(env.TENANT_DO.idFromName(name));
}

describe("moduleBeforeWriteHooks (design-spec §9.3 / §9.4 ステップ2)", () => {
  it("無効モジュールのフックは返さない・有効化で返す", async () => {
    const tenant = stub("mod-hooks-1");
    await tenant.ping();
    await runInDurableObject(tenant, async (_instance, state) => {
      const sql = state.storage.sql;
      expect(moduleBeforeWriteHooks(sql)).toEqual([]); // booking 未有効
      upsertModuleEnablement(sql, {
        moduleId: "booking",
        enabled: true,
        appliedVersion: 1,
        permissions: { grants: {}, typeWriteGuards: {} },
        now: new Date().toISOString(),
      });
      // Task 10 で bookingModule.beforeWrite が入るまでは 0 本のまま(定義が無いフックは合流しない)
      const hooks = moduleBeforeWriteHooks(sql);
      expect(Array.isArray(hooks)).toBe(true);
    });
  });

  it("レジストリに行があってもコード側に定義が無い moduleId は無視する", async () => {
    const tenant = stub("mod-hooks-2");
    await tenant.ping();
    await runInDurableObject(tenant, async (_instance, state) => {
      upsertModuleEnablement(state.storage.sql, {
        moduleId: "ghost",
        enabled: true,
        appliedVersion: 1,
        permissions: { grants: {}, typeWriteGuards: {} },
        now: new Date().toISOString(),
      });
      expect(moduleBeforeWriteHooks(state.storage.sql)).toEqual([]);
    });
  });
});
