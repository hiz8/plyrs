import { ASSET_TYPE_DEFINITION } from "@plyrs/metamodel";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  article,
  articleType,
  bootstrapped,
  jsonResponse,
  RECORD_1,
  renderAt,
  socketHarness,
} from "./test-utils/records-harness";
import { ASSET_1, ASSET_2, assetRecord, mediaRoutes } from "./test-utils/media-harness";

vi.mock("./components/media/media-filter-select", async () => {
  const mock = await import("./test-utils/media-filter-select-mock");
  return { MediaFilterSelect: mock.MediaFilterSelectMock };
});

describe("メディアの削除", () => {
  it("使用中のファイルは警告つきの確認を経て削除し、パネルを閉じる", async () => {
    const remove = vi.fn((_init?: RequestInit) => jsonResponse(200, { ok: true }));
    const orphans = vi.fn(() => jsonResponse(200, { orphanIds: [ASSET_2] }));
    const harness = socketHarness();
    const router = renderAt(
      `/t/blog/media/${ASSET_1}?sort=name`,
      harness,
      mediaRoutes({
        "/v1/t/t1/assets/orphans": orphans,
        [`/v1/t/t1/assets/${ASSET_1}/usage`]: vi.fn(() =>
          jsonResponse(200, {
            usage: [
              {
                sourceId: RECORD_1,
                sourceType: "article",
                sourceField: "hero",
                origin: "relation",
              },
            ],
          }),
        ),
        [`/v1/t/t1/records/${ASSET_1}`]: remove,
      }),
    );
    await vi.waitFor(() => expect(harness.sockets.length).toBe(1));
    await bootstrapped(
      harness.latest(),
      [
        assetRecord(ASSET_1, "one.png"),
        assetRecord(ASSET_2, "two.png"),
        article(RECORD_1, "はじめの記事"),
      ],
      [ASSET_TYPE_DEFINITION, articleType],
    );
    const panel = await screen.findByRole("dialog", { name: "one.png" });
    await within(panel).findByRole("link", { name: "はじめの記事" });

    fireEvent.click(within(panel).getByRole("button", { name: "ファイルを削除" }));
    const confirm = await screen.findByRole("alertdialog", { name: "one.png を削除しますか？" });
    expect(
      await within(confirm).findByText("1 件のコンテンツで使われています"),
    ).toBeInTheDocument();
    expect(within(confirm).getByText(/はじめの記事/)).toBeInTheDocument();

    fireEvent.click(within(confirm).getByRole("button", { name: "削除する" }));

    await vi.waitFor(() => expect(remove).toHaveBeenCalledOnce());
    expect(remove.mock.calls[0]?.[0]?.method).toBe("DELETE");
    expect(
      await within(await screen.findByRole("region", { name: "通知" })).findByText("削除しました"),
    ).toBeInTheDocument();
    await waitFor(() => expect(router.state.location.pathname).toBe("/t/blog/media"));
    expect(router.state.location.search).toEqual({ sort: "name" });
    // 未使用一覧を取り直す(F12)
    await vi.waitFor(() => expect(orphans.mock.calls.length).toBeGreaterThan(1));

    // サーバーの確定(トゥームストーン)が届くと一覧から消える
    harness.latest().deliver({
      type: "change",
      record: assetRecord(ASSET_1, "one.png", {
        input: {},
        seq: 11,
        version: 2,
        deletedAt: "2026-07-17T03:00:00Z",
      }),
    });
    const grid = await screen.findByRole("grid", { name: "メディアの一覧" });
    await waitFor(() => expect(within(grid).queryByText("one.png")).toBeNull());
    expect(within(grid).getByText("two.png")).toBeInTheDocument();
  });
});
