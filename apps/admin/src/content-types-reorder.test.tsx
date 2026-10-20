import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { authedRoutes, jsonResponse, renderAt, socketHarness } from "./test-utils/records-harness";
import { summary } from "./test-utils/type-rows";

const newsSummary = summary({ key: "news", name: "お知らせ", menuOrder: 0 });
const blogSummary = summary({ key: "blog", name: "ブログ", menuOrder: 1 });

it("キーボードで並べ替えると変わった型だけ menuOrder 付きで PUT し、失敗ならトーストと取り直し", async () => {
  const get = vi.fn(() => jsonResponse(200, { contentTypes: [newsSummary, blogSummary] }));
  const put = vi
    .fn()
    .mockImplementationOnce((_init?: RequestInit) => jsonResponse(200, { ok: true }))
    .mockImplementation((_init?: RequestInit) => jsonResponse(500, { error: "boom" }));
  // 同じパスの GET と PUT は 1 つのハンドラで method により振り分ける
  const handler = vi.fn((init?: RequestInit) => (init?.method === "PUT" ? put(init) : get()));
  renderAt(
    "/t/blog/settings/content-types",
    socketHarness(),
    authedRoutes({ "/v1/t/t1/content-types": handler }),
  );
  const user = userEvent.setup();
  const grid = await screen.findByRole("grid", { name: "コンテンツタイプの一覧" });
  expect(within(grid).getAllByRole("row")[0]).toHaveTextContent("お知らせ");
  const getsBefore = get.mock.calls.length;

  const handle = await screen.findByRole("button", { name: "お知らせを並べ替え" });
  handle.focus();
  await user.keyboard("{Enter}");
  await user.keyboard("{ArrowDown}");
  await user.keyboard("{Enter}");

  // 並びは [ブログ, お知らせ] になり、menuOrder が変わる 2 件を PUT する
  await waitFor(() => expect(put).toHaveBeenCalledTimes(2));
  const first = JSON.parse(String(put.mock.calls[0]?.[0]?.body));
  expect(first).toMatchObject({ key: "blog", menuOrder: 0 });
  expect(
    await within(screen.getByRole("region", { name: "通知" })).findByText(
      "並び順を保存できませんでした",
    ),
  ).toBeInTheDocument();
  const second = JSON.parse(String(put.mock.calls[1]?.[0]?.body));
  expect(second).toMatchObject({ key: "news", menuOrder: 1 });
  await waitFor(() => expect(get.mock.calls.length).toBeGreaterThan(getsBefore));
});
