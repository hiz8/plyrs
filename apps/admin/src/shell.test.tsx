import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ContentTypeDefinition } from "@plyrs/metamodel";
import { describe, expect, it, vi } from "vitest";
import { createAppContext, getRouter } from "./router";
import { FakeSocket, pendingConnect } from "./test-utils/fake-socket";
import {
  authedRoutes,
  blogTenant,
  jsonResponse,
  renderAt,
  stubFetch,
} from "./test-utils/shell-harness";

const articleType: ContentTypeDefinition = {
  id: "018f2b6a-7a0a-7000-8000-000000000001",
  key: "article",
  name: "記事",
  source: "user",
  version: 1,
  fields: [{ key: "title", type: "text", required: true }],
};

// jsdom では RootShell の <html> が div の中に入り、RAC の Popover を開くと user-event が
// 戻らないため(2 本目以降の role クエリも戻らなくなる)。メニュー自体は sidebar.test が担保する。
// ここではシェルの配線(onLogout が呼ばれること)だけを確かめるので、同じ操作名の代替に差し替える
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

// パンくず(PageHeader)の中のリンクを除いた、サイドバー側のリンク
function sidebarLinks(name: string): HTMLElement[] {
  return screen
    .queryAllByRole("link", { name })
    .filter((link) => link.closest('nav[aria-label="パンくず"]') === null);
}

describe("認証済みシェル (/t/$tenantSlug)", () => {
  it("サイドバーにホーム・型・メディア・設定が並び、設定画面のコンテンツタイプ一覧が出る", async () => {
    const routes = authedRoutes();
    renderAt("/t/blog/settings/content-types", routes);
    // パンくずにも「ホーム」「設定」が出るので、サイドバー側のリンクだけを探す(a-navigation.md 5 章)
    const settings = await waitFor(() => {
      const [link] = sidebarLinks("設定");
      if (link === undefined) throw new Error("サイドバーの設定がまだ無い");
      return link;
    });
    await waitFor(() => expect(settings).toHaveAttribute("aria-current", "page"));
    expect(sidebarLinks("ホーム")[0]).toHaveAttribute("href", "/t/blog");
    expect(sidebarLinks("メディア")[0]).toHaveAttribute("href", "/t/blog/media");
    // 型は同期で届く。pendingConnect では届かないので、同期前は案内も出さない
    expect(screen.queryByRole("link", { name: "最初のコンテンツタイプを作成" })).toBeNull();
    // ヘッダーの廃止(サイト名のリンクは無い)
    expect(screen.queryByRole("link", { name: /Blog/ })).not.toBeInTheDocument();
    expect(await screen.findByText("API 名: article")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "記事" })).toBeInTheDocument();
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
      "true",
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
    await waitFor(() => expect(sidebarLinks("設定")).toHaveLength(1));
    expect(screen.queryByRole("link", { name: "隠れた項目" })).not.toBeInTheDocument();
  });

  it("shows the empty state for a tenant without content types", async () => {
    const routes = authedRoutes({
      "/v1/t/t1/content-types": vi.fn(() => jsonResponse(200, { contentTypes: [] })),
    });
    renderAt("/t/blog/settings/content-types", routes);
    expect(await screen.findByText(/コンテンツタイプはまだありません/)).toBeInTheDocument();
  });

  it("非所属の slug は、所属が 1 件なら唯一のサイトへ転送する(Review Focus 2)", async () => {
    const router = renderAt("/t/ghost/settings/content-types", authedRoutes());
    await waitFor(() => expect(router.state.location.pathname).toBe("/t/blog"));
  });

  it("非所属の slug は、所属が複数ならサイト選択へ戻す", async () => {
    renderAt(
      "/t/ghost/settings/content-types",
      authedRoutes({
        "/auth/tenants": vi.fn(() =>
          jsonResponse(200, {
            tenants: [blogTenant, { id: "t2", slug: "shop", name: "Shop", role: "editor" }],
          }),
        ),
      }),
    );
    expect(await screen.findByRole("heading", { name: "サイトを選択" })).toBeInTheDocument();
    expect(
      screen.getByText("owner@example.com として 2 つのサイトに所属しています"),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Shop/ })).toHaveAttribute("href", "/t/shop");
    expect(screen.getByRole("link", { name: /Shop/ })).toHaveTextContent("編集者");
    expect(screen.queryByText("shop")).not.toBeInTheDocument(); // slug は出さない
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
    // 一覧(settings/content-types)は枠の中にエラーを出すため、loader で失敗をルートのエラーにする編集画面で試す
    renderAt(
      "/t/blog/settings/content-types/article/edit",
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

  // ドロワー(RAC Modal)を開いたテストの後に RAC のリンクを押すと jsdom で戻らなくなる。原因は
  // 未確認で、RAC の Modal の後始末が jsdom に残るためと推定。そのためパンくずのテストはドロワーの
  // テストより前に置く。RAC を上げたら順序の制約が要るか再確認する。
  it("パンくずのリンクは画面内遷移になる", async () => {
    const router = renderAt("/t/blog/settings/content-types/new", authedRoutes());
    await screen.findByRole("navigation", { name: "パンくず" });
    expect(router.state.location.pathname).toBe("/t/blog/settings/content-types/new");
    await userEvent.setup().click(
      within(screen.getByRole("navigation", { name: "パンくず" })).getByRole("link", {
        name: "コンテンツタイプ",
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
    const router = renderAt("/t/blog/records/article?tab=published#field", authedRoutes());
    await waitFor(() => expect(router.state.location.pathname).toBe("/t/blog/content/article"));
    expect(router.history.location.search).toBe("?tab=published");
    expect(router.history.location.hash).toBe("#field");
    expect(router.history.length).toBe(1);
  });

  it.each([
    ["/t/blog/settings", "/t/blog/settings/general"],
    ["/t/blog/content", "/t/blog"],
  ])("末尾を削った %s は Not Found にせず %s へ転送する", async (from, to) => {
    const router = renderAt(from, authedRoutes());
    await waitFor(() => expect(router.state.location.pathname).toBe(to));
  });
});
