import { vi, type Mock } from "vitest";

// records-harness / shell-harness の共通の下地。fetch のスタブと、認証済みの既定ルート

export function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export type Handler = Mock<(init?: RequestInit) => Response | Promise<Response>>;

export function stubFetch(routes: Record<string, Handler>): typeof fetch {
  return async (input, init) => {
    const path =
      typeof input === "string"
        ? // クエリ文字列(?type=article など)はルートの照合に含めない
          (input.split("?")[0] ?? input)
        : input instanceof URL
          ? input.pathname
          : new URL(input.url).pathname;
    const handler = routes[path];
    if (handler === undefined) {
      throw new Error(`unexpected fetch: ${path}`);
    }
    return handler(init ?? undefined);
  };
}

export function blogTenantOf(role = "owner") {
  return { id: "t1", slug: "blog", name: "Blog", role };
}

// 2 つのハーネスに共通の既定。各ハーネスが content-types などを重ねる
export function baseAuthedRoutes(
  overrides: Record<string, Handler> = {},
  role = "owner",
): Record<string, Handler> {
  return {
    // 未認証時は /login に落ちる。その loader が無条件で叩くため、ここでの関心事でなくても
    // 常に無効(siteKey: null)を用意しておく。
    "/auth/turnstile-config": vi.fn(() => jsonResponse(200, { siteKey: null })),
    "/auth/tenants": vi.fn(() => jsonResponse(200, { tenants: [blogTenantOf(role)] })),
    "/auth/me": vi.fn(() => jsonResponse(200, { userId: "u1", email: "owner@example.com" })),
    "/_config": vi.fn(() => jsonResponse(200, { publicApiOrigin: "" })),
    "/auth/token": vi.fn(() => jsonResponse(200, { token: "jwt-abc", expiresIn: 900 })),
    "/v1/t/t1/members": vi.fn(() =>
      jsonResponse(200, {
        members: [
          {
            userId: "u1",
            email: "owner@example.com",
            role: "owner",
            createdAt: "2026-07-16T00:00:00Z",
          },
        ],
      }),
    ),
    "/v1/t/t1/modules": vi.fn(() => jsonResponse(200, { modules: [] })),
    "/v1/t/t1/publications": vi.fn(() => jsonResponse(200, { publications: [], nextCursor: null })),
    ...overrides,
  };
}
