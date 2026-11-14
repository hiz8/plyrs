// M3-2(design-spec 16.2、ロードマップ 8 章): ログイン後の戻り先。OAuth の同意画面(api が描画する
// `/oauth/t/:tenantId/authorize`)が未ログインの利用者を `/login?return_to=…` に回し、ログイン後に同じ URL へ
// 戻す。オープンリダイレクトを防ぐため、同一オリジンの `/oauth/t/` 配下のパスだけを許す。
// 検査するのはパス部分だけ(レビュー修正 Important 2): クエリには redirect_uri や client_id の URL が
// `/` を %エンコードせずに入りうるので、クエリの中の `//` や `..` は捨てない。
// スキーム付き・`//` や `/\` 始まり・`..` を含むパス・制御文字・`#` は捨てる(呼び出し側は従来どおり /tenants へ)。

const PATH = /^\/oauth\/t\/[^/]+\/authorize$/;
const PLACEHOLDER = "http://placeholder.invalid";

export function safeReturnTo(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 4096) {
    return null;
  }
  // 先頭が `//` や `/\` だと別ホストへの相対 URL になる
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) {
    return null;
  }
  // 制御文字(改行など)はヘッダ注入の余地になる。`#` 以降はサーバーに届かないので持たない
  for (const ch of value) {
    if (ch.charCodeAt(0) < 0x20 || ch.charCodeAt(0) === 0x7f || ch === "#") {
      return null;
    }
  }
  let url: URL;
  try {
    url = new URL(value, PLACEHOLDER);
  } catch {
    return null;
  }
  if (url.origin !== PLACEHOLDER || !PATH.test(url.pathname)) {
    return null;
  }
  // `..` などの正規化で変わるパスは、生のパスと解釈後のパスが一致しないので捨てる
  const rawPath = value.slice(0, value.indexOf("?") < 0 ? value.length : value.indexOf("?"));
  return rawPath === url.pathname ? value : null;
}
