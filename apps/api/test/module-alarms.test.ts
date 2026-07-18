import { env, runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  moduleAlarmKind,
  moduleIdFromAlarmKind,
  runModuleAlarmHandler,
} from "../src/modules/module-alarms";
import { registerAlarm } from "../src/do/alarms";
import type { AuthContext } from "../src/do/authorize";
import { upsertModuleEnablement } from "../src/modules/enablement";
import { BOOKING_RESERVATION_KEY, BOOKING_SLOT_KEY } from "../src/modules/booking/manifest";
import { bookingModule } from "../src/modules/booking/module";
import type { ModuleManifest } from "../src/modules/manifest";
import type { ModuleAlarmContext, ModuleDefinition } from "../src/modules/registry";

function stub(name: string) {
  return env.TENANT_DO.get(env.TENANT_DO.idFromName(name));
}

function uuid(n: number): string {
  return `00000000-0000-7000-8000-${String(n).padStart(12, "0")}`;
}

// --no-isolate 実行(vitest.config)では bookingModule はテストファイルを跨いで共有される
// シングルトンのため、vi.spyOn で差し替えたら必ず元へ戻す。
afterEach(() => {
  vi.restoreAllMocks();
});

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

describe("runModuleAlarmHandler(レジストリ注入シーム) (§15 冒頭掃除)", () => {
  // Important fix(レビュー指摘): 当初 runModuleAlarmHandler 自身が try/catch していたが、
  // それだと呼び出し元の transactionSync クロージャが throw しなくなり、ハンドラ途中までの
  // 部分書き込みが commit され、かつ clearAlarm も commit 済みで schedule() に届かない
  // (= そのモジュールの alarm 再武装が永久に失われる)regression があった。
  // 隔離(ロールバック + 他モジュール継続)の責務は呼び出し側(TenantDO#runModuleAlarm、
  // 下の統合テスト)に置き、この関数自体は throw を素通しする契約にする。
  it("module があれば onAlarm をそのまま呼ぶ(throw も透過する)", async () => {
    const tenant = stub("mod-alarm-seam");
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
      expect(() => runModuleAlarmHandler("fake-a", throwingModule, ctx)).toThrow("boom");
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

describe("TenantDO#runModuleAlarm のロールバック隔離 (§15 Important fix)", () => {
  it("[統合] onAlarm 途中の throw で書き込み・alarm 再武装解除がロールバックされ、他 kind の処理は継続する", async () => {
    const tenantId = "t-alarm-rollback";
    const owner: AuthContext = { userId: "u-owner", role: "owner", tenantId };
    const tenant = stub("mod-alarm-rollback");
    await tenant.enableModule(tenantId, "booking", owner);
    await tenant.writeRecord(
      "booking.resource",
      { recordId: uuid(1), input: { name: "会議室" } },
      owner,
    );
    await tenant.writeRecord(
      "booking.slot",
      {
        recordId: uuid(2),
        input: {
          resource: { type: "booking.resource", id: uuid(1) },
          starts_at: "2026-08-01T10:00:00Z",
          ends_at: "2026-08-01T11:00:00Z",
          capacity: 1,
        },
      },
      owner,
    );
    const reservationId = uuid(3);
    await tenant.writeRecord(
      BOOKING_RESERVATION_KEY,
      {
        recordId: reservationId,
        input: {
          slot: { type: BOOKING_SLOT_KEY, id: uuid(2) },
          name: "予約者",
          email: "r@example.com",
          state: "pending",
        },
      },
      owner,
    );

    // booking の実 onAlarm を「まず 1 件 write してから throw する」実装に差し替える。
    // (1) その write が transactionSync 全体のロールバックで巻き戻ること、
    // (2) clearAlarm も巻き戻り、module:booking の alarm 登録(再武装)が失われないこと、
    // を、synthetic ctx ではなく実際の alarm() 経路(runDurableObjectAlarm)で検証する。
    let onAlarmCalled = false;
    vi.spyOn(bookingModule, "onAlarm").mockImplementation((ctx: ModuleAlarmContext) => {
      onAlarmCalled = true;
      const result = ctx.writeRecord(BOOKING_RESERVATION_KEY, {
        recordId: reservationId,
        input: {
          slot: { type: BOOKING_SLOT_KEY, id: uuid(2) },
          name: "予約者",
          email: "r@example.com",
          state: "cancelled",
        },
      });
      if (!result.ok) {
        throw new Error(`unexpected write failure in test setup: ${result.message}`);
      }
      throw new Error("boom: simulated onAlarm failure after a write");
    });

    await runInDurableObject(tenant, async (_instance, state) => {
      state.storage.sql.exec(
        "UPDATE alarm_registry SET due_at = ? WHERE kind = ?",
        Date.now() - 1_000,
        moduleAlarmKind("booking"),
      );
      // 同一起床で due な他 kind も登録しておき、booking の throw がこれの処理を止めないことを見る
      // (実モジュールは MODULE_REGISTRY に booking しか無いため、「他モジュール」の代わりに
      // alarm() 本体の未知 kind 掃除分岐を「他の処理」として使う)。
      registerAlarm(state.storage.sql, "totally_unknown_kind", Date.now() - 1_000);
      await state.storage.setAlarm(Date.now() + 60_000);
    });

    const ran = await runDurableObjectAlarm(tenant);
    expect(ran).toBe(true); // alarm() 自体は throw せず完走する
    expect(onAlarmCalled).toBe(true);

    await runInDurableObject(tenant, async (_instance, state) => {
      // 書き込みはロールバックされ、予約は pending のまま
      const row = state.storage.sql
        .exec<{ data: string }>("SELECT data FROM records WHERE id = ?", reservationId)
        .one();
      expect((JSON.parse(row.data) as { state: string }).state).toBe("pending");

      // clearAlarm もロールバックされ、booking の alarm 登録(再武装)は失われていない
      const bookingKind = state.storage.sql
        .exec<{ kind: string }>(
          "SELECT kind FROM alarm_registry WHERE kind = ?",
          moduleAlarmKind("booking"),
        )
        .toArray();
      expect(bookingKind).toHaveLength(1);

      // 同一起床で due だった他 kind の処理は throw に妨げられず継続している(掃除済み)
      const unknownKind = state.storage.sql
        .exec<{ kind: string }>(
          "SELECT kind FROM alarm_registry WHERE kind = ?",
          "totally_unknown_kind",
        )
        .toArray();
      expect(unknownKind).toHaveLength(0);
    });
  });
});
