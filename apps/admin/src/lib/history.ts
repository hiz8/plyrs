import {
  richTextEnvelopeSchema,
  type ContentTypeDefinition,
  type FieldDefinition,
} from "@plyrs/metamodel";
import { richTextPlainText } from "@plyrs/richtext";
import { HISTORY_LABELS } from "./labels";

// 16.5(M2-5): 履歴画面の純関数。表示の文言と差分の整形(router と React に依存しない)

export type HistoryKind = "write" | "publish" | "unpublish" | "delete" | "restore";
export type HistoryVia = "sync" | "mcp" | "rest";

// apps/api の ops/history.ts の historyEntrySchema と同じ形(HTTP 契約)
export interface HistoryEntry {
  historySeq: number;
  kind: HistoryKind;
  version: number;
  sourceVersion: number | null;
  status: string;
  changedFields: string[];
  actor: string;
  via: HistoryVia;
  tokenId: string | null;
  clientId: string | null;
  restoredFrom: number | null;
  proposalId: string | null;
  createdAt: string;
  updatedAt: string;
}

export type VersionRef =
  | { ref: "history"; historySeq: number; version: number; at: string }
  | { ref: "published"; sourceVersion: number; at: string }
  | { ref: "current"; version: number; at: string };

export interface FieldChange {
  key: string;
  before: unknown;
  after: unknown;
}

export interface CompareResult {
  from: VersionRef;
  to: VersionRef;
  fields: FieldChange[];
}

// 履歴画面で選べる版: 履歴の 1 行か、公開版の疑似行
export type HistorySelection = { kind: "history"; historySeq: number } | { kind: "published" };

export interface MemberName {
  userId: string;
  email: string;
}

export function viaLabel(via: HistoryVia): string {
  return HISTORY_LABELS.via[via];
}

export function kindLabel(kind: HistoryKind): string {
  return HISTORY_LABELS.kind[kind];
}

// メンバー名(メールアドレス)が引ければそれ、無ければ ID の先頭 8 桁。モジュールや公開 write の
// actor(`module:booking` など)はそのまま
export function actorLabel(actor: string, members: readonly MemberName[] = []): string {
  const member = members.find((m) => m.userId === actor);
  if (member !== undefined) {
    return member.email;
  }
  return actor.includes(":") ? actor : actor.slice(0, 8);
}

// 「○○ が MCP から 3 フィールドを変更」のような 1 行の要約
export function summarizeEntry(entry: HistoryEntry, members: readonly MemberName[] = []): string {
  const who = actorLabel(entry.actor, members);
  const via = viaLabel(entry.via);
  switch (entry.kind) {
    case "publish":
      return HISTORY_LABELS.summary.publish(who, via);
    case "unpublish":
      return HISTORY_LABELS.summary.unpublish(who, via);
    case "delete":
      return HISTORY_LABELS.summary.delete(who, via);
    case "restore":
      return HISTORY_LABELS.summary.restore(who, via, entry.restoredFrom);
    case "write":
      return HISTORY_LABELS.summary.write(who, via, entry.changedFields.length);
  }
}

function isRef(value: unknown): value is { type: string; id: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { id?: unknown }).id === "string" &&
    typeof (value as { type?: unknown }).type === "string"
  );
}

// 差分表示の 1 セル。richtext は平文の抜粋、relation は参照 ID、文字列はそのまま、他は JSON
export function formatFieldValue(value: unknown, field: FieldDefinition | undefined): string {
  if (value === undefined || value === null) {
    return HISTORY_LABELS.unset;
  }
  if (field?.type === "richtext") {
    const envelope = richTextEnvelopeSchema.safeParse(value);
    if (!envelope.success) {
      return JSON.stringify(value);
    }
    const text = richTextPlainText(envelope.data, 120);
    return text === "" ? HISTORY_LABELS.emptyText : text;
  }
  if (field?.type === "relation" || isRef(value) || (Array.isArray(value) && value.every(isRef))) {
    const refs = Array.isArray(value) ? value : [value];
    return refs.length === 0
      ? HISTORY_LABELS.unset
      : refs.map((ref) => (isRef(ref) ? ref.id : JSON.stringify(ref))).join(", ");
  }
  if (typeof value === "string") {
    return value === "" ? HISTORY_LABELS.emptyText : value;
  }
  return JSON.stringify(value);
}

export interface FormattedFieldDiff {
  key: string;
  label: string;
  before: string;
  after: string;
}

export function formatFieldDiff(
  change: FieldChange,
  definition: ContentTypeDefinition | undefined,
): FormattedFieldDiff {
  const field = definition?.fields.find((f) => f.key === change.key);
  return {
    key: change.key,
    label: field?.label ?? change.key,
    before: formatFieldValue(change.before, field),
    after: formatFieldValue(change.after, field),
  };
}
