import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import {
  authedRoutes,
  bootstrapped,
  jsonResponse,
  renderAt,
  socketHarness,
} from "./test-utils/records-harness";
import { summary } from "./test-utils/type-rows";

const eventSummary = summary({ key: "event", name: "イベント", menuOrder: 0 });

it("削除は確認を経て DELETE し、409 type_not_empty ならトーストを出して一覧を取り直す", async () => {
  const get = vi.fn(() => jsonResponse(200, { contentTypes: [eventSummary] }));
  const del = vi.fn((_init?: RequestInit) => jsonResponse(409, { error: "type_not_empty" }));
  const harness = socketHarness();
  renderAt(
    "/t/blog/settings/content-types",
    harness,
    authedRoutes({ "/v1/t/t1/content-types": get, "/v1/t/t1/content-types/event": del }),
  );
  const user = userEvent.setup();
  await screen.findByRole("grid", { name: "コンテンツタイプの一覧" });
  await bootstrapped(harness.latest(), [], []);
  fireEvent.click(await screen.findByRole("button", { name: "削除" }));
  const dialog = await screen.findByRole("alertdialog", { name: "「イベント」を削除しますか？" });
  const getsBefore = get.mock.calls.length;
  await user.click(within(dialog).getByRole("button", { name: "削除する" }));
  await waitFor(() => expect(del).toHaveBeenCalledTimes(1));
  expect(del.mock.calls[0]?.[0]?.method).toBe("DELETE");
  // type_not_empty の文は error-messages.ts のもの。通知にエラーが出る
  expect(
    await within(screen.getByRole("region", { name: "通知" })).findByText(/コンテンツが残っている/),
  ).toBeInTheDocument();
  await waitFor(() => expect(get.mock.calls.length).toBeGreaterThan(getsBefore));
  expect(screen.getByRole("row", { name: /イベント/ })).toBeInTheDocument();
});
