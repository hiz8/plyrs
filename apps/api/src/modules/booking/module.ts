import { uuidSchema } from "@plyrs/metamodel";
import { z } from "zod";
import type { BeforeWriteHook } from "../../do/hooks";
import type { ModuleAlarmContext, ModuleDefinition, ModuleEventContext } from "../registry";
import { loadRelationRefs } from "../../do/write-record";
import {
  BOOKING_MANIFEST,
  BOOKING_MODULE_ID,
  BOOKING_NOTIFICATION_KEY,
  BOOKING_RESERVATION_KEY,
  BOOKING_SLOT_KEY,
} from "./manifest";

// 仮予約(pending)の保持時間。過ぎると alarm が cancelled へ倒し枠を解放する(§9.8)。
export const BOOKING_PENDING_TTL_MS = 15 * 60_000;

// §9.3 同期バリデーションフック: single-writer の DO 内で空き枠を検証するため
// 「検証と書き込みが競合なく原子的」。
const beforeWrite: BeforeWriteHook = (ctx) => {
  if (ctx.contentType.key !== BOOKING_RESERVATION_KEY) {
    return null;
  }
  if (ctx.data["state"] === "cancelled") {
    return null; // 取消は枠を消費しない
  }
  const slotRef = (ctx.relations.get("slot") ?? [])[0];
  if (slotRef === undefined) {
    return null; // required 違反は metamodel の検証が先に落とす(防御的な素通し)
  }
  const slotRow = ctx.sql
    .exec<{ data: string }>(
      "SELECT data FROM records WHERE id = ? AND type = ? AND deleted_at IS NULL",
      slotRef.id,
      BOOKING_SLOT_KEY,
    )
    .toArray()[0];
  if (slotRow === undefined) {
    // ソフト参照(§5)の一般則に対し、予約だけは実在する枠を要求する(モジュールの業務制約)
    return { code: "booking:unknown_slot", message: `slot not found: ${slotRef.id}` };
  }
  const capacityRaw = (JSON.parse(slotRow.data) as Record<string, unknown>)["capacity"];
  const capacity = typeof capacityRaw === "number" ? capacityRaw : 0;
  const taken = ctx.sql
    .exec<{ n: number }>(
      "SELECT COUNT(*) AS n FROM relations rel JOIN records r ON r.id = rel.source_id WHERE rel.source_field = 'slot' AND rel.origin = 'field' AND rel.target_id = ? AND r.type = ? AND r.deleted_at IS NULL AND r.id != ? AND json_extract(r.data, '$.state') != 'cancelled'",
      slotRef.id,
      BOOKING_RESERVATION_KEY,
      ctx.recordId,
    )
    .one().n;
  if (taken >= capacity) {
    return { code: "booking:slot_full", message: `slot is fully booked (capacity ${capacity})` };
  }
  // 新規 pending は失効タイマーを予約(物理 setAlarm は minDueAt 経路 = TenantDO 側が担う)
  if (ctx.prev === null && ctx.data["state"] === "pending") {
    ctx.scheduleModuleAlarm?.(BOOKING_MODULE_ID, Date.now() + BOOKING_PENDING_TTL_MS);
  }
  return null;
};

// §9.3 非同期副作用: 確認メール送信の代替(面4 の外部送信は非目標)。at-least-once の再配達は
// booking.notification の unique(reservation_id) が unique_violation で畳む = 冪等。
async function handleAfterWrite(ctx: ModuleEventContext): Promise<void> {
  const result = await ctx.writeRecord(BOOKING_NOTIFICATION_KEY, {
    recordId: ctx.newId(),
    input: { reservation_id: ctx.recordId, kind: "reservation_written" },
  });
  if (!result.ok && result.code !== "unique_violation") {
    throw new Error(`booking notification failed: ${result.message}`); // retry へ
  }
}

// §9.6: 仮予約の失効。TTL を過ぎた pending を cancelled に倒す。書き込みは全置換(§8 の
// ワイヤ契約)なので、data 全キー + relation 全量を復元して state だけ差し替える。
function onAlarm(ctx: ModuleAlarmContext): void {
  const cutoff = new Date(ctx.now - BOOKING_PENDING_TTL_MS).toISOString();
  const stale = ctx.sql
    .exec<{ id: string; data: string; status: string }>(
      "SELECT id, data, status FROM records WHERE type = ? AND deleted_at IS NULL AND json_extract(data, '$.state') = 'pending' AND updated_at <= ?",
      BOOKING_RESERVATION_KEY,
      cutoff,
    )
    .toArray();
  for (const row of stale) {
    const data = JSON.parse(row.data) as Record<string, unknown>;
    const slotRefs = loadRelationRefs(ctx.sql, row.id).get("slot") ?? [];
    const input: Record<string, unknown> = { ...data, state: "cancelled" };
    if (slotRefs[0] !== undefined) {
      input["slot"] = slotRefs[0];
    }
    const result = ctx.writeRecord(BOOKING_RESERVATION_KEY, { recordId: row.id, input });
    if (!result.ok) {
      console.error("booking expire failed", row.id, result.message);
    }
  }
  // まだ pending が残っていれば、最も古い updated_at + TTL で次回を張る
  const oldest = ctx.sql
    .exec<{ min_updated: string | null }>(
      "SELECT MIN(updated_at) AS min_updated FROM records WHERE type = ? AND deleted_at IS NULL AND json_extract(data, '$.state') = 'pending'",
      BOOKING_RESERVATION_KEY,
    )
    .one().min_updated;
  if (oldest !== null) {
    ctx.schedule(new Date(oldest).getTime() + BOOKING_PENDING_TTL_MS);
  }
}

// §9.7 / §11.7: モジュールが明示的に公開した write エンドポイントだけが DO に到達する。
// recordId はサーバー生成 — 公開経路から既存 record を指すことはできない。
const reservationEndpoint = {
  typeKey: BOOKING_RESERVATION_KEY,
  inputSchema: z.strictObject({
    slot: uuidSchema,
    name: z.string().min(1).max(200),
    email: z.string().min(3).max(320),
  }) as z.ZodType<Record<string, unknown>>,
  buildWrite(input: Record<string, unknown>, ids: { newId(): string }) {
    return {
      recordId: ids.newId(),
      input: {
        slot: { type: BOOKING_SLOT_KEY, id: input["slot"] },
        name: input["name"],
        email: input["email"],
        state: "pending",
      },
    };
  },
};

export const bookingModule: ModuleDefinition = {
  manifest: BOOKING_MANIFEST,
  beforeWrite,
  events: {
    afterWrite: { types: [BOOKING_RESERVATION_KEY], handle: handleAfterWrite },
  },
  onAlarm,
  publicEndpoints: { reservations: reservationEndpoint },
};
