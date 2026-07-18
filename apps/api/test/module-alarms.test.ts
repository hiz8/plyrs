import { env, runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import {
  moduleAlarmKind,
  moduleIdFromAlarmKind,
  runModuleAlarmHandler,
} from "../src/modules/module-alarms";
import { registerAlarm } from "../src/do/alarms";
import { upsertModuleEnablement } from "../src/modules/enablement";
import type { ModuleManifest } from "../src/modules/manifest";
import type { ModuleAlarmContext, ModuleDefinition } from "../src/modules/registry";

function stub(name: string) {
  return env.TENANT_DO.get(env.TENANT_DO.idFromName(name));
}

// runModuleAlarmHandler へ直接注入するための最小フェイクマニフェスト(schema 検証は通さない
// テスト fixture — module-redistribute.test.ts の ASSET_COLLISION_MANIFEST と同じ様式)。
function fakeManifest(moduleId: string): ModuleManifest {
  return {
    moduleId,
    version: 1,
    name: moduleId,
    contentTypes: [],
    permissions: [],
    typeWriteGuards: {},
    publicWriteTypes: [],
  };
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

describe("runModuleAlarmHandler の throw 隔離 (§15 冒頭掃除)", () => {
  it("1 本目のハンドラが throw しても 2 本目は実行され、呼び出し自体も throw しない", async () => {
    const tenant = stub("mod-alarm-isolate");
    await tenant.ping();
    const calls: string[] = [];
    const throwingModule: ModuleDefinition = {
      manifest: fakeManifest("fake-a"),
      onAlarm: () => {
        calls.push("fake-a");
        throw new Error("boom");
      },
    };
    const okModule: ModuleDefinition = {
      manifest: fakeManifest("fake-b"),
      onAlarm: () => {
        calls.push("fake-b");
      },
    };
    await runInDurableObject(tenant, async (_instance, state) => {
      const ctx: ModuleAlarmContext = {
        sql: state.storage.sql,
        now: Date.now(),
        schedule: () => {},
        writeRecord: () => ({ ok: false, code: "unknown_type", message: "unused in test" }),
      };
      // 「2 モジュールぶんの alarm を登録し」の代わりに、同一 alarm() 起床内での連続ディスパッチを
      // 直接シミュレートする(レジストリ注入シーム: module は呼び出し側が渡す)。
      expect(() => runModuleAlarmHandler("fake-a", throwingModule, ctx)).not.toThrow();
      expect(() => runModuleAlarmHandler("fake-b", okModule, ctx)).not.toThrow();
    });
    expect(calls).toEqual(["fake-a", "fake-b"]);
  });

  it("onAlarm が無いモジュール・module 未解決(undefined)は何もせず throw しない", async () => {
    const tenant = stub("mod-alarm-no-handler");
    await tenant.ping();
    await runInDurableObject(tenant, async (_instance, state) => {
      const ctx: ModuleAlarmContext = {
        sql: state.storage.sql,
        now: Date.now(),
        schedule: () => {},
        writeRecord: () => ({ ok: false, code: "unknown_type", message: "unused in test" }),
      };
      expect(() =>
        runModuleAlarmHandler("no-handler", { manifest: fakeManifest("no-handler") }, ctx),
      ).not.toThrow();
      expect(() => runModuleAlarmHandler("missing", undefined, ctx)).not.toThrow();
    });
  });
});
