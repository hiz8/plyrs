import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, type Mock } from "vitest";
import { createAppContext, getRouter } from "./router";
import { pendingConnect } from "./test-utils/fake-socket";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

type Handler = Mock<(init?: RequestInit) => Response>;

function stubFetch(routes: Record<string, Handler>): typeof fetch {
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

function renderAt(
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

const blogTenant = { id: "t1", slug: "blog", name: "Blog", role: "owner" };

function authedRoutes(overrides: Record<string, Handler> = {}): Record<string, Handler> {
  return {
    "/auth/tenants": vi.fn(() => jsonResponse(200, { tenants: [blogTenant] })),
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
          },
        ],
      }),
    ),
    ...overrides,
  };
}

const bookingModule = {
  moduleId: "booking",
  name: "予約",
  version: 1,
  enabled: false,
  appliedVersion: 0,
};

describe("モジュール設定ページ", () => {
  it("一覧が表示され、トグルで enable が呼ばれて再取得される", async () => {
    const listHandler = vi
      .fn()
      .mockReturnValueOnce(jsonResponse(200, { modules: [bookingModule] }))
      .mockReturnValue(
        jsonResponse(200, { modules: [{ ...bookingModule, enabled: true, appliedVersion: 1 }] }),
      );
    const enableHandler = vi.fn(() =>
      jsonResponse(200, {
        ok: true,
        module: { ...bookingModule, enabled: true, appliedVersion: 1 },
      }),
    );
    renderAt("/t/blog/modules", {
      ...authedRoutes(),
      "/v1/t/t1/modules": listHandler,
      "/v1/t/t1/modules/booking/enable": enableHandler,
    });
    expect(await screen.findByText("予約")).toBeInTheDocument();
    expect(screen.getByText("無効")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "有効化" }));
    await waitFor(() => expect(enableHandler).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("有効")).toBeInTheDocument();
    expect(screen.getByText(/適用済み v1/)).toBeInTheDocument();
  });

  it("ナビに「モジュール」項目が出る", async () => {
    renderAt("/t/blog/modules", {
      ...authedRoutes(),
      "/v1/t/t1/modules": vi.fn(() => jsonResponse(200, { modules: [bookingModule] })),
    });
    expect(await screen.findByRole("link", { name: "モジュール" })).toBeInTheDocument();
  });
});
