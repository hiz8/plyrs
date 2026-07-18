import handler, { createServerEntry } from "@tanstack/react-start/server-entry";
import { env } from "cloudflare:workers";
import { isApiPath } from "./lib/api-paths";

// WebSocket（/v1/t/:tenantId/sync）の upgrade もこの転送に乗る。
export default createServerEntry({
  fetch(request) {
    const { pathname } = new URL(request.url);
    if (isApiPath(pathname)) {
      return env.API.fetch(request);
    }
    // 裁定 10(2026-07-18): E2E がコアジャーニー(publish → 公開 read)を検証するための
    // dev 限定転送。本番は 6a 裁定どおり /public/v1 を admin から配信しない。
    if (
      env.DEV_PROXY_PUBLIC === "1" &&
      (pathname === "/public/v1" || pathname.startsWith("/public/v1/"))
    ) {
      return env.API.fetch(request);
    }
    return handler.fetch(request);
  },
});
