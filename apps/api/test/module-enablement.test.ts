import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { ClientChange } from "@plyrs/sync-protocol";
import {
  BOOKING_MANIFEST,
  BOOKING_RESERVATION_KEY,
  BOOKING_RESOURCE_KEY,
  BOOKING_SLOT_KEY,
} from "../src/modules/booking/manifest";
import {
  asContentTypeRow,
  asEnableModuleResult,
  asModuleSummaries,
  asRecordSnapshot,
  asWriteResult,
} from "../src/rpc-unwrap";
import type { AuthContext } from "../src/do/authorize";
import { nextMessage, openSyncSocket } from "./ws-helpers";

const OWNER: AuthContext = { userId: "u-owner", role: "owner", tenantId: "t-mod" };
const EDITOR: AuthContext = { userId: "u-editor", role: "editor", tenantId: "t-mod" };

function stub(name: string) {
  return env.TENANT_DO.get(env.TENANT_DO.idFromName(name));
}

function uuid(n: number): string {
  return `00000000-0000-7000-8000-${String(n).padStart(12, "0")}`;
}

function socketAuth(role: "owner" | "editor", tenantId: string) {
  return {
    userId: role === "owner" ? "u-owner" : "u-editor",
    role,
    tenantId,
    exp: Math.floor(Date.now() / 1000) + 900,
  };
}

// booking-module.test.ts の setupSlot 様式: resource / slot(capacity 1) を owner が用意し、
// 続けて booking.reservation(owner 限定の guard 型)を 1 件作る。
async function setupReservation(
  tenant: ReturnType<typeof stub>,
  tenantId: string,
  reservationId: string,
): Promise<void> {
  await tenant.enableModule(tenantId, "booking", OWNER);
  await tenant.writeRecord(
    BOOKING_RESOURCE_KEY,
    { recordId: uuid(500), input: { name: "会議室" } },
    OWNER,
  );
  await tenant.writeRecord(
    BOOKING_SLOT_KEY,
    {
      recordId: uuid(501),
      input: {
        resource: { type: BOOKING_RESOURCE_KEY, id: uuid(500) },
        starts_at: "2026-08-01T10:00:00Z",
        ends_at: "2026-08-01T11:00:00Z",
        capacity: 1,
      },
    },
    OWNER,
  );
  const created = asWriteResult(
    await tenant.writeRecord(
      BOOKING_RESERVATION_KEY,
      {
        recordId: reservationId,
        input: {
          slot: { type: BOOKING_SLOT_KEY, id: uuid(501) },
          name: "予約者",
          email: "r@example.com",
          state: "pending",
        },
      },
      OWNER,
    ),
  );
  if (!created.ok) {
    throw new Error(`setup failed: ${created.message}`);
  }
}

describe("モジュール有効化レジストリ (design-spec §9.5)", () => {
  it("enable で booking の 4 型が登録され applied version が刻まれる", async () => {
    const tenant = stub("mod-enable-1");
    const result = asEnableModuleResult(await tenant.enableModule("t-mod", "booking", OWNER));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.module).toEqual({
      moduleId: "booking",
      name: "予約",
      version: BOOKING_MANIFEST.version,
      enabled: true,
      appliedVersion: BOOKING_MANIFEST.version,
    });
    const row = asContentTypeRow(await tenant.getContentType(BOOKING_RESOURCE_KEY));
    expect(row?.source).toBe("plugin");
    expect(row?.pluginId).toBe("booking");
  });

  it("enable は冪等(再 enable で型 version が進まない)", async () => {
    const tenant = stub("mod-enable-2");
    await tenant.enableModule("t-mod", "booking", OWNER);
    const before = asContentTypeRow(await tenant.getContentType(BOOKING_RESOURCE_KEY));
    await tenant.enableModule("t-mod", "booking", OWNER);
    const after = asContentTypeRow(await tenant.getContentType(BOOKING_RESOURCE_KEY));
    expect(after?.version).toBe(before?.version);
  });

  it("editor は enable できない(module:manage は owner のみ)", async () => {
    const tenant = stub("mod-enable-3");
    const result = asEnableModuleResult(await tenant.enableModule("t-mod", "booking", EDITOR));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("forbidden");
  });

  it("未知のモジュールは unknown_module", async () => {
    const tenant = stub("mod-enable-4");
    const result = asEnableModuleResult(await tenant.enableModule("t-mod", "ghost", OWNER));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("unknown_module");
  });

  it("listModules はカタログ + 有効化状態を返す(未有効時 enabled: false)", async () => {
    const tenant = stub("mod-enable-5");
    const before = asModuleSummaries(await tenant.listModules());
    expect(before).toEqual([
      { moduleId: "booking", name: "予約", version: 1, enabled: false, appliedVersion: 0 },
    ]);
    await tenant.enableModule("t-mod", "booking", OWNER);
    await tenant.disableModule("t-mod", "booking", OWNER);
    const after = asModuleSummaries(await tenant.listModules());
    expect(after[0]).toMatchObject({ enabled: false, appliedVersion: 1 }); // 型は残る(§9.5)
  });
});

describe("モジュール権限の書き込みガード (design-spec §11.5)", () => {
  it("editor は booking.resource を書けるが booking.reservation は forbidden", async () => {
    const tenant = stub("mod-guard-1");
    await tenant.enableModule("t-mod", "booking", OWNER);
    const resource = asWriteResult(
      await tenant.writeRecord(
        BOOKING_RESOURCE_KEY,
        { recordId: uuid(1), input: { name: "会議室A" } },
        EDITOR,
      ),
    );
    expect(resource.ok).toBe(true);
    // 注: slot が dangling でも booking.reservation の書き込み自体はソフト参照として通る形。
    // Task 10 で空き枠フックが入ると unknown_slot 等に変わりうるが、ガードは requireOperation と
    // 同じ入口(フックより前)で forbidden を返すため、editor が forbidden になる結論は変わらない。
    const reservation = asWriteResult(
      await tenant.writeRecord(
        BOOKING_RESERVATION_KEY,
        {
          recordId: uuid(2),
          input: {
            name: "x",
            email: "x@example.com",
            state: "pending",
            slot: { type: "booking.slot", id: uuid(9) },
          },
        },
        EDITOR,
      ),
    );
    expect(reservation.ok).toBe(false);
    if (reservation.ok) return;
    expect(reservation.code).toBe("forbidden");
  });

  it("モジュールを無効化するとガードは適用されない(§9.5: コードが走らない)", async () => {
    const tenant = stub("mod-guard-2");
    await tenant.enableModule("t-mod", "booking", OWNER);
    await tenant.disableModule("t-mod", "booking", OWNER);
    const result = asWriteResult(
      await tenant.writeRecord(
        BOOKING_RESOURCE_KEY,
        { recordId: uuid(3), input: { name: "残存型への書き込み" } },
        EDITOR,
      ),
    );
    expect(result.ok).toBe(true);
  });
});

describe("push 経由 delete のモジュール write ガード (Critical fix)", () => {
  // write は writeRecordCore の prev.type !== contentType.key 検査で typeKey 詐称が閉じるが、
  // delete(deleteRecordCore)は recordId だけで tombstone するため対がなかった。editor が
  // typeKey を editor が書ける非ガード型(booking.resource)へ詐称し、recordId には owner 限定の
  // booking.reservation を指す delete change を push すると、ガードを迂回して削除できてしまう
  // 穴を固定する。
  it("editor が typeKey を非ガード型に詐称した delete push は forbidden で拒否され record は残る", async () => {
    const tenantId = "t-mod-del-1";
    const tenant = stub("mod-push-delete-1");
    const reservationId = uuid(600);
    await setupReservation(tenant, tenantId, reservationId);

    const { socket } = await openSyncSocket(tenant, socketAuth("editor", tenantId));
    socket.send(JSON.stringify({ type: "hello", checkpoint: 0 }));
    await nextMessage(socket); // welcome
    await nextMessage(socket); // sync page

    const spoofed: ClientChange = {
      changeId: crypto.randomUUID(),
      recordId: reservationId,
      typeKey: BOOKING_RESOURCE_KEY, // editor が書ける非ガード型への詐称
      op: "delete",
      input: {},
      changedFields: [],
      baseFieldVersions: {},
    };
    socket.send(JSON.stringify({ type: "push", changes: [spoofed] }));
    const ack = await nextMessage(socket);
    expect(ack.type).toBe("ack");
    if (ack.type === "ack") {
      expect(ack.result.ok).toBe(false);
      if (!ack.result.ok) {
        expect(ack.result.code).toBe("forbidden");
      }
    }

    const stillThere = asRecordSnapshot(await tenant.getRecord(reservationId));
    expect(stillThere?.deletedAt).toBeNull();

    socket.close(1000, "done");
  });

  it("対照: owner の正しい typeKey での delete push は成功する", async () => {
    const tenantId = "t-mod-del-2";
    const tenant = stub("mod-push-delete-2");
    const reservationId = uuid(601);
    await setupReservation(tenant, tenantId, reservationId);

    const { socket } = await openSyncSocket(tenant, socketAuth("owner", tenantId));
    socket.send(JSON.stringify({ type: "hello", checkpoint: 0 }));
    await nextMessage(socket); // welcome
    await nextMessage(socket); // sync page

    const removal: ClientChange = {
      changeId: crypto.randomUUID(),
      recordId: reservationId,
      typeKey: BOOKING_RESERVATION_KEY,
      op: "delete",
      input: {},
      changedFields: [],
      baseFieldVersions: {},
    };
    socket.send(JSON.stringify({ type: "push", changes: [removal] }));
    const ack = await nextMessage(socket);
    expect(ack.type).toBe("ack");
    if (ack.type === "ack") {
      expect(ack.result.ok).toBe(true);
    }

    const deleted = asRecordSnapshot(await tenant.getRecord(reservationId));
    expect(deleted?.deletedAt).not.toBeNull();

    socket.close(1000, "done");
  });
});

describe("plugin 型のクライアント登録は閉じる (§4.1 越境登録の拒否)", () => {
  it("registerContentType RPC は source='plugin' を forbidden で拒否する", async () => {
    const tenant = stub("mod-plugin-closed");
    const result = await tenant.registerContentType(
      {
        id: uuid(100),
        key: "ghost.item",
        name: "偽プラグイン型",
        source: "plugin",
        pluginId: "ghost",
        version: 1,
        fields: [],
      },
      OWNER,
    );
    expect((result as { ok: boolean }).ok).toBe(false);
    expect((result as { code: string }).code).toBe("forbidden");
  });
});
