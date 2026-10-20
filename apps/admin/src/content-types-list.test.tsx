import type { ContentTypeDefinition } from "@plyrs/metamodel";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  article,
  authedRoutes,
  bootstrapped,
  jsonResponse,
  renderAt,
  socketHarness,
} from "./test-utils/records-harness";
import { summary } from "./test-utils/type-rows";

const newsSummary = summary({ key: "news", name: "お知らせ", menuOrder: 1 });
const blogSummary = summary({ key: "blog", name: "ブログ", menuOrder: 0 });
const slotSummary = summary({
  key: "booking.slot",
  name: "予約枠",
  source: "plugin",
  pluginId: "booking",
});
const assetSummary = summary({ key: "asset", name: "アセット", source: "system" });

const syncTypes: ContentTypeDefinition[] = [
  { id: "id-news", key: "news", name: "お知らせ", source: "user", version: 1, fields: [] },
  { id: "id-article", key: "article", name: "記事", source: "user", version: 1, fields: [] },
];

const bookingModule = {
  moduleId: "booking",
  name: "予約",
  description: null,
  navTypes: ["booking.slot"],
  version: 1,
  enabled: true,
  appliedVersion: 1,
};

function routesWith(contentTypes: unknown[], extra = {}) {
  return authedRoutes({
    "/v1/t/t1/content-types": vi.fn(() => jsonResponse(200, { contentTypes })),
    ...extra,
  });
}

describe("設定 › コンテンツタイプ(一覧)", () => {
  it("利用者の型を menuOrder 順に出し、モジュールの型は見出しで分け、asset は出さない", async () => {
    renderAt(
      "/t/blog/settings/content-types",
      socketHarness(),
      routesWith([newsSummary, blogSummary, slotSummary, assetSummary], {
        "/v1/t/t1/modules": vi.fn(() => jsonResponse(200, { modules: [bookingModule] })),
      }),
    );
    const grids = await screen.findAllByRole("grid", { name: "コンテンツタイプの一覧" });
    const rows = within(grids[0] as HTMLElement).getAllByRole("row");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("ブログ");
    expect(rows[1]).toHaveTextContent("お知らせ");
    expect(await screen.findByRole("heading", { level: 2, name: "予約" })).toBeInTheDocument();
    expect(grids).toHaveLength(2);
    expect(within(grids[1] as HTMLElement).getByText("予約枠")).toBeInTheDocument();
    expect(screen.queryByText("アセット")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "コンテンツタイプを作成" })).toBeInTheDocument();
  });

  it("同期前は件数がスケルトンで削除が出ず、同期後に 0 件の型にだけ削除が出る", async () => {
    const harness = socketHarness();
    renderAt("/t/blog/settings/content-types", harness, routesWith([newsSummary, blogSummary]));
    await screen.findByRole("grid", { name: "コンテンツタイプの一覧" });
    expect(screen.queryByRole("button", { name: "削除" })).not.toBeInTheDocument();
    expect(screen.queryByText(/^\d+ 件$/)).not.toBeInTheDocument();
    await bootstrapped(
      harness.latest(),
      [article("018f2b6a-7a0a-7000-8000-0000000000a1", "記事 1", { type: "news" })],
      syncTypes,
    );
    // news は 1 件、blog は同期済みの型に無いので 0 件
    await waitFor(() => expect(screen.getAllByRole("button", { name: "削除" })).toHaveLength(1));
    const blogRow = screen.getByRole("row", { name: /ブログ/ });
    expect(within(blogRow).getByRole("button", { name: "削除" })).toBeInTheDocument();
    const newsRow = screen.getByRole("row", { name: /お知らせ/ });
    expect(within(newsRow).queryByRole("button", { name: "削除" })).not.toBeInTheDocument();
    expect(within(newsRow).getByText("1 件")).toBeInTheDocument();
  });

  it("取得に失敗すると中身だけにエラーと再試行が出る", async () => {
    const contentTypes = vi
      .fn()
      .mockImplementationOnce(() => jsonResponse(500, { error: "boom" }))
      .mockImplementationOnce(() => jsonResponse(500, { error: "boom" }))
      .mockImplementation(() => jsonResponse(200, { contentTypes: [blogSummary] }));
    renderAt(
      "/t/blog/settings/content-types",
      socketHarness(),
      authedRoutes({ "/v1/t/t1/content-types": contentTypes }),
    );
    expect(await screen.findByText("コンテンツタイプを読み込めませんでした")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "設定" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "再試行" }));
    expect(await screen.findByRole("grid", { name: "コンテンツタイプの一覧" })).toBeInTheDocument();
  });

  it("利用者の型が無ければ空の状態と作成ボタンを出す", async () => {
    renderAt("/t/blog/settings/content-types", socketHarness(), routesWith([assetSummary]));
    expect(await screen.findByText("コンテンツタイプはまだありません")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "コンテンツタイプを作成" })).toHaveLength(2);
  });

  it("type:manage の無い人は設定からホームへ転送される", async () => {
    const router = renderAt(
      "/t/blog/settings/content-types",
      socketHarness(),
      authedRoutes({}, "editor"),
    );
    await waitFor(() => expect(router.state.location.pathname).toBe("/t/blog"));
    expect(
      screen.queryByRole("button", { name: "コンテンツタイプを作成" }),
    ).not.toBeInTheDocument();
  });
});
