import type { AssetUsageRow } from "./do/asset-usage";
import type { ContentTypeRow, RegisterContentTypeResult } from "./do/content-types";
import type { DeleteRecordResult } from "./do/delete-record";
import type { PublicationState, PublishResult, UnpublishResult } from "./do/publish";
import type { RecordSnapshot, WriteRecordResult } from "./do/types";
import type { EnableModuleResult, ModuleSummary } from "./modules/enablement";
import type { CatalogRow, ProjectionPayload } from "./projection/payload";

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

export function asContentTypeRows(value: unknown): ContentTypeRow[] {
  return value as ContentTypeRow[];
}

export function asPublishResult(value: unknown): PublishResult {
  return value as PublishResult;
}

export function asUnpublishResult(value: unknown): UnpublishResult {
  return value as UnpublishResult;
}

export function asProjectionPayload(value: unknown): ProjectionPayload | null {
  return value as ProjectionPayload | null;
}

export function asPublishedPage(value: unknown): {
  payloads: ProjectionPayload[];
  nextCursor: string | null;
} {
  return value as { payloads: ProjectionPayload[]; nextCursor: string | null };
}

export function asReprojectResult(
  value: unknown,
): { ok: true; epoch: number } | { ok: false; code: "forbidden"; message: string } {
  return value as { ok: true; epoch: number } | { ok: false; code: "forbidden"; message: string };
}

export function asProjectionCatalog(value: unknown): { type: string; catalog: CatalogRow[] }[] {
  return value as { type: string; catalog: CatalogRow[] }[];
}

export function asPublicationState(value: unknown): PublicationState {
  return value as PublicationState;
}

export function asOrphanIds(value: unknown): string[] {
  return value as string[];
}

export function asAssetUsage(value: unknown): AssetUsageRow[] {
  return value as AssetUsageRow[];
}

export function asModuleSummaries(value: unknown): ModuleSummary[] {
  return value as ModuleSummary[];
}

export function asEnableModuleResult(value: unknown): EnableModuleResult {
  return value as EnableModuleResult;
}
