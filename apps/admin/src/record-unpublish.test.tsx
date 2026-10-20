import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  article,
  authedRoutes,
  bootstrapped,
  jsonResponse,
  RECORD_1,
  renderAt,
  socketHarness,
} from "./test-utils/records-harness";

describe("公開の取り下げ", () => {
  it("公開の取り下げは確認を経て unpublish API を呼ぶ", async () => {
    const harness = socketHarness();
    let published = true;
    const unpublish = vi.fn(() => {
      published = false;
      return jsonResponse(200, { ok: true });
    });
    renderAt(
      `/t/blog/content/article/${RECORD_1}`,
      harness,
      authedRoutes({
        [`/v1/t/t1/records/${RECORD_1}/publication`]: vi.fn(() =>
          published
            ? jsonResponse(200, {
                published: true,
                publishedAt: "2026-07-17T02:00:00Z",
                publishedBy: "u1",
                sourceVersion: 1,
              })
            : jsonResponse(200, { published: false }),
        ),
        [`/v1/t/t1/records/${RECORD_1}/unpublish`]: unpublish,
      }),
    );
    await vi.waitFor(() => expect(harness.sockets.length).toBe(1));
    await bootstrapped(harness.latest(), [article(RECORD_1, "旧タイトル")]);
    const box = within(await screen.findByRole("region", { name: "公開" }));
    await box.findByText("公開中");

    fireEvent.click(box.getByRole("button", { name: "公開を取り下げ" }));

    const dialog = await screen.findByRole("alertdialog", { name: "公開を取り下げますか？" });
    expect(unpublish).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "公開を取り下げる" }));

    await vi.waitFor(() => expect(unpublish).toHaveBeenCalledTimes(1));
    const toasts = within(await screen.findByRole("region", { name: "通知" }));
    expect(await toasts.findByText("公開を取り下げました")).toBeInTheDocument();
    expect(await box.findByText("未公開")).toBeInTheDocument();
  });
});
