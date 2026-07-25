import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi, type Mock } from "vitest";
import type { TurnstileApi, TurnstileRenderParams } from "./lib/turnstile";
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

// §6: AUTH_TURNSTILE_SITE_KEY 未設定(dev 既定)を模す。signup/login の loader が無条件で
// 叩くため、ウィジェットに関心のないテストでも routes マップに含める必要がある。
function turnstileDisabled(): Handler {
  return vi.fn(() => jsonResponse(200, { siteKey: null }));
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
    renderAt("/login", {
      "/auth/login": login,
      "/auth/tenants": tenants,
      "/auth/turnstile-config": turnstileDisabled(),
    });
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
    renderAt("/login", { "/auth/login": login, "/auth/turnstile-config": turnstileDisabled() });
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
    renderAt("/signup", {
      "/auth/signup": signup,
      "/auth/tenants": tenants,
      "/auth/turnstile-config": turnstileDisabled(),
    });
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("メールアドレス"), "new@example.com");
    await user.type(screen.getByLabelText("パスワード"), "hunter2hunter2");
    await user.click(screen.getByRole("button", { name: "サインアップ" }));
    expect(await screen.findByRole("heading", { name: "テナントを選択" })).toBeInTheDocument();
  });

  it("does not render the turnstile widget or send a token when turnstile is disabled", async () => {
    const signup: Handler = vi.fn(() => jsonResponse(201, { userId: "u1" }));
    const tenants = vi.fn(() => jsonResponse(200, { tenants: [] }));
    renderAt("/signup", {
      "/auth/signup": signup,
      "/auth/tenants": tenants,
      "/auth/turnstile-config": turnstileDisabled(),
    });
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("メールアドレス"), "new@example.com");
    await user.type(screen.getByLabelText("パスワード"), "hunter2hunter2");
    await user.click(screen.getByRole("button", { name: "サインアップ" }));
    expect(await screen.findByRole("heading", { name: "テナントを選択" })).toBeInTheDocument();
    // ウィジェット非表示なら loadTurnstile 自体が呼ばれず、script タグも注入されないはず
    // (window.turnstile 未定義のこの時点で widget が動いていれば script 注入で検出できる)。
    expect(
      document.querySelector(
        'script[src^="https://challenges.cloudflare.com/turnstile/v0/api.js"]',
      ),
    ).toBeNull();
    const signupInit = signup.mock.calls[0]?.[0];
    const body = JSON.parse(String((signupInit as RequestInit).body));
    expect(body).toStrictEqual({ email: "new@example.com", password: "hunter2hunter2" });
  });

  it("redirects unauthenticated visitors from /tenants to /login", async () => {
    const tenants = vi.fn(() => jsonResponse(401, { error: "unauthenticated" }));
    renderAt("/tenants", {
      "/auth/tenants": tenants,
      "/auth/turnstile-config": turnstileDisabled(),
    });
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

  it("shows an empty state with no self-serve creation form when there are no tenants", async () => {
    const tenants = vi.fn(() => jsonResponse(200, { tenants: [] }));
    renderAt("/tenants", { "/auth/tenants": tenants });
    expect(await screen.findByText("テナントは運営者が発行します")).toBeInTheDocument();
    expect(screen.queryByLabelText("テナント名")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("slug")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "作成" })).not.toBeInTheDocument();
  });
});

type RenderMock = Mock<(el: HTMLElement, params: TurnstileRenderParams) => string>;

function turnstileEnabled(): Handler {
  return vi.fn(() => jsonResponse(200, { siteKey: "site-xyz" }));
}

function findTurnstileScript(): HTMLScriptElement | null {
  return document.querySelector<HTMLScriptElement>(
    'script[src^="https://challenges.cloudflare.com/turnstile/v0/api.js"]',
  );
}

// window.turnstile を stub していない状態でロード失敗を再現する(実 script 注入が必要なため)。
// このファイルは静的 import のみで vi.resetModules が効かず、lib/turnstile.ts の
// loadPromise はファイル内で共有される。以降の describe(window.turnstile を stub する)を
// 汚染しないよう、残った script は failure させて loadPromise を null に戻しておく。
describe("Turnstile ロード失敗", () => {
  afterEach(() => {
    // グローバルの afterEach(cleanup)がこの後に走る保証はない(hook 実行順に依存しない
    // ようにするため、ここでも明示的に・冪等に呼ぶ)。マウントされたままだと script の
    // failure が widget の再マウント(新しい script 注入)を誘発し、後始末できないまま
    // 後続の describe(window.turnstile を stub する)に漏れてしまう。
    cleanup();
    findTurnstileScript()?.dispatchEvent(new Event("error"));
    vi.unstubAllGlobals();
  });

  it("shows a message when the turnstile script fails to load on the login page", async () => {
    renderAt("/login", { "/auth/turnstile-config": turnstileEnabled() });
    await screen.findByLabelText("メールアドレス");
    await waitFor(() => expect(findTurnstileScript()).not.toBeNull());
    findTurnstileScript()?.dispatchEvent(new Event("error"));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "認証ウィジェットの読み込みに失敗しました。再試行するか、ページを再読み込みしてください。",
    );
  });

  it("shows a message when the turnstile script fails to load on the signup page", async () => {
    renderAt("/signup", { "/auth/turnstile-config": turnstileEnabled() });
    await screen.findByLabelText("メールアドレス");
    await waitFor(() => expect(findTurnstileScript()).not.toBeNull());
    findTurnstileScript()?.dispatchEvent(new Event("error"));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "認証ウィジェットの読み込みに失敗しました。再試行するか、ページを再読み込みしてください。",
    );
  });

  it("retries the turnstile script up to 3 times after load failures, then stops re-injecting", async () => {
    renderAt("/login", { "/auth/turnstile-config": turnstileEnabled() });
    await screen.findByLabelText("メールアドレス");

    const seenScripts = new Set<HTMLScriptElement>();
    for (let attempt = 0; attempt < 4; attempt++) {
      const script = await waitFor(() => {
        const found = findTurnstileScript();
        if (found === null || seenScripts.has(found)) {
          throw new Error("waiting for a fresh script instance");
        }
        return found;
      });
      seenScripts.add(script);
      script.dispatchEvent(new Event("error"));
    }
    expect(seenScripts.size).toBe(4); // 初回 + 上限 3 回分の自動再試行

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "認証ウィジェットの読み込みに失敗しました。再試行するか、ページを再読み込みしてください。",
    );
    // 上限到達後は remount されず、新しい script も注入されない
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(findTurnstileScript()).toBeNull();
  });

  it("clears the load-failure message once a retried widget issues a token", async () => {
    renderAt("/login", { "/auth/turnstile-config": turnstileEnabled() });
    await screen.findByLabelText("メールアドレス");

    const firstScript = await waitFor(() => {
      const found = findTurnstileScript();
      if (found === null) throw new Error("script not injected");
      return found;
    });
    firstScript.dispatchEvent(new Event("error"));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "認証ウィジェットの読み込みに失敗しました。再試行するか、ページを再読み込みしてください。",
    );

    const secondScript = await waitFor(() => {
      const found = findTurnstileScript();
      if (found === null || found === firstScript) {
        throw new Error("waiting for the retried script");
      }
      return found;
    });
    const onloadName = new URL(secondScript.src).searchParams.get("onload");
    if (onloadName === null) throw new Error("onload param missing");
    const renderMock: RenderMock = vi.fn(() => "widget-retry");
    const api: TurnstileApi = { render: renderMock, reset: vi.fn(), remove: vi.fn() };
    vi.stubGlobal("turnstile", api);
    (window as unknown as Record<string, (() => void) | undefined>)[onloadName]?.();

    await waitFor(() => expect(renderMock).toHaveBeenCalledTimes(1));
    renderMock.mock.calls[0]?.[1]?.callback?.("tok-retry");

    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });
});

// window.turnstile を偽装(vi.stubGlobal)。lib/turnstile.ts の loadTurnstile はモジュール
// スコープの Promise を使い回す(idempotent)ため、このファイル内で最初にウィジェットが
// マウントされた時点の window.turnstile が全テストで使い回される — describe 内で 1 個の
// フェイクを共有し、render の呼び出しは「毎回最後の call」を見ることで各テストの
// マウントに対応させる(turnstile-widget.test.tsx とは異なりモジュールリセットはしない)。
describe("Turnstile 統合", () => {
  const renderMock: RenderMock = vi.fn(() => "widget-1");
  const turnstileApi: TurnstileApi = { render: renderMock, reset: vi.fn(), remove: vi.fn() };

  beforeAll(() => {
    vi.stubGlobal("turnstile", turnstileApi);
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  function lastRenderParams(): TurnstileRenderParams | undefined {
    return renderMock.mock.calls.at(-1)?.[1];
  }

  it("includes the resolved turnstile token in the signup request", async () => {
    const signup: Handler = vi.fn(() => jsonResponse(201, { userId: "u1" }));
    const tenants = vi.fn(() => jsonResponse(200, { tenants: [] }));
    renderAt("/signup", {
      "/auth/signup": signup,
      "/auth/tenants": tenants,
      "/auth/turnstile-config": turnstileEnabled(),
    });
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("メールアドレス"), "new@example.com");
    await user.type(screen.getByLabelText("パスワード"), "hunter2hunter2");
    await waitFor(() => expect(renderMock).toHaveBeenCalled());
    lastRenderParams()?.callback?.("tok-signup");
    await waitFor(() => expect(screen.getByRole("button", { name: "サインアップ" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "サインアップ" }));
    expect(await screen.findByRole("heading", { name: "テナントを選択" })).toBeInTheDocument();
    const signupInit = signup.mock.calls[0]?.[0];
    const body = JSON.parse(String((signupInit as RequestInit).body));
    expect(body).toStrictEqual({
      email: "new@example.com",
      password: "hunter2hunter2",
      turnstileToken: "tok-signup",
    });
  });

  it("disables the login submit button until a turnstile token is issued", async () => {
    const login = vi.fn(() => jsonResponse(200, { userId: "u1" }));
    renderAt("/login", { "/auth/login": login, "/auth/turnstile-config": turnstileEnabled() });
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("メールアドレス"), "a@example.com");
    await user.type(screen.getByLabelText("パスワード"), "hunter2hunter2");
    await waitFor(() => expect(renderMock).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: "ログイン" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "ログイン" }));
    expect(login).not.toHaveBeenCalled();
  });

  it("shows a turnstile error message and re-disables submit once the token is rejected", async () => {
    const login = vi.fn(() => jsonResponse(403, { error: "turnstile_failed" }));
    renderAt("/login", { "/auth/login": login, "/auth/turnstile-config": turnstileEnabled() });
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("メールアドレス"), "a@example.com");
    await user.type(screen.getByLabelText("パスワード"), "hunter2hunter2");
    await waitFor(() => expect(renderMock).toHaveBeenCalled());
    lastRenderParams()?.callback?.("tok-rejected");
    await waitFor(() => expect(screen.getByRole("button", { name: "ログイン" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "ログイン" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "認証確認に失敗しました。もう一度お試しください",
    );
    expect(screen.getByRole("button", { name: "ログイン" })).toBeDisabled();
  });

  it("remounts the turnstile widget after a login failure so a fresh token can be issued", async () => {
    const login: Handler = vi.fn();
    login.mockImplementationOnce(() => jsonResponse(401, { error: "invalid_credentials" }));
    login.mockImplementationOnce(() => jsonResponse(200, { userId: "u1" }));
    const tenants = vi.fn(() => jsonResponse(200, { tenants: [] }));
    renderAt("/login", {
      "/auth/login": login,
      "/auth/tenants": tenants,
      "/auth/turnstile-config": turnstileEnabled(),
    });
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("メールアドレス"), "a@example.com");
    await user.type(screen.getByLabelText("パスワード"), "wrong-password-x");
    await waitFor(() => expect(renderMock).toHaveBeenCalled());
    const rendersBeforeFailure = renderMock.mock.calls.length;
    lastRenderParams()?.callback?.("tok-first");
    await waitFor(() => expect(screen.getByRole("button", { name: "ログイン" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "ログイン" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "メールアドレスまたはパスワードが違います",
    );
    // 失敗のたびにウィジェットが強制再マウントされ、Cloudflare の自動リフレッシュ(~300 秒)を
    // 待たずに新しい render 呼び出し(=新しいトークン取得の機会)が発生するはず。
    await waitFor(() => expect(renderMock.mock.calls.length).toBeGreaterThan(rendersBeforeFailure));
    expect(screen.getByRole("button", { name: "ログイン" })).toBeDisabled();
    lastRenderParams()?.callback?.("tok-second");
    await waitFor(() => expect(screen.getByRole("button", { name: "ログイン" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "ログイン" }));
    expect(await screen.findByRole("heading", { name: "テナントを選択" })).toBeInTheDocument();
    expect(login).toHaveBeenCalledTimes(2);
    const secondInit = login.mock.calls[1]?.[0];
    const body = JSON.parse(String((secondInit as RequestInit).body));
    expect(body).toStrictEqual({
      email: "a@example.com",
      password: "wrong-password-x",
      turnstileToken: "tok-second",
    });
  });

  it("remounts the turnstile widget after a signup failure so a fresh token can be issued", async () => {
    const signup: Handler = vi.fn();
    signup.mockImplementationOnce(() => jsonResponse(409, { error: "email_taken" }));
    signup.mockImplementationOnce(() => jsonResponse(201, { userId: "u1" }));
    const tenants = vi.fn(() => jsonResponse(200, { tenants: [] }));
    renderAt("/signup", {
      "/auth/signup": signup,
      "/auth/tenants": tenants,
      "/auth/turnstile-config": turnstileEnabled(),
    });
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("メールアドレス"), "new@example.com");
    await user.type(screen.getByLabelText("パスワード"), "hunter2hunter2");
    await waitFor(() => expect(renderMock).toHaveBeenCalled());
    const rendersBeforeFailure = renderMock.mock.calls.length;
    lastRenderParams()?.callback?.("tok-first");
    await waitFor(() => expect(screen.getByRole("button", { name: "サインアップ" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "サインアップ" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "このメールアドレスは既に登録されています",
    );
    await waitFor(() => expect(renderMock.mock.calls.length).toBeGreaterThan(rendersBeforeFailure));
    expect(screen.getByRole("button", { name: "サインアップ" })).toBeDisabled();
    lastRenderParams()?.callback?.("tok-second");
    await waitFor(() => expect(screen.getByRole("button", { name: "サインアップ" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "サインアップ" }));
    expect(await screen.findByRole("heading", { name: "テナントを選択" })).toBeInTheDocument();
    expect(signup).toHaveBeenCalledTimes(2);
    const secondInit = signup.mock.calls[1]?.[0];
    const body = JSON.parse(String((secondInit as RequestInit).body));
    expect(body).toStrictEqual({
      email: "new@example.com",
      password: "hunter2hunter2",
      turnstileToken: "tok-second",
    });
  });
});
