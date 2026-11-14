import type { WorkflowStatus } from "@plyrs/metamodel";
import type { SyncStatus } from "@plyrs/sync-client";
import { isRole, type Role } from "./api-contracts";

// このファイルには、複数の画面(機能)で使う文言だけを置く。1 つの機能でしか使わない文言は、その機能の
// 文言のファイル(features/records/lib/record-labels.ts など)に置く。

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

// 案 G 4 章(G10): ロールごとにできることの説明
export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  owner: "すべての操作に加えて、設定(コンテンツタイプ・メンバー・モジュール)を変更できます",
  editor: "コンテンツとメディアの作成・編集・公開ができます。設定は変更できません",
  viewer: "コンテンツとメディアを見るだけです。作成・編集・公開はできません",
};

// TenantSummary.role などサーバーから文字列で届く値向け。未知のロールは値をそのまま出す。
export function roleLabel(role: string): string {
  return isRole(role) ? ROLE_LABELS[role] : role;
}

export const SYNC_STATUS_LABELS: Record<SyncStatus, string> = {
  idle: "待機",
  connecting: "接続中",
  syncing: "同期中",
  ready: "同期済み",
  closed: "切断",
};

// 案 A: シェル(サイドバー・ヘッダー)の文言
export const NAV_LABELS = {
  home: "ホーム",
  content: "コンテンツ",
  media: "メディア",
  proposals: "提案",
  settings: "設定",
  accountSettings: "アカウント設定",
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

// 複数の画面で同じ言い回しにそろえる操作・状態の文言
export const COMMON_LABELS = {
  readOnly: "閲覧のみ",
  retry: "再試行",
  clearFilters: "絞り込みを解除",
} as const;

export const TOASTS = {
  saved: "保存しました",
  published: "公開しました",
  updated: "更新しました",
  unpublished: "公開を取り下げました",
  deleted: "削除しました",
  statusChanged: "ステータスを変更しました",
  saveFailed: "保存できませんでした。接続を確認して、もう一度お試しください",
  publishFailed: "保存しましたが、公開できませんでした。接続を確認して、もう一度お試しください",
  retryPublish: "公開を再試行",
  unpublishFailed: "公開を取り下げられませんでした。接続を確認して、もう一度お試しください",
  deleteFailed: "削除できませんでした。接続を確認して、もう一度お試しください",
  statusFailed: "ステータスを変更できませんでした。接続を確認して、もう一度お試しください",
} as const;

export const DIALOGS = {
  delete: {
    title: (type: string) => `${type}を削除しますか？`,
    body: (title: string) => `「${title}」を削除します。元に戻せません。`,
    publishedWarning: (type: string) =>
      `この${type}は公開中です。削除するとサイトからも消え、公開ページは表示できなくなります`,
    confirm: "削除する",
  },
  unpublish: {
    title: "公開を取り下げますか？",
    body: (title: string) =>
      `「${title}」がサイトから見えなくなります。内容は下書きとして残り、あとから再び公開できます。`,
    confirm: "公開を取り下げる",
  },
  archivePublished: {
    title: "公開したままアーカイブしますか？",
    body: (type: string) =>
      `この${type}はまだ公開中です。アーカイブしても公開は維持されます。先に「公開を取り下げ」を行うことをおすすめします。`,
    confirm: "公開したままアーカイブする",
  },
  leave: {
    title: "保存していない変更があります",
    body: "このまま移動すると、本文とタイトルの変更は失われます。",
    stay: "編集を続ける",
    discard: "破棄して移動",
  },
  // 型設計の離脱ガード(E26)。title / stay / discard は leave と共通
  leaveType: {
    body: "このまま移動すると、コンテンツタイプの変更は失われます。",
  },
  conflict: {
    title: "本文が他の人の編集と重なりました",
    body: (savedAgo: string) =>
      `ほかの人が ${savedAgo} に同じ本文を保存しました。どちらを残すか選んでください。他のフィールドは自動で統合済みです。公開はまだ行っていません。`,
    mine: "あなたの編集(この端末)",
    mineNote: "未保存",
    theirs: "ほかの人の編集",
    theirsNote: (savedAgo: string) => `${savedAgo} に保存`,
    keepMine: "あなたの編集を残す",
    adoptTheirs: "ほかの人の編集を取り込む",
    later: "あとで決める",
  },
  cancel: "キャンセル",
} as const;

type BulkKindKey = "publish" | "unpublish" | "status" | "delete";

// running / retry / done / failed のキーは BulkKind(lib/use-bulk-action.ts)と揃える
export const BULK_LABELS = {
  region: "一括操作",
  menu: "一括操作",
  selected: (n: number) => `${n} 件を選択中`,
  failedNote: "(失敗したもの)",
  selectPage: (n: number) => `このページの ${n} 件を選択`,
  clear: "選択を解除",
  actions: {
    publish: "公開",
    unpublish: "公開を取り下げ",
    status: "ステータスを変更",
    delete: "削除",
  },
  running: {
    publish: "公開しています…",
    unpublish: "公開を取り下げています…",
    status: "ステータスを変更しています…",
    delete: "削除しています…",
  },
  resultDone: (n: number, kind: BulkKindKey) => `${n} 件を${BULK_LABELS.done[kind]}`,
  resultFailed: (n: number, kind: BulkKindKey) => `${n} 件は${BULK_LABELS.failed[kind]}`,
  sentenceJoin: "。",
  progress: (done: number, total: number) => `${done} / ${total} 件`,
  cancel: "残りを中止",
  retry: {
    publish: "公開をもう一度試す",
    unpublish: "取り下げをもう一度試す",
    status: "変更をもう一度試す",
    delete: "削除をもう一度試す",
  },
  done: {
    publish: "公開しました",
    unpublish: "公開を取り下げました",
    status: "ステータスを変更しました",
    delete: "削除しました",
  },
  failed: {
    publish: "公開できませんでした",
    unpublish: "公開を取り下げられませんでした",
    status: "ステータスを変更できませんでした",
    delete: "削除できませんでした",
  },
  confirmDelete: {
    title: (n: number, type: string) => `${n} 件の${type}を削除しますか？`,
    body: "元に戻せません。公開中のものはサイトからも消え、公開ページは表示できなくなります。",
  },
  confirmUnpublish: {
    title: (n: number) => `${n} 件の公開を取り下げますか？`,
    body: "サイトから見えなくなります。内容は下書きとして残り、あとから再び公開できます。",
  },
} as const;

// router の defaultErrorComponent(最終防衛線)
export const ERROR_SCREEN = {
  title: "エラーが発生しました",
  fallback:
    "ページを表示できませんでした。再読み込みしても直らない場合は、時間をおいてお試しください",
  reload: "再読み込み",
} as const;

export const CLIPBOARD_LABELS = {
  copied: "コピーしました",
  copyFailed: "コピーできませんでした",
  copyOf: (label: string) => `${label}をコピー`,
} as const;
