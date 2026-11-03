import { canonicalJson, type WorkflowStatus } from "@plyrs/metamodel";
import type { Via } from "@plyrs/sync-protocol";

// design-spec 16.5 / 決定 41(M2-3a): record の変更履歴。DO 内の record_history 表に record ごとの連番で
// 記録する。records.version は属性(publish では増えない)、publish の版は source_version で識別する。
//
// 区切り規則: 書き込みごとに版を作らない(同期の push は入力中の細かな差分で届く)。次のいずれかで
// 新しい版を切る: (1) actor または via が前の版と違う、(2) 前の版を開いてから 15 分以上、(3) status が
// 変わる、(4) publish / unpublish / delete / restore。それ以外の連続した write は直前の版に畳み込む。
//
// 保持(仮置き。M4-6 で実測): record ごとに最新 100 版かつ 365 日。直近 10 版は全文、それより古い版は
// 1 つ新しい版からの逆差分だけを持つ(新しい側から辿るので、古い版を消しても鎖が切れない)。
// publish / unpublish の版は常に全文で、保持上限に達しても record がある間は消さない。

export const HISTORY_FOLD_WINDOW_MS = 15 * 60_000;
export const HISTORY_FULL_VERSIONS = 10;
export const HISTORY_MAX_VERSIONS = 100;
export const HISTORY_MAX_AGE_MS = 365 * 24 * 60 * 60_000;

export type HistoryKind = "write" | "publish" | "unpublish" | "delete" | "restore";

// 版を切る対象外(record がある間は消さず、常に全文)の kind
const PINNED_KINDS: readonly HistoryKind[] = ["publish", "unpublish"];

export interface HistoryActor {
  actor: string;
  via: Via;
  tokenId?: string;
  clientId?: string;
}

export interface HistoryEntryInput extends HistoryActor {
  recordId: string;
  kind: HistoryKind;
  version: number;
  sourceVersion?: number;
  status: WorkflowStatus;
  data: Record<string, unknown>;
  fieldVersions: Record<string, number>;
  restoredFrom?: number;
}

export interface HistoryEntry {
  historySeq: number;
  kind: HistoryKind;
  version: number;
  sourceVersion: number | null;
  status: WorkflowStatus;
  changedFields: string[];
  actor: string;
  via: Via;
  tokenId: string | null;
  clientId: string | null;
  restoredFrom: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface HistoryVersion extends HistoryEntry {
  data: Record<string, unknown>;
  fieldVersions: Record<string, number>;
}

// 逆差分: 版 k を 1 つ新しい版 k+1 から復元するための {set, unset}
interface ReverseDiff {
  set: Record<string, unknown>;
  unset: string[];
}

interface RawHistoryRow extends Record<string, SqlStorageValue> {
  record_id: string;
  history_seq: number;
  kind: string;
  version: number;
  source_version: number | null;
  status: string;
  data: string | null;
  diff: string | null;
  field_versions: string;
  changed_fields: string;
  actor: string;
  via: string;
  token_id: string | null;
  client_id: string | null;
  restored_from: number | null;
  created_at: string;
  updated_at: string;
}

const COLUMNS =
  "record_id, history_seq, kind, version, source_version, status, data, diff, field_versions, changed_fields, actor, via, token_id, client_id, restored_from, created_at, updated_at";

function rowToEntry(row: RawHistoryRow): HistoryEntry {
  return {
    historySeq: row.history_seq,
    kind: row.kind as HistoryKind,
    version: row.version,
    sourceVersion: row.source_version,
    status: row.status as WorkflowStatus,
    changedFields: JSON.parse(row.changed_fields) as string[],
    actor: row.actor,
    via: row.via as Via,
    tokenId: row.token_id,
    clientId: row.client_id,
    restoredFrom: row.restored_from,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface FieldChange {
  key: string;
  before: unknown;
  after: unknown;
}

function unsetIfEmpty(value: unknown): unknown {
  return Array.isArray(value) && value.length === 0 ? undefined : value;
}

// 2 つの data の差分(値の比較は正規化 JSON)。履歴画面の差分表示と record_compare が使う
export function compareVersions(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): FieldChange[] {
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  const changes: FieldChange[] = [];
  for (const key of keys) {
    // 空配列は未設定と同じ(空の many-relation は読み戻すとキーが無い。ロードマップ 9 章)
    if (canonicalJson(unsetIfEmpty(before[key])) !== canonicalJson(unsetIfEmpty(after[key]))) {
      changes.push({ key, before: before[key], after: after[key] });
    }
  }
  return changes;
}

function changedKeys(
  before: Record<string, unknown> | null,
  after: Record<string, unknown>,
): string[] {
  if (before === null) {
    return Object.keys(after).sort();
  }
  return compareVersions(before, after).map((change) => change.key);
}

// 版 older を、1 つ新しい版 newer からの逆差分にする
function reverseDiff(older: Record<string, unknown>, newer: Record<string, unknown>): ReverseDiff {
  const set: Record<string, unknown> = {};
  const unset: string[] = [];
  for (const key of Object.keys(older)) {
    if (canonicalJson(older[key]) !== canonicalJson(newer[key])) {
      set[key] = older[key];
    }
  }
  for (const key of Object.keys(newer)) {
    if (!(key in older)) {
      unset.push(key);
    }
  }
  return { set, unset };
}

function applyReverseDiff(
  newer: Record<string, unknown>,
  diff: ReverseDiff,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...newer, ...diff.set };
  for (const key of diff.unset) {
    delete result[key];
  }
  return result;
}

function latestRow(sql: SqlStorage, recordId: string): RawHistoryRow | null {
  return (
    sql
      .exec<RawHistoryRow>(
        `SELECT ${COLUMNS} FROM record_history WHERE record_id = ? ORDER BY history_seq DESC LIMIT 1`,
        recordId,
      )
      .toArray()[0] ?? null
  );
}

function rowAtOffset(sql: SqlStorage, recordId: string, offset: number): RawHistoryRow | null {
  return (
    sql
      .exec<RawHistoryRow>(
        `SELECT ${COLUMNS} FROM record_history WHERE record_id = ? ORDER BY history_seq DESC LIMIT 1 OFFSET ?`,
        recordId,
        offset,
      )
      .toArray()[0] ?? null
  );
}

function shouldFold(latest: RawHistoryRow, entry: HistoryEntryInput, nowMs: number): boolean {
  return (
    entry.kind === "write" &&
    latest.kind === "write" &&
    latest.actor === entry.actor &&
    latest.via === entry.via &&
    latest.status === entry.status &&
    nowMs - Date.parse(latest.created_at) < HISTORY_FOLD_WINDOW_MS
  );
}

// 直近 HISTORY_FULL_VERSIONS 版の外に出た版を逆差分にする。挿入 1 回で境界を越えるのは 1 版なので
// 1 版だけ見る。publish / unpublish の版は全文のまま
function compact(sql: SqlStorage, recordId: string): void {
  const crossing = rowAtOffset(sql, recordId, HISTORY_FULL_VERSIONS);
  if (
    crossing === null ||
    crossing.data === null ||
    PINNED_KINDS.includes(crossing.kind as HistoryKind)
  ) {
    return;
  }
  const newer = rowAtOffset(sql, recordId, HISTORY_FULL_VERSIONS - 1);
  if (newer === null || newer.data === null) {
    return; // 直近の版は常に全文なのでここには来ない(来たら全文のまま残す)
  }
  const diff = reverseDiff(
    JSON.parse(crossing.data) as Record<string, unknown>,
    JSON.parse(newer.data) as Record<string, unknown>,
  );
  sql.exec(
    "UPDATE record_history SET data = NULL, diff = ? WHERE record_id = ? AND history_seq = ?",
    JSON.stringify(diff),
    recordId,
    crossing.history_seq,
  );
}

// 古い側から保持上限(本数・期間)を超えた版を消す。publish / unpublish の版は残す。
// 消すのは常に「古い側の連続した区間(publish 版を除く)」なので、残る版の逆差分の鎖は切れない
function prune(sql: SqlStorage, recordId: string, nowMs: number): void {
  const rows = sql
    .exec<Pick<RawHistoryRow, "history_seq" | "kind" | "updated_at">>(
      "SELECT history_seq, kind, updated_at FROM record_history WHERE record_id = ? ORDER BY history_seq DESC",
      recordId,
    )
    .toArray();
  const doomed: number[] = [];
  rows.forEach((row, indexFromNewest) => {
    if (PINNED_KINDS.includes(row.kind as HistoryKind)) {
      return;
    }
    const tooMany = indexFromNewest >= HISTORY_MAX_VERSIONS;
    const tooOld = nowMs - Date.parse(row.updated_at) > HISTORY_MAX_AGE_MS;
    if (tooMany || tooOld) {
      doomed.push(row.history_seq);
    }
  });
  for (const seq of doomed) {
    sql.exec("DELETE FROM record_history WHERE record_id = ? AND history_seq = ?", recordId, seq);
  }
}

// 版を記録して history_seq を返す。write が区切り条件に当たらなければ直前の版に畳み込み、同じ seq を返す
export function recordHistory(sql: SqlStorage, now: string, entry: HistoryEntryInput): number {
  const nowMs = Date.parse(now);
  const latest = latestRow(sql, entry.recordId);
  if (latest !== null && shouldFold(latest, entry, nowMs)) {
    const older = rowAtOffset(sql, entry.recordId, 1);
    const olderData =
      older === null || older.data === null
        ? null
        : (JSON.parse(older.data) as Record<string, unknown>);
    sql.exec(
      "UPDATE record_history SET data = ?, field_versions = ?, changed_fields = ?, version = ?, updated_at = ? WHERE record_id = ? AND history_seq = ?",
      JSON.stringify(entry.data),
      JSON.stringify(entry.fieldVersions),
      JSON.stringify(changedKeys(olderData, entry.data)),
      entry.version,
      now,
      entry.recordId,
      latest.history_seq,
    );
    return latest.history_seq;
  }
  const seq = (latest?.history_seq ?? 0) + 1;
  const previousData =
    latest === null || latest.data === null
      ? null
      : (JSON.parse(latest.data) as Record<string, unknown>);
  const changed =
    entry.kind === "write" || entry.kind === "restore" ? changedKeys(previousData, entry.data) : [];
  sql.exec(
    `INSERT INTO record_history (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    entry.recordId,
    seq,
    entry.kind,
    entry.version,
    entry.sourceVersion ?? null,
    entry.status,
    JSON.stringify(entry.data),
    JSON.stringify(entry.fieldVersions),
    JSON.stringify(changed),
    entry.actor,
    entry.via,
    entry.tokenId ?? null,
    entry.clientId ?? null,
    entry.restoredFrom ?? null,
    now,
    now,
  );
  compact(sql, entry.recordId);
  prune(sql, entry.recordId, nowMs);
  return seq;
}

export interface HistoryPage {
  items: HistoryEntry[];
  nextCursor: string | null;
}

// 新しい順。cursor は最後に返した history_seq
export function loadHistory(
  sql: SqlStorage,
  recordId: string,
  options: { limit: number; cursor?: string | null },
): HistoryPage {
  const before =
    options.cursor === undefined || options.cursor === null ? null : Number(options.cursor);
  const rows =
    before === null || !Number.isFinite(before)
      ? sql
          .exec<RawHistoryRow>(
            `SELECT ${COLUMNS} FROM record_history WHERE record_id = ? ORDER BY history_seq DESC LIMIT ?`,
            recordId,
            options.limit,
          )
          .toArray()
      : sql
          .exec<RawHistoryRow>(
            `SELECT ${COLUMNS} FROM record_history WHERE record_id = ? AND history_seq < ? ORDER BY history_seq DESC LIMIT ?`,
            recordId,
            before,
            options.limit,
          )
          .toArray();
  const items = rows.map(rowToEntry);
  const last = items[items.length - 1];
  return {
    items,
    nextCursor:
      items.length === options.limit && last !== undefined ? String(last.historySeq) : null,
  };
}

// 差分化された版は、新しい側の全文の版から逆差分を順に当てて復元する
export function loadVersion(
  sql: SqlStorage,
  recordId: string,
  historySeq: number,
): HistoryVersion | null {
  const rows = sql
    .exec<RawHistoryRow>(
      `SELECT ${COLUMNS} FROM record_history WHERE record_id = ? AND history_seq >= ? ORDER BY history_seq ASC`,
      recordId,
      historySeq,
    )
    .toArray();
  const target = rows[0];
  if (target === undefined || target.history_seq !== historySeq) {
    return null;
  }
  const fullIndex = rows.findIndex((row) => row.data !== null);
  if (fullIndex === -1) {
    return null; // 鎖の先に全文が無い(起こらない想定。保持は古い側からしか消さない)
  }
  const full = rows[fullIndex];
  if (full === undefined || full.data === null) {
    return null;
  }
  let data = JSON.parse(full.data) as Record<string, unknown>;
  for (let i = fullIndex - 1; i >= 0; i--) {
    const row = rows[i];
    if (row === undefined || row.diff === null) {
      return null;
    }
    data = applyReverseDiff(data, JSON.parse(row.diff) as ReverseDiff);
  }
  return {
    ...rowToEntry(target),
    data,
    fieldVersions: JSON.parse(target.field_versions) as Record<string, number>,
  };
}
