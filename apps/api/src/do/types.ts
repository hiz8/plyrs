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
  | "unique_violation";

export type WriteRecordResult =
  | { ok: true; record: RecordSnapshot; changedFields: string[]; applied: boolean }
  | { ok: false; code: WriteErrorCode; message: string };
