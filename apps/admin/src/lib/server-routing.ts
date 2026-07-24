import { isApiPath } from "./api-paths";

// server.ts は cloudflare:workers を import するため vitest で直接テストできない —
// 判定だけこの純関数に切り出す(api-paths.ts と同じ理由)。
export type ServerRoute = "api" | "shell" | "ssr";

export function resolveServerRoute(
  request: Request,
  opts: { devProxyPublic: boolean },
): ServerRoute {
  const { pathname } = new URL(request.url);
  if (isApiPath(pathname)) {
    return "api";
  }
  // 裁定 10(2026-07-18): E2E がコアジャーニーを検証するための dev 限定転送を維持。
  if (opts.devProxyPublic && (pathname === "/public/v1" || pathname.startsWith("/public/v1/"))) {
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
