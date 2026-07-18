import { env, runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { moduleAlarmKind, moduleIdFromAlarmKind } from "../src/modules/module-alarms";
import { registerAlarm } from "../src/do/alarms";
import { upsertModuleEnablement } from "../src/modules/enablement";

function stub(name: string) {
  return env.TENANT_DO.get(env.TENANT_DO.idFromName(name));
}

describe("module alarm kind ヘルパー", () => {
  it("kind の往復変換", () => {
    expect(moduleAlarmKind("booking")).toBe("module:booking");
    expect(moduleIdFromAlarmKind("module:booking")).toBe("booking");
    expect(moduleIdFromAlarmKind("outbox_sweep")).toBeNull();
    expect(moduleIdFromAlarmKind("module_events_sweep")).toBeNull();
  });
});

describe("TenantDO.alarm() のモジュールディスパッチ (design-spec §9.6)", () => {
  it("未知モジュールの kind はレジストリから掃除され、永久起床ループにならない", async () => {
    const tenant = stub("mod-alarm-unknown");
    await tenant.ping();
    await runInDurableObject(tenant, async (_instance, state) => {
      registerAlarm(state.storage.sql, moduleAlarmKind("ghost"), Date.now() - 1_000);
      // 物理アラームは未来にしておく: workerd は過去日時の setAlarm を実際にほぼ即時に
      // 自動発火させる（runDurableObjectAlarm を呼ぶ前に消費されてしまい ran が false になる）。
      // due 判定はレジストリの due_at（過去）を見る effectiveNow/dueKinds が担うので、物理アラーム
      // 自体の時刻は「非 null であること」だけが runDurableObjectAlarm の trigger 条件。
      await state.storage.setAlarm(Date.now() + 60_000);
    });
    const ran = await runDurableObjectAlarm(tenant);
    expect(ran).toBe(true);
    await runInDurableObject(tenant, async (_instance, state) => {
      const rows = state.storage.sql
        .exec<{ kind: string }>("SELECT kind FROM alarm_registry")
        .toArray();
      expect(rows).toEqual([]); // 掃除済み
      expect(await state.storage.getAlarm()).toBeNull(); // 張り直し無し
    });
  });

  it("無効モジュールの kind も消化される(ハンドラは走らない)", async () => {
    const tenant = stub("mod-alarm-disabled");
    await tenant.ping();
    await runInDurableObject(tenant, async (_instance, state) => {
      // booking はコード上存在するが、このテナントでは無効のまま
      upsertModuleEnablement(state.storage.sql, {
        moduleId: "booking",
        enabled: false,
        appliedVersion: 0,
        permissions: { grants: {}, typeWriteGuards: {} },
        now: new Date().toISOString(),
      });
      registerAlarm(state.storage.sql, moduleAlarmKind("booking"), Date.now() - 1_000);
      // 上のテストと同じ理由で物理アラームは未来にする(過去だと workerd が自動発火してしまう)。
      await state.storage.setAlarm(Date.now() + 60_000);
    });
    const ran = await runDurableObjectAlarm(tenant);
    expect(ran).toBe(true);
    await runInDurableObject(tenant, async (_instance, state) => {
      const rows = state.storage.sql
        .exec<{ kind: string }>("SELECT kind FROM alarm_registry")
        .toArray();
      expect(rows).toEqual([]);
    });
  });

  it("module: 接頭辞でも outbox_sweep でもない未知 kind も alarm() 側で掃除される", async () => {
    const tenant = stub("mod-alarm-totally-unknown");
    await tenant.ping();
    await runInDurableObject(tenant, async (_instance, state) => {
      // moduleIdFromAlarmKind が null を返す kind(runModuleAlarm には渡らない)。
      // alarm() 本体の「未知 kind 掃除」分岐(console.error + clearAlarm)を直接踏む。
      registerAlarm(state.storage.sql, "totally_unknown_kind", Date.now() - 1_000);
      // 上の2テストと同じ理由で物理アラームは未来にする(過去だと workerd が自動発火してしまう)。
      await state.storage.setAlarm(Date.now() + 60_000);
    });
    const ran = await runDurableObjectAlarm(tenant);
    expect(ran).toBe(true);
    await runInDurableObject(tenant, async (_instance, state) => {
      const rows = state.storage.sql
        .exec<{ kind: string }>("SELECT kind FROM alarm_registry")
        .toArray();
      expect(rows).toEqual([]); // 掃除済み
      expect(await state.storage.getAlarm()).toBeNull(); // 張り直し無し
    });
  });
});
