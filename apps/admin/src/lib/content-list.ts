import type { SyncRecord } from "@plyrs/sync-protocol";

// 案 D 3〜8 章: コンテンツの一覧の絞り込み・並べ替え・ページ送りと、URL クエリとの相互変換。
// 一覧のデータは同期で手元にあるため、すべて画面側の純関数で行う(サーバーへの問い合わせは不要)。

// URL の値をそのまま使う(例: ?tab=unpublished-changes)
export const LIST_TABS = [
  "all",
  "published",
  "unpublished-changes",
  "unpublished",
  "archived",
] as const;
export type ListTab = (typeof LIST_TABS)[number];

// ステータスの絞り込み(アーカイブはタブで扱う)
export const LIST_STATUSES = ["draft", "in_review", "ready"] as const;
export type ListStatus = (typeof LIST_STATUSES)[number];

export const LIST_SORTS = ["updated", "title"] as const;
export type ListSort = (typeof LIST_SORTS)[number];
export type SortOrder = "asc" | "desc";

export const PER_PAGE_OPTIONS = [20, 50, 100] as const;
export type PerPage = (typeof PER_PAGE_OPTIONS)[number];

export interface ListQuery {
  tab: ListTab;
  status: ListStatus | undefined;
  q: string;
  sort: ListSort;
  order: SortOrder;
  page: number;
  perPage: PerPage;
}

// 既定: すべて、更新日時の新しい順、1 ページ 20 件(案 D 5・7 章)
const DEFAULT_ORDER: Record<ListSort, SortOrder> = { updated: "desc", title: "asc" };

export const DEFAULT_LIST_QUERY: ListQuery = {
  tab: "all",
  status: undefined,
  q: "",
  sort: "updated",
  order: DEFAULT_ORDER.updated,
  page: 1,
  perPage: 20,
};

function oneOf<T extends string | number>(values: readonly T[], value: unknown): T | undefined {
  return (values as readonly unknown[]).includes(value) ? (value as T) : undefined;
}

function positiveInt(value: unknown): number | undefined {
  const parsed =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : undefined;
}

// URL クエリ(TanStack Router の validateSearch に渡る値)から。手で書き換えられた不正な値は既定に戻す
export function parseListQuery(search: Record<string, unknown>): ListQuery {
  const sort = oneOf(LIST_SORTS, search["sort"]) ?? DEFAULT_LIST_QUERY.sort;
  return {
    tab: oneOf(LIST_TABS, search["tab"]) ?? DEFAULT_LIST_QUERY.tab,
    status: oneOf(LIST_STATUSES, search["status"]),
    q: typeof search["q"] === "string" ? search["q"] : "",
    sort,
    order: oneOf(["asc", "desc"] as const, search["order"]) ?? DEFAULT_ORDER[sort],
    page: positiveInt(search["page"]) ?? 1,
    perPage: oneOf(PER_PAGE_OPTIONS, positiveInt(search["perPage"])) ?? DEFAULT_LIST_QUERY.perPage,
  };
}

// URL クエリへ。既定値は省き、URL を短く保つ(ホームから絞り込み済みの一覧へリンクするときにも使う)
export function toListSearch(query: Partial<ListQuery>): Record<string, string | number> {
  const full = { ...DEFAULT_LIST_QUERY, ...query };
  const search: Record<string, string | number> = {};
  if (full.tab !== DEFAULT_LIST_QUERY.tab) {
    search["tab"] = full.tab;
  }
  if (full.status !== undefined) {
    search["status"] = full.status;
  }
  if (full.q !== "") {
    search["q"] = full.q;
  }
  if (full.sort !== DEFAULT_LIST_QUERY.sort) {
    search["sort"] = full.sort;
  }
  if (full.order !== DEFAULT_ORDER[full.sort]) {
    search["order"] = full.order;
  }
  if (full.page !== 1) {
    search["page"] = full.page;
  }
  if (full.perPage !== DEFAULT_LIST_QUERY.perPage) {
    search["perPage"] = full.perPage;
  }
  return search;
}

// 公開状態の 3 値(design-spec §7 の version 比較。公開状態パネルと同じ判定)
export type ListPublicationState = "published" | "changed" | "unpublished";

export function publicationStateOf(
  record: Pick<SyncRecord, "version">,
  publication: { sourceVersion: number } | undefined,
): ListPublicationState {
  if (publication === undefined) {
    return "unpublished";
  }
  return record.version > publication.sourceVersion ? "changed" : "published";
}

export interface ListRow {
  record: SyncRecord;
  title: string;
  publication: ListPublicationState;
}

// 削除済み(トゥームストーン)は一覧に出さない
export function buildListRows(
  records: readonly SyncRecord[],
  publications: ReadonlyMap<string, { sourceVersion: number }>,
  titleOf: (record: SyncRecord) => string,
): ListRow[] {
  return records
    .filter((record) => record.deletedAt === null)
    .map((record) => ({
      record,
      title: titleOf(record),
      publication: publicationStateOf(record, publications.get(record.id)),
    }));
}

function matchesTab(row: ListRow, tab: ListTab): boolean {
  const archived = row.record.status === "archived";
  switch (tab) {
    case "all":
      return !archived;
    case "published":
      return row.publication !== "unpublished";
    case "unpublished-changes":
      return row.publication === "changed";
    case "unpublished":
      return row.publication === "unpublished" && !archived;
    case "archived":
      return archived;
  }
}

// 全角・半角や大文字・小文字の違いを無視して部分一致させる
function normalizeForSearch(text: string): string {
  return text.normalize("NFKC").toLocaleLowerCase("ja");
}

export function tabCounts(rows: readonly ListRow[]): Record<ListTab, number> {
  const counts = Object.fromEntries(LIST_TABS.map((tab) => [tab, 0])) as Record<ListTab, number>;
  for (const row of rows) {
    for (const tab of LIST_TABS) {
      if (matchesTab(row, tab)) {
        counts[tab] += 1;
      }
    }
  }
  return counts;
}

export function filterRows(
  rows: readonly ListRow[],
  query: Pick<ListQuery, "tab" | "status" | "q">,
): ListRow[] {
  const needle = normalizeForSearch(query.q.trim());
  return rows.filter(
    (row) =>
      matchesTab(row, query.tab) &&
      (query.status === undefined || row.record.status === query.status) &&
      (needle === "" || normalizeForSearch(row.title).includes(needle)),
  );
}

const titleCollator = new Intl.Collator("ja", { numeric: true, sensitivity: "base" });

export function sortRows(rows: readonly ListRow[], sort: ListSort, order: SortOrder): ListRow[] {
  const direction = order === "asc" ? 1 : -1;
  return rows.toSorted((a, b) => {
    const primary =
      sort === "title"
        ? titleCollator.compare(a.title, b.title)
        : Date.parse(a.record.updatedAt) - Date.parse(b.record.updatedAt);
    // 同順位は id(UUIDv7 = 作成順)で並びを固定する
    return direction * (primary !== 0 ? primary : a.record.id.localeCompare(b.record.id));
  });
}

export interface Page<T> {
  items: T[];
  /** 範囲外のページ指定は最後のページに寄せた値 */
  page: number;
  pageCount: number;
  total: number;
}

export function paginate<T>(items: readonly T[], page: number, perPage: number): Page<T> {
  const pageCount = Math.max(1, Math.ceil(items.length / perPage));
  const current = Math.min(Math.max(1, page), pageCount);
  const start = (current - 1) * perPage;
  return {
    items: items.slice(start, start + perPage),
    page: current,
    pageCount,
    total: items.length,
  };
}

export interface ListView extends Page<ListRow> {
  counts: Record<ListTab, number>;
}

export function applyListQuery(rows: readonly ListRow[], query: ListQuery): ListView {
  const filtered = filterRows(rows, query);
  const sorted = sortRows(filtered, query.sort, query.order);
  return { ...paginate(sorted, query.page, query.perPage), counts: tabCounts(rows) };
}

// 案 D 6 章: 一括操作はレコードごとの API(公開・取り下げ)や同期の書き込みを 1 件ずつ順に行う。
// 一部が失敗しても残りは続け、成功と失敗を分けて返す(失敗したものを選択状態で残すため)。
export interface BulkResult {
  succeeded: string[];
  failed: { id: string; cause: unknown }[];
}

export async function runBulk(
  ids: readonly string[],
  action: (id: string) => Promise<void>,
  onProgress?: (done: number, total: number) => void,
): Promise<BulkResult> {
  const result: BulkResult = { succeeded: [], failed: [] };
  for (const [index, id] of ids.entries()) {
    try {
      await action(id);
      result.succeeded.push(id);
    } catch (cause) {
      result.failed.push({ id, cause });
    }
    onProgress?.(index + 1, ids.length);
  }
  return result;
}
