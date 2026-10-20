import type { ContentTypeSummary } from "../lib/admin-api";
import type { TypeRow } from "../lib/content-types";

// コンテンツタイプの一覧の部品テスト用の行
export function summary(
  overrides: Partial<ContentTypeSummary> & { key: string },
): ContentTypeSummary {
  return {
    id: `id-${overrides.key}`,
    name: overrides.key,
    fields: [],
    source: "user",
    pluginId: null,
    createdAt: "2026-07-17T00:00:00Z",
    updatedAt: "2026-07-17T00:00:00Z",
    version: 1,
    description: null,
    titleField: null,
    listColumns: null,
    menuOrder: null,
    ...overrides,
  };
}

export function typeRow(
  overrides: Partial<ContentTypeSummary> & { key: string },
  count: number | null,
): TypeRow {
  const row = summary(overrides);
  return { row, count, canDelete: row.source === "user" && count === 0 };
}
