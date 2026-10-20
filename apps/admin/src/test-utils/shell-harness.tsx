import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { render } from "@testing-library/react";
import { vi } from "vitest";
import { createAppContext, getRouter } from "../router";
import { baseAuthedRoutes, blogTenantOf, jsonResponse, stubFetch, type Handler } from "./api-stubs";
import { pendingConnect } from "./fake-socket";

// shell*.test.tsx の共通の下地。RAC の Modal(ドロワー)を開くテストは、同じファイルの 2 本目以降で
// jsdom が戻らなくなる(原因未確認)ため、ドロワーの場面ごとにファイルを分けている

export { jsonResponse, stubFetch, type Handler };

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

export const blogTenant = blogTenantOf();

export function authedRoutes(overrides: Record<string, Handler> = {}): Record<string, Handler> {
  return baseAuthedRoutes({
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
  });
}
