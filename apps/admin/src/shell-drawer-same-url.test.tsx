import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { authedRoutes, renderAt } from "./test-utils/shell-harness";

// ドロワー(RAC Modal)を開くテストは、1 ファイルに 1 本だけ置く。同じファイルの 2 本目は jsdom で戻らない

describe("ドロワー(同じ URL)", () => {
  it("ドロワーの中で現在地と同じ URL の項目を選んでも閉じる", async () => {
    const router = renderAt("/t/blog/settings/content-types", authedRoutes());
    fireEvent.click(await screen.findByRole("button", { name: "メニューを開く" }));
    const drawer = await screen.findByRole("dialog", { name: "メニュー" });
    fireEvent.click(within(drawer).getByRole("link", { name: "設定" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "メニュー" })).not.toBeInTheDocument(),
    );
    expect(router.state.location.pathname).toBe("/t/blog/settings/content-types");
  });
});
