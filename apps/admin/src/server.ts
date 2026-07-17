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
    return handler.fetch(request);
  },
});
