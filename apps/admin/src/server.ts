import handler, { createServerEntry } from "@tanstack/react-start/server-entry";
import { env } from "cloudflare:workers";

// 2026-07-16 裁定: /auth・/v1 は service binding で api Worker へ転送する same-origin
// プロキシ。SameSite=Strict のセッション cookie がそのまま届き、CORS/CSRF 面を開かない。
// WebSocket（/v1/t/:tenantId/sync、Phase 6b で使用）の upgrade もこの転送に乗る。
// /public/v1 は転送しない（公開 read はヘッドレス契約 = api Worker の直接の責務）。
const API_PREFIXES = ["/auth", "/v1"];

function isApiPath(pathname: string): boolean {
  return API_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export default createServerEntry({
  fetch(request) {
    const { pathname } = new URL(request.url);
    if (isApiPath(pathname)) {
      return env.API.fetch(request);
    }
    return handler.fetch(request);
  },
});
