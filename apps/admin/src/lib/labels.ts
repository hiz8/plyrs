import type { WorkflowStatus } from "@plyrs/metamodel";
import type { SyncStatus } from "@plyrs/sync-client";

// 案 H 4.1: 画面に出す用語の唯一の基準。画面ごとに対応表を持たず、ここから引く。
// 「テナント」は運営者・開発者の言葉のため、利用者の画面では「サイト」と呼ぶ(2026-10-17 決定)。
export const TERMS = {
  content: "コンテンツ",
  contentType: "コンテンツタイプ",
  media: "メディア",
  module: "モジュール",
  site: "サイト",
  fieldKey: "API で使う名前",
} as const;

export const WORKFLOW_STATUS_LABELS: Record<WorkflowStatus, string> = {
  draft: "下書き",
  in_review: "レビュー中",
  ready: "公開準備完了",
  archived: "アーカイブ",
};

// api の auth/permissions.ts の ROLES と同じ集合(api は管理画面の依存に無いため値を複製する)。
export const ROLES = ["owner", "editor", "viewer"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  owner: "管理者",
  editor: "編集者",
  viewer: "閲覧者",
};

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

// TenantSummary.role などサーバーから文字列で届く値向け。未知のロールは値をそのまま出す。
export function roleLabel(role: string): string {
  return isRole(role) ? ROLE_LABELS[role] : role;
}

// 公開状態の 3 値(design-spec §7 の version 比較。案 D 4 章)
export type PublicationState = "published" | "changed" | "unpublished";

export const PUBLICATION_STATE_LABELS: Record<PublicationState, string> = {
  published: "公開中",
  changed: "未反映の変更あり",
  unpublished: "未公開",
};

export const SYNC_STATUS_LABELS: Record<SyncStatus, string> = {
  idle: "待機",
  connecting: "接続中",
  syncing: "同期中",
  ready: "同期済み",
  closed: "切断",
};
