import type { SyncRecord } from "@plyrs/sync-protocol";
import type { HomeRecord, HomeType, StatusSummary } from "../../lib/home";

// ホーム部品のテスト用の最小データ
export const NEWS: HomeType = { key: "news", name: "お知らせ", group: "content" };
export const BLOG: HomeType = { key: "blog", name: "ブログ", group: "content" };
export const SLOT: HomeType = { key: "booking.slot", name: "予約枠", group: "module" };

export function homeRecord(
  id: string,
  type: HomeType,
  title: string,
  over: Partial<SyncRecord> = {},
): HomeRecord {
  return {
    title,
    type,
    record: {
      id,
      type: type.key,
      input: { title },
      fieldVersions: {},
      status: "draft",
      seq: 1,
      version: 1,
      deletedAt: null,
      updatedAt: "2020-01-01T00:00:00.000Z",
      updatedBy: "u1",
      ...over,
    },
  };
}

export function summary(...entries: [HomeType, number][]): StatusSummary {
  return {
    total: entries.reduce((sum, [, count]) => sum + count, 0),
    byType: entries.map(([type, count]) => ({ type, count })),
  };
}
