import type { ContentTypeDefinition } from "@plyrs/metamodel";
import type { ModuleManifest } from "../manifest";

// design-spec §9.8: 予約 = resource / slot / reservation の型合成 + 状態スカラー。
// 「属性を持つ関係のコンテンツ型化」の実例。notification は確認メール送信の代替
// (面4 の外部送信は非目標のまま)で、afterWrite イベントの冪等消化を担う。
export const BOOKING_MODULE_ID = "booking";

export const BOOKING_RESOURCE_KEY = "booking.resource";
export const BOOKING_SLOT_KEY = "booking.slot";
export const BOOKING_RESERVATION_KEY = "booking.reservation";
export const BOOKING_NOTIFICATION_KEY = "booking.notification";

// 全テナント共通の固定 ID(asset 型と同じ予約値方式。uuidSchema を満たす hex のみ)
const RESOURCE_TYPE_ID = "00000000-0000-7000-8000-00000b00c001";
const SLOT_TYPE_ID = "00000000-0000-7000-8000-00000b00c002";
const RESERVATION_TYPE_ID = "00000000-0000-7000-8000-00000b00c003";
const NOTIFICATION_TYPE_ID = "00000000-0000-7000-8000-00000b00c004";

export const BOOKING_RESERVATION_STATES = ["pending", "confirmed", "cancelled"] as const;

const contentTypes: ContentTypeDefinition[] = [
  {
    id: RESOURCE_TYPE_ID,
    key: BOOKING_RESOURCE_KEY,
    name: "予約リソース",
    source: "plugin",
    pluginId: BOOKING_MODULE_ID,
    version: 1,
    fields: [{ key: "name", type: "text", required: true, config: { maxLength: 200 } }],
  },
  {
    id: SLOT_TYPE_ID,
    key: BOOKING_SLOT_KEY,
    name: "予約枠",
    source: "plugin",
    pluginId: BOOKING_MODULE_ID,
    version: 1,
    fields: [
      {
        key: "resource",
        type: "relation",
        required: true,
        config: { allowedTypes: [BOOKING_RESOURCE_KEY], cardinality: "one" },
      },
      { key: "starts_at", type: "datetime", required: true, config: { indexed: true } },
      { key: "ends_at", type: "datetime", required: true },
      { key: "capacity", type: "number", required: true, config: { integer: true } },
    ],
  },
  {
    id: RESERVATION_TYPE_ID,
    key: BOOKING_RESERVATION_KEY,
    name: "予約",
    source: "plugin",
    pluginId: BOOKING_MODULE_ID,
    version: 1,
    fields: [
      {
        key: "slot",
        type: "relation",
        required: true,
        config: { allowedTypes: [BOOKING_SLOT_KEY], cardinality: "one" },
      },
      { key: "name", type: "text", required: true, config: { maxLength: 200 } },
      { key: "email", type: "text", required: true, config: { maxLength: 320 } },
      {
        key: "state",
        type: "select",
        required: true,
        config: {
          options: [
            { value: "pending", label: "仮予約" },
            { value: "confirmed", label: "確定" },
            { value: "cancelled", label: "取消" },
          ],
          indexed: true,
        },
      },
    ],
  },
  {
    id: NOTIFICATION_TYPE_ID,
    key: BOOKING_NOTIFICATION_KEY,
    name: "予約通知",
    source: "plugin",
    pluginId: BOOKING_MODULE_ID,
    version: 1,
    fields: [
      // afterWrite の at-least-once 配送を冪等に畳む鍵(unique 制約 → 二重配送は unique_violation)
      {
        key: "reservation_id",
        type: "text",
        required: true,
        config: { maxLength: 64, unique: true },
      },
      { key: "kind", type: "text", required: true, config: { maxLength: 64 } },
    ],
  },
];

export const BOOKING_MANIFEST: ModuleManifest = {
  moduleId: BOOKING_MODULE_ID,
  version: 1,
  name: "予約",
  contentTypes,
  // manage = owner のみ(editor のデフォルト record:write より狭める実証 — 2026-07-18 設計確定)
  permissions: [{ key: "manage", roles: ["owner"] }],
  typeWriteGuards: {
    [BOOKING_RESERVATION_KEY]: "manage",
    [BOOKING_NOTIFICATION_KEY]: "manage",
  },
  publicWriteTypes: [BOOKING_RESERVATION_KEY],
};
