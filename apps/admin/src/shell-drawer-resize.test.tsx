import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { authedRoutes, renderAt } from "./test-utils/shell-harness";

// ドロワー(RAC Modal)を開くテストは、1 ファイルに 1 本だけ置く。同じファイルの 2 本目は jsdom で戻らない

describe("ドロワー(幅の拡大)", () => {
  it("幅が 960px 以上に広がるとドロワーを閉じる", async () => {
    let listener: ((event: { matches: boolean }) => void) | undefined;
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      addEventListener: (_: string, fn: (event: { matches: boolean }) => void) => {
        listener = fn;
      },
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia;
    try {
      renderAt("/t/blog/settings/content-types", authedRoutes());
      fireEvent.click(await screen.findByRole("button", { name: "メニューを開く" }));
      await screen.findByRole("dialog", { name: "メニュー" });
      await waitFor(() => expect(listener).toBeDefined());
      act(() => listener?.({ matches: true }));
      await waitFor(() =>
        expect(screen.queryByRole("dialog", { name: "メニュー" })).not.toBeInTheDocument(),
      );
    } finally {
      window.matchMedia = original;
    }
  });
});
