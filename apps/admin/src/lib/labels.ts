import type { WorkflowStatus } from "@plyrs/metamodel";
import type { SyncStatus } from "@plyrs/sync-client";
import { isRole, type Role } from "./permissions";
import type { SyncIndicatorState } from "./sync-indicator";

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

export const ROLE_LABELS: Record<Role, string> = {
  owner: "管理者",
  editor: "編集者",
  viewer: "閲覧者",
};

// TenantSummary.role などサーバーから文字列で届く値向け。未知のロールは値をそのまま出す。
export function roleLabel(role: string): string {
  return isRole(role) ? ROLE_LABELS[role] : role;
}

// 公開状態の 3 値(design-spec §7 の version 比較。案 D 4 章)。HTTP 契約の PublicationState
// (admin-api.ts)とは別物なので、名前を分けている
export type PublicationStateKey = "published" | "changed" | "unpublished";

export const PUBLICATION_STATE_LABELS: Record<PublicationStateKey, string> = {
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

// 案 A: シェル(サイドバー・ヘッダー)の文言
// ホームの暫定画面(a-navigation.md 9 章、2026-10-19 裁定)。型が無い編集者・閲覧者向けの案内
export const HOME_PLACEHOLDER = {
  title: "コンテンツの種類がまだありません",
  description: "サイトの管理者に作成を依頼してください",
} as const;

export const NAV_LABELS = {
  home: "ホーム",
  content: "コンテンツ",
  media: "メディア",
  settings: "設定",
  list: "一覧",
  add: "新規追加",
  createFirstType: "最初のコンテンツタイプを作成",
  noTypes: "コンテンツの種類がまだありません。サイトの管理者に作成を依頼してください",
  menu: "メニュー",
  openMenu: "メニューを開く",
  closeMenu: "メニューを閉じる",
  switchSite: "サイトを切り替え",
  openSiteList: "サイト一覧を開く",
  logout: "ログアウト",
  mainNav: "メインナビゲーション",
  account: "アカウント",
} as const;

export const SYNC_INDICATOR_LABELS: Record<SyncIndicatorState, string> = {
  syncing: "同期中…",
  ready: "同期済み",
  disconnected: "再接続しています…",
};

export const CONNECTION_BANNER = {
  message:
    "サーバーとの接続が切れています。再接続しています… 編集内容はこの端末に保存され、再接続後に送信されます",
  reconnect: "今すぐ再接続",
} as const;

export const SITE_SELECT = {
  title: "サイトを選択",
  description: (email: string, count: number) =>
    `${email} として ${count} つのサイトに所属しています`,
  descriptionWithoutEmail: (count: number) => `${count} つのサイトに所属しています`,
  none: "サイトは運営者が発行します",
  otherAccount: "別のアカウントでログイン",
} as const;

// 初回同期前などの読み込み中の読み上げ
export const LOADING_LABEL = "読み込み中";
