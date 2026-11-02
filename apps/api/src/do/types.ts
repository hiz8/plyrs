import type { WorkflowStatus } from "@plyrs/metamodel";
import type { Via } from "@plyrs/sync-protocol";

export interface RecordSnapshot {
  id: string;
  type: string;
  data: Record<string, unknown>;
  fieldVersions: Record<string, number>;
  status: WorkflowStatus;
  seq: number;
  version: number;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string;
  deletedAt: string | null;
}

export interface WriteRecordParams {
  recordId: string;
  input: Record<string, unknown>;
  status?: WorkflowStatus;
  actor: string;
  // M2-3a(16.5): 変更履歴に記録する経路と、MCP のトークン情報。actor と同じくサーバー側で合成する
  via: Via;
  tokenId?: string;
  clientId?: string;
  // record_restore(M2-4)が復元元の history_seq を刻む。履歴の kind が restore になる
  restoredFrom?: number;
}

export type WriteErrorCode =
  | "unknown_type"
  | "validation_failed"
  | "invalid_status"
  | "record_deleted"
  | "unique_violation"
  | "forbidden";

// RPC 契約: actor・via・tokenId・clientId はクライアント申告ではなく auth と経路から合成する
export type WriteRecordInput = Omit<
  WriteRecordParams,
  "actor" | "via" | "tokenId" | "clientId" | "restoredFrom"
>;

// Phase 9: モジュールフックの拒否コードは `${moduleId}:${reason}` の名前空間必須
// (例 'booking:slot_full')。システムが定義するコード(WriteErrorCode)と構造的に衝突しない。
// AckResult.code が string のまま保たれてきた理由の実装(ロードマップ §7)。
export type ModuleRejectionCode = `${string}:${string}`;

export type WriteRecordResult =
  | { ok: true; record: RecordSnapshot; changedFields: string[]; applied: boolean }
  | { ok: false; code: WriteErrorCode | ModuleRejectionCode; message: string };
