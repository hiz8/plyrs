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

// パス → ハンドラの素朴なスタブ。未定義パスへの fetch は即テスト失敗にする。
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

describe("ログインフロー", () => {
  it("logs in and navigates to the tenant chooser", async () => {
    const login: Handler = vi.fn(() => jsonResponse(200, { userId: "u1" }));
    const tenants = vi.fn(() => jsonResponse(200, { tenants: [] }));
    renderAt("/login", { "/auth/login": login, "/auth/tenants": tenants });
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("メールアドレス"), "a@example.com");
    await user.type(screen.getByLabelText("パスワード"), "hunter2hunter2");
    await user.click(screen.getByRole("button", { name: "ログイン" }));
    expect(await screen.findByRole("heading", { name: "テナントを選択" })).toBeInTheDocument();
    expect(login).toHaveBeenCalledTimes(1);
    const loginInit = login.mock.calls[0]?.[0];
    const body = JSON.parse(String((loginInit as RequestInit).body));
    expect(body).toStrictEqual({ email: "a@example.com", password: "hunter2hunter2" });
  });

  it("shows a field-level error for invalid credentials", async () => {
    const login = vi.fn(() => jsonResponse(401, { error: "invalid_credentials" }));
    renderAt("/login", { "/auth/login": login });
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("メールアドレス"), "a@example.com");
    await user.type(screen.getByLabelText("パスワード"), "wrong-password-x");
    await user.click(screen.getByRole("button", { name: "ログイン" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "メールアドレスまたはパスワードが違います",
    );
  });

  it("signs up and lands on the tenant chooser", async () => {
    const signup = vi.fn(() => jsonResponse(201, { userId: "u1" }));
    const tenants = vi.fn(() => jsonResponse(200, { tenants: [] }));
    renderAt("/signup", { "/auth/signup": signup, "/auth/tenants": tenants });
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("メールアドレス"), "new@example.com");
    await user.type(screen.getByLabelText("パスワード"), "hunter2hunter2");
    await user.click(screen.getByRole("button", { name: "サインアップ" }));
    expect(await screen.findByRole("heading", { name: "テナントを選択" })).toBeInTheDocument();
  });

  it("redirects unauthenticated visitors from /tenants to /login", async () => {
    const tenants = vi.fn(() => jsonResponse(401, { error: "unauthenticated" }));
    renderAt("/tenants", { "/auth/tenants": tenants });
    expect(await screen.findByRole("heading", { name: "ログイン" })).toBeInTheDocument();
  });

  it("lists tenants as links into the shell", async () => {
    const tenants = vi.fn(() =>
      jsonResponse(200, {
        tenants: [
          { id: "t1", slug: "blog", name: "Blog", role: "owner" },
          { id: "t2", slug: "shop", name: "Shop", role: "editor" },
        ],
      }),
    );
    renderAt("/tenants", { "/auth/tenants": tenants });
    const link = await screen.findByRole("link", { name: /Blog/ });
    expect(link).toHaveAttribute("href", "/t/blog/content-types");
    expect(screen.getByRole("link", { name: /Shop/ })).toHaveAttribute(
      "href",
      "/t/shop/content-types",
    );
  });

  it("creates a tenant and refreshes the list", async () => {
    const created = { id: "t9", slug: "new-blog", name: "New Blog", role: "owner" };
    let tenantRows: unknown[] = [];
    const tenants = vi.fn(() => jsonResponse(200, { tenants: tenantRows }));
    const create = vi.fn(() => {
      tenantRows = [created];
      return jsonResponse(201, { tenantId: "t9" });
    });
    renderAt("/tenants", { "/auth/tenants": tenants, "/v1/tenants": create });
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("テナント名"), "New Blog");
    await user.type(screen.getByLabelText("slug"), "new-blog");
    await user.click(screen.getByRole("button", { name: "作成" }));
    expect(await screen.findByRole("link", { name: /New Blog/ })).toBeInTheDocument();
    expect(create).toHaveBeenCalledTimes(1);
  });
});
