import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, type Mock } from "vitest";
import { createAppContext, getRouter } from "./router";

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

function renderAt(path: string, routes: Record<string, Handler>) {
  const router = getRouter({
    context: createAppContext(stubFetch(routes)),
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

describe("認証済みシェル (/t/$tenantSlug)", () => {
  it("renders nav from the slot registry, the tenant header, and the content type list", async () => {
    const routes = authedRoutes();
    renderAt("/t/blog/content-types", routes);
    expect(await screen.findByRole("link", { name: "コンテンツタイプ" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Blog/ })).toHaveAttribute("href", "/tenants");
    expect(await screen.findByRole("cell", { name: "article" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "記事" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "2" })).toBeInTheDocument(); // フィールド数
    // Bearer トークンが付与されている（token-manager 経由）
    const listCall = routes["/v1/t/t1/content-types"]?.mock.calls[0]?.[0] as RequestInit;
    expect(new Headers(listCall.headers).get("authorization")).toBe("Bearer jwt-abc");
  });

  it("shows the empty state for a tenant without content types", async () => {
    const routes = authedRoutes({
      "/v1/t/t1/content-types": vi.fn(() => jsonResponse(200, { contentTypes: [] })),
    });
    renderAt("/t/blog/content-types", routes);
    expect(await screen.findByText(/コンテンツタイプはまだありません/)).toBeInTheDocument();
  });

  it("redirects to /tenants for a slug the user does not belong to", async () => {
    renderAt("/t/ghost/content-types", authedRoutes());
    expect(await screen.findByRole("heading", { name: "テナントを選択" })).toBeInTheDocument();
  });

  it("redirects to /login when unauthenticated", async () => {
    renderAt(
      "/t/blog/content-types",
      authedRoutes({
        "/auth/tenants": vi.fn(() => jsonResponse(401, { error: "unauthenticated" })),
      }),
    );
    expect(await screen.findByRole("heading", { name: "ログイン" })).toBeInTheDocument();
  });

  it("redirects /t/$tenantSlug to the content type list", async () => {
    renderAt("/t/blog", authedRoutes());
    expect(await screen.findByRole("cell", { name: "article" })).toBeInTheDocument();
  });

  it("logs out from the shell header", async () => {
    const logout = vi.fn(() => jsonResponse(200, { ok: true }));
    renderAt("/t/blog/content-types", authedRoutes({ "/auth/logout": logout }));
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "ログアウト" }));
    expect(await screen.findByRole("heading", { name: "ログイン" })).toBeInTheDocument();
    expect(logout).toHaveBeenCalledTimes(1);
  });
});
