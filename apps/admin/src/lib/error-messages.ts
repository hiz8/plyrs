import { SyncRejectedError } from "@plyrs/sync-client";
import { ApiError } from "./api-client";
import { NetworkError } from "./network-error";
import { SuperApiError } from "./super-api";

// 案 F 3.3 の文言。送る前に弾くとき(media.ts)と、サーバーの 413 で弾かれたときで共用する
export const UPLOAD_TOO_LARGE_MESSAGE = "20 MB を超えるファイルはアップロードできません";

// 案 H 4.2: API のエラー文をそのまま表示せず、エラーコードから利用者向けの文に置き換える。
// 文は「何が起きたか」と「どうすればよいか」を書く。該当が無いときは呼び出し側の汎用の文を使う。
export const ERROR_MESSAGES: Readonly<Record<string, string>> = {
  // 認証・認可(middleware/tenant-gate.ts、auth/*)
  unauthenticated: "ログインの有効期限が切れました。もう一度ログインしてください",
  forbidden: "この操作を行う権限がありません。サイトの管理者に確認してください",
  blocked: "このアカウントまたはサイトは利用が停止されています。サイトの管理者に確認してください",
  invalid_credentials: "メールアドレスまたはパスワードが違います",
  email_taken: "このメールアドレスは既に登録されています",
  turnstile_required: "認証確認に失敗しました。もう一度お試しください",
  turnstile_failed: "認証確認に失敗しました。もう一度お試しください",
  rate_limited: "操作が集中しています。しばらく待ってから、もう一度お試しください",
  rate_limiter_unavailable: "ただいま混み合っています。しばらく待ってから、もう一度お試しください",
  not_a_member: "このサイトのメンバーではありません。サイトの管理者に招待を依頼してください",
  // パスワードの変更(POST /auth/password、案 G 6.2)
  wrong_password: "現在のパスワードが違います。入力し直してください",
  same_password: "新しいパスワードが現在のパスワードと同じです。別のパスワードを入力してください",
  // コンテンツの書き込み・公開(do/write-record.ts、do/publish.ts、do/delete-record.ts、sync/handlers.ts)
  not_found: "対象が見つかりませんでした。削除された可能性があるため、画面を再読み込みしてください",
  validation_failed: "入力内容に誤りがあります。各項目を確認してください",
  unique_violation: "同じ値のコンテンツが既にあります。重複しない値に変更してください",
  invalid_status: "このステータスには変更できません。画面を再読み込みしてください",
  conflict: "ほかの人が同じ項目を編集しました。内容を確認してから、もう一度保存してください",
  record_deleted: "このコンテンツは削除されているため公開できません",
  already_deleted: "このコンテンツは既に削除されています",
  not_published: "このコンテンツは公開されていません",
  unknown_type:
    "コンテンツタイプが見つかりませんでした。削除された可能性があるため、画面を再読み込みしてください",
  // コンテンツタイプ(do/content-types.ts)
  id_mismatch:
    "同じ識別名のコンテンツタイプが既にあります。画面を再読み込みしてから、もう一度お試しください",
  key_mismatch:
    "コンテンツタイプの識別名は変更できません。新しいコンテンツタイプとして作成してください",
  type_not_empty:
    "コンテンツが残っているため、このコンテンツタイプは削除できません。先にコンテンツをすべて削除してください",
  // メディア(routes/tenant.ts の assets)
  too_large: UPLOAD_TOO_LARGE_MESSAGE,
  invalid_filename: "このファイル名は使用できません。名前を変更してから、もう一度お試しください",
  empty_body: "ファイルが空です。別のファイルを選んでください",
  // モジュール(modules/enablement.ts)
  unknown_module: "モジュールが見つかりませんでした。画面を再読み込みしてください",
  type_conflict: "同じ名前のコンテンツタイプが既にあるため、モジュールを有効にできません",
  // サイト(super の作成画面)
  slug_taken: "このサイトの識別子は既に使われています",
  unknown_owner: "指定したメールアドレスのユーザーが見つかりません",
  // メンバー管理(案 G 4 章、裁定 G14)
  last_owner:
    "最後の管理者のため、ロールの変更と削除はできません。先に別のメンバーを管理者にしてください",
  already_member: "このメールアドレスは既にメンバーです",
  user_not_found:
    "このメールアドレスのユーザーは登録されていません。先にサインアップを依頼してください",
};

export const NETWORK_ERROR_MESSAGE =
  "サーバーに接続できませんでした。接続を確認して、もう一度お試しください";

// ApiError / SuperApiError / SyncRejectedError と、同期の push 結果({ ok: false, code, message })から
// コードを取り出す
export function errorCodeOf(cause: unknown): string | undefined {
  if (
    cause instanceof ApiError ||
    cause instanceof SuperApiError ||
    cause instanceof SyncRejectedError
  ) {
    return cause.code;
  }
  if (typeof cause === "object" && cause !== null && "code" in cause) {
    const code = (cause as { code: unknown }).code;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
}

export function errorMessage(cause: unknown, fallback: string): string {
  const code = errorCodeOf(cause);
  if (code !== undefined && Object.hasOwn(ERROR_MESSAGES, code)) {
    return ERROR_MESSAGES[code] ?? fallback;
  }
  // 素の TypeError は見ない(ハンドラ内のバグまで接続エラーに見せないため。network-error.ts)
  if (cause instanceof NetworkError) {
    return NETWORK_ERROR_MESSAGE;
  }
  return fallback;
}
