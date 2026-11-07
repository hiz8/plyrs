import type { WorkflowStatus } from "@plyrs/metamodel";
import type { Via } from "@plyrs/sync-protocol";

// design-spec 16.8(M5c、決定 57、論点 B4): 提案(change set)の表の読み書き。エージェントの変更を record へ
// 直接書かず、採用・却下を待つ形で置く。中身(input)は作成時に解決した具体値で、変えるフィールドだけを持つ。
// 採用・却下の判断と書き込みは ops/proposals.ts(採用は既存の書き込みハンドラを通す)。ここは行の形と SQL だけ

export type ProposalKind = "create" | "update" | "delete" | "publish" | "unpublish";
export type ProposalState = "open" | "accepted" | "rejected";

export interface ProposalRow {
  id: string;
  recordId: string;
  type: string;
  kind: ProposalKind;
  state: ProposalState;
  input: Record<string, unknown> | null;
  changedFields: string[];
  status: WorkflowStatus | null;
  baseVersion: number;
  note: string | null;
  actor: string;
  via: Via;
  tokenId: string | null;
  clientId: string | null;
  createdAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
  resolutionNote: string | null;
  resultHistorySeq: number | null;
}

export type NewProposal = Omit<
  ProposalRow,
  "state" | "resolvedAt" | "resolvedBy" | "resolutionNote" | "resultHistorySeq"
>;

// 採用・却下から数えて、この日数を過ぎた行は次の proposal_create のついでに消す(1 回に消す上限つき)
export const PROPOSAL_RETENTION_DAYS = 90;
export const PROPOSAL_SWEEP_LIMIT = 50;

interface RawProposalRow extends Record<string, SqlStorageValue> {
  id: string;
  record_id: string;
  type: string;
  kind: string;
  state: string;
  input: string | null;
  changed_fields: string;
  status: string | null;
  base_version: number;
  note: string | null;
  actor: string;
  via: string;
  token_id: string | null;
  client_id: string | null;
  created_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
  resolution_note: string | null;
  result_history_seq: number | null;
}

const COLUMNS =
  "id, record_id, type, kind, state, input, changed_fields, status, base_version, note, actor, via, token_id, client_id, created_at, resolved_at, resolved_by, resolution_note, result_history_seq";

function rowToProposal(row: RawProposalRow): ProposalRow {
  return {
    id: row.id,
    recordId: row.record_id,
    type: row.type,
    kind: row.kind as ProposalKind,
    state: row.state as ProposalState,
    input: row.input === null ? null : (JSON.parse(row.input) as Record<string, unknown>),
    changedFields: JSON.parse(row.changed_fields) as string[],
    status: row.status as WorkflowStatus | null,
    baseVersion: row.base_version,
    note: row.note,
    actor: row.actor,
    via: row.via as Via,
    tokenId: row.token_id,
    clientId: row.client_id,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
    resolvedBy: row.resolved_by,
    resolutionNote: row.resolution_note,
    resultHistorySeq: row.result_history_seq,
  };
}

export function loadProposal(sql: SqlStorage, id: string): ProposalRow | null {
  const row = sql
    .exec<RawProposalRow>(`SELECT ${COLUMNS} FROM proposals WHERE id = ?`, id)
    .toArray()[0];
  return row === undefined ? null : rowToProposal(row);
}

export function insertProposal(sql: SqlStorage, row: NewProposal): void {
  sql.exec(
    `INSERT INTO proposals (${COLUMNS}) VALUES (?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL)`,
    row.id,
    row.recordId,
    row.type,
    row.kind,
    row.input === null ? null : JSON.stringify(row.input),
    JSON.stringify(row.changedFields),
    row.status,
    row.baseVersion,
    row.note,
    row.actor,
    row.via,
    row.tokenId,
    row.clientId,
    row.createdAt,
  );
}

export function resolveProposal(
  sql: SqlStorage,
  id: string,
  patch: {
    state: Exclude<ProposalState, "open">;
    resolvedAt: string;
    resolvedBy: string;
    resolutionNote?: string;
    resultHistorySeq?: number;
  },
): void {
  sql.exec(
    "UPDATE proposals SET state = ?, resolved_at = ?, resolved_by = ?, resolution_note = ?, result_history_seq = ? WHERE id = ?",
    patch.state,
    patch.resolvedAt,
    patch.resolvedBy,
    patch.resolutionNote ?? null,
    patch.resultHistorySeq ?? null,
    id,
  );
}

export interface ProposalListQuery {
  state?: ProposalState;
  recordId?: string;
  limit: number;
  cursor?: string;
}

// 新しい順。id は UUIDv7 なので id の降順が作成順の逆になる。cursor は最後に返した id
export function listProposals(
  sql: SqlStorage,
  query: ProposalListQuery,
): { items: ProposalRow[]; nextCursor: string | null } {
  const where: string[] = [];
  const params: SqlStorageValue[] = [];
  if (query.state !== undefined) {
    where.push("state = ?");
    params.push(query.state);
  }
  if (query.recordId !== undefined) {
    where.push("record_id = ?");
    params.push(query.recordId);
  }
  if (query.cursor !== undefined) {
    where.push("id < ?");
    params.push(query.cursor);
  }
  const clause = where.length === 0 ? "" : ` WHERE ${where.join(" AND ")}`;
  const rows = sql
    .exec<RawProposalRow>(
      `SELECT ${COLUMNS} FROM proposals${clause} ORDER BY id DESC LIMIT ?`,
      ...params,
      query.limit,
    )
    .toArray();
  const items = rows.map(rowToProposal);
  const last = items[items.length - 1];
  return {
    items,
    nextCursor: items.length === query.limit && last !== undefined ? last.id : null,
  };
}

export function countOpenProposals(sql: SqlStorage, recordId?: string): number {
  const row =
    recordId === undefined
      ? sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM proposals WHERE state = 'open'").one()
      : sql
          .exec<{ n: number }>(
            "SELECT COUNT(*) AS n FROM proposals WHERE state = 'open' AND record_id = ?",
            recordId,
          )
          .one();
  return row.n;
}

// 採用・却下から PROPOSAL_RETENTION_DAYS を過ぎた行を PROPOSAL_SWEEP_LIMIT 件まで消す。消した数を返す
export function sweepResolvedProposals(sql: SqlStorage, now: string): number {
  const threshold = new Date(
    Date.parse(now) - PROPOSAL_RETENTION_DAYS * 24 * 60 * 60_000,
  ).toISOString();
  const doomed = sql
    .exec<{ id: string }>(
      "SELECT id FROM proposals WHERE state != 'open' AND resolved_at IS NOT NULL AND resolved_at < ? ORDER BY resolved_at ASC LIMIT ?",
      threshold,
      PROPOSAL_SWEEP_LIMIT,
    )
    .toArray();
  for (const row of doomed) {
    sql.exec("DELETE FROM proposals WHERE id = ?", row.id);
  }
  return doomed.length;
}
