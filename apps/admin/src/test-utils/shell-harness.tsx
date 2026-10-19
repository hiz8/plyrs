import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { render } from "@testing-library/react";
import { vi, type Mock } from "vitest";
import { createAppContext, getRouter } from "../router";
import { pendingConnect } from "./fake-socket";

// shell*.test.tsx の共通の下地。RAC の Modal(ドロワー)を開くテストは、同じファイルの 2 本目以降で
// jsdom が戻らなくなる(原因未確認)ため、ドロワーの場面ごとにファイルを分けている

export function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export type Handler = Mock<(init?: RequestInit) => Response>;

export function stubFetch(routes: Record<string, Handler>): typeof fetch {
  return async (input, init) => {
    const path =
      typeof input === "string"
        ? input
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

export function renderAt(
  path: string,
  routes: Record<string, Handler>,
  connect: () => Promise<import("@plyrs/sync-client").WebSocketLike> = pendingConnect,
) {
  const router = getRouter({
    context: createAppContext(stubFetch(routes), { connect: () => () => connect() }),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  render(<RouterProvider router={router} />);
  return router;
}

export const blogTenant = { id: "t1", slug: "blog", name: "Blog", role: "owner" };

export function authedRoutes(overrides: Record<string, Handler> = {}): Record<string, Handler> {
  return {
    // 未認証時は /login に落ちる。その loader が無条件で叩くため、ここでの関心事でなくても
    // 常に無効(siteKey: null)を用意しておく。
    "/auth/turnstile-config": vi.fn(() => jsonResponse(200, { siteKey: null })),
    "/auth/tenants": vi.fn(() => jsonResponse(200, { tenants: [blogTenant] })),
    "/auth/me": vi.fn(() => jsonResponse(200, { userId: "u1", email: "owner@example.com" })),
    "/v1/t/t1/modules": vi.fn(() => jsonResponse(200, { modules: [] })),
    "/auth/token": vi.fn(() => jsonResponse(200, { token: "jwt-abc", expiresIn: 900 })),
    "/v1/t/t1/content-types": vi.fn(() =>
      jsonResponse(200, {
        contentTypes: [
          {
            id: "c1",
            key: "article",
            name: "記事",
            fields: [
              { key: "title", type: "text", required: true },
              { key: "slug", type: "text", config: { unique: true } },
            ],
            source: "user",
            pluginId: null,
            createdAt: "2026-07-16T00:00:00Z",
            updatedAt: "2026-07-16T00:00:00Z",
            version: 1,
            description: null,
            titleField: null,
            listColumns: null,
            menuOrder: null,
          },
        ],
      }),
    ),
    ...overrides,
  };
}
