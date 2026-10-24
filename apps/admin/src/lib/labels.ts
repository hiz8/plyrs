import type { WorkflowStatus } from "@plyrs/metamodel";
import type { SyncStatus } from "@plyrs/sync-client";
import type { FieldKind } from "./content-type-form";
import type { MediaKind } from "./media-list";
import type { ListTab } from "./content-list";
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

// b-home.md: ホーム(ダッシュボード)の文言
export const HOME_LABELS = {
  meta: (email: string, role: string) => `${email} ・ ${role}`,
  readOnly: "閲覧のみ",
  readOnlyMeta: (email: string) => `閲覧のみ ・ ${email}`,
  quickAdd: "新規追加",
  drafts: {
    title: "自分の下書き",
    note: "最後に自分が編集した 5 件",
    empty: "下書きはありません",
    emptyHint: "上の「新規追加」から書き始められます",
    seeAll: "下書きをすべて見る",
    failed: "下書きを表示できませんでした",
  },
  review: {
    title: "確認待ち",
    note: "型をまたいで集計",
    empty: "確認待ちのコンテンツはありません",
    description: {
      in_review: "公開前に確認が必要なもの",
      ready: "確認済みで、公開を待っているもの",
      changed: "公開後に編集されたもの",
    },
    changedFailed: "未反映の変更を確認できませんでした",
  },
  recent: {
    title: "最近の更新",
    note: "更新日時の新しい順に 10 件",
    empty: "まだ更新はありません",
  },
  count: (n: number) => `${n} 件`,
  typeCount: (name: string, n: number) => `${name} ${n}`,
  retry: "再試行",
  // グリッドの aria-label
  widgets: "モジュールのウィジェット",
  // カードの項目の区切り(home-card)
  separator: " ・ ",
  gettingStarted: {
    title: "はじめに",
    description: (site: string) =>
      `「${site}」を使い始めるための手順です。1 つ目が終わると、ホームは普段の表示に変わります。`,
    createType: {
      title: "コンテンツタイプを作成する",
      body: "「お知らせ」「ブログ」のような、サイトに載せる内容の種類を決めます。タイトルや本文などのフィールドを持たせます。",
      action: "コンテンツタイプを作成",
    },
    uploadMedia: {
      title: "メディアをアップロードする",
      body: "画像や PDF を先に入れておくと、記事を書くときに選ぶだけで済みます。",
      action: "メディアを開く",
    },
    inviteMembers: {
      title: "メンバーを招待する",
      body: "編集を手伝ってくれる人を、設定 › メンバーから追加します。追加できるのは plyrs に登録済みの人です",
      action: "メンバーを追加",
    },
  },
  noTypes: {
    title: "コンテンツの種類がまだありません",
    description:
      "サイトの管理者に、コンテンツタイプの作成を依頼してください。作成されると、ここに新規追加の入口と最近の更新が表示されます",
  },
} as const;

// 案 A: シェル(サイドバー・ヘッダー)の文言
export const NAV_LABELS = {
  home: "ホーム",
  content: "コンテンツ",
  media: "メディア",
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

export const RECORD_FORM_LABELS = {
  unset: "(未設定)",
  empty: "（空）",
  noCandidates: "参照できるコンテンツがありません",
  adoptedNotice:
    "サーバー版を反映しました。他に未保存の変更が残っている場合は改めて保存してください。",
} as const;

export const LIST_LABELS = {
  add: (type: string) => `${type}を追加`,
  tabs: {
    all: "すべて",
    published: "公開中",
    "unpublished-changes": "未反映の変更あり",
    unpublished: "未公開",
    archived: "アーカイブ",
  } satisfies Record<ListTab, string>,
  tabsName: "公開状態",
  statusFilter: "ステータス",
  statusAll: "すべて",
  search: "タイトルで検索",
  tableLabel: (type: string) => `${type}の一覧`,
  columns: { title: "タイトル", publication: "公開", status: "ステータス", updated: "更新" },
  // 追加列(listColumns)のセル(K3)
  cell: { empty: "—", yes: "はい", no: "いいえ", count: (n: number) => `${n} 件` },
  changedShort: "公開中・未反映",
  changedLong: "公開中・未反映の変更あり",
  rowActions: { edit: "編集", view: "表示", delete: "削除" },
  failed: "失敗",
  empty: {
    title: (type: string) => `${type}はまだありません`,
    description: (type: string) =>
      `追加した${type}はここに一覧で表示され、公開するとサイトに載ります`,
  },
  noResults: {
    title: (q: string, type: string) =>
      q === "" ? `条件に一致する${type}はありません` : `「${q}」に一致する${type}はありません`,
    description: (filters: string) =>
      `${filters}で絞り込んでいます。別の言葉で検索するか、絞り込みを解除してください`,
    clear: "絞り込みを解除",
  },
  perPage: (n: number) => `1 ページ ${n} 件`,
  perPageLabel: "1 ページの件数",
  range: (total: number, from: number, to: number) => `${total} 件中 ${from}〜${to} 件`,
  pager: "ページ送り",
  prev: "前のページ",
  next: "次のページ",
  page: (n: number) => `${n} ページ目`,
  readOnly: "閲覧のみ",
  publicationsFailed: "公開状態を取得できませんでした",
  retry: "再試行",
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

export const ACCOUNT_LABELS = {
  title: "アカウント設定",
  email: {
    title: "メールアドレス",
    help: "ログインに使うメールアドレスです。変更は確認メールが必要になるため、現在は変更できません",
    loadFailed: "メールアドレスを取得できませんでした",
  },
  password: {
    title: "パスワードの変更",
    current: "現在のパスワード",
    next: "新しいパスワード",
    nextHelp: "12 文字以上",
    confirm: "新しいパスワード(確認)",
    note: "変更すると、他の端末のセッションはすべてログアウトされます",
    submit: "パスワードを変更",
    tooShort: "12 文字以上で入力してください",
    mismatch: "新しいパスワードが一致しません",
    changed: "パスワードを変更しました",
    changedWithRevoked: (n: number) =>
      `パスワードを変更しました。他の端末 ${n} 件をログアウトしました`,
    failed: "パスワードを変更できませんでした",
  },
  theme: {
    title: "テーマ",
    label: "テーマ",
    system: "自動",
    light: "ライト",
    dark: "ダーク",
    help: "「自動」は OS の設定に従います。選択はこのブラウザに記憶され、他の端末には引き継がれません",
  },
  sites: {
    title: "所属しているサイト",
    current: "現在のサイト",
    switch: "切り替える",
    loadFailed: "所属しているサイトを取得できませんでした",
  },
} as const;

// 案 E(型設計): フィールドの種類の呼称と説明(E 3 章)
export const FIELD_KIND_LABELS: Record<FieldKind, { name: string; description: string }> = {
  text: { name: "テキスト(1 行)", description: "タイトルや名前。最大文字数を決められます" },
  richtext: { name: "リッチテキスト", description: "見出し・太字・画像を含む本文" },
  number: { name: "数値", description: "価格や人数。整数のみにもできます" },
  datetime: { name: "日時", description: "公開日や開催日時" },
  boolean: { name: "チェックボックス", description: "はい / いいえ" },
  select: { name: "選択肢", description: "決まった候補から選ぶ。複数選択も可" },
  asset: { name: "画像・ファイル", description: "メディアから選ぶ。1 件 / 複数" },
  reference: { name: "他のコンテンツへの参照", description: "別の型のコンテンツを選ぶ" },
  slug: { name: "URL スラッグ", description: "公開 URL に使う名前。型に 1 つだけ" },
  json: { name: "JSON", description: "任意の構造のデータをそのまま保存" },
};

export const CONTENT_TYPE_LABELS = {
  description:
    "サイトに載せる内容の種類と、そのフィールドを設計します。並び順はサイドバーの並び順になります(つまみをドラッグ)。",
  create: "コンテンツタイプを作成",
  createCrumb: "作成",
  createTitle: "コンテンツタイプを作成",
  tableLabel: "コンテンツタイプの一覧",
  columns: { name: "表示名", fields: "フィールド", contents: "コンテンツ", actions: "操作" },
  apiName: (key: string) => `API 名: ${key}`,
  count: (n: number) => `${n} 件`,
  separator: " ・ ",
  empty: {
    title: "コンテンツタイプはまだありません",
    description: "「お知らせ」「ブログ」のような、サイトに載せる内容の種類を作ります",
  },
  moduleBadge: "モジュール",
  moduleNote: "このモジュールの型は編集できません。表示名と説明はモジュールが持っています",
  edit: "編集",
  viewFields: "フィールドを見る",
  delete: "削除",
  dragLabel: (name: string) => `${name}を並べ替え`,
  reorderFailed: "並び順を保存できませんでした",
  loadFailed: "コンテンツタイプを読み込めませんでした",
  deleteDialog: {
    title: (name: string) => `「${name}」を削除しますか？`,
    body: "コンテンツが 0 件のため削除できます。削除後は同じ API 名で作り直せます。",
    offline: "オフラインの端末にこの型の下書きが残っている場合、再接続時にその下書きは失われます",
    confirm: "削除する",
    deleted: (name: string) => `「${name}」を削除しました`,
    failed: "削除できませんでした",
  },
  editor: {
    name: "表示名",
    nameHelp: "サイドバーと一覧の見出しに使います",
    nameRequired: "表示名を入力してください",
    key: "API 名",
    keyPlaceholder: "news など、英小文字・数字・_",
    keyHelpNew:
      "公開 API の URL に使います。表示名が英数字なら自動で入ります。日本語の場合は入力してください。作成後は変更できません",
    keyHelpEdit: "公開 API の URL に使います。作成後は変更できません",
    descriptionLabel: "説明",
    descriptionPlaceholder: "この種類の内容を一言で",
    descriptionHelp: "設定の一覧と、はじめての利用の案内に表示します",
    descriptionTooLong: "説明は 1000 文字以内で入力してください",
    fields: "フィールド",
    fieldsHelp: "上から順に入力フォームに並びます",
    emptyTitle: "フィールドはまだありません",
    emptyDescription:
      "タイトル・本文・画像のような入力項目を足していきます。最初のテキスト(1 行)がタイトルとして使われます。",
    addField: "フィールドを追加",
    editField: "編集",
    editingField: "編集中",
    viewField: "詳細",
    listColumns: "一覧に表示する列",
    listColumnsMax: (n: number) => `最大 ${n} 件`,
    addColumn: "列を追加",
    removeColumn: (label: string) => `${label}を外す`,
    listColumnsHelp: "タイトル・公開・ステータス・更新に加えて、一覧に出す列です",
    save: "保存",
    create: "作成",
    cancel: "キャンセル",
    panelOpenReason: "フィールドの設定を適用するか、キャンセルしてください",
    created: "作成しました",
    saved: "保存しました",
    saveFailed: "保存できませんでした",
    viewMeta: "モジュールの型(編集できません)",
    notFound: (key: string) => `コンテンツタイプが見つかりません: ${key}`,
  },
  tags: {
    required: "必須",
    title: "タイトルに使う",
    one: "1 件だけ",
    many: "複数",
    indexed: "絞り込み・並べ替え",
    requiredChanged: "必須に変更",
    kindChanged: "種類を変更",
    incomplete: "設定が未完了",
  },
  kindChangeArrow: " → ",
  warnings: {
    requiredAdded: (count: number | null) =>
      count === null
        ? "既に作成済みで値が空のコンテンツは、次に保存するときに入力が必要になります"
        : `既に作成済みで値が空のコンテンツ(${count} 件)は、次に保存するときに入力が必要になります`,
    kindChanged: (count: number | null) =>
      count === null
        ? "入力済みの値は自動では変換されません。値が新しい種類に合わない場合、そのコンテンツを次に保存するときに入力し直す必要があります"
        : `入力済みの値(${count} 件)は自動では変換されません。値が新しい種類に合わない場合、そのコンテンツを次に保存するときに入力し直す必要があります`,
  },
  keyErrors: {
    empty: "API で使う名前を入力してください",
    invalid: (example: string) => `英小文字・数字・_ だけが使えます。例: ${example}`,
    duplicate: (key: string, label: string) => `「${key}」は「${label}」で既に使われています`,
    reserved: (key: string) => `「${key}」はシステムが使う名前のため使えません`,
  },
} as const;

export const ADD_FIELD_LABELS = {
  title: "フィールドを追加",
  step1: "1. 種類を選ぶ",
  step1Done: (kind: string) => `1. 種類を選ぶ: ${kind}`,
  step2: "2. 名前を付ける",
  stepArrow: " › ",
  groups: { basic: "基本", link: "他のデータとつなぐ", advanced: "上級者向け" },
  slugTaken: "この型には既に URL スラッグがあります",
  next: "次へ",
  back: "種類を選び直す",
  add: "追加",
  cancel: "キャンセル",
  label: "表示名",
  labelHelp: "入力フォームのラベルと一覧の列見出しに使います",
  labelRequired: "表示名を入力してください",
  labelTooLong: (max: number) => `表示名は ${max} 文字以内で入力してください`,
  keyPlaceholder: "subtitle など、英小文字・数字・_",
  keyHelp:
    "公開 API の応答でこの名前が使われます。フロントエンドの開発者が読む名前なので、意味の分かる英語にしてください。保存したあとは変更できません",
} as const;

export const FIELD_PANEL_LABELS = {
  subtitle: (kind: string) => `種類: ${kind}`,
  kind: "種類",
  close: "閉じる",
  apply: "適用",
  cancel: "キャンセル",
  deleteField: "このフィールドを削除",
  label: "表示名",
  labelHelp: "入力フォームのラベルと一覧の列見出しに使います",
  keyHelp: "公開 API の応答でこの名前が使われます。英小文字・数字・_ のみ",
  keyHelpSaved: "公開 API の応答でこの名前が使われます。保存したあとは変更できません",
  description: "説明文",
  descriptionHelp: "入力欄の下に補足として表示します",
  descriptionTooLong: (max: number) => `説明文は ${max} 文字以内で入力してください`,
  required: "必須",
  titleField: "タイトルに使う",
  titleFieldHelp: "一覧・ホーム・パンくずで、このフィールドの値をタイトルとして表示します",
  titleFieldImplicitHelp:
    "最初のテキスト(1 行)が既定でタイトルになります。別のフィールドで「タイトルに使う」を付けると切り替わります",
  indexed: "公開 API で絞り込み・並べ替えに使う",
  indexedHelp: "公開 API の検索条件や並び順に使えるようになります",
  unique: "同じ値を許可しない",
  uniqueHelp: "他のコンテンツと同じ値は保存できません",
  uniqueSlugHelp: "他のコンテンツと同じ値は保存できません。URL スラッグでは常に有効です",
  maxLength: "最大文字数",
  maxLengthInvalid: "1 以上の整数で入力してください",
  integer: "整数のみ",
  options: "選択肢",
  optionLabel: "表示名",
  optionValue: "API で使う値",
  addOption: "選択肢を追加",
  removeOption: (label: string) => `${label || "(空)"}を外す`,
  optionsRequired: "選択肢を 1 件以上入力してください",
  optionLabelEmpty: "表示名を入力してください",
  optionValueEmpty: "API で使う値を入力してください",
  optionValueDuplicate: (value: string) => `「${value}」が重複しています`,
  multiple: "複数選択",
  cardinality: "件数",
  one: "1 件だけ",
  many: "複数",
  ordered: "並び順を保持",
  orderedHelp: "選んだ順番を公開 API の応答でも保ちます",
  allowedTypes: "参照できる型",
  allowedTypesRequired: "参照できる型を 1 つ以上選んでください",
  deleteDialog: {
    title: (label: string) => `フィールド「${label}」を削除しますか？`,
    body: (key: string) =>
      `このフィールドは入力フォームから消えます。入力済みの値はデータ上に残り、同じ API 名(${key})でフィールドを作り直すと再び表示されます。`,
    publicNote:
      "公開 API の応答にはこの項目の値が残ったまま返りますが、絞り込み・並べ替えには使えなくなります。サイト側でこの項目を使っている場合は、先にサイト側を直してください",
    confirm: "削除する",
  },
} as const;

// 案 F 3〜7 章・F25: メディアライブラリ(一覧・詳細・削除・アップロード)の文言
export const MEDIA_LABELS = {
  add: "ファイルを追加",
  select: "ファイルを選択",
  readOnly: LIST_LABELS.readOnly,
  kinds: {
    all: "すべての種類",
    image: "画像",
    pdf: "PDF",
    video: "動画",
    audio: "音声",
    other: "その他",
  } satisfies Record<MediaKind | "all", string>,
  kindLabel: "種類",
  usageLabel: "使用状況",
  usage: { all: "使用中と未使用", unused: "未使用のみ" },
  sortLabel: "並び順",
  sorts: { newest: "新しい順", name: "ファイル名順" },
  search: "ファイル名・代替テキストで検索",
  count: (n: number) => `${n} 件`,
  unusedCount: (n: number) => `${n} 件 ・ どのコンテンツからも使われていないファイル`,
  clearFilters: LIST_LABELS.noResults.clear,
  viewLabel: "表示の切り替え",
  views: { grid: "グリッド", list: "リスト" },
  unused: "未使用",
  inUse: "使用中",
  usageUnknown: "—",
  noAlt: "代替テキストなし",
  usageFailed: "使用状況を取得できませんでした",
  retry: LIST_LABELS.retry,
  tableLabel: "メディアの一覧",
  gridLabel: "メディアの一覧",
  columns: {
    thumb: "サムネイル",
    name: "ファイル名",
    kind: "種類",
    size: "サイズ",
    uploaded: "アップロード",
    usage: "使用状況",
  },
  remove: "外す",
  dropHint: "画面のどこにでもファイルをドロップしてアップロードできます(1 ファイル 20 MB まで)",
  dropLimit: "1 ファイル 20 MB まで",
  empty: {
    title: "メディアはまだありません",
    description:
      "画像・PDF・動画をここにドロップするか、「ファイルを追加」から選んでください。アップロードしたファイルは、本文やアイキャッチから選べるようになります。1 ファイル 20 MB まで。",
    viewerDescription: "アップロードされたファイルがここに表示されます",
  },
  noResults: {
    title: "条件に一致するファイルはありません",
    description: "別の言葉で検索するか、絞り込みを解除してください",
  },
  upload: {
    failed: "アップロードできませんでした",
    progressTitle: "アップロードしています…",
    progress: (done: number, total: number) => `${done} / ${total} 件が完了`,
    // タイルごとの進捗(D3 M6)。全体の「n / m 件が完了」とは別
    progressDetail: (percent: number, loaded: string, total: string) =>
      `${percent}% ・ ${loaded} / ${total}`,
    failedCount: (n: number) => `${n} 件は送れませんでした`,
    cancel: BULK_LABELS.cancel,
  },
  detail: {
    kind: "種類",
    size: "サイズ",
    dimensions: "大きさ",
    uploaded: "アップロード",
    dimensionsOf: (w: number, h: number) => `${w} × ${h}`,
    alt: "代替テキスト",
    altHelp: "画像の内容を短く説明します。読み上げソフトや画像が表示できないときに使われます",
    caption: "キャプション",
    captionPlaceholder: "画像の下に表示する文",
    captionHelp: "本文に挿入したとき、画像の下に出ます",
    save: "保存",
    publication: "公開",
    published: "公開中",
    publishedNote: "使っているコンテンツと一緒に公開済み",
    unpublished: "未公開",
    unpublishedNote: "このファイルを使っているコンテンツを公開すると、一緒に公開されます",
    publicUrl: "公開 URL",
    copy: "コピー",
    publicationFailed: "公開状態を取得できませんでした",
    usage: "使用箇所",
    usageCount: (n: number) => `${n} 件`,
    usageEmpty: "まだ使われていません",
    usageFailed: "使用箇所を取得できませんでした",
    separator: " ・ ",
    replaceHint:
      "差し替えたいときは、新しいファイルをアップロードして、上の各コンテンツで選び直してください",
    delete: "ファイルを削除",
    notFound: "ファイルが見つかりません。削除された可能性があります",
  },
  deleteDialog: {
    title: (name: string) => `${name} を削除しますか？`,
    body: "ファイルは元に戻せません。",
    checking: "使用箇所を確認しています…",
    checkFailed: "使用箇所を確認できませんでした",
    inUse: (n: number) => `${n} 件のコンテンツで使われています`,
    inUseTitles: (titles: string, rest: number) =>
      rest === 0 ? `(${titles})` : `(${titles}、ほか ${rest} 件)`,
    consequence:
      "。削除すると、そのコンテンツからこのファイルが表示されなくなります。公開中のページでも表示されなくなります",
    confirm: DIALOGS.delete.confirm,
    bulkTitle: (n: number) => `${n} 件のファイルを削除しますか？`,
    bulkInUse: (m: number) => `そのうち ${m} 件はコンテンツで使われています`,
  },
  bulk: {
    region: BULK_LABELS.region,
    delete: "削除",
    selectAll: (n: number) => `${n} 件すべてを選択`,
    clear: BULK_LABELS.clear,
    running: "削除しています…",
    retry: BULK_LABELS.retry.delete,
  },
} as const;

// 案 H のメディアピッカー(F25)
export const MEDIA_PICKER_LABELS = {
  title: "メディアを選択",
  fieldNote: (field: string, many: boolean) =>
    `「${field}」フィールド ・ ${many ? "複数選べます" : "1 件だけ"}`,
  bodyField: "本文",
  upload: "アップロード",
  gridLabel: "ファイル",
  selected: "選択中",
  selectedRegion: "選択中のファイル",
  selectedCount: (n: number) => `${n} 件`,
  altSaveFailed: (n: number) => `${n} 件の代替テキストを保存できませんでした`,
  none: "左の一覧からファイルを選んでください",
  alt: "代替テキスト",
  altHelp: "挿入する前に入れておくと、本文でもそのまま使われます",
  altPlaceholder: "画像の内容を短く",
  justUploaded: "たった今アップロード",
  uploaded: "アップロード完了",
  dropHint: "ここにファイルをドロップしてもアップロードできます",
  cancel: DIALOGS.cancel,
  insert: (n: number) => `${n} 件を挿入`,
  useOne: "このファイルを使う",
  separator: " ・ ",
} as const;
