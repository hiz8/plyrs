import { act, fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  article,
  authedRoutes,
  bootstrapped,
  RECORD_1,
  renderAt,
  socketHarness,
} from "./test-utils/records-harness";

describe("編集画面の離脱", () => {
  it("未保存の編集があるときの遷移は確認で止まり、「破棄して移動」で進む", async () => {
    const harness = socketHarness();
    const router = renderAt(`/t/blog/content/article/${RECORD_1}`, harness, authedRoutes());
    await vi.waitFor(() => expect(harness.sockets.length).toBe(1));
    await bootstrapped(harness.latest(), [article(RECORD_1, "旧タイトル")]);
    const user = userEvent.setup();
    const input = await screen.findByRole("textbox", { name: "title" });
    await user.clear(input);
    await user.type(input, "書きかけ");

    act(() => {
      router.history.push("/t/blog/media");
    });

    const dialog = await screen.findByRole("alertdialog", { name: "保存していない変更があります" });
    expect(router.state.location.pathname).toBe(`/t/blog/content/article/${RECORD_1}`);
    expect(document.activeElement).toBe(
      within(dialog).getByRole("button", { name: "編集を続ける" }),
    );

    // Esc は「編集を続ける」と同じ扱いで閉じて留まる
    await userEvent.keyboard("{Escape}");
    await vi.waitFor(() =>
      expect(
        screen.queryByRole("alertdialog", { name: "保存していない変更があります" }),
      ).toBeNull(),
    );
    expect(router.state.location.pathname).toBe(`/t/blog/content/article/${RECORD_1}`);
    act(() => {
      router.history.push("/t/blog/media");
    });
    const again = await screen.findByRole("alertdialog", { name: "保存していない変更があります" });

    fireEvent.click(within(again).getByRole("button", { name: "破棄して移動" }));

    await vi.waitFor(() => expect(router.state.location.pathname).toBe("/t/blog/media"));
  });
});
