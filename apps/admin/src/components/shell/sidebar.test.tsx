import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Sidebar, type SidebarProps } from "./sidebar";

const tenant = { id: "t1", slug: "blog", name: "Blog", role: "owner" };
const other = { id: "t2", slug: "shop", name: "Shop", role: "editor" };
const types = [
  { key: "news", name: "お知らせ", source: "user", menuOrder: null },
  { key: "blog", name: "ブログ", source: "user", menuOrder: null },
  { key: "booking.slot", name: "予約枠", source: "plugin", menuOrder: null },
] as const;
const modules = [
  {
    moduleId: "booking",
    name: "予約",
    description: null,
    navTypes: ["booking.slot"],
    version: 1,
    enabled: true,
    appliedVersion: 1,
  },
];

function renderSidebar(overrides: Partial<SidebarProps> = {}) {
  const props: SidebarProps = {
    tenant,
    tenants: [tenant, other],
    email: "owner@example.com",
    types,
    hasSynced: true,
    modules,
    slotItems: [],
    syncState: "ready",
    pathname: "/t/blog/content/news",
    onSwitchTenant: vi.fn(),
    onOpenAccount: vi.fn(),
    onOpenTenantList: vi.fn(),
    onLogout: vi.fn(),
    ...overrides,
  };
  render(<Sidebar {...props} />);
  return props;
}

describe("Sidebar", () => {
  it("3 段の項目を並べ、現在地の型だけ子項目を展開する", () => {
    renderSidebar();
    const nav = screen.getByRole("navigation", { name: "メインナビゲーション" });
    const names = within(nav)
      .getAllByRole("link")
      .map((a) => a.textContent);
    expect(names).toEqual([
      "ホーム",
      "お知らせ",
      "一覧",
      "新規追加",
      "ブログ",
      "メディア",
      "予約枠",
    ]);
    expect(within(nav).getByRole("link", { name: "お知らせ" })).toHaveAttribute(
      "aria-current",
      "true",
    );
    expect(within(nav).getByRole("link", { name: "一覧" })).toHaveAttribute(
      "href",
      "/t/blog/content/news",
    );
    expect(within(nav).getByRole("link", { name: "新規追加" })).toHaveAttribute(
      "href",
      "/t/blog/content/news/new",
    );
    expect(screen.getByRole("link", { name: "設定" })).toHaveAttribute(
      "href",
      "/t/blog/settings/general",
    );
  });

  it("編集画面でも親の型が現在地になり、子項目は現在地にならない", () => {
    renderSidebar({ pathname: "/t/blog/content/news/0190a1b2-c3d4-7000-8000-000000000001" });
    expect(screen.getByRole("link", { name: "お知らせ" })).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("link", { name: "一覧" })).not.toHaveAttribute("aria-current");
  });

  it("編集画面では親の型が現在地の塗りを持ち、他の型とは見た目が違う", () => {
    renderSidebar({ pathname: "/t/blog/content/news/0190a1b2-c3d4-7000-8000-000000000001" });
    const parent = screen.getByRole("link", { name: "お知らせ" });
    const sibling = screen.getByRole("link", { name: "ブログ" });
    expect(parent).toHaveAttribute("aria-current", "true");
    // 同じ NavLink で違うのは現在地のスタイルだけ
    expect(parent.className).not.toBe(sibling.className);
  });

  it("一覧が現在地のとき親の型は aria-current=true、子の一覧は page", () => {
    renderSidebar({ pathname: "/t/blog/content/news" });
    expect(screen.getByRole("link", { name: "お知らせ" })).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("link", { name: "一覧" })).toHaveAttribute("aria-current", "page");
  });

  it("閲覧者には設定と新規追加を出さない", () => {
    renderSidebar({ tenant: { ...tenant, role: "viewer" } });
    expect(screen.queryByRole("link", { name: "設定" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "新規追加" })).not.toBeInTheDocument();
  });

  it("型が無いとき、管理者には作成への案内、編集者には文言を出す", () => {
    renderSidebar({ types: [] });
    expect(screen.getByRole("link", { name: "最初のコンテンツタイプを作成" })).toHaveAttribute(
      "href",
      "/t/blog/settings/content-types/new",
    );
    cleanup();
    renderSidebar({ types: [], tenant: { ...tenant, role: "editor" } });
    expect(
      screen.getByText("コンテンツの種類がまだありません。サイトの管理者に作成を依頼してください"),
    ).toBeInTheDocument();
  });

  it("初回同期の前は型 0 件の案内を出さない(型がまだ届いていないだけ)", () => {
    renderSidebar({ types: [], hasSynced: false, syncState: "syncing" });
    expect(
      screen.queryByRole("link", { name: "最初のコンテンツタイプを作成" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/コンテンツの種類がまだありません/)).not.toBeInTheDocument();
  });

  it("サイト切替メニューは所属が複数のときだけ開き、役割と現在のサイトを示す", async () => {
    const props = renderSidebar();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Blog" }));
    expect(await screen.findByRole("menuitem", { name: /Blog 管理者/ })).toHaveTextContent(
      "(現在)",
    );
    await user.click(screen.getByRole("menuitem", { name: /Shop 編集者/ }));
    expect(props.onSwitchTenant).toHaveBeenCalledWith("shop");
    // 現在のサイトを選んでも切り替えない
    vi.mocked(props.onSwitchTenant).mockClear();
    await user.click(screen.getByRole("button", { name: "Blog" }));
    await user.click(await screen.findByRole("menuitem", { name: /Blog 管理者/ }));
    expect(props.onSwitchTenant).not.toHaveBeenCalled();
    cleanup();
    renderSidebar({ tenants: [tenant] });
    expect(screen.queryByRole("button", { name: "Blog" })).not.toBeInTheDocument();
    expect(screen.getByText("Blog")).toBeInTheDocument();
  });

  it("アカウントメニューからログアウトできる", async () => {
    const props = renderSidebar();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "アカウント" }));
    // トリガーにも同じメールが出ているので、メニューの中に限って確かめる
    expect(
      within(await screen.findByRole("menu")).getByText("owner@example.com"),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("menuitem", { name: "ログアウト" }));
    expect(props.onLogout).toHaveBeenCalledTimes(1);
  });

  it("同期状態の 3 状態", () => {
    renderSidebar({ syncState: "ready" });
    expect(screen.getByRole("status")).toHaveTextContent("同期済み");
    cleanup();
    renderSidebar({ syncState: "syncing" });
    expect(screen.getByRole("status")).toHaveTextContent("同期中…");
    cleanup();
    renderSidebar({ syncState: "disconnected" });
    expect(screen.getByRole("status")).toHaveTextContent("再接続しています…");
  });

  it("設定の下位ページでは「設定」が現在地になる", () => {
    renderSidebar({ pathname: "/t/blog/settings/modules" });
    expect(screen.getByRole("link", { name: "設定" })).toHaveAttribute("aria-current", "page");
  });

  const settingsSlot = {
    id: "x.settings",
    label: "拡張設定",
    to: "/t/$tenantSlug/settings/x",
    order: 0,
    group: "settings",
  } as const;

  it("設定が出ない役割には settings 群の slot 項目も出さない", () => {
    renderSidebar({ tenant: { ...tenant, role: "viewer" }, slotItems: [settingsSlot] });
    expect(screen.queryByRole("link", { name: "拡張設定" })).not.toBeInTheDocument();
  });

  it("settings 群の slot 項目は「設定」の直後に並ぶ", () => {
    renderSidebar({ slotItems: [settingsSlot] });
    const nav = screen.getByRole("navigation", { name: "メインナビゲーション" });
    const bottom = nav.nextElementSibling as HTMLElement;
    const names = within(bottom)
      .getAllByRole("link")
      .map((a) => a.textContent);
    expect(names).toEqual(["設定", "拡張設定"]);
  });

  it("slot の項目はモジュールの見出しの下、未指定は中段の最後、無効なモジュールの群は出さない", () => {
    renderSidebar({
      slotItems: [
        {
          id: "booking.calendar",
          label: "予約カレンダー",
          to: "/t/$tenantSlug/modules/booking/calendar",
          order: 0,
          group: "module:booking",
        },
        {
          id: "x.extra",
          label: "追加画面",
          to: "/t/$tenantSlug/content/$typeKey",
          params: { typeKey: "news" },
          order: 0,
        },
        {
          id: "ghost.item",
          label: "幽霊",
          to: "/t/$tenantSlug/x",
          order: 0,
          group: "module:ghost",
        },
      ],
    });
    const names = within(screen.getByRole("navigation", { name: "メインナビゲーション" }))
      .getAllByRole("link")
      .map((a) => a.textContent);
    expect(names).toEqual([
      "ホーム",
      "お知らせ",
      "一覧",
      "新規追加",
      "ブログ",
      "メディア",
      "予約枠",
      "予約カレンダー",
      "追加画面",
    ]);
    expect(screen.getByRole("link", { name: "追加画面" })).toHaveAttribute(
      "href",
      "/t/blog/content/news",
    );
  });
});
