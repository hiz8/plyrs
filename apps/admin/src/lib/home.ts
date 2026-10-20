import type { ContentTypeDefinition, WorkflowStatus } from "@plyrs/metamodel";
import type { SyncRecord } from "@plyrs/sync-protocol";
import type { ModuleSummary } from "./admin-api";
import { publicationStateOf, toListSearch, type ListQuery } from "./content-list";
import { moduleNavGroups, sidebarContentTypes } from "./navigation";

// b-home.md: ホームの集計。型をまたいだ record の並べ替え・件数・リンク先を純関数で持つ。

export interface HomeType {
  key: string;
  name: string;
  group: "content" | "module";
}

/** サイドバーと同じ順(B14)。同じ key が両群に出たら最初だけ */
export function homeTypes(
  types: readonly ContentTypeDefinition[],
  modules: readonly Pick<ModuleSummary, "moduleId" | "name" | "enabled" | "navTypes">[] | undefined,
): HomeType[] {
  const result: HomeType[] = [];
  const seen = new Set<string>();
  const add = (key: string, name: string, group: HomeType["group"]) => {
    if (seen.has(key)) return;
    seen.add(key);
    result.push({ key, name, group });
  };
  for (const type of sidebarContentTypes(types)) {
    add(type.key, type.name, "content");
  }
  for (const group of moduleNavGroups(modules ?? [], types)) {
    for (const type of group.types) {
      add(type.key, type.name, "module");
    }
  }
  return result;
}

export interface HomeRecord {
  record: SyncRecord;
  title: string;
  type: HomeType;
}

/** deletedAt が null で type が homeTypes にあるものだけ。updatedAt 降順、同時刻は id 降順 */
export function homeRecords(
  records: readonly SyncRecord[],
  types: readonly HomeType[],
  titleOf: (record: SyncRecord) => string,
): HomeRecord[] {
  const byKey = new Map(types.map((type) => [type.key, type]));
  const rows: HomeRecord[] = [];
  for (const record of records) {
    const type = byKey.get(record.type);
    if (record.deletedAt !== null || type === undefined) continue;
    rows.push({ record, title: titleOf(record), type });
  }
  // updatedAt は ISO 8601 なので文字列比較でよい。同時刻は UUIDv7 の id 降順(新しい順)
  return rows.toSorted((a, b) => {
    if (a.record.updatedAt !== b.record.updatedAt) {
      return a.record.updatedAt < b.record.updatedAt ? 1 : -1;
    }
    return a.record.id < b.record.id ? 1 : a.record.id > b.record.id ? -1 : 0;
  });
}

const isMyDraft = (row: HomeRecord, userId: string) =>
  row.record.status === "draft" && row.record.updatedBy === userId;

export function myDrafts(rows: readonly HomeRecord[], userId: string, limit = 5): HomeRecord[] {
  return rows.filter((row) => isMyDraft(row, userId)).slice(0, limit);
}

export function recentUpdates(rows: readonly HomeRecord[], limit = 10): HomeRecord[] {
  return rows.slice(0, limit);
}

export interface TypeCount {
  type: HomeType;
  count: number;
}

export interface StatusSummary {
  total: number;
  /** homeTypes の順で、count > 0 の型だけ */
  byType: TypeCount[];
}

// rows は更新順なので、byType の並びは order(homeTypes の結果)の順へ戻す。
// order を省くと rows での登場順になる。
function summarize(rows: readonly HomeRecord[], order?: readonly HomeType[]): StatusSummary {
  const counts = new Map<string, TypeCount>();
  for (const row of rows) {
    const entry = counts.get(row.type.key);
    if (entry === undefined) {
      counts.set(row.type.key, { type: row.type, count: 1 });
    } else {
      entry.count += 1;
    }
  }
  const byType =
    order === undefined
      ? [...counts.values()]
      : order.flatMap((type) => {
          const entry = counts.get(type.key);
          return entry === undefined ? [] : [entry];
        });
  return { total: rows.length, byType };
}

export function countByStatus(
  rows: readonly HomeRecord[],
  status: WorkflowStatus,
  order?: readonly HomeType[],
): StatusSummary {
  return summarize(
    rows.filter((row) => row.record.status === status),
    order,
  );
}

export function countMyDrafts(
  rows: readonly HomeRecord[],
  userId: string,
  order?: readonly HomeType[],
): StatusSummary {
  return summarize(
    rows.filter((row) => isMyDraft(row, userId)),
    order,
  );
}

export function countChanged(
  rows: readonly HomeRecord[],
  publications: ReadonlyMap<string, { sourceVersion: number }>,
  order?: readonly HomeType[],
): StatusSummary {
  return summarize(
    rows.filter(
      (row) => publicationStateOf(row.record, publications.get(row.record.id)) === "changed",
    ),
    order,
  );
}

export function listHref(slug: string, typeKey: string, query: Partial<ListQuery>): string {
  const search = new URLSearchParams(
    Object.entries(toListSearch(query)).map(([key, value]) => [key, String(value)]),
  ).toString();
  const base = `/t/${slug}/content/${typeKey}`;
  return search === "" ? base : `${base}?${search}`;
}

export function recordHref(slug: string, typeKey: string, recordId: string): string {
  return `/t/${slug}/content/${typeKey}/${recordId}`;
}

export function newRecordHref(slug: string, typeKey: string): string {
  return `/t/${slug}/content/${typeKey}/new`;
}
