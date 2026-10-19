import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ContentTypeDefinition } from "@plyrs/metamodel";
import { describe, expect, it, vi, type Mock } from "vitest";
import { createAppContext, getRouter } from "./router";
import { FakeSocket, pendingConnect } from "./test-utils/fake-socket";

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

const articleType: ContentTypeDefinition = {
  id: "018f2b6a-7a0a-7000-8000-000000000001",
  key: "article",
  name: "記事",
  source: "user",
  version: 1,
  fields: [{ key: "title", type: "text", required: true }],
};

const blogTenant = { id: "t1", slug: "blog", name: "Blog", role: "owner" };

function authedRoutes(overrides: Record<string, Handler> = {}): Record<string, Handler> {
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

// jsdom では、ルートの <html> が div の中に入るこの構成でアカウントメニューの Popover を開くと、
// 2 本目以降のテストの role クエリが戻らなくなる(Popover の無い sidebar.test では起きない)。
// シェルの配線(onLogout が呼ばれること)だけを確かめたいので、メニューは同じ操作名の
// 素朴な代替に差し替える。メニュー自体の挙動は components/shell/sidebar.test.tsx で見る
vi.mock("./components/shell/account-menu", async () => {
  const { useState } = await import("react");
  return {
    AccountMenu: ({ email, onLogout }: { email: string | undefined; onLogout: () => void }) => {
      const [open, setOpen] = useState(false);
      return (
        <div>
          <button type="button" aria-label="アカウント" onClick={() => setOpen(true)}>
            {email}
          </button>
          {open && (
            <button type="button" role="menuitem" onClick={onLogout}>
              ログアウト
            </button>
          )}
        </div>
      );
    },
  };
});

async function logoutFromAccountMenu() {
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "アカウント" }));
  await user.click(await screen.findByRole("menuitem", { name: "ログアウト" }));
}

describe("認証済みシェル (/t/$tenantSlug)", () => {
  it("サイドバーにホーム・型・メディア・設定が並び、設定画面のコンテンツタイプ一覧が出る", async () => {
    const routes = authedRoutes();
    renderAt("/t/blog/settings/content-types", routes);
    const settings = await screen.findByRole("link", { name: "設定" });
    await waitFor(() => expect(settings).toHaveAttribute("aria-current", "page"));
    expect(screen.getByRole("link", { name: "ホーム" })).toHaveAttribute("href", "/t/blog");
    expect(screen.getByRole("link", { name: "メディア" })).toHaveAttribute("href", "/t/blog/media");
    // 型は同期で届く。pendingConnect では届かないので、同期前は案内も出さない
    expect(screen.queryByRole("link", { name: "最初のコンテンツタイプを作成" })).toBeNull();
    // ヘッダーの廃止(サイト名のリンクは無い)
    expect(screen.queryByRole("link", { name: /Blog/ })).not.toBeInTheDocument();
    expect(await screen.findByRole("cell", { name: "article" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "記事" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "2" })).toBeInTheDocument(); // フィールド数
    // Bearer トークンが付与されている（token-manager 経由）
    const listCall = routes["/v1/t/t1/content-types"]?.mock.calls[0]?.[0] as RequestInit;
    expect(new Headers(listCall.headers).get("authorization")).toBe("Bearer jwt-abc");
  });

  it("同期で届いた型がサイドバーに並び、現在地の型だけ子項目を展開する", async () => {
    let socket: FakeSocket | undefined;
    renderAt("/t/blog/content/article", authedRoutes(), async () => {
      socket = new FakeSocket();
      return socket;
    });
    await vi.waitFor(() =>
      expect(socket?.parsed()).toContainEqual({ type: "hello", checkpoint: 0 }),
    );
    socket?.deliver({
      type: "welcome",
      protocolVersion: 1,
      contentTypes: [articleType],
      serverSeq: 1,
    });
    socket?.deliver({ type: "sync", records: [], serverSeq: 1, complete: true });
    expect(await screen.findByRole("link", { name: "記事" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "一覧" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "新規追加" })).toBeInTheDocument();
  });

  it("binds nav item params alongside the current tenantSlug (案 A 4 章)", async () => {
    const context = createAppContext(stubFetch(authedRoutes()), {
      connect: () => () => pendingConnect(),
    });
    context.slots.register("nav:item", {
      id: "test.records",
      label: "記事の一覧",
      to: "/t/$tenantSlug/content/$typeKey",
      // tenantSlug は現在のテナントで上書きされ、contribution からは変えられない
      params: { typeKey: "article", tenantSlug: "other" },
      order: 99,
    });
    const router = getRouter({
      context,
      history: createMemoryHistory({ initialEntries: ["/t/blog/settings/content-types"] }),
    });
    render(<RouterProvider router={router} />);
    expect(await screen.findByRole("link", { name: "記事の一覧" })).toHaveAttribute(
      "href",
      "/t/blog/content/article",
    );
  });

  it("有効でないモジュールの群の slot 項目は出ない", async () => {
    const context = createAppContext(stubFetch(authedRoutes()), {
      connect: () => () => pendingConnect(),
    });
    context.slots.register("nav:item", {
      id: "test.hidden",
      label: "隠れた項目",
      to: "/t/$tenantSlug/content/$typeKey",
      params: { typeKey: "article" },
      group: "module:test",
      order: 99,
    });
    const router = getRouter({
      context,
      history: createMemoryHistory({ initialEntries: ["/t/blog/settings/content-types"] }),
    });
    render(<RouterProvider router={router} />);
    await screen.findByRole("link", { name: "設定" });
    expect(screen.queryByRole("link", { name: "隠れた項目" })).not.toBeInTheDocument();
  });

  it("shows the empty state for a tenant without content types", async () => {
    const routes = authedRoutes({
      "/v1/t/t1/content-types": vi.fn(() => jsonResponse(200, { contentTypes: [] })),
    });
    renderAt("/t/blog/settings/content-types", routes);
    expect(await screen.findByText(/コンテンツタイプはまだありません/)).toBeInTheDocument();
  });

  it("redirects to /tenants for a slug the user does not belong to", async () => {
    renderAt(
      "/t/ghost/settings/content-types",
      authedRoutes({
        "/auth/tenants": vi.fn(() =>
          jsonResponse(200, {
            tenants: [blogTenant, { id: "t2", slug: "shop", name: "Shop", role: "owner" }],
          }),
        ),
      }),
    );
    expect(await screen.findByRole("heading", { name: "サイトを選択" })).toBeInTheDocument();
  });

  it("redirects to /login when unauthenticated", async () => {
    renderAt(
      "/t/blog/settings/content-types",
      authedRoutes({
        "/auth/tenants": vi.fn(() => jsonResponse(401, { error: "unauthenticated" })),
      }),
    );
    expect(await screen.findByRole("heading", { name: "ログイン" })).toBeInTheDocument();
  });

  it("redirects /t/$tenantSlug to the content type list", async () => {
    const router = renderAt("/t/blog", authedRoutes());
    await waitFor(() => expect(router.state.location.pathname).toBe("/t/blog/content/article"));
  });

  it("logs out from the アカウントメニュー", async () => {
    const logout = vi.fn(() => jsonResponse(200, { ok: true }));
    renderAt("/t/blog/settings/content-types", authedRoutes({ "/auth/logout": logout }));
    await logoutFromAccountMenu();
    expect(await screen.findByRole("heading", { name: "ログイン" })).toBeInTheDocument();
    expect(logout).toHaveBeenCalledTimes(1);
  });

  it("logs out locally even when the server logout fails", async () => {
    const logout = vi.fn(() => jsonResponse(500, { error: "boom" }));
    renderAt("/t/blog/settings/content-types", authedRoutes({ "/auth/logout": logout }));
    await logoutFromAccountMenu();
    expect(await screen.findByRole("heading", { name: "ログイン" })).toBeInTheDocument();
    expect(logout).toHaveBeenCalledTimes(1);
  });

  it("shows the error screen when a loader fails with a server error", async () => {
    renderAt(
      "/t/blog/settings/content-types",
      authedRoutes({
        "/v1/t/t1/content-types": vi.fn(() => jsonResponse(500, { error: "boom" })),
      }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("エラーが発生しました");
    expect(screen.getByText("500: boom")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "再読み込み" })).toBeInTheDocument();
  });

  it("shows the sync status indicator while connecting", async () => {
    renderAt("/t/blog/settings/content-types", authedRoutes());
    expect(await screen.findByRole("status")).toHaveTextContent("同期中…");
  });

  it("offers a reconnect button when the sync connection is lost", async () => {
    let socket: FakeSocket | undefined;
    const connects: number[] = [];
    renderAt("/t/blog/content/article", authedRoutes(), async () => {
      connects.push(connects.length);
      socket = new FakeSocket();
      return socket;
    });
    await vi.waitFor(() =>
      expect(socket?.parsed()).toContainEqual({ type: "hello", checkpoint: 0 }),
    );
    // 初回同期の前(hasSynced=false)でも、確定拒否(4003 blocked)で closed になれば出る
    socket?.emit("close", { code: 4003, reason: "blocked" });
    expect(await screen.findByRole("button", { name: "今すぐ再接続" })).toBeInTheDocument();
    const before = connects.length;
    await userEvent.setup().click(screen.getByRole("button", { name: "今すぐ再接続" }));
    await vi.waitFor(() => expect(connects.length).toBe(before + 1));
  });

  it("me の取得失敗でもシェルは描かれる(Review Focus 4)", async () => {
    renderAt(
      "/t/blog/settings/content-types",
      authedRoutes({ "/auth/me": vi.fn(() => jsonResponse(500, { error: "boom" })) }),
    );
    expect(await screen.findByRole("button", { name: "アカウント" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("ドロワーを開いて項目を選ぶと閉じる(Review Focus 5)", async () => {
    renderAt("/t/blog/settings/content-types", authedRoutes());
    const toggle = await screen.findByRole("button", { name: "メニューを開く" });
    // 開く操作だけ fireEvent: 上のコメントと同じ理由で、user-event のポインタ列だと戻らない
    fireEvent.click(toggle);
    const drawer = await screen.findByRole("dialog", { name: "メニュー" });
    expect(
      // モーダルが外側を aria-hidden にするので hidden: true で探す
      screen.getByRole("button", { name: "メニューを閉じる", hidden: true }),
    ).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(within(drawer).getByRole("link", { name: "メディア" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "メニュー" })).not.toBeInTheDocument(),
    );
    expect(await screen.findByRole("heading", { level: 1 })).toBeInTheDocument(); // メディア画面(同期前はスケルトン)
  });

  it("パンくずのリンクは画面内遷移になる", async () => {
    const router = renderAt("/t/blog/settings/content-types", authedRoutes());
    await screen.findByRole("heading", { name: "コンテンツタイプ" });
    await userEvent.setup().click(
      within(screen.getByRole("navigation", { name: "パンくず" })).getByRole("link", {
        name: "設定",
      }),
    );
    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/t/blog/settings/content-types"),
    );
  });
});

describe("旧 URL のリダイレクト (案 A 6 章)", () => {
  const RECORD = "0190a1b2-c3d4-7000-8000-000000000001";
  it.each([
    ["/t/blog/records/article", "/t/blog/content/article"],
    ["/t/blog/records/article/new", "/t/blog/content/article/new"],
    [`/t/blog/records/article/${RECORD}`, `/t/blog/content/article/${RECORD}`],
    ["/t/blog/assets", "/t/blog/media"],
    ["/t/blog/content-types", "/t/blog/settings/content-types"],
    ["/t/blog/content-types/new", "/t/blog/settings/content-types/new"],
    ["/t/blog/content-types/article/edit", "/t/blog/settings/content-types/article/edit"],
  ])("%s → %s", async (from, to) => {
    const router = renderAt(from, authedRoutes());
    await waitFor(() => expect(router.state.location.pathname).toBe(to));
  });

  it("モジュールの旧 URL も設定の下へ転送する", async () => {
    const router = renderAt(
      "/t/blog/modules",
      authedRoutes({
        "/v1/t/t1/modules": vi.fn(() => jsonResponse(200, { modules: [] })),
      }),
    );
    await waitFor(() => expect(router.state.location.pathname).toBe("/t/blog/settings/modules"));
  });

  it("クエリとハッシュを引き継ぎ、旧 URL を履歴に残さない", async () => {
    const router = renderAt("/t/blog/records/article?x=1#field", authedRoutes());
    await waitFor(() => expect(router.state.location.pathname).toBe("/t/blog/content/article"));
    expect(router.history.location.search).toBe("?x=1");
    expect(router.history.location.hash).toBe("#field");
    expect(router.history.length).toBe(1);
  });

  it.each([
    ["/t/blog/settings", "/t/blog/settings/content-types"],
    ["/t/blog/content", "/t/blog/settings/content-types"],
  ])("末尾を削った %s は Not Found にせず %s へ転送する", async (from, to) => {
    const router = renderAt(from, authedRoutes());
    await waitFor(() => expect(router.state.location.pathname).toBe(to));
  });
});
