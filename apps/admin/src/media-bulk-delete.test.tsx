import { ASSET_TYPE_DEFINITION } from "@plyrs/metamodel";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
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

describe("メディアの一括削除", () => {
  it("2 件を選んで一括削除すると使用中の件数つきの確認を経て順に DELETE し、結果のトーストが出る", async () => {
    const ok = vi.fn(() => jsonResponse(200, { ok: true }));
    const fail = vi.fn(() => jsonResponse(500, { error: "boom" }));
    const harness = socketHarness();
    renderAt(
      "/t/blog/media",
      harness,
      mediaRoutes({
        "/v1/t/t1/assets/orphans": vi.fn(() => jsonResponse(200, { orphanIds: [ASSET_2] })),
        [`/v1/t/t1/records/${ASSET_1}`]: ok,
        [`/v1/t/t1/records/${ASSET_2}`]: fail,
      }),
    );
    await vi.waitFor(() => expect(harness.sockets.length).toBe(1));
    await bootstrapped(
      harness.latest(),
      [assetRecord(ASSET_1, "one.png"), assetRecord(ASSET_2, "two.png")],
      [ASSET_TYPE_DEFINITION, articleType],
    );
    await screen.findByRole("grid", { name: "メディアの一覧" });
    // 使用中の件数は未使用一覧が届いてから確定する
    await screen.findByText("未使用");

    await userEvent.click(screen.getByRole("checkbox", { name: /選択 one\.png/ }));
    const bar = screen.getByRole("region", { name: "一括操作" });
    await userEvent.click(within(bar).getByRole("button", { name: "2 件すべてを選択" }));
    fireEvent.click(within(bar).getByRole("button", { name: "削除" }));

    const confirm = await screen.findByRole("alertdialog", {
      name: "2 件のファイルを削除しますか？",
    });
    expect(
      within(confirm).getByText("そのうち 1 件はコンテンツで使われています"),
    ).toBeInTheDocument();
    fireEvent.click(within(confirm).getByRole("button", { name: "削除する" }));

    await vi.waitFor(() => expect(ok).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(fail).toHaveBeenCalledOnce());
    const toasts = within(await screen.findByRole("region", { name: "通知" }));
    expect(
      await toasts.findByText("1 件を削除しました。1 件は削除できませんでした"),
    ).toBeInTheDocument();
    // 失敗分だけが選択に残り、バーに再試行が出る
    const after = await screen.findByRole("region", { name: "一括操作" });
    await waitFor(() =>
      expect(within(after).getByRole("button", { name: "削除をもう一度試す" })).toBeInTheDocument(),
    );
    expect(within(after).getByText("1 件を選択中")).toBeInTheDocument();
  });
});
