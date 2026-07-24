import handler, { createServerEntry } from "@tanstack/react-start/server-entry";
import { env } from "cloudflare:workers";
import { resolveServerRoute } from "./lib/server-routing";

// SPA シェル配信(防御 A): TanStack Start の SPA モードは「404 を _shell.html へ
// リライトする」静的ホスティング前提(Netlify _redirects 等)。Workers にはこのリライト層が
// ないため、判定を resolveServerRoute に切り出し薄い接着層としてここで振り分ける。
// WebSocket（/v1/t/:tenantId/sync）の upgrade は isApiPath 経由で "api" に乗る。
export default createServerEntry({
  async fetch(request) {
    const route = resolveServerRoute(request, { devProxyPublic: env.DEV_PROXY_PUBLIC === "1" });
    if (route === "api") {
      return env.API.fetch(request);
    }
    if (route === "shell") {
      // dev には _shell が存在しない(prerender はビルド時のみ)ため、ASSETS 未定義
      // または非 ok は下の handler.fetch にフォールバック = dev の従来挙動を維持
      // (既存 E2E 3 本が dev SSR 前提のため必須)。例外時も同様に SSR フォールバック
      // (防御 B が受ける)。
      try {
        const shellResponse = await env.ASSETS?.fetch(new URL("/_shell", request.url));
        if (shellResponse?.ok) {
          return new Response(shellResponse.body, { headers: shellResponse.headers, status: 200 });
        }
      } catch {
        // 下の handler.fetch へ合流。
      }
    }
    // "ssr" ルート、および shell フォールバックはここに合流する。
    return handler.fetch(request);
  },
});
