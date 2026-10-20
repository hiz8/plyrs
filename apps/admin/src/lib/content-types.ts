import { ASSET_TYPE_KEY, type ContentTypeDefinition } from "@plyrs/metamodel";
import type { SyncRecord } from "@plyrs/sync-protocol";
import type { ContentTypeSummary, ModuleSummary } from "./admin-api";
import { summaryToDefinition } from "./content-type-form";
import { sidebarContentTypes } from "./navigation";

// 案 E 5.1: コンテンツタイプ一覧の行とグループ分け。

export interface TypeRow {
  row: ContentTypeSummary;
  /** 同期済みのときだけ数える(未取得と 0 件を区別する。E7) */
  count: number | null;
  canDelete: boolean;
}

function countByType(records: readonly SyncRecord[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const record of records) {
    if (record.deletedAt === null) {
      counts.set(record.type, (counts.get(record.type) ?? 0) + 1);
    }
  }
  return counts;
}

function toRows(
  types: readonly ContentTypeSummary[],
  records: readonly SyncRecord[],
  hasSynced: boolean,
): TypeRow[] {
  const counts = countByType(records);
  return types.map((row) => {
    const count = hasSynced ? (counts.get(row.key) ?? 0) : null;
    return { row, count, canDelete: row.source === "user" && count === 0 };
  });
}

// サイドバーと同じ順(menuOrder 昇順、未設定は後ろ、同順は名前順)
export function userTypeRows(
  types: readonly ContentTypeSummary[],
  records: readonly SyncRecord[],
  hasSynced: boolean,
): TypeRow[] {
  return toRows(sidebarContentTypes(types), records, hasSynced);
}

export interface PluginTypeGroup {
  pluginId: string;
  name: string;
  rows: TypeRow[];
}

// E8: グループの順は modules の順(modules に無い pluginId は後ろ)、型の順は navTypes の順(残りは名前順)
export function pluginTypeGroups(
  types: readonly ContentTypeSummary[],
  modules: readonly Pick<ModuleSummary, "moduleId" | "name" | "navTypes">[] | undefined,
  records: readonly SyncRecord[],
  hasSynced: boolean,
): PluginTypeGroup[] {
  const pluginTypes = types.filter((type) => type.source === "plugin" && type.pluginId !== null);
  const byPlugin = new Map<string, ContentTypeSummary[]>();
  for (const type of pluginTypes) {
    const id = type.pluginId as string;
    byPlugin.set(id, [...(byPlugin.get(id) ?? []), type]);
  }
  const moduleList = modules ?? [];
  const orderedIds = [
    ...moduleList.map((m) => m.moduleId).filter((id) => byPlugin.has(id)),
    ...[...byPlugin.keys()]
      .filter((id) => !moduleList.some((m) => m.moduleId === id))
      .toSorted((a, b) => a.localeCompare(b)),
  ];
  return orderedIds.map((pluginId) => {
    const module = moduleList.find((m) => m.moduleId === pluginId);
    const navIndex = (key: string) => {
      const index = module?.navTypes.indexOf(key) ?? -1;
      return index === -1 ? Number.POSITIVE_INFINITY : index;
    };
    const sorted = (byPlugin.get(pluginId) ?? []).toSorted((a, b) => {
      const ai = navIndex(a.key);
      const bi = navIndex(b.key);
      if (ai !== bi) return ai < bi ? -1 : 1;
      return a.name.localeCompare(b.name, "ja");
    });
    return { pluginId, name: module?.name ?? pluginId, rows: toRows(sorted, records, hasSynced) };
  });
}

// E10: ドロップ後の並びの index を menuOrder にし、値が変わる型だけ返す
export function menuOrderUpdates(ordered: readonly ContentTypeSummary[]): ContentTypeDefinition[] {
  return ordered.flatMap((row, index) =>
    row.menuOrder === index ? [] : [{ ...summaryToDefinition(row), menuOrder: index }],
  );
}

// E22: 利用者の型とモジュールの型から自分自身を除く(asset などのシステム型は出さない)
export function referenceCandidates(
  types: readonly ContentTypeSummary[],
  selfKey: string | null,
): { key: string; name: string }[] {
  const plugins = types
    .filter((type) => type.source === "plugin")
    .toSorted((a, b) => a.name.localeCompare(b.name, "ja"));
  return [...sidebarContentTypes(types), ...plugins]
    .filter((type) => type.key !== selfKey && type.key !== ASSET_TYPE_KEY)
    .map((type) => ({ key: type.key, name: type.name }));
}
