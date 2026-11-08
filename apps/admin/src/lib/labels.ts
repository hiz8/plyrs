import type { WorkflowStatus } from "@plyrs/metamodel";
import type { SyncStatus } from "@plyrs/sync-client";
import { isRole, type Role } from "./api-contracts";

// このファイルには、複数の画面(機能)で使う文言だけを置く。1 つの機能でしか使わない文言は、その機能の
// 文言のファイル(content-list-labels.ts など)に置く。HISTORY_LABELS などの 1 機能専用の文言がまだ残っているが、
// ADR 0001 の移行手順 3・4 で、使う側のファイルと一緒に移す。

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

// 案 G(設定とアカウント)の文言
export const SETTINGS_LABELS = {
  title: "設定",
  tabsName: "設定の項目",
  tabs: {
    general: "一般",
    "content-types": TERMS.contentType,
    members: "メンバー",
    modules: TERMS.module,
    tokens: "接続中のアプリ",
  },
  loadFailed: "設定を読み込めませんでした",
  retry: "再試行",
  site: {
    title: "サイト",
    name: "サイト名",
    nameHelp: "サイドバーとサイト選択に表示します",
    nameRequired: "サイト名を入力してください",
    nameTooLong: "サイト名は 100 文字以内で入力してください",
    slug: "サイトの識別子",
    slugHelp:
      "公開 API の URL に含まれるため変更できません。公開済みのページに埋め込まれた URL が壊れるのを防ぐためです",
    save: "保存",
    saved: "保存しました",
    saveFailed: "保存できませんでした",
  },
  publicApi: {
    title: "公開 API",
    description:
      "サイトを作るフロントエンドの開発者に伝える URL です。公開したコンテンツだけが返ります",
    baseUrl: "ベース URL",
    example: (type: string) => `例: ${type}の一覧`,
    exampleHelp: "型の API 名は設定 › コンテンツタイプで確認できます",
    copy: "コピー",
  },
} as const;

export const CLIPBOARD_LABELS = {
  copied: "コピーしました",
  copyFailed: "コピーできませんでした",
  copyOf: (label: string) => `${label}をコピー`,
} as const;

export const MEMBER_LABELS = {
  add: "メンバーを追加",
  tableLabel: "メンバーの一覧",
  columns: { email: "メールアドレス", role: "ロール", joined: "参加日", actions: "操作" },
  self: "自分",
  lastOwner: "最後の管理者",
  lastOwnerReason:
    "このサイトを管理できる人がいなくなるため、ロールの変更と削除はできません。先に別のメンバーを管理者にしてください",
  remove: "外す",
  loadFailed: "メンバー一覧を取得できませんでした",
  addDialog: {
    title: "メンバーを追加",
    email: "メールアドレス",
    emailHelp: "plyrs に登録済みの人を追加できます",
    role: "ロール",
    submit: "追加する",
    unregistered:
      "このメールアドレスのユーザーは登録されていません。先にサインアップを依頼してください。",
    copyUrl: "URL をコピー",
    unregisteredHint: "サインアップが済んだら、同じメールアドレスでもう一度追加してください",
    alreadyMember: "このメールアドレスは既にメンバーです",
    failed: "メンバーを追加できませんでした",
  },
  added: (email: string) => `${email} を追加しました`,
  roleChanged: (email: string, role: string) => `${email} を${role}にしました`,
  roleChangeFailed: "ロールを変更できませんでした",
  demote: {
    title: (email: string, role: string) => `${email} を${role}にしますか？`,
    toViewer: "コンテンツの作成・編集・公開ができなくなります。",
    toEditor: "設定(コンテンツタイプ・メンバー・モジュール)を変更できなくなります。",
    delay: "反映まで最大 15 分かかります。すぐに止めたい場合は、いったんメンバーから外してください",
    confirm: (role: string) => `${role}にする`,
  },
  removeDialog: {
    title: (email: string) => `${email} をメンバーから外しますか？`,
    body: "すぐにアクセスできなくなります。作成・編集したコンテンツは残ります。",
    confirm: "外す",
    selfTitle: "自分をこのサイトから外しますか？",
    selfBody: (email: string, site: string) =>
      `${email} は「${site}」にアクセスできなくなります。作成・編集したコンテンツは残ります。`,
    selfConfirm: "自分を外す",
  },
  lockout: (owners: string) =>
    `この操作のあと、設定を開けなくなります。戻すには他の管理者(${owners})に追加してもらう必要があります`,
  removed: (email: string) => `${email} をメンバーから外しました`,
  removeFailed: "メンバーを外せませんでした",
  roleOf: (email: string) => `${email}のロール`,
  removeOf: (email: string) => `${email}を外す`,
  ownersJoin: "、",
} as const;

// M1-4(design-spec 16.3・16.12): 接続トークン(PAT)。発行できるのは管理者だけ。
// M3-5: 同じ画面「接続中のアプリ」に OAuth の付与(MCP クライアントが同意画面を経て得た接続)も並べる
export const TOKEN_LABELS = {
  tab: "接続中のアプリ",
  issue: "トークンを発行",
  tableLabel: "接続中のアプリの一覧",
  columns: {
    kind: "種別",
    name: "名前",
    scopes: "スコープ",
    expires: "有効期限",
    lastUsed: "最終利用",
    actions: "操作",
  },
  kinds: { pat: "トークン", oauth: "OAuth" },
  empty:
    "接続中のアプリはまだありません。トークンを発行するか、MCP クライアントから OAuth で接続すると、ここに並びます",
  loadFailed: "接続中のアプリの一覧を取得できませんでした",
  grantsLoadFailed:
    "OAuth で接続したアプリの一覧を取得できませんでした(トークンの一覧は表示しています)",
  status: { active: "有効", expired: "期限切れ", revoked: "失効済み" },
  neverUsed: "未使用",
  notApplicable: "—",
  noExpiry: "期限なし",
  pending: "接続待ち",
  expiresIn: (days: number) => `残り ${days} 日`,
  revoke: "失効",
  revokeOf: (name: string) => `${name}を失効`,
  revoked: (name: string) => `${name} を失効しました`,
  revokeFailed: "失効できませんでした",
  revokeDialog: {
    title: (name: string) => `「${name}」を失効しますか？`,
    body: "このトークンで接続しているクライアントは、すぐに使えなくなります。元に戻せないので、必要なら新しく発行し直してください。",
    bodyOauth:
      "このアプリの接続は、すぐに使えなくなります。もう一度使うには、アプリから接続をやり直して同意してください。",
    confirm: "失効する",
  },
  scopes: {
    "record:read": "読み取り(record:read)",
    "record:propose": "提案(record:propose)",
    "record:write": "作成・編集(record:write)",
    "record:delete": "削除(record:delete)",
    "record:publish": "公開(record:publish)",
    "type:manage": "コンテンツタイプの変更(type:manage)",
  },
  scopeDescriptions: {
    "record:read": `${TERMS.contentType}と${TERMS.content}を読み取ります。下書きも含みます`,
    "record:propose": `${TERMS.content}の作成・編集・削除・公開を提案します。提案は管理画面で人が採用・却下します`,
    "record:write": `${TERMS.content}を作成・編集します`,
    "record:delete": `${TERMS.content}を削除します`,
    "record:publish": `${TERMS.content}を公開します。既定では外れています。人が公開する運用のままにするなら付けないでください`,
    "type:manage": `${TERMS.contentType}の定義を変更します`,
  },
  expiryOption: (days: number) => `${days} 日`,
  issueDialog: {
    title: "接続トークンを発行",
    name: "名前",
    nameHelp: "どのクライアントで使うか分かる名前(例: Claude Code、CI)",
    scopes: "スコープ",
    scopesHelp: "実際にできる操作は、スコープとあなたのロールの両方で許されたものに限られます",
    expiry: "有効期限",
    writeExpiryNote:
      "書き込みを含むトークンは漏えい時の影響を抑えるため、有効期限が最長 90 日になります",
    noProposeNote:
      "提案(record:propose)が無いと、他の人の編集と重なり続けたときや、確認に対応していないクライアントからの公開で、エージェントが変更を提案に回せません",
    submit: "発行する",
    failed: "トークンを発行できませんでした",
    expiryTooLong: "この有効期限はスコープに対して長すぎます",
  },
  issued: {
    title: "トークンを発行しました",
    token: "トークン",
    copy: "トークンをコピー",
    onceWarning:
      "このトークンは今だけ表示されます。閉じると二度と見られないので、使う場所に保存してからダイアログを閉じてください",
    close: "閉じる",
  },
  connect: {
    title: "接続のしかた",
    description:
      "MCP に対応したクライアントから、次の URL に Authorization ヘッダでトークンを渡して接続します。現在は読み取り専用です",
    endpoint: "接続先(MCP)",
    header: "ヘッダ",
    headerValue: "Authorization: Bearer <トークン>",
    limited: "限定公開中のため、ツール名や返り値の形は予告なく変わることがあります",
  },
} as const;

export const MODULE_LABELS = {
  description:
    "モジュールを有効にすると、サイドバーに専用の項目と、それ用のコンテンツタイプが増えます",
  empty: "モジュールはありません",
  enabled: "有効",
  disabled: "無効",
  enable: "有効にする",
  disable: "無効にする",
  loadFailed: "モジュール一覧を取得できませんでした",
  justEnabled: "有効にしました。",
  addType: (type: string) => `${type}を追加`,
  linkArrow: " ›",
  enabledToast: (name: string) => `${name}を有効にしました`,
  disabledToast: (name: string) => `${name}を無効にしました`,
  enableFailed: "モジュールを有効にできませんでした",
  disableFailed: "モジュールを無効にできませんでした",
  disableDialog: {
    title: (name: string) => `${name}モジュールを無効にしますか？`,
    body: (name: string) =>
      `サイドバーから「${name}」が消え、公開サイトのこのモジュールの API は応答しなくなります。`,
    keep: (counts: string) =>
      `モジュールのコンテンツ(${counts})は削除されません。再び有効化すると元に戻ります`,
    keepUnknown: "モジュールのコンテンツは削除されません。再び有効化すると元に戻ります",
  },
  count: (name: string, n: number) => `${name} ${n} 件`,
  countJoin: "、",
} as const;
