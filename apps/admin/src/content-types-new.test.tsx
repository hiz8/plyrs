import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { authedRoutes, jsonResponse, renderAt, socketHarness } from "./test-utils/records-harness";
import { summary } from "./test-utils/type-rows";

it("型を作ると定義を PUT して一覧に戻り、トーストが出る", async () => {
  const handler = vi.fn((init?: RequestInit) =>
    init?.method === "PUT"
      ? jsonResponse(200, { ok: true, contentType: summary({ key: "article", name: "記事" }) })
      : jsonResponse(200, { contentTypes: [] }),
  );
  const router = renderAt(
    "/t/blog/settings/content-types/new",
    socketHarness(),
    authedRoutes({ "/v1/t/t1/content-types": handler }),
  );
  const user = userEvent.setup();
  await user.type(await screen.findByRole("textbox", { name: /^表示名/ }), "記事");
  await user.type(screen.getByRole("textbox", { name: /^API 名/ }), "article");
  fireEvent.click(screen.getByRole("button", { name: "フィールドを追加" }));
  const dialog = await screen.findByRole("dialog", { name: "フィールドを追加" });
  await user.click(within(dialog).getByRole("button", { name: /^テキスト/ }));
  await user.click(within(dialog).getByRole("button", { name: "次へ" }));
  await user.type(within(dialog).getByRole("textbox", { name: /^表示名/ }), "title");
  await user.click(within(dialog).getByRole("button", { name: "追加" }));
  const panel = await screen.findByRole("dialog", { name: "title" });
  await user.click(within(panel).getByRole("button", { name: "適用" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "作成" })).toBeEnabled());
  await user.click(screen.getByRole("button", { name: "作成" }));

  await waitFor(() =>
    expect(handler.mock.calls.filter(([init]) => init?.method === "PUT")).toHaveLength(1),
  );
  const put = handler.mock.calls.find(([init]) => init?.method === "PUT")?.[0];
  const body = JSON.parse(String(put?.body)) as Record<string, unknown>;
  expect(body).toMatchObject({
    key: "article",
    name: "記事",
    fields: [{ key: "title", type: "text", label: "title" }],
    source: "user",
    version: 1,
  });
  expect(body.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  expect(
    await within(screen.getByRole("region", { name: "通知" })).findByText("作成しました"),
  ).toBeInTheDocument();
  await waitFor(() =>
    expect(router.state.location.pathname).toBe("/t/blog/settings/content-types"),
  );
  expect(await screen.findByRole("tab", { name: "コンテンツタイプ" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
});
