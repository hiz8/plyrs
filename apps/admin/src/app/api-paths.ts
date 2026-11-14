// 2026-07-16 決定: /auth・/v1 は service binding で api Worker へ転送する same-origin
// プロキシ。/public/v1 は転送しない（ヘッドレス契約 = api Worker の直接の責務）。
// server.ts は cloudflare:workers を import するため vitest で直接テストできない —
// 判定だけこの純関数に切り出す（6a 最終レビュー Minor の消化）。
// /super-auth・/super/v1 は api Worker の運営管理画面向けの経路。/super(ページ)や /super-login は admin の
// ルートなので転送しない — プレフィックスは正確に v1 まで含める。
// M3-1(design-spec 16.2、決定 47): OAuth の認可サーバーは api にあるが、issuer は admin オリジンの
// テナント別パス `/oauth/t/:tenantId`。`/authorize` が admin のセッション cookie を見るため、/auth と同じ
// 同一オリジン転送に乗せる。metadata(RFC 8414)は issuer のパスが well-known の後ろに続く
const API_PREFIXES = [
  "/auth",
  "/v1",
  "/super-auth",
  "/super/v1",
  "/oauth",
  "/.well-known/oauth-authorization-server",
];

export function isApiPath(pathname: string): boolean {
  return API_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}
