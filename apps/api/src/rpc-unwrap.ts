import type { ContentTypeRow, RegisterContentTypeResult } from "./do/content-types";
import type { DeleteRecordResult } from "./do/delete-record";
import type { RecordSnapshot, WriteRecordResult } from "./do/types";

// Cloudflare の Rpc.Result 型は Record<string, unknown>（RecordSnapshot.data）を
// Serializable と証明できず、ok:true 側の union 枝を never に潰す（実行時の直列化は正しい）。
// RPC 戻り値を実型へ戻す唯一の境界。@ts-expect-error での抑止は禁止。
export function asWriteResult(value: unknown): WriteRecordResult {
  return value as WriteRecordResult;
}

export function asRecordSnapshot(value: unknown): RecordSnapshot | null {
  return value as RecordSnapshot | null;
}

export function asDeleteResult(value: unknown): DeleteRecordResult {
  return value as DeleteRecordResult;
}

export function asRegisterResult(value: unknown): RegisterContentTypeResult {
  return value as RegisterContentTypeResult;
}

export function asContentTypeRow(value: unknown): ContentTypeRow | null {
  return value as ContentTypeRow | null;
}
