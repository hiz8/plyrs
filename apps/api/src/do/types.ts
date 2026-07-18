import type { WorkflowStatus } from "@plyrs/metamodel";

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
}

export type WriteErrorCode =
  | "unknown_type"
  | "validation_failed"
  | "invalid_status"
  | "record_deleted"
  | "unique_violation"
  | "forbidden";

// RPC 契約: actor はクライアント申告ではなく auth.userId 由来（サーバー側で合成）
export type WriteRecordInput = Omit<WriteRecordParams, "actor">;

// Phase 9: モジュールフックの拒否コードは `${moduleId}:${reason}` の名前空間必須
// (例 'booking:slot_full')。システム語彙(WriteErrorCode)と構造的に衝突しない。
// AckResult.code が string のまま保たれてきた理由の実装(ロードマップ §7)。
export type ModuleRejectionCode = `${string}:${string}`;

export type WriteRecordResult =
  | { ok: true; record: RecordSnapshot; changedFields: string[]; applied: boolean }
  | { ok: false; code: WriteErrorCode | ModuleRejectionCode; message: string };
