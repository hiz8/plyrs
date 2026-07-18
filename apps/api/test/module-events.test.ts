import { env, runInDurableObject } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import {
  countUnsentModuleEvents,
  emitModuleEvents,
  handleModuleJob,
  type ModuleQueueJob,
} from "../src/modules/events";
import { upsertModuleEnablement } from "../src/modules/enablement";
import type { ModuleDefinition } from "../src/modules/registry";
import { BOOKING_MANIFEST } from "../src/modules/booking/manifest";
import { asWriteResult } from "../src/rpc-unwrap";
import type { AuthContext } from "../src/do/authorize";

const OWNER: AuthContext = { userId: "u-owner", role: "owner", tenantId: "t-events" };

function stub(name: string) {
  return env.TENANT_DO.get(env.TENANT_DO.idFromName(name));
}

function uuid(n: number): string {
  return `00000000-0000-7000-8000-${String(n).padStart(12, "0")}`;
}

// 検証用フェイク: demo モジュールが demo.item の afterWrite / afterPublish を購読する
function fakeRegistry(handle = vi.fn(async () => {})): Record<string, ModuleDefinition> {
  return {
    demo: {
      manifest: { ...BOOKING_MANIFEST, moduleId: "demo", name: "デモ" },
      events: {
        afterWrite: { types: ["demo.item"], handle },
        afterPublish: { types: ["demo.item"], handle },
      },
    },
  };
}

describe("emitModuleEvents (design-spec §9.4 ステップ5)", () => {
  it("有効な購読モジュールにだけ行を積む・module: actor では積まない", async () => {
    const tenant = stub("mod-events-emit");
    await tenant.ping();
    await runInDurableObject(tenant, async (_instance, state) => {
      const sql = state.storage.sql;
      const registry = fakeRegistry();
      let n = 0;
      const newId = () => uuid(500 + ++n);
      const now = new Date().toISOString();
      // 未有効 → 0 行
      expect(
        emitModuleEvents(sql, newId, now, "afterWrite", "demo.item", uuid(1), "u1", registry),
      ).toBe(0);
      upsertModuleEnablement(sql, {
        moduleId: "demo",
        enabled: true,
        appliedVersion: 1,
        permissions: { grants: {}, typeWriteGuards: {} },
        now,
      });
      // 有効 + 購読型 → 1 行
      expect(
        emitModuleEvents(sql, newId, now, "afterWrite", "demo.item", uuid(1), "u1", registry),
      ).toBe(1);
      // 購読していない型 → 0 行
      expect(
        emitModuleEvents(sql, newId, now, "afterWrite", "other", uuid(1), "u1", registry),
      ).toBe(0);
      // イベント連鎖は 1 段まで: module actor の書き込みは積まない
      expect(
        emitModuleEvents(
          sql,
          newId,
          now,
          "afterWrite",
          "demo.item",
          uuid(1),
          "module:demo",
          registry,
        ),
      ).toBe(0);
      expect(countUnsentModuleEvents(sql)).toBe(1);
    });
  });
});

describe("handleModuleJob (consumer)", () => {
  it("購読ハンドラへディスパッチする", async () => {
    const handle = vi.fn(async () => {});
    const job: ModuleQueueJob = {
      kind: "module_event",
      eventId: uuid(600),
      tenantId: "t-events",
      moduleId: "demo",
      event: "afterWrite",
      recordId: uuid(1),
      typeKey: "demo.item",
    };
    await handleModuleJob(env, job, fakeRegistry(handle));
    expect(handle).toHaveBeenCalledTimes(1);
  });

  it("購読が消えた後の残メッセージは黙って ack(何もしない)", async () => {
    const job: ModuleQueueJob = {
      kind: "module_event",
      eventId: uuid(601),
      tenantId: "t-events",
      moduleId: "ghost",
      event: "afterWrite",
      recordId: uuid(1),
      typeKey: "demo.item",
    };
    await expect(handleModuleJob(env, job, fakeRegistry())).resolves.toBeUndefined();
  });
});

describe("moduleWrite RPC (§9.3 非同期副作用の書き戻し)", () => {
  it("有効モジュールは自分の名前空間の型だけ書ける", async () => {
    const tenant = stub("mod-events-write");
    await tenant.enableModule("t-events", "booking", OWNER);
    const ok = asWriteResult(
      await tenant.moduleWrite("t-events", "booking", "booking.resource", {
        recordId: uuid(10),
        input: { name: "リソース" },
      }),
    );
    expect(ok.ok).toBe(true);
    const crossNamespace = asWriteResult(
      await tenant.moduleWrite("t-events", "booking", "asset", {
        recordId: uuid(11),
        input: {},
      }),
    );
    expect(crossNamespace.ok).toBe(false);
    const disabled = asWriteResult(
      await stub("mod-events-write-2").moduleWrite("t-events", "booking", "booking.resource", {
        recordId: uuid(12),
        input: { name: "x" },
      }),
    );
    expect(disabled.ok).toBe(false);
  });
});
