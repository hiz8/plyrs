import { ASSET_TYPE_DEFINITION } from "@plyrs/metamodel";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  articleType,
  bootstrapped,
  jsonResponse,
  renderAt,
  socketHarness,
} from "./test-utils/records-harness";
import { ASSET_1, ASSET_2, assetRecord, mediaRoutes } from "./test-utils/media-harness";

vi.mock("./components/media/media-filter-select", async () => {
  const mock = await import("./test-utils/media-filter-select-mock");
  return { MediaFilterSelect: mock.MediaFilterSelectMock };
});

const TYPES = [ASSET_TYPE_DEFINITION, articleType];

afterEach(() => {
  window.localStorage.clear();
});

async function open(
  path = "/t/blog/media",
  records = [
    assetRecord(ASSET_1, "one.png"),
    assetRecord(ASSET_2, "two.pdf", {
      input: { content_type: "application/pdf" },
    }),
  ],
  routes = mediaRoutes(),
) {
  const harness = socketHarness();
  const router = renderAt(path, harness, routes);
  await vi.waitFor(() => expect(harness.sockets.length).toBe(1));
  await bootstrapped(harness.latest(), records, TYPES);
  return { harness, router, routes };
}

describe("メディア(一覧)", () => {
  it("welcome 前は PageLoading で、同期が届くとグリッドが出る", async () => {
    const harness = socketHarness();
    renderAt("/t/blog/media", harness, mediaRoutes());
    await vi.waitFor(() => expect(harness.sockets.length).toBe(1));
    expect(await screen.findByText("読み込み中")).toBeInTheDocument();
    expect(screen.queryByRole("grid", { name: "メディアの一覧" })).toBeNull();

    await bootstrapped(harness.latest(), [assetRecord(ASSET_1, "one.png")], TYPES);
    const grid = await screen.findByRole("grid", { name: "メディアの一覧" });
    expect(within(grid).getAllByRole("row")).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1, name: "メディア" })).toBeInTheDocument();
  });

  it("未使用のファイルにバッジが出て、「未使用のみ」で絞ると他が消え、件数の文が変わる", async () => {
    const routes = mediaRoutes({
      "/v1/t/t1/assets/orphans": vi.fn(() => jsonResponse(200, { orphanIds: [ASSET_2] })),
    });
    const { router } = await open("/t/blog/media", undefined, routes);
    const grid = await screen.findByRole("grid", { name: "メディアの一覧" });
    await waitFor(() => expect(within(grid).getByText("未使用")).toBeInTheDocument());
    const rows = within(grid).getAllByRole("row");
    expect(rows).toHaveLength(2);
    expect(
      within(rows.find((r) => within(r).queryByText("two.pdf") !== null)!).getByText("未使用"),
    );
    expect(screen.getByText("2 件")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("combobox", { name: "使用状況" }), {
      target: { value: "unused" },
    });
    await waitFor(() => expect(within(grid).getAllByRole("row")).toHaveLength(1));
    expect(within(grid).getByText("two.pdf")).toBeInTheDocument();
    expect(
      screen.getByText("1 件 ・ どのコンテンツからも使われていないファイル"),
    ).toBeInTheDocument();
    expect(router.state.location.search).toEqual({ usage: "unused" });
  });

  it("種類と検索で絞り、ファイル名順に並べ替え、URL に載る", async () => {
    const { router } = await open("/t/blog/media", [
      assetRecord(ASSET_1, "b-photo.png"),
      assetRecord(ASSET_2, "a-doc.pdf", { input: { content_type: "application/pdf" } }),
    ]);
    const grid = await screen.findByRole("grid", { name: "メディアの一覧" });
    expect(within(grid).getAllByRole("row")).toHaveLength(2);

    fireEvent.change(screen.getByRole("combobox", { name: "種類" }), { target: { value: "pdf" } });
    await waitFor(() => expect(within(grid).getAllByRole("row")).toHaveLength(1));
    expect(within(grid).getByText("a-doc.pdf")).toBeInTheDocument();
    expect(router.state.location.search).toEqual({ kind: "pdf" });

    fireEvent.change(screen.getByRole("combobox", { name: "種類" }), { target: { value: "all" } });
    await waitFor(() => expect(within(grid).getAllByRole("row")).toHaveLength(2));
    fireEvent.change(screen.getByRole("combobox", { name: "並び順" }), {
      target: { value: "name" },
    });
    await waitFor(() => {
      const names = within(grid)
        .getAllByRole("row")
        .map((row) => row.textContent ?? "");
      expect(names[0]).toContain("a-doc.pdf");
      expect(names[1]).toContain("b-photo.png");
    });
    expect(router.state.location.search).toEqual({ sort: "name" });

    await userEvent.type(screen.getByRole("searchbox"), "photo");
    await waitFor(() => expect(within(grid).getAllByRole("row")).toHaveLength(1));
    expect(router.state.location.search).toEqual({ sort: "name", q: "photo" });
  });

  it("未使用一覧の取得に失敗してもグリッドは出て、絞り込み中は再試行が出る", async () => {
    let calls = 0;
    const routes = mediaRoutes({
      "/v1/t/t1/assets/orphans": vi.fn(() => {
        calls += 1;
        return calls === 1
          ? jsonResponse(500, { error: "boom" })
          : jsonResponse(200, { orphanIds: [] });
      }),
    });
    await open("/t/blog/media?usage=unused", undefined, routes);
    const grid = await screen.findByRole("grid", { name: "メディアの一覧" });
    expect(within(grid).getAllByRole("row")).toHaveLength(2);
    expect(within(grid).queryByText("未使用")).toBeNull();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("使用状況を取得できませんでした");
    await userEvent.click(within(alert).getByRole("button", { name: "再試行" }));
    await waitFor(() => expect(screen.queryByText("使用状況を取得できませんでした")).toBeNull());
    expect(calls).toBe(2);
  });

  it("リスト表示に切り替えると表になり、localStorage に残る", async () => {
    await open();
    await screen.findByRole("grid", { name: "メディアの一覧" });
    expect(screen.queryByRole("rowheader")).toBeNull();
    await userEvent.click(screen.getByRole("radio", { name: "リスト" }));
    const table = await screen.findByRole("grid", { name: "メディアの一覧" });
    expect(within(table).getByRole("link", { name: "one.png" })).toHaveAttribute(
      "href",
      `/t/blog/media/${ASSET_1}`,
    );
    expect(window.localStorage.getItem("plyrs.media.view")).toBe("list");
  });

  it("閲覧者は追加・チェックボックス・ドロップ案内が無く、メタに閲覧のみ", async () => {
    await open("/t/blog/media", undefined, mediaRoutes({}, "viewer"));
    await screen.findByRole("grid", { name: "メディアの一覧" });
    expect(screen.getByText("閲覧のみ")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ファイルを追加" })).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByText(/ドロップしてアップロード/)).toBeNull();
  });

  it("オーナーにはファイルを追加とドロップ案内が出る", async () => {
    await open();
    await screen.findByRole("grid", { name: "メディアの一覧" });
    expect(screen.getByRole("button", { name: "ファイルを追加" })).toBeInTheDocument();
    expect(screen.getByText(/ドロップしてアップロード/)).toBeInTheDocument();
  });

  it("サイドバーに asset 型は出ない", async () => {
    await open();
    await screen.findByRole("grid", { name: "メディアの一覧" });
    const sidebar = screen.getAllByRole("complementary")[0] as HTMLElement;
    expect(within(sidebar).queryByRole("link", { name: "アセット" })).toBeNull();
  });

  it("0 件のときは本文全体がドロップ領域で、絞り込みで 0 件なら絞り込みを解除が出る", async () => {
    await open("/t/blog/media", []);
    expect(await screen.findByText("メディアはまだありません")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ファイルを選択" })).toBeInTheDocument();
    expect(screen.queryByRole("grid", { name: "メディアの一覧" })).toBeNull();
  });

  it("絞り込みで 0 件なら条件に一致しない旨と絞り込みを解除が出る", async () => {
    const { router } = await open("/t/blog/media?q=zzz");
    expect(await screen.findByText("条件に一致するファイルはありません")).toBeInTheDocument();
    await act(async () => {
      const buttons = screen.getAllByRole("button", { name: "絞り込みを解除" });
      buttons[buttons.length - 1]?.click();
    });
    await waitFor(() =>
      expect(screen.getByRole("grid", { name: "メディアの一覧" })).toBeInTheDocument(),
    );
    expect(router.state.location.search).toEqual({});
  });

  it("閲覧者の 0 件はドロップ領域ではなく説明だけ", async () => {
    await open("/t/blog/media", [], mediaRoutes({}, "viewer"));
    expect(await screen.findByText("メディアはまだありません")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ファイルを選択" })).toBeNull();
    expect(screen.getByText("アップロードされたファイルがここに表示されます")).toBeInTheDocument();
  });

  it("タイルを押すと詳細の URL へ移り、検索条件を保つ", async () => {
    const { router } = await open("/t/blog/media?sort=name");
    const grid = await screen.findByRole("grid", { name: "メディアの一覧" });
    await userEvent.click(within(grid).getByText("one.png"));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/t/blog/media/${ASSET_1}`));
    expect(router.state.location.search).toEqual({ sort: "name" });
    expect(screen.getByRole("grid", { name: "メディアの一覧" })).toBeInTheDocument();
  });

  it("タイルを選ぶと一括バーが出て、全選択と解除ができる。絞り込みを変えると選択が消える", async () => {
    await open();
    await screen.findByRole("grid", { name: "メディアの一覧" });
    await userEvent.click(screen.getByRole("checkbox", { name: /選択 one\.png/ }));
    const bar = await screen.findByRole("region", { name: "一括操作" });
    expect(bar).toHaveTextContent("1 件を選択中");
    await userEvent.click(within(bar).getByRole("button", { name: "2 件すべてを選択" }));
    expect(screen.getByRole("region", { name: "一括操作" })).toHaveTextContent("2 件を選択中");

    fireEvent.change(screen.getByRole("combobox", { name: "種類" }), { target: { value: "pdf" } });
    await waitFor(() => expect(screen.queryByRole("region", { name: "一括操作" })).toBeNull());
  });
});
