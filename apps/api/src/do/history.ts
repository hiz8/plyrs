import { canonicalJson, type WorkflowStatus } from "@plyrs/metamodel";
import type { Via } from "@plyrs/sync-protocol";

// design-spec 16.5 / 決定 41(M2-3a): record の変更履歴。DO 内の record_history 表に record ごとの連番で
// 記録する。records.version は属性(publish では増えない)、publish の版は source_version で識別する。
//
// 区切り規則: 書き込みごとに版を作らない(同期の push は入力中の細かな差分で届く)。次のいずれかで
// 新しい版を切る: (1) actor または via が前の版と違う、(2) 前の版を開いてから 15 分以上、(3) status が
// 変わる、(4) publish / unpublish / delete / restore。それ以外の連続した write は直前の版に畳み込む。
//
// 保持(M4-6 で実測し据え置き。ロードマップ 11 章): record ごとに最新 100 版かつ 365 日。直近 10 版は全文、それより古い版は
// 1 つ新しい版からの逆差分だけを持つ(新しい側から辿るので、古い版を消しても鎖が切れない)。
// publish / unpublish の版は常に全文で、保持上限に達しても record がある間は消さない。
//
// 逆差分の形(決定 53、M5a-1): リッチテキストの値は、古い版の本文を「新しい版の同じ ID の最上位
// ブロックの参照」と「変わったブロックの実体」の列で持つ(blocks)。作るときに当て直して元に戻ることを
// 確かめ、戻らない・短くならないなら従来どおり値全体(set)。M4 までの {set, unset} だけの行は書き換えず
// そのまま読む。

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

// 古い版のリッチテキストの値 = base(doc.content を除いた部分)+ content(新しい版の同じ ID の最上位
// ブロックの参照か、ブロックの実体)
export interface BlockPatch {
  base: Record<string, unknown>;
  content: Array<{ ref: string } | { node: unknown }>;
}

// 逆差分: 版 k を 1 つ新しい版 k+1 から復元するための {set, unset, blocks?}。blocks は M5a 以降の行
// だけが持ち、キーは set と重ならない
interface ReverseDiff {
  set: Record<string, unknown>;
  unset: string[];
  blocks?: Record<string, BlockPatch>;
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// リッチテキストのエンベロープの形(doc.content が配列)なら、doc と content を返す。richtext かどうかは
// 型定義を引かずに値の形で判定する(履歴は型定義の変更をまたぐ)
function envelopeParts(
  value: unknown,
): { doc: Record<string, unknown>; content: unknown[] } | null {
  if (!isPlainObject(value) || !isPlainObject(value.doc) || !Array.isArray(value.doc.content)) {
    return null;
  }
  return { doc: value.doc, content: value.doc.content };
}

function blockIdOf(block: unknown): string | null {
  if (!isPlainObject(block) || !isPlainObject(block.attrs)) {
    return null;
  }
  const id = block.attrs.id;
  return typeof id === "string" && id !== "" ? id : null;
}

// 新しい側の最上位ブロックを ID で引く表。ID の無いブロックか重複した ID があれば null
function blocksById(content: unknown[]): Map<string, unknown> | null {
  const byId = new Map<string, unknown>();
  for (const block of content) {
    const id = blockIdOf(block);
    if (id === null || byId.has(id)) {
      return null;
    }
    byId.set(id, block);
  }
  return byId;
}

// 新しい版の値にパッチを当てて古い版の値を作る。参照先のブロックが無ければ null(鎖が正しければ起きない)
export function applyBlockPatch(newer: unknown, patch: BlockPatch): unknown {
  const parts = envelopeParts(newer);
  if (parts === null || !isPlainObject(patch.base) || !isPlainObject(patch.base.doc)) {
    return null;
  }
  const byId = blocksById(parts.content);
  if (byId === null) {
    return null;
  }
  const content: unknown[] = [];
  for (const item of patch.content) {
    if ("ref" in item) {
      if (!byId.has(item.ref)) {
        return null;
      }
      content.push(byId.get(item.ref));
    } else {
      content.push(item.node);
    }
  }
  return { ...patch.base, doc: { ...patch.base.doc, content } };
}

// 古い版の値を、新しい版の最上位ブロックの参照で表す。表せない・元に戻らない・短くならないなら null
export function blockPatchOf(older: unknown, newer: unknown): BlockPatch | null {
  const olderParts = envelopeParts(older);
  const newerParts = envelopeParts(newer);
  if (olderParts === null || newerParts === null || !isPlainObject(older)) {
    return null;
  }
  const byId = blocksById(newerParts.content);
  if (byId === null) {
    return null;
  }
  const { content: _content, ...docRest } = olderParts.doc;
  const patch: BlockPatch = {
    base: { ...older, doc: docRest },
    content: olderParts.content.map((block) => {
      const id = blockIdOf(block);
      return id !== null && byId.has(id) && canonicalJson(byId.get(id)) === canonicalJson(block)
        ? { ref: id }
        : { node: block };
    }),
  };
  // 当て直して元に戻ることを確かめる(JSON を一度通した値で比べる。保存されるのは JSON なので)
  const restored = applyBlockPatch(newer, JSON.parse(JSON.stringify(patch)) as BlockPatch);
  if (restored === null || canonicalJson(restored) !== canonicalJson(older)) {
    return null;
  }
  if (JSON.stringify(patch).length >= JSON.stringify(older).length) {
    return null;
  }
  return patch;
}

// 版 older を、1 つ新しい版 newer からの逆差分にする
function reverseDiff(older: Record<string, unknown>, newer: Record<string, unknown>): ReverseDiff {
  const set: Record<string, unknown> = {};
  const unset: string[] = [];
  const blocks: Record<string, BlockPatch> = {};
  for (const key of Object.keys(older)) {
    if (canonicalJson(older[key]) !== canonicalJson(newer[key])) {
      const patch = key in newer ? blockPatchOf(older[key], newer[key]) : null;
      if (patch !== null) {
        blocks[key] = patch;
      } else {
        set[key] = older[key];
      }
    }
  }
  for (const key of Object.keys(newer)) {
    if (!(key in older)) {
      unset.push(key);
    }
  }
  return Object.keys(blocks).length === 0 ? { set, unset } : { set, unset, blocks };
}

// 当てられないブロックの参照があれば null(壊れた版を復元に使わない)
function applyReverseDiff(
  newer: Record<string, unknown>,
  diff: ReverseDiff,
): Record<string, unknown> | null {
  const result: Record<string, unknown> = { ...newer, ...diff.set };
  for (const [key, patch] of Object.entries(diff.blocks ?? {})) {
    const value = applyBlockPatch(newer[key], patch);
    if (value === null) {
      return null;
    }
    result[key] = value;
  }
  for (const key of diff.unset) {
    delete result[key];
  }
  return result;
}

// 16.8: record の最新の history_seq(履歴が無ければ 0)。publish / unpublish は畳み込まずに必ず版を
// 足し、刈り込みも最新は残すので、公開状態の変化を含めて単調に増える
export function latestHistorySeq(sql: SqlStorage, recordId: string): number {
  return latestRow(sql, recordId)?.history_seq ?? 0;
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
  let data: Record<string, unknown> | null = JSON.parse(full.data) as Record<string, unknown>;
  for (let i = fullIndex - 1; i >= 0; i--) {
    const row = rows[i];
    if (row === undefined || row.diff === null) {
      return null;
    }
    data = applyReverseDiff(data, JSON.parse(row.diff) as ReverseDiff);
    if (data === null) {
      return null;
    }
  }
  return {
    ...rowToEntry(target),
    data,
    fieldVersions: JSON.parse(target.field_versions) as Record<string, number>,
  };
}
