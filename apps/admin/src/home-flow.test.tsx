import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ContentTypeDefinition } from "@plyrs/metamodel";
import type { SyncRecord } from "@plyrs/sync-protocol";
import { describe, expect, it, vi } from "vitest";
import {
  article,
  articleType,
  authedRoutes,
  bootstrapped,
  jsonResponse,
  renderAt,
  socketHarness,
  type Handler,
  type SocketHarness,
} from "./test-utils/records-harness";

// b-home.md: ホーム(/t/blog)の配線。部品の見た目は components/home の各テストで担保する

const noticeType: ContentTypeDefinition = {
  id: "018f2b6a-7a0a-7000-8000-000000000002",
  key: "notice",
  name: "お知らせ",
  source: "user",
  version: 1,
  menuOrder: 1,
  fields: [{ key: "title", type: "text", required: true }],
};
const articleOrdered: ContentTypeDefinition = { ...articleType, menuOrder: 2 };
const bookingType: ContentTypeDefinition = {
  id: "018f2b6a-7a0a-7000-8000-000000000003",
  key: "booking.slot",
  name: "予約枠",
  source: "plugin",
  pluginId: "booking",
  version: 1,
  fields: [{ key: "title", type: "text", required: true }],
};
const assetType: ContentTypeDefinition = {
  id: "018f2b6a-7a0a-7000-8000-000000000004",
  key: "asset",
  name: "メディア",
  source: "system",
  version: 1,
  fields: [{ key: "title", type: "text", required: true }],
};

const rid = (n: number) => `018f2b6a-7a0a-7000-8000-${String(n).padStart(12, "0")}`;
const day = (n: number) => `2026-10-${String(n).padStart(2, "0")}T00:00:00Z`;

function rec(
  type: string,
  n: number,
  title: string,
  overrides: Partial<SyncRecord> = {},
): SyncRecord {
  return article(rid(n), title, { type, updatedAt: day(n), ...overrides });
}

function modulesRoute(enabled = true) {
  return {
    "/v1/t/t1/modules": vi.fn(() =>
      jsonResponse(200, {
        modules: [
          {
            moduleId: "booking",
            name: "予約",
            description: null,
            enabled,
            navTypes: ["booking.slot"],
            version: 1,
            appliedVersion: 1,
          },
        ],
      }),
    ),
  };
}

// 接続の確立を待ってから welcome と初回同期を流す
async function boot(harness: SocketHarness, records: SyncRecord[], types: ContentTypeDefinition[]) {
  await vi.waitFor(() => expect(harness.sockets.length).toBe(1));
  await bootstrapped(harness.latest(), records, types);
}

const main = () => within(screen.getByRole("main"));

// 1 回目だけ 500、以降は ok を返すハンドラ
function failOnce(ok: unknown): Handler {
  let calls = 0;
  return vi.fn(() => {
    calls += 1;
    return calls === 1 ? jsonResponse(500, { error: "internal_error" }) : jsonResponse(200, ok);
  });
}

const types2 = [noticeType, articleOrdered];

describe("ホーム", () => {
  it("同期前は見出しを残して中身だけスケルトンにし、同期後に消える", async () => {
    const harness = socketHarness();
    renderAt("/t/blog", harness);
    expect(await screen.findByRole("heading", { level: 1, name: "ホーム" })).toBeInTheDocument();
    expect(screen.getByRole("main").querySelector("[aria-busy='true']")).not.toBeNull();
    await boot(harness, [], types2);
    await waitFor(() =>
      expect(screen.getByRole("main").querySelector("[aria-busy='true']")).toBeNull(),
    );
    expect(screen.getByRole("heading", { level: 2, name: "自分の下書き" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "確認待ち" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "最近の更新" })).toBeInTheDocument();
  });

  it("新規追加はサイドバーの順(お知らせ → 記事 → 予約枠)で並び、押すと作成画面へ移る", async () => {
    const harness = socketHarness();
    const router = renderAt("/t/blog", harness, authedRoutes(modulesRoute()));
    await boot(harness, [], [articleOrdered, noticeType, bookingType]);
    await main().findByRole("button", { name: "予約枠" });
    expect(
      main()
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["お知らせ", "記事", "予約枠"]);
    await userEvent.click(main().getByRole("button", { name: "記事" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/t/blog/content/article/new"));
  });

  it("自分の下書きは最後に自分が編集した下書きだけを新しい順に 5 件出し、フッターは型の下書き一覧へ", async () => {
    const harness = socketHarness();
    renderAt("/t/blog", harness);
    await boot(
      harness,
      [
        rec("article", 1, "下書き1"),
        rec("article", 2, "下書き2"),
        rec("notice", 3, "下書き3"),
        rec("article", 4, "下書き4"),
        rec("article", 5, "下書き5"),
        rec("notice", 6, "下書き6"),
        rec("article", 7, "他人の下書き", { updatedBy: "u2" }),
        rec("article", 8, "レビュー中", { status: "in_review" }),
      ],
      types2,
    );
    const card = within(await screen.findByRole("region", { name: "自分の下書き" }));
    const rows = await waitFor(() => {
      const links = card
        .getAllByRole("link")
        .filter((link) => !link.getAttribute("href")?.includes("?"));
      expect(links).toHaveLength(5);
      return links;
    });
    expect(rows.map((link) => link.textContent)).toEqual([
      "下書き6",
      "下書き5",
      "下書き4",
      "下書き3",
      "下書き2",
    ]);
    expect(card.queryByText("他人の下書き")).not.toBeInTheDocument();
    expect(card.queryByText("レビュー中")).not.toBeInTheDocument();
    expect(card.getByRole("link", { name: "お知らせ 2" })).toHaveAttribute(
      "href",
      "/t/blog/content/notice?status=draft",
    );
    expect(card.getByRole("link", { name: "記事 4" })).toHaveAttribute(
      "href",
      "/t/blog/content/article?status=draft",
    );
  });

  it("確認待ちは型をまたいで数え、複数の型なら内訳リンク、未反映は公開状態から数える", async () => {
    const harness = socketHarness();
    renderAt(
      "/t/blog",
      harness,
      authedRoutes({
        "/v1/t/t1/publications": vi.fn(() =>
          jsonResponse(200, {
            publications: [{ recordId: rid(5), publishedAt: day(1), sourceVersion: 1 }],
            nextCursor: null,
          }),
        ),
      }),
    );
    await boot(
      harness,
      [
        rec("article", 1, "レビュー1", { status: "in_review" }),
        rec("article", 2, "レビュー2", { status: "in_review" }),
        rec("article", 3, "確認済み記事", { status: "ready" }),
        rec("notice", 4, "確認済みお知らせ", { status: "ready" }),
        rec("article", 5, "公開後に編集", { status: "archived", version: 2 }),
      ],
      types2,
    );
    const card = within(await screen.findByRole("region", { name: "確認待ち" }));
    expect(await card.findByRole("link", { name: /公開前に確認が必要なもの/ })).toHaveAttribute(
      "href",
      "/t/blog/content/article?status=in_review",
    );
    expect(card.getByRole("link", { name: "お知らせ 1" })).toHaveAttribute(
      "href",
      "/t/blog/content/notice?status=ready",
    );
    expect(card.getByRole("link", { name: "記事 1" })).toHaveAttribute(
      "href",
      "/t/blog/content/article?status=ready",
    );
    expect(await card.findByRole("link", { name: /公開後に編集されたもの/ })).toHaveAttribute(
      "href",
      "/t/blog/content/article?tab=unpublished-changes",
    );
  });

  it("最近の更新は型をまたいで新しい順に 10 件、行は編集画面へ", async () => {
    const harness = socketHarness();
    renderAt("/t/blog", harness);
    const records = Array.from({ length: 12 }, (_, i) =>
      rec(i % 2 === 0 ? "article" : "notice", i + 1, `更新${i + 1}`, { updatedBy: "u2" }),
    );
    await boot(harness, records, types2);
    const card = within(await screen.findByRole("region", { name: "最近の更新" }));
    const rows = await waitFor(() => {
      const links = card.getAllByRole("link");
      expect(links).toHaveLength(10);
      return links;
    });
    expect(rows[0]).toHaveTextContent("更新12");
    expect(rows[0]).toHaveAttribute("href", `/t/blog/content/notice/${rid(12)}`);
    expect(rows[1]).toHaveAttribute("href", `/t/blog/content/article/${rid(11)}`);
    expect(card.queryByText("更新2")).not.toBeInTheDocument();
    expect(card.getAllByText("下書き").length).toBeGreaterThan(0);
    expect(card.getAllByRole("time")).toHaveLength(10);
  });

  it("自分の情報の取得に失敗すると下書きの枠だけにエラーと再試行が出る", async () => {
    const harness = socketHarness();
    renderAt(
      "/t/blog",
      harness,
      authedRoutes({
        "/auth/me": failOnce({ userId: "u1", email: "owner@example.com" }),
      }),
    );
    await boot(harness, [rec("article", 1, "私の下書き")], types2);
    const drafts = within(await screen.findByRole("region", { name: "自分の下書き" }));
    expect(await drafts.findByRole("alert")).toHaveTextContent("下書きを表示できませんでした");
    const review = within(screen.getByRole("region", { name: "確認待ち" }));
    expect(review.queryByRole("alert")).not.toBeInTheDocument();
    const recent = within(screen.getByRole("region", { name: "最近の更新" }));
    expect(await recent.findByRole("link", { name: /私の下書き/ })).toBeInTheDocument();
    await userEvent.click(drafts.getByRole("button", { name: "再試行" }));
    expect(await drafts.findByRole("link", { name: /私の下書き/ })).toBeInTheDocument();
    expect(drafts.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("公開状態の取得に失敗すると未反映の行だけがエラーと再試行になる", async () => {
    const harness = socketHarness();
    renderAt(
      "/t/blog",
      harness,
      authedRoutes({
        "/v1/t/t1/publications": failOnce({
          publications: [{ recordId: rid(2), publishedAt: day(1), sourceVersion: 1 }],
          nextCursor: null,
        }),
      }),
    );
    await boot(
      harness,
      [
        rec("article", 1, "レビュー1", { status: "in_review" }),
        rec("article", 2, "公開後に編集", { status: "archived", version: 2 }),
      ],
      types2,
    );
    const review = within(await screen.findByRole("region", { name: "確認待ち" }));
    expect(await review.findByRole("alert")).toHaveTextContent(
      "未反映の変更を確認できませんでした",
    );
    expect(review.getByRole("link", { name: /公開前に確認が必要なもの/ })).toBeInTheDocument();
    await userEvent.click(review.getByRole("button", { name: "再試行" }));
    expect(await review.findByRole("link", { name: /公開後に編集されたもの/ })).toBeInTheDocument();
    expect(review.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("閲覧者には新規追加と下書きが無く、見出しの右に「閲覧のみ」が出る", async () => {
    const harness = socketHarness();
    renderAt("/t/blog", harness, authedRoutes({}, "viewer"));
    await boot(harness, [rec("article", 1, "記事A")], types2);
    expect(await screen.findByText("閲覧のみ ・ owner@example.com")).toBeInTheDocument();
    const recent = within(await screen.findByRole("region", { name: "最近の更新" }));
    expect(await recent.findByRole("link", { name: /記事A/ })).toHaveAttribute(
      "href",
      `/t/blog/content/article/${rid(1)}`,
    );
    expect(main().queryByText("新規追加")).not.toBeInTheDocument();
    expect(main().queryByRole("heading", { name: "自分の下書き" })).not.toBeInTheDocument();
    expect(main().getByRole("heading", { level: 2, name: "確認待ち" })).toBeInTheDocument();
    // D3 H2: 2 つの枠は同じ縦積みの入れ物の直下に並ぶ(2 列グリッドの子ではない)
    const reviewBox = screen.getByRole("region", { name: "確認待ち" }).parentElement;
    const recentBox = screen.getByRole("region", { name: "最近の更新" }).parentElement;
    expect(reviewBox).not.toBeNull();
    expect(reviewBox).toBe(recentBox);
    // その入れ物は本文そのもの(PageBody の唯一の子)で、grid のラッパーではない
    expect(reviewBox?.parentElement?.children).toHaveLength(1);
  });

  it("型 0 件の管理者には「はじめに」が出て、型が届くと普段の表示に変わる", async () => {
    const harness = socketHarness();
    const router = renderAt("/t/blog", harness);
    await boot(harness, [], []);
    expect(await screen.findByRole("heading", { level: 2, name: "はじめに" })).toBeInTheDocument();
    expect(main().queryByText("新規追加")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "コンテンツタイプを作成" }));
    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/t/blog/settings/content-types/new"),
    );
    await router.navigate({ to: "/t/$tenantSlug", params: { tenantSlug: "blog" } });
    expect(await screen.findByRole("heading", { level: 2, name: "はじめに" })).toBeInTheDocument();
    harness.latest().deliver({ type: "content-types", contentTypes: [articleOrdered] });
    await waitFor(() =>
      expect(screen.queryByRole("heading", { name: "はじめに" })).not.toBeInTheDocument(),
    );
    expect(await main().findByText("新規追加")).toBeInTheDocument();
  });

  it("型 0 件の編集者には依頼の案内だけを出す", async () => {
    const harness = socketHarness();
    renderAt("/t/blog", harness, authedRoutes({}, "editor"));
    await boot(harness, [], []);
    const title = await screen.findByText("コンテンツの種類がまだありません");
    expect(screen.queryByRole("heading", { name: "はじめに" })).not.toBeInTheDocument();
    // 見出しの右には自分のメールが出る。案内の本文(B3)にだけメールアドレスを含めない
    expect(title.parentElement?.textContent).not.toMatch(/@/);
  });

  it("home:widget は 2 列に並び、full は 2 列分、moduleId 付きは有効なモジュールのときだけ描く", async () => {
    const harness = socketHarness();
    renderAt("/t/blog", harness, authedRoutes(modulesRoute()), (context) => {
      context.slots.register("home:widget", {
        id: "a",
        order: 1,
        title: "ウィジェットA",
        render: () => <p>Aの中身</p>,
      });
      context.slots.register("home:widget", {
        id: "b",
        order: 2,
        title: "ウィジェットB",
        size: "full",
        render: () => <p>Bの中身</p>,
      });
      context.slots.register("home:widget", {
        id: "c",
        order: 3,
        title: "ウィジェットC",
        moduleId: "other",
        render: () => <p>Cの中身</p>,
      });
      context.slots.register("home:widget", {
        id: "d",
        order: 4,
        title: "ウィジェットD",
        moduleId: "booking",
        render: () => <p>Dの中身</p>,
      });
    });
    await boot(harness, [], types2);
    const grid = within(await screen.findByRole("region", { name: "モジュールのウィジェット" }));
    await waitFor(() => expect(grid.getAllByRole("heading")).toHaveLength(3));
    expect(grid.getByRole("heading", { name: "ウィジェットA" })).toBeInTheDocument();
    expect(grid.getByRole("heading", { name: "ウィジェットD" })).toBeInTheDocument();
    expect(grid.queryByRole("heading", { name: "ウィジェットC" })).not.toBeInTheDocument();
    const full = grid.getByRole("region", { name: "ウィジェットB" }).parentElement;
    expect(full).toHaveStyle({ gridColumn: "1 / -1" });
    const half = grid.getByRole("region", { name: "ウィジェットA" }).parentElement;
    expect(half).not.toHaveStyle({ gridColumn: "1 / -1" });
  });

  it("メディアと無効なモジュールの型のレコードは最近の更新に出ない", async () => {
    const harness = socketHarness();
    renderAt("/t/blog", harness, authedRoutes(modulesRoute(false)));
    await boot(
      harness,
      [
        rec("article", 1, "表示される記事"),
        rec("asset", 2, "メディアの行"),
        rec("booking.slot", 3, "無効モジュールの行"),
      ],
      [articleOrdered, assetType, bookingType],
    );
    const recent = within(await screen.findByRole("region", { name: "最近の更新" }));
    expect(await recent.findByRole("link", { name: /表示される記事/ })).toBeInTheDocument();
    expect(recent.getAllByRole("link")).toHaveLength(1);
    expect(main().queryByRole("button", { name: "予約枠" })).not.toBeInTheDocument();
  });

  it("モジュール一覧の取得に失敗してもホームは描かれる", async () => {
    const harness = socketHarness();
    renderAt(
      "/t/blog",
      harness,
      authedRoutes({
        "/v1/t/t1/modules": vi.fn(() => jsonResponse(500, { error: "internal_error" })),
      }),
      (context) => {
        context.slots.register("home:widget", {
          id: "m",
          order: 5,
          title: "モジュールのウィジェットM",
          moduleId: "booking",
          render: () => <p>Mの中身</p>,
        });
      },
    );
    await boot(harness, [], [articleOrdered, bookingType]);
    await main().findByRole("button", { name: "記事" });
    expect(
      main()
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["記事"]);
    expect(screen.queryByRole("heading", { name: "モジュールのウィジェットM" })).toBeNull();
    expect(screen.getByRole("main").querySelector("[aria-busy='true']")).toBeNull();
  });
});
