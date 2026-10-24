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

it("本文の画像ボタンから 1 件を選ぶと assetImage が本文に入る", async () => {
  const harness = await openNewArticle();
  const user = userEvent.setup();
  await user.type(await screen.findByRole("textbox", { name: "title" }), "本文画像テスト");
  fireEvent.click(screen.getByRole("button", { name: "画像" }));
  const dialog = await screen.findByRole("dialog", { name: "メディアを選択" });
  // 本文の画像の既定は「画像」の絞り込み
  expect(within(dialog).getByLabelText("種類")).toHaveValue("image");
  await user.click(within(dialog).getByText("one.png"));
  await user.click(within(dialog).getByRole("button", { name: "このファイルを使う" }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog", { name: "メディアを選択" })).not.toBeInTheDocument(),
  );
  await user.click(saveDraft());

  await vi.waitFor(() => expect(pushes(harness.latest()).length).toBe(1));
  const change = pushes(harness.latest())[0];
  if (change === undefined) throw new Error("expected a pushed change");
  const body = change.input["body"] as { doc: { content: Array<Record<string, unknown>> } };
  expect(body.doc.content).toContainEqual({
    type: "assetImage",
    attrs: { recordType: "asset", recordId: ASSET_1, label: "one.png" },
  });
});
