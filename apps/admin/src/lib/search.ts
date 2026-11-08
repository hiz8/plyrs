// 一覧の検索語の扱い。コンテンツの一覧とメディアの一覧の両方が使う

// TanStack Router の既定の search パーサは値を JSON として読むため、手書きのリンクの ?q=2026 は
// number、?q=true は boolean で届く。検索語としては文字列に戻す
export function searchText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  return typeof value === "number" || typeof value === "boolean" ? String(value) : "";
}

// 全角・半角や大文字・小文字の違いを無視して部分一致させる
export function normalizeForSearch(text: string): string {
  return text.normalize("NFKC").toLocaleLowerCase("ja");
}
