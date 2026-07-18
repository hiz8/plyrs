// 2026-07-16 裁定: /auth・/v1 は service binding で api Worker へ転送する same-origin
// プロキシ。/public/v1 は転送しない（ヘッドレス契約 = api Worker の直接の責務）。
// server.ts は cloudflare:workers を import するため vitest で直接テストできない —
// 判定だけこの純関数に切り出す（6a 最終レビュー Minor の消化）。
// /super-auth・/super/v1 は api Worker の特権面。/super(ページ)や /super-login は admin の
// ルートなので転送しない — プレフィックスは正確に v1 まで含める。
const API_PREFIXES = ["/auth", "/v1", "/super-auth", "/super/v1"];

export function isApiPath(pathname: string): boolean {
  return API_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}
