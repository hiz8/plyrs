import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { DIALOGS } from "~/lib/labels";
import { CONTENT_TYPE_LABELS } from "~/features/content-types";
import {
  articleType,
  authedRoutes,
  jsonResponse,
  renderAt,
  socketHarness,
} from "~/test-utils/records-harness";
import { summary } from "~/test-utils/type-rows";

// factory の中で import する: ~/features/content-types(index.ts)の import が先に部品を読み込むので、
// ファイルの先頭で import した変数を factory から参照すると、初期化の前に触ってしまう
vi.mock("~/features/content-types/components/list-columns-select", async () => {
  const mock = await import("~/test-utils/list-columns-select-mock");
  return { ListColumnsSelect: mock.ListColumnsSelectMock };
});

const articleSummary = summary({
  key: "article",
  id: articleType.id,
  name: "記事",
  version: 2,
  menuOrder: 3,
  fields: [{ key: "title", type: "text", label: "タイトル" }],
});

const EDIT_PATH = "/t/blog/settings/content-types/article/edit";

it("表示名を変えてサイドバーの一覧へ移ろうとすると確認が出て、破棄して移動で一覧に戻る", async () => {
  const user = userEvent.setup();
  const router = renderAt(
    EDIT_PATH,
    socketHarness(),
    authedRoutes({
      "/v1/t/t1/content-types": vi.fn(() => jsonResponse(200, { contentTypes: [articleSummary] })),
    }),
  );
  const name = await screen.findByRole("textbox", {
    name: new RegExp(`^${CONTENT_TYPE_LABELS.editor.name}`),
  });
  await user.type(name, "ニュース");

  const sidebar = screen.getByRole("complementary");
  fireEvent.click(within(sidebar).getByRole("link", { name: /メディア/ }));

  const dialog = await screen.findByRole("alertdialog", { name: DIALOGS.leave.title });
  expect(within(dialog).getByText(DIALOGS.leaveType.body)).toBeInTheDocument();
  expect(router.state.location.pathname).toBe(EDIT_PATH);

  fireEvent.click(within(dialog).getByRole("button", { name: DIALOGS.leave.discard }));
  await waitFor(() => expect(router.state.location.pathname).not.toBe(EDIT_PATH));
});
