import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { authedRoutes, renderAt } from "./test-utils/shell-harness";

// ドロワー(RAC Modal)を開くテストは 1 ファイルに 1 本だけ置く。
// shell.test.tsx に置くと、後続の「旧 URL のリダイレクト」が autoFocus 付きの型作成画面を描いた
// ところで jsdom が戻らなくなる(RAC Modal の後にフォーカスを動かす画面を描くと止まる)

describe("ドロワー(項目の選択)", () => {
  it("ドロワーを開いて項目を選ぶと閉じる(Review Focus 5)", async () => {
    const router = renderAt("/t/blog/settings/content-types", authedRoutes());
    const toggle = await screen.findByRole("button", { name: "メニューを開く" });
    const overflowBefore = document.documentElement.style.overflow;
    // 開く操作だけ fireEvent: 上のコメントと同じ理由で、user-event のポインタ列だと戻らない
    // fireEvent.click はフォーカスを動かさないので、開く前に明示してフォーカス復帰を観測できるようにする
    toggle.focus();
    fireEvent.click(toggle);
    const drawer = await screen.findByRole("dialog", { name: "メニュー" });
    expect(
      // モーダルが外側を aria-hidden にするので hidden: true で探す
      screen.getByRole("button", { name: "メニューを閉じる", hidden: true }),
    ).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(within(drawer).getByRole("link", { name: "メディア" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "メニュー" })).not.toBeInTheDocument(),
    );
    // メディア画面(同期前はスケルトンの見出し)
    expect(await screen.findByRole("heading", { level: 1 })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/t/blog/media");
    // モーダルの後始末: 外側の aria-hidden が外れ、スクロール固定が戻り、フォーカスが開閉ボタンへ戻る
    expect(screen.getByRole("main")).toBeInTheDocument();
    expect(document.documentElement.style.overflow).toBe(overflowBefore);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "メニューを開く" }));
  });
});
