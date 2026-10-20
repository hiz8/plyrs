import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { SidePanel } from "./side-panel";

describe("SidePanel", () => {
  it("開くと dialog として題と本文を描き、閉じるボタンと Esc で onClose を呼ぶ", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <SidePanel isOpen onClose={onClose} title="タイトル" subtitle="種類: テキスト(1 行)">
        <p>本文</p>
      </SidePanel>,
    );
    const dialog = screen.getByRole("dialog", { name: "タイトル" });
    expect(dialog).toHaveTextContent("種類: テキスト(1 行)");
    expect(dialog).toHaveTextContent("本文");
    await user.click(screen.getByRole("button", { name: "閉じる" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("閉じると returnFocusTo の要素へフォーカスを戻す", () => {
    const ref = createRef<HTMLButtonElement>();
    const ui = (isOpen: boolean) => (
      <>
        <button ref={ref} type="button">
          編集
        </button>
        <SidePanel isOpen={isOpen} onClose={() => {}} title="タイトル" returnFocusTo={ref}>
          本文
        </SidePanel>
      </>
    );
    const { rerender } = render(ui(true));
    expect(document.activeElement).not.toBe(ref.current);
    rerender(ui(false));
    expect(document.activeElement).toBe(ref.current);
  });

  it("isOpen が false なら何も描かない", () => {
    render(
      <SidePanel isOpen={false} onClose={() => {}} title="タイトル">
        本文
      </SidePanel>,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
