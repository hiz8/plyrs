import type { SyncRecord } from "@plyrs/sync-protocol";
import { MODULE_LABELS } from "./labels";
import type { NavType } from "./navigation";

// モジュール画面の純関数(案 G 5 章、裁定 G3・G15)
export interface TypeCount {
  key: string;
  name: string;
  count: number;
}

// navTypes の順。削除済み(deletedAt !== null)は数えない。型名は types から引き、
// まだ同期で届いていない key は key をそのまま名前にする
export function moduleContentCounts(
  records: readonly SyncRecord[],
  navTypes: readonly string[],
  types: readonly NavType[],
): TypeCount[] {
  return navTypes.map((key) => ({
    key,
    name: types.find((type) => type.key === key)?.name ?? key,
    count: records.filter((record) => record.type === key && record.deletedAt === null).length,
  }));
}

export function formatCounts(counts: readonly TypeCount[]): string {
  return counts
    .map(({ name, count }) => MODULE_LABELS.count(name, count))
    .join(MODULE_LABELS.countJoin);
}

// 同期で届いている型だけに「追加」の導線を出す(届いていない型の新規作成は開けない)
export function moduleAddLinks(
  navTypes: readonly string[],
  types: readonly NavType[],
  slug: string,
): { key: string; label: string; href: string }[] {
  return navTypes.flatMap((key) => {
    const type = types.find((candidate) => candidate.key === key);
    return type === undefined
      ? []
      : [
          {
            key,
            label: MODULE_LABELS.addType(type.name),
            href: `/t/${slug}/content/${key}/new`,
          },
        ];
  });
}
