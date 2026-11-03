// M3-2(design-spec 16.2、ロードマップ 8 章): ログイン後の戻り先。OAuth の同意画面(api が描画する
// `/oauth/t/:tenantId/authorize`)が未ログインの利用者を `/login?return_to=…` に回し、ログイン後に同じ URL へ
// 戻す。オープンリダイレクトを防ぐため、同一オリジンの `/oauth/t/` 配下のパスだけを許す。
// スキーム付き・`//` 始まり・`\`・制御文字・`..` を含むものは捨てる(呼び出し側は従来どおり /tenants へ)。

const RETURN_TO = /^\/oauth\/t\/[^/?#\\]+\/authorize(\?[^#]*)?$/;

export function safeReturnTo(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 4096) {
    return null;
  }
  if (value.includes("//") || value.includes("\\") || value.includes("..")) {
    return null;
  }
  // 制御文字(改行など)はヘッダ注入の余地になる
  for (const ch of value) {
    if (ch.charCodeAt(0) < 0x20 || ch.charCodeAt(0) === 0x7f) {
      return null;
    }
  }
  return RETURN_TO.test(value) ? value : null;
}
