import { ASSET_TYPE_DEFINITION } from "@plyrs/metamodel";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
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

const TYPES = [ASSET_TYPE_DEFINITION, articleType];

afterEach(() => {
  window.localStorage.clear();
});

function routes() {
  return mediaRoutes({
    "/v1/t/t1/publications": vi.fn(() =>
      jsonResponse(200, {
        publications: [
          { recordId: ASSET_1, publishedAt: "2026-07-17T00:00:00Z", sourceVersion: 1 },
        ],
        nextCursor: null,
      }),
    ),
    [`/v1/t/t1/assets/${ASSET_1}/usage`]: vi.fn(() =>
      jsonResponse(200, {
        usage: [
          { sourceId: RECORD_1, sourceType: "article", sourceField: "hero", origin: "relation" },
        ],
      }),
    ),
    [`/v1/t/t1/assets/${ASSET_2}/usage`]: vi.fn(() => jsonResponse(200, { usage: [] })),
  });
}

async function open(path: string) {
  const harness = socketHarness();
  const router = renderAt(path, harness, routes());
  await vi.waitFor(() => expect(harness.sockets.length).toBe(1));
  await bootstrapped(
    harness.latest(),
    [
      assetRecord(ASSET_1, "one.png"),
      assetRecord(ASSET_2, "two.png"),
      article(RECORD_1, "はじめの記事"),
    ],
    TYPES,
  );
  return { harness, router };
}

type Push = {
  type: "push";
  changes: { changeId: string; recordId: string; input: Record<string, unknown> }[];
};

describe("メディアの詳細パネル", () => {
  it("URL で開いた詳細に情報と公開状態と使用箇所が出て、代替テキストを保存すると push され、閉じると /media に戻る", async () => {
    const { harness, router } = await open(`/t/blog/media/${ASSET_1}?sort=name`);
    const dialog = await screen.findByRole("dialog", { name: "one.png" });
    expect(await within(dialog).findByText("公開中")).toBeInTheDocument();
    expect(await within(dialog).findByRole("link", { name: "はじめの記事" })).toHaveAttribute(
      "href",
      `/t/blog/content/article/${RECORD_1}`,
    );

    const user = userEvent.setup();
    await user.type(within(dialog).getByRole("textbox", { name: "代替テキスト" }), "山の写真");
    await user.click(within(dialog).getByRole("button", { name: "保存" }));

    const pushed = () =>
      harness
        .latest()
        .parsed()
        .find((message) => (message as { type: string }).type === "push") as Push | undefined;
    await vi.waitFor(() => expect(pushed()).toBeDefined());
    const change = pushed()?.changes[0];
    expect(change?.recordId).toBe(ASSET_1);
    expect(change?.input["alt"]).toBe("山の写真");
    expect(change?.input["filename"]).toBe("one.png");
    // サーバーの確定で保存が完了し、通知が出る
    harness.latest().deliver({
      type: "ack",
      changeId: change?.changeId ?? "",
      result: {
        ok: true,
        record: assetRecord(ASSET_1, "one.png", {
          input: { alt: "山の写真" },
          seq: 11,
          version: 2,
        }),
      },
    });
    expect(
      await within(await screen.findByRole("region", { name: "通知" })).findByText("保存しました"),
    ).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "閉じる" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/t/blog/media"));
    expect(router.state.location.search).toEqual({ sort: "name" });
    expect(screen.queryByRole("dialog", { name: "one.png" })).toBeNull();
  });

  it("グリッドのタイルを押すとパネルが開き、別のタイルで中身が切り替わる", async () => {
    const { router } = await open("/t/blog/media");
    const grid = await screen.findByRole("grid", { name: "メディアの一覧" });
    expect(screen.queryByRole("dialog")).toBeNull();

    await userEvent.click(within(grid).getByText("one.png"));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/t/blog/media/${ASSET_1}`));
    expect(await screen.findByRole("dialog", { name: "one.png" })).toBeInTheDocument();

    await userEvent.click(within(grid).getByText("two.png"));
    expect(await screen.findByRole("dialog", { name: "two.png" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "one.png" })).toBeNull();
  });

  it("存在しない id は見つからない文だけを出す", async () => {
    await open("/t/blog/media/018f2b6a-7a0a-7000-8000-00000000ffff");
    expect(
      await screen.findByText("ファイルが見つかりません。削除された可能性があります"),
    ).toBeInTheDocument();
  });
});
