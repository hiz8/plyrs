import { env, runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { BOOKING_PENDING_TTL_MS } from "../src/modules/booking/module";
import { moduleAlarmKind } from "../src/modules/module-alarms";
import { handleModuleJob, type ModuleQueueJob } from "../src/modules/events";
import { asRecordSnapshot, asWriteResult } from "../src/rpc-unwrap";
import type { AuthContext } from "../src/do/authorize";

const TENANT = "t-booking";
const OWNER: AuthContext = { userId: "u-owner", role: "owner", tenantId: TENANT };

function stub(name: string) {
  return env.TENANT_DO.get(env.TENANT_DO.idFromName(name));
}

function uuid(n: number): string {
  return `00000000-0000-7000-8000-${String(n).padStart(12, "0")}`;
}

async function setupSlot(tenant: ReturnType<typeof stub>, capacity: number) {
  await tenant.enableModule(TENANT, "booking", OWNER);
  await tenant.writeRecord(
    "booking.resource",
    { recordId: uuid(1), input: { name: "会議室" } },
    OWNER,
  );
  await tenant.writeRecord(
    "booking.slot",
    {
      recordId: uuid(2),
      input: {
        resource: { type: "booking.resource", id: uuid(1) },
        starts_at: "2026-08-01T10:00:00Z",
        ends_at: "2026-08-01T11:00:00Z",
        capacity,
      },
    },
    OWNER,
  );
}

function reservationInput(n: number, state = "pending") {
  return {
    recordId: uuid(100 + n),
    input: {
      slot: { type: "booking.slot", id: uuid(2) },
      name: `予約者${n}`,
      email: `r${n}@example.com`,
      state,
    },
  };
}

describe("空き枠検証フック (design-spec §9.3 / §9.8)", () => {
  it("capacity を超える予約は booking:slot_full で拒否される", async () => {
    const tenant = stub("booking-capacity");
    await setupSlot(tenant, 1);
    const first = asWriteResult(
      await tenant.writeRecord("booking.reservation", reservationInput(1), OWNER),
    );
    expect(first.ok).toBe(true);
    const second = asWriteResult(
      await tenant.writeRecord("booking.reservation", reservationInput(2), OWNER),
    );
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.code).toBe("booking:slot_full");
  });

  it("cancelled への更新は枠を消費しない(取消 → 新規予約が通る)", async () => {
    const tenant = stub("booking-cancel");
    await setupSlot(tenant, 1);
    await tenant.writeRecord("booking.reservation", reservationInput(1), OWNER);
    const cancel = asWriteResult(
      await tenant.writeRecord(
        "booking.reservation",
        { ...reservationInput(1), input: { ...reservationInput(1).input, state: "cancelled" } },
        OWNER,
      ),
    );
    expect(cancel.ok).toBe(true);
    const next = asWriteResult(
      await tenant.writeRecord("booking.reservation", reservationInput(2), OWNER),
    );
    expect(next.ok).toBe(true);
  });

  it("存在しない slot への予約は booking:unknown_slot", async () => {
    const tenant = stub("booking-ghost-slot");
    await setupSlot(tenant, 1);
    const result = asWriteResult(
      await tenant.writeRecord(
        "booking.reservation",
        {
          recordId: uuid(150),
          input: {
            slot: { type: "booking.slot", id: uuid(99) },
            name: "x",
            email: "x@example.com",
            state: "pending",
          },
        },
        OWNER,
      ),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("booking:unknown_slot");
  });
});

describe("確認通知イベント (§9.3 非同期副作用・冪等)", () => {
  it("afterWrite イベントの消化で booking.notification が作られ、再配達は no-op", async () => {
    const tenant = stub("booking-notify");
    await setupSlot(tenant, 2);
    await tenant.writeRecord("booking.reservation", reservationInput(1), OWNER);
    const job: ModuleQueueJob = {
      kind: "module_event",
      eventId: uuid(700),
      tenantId: "booking-notify", // DO 名 = idFromName の引数と一致させる(moduleWrite の宛先)
      moduleId: "booking",
      event: "afterWrite",
      recordId: uuid(101),
      typeKey: "booking.reservation",
    };
    await handleModuleJob(env, job);
    await handleModuleJob(env, job); // at-least-once の再配達
    await runInDurableObject(tenant, async (_instance, state) => {
      const rows = state.storage.sql
        .exec<{ n: number }>(
          "SELECT COUNT(*) AS n FROM records WHERE type = 'booking.notification' AND deleted_at IS NULL",
        )
        .one();
      expect(rows.n).toBe(1); // unique(reservation_id) が二重送信を防ぐ
    });
  });
});

describe("仮予約の失効 alarm (§9.6 / §9.8)", () => {
  it("TTL を過ぎた pending が alarm で cancelled になり、枠が解放される", async () => {
    const tenant = stub("booking-expire");
    await setupSlot(tenant, 1);
    await tenant.writeRecord("booking.reservation", reservationInput(1), OWNER);
    // 予約書き込みが module:booking の alarm を張っている
    await runInDurableObject(tenant, async (_instance, state) => {
      const row = state.storage.sql
        .exec<{ due_at: number }>(
          "SELECT due_at FROM alarm_registry WHERE kind = ?",
          moduleAlarmKind("booking"),
        )
        .toArray()[0];
      expect(row).toBeDefined();
      // updated_at を TTL より過去へ倒して失効条件を成立させ、due を現在へ前倒しする
      const past = new Date(Date.now() - BOOKING_PENDING_TTL_MS - 60_000).toISOString();
      state.storage.sql.exec("UPDATE records SET updated_at = ? WHERE id = ?", past, uuid(101));
      state.storage.sql.exec(
        "UPDATE alarm_registry SET due_at = ? WHERE kind = ?",
        Date.now() - 1_000,
        moduleAlarmKind("booking"),
      );
      // 物理アラームは未来にしておく: workerd は過去日時の setAlarm を実際にほぼ即時に自動発火
      // させ、runDurableObjectAlarm を呼ぶ前に消費されてしまう(Task 8 で確立した様式に追従)。
      // due 判定はレジストリの due_at(過去)を effectiveNow/dueKinds が見るため、論理的な失効
      // 条件はブリーフどおり変えていない。
      await state.storage.setAlarm(Date.now() + 60_000);
    });
    const ran = await runDurableObjectAlarm(tenant);
    expect(ran).toBe(true);
    const expired = asRecordSnapshot(await tenant.getRecord(uuid(101)));
    expect(expired?.data["state"]).toBe("cancelled");
    // 枠が解放されている
    const next = asWriteResult(
      await tenant.writeRecord("booking.reservation", reservationInput(2), OWNER),
    );
    expect(next.ok).toBe(true);
  });
});
