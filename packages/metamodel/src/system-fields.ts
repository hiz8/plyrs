// design-spec §5: 全型に無償付与されるシステムフィールド。
// ユーザー定義フィールドの key として使用不可（field-types.ts で強制）。
export const SYSTEM_FIELD_KEYS = [
  "id",
  "createdAt",
  "updatedAt",
  "createdBy",
  "updatedBy",
  "status",
  "version",
] as const;

export type SystemFieldKey = (typeof SYSTEM_FIELD_KEYS)[number];

// design-spec §7: records.status はワークフロー専用の固定4値。
// 公開状態は published_snapshots の有無が真実源であり、'published' という値は存在しない。
export const WORKFLOW_STATUSES = ["draft", "in_review", "ready", "archived"] as const;

export type WorkflowStatus = (typeof WORKFLOW_STATUSES)[number];
