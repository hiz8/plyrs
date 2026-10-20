import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { BulkBarProps } from "./components/bulk-bar";
import {
  article,
  authedRoutes,
  bootstrapped,
  renderAt,
  socketHarness,
} from "./test-utils/records-harness";

vi.mock("./components/bulk-bar", () => ({
  BulkBar: (props: BulkBarProps) => (
    <div role="region" aria-label="一括操作">
      <button type="button" onClick={() => props.onAction({ kind: "delete" })}>
        一括削除
      </button>
    </div>
  ),
}));

const ID_A = "018f2b6a-7a0a-7000-8000-000000000501";
const ID_B = "018f2b6a-7a0a-7000-8000-000000000502";

type Push = { changes: { changeId: string; op: string; id?: string }[] };

describe("一覧の一括削除", () => {
  it("一括の削除は確認を経て順に delete を push する", async () => {
    const harness = socketHarness();
    renderAt("/t/blog/content/article", harness, authedRoutes());
    await vi.waitFor(() => expect(harness.sockets.length).toBe(1));
    await bootstrapped(harness.latest(), [
      article(ID_A, "記事 A", { updatedAt: "2026-07-17T02:00:00Z" }),
      article(ID_B, "記事 B", { updatedAt: "2026-07-17T01:00:00Z" }),
    ]);
    const user = userEvent.setup();
    const grid = within(await screen.findByRole("grid", { name: "記事の一覧" }));
    for (const box of grid.getAllByRole("checkbox").slice(1)) await user.click(box);

    fireEvent.click(await screen.findByRole("button", { name: "一括削除" }));
    const dialog = await screen.findByRole("alertdialog", { name: "2 件の記事を削除しますか？" });
    fireEvent.click(within(dialog).getByRole("button", { name: "削除する" }));

    const pushes = () =>
      harness
        .latest()
        .parsed()
        .filter((m) => (m as { type: string }).type === "push") as Push[];
    // 1 件目の ack を返すまで 2 件目は送られない(順に実行)
    await vi.waitFor(() => expect(pushes()).toHaveLength(1));
    const ack = (n: number, id: string, title: string) =>
      harness.latest().deliver({
        type: "ack",
        changeId: pushes()[n]?.changes[0]?.changeId ?? "",
        result: {
          ok: true,
          record: article(id, title, {
            seq: 11 + n,
            version: 2,
            deletedAt: "2026-07-17T03:00:00Z",
          }),
        },
      });
    expect(pushes()[0]?.changes[0]?.op).toBe("delete");
    ack(0, ID_A, "記事 A");
    await vi.waitFor(() => expect(pushes()).toHaveLength(2));
    expect(pushes()[1]?.changes[0]?.op).toBe("delete");
    ack(1, ID_B, "記事 B");
    const toasts = within(await screen.findByRole("region", { name: "通知" }));
    expect(await toasts.findByText("2 件を削除しました")).toBeInTheDocument();
  });
});
