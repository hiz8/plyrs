import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  article,
  authedRoutes,
  bootstrapped,
  renderAt,
  socketHarness,
} from "./test-utils/records-harness";

const ID_A = "018f2b6a-7a0a-7000-8000-000000000601";

type Push = { changes: { changeId: string; op: string }[] };

describe("一覧の行の削除", () => {
  it("行の「削除」は確認を経て delete を push しトーストを出す", async () => {
    const harness = socketHarness();
    renderAt("/t/blog/content/article", harness, authedRoutes());
    await vi.waitFor(() => expect(harness.sockets.length).toBe(1));
    await bootstrapped(harness.latest(), [article(ID_A, "消す記事")]);
    const grid = within(await screen.findByRole("grid", { name: "記事の一覧" }));

    fireEvent.click(grid.getByRole("button", { name: "削除" }));
    const dialog = await screen.findByRole("alertdialog", { name: "記事を削除しますか？" });
    expect(within(dialog).getByText("「消す記事」を削除します。元に戻せません。")).toBeVisible();
    fireEvent.click(within(dialog).getByRole("button", { name: "削除する" }));

    const pushOf = () =>
      harness
        .latest()
        .parsed()
        .find((m) => (m as { type: string }).type === "push") as Push | undefined;
    await vi.waitFor(() => expect(pushOf()?.changes[0]?.op).toBe("delete"));
    harness.latest().deliver({
      type: "ack",
      changeId: pushOf()?.changes[0]?.changeId ?? "",
      result: {
        ok: true,
        record: article(ID_A, "消す記事", {
          seq: 11,
          version: 2,
          deletedAt: "2026-07-17T03:00:00Z",
        }),
      },
    });
    const toasts = within(await screen.findByRole("region", { name: "通知" }));
    expect(await toasts.findByText("削除しました")).toBeInTheDocument();
  });
});
