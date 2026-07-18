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

// パス → ハンドラの素朴なスタブ。未定義パスへの fetch は即テスト失敗にする(auth-flow.test.tsx と同様式)。
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

const OTPAUTH_URI = "otpauth://totp/plyrs:admin@example.com?secret=JBSWY3DPEHPK3PXP&issuer=plyrs";

describe("super login", () => {
  it("shows the bootstrap form when not bootstrapped and reveals the totp secret", async () => {
    const status: Handler = vi.fn(() => jsonResponse(200, { bootstrapped: false }));
    const bootstrap: Handler = vi.fn(() =>
      jsonResponse(201, {
        adminId: "a1",
        totpSecret: "JBSWY3DPEHPK3PXP",
        otpauthUri: OTPAUTH_URI,
      }),
    );
    renderAt("/super-login", {
      "/super-auth/status": status,
      "/super-auth/bootstrap": bootstrap,
    });

    expect(await screen.findByRole("heading", { name: "初期セットアップ" })).toBeInTheDocument();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("メールアドレス"), "admin@example.com");
    await user.type(screen.getByLabelText("パスワード"), "hunter2hunter2hunter2");
    await user.click(screen.getByRole("button", { name: "登録" }));

    expect(await screen.findByText("JBSWY3DPEHPK3PXP")).toBeInTheDocument();
    expect(screen.getByText(OTPAUTH_URI)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "運営コンソールへログイン" })).toBeInTheDocument();
    expect(screen.getByLabelText("認証コード")).toBeInTheDocument();
    expect(bootstrap).toHaveBeenCalledTimes(1);
    const bootstrapInit = bootstrap.mock.calls[0]?.[0];
    expect(JSON.parse(String((bootstrapInit as RequestInit).body))).toStrictEqual({
      email: "admin@example.com",
      password: "hunter2hunter2hunter2",
    });
  });

  it("logs in with email + password + totp and navigates to /super", async () => {
    const status: Handler = vi.fn(() => jsonResponse(200, { bootstrapped: true }));
    const login: Handler = vi.fn(() => jsonResponse(200, { adminId: "a1" }));
    const me: Handler = vi.fn(() =>
      jsonResponse(200, { adminId: "a1", email: "admin@example.com" }),
    );
    renderAt("/super-login", {
      "/super-auth/status": status,
      "/super-auth/login": login,
      "/super-auth/me": me,
    });

    expect(
      await screen.findByRole("heading", { name: "運営コンソールへログイン" }),
    ).toBeInTheDocument();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("メールアドレス"), "admin@example.com");
    await user.type(screen.getByLabelText("パスワード"), "hunter2hunter2hunter2");
    await user.type(screen.getByLabelText("認証コード"), "123456");
    await user.click(screen.getByRole("button", { name: "ログイン" }));

    expect(await screen.findByRole("link", { name: "テナント" })).toHaveAttribute("href", "/super");
    expect(screen.getByRole("link", { name: "ユーザー" })).toHaveAttribute("href", "/super/users");
    expect(screen.getByRole("link", { name: "DLQ" })).toHaveAttribute("href", "/super/dlq");
    expect(screen.getByRole("link", { name: "監査ログ" })).toHaveAttribute("href", "/super/audit");
    expect(screen.getByRole("link", { name: "モジュール" })).toHaveAttribute(
      "href",
      "/super/modules",
    );
    expect(screen.getByText("admin@example.com")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ログアウト" })).toBeInTheDocument();
    expect(login).toHaveBeenCalledTimes(1);
    const loginInit = login.mock.calls[0]?.[0];
    expect(JSON.parse(String((loginInit as RequestInit).body))).toStrictEqual({
      email: "admin@example.com",
      password: "hunter2hunter2hunter2",
      totpCode: "123456",
    });
  });

  it("redirects /super to /super-login when unauthenticated", async () => {
    const status: Handler = vi.fn(() => jsonResponse(200, { bootstrapped: true }));
    const me: Handler = vi.fn(() => jsonResponse(401, { error: "unauthenticated" }));
    renderAt("/super", { "/super-auth/status": status, "/super-auth/me": me });

    expect(
      await screen.findByRole("heading", { name: "運営コンソールへログイン" }),
    ).toBeInTheDocument();
  });
});
