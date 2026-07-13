import {
  uuidSchema,
  WORKFLOW_STATUSES,
  type ContentTypeDefinition,
  type WorkflowStatus,
} from "@plyrs/metamodel";
import { z } from "zod";

export const PROTOCOL_VERSION = 1;

// ブラウザの WebSocket は Authorization ヘッダを付けられないため、
// トークンは Sec-WebSocket-Protocol で搬送する（["plyrs-sync", "token.<jwt>"]）。
export const SYNC_SUBPROTOCOL = "plyrs-sync";
export const TOKEN_PROTOCOL_PREFIX = "token.";

// RFC 6455 のアプリ定義クローズコード域（4000-4999）
export const CLOSE_CODES = {
  tokenExpired: 4001,
  protocolError: 4002,
  blocked: 4003,
} as const;

export const MAX_CHANGES_PER_PUSH = 100;

// keepalive: DO を起こさない auto-response のペア（サーバーは setWebSocketAutoResponse に使う）
export const KEEPALIVE_PING = "ping";
export const KEEPALIVE_PONG = "pong";

// ack の失敗コード語彙（クライアントの分岐実装用。モジュール拡張のため型は string のまま）
export const ACK_ERROR_CODES = [
  "forbidden",
  "unknown_type",
  "conflict",
  "validation_failed",
  "invalid_status",
  "record_deleted",
  "not_found",
  "already_deleted",
  "unique_violation",
  "internal_error",
] as const;

export type AckErrorCode = (typeof ACK_ERROR_CODES)[number];

// 同期の record 表現: relations を統合した「writeRecord の input 形式」を運ぶ。
// deletedAt !== null はトゥームストーン（input は {}）。
export interface SyncRecord {
  id: string;
  type: string;
  input: Record<string, unknown>;
  fieldVersions: Record<string, number>;
  status: WorkflowStatus;
  seq: number;
  version: number;
  deletedAt: string | null;
  updatedAt: string;
  updatedBy: string;
}

export interface FieldConflict {
  fieldKey: string;
  baseVersion: number;
  currentVersion: number;
}

export type AckResult =
  | { ok: true; record: SyncRecord }
  | { ok: false; code: string; message: string; conflicts?: FieldConflict[] };

export type ServerMessage =
  | {
      type: "welcome";
      protocolVersion: number;
      contentTypes: ContentTypeDefinition[];
      serverSeq: number;
    }
  | { type: "sync"; records: SyncRecord[]; serverSeq: number; complete: boolean }
  | { type: "ack"; changeId: string; result: AckResult }
  | { type: "change"; record: SyncRecord }
  | { type: "content-types"; contentTypes: ContentTypeDefinition[] }
  | { type: "error"; code: string; message: string };

const clientChangeSchema = z.strictObject({
  changeId: uuidSchema,
  recordId: uuidSchema,
  typeKey: z.string().min(1),
  op: z.enum(["upsert", "delete"]),
  input: z.record(z.string(), z.unknown()),
  changedFields: z.array(z.string()),
  baseFieldVersions: z.record(z.string(), z.number().int().nonnegative()),
  status: z.enum(WORKFLOW_STATUSES).optional(),
});

export type ClientChange = z.infer<typeof clientChangeSchema>;

export const clientMessageSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("hello"), checkpoint: z.number().int().nonnegative() }),
  z.strictObject({
    type: z.literal("push"),
    changes: z.array(clientChangeSchema).min(1).max(MAX_CHANGES_PER_PUSH),
  }),
]);

export type ClientMessage = z.infer<typeof clientMessageSchema>;

// 不正な入力で throw しない（WS の入口で例外を投げると接続ごと落ちるため）
export function parseClientMessage(raw: string): ClientMessage | null {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = clientMessageSchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}
