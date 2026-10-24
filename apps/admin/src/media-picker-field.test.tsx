import { ASSET_TYPE_DEFINITION, type ContentTypeDefinition } from "@plyrs/metamodel";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import type { FakeSocket } from "./test-utils/fake-socket";
import { ASSET_1, assetRecord, mediaRoutes } from "./test-utils/media-harness";
import { bootstrapped, renderAt, socketHarness } from "./test-utils/records-harness";

vi.mock("./components/media/media-filter-select", async () => {
  const mock = await import("./test-utils/media-filter-select-mock");
  return { MediaFilterSelect: mock.MediaFilterSelectMock };
});

// Phase 8 裁定: メディアフィールド(hero)は allowedTypes ["asset"] の関係フィールド。
const mediaArticleType: ContentTypeDefinition = {
  id: "018f2b6a-7a0a-7000-8000-000000000d01",
  key: "article",
  name: "記事",
  source: "user",
  version: 1,
  fields: [
    { key: "title", type: "text", required: true },
    {
      key: "hero",
      type: "relation",
      config: { allowedTypes: ["asset"], cardinality: "one", snapshotEmbed: "value" },
    },
    { key: "body", type: "richtext" },
  ],
};

interface PushedChange {
  changeId: string;
  recordId: string;
  input: Record<string, unknown>;
  changedFields: string[];
}

function pushes(socket: FakeSocket): PushedChange[] {
  return socket
    .parsed()
    .filter((message): message is { type: "push"; changes: PushedChange[] } => {
      return (message as { type: string }).type === "push";
    })
    .flatMap((message) => message.changes);
}

async function openNewArticle() {
  const harness = socketHarness();
  renderAt("/t/blog/content/article/new", harness, mediaRoutes());
  await vi.waitFor(() => expect(harness.sockets.length).toBe(1));
  await bootstrapped(
    harness.latest(),
    [assetRecord(ASSET_1, "one.png")],
    [ASSET_TYPE_DEFINITION, mediaArticleType],
  );
  return harness;
}

const saveDraft = () =>
  within(screen.getByRole("region", { name: "公開" })).getByRole("button", {
    name: "下書き保存",
  });

it("代替テキストを入れて挿入すると alt が push され、関係が入る", async () => {
  const harness = await openNewArticle();
  const user = userEvent.setup();
  await user.type(await screen.findByRole("textbox", { name: "title" }), "新しい記事");
  fireEvent.click(screen.getByRole("button", { name: "メディアを選択" }));
  const dialog = await screen.findByRole("dialog", { name: "メディアを選択" });
  await user.click(within(dialog).getByText("one.png"));
  await user.type(within(dialog).getByRole("textbox", { name: "代替テキスト" }), "写真");
  await user.click(within(dialog).getByRole("button", { name: "このファイルを使う" }));

  // 代替テキストの保存はサーバーの確定を待ってから挿入に進む
  await vi.waitFor(() => expect(pushes(harness.latest()).length).toBe(1));
  const assetChange = pushes(harness.latest())[0];
  if (assetChange === undefined) throw new Error("expected an asset push");
  expect(assetChange.recordId).toBe(ASSET_1);
  expect(assetChange.input["alt"]).toBe("写真");
  harness.latest().deliver({
    type: "ack",
    changeId: assetChange.changeId,
    result: {
      ok: true,
      record: assetRecord(ASSET_1, "one.png", {
        input: { alt: "写真" },
        seq: 11,
        version: 2,
      }),
    },
  });

  await waitFor(() =>
    expect(screen.queryByRole("dialog", { name: "メディアを選択" })).not.toBeInTheDocument(),
  );
  await user.click(saveDraft());
  await vi.waitFor(() => expect(pushes(harness.latest()).length).toBe(2));
  const articleChange = pushes(harness.latest())[1];
  if (articleChange === undefined) throw new Error("expected an article push");
  expect(articleChange.input["hero"]).toEqual({ type: "asset", id: ASSET_1 });
  expect(articleChange.input["title"]).toBe("新しい記事");
});
