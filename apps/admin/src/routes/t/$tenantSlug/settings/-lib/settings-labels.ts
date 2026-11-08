import { TERMS } from "~/lib/labels";

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
