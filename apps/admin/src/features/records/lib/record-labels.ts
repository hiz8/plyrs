import { TERMS } from "~/lib/labels";

// record の一覧・編集・履歴・提案の文言。record の feature だけが使うものと、履歴・提案のルートが
// index.ts 経由で使うものを置く。複数の機能で使う文言(TERMS・TOASTS・DIALOGS など)は ~/lib/labels にある

// 公開状態の 3 値(design-spec §7 の version 比較。案 D 4 章)。HTTP 契約の PublicationState
// (admin-api.ts)とは別物なので、名前を分けている
export type PublicationStateKey = "published" | "changed" | "unpublished";

export const PUBLICATION_STATE_LABELS: Record<PublicationStateKey, string> = {
  published: "公開中",
  changed: "未反映の変更あり",
  unpublished: "未公開",
};

// V3: 編集画面の公開ボックス(案 C 3 章・H 4 章)
export const PUBLISH_BOX = {
  title: "公開",
  state: "状態",
  status: "ステータス",
  actionsRegion: "公開の操作",
  notSaved: "まだ保存されていません",
  loading: "公開状態を確認しています…",
  loadFailed: "公開状態を取得できませんでした",
  retry: "再試行",
  publishedAt: (absolute: string) => `${absolute} に公開`,
  changed: "未反映の変更があります",
  unsaved: "未保存の変更があります",
  publish: "公開",
  update: "更新",
  saveDraft: "下書き保存",
  saveWithoutPublish: "公開せずに保存",
  unpublish: "公開を取り下げ",
  delete: "削除",
  offlineReason: "接続が切れているため公開できません",
  offlineNote: (secondary: string | null) =>
    secondary === null
      ? "接続が回復すると公開できます"
      : `接続が回復すると公開できます。「${secondary}」はこの端末に保存され、再接続後に送信されます`,
  readOnly: "閲覧のみ",
  lastUpdated: (text: string) => `最終更新 ${text}`,
} as const;

export const EDITOR_LABELS = {
  editTitle: (type: string) => `${type}を編集`,
  viewTitle: (type: string) => `${type}を表示`,
  addTitle: (type: string) => `${type}を追加`,
  crumbEdit: "編集",
  crumbView: "表示",
  crumbNew: "新規追加",
  unknownType: (key: string) => `${TERMS.contentType}が見つかりません: ${key}`,
  notFound: "見つかりませんでした。削除された可能性があります",
} as const;

// 16.5(M2-5): record の履歴画面
export const HISTORY_LABELS = {
  title: "履歴",
  crumb: "履歴",
  link: "履歴",
  listLabel: "版の一覧",
  via: { sync: "管理画面", mcp: "MCP", rest: "API" },
  kind: {
    write: "編集",
    publish: "公開",
    unpublish: "公開の取り下げ",
    delete: "削除",
    restore: "復元",
  },
  // route は「管理画面から」/「管理画面から提案を採用して」(M5c: 提案の採用で生まれた版)
  summary: {
    route: (via: string) => `${via}から`,
    routeAccepted: (via: string) => `${via}から提案を採用して`,
    write: (who: string, route: string, count: number) =>
      count === 0 ? `${who} が${route}編集` : `${who} が${route} ${count} フィールドを変更`,
    publish: (who: string, route: string) => `${who} が${route}公開`,
    unpublish: (who: string, route: string) => `${who} が${route}公開を取り下げ`,
    delete: (who: string, route: string) => `${who} が${route}削除`,
    restore: (who: string, route: string, from: number | null) =>
      from === null ? `${who} が${route}復元` : `${who} が${route}版 ${from} に復元`,
  },
  published: "公開版",
  publishedAt: (absolute: string) => `${absolute} に公開`,
  version: (n: number) => `版 ${n}`,
  compareTitle: "現在との差分",
  noSelection: "左の一覧から版を選ぶと、現在との差分が表示されます",
  noChanges: "現在と同じ内容です",
  before: "この版",
  after: "現在",
  unset: "(未設定)",
  emptyText: "(空)",
  restore: "この版に戻す",
  restoreDialog: {
    title: "この版に戻しますか？",
    body: (summary: string) =>
      `「${summary}」の内容と状態を現在に書き戻します。今の内容も履歴に残るので、あとから戻せます。`,
    confirm: "この版に戻す",
  },
  restored: "この版に戻しました",
  restoreFailed: "戻せませんでした。接続を確認して、もう一度お試しください",
  loadFailed: "履歴を読み込めませんでした",
  compareFailed: "差分を読み込めませんでした",
  retry: "再試行",
  loadMore: "さらに表示",
  empty: "まだ履歴がありません",
  notFound: "見つかりませんでした",
} as const;

// 16.8(M5c、決定 57): 提案(change set)。エージェントの変更を人が採用・却下する
const PROPOSAL_KIND_LABELS = {
  create: "作成",
  update: "更新",
  delete: "削除",
  publish: "公開",
  unpublish: "公開の取り下げ",
} as const;

const PROPOSAL_STATE_LABELS = { open: "未処理", accepted: "採用", rejected: "却下" } as const;

export const PROPOSAL_LABELS = {
  title: "提案",
  crumb: "提案",
  kind: PROPOSAL_KIND_LABELS,
  state: PROPOSAL_STATE_LABELS,
  tabs: { open: "未処理", resolved: "処理済み" },
  tabsName: "提案の状態",
  listLabel: "提案の一覧",
  summary: (who: string, via: string, kind: keyof typeof PROPOSAL_KIND_LABELS, count: number) =>
    kind === "update" || kind === "create"
      ? `${who} が${via}から ${count} フィールドの${PROPOSAL_KIND_LABELS[kind]}を提案`
      : `${who} が${via}から${PROPOSAL_KIND_LABELS[kind]}を提案`,
  stale: "提案の後に内容が変わっています",
  staleHelp: "差分は現在の内容との比較です。採用すると提案のフィールドだけが上書きされます",
  note: "提案者の説明",
  noNote: "(説明なし)",
  proposer: "提案者",
  via: "経路",
  createdAt: "提案日時",
  stateHeading: "状態",
  diffTitle: "現在との差分",
  before: "現在",
  after: "提案",
  statusRow: "状態",
  unsetStatus: "(なし)",
  noChanges: "現在と同じ内容です",
  kindDescription: {
    delete: `この${TERMS.content}を削除します。削除しても履歴から戻せます`,
    publish: `この${TERMS.content}の現在の内容を公開します。公開すると誰でも読めるようになります`,
    unpublish: `この${TERMS.content}の公開を取り下げます。内容は下書きとして残ります`,
  },
  accept: "採用する",
  reject: "却下する",
  acceptDialog: {
    title: (kind: keyof typeof PROPOSAL_KIND_LABELS) =>
      `${PROPOSAL_KIND_LABELS[kind]}の提案を採用しますか？`,
    body: (summary: string) =>
      `「${summary}」をあなたの名前で実行します。履歴にはこの提案の採用として残ります。`,
    confirm: "採用する",
  },
  rejectDialog: {
    title: "却下しますか？",
    body: "却下した提案は書き込まれません。理由は提案したエージェントが読めます。",
    reason: "理由(任意)",
    reasonTooLong: "500 文字以内で入力してください",
    confirm: "却下する",
  },
  accepted: "採用しました",
  rejected: "却下しました",
  acceptFailed: "採用できませんでした",
  rejectFailed: "却下できませんでした",
  loadFailed: "提案を読み込めませんでした",
  retry: "再試行",
  loadMore: "さらに表示",
  loadMoreFailed: "続きを読み込めませんでした",
  empty: "未処理の提案はありません",
  emptyResolved: "処理済みの提案はありません",
  filteredBy: `この${TERMS.content}の提案だけを表示しています`,
  clearFilter: "すべての提案を表示",
  openRecord: `${TERMS.content}を開く`,
  editorBanner: (n: number) => `この${TERMS.content}には未処理の提案が ${n} 件あります`,
  editorBannerLink: "提案を見る",
  resolvedBy: (state: "accepted" | "rejected", who: string, at: string) =>
    `${who} が ${at} に${PROPOSAL_STATE_LABELS[state]}`,
  notFound: "提案が見つかりませんでした。既に処理されたか、保存期間を過ぎています",
} as const;

export const RECORD_FORM_LABELS = {
  unset: "(未設定)",
  empty: "（空）",
  noCandidates: "参照できるコンテンツがありません",
  adoptedNotice:
    "サーバー版を反映しました。他に未保存の変更が残っている場合は改めて保存してください。",
} as const;
