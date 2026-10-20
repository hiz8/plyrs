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

type Push = { changes: { changeId: string; status?: string }[] };

describe("公開中のアーカイブ", () => {
  it("公開中にアーカイブを選ぶと確認を経て status を push する", async () => {
    const harness = socketHarness();
    renderAt(
      `/t/blog/content/article/${RECORD_1}`,
      harness,
      authedRoutes({
        [`/v1/t/t1/records/${RECORD_1}/publication`]: vi.fn(() =>
          jsonResponse(200, {
            published: true,
            publishedAt: "2026-07-17T02:00:00Z",
            publishedBy: "u1",
            sourceVersion: 1,
          }),
        ),
      }),
    );
    await vi.waitFor(() => expect(harness.sockets.length).toBe(1));
    await bootstrapped(harness.latest(), [article(RECORD_1, "旧タイトル")]);
    const box = within(await screen.findByRole("region", { name: "公開" }));
    await box.findByText("公開中");

    // RAC の Select は jsdom でポップオーバーを開けないので、非表示のネイティブ <select> を使う
    let nativeSelect: HTMLSelectElement | null = null;
    await vi.waitFor(() => {
      nativeSelect = document.querySelector("select");
      expect(nativeSelect).not.toBeNull();
    });
    if (nativeSelect === null) throw new Error("hidden native select not found");
    fireEvent.change(nativeSelect, { target: { value: "archived" } });

    const dialog = await screen.findByRole("alertdialog", {
      name: "公開したままアーカイブしますか？",
    });
    const pushOf = () =>
      harness
        .latest()
        .parsed()
        .find((message) => (message as { type: string }).type === "push") as Push | undefined;
    expect(pushOf()).toBeUndefined();

    fireEvent.click(within(dialog).getByRole("button", { name: "公開したままアーカイブする" }));

    await vi.waitFor(() => expect(pushOf()?.changes[0]?.status).toBe("archived"));
    harness.latest().deliver({
      type: "ack",
      changeId: pushOf()?.changes[0]?.changeId ?? "",
      result: {
        ok: true,
        record: article(RECORD_1, "旧タイトル", { status: "archived", seq: 11, version: 2 }),
      },
    });
    const toasts = within(await screen.findByRole("region", { name: "通知" }));
    expect(await toasts.findByText("ステータスを変更しました")).toBeInTheDocument();
  });
});
