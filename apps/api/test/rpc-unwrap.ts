import type { RecordSnapshot, WriteRecordResult } from "../src/do/types";

// Cloudflare の Rpc.Result 型は Record<string, unknown>（RecordSnapshot.data）を
// Serializable と証明できず、ok:true 側の union 枝を never に潰す（実行時の直列化は正しい）。
// テスト側で実型へ戻す唯一の境界。@ts-expect-error での抑止は禁止。
export function asWriteResult(value: unknown): WriteRecordResult {
  return value as WriteRecordResult;
}

export function asRecordSnapshot(value: unknown): RecordSnapshot | null {
  return value as RecordSnapshot | null;
}
