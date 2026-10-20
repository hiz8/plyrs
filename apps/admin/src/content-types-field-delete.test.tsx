import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import {
  articleType,
  authedRoutes,
  jsonResponse,
  renderAt,
  socketHarness,
} from "./test-utils/records-harness";
import { summary } from "./test-utils/type-rows";

const articleSummary = summary({
  key: "article",
  id: articleType.id,
  name: "記事",
  version: 3,
  titleField: "lead",
  listColumns: ["lead"],
  fields: [
    { key: "title", type: "text", label: "タイトル" },
    { key: "lead", type: "text", label: "リード" },
  ],
});

it("保存済みのフィールドの削除は確認を経て行を消し、保存で fields から外れる", async () => {
  const handler = vi.fn((init?: RequestInit) =>
    init?.method === "PUT"
      ? jsonResponse(200, { ok: true, contentType: articleSummary })
      : jsonResponse(200, { contentTypes: [articleSummary] }),
  );
  renderAt(
    "/t/blog/settings/content-types/article/edit",
    socketHarness(),
    authedRoutes({ "/v1/t/t1/content-types": handler }),
  );
  const user = userEvent.setup();
  await user.click(
    within(await screen.findByRole("row", { name: /リード/ })).getByRole("button", {
      name: "編集",
    }),
  );
  const panel = await screen.findByRole("dialog", { name: "リード" });
  fireEvent.click(within(panel).getByRole("button", { name: "このフィールドを削除" }));
  const confirm = await screen.findByRole("alertdialog", {
    name: "フィールド「リード」を削除しますか？",
  });
  await user.click(within(confirm).getByRole("button", { name: "削除する" }));
  await waitFor(() =>
    expect(screen.queryByRole("row", { name: /リード/ })).not.toBeInTheDocument(),
  );
  expect(screen.queryByRole("dialog", { name: "リード" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "保存" }));
  await waitFor(() =>
    expect(handler.mock.calls.filter(([init]) => init?.method === "PUT")).toHaveLength(1),
  );
  const put = handler.mock.calls.find(([init]) => init?.method === "PUT")?.[0];
  const body = JSON.parse(String(put?.body)) as Record<string, unknown>;
  expect(body.fields).toHaveLength(1);
  expect(body).toMatchObject({ fields: [{ key: "title" }], version: 3 });
  // 消したフィールドは titleField / listColumns から外れる
  expect(body.titleField).toBeUndefined();
  expect(body.listColumns).toBeUndefined();
});
