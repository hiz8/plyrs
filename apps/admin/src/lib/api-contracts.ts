// 管理 API の HTTP 契約の型。admin-api.ts と、それを使う各画面の両方が参照するので、画面の純関数(history.ts・proposals.ts)から切り出して置く

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

export type ProposalKind = "create" | "update" | "delete" | "publish" | "unpublish";
export type ProposalState = "open" | "accepted" | "rejected";

// apps/api の ops/proposals.ts の proposalSummarySchema と同じ形(HTTP 契約)
export interface ProposalSummary {
  id: string;
  recordId: string;
  type: string;
  kind: ProposalKind;
  state: ProposalState;
  changedFields: string[];
  status: string | null;
  /** record の今のワークフロー状態(record が無ければ null)。採用で status に変わる */
  currentStatus: string | null;
  baseVersion: number;
  currentVersion: number | null;
  /** 提案の後に record が変わった(採用すると提案のフィールドだけが上書きされる) */
  stale: boolean;
  note: string | null;
  actor: string;
  via: HistoryVia;
  tokenId: string | null;
  createdAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
  resolutionNote: string | null;
  resultHistorySeq: number | null;
}

export interface ProposalDetail extends ProposalSummary {
  input: Record<string, unknown> | null;
  /** 現在の内容との差分(create は空からの差分) */
  fields: FieldChange[];
}
