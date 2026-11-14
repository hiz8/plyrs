import { isApiPath } from "./api-paths";

// server.ts は cloudflare:workers を import するため vitest で直接テストできない —
// 判定だけこの純関数に切り出す(api-paths.ts と同じ理由)。
export type ServerRoute = "api" | "shell" | "ssr" | "config";

const DEV_ONLY_PREFIXES = ["/public/v1", "/mcp", "/.well-known/oauth-protected-resource"];

function matchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function resolveServerRoute(
  request: Request,
  opts: { devProxyPublic: boolean },
): ServerRoute {
  const { pathname } = new URL(request.url);
  // 公開 API のオリジン(設定 › 一般)。api の接頭辞判定より前に見る
  if (pathname === "/_config") {
    return "config";
  }
  if (isApiPath(pathname)) {
    return "api";
  }
  // 決定 10(2026-07-18): E2E がコアジャーニーを検証するための dev 限定転送を維持。
  // M1-7: MCP の入口(/mcp/t/:tenantId)と PRM も同じ扱い。本番では api 直接オリジン(決定 48)で、
  // admin は転送しない。dev の api は auxiliary worker で自前の URL を持たないため、E2E はここを通る
  if (opts.devProxyPublic && DEV_ONLY_PREFIXES.some((prefix) => matchesPrefix(pathname, prefix))) {
    return "api";
  }
  // ドキュメント要求(トップレベルナビゲーション)だけをシェル化する — アセット等の
  // 非ドキュメント GET は SPA シェルに巻き込まない。
  const isDocumentRequest =
    request.headers.get("Sec-Fetch-Dest") === "document" ||
    (request.headers.get("Accept") ?? "").includes("text/html");
  if (request.method === "GET" && isDocumentRequest) {
    return "shell";
  }
  return "ssr";
}
