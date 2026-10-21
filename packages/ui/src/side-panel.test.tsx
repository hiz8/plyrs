import { fireEvent, render, screen } from "@testing-library/react";
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

describe("SidePanel のフォーカスと Esc", () => {
  it("開いた直後は dialog にフォーカスがある", () => {
    render(
      <SidePanel isOpen onClose={() => {}} title="タイトル">
        <input aria-label="入力" />
      </SidePanel>,
    );
    expect(screen.getByRole("dialog", { name: "タイトル" })).toHaveFocus();
  });

  it("入力欄の中で Esc を押すと onClose が呼ばれる", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <SidePanel isOpen onClose={onClose} title="タイトル">
        <input aria-label="入力" />
      </SidePanel>,
    );
    await user.click(screen.getByRole("textbox", { name: "入力" }));
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("IME の変換中(isComposing)の Esc では onClose が呼ばれない", () => {
    const onClose = vi.fn();
    render(
      <SidePanel isOpen onClose={onClose} title="タイトル">
        <input aria-label="入力" />
      </SidePanel>,
    );
    fireEvent.keyDown(screen.getByRole("textbox", { name: "入力" }), {
      key: "Escape",
      isComposing: true,
    });
    expect(onClose).not.toHaveBeenCalled();
  });
});

const panelOf = () => screen.getByRole("dialog").parentElement as HTMLElement;

describe("SidePanel の width と narrowLayout", () => {
  it("width と narrowLayout=sheet は別のクラスで描かれる", () => {
    const { unmount } = render(
      <SidePanel isOpen onClose={() => {}} title="既定">
        本文
      </SidePanel>,
    );
    const baseClass = panelOf().className;
    const baseStyle = panelOf().getAttribute("style") ?? "";
    unmount();
    const second = render(
      <SidePanel isOpen onClose={() => {}} title="幅" width={360}>
        本文
      </SidePanel>,
    );
    expect(panelOf().getAttribute("style")).toContain("360px");
    expect(panelOf().getAttribute("style")).not.toBe(baseStyle);
    expect(baseStyle).toContain("420px");
    second.unmount();
    render(
      <SidePanel isOpen onClose={() => {}} title="シート" narrowLayout="sheet">
        本文
      </SidePanel>,
    );
    expect(panelOf().className).not.toBe(baseClass);
  });

  it("sheet のときだけ上端のつまみ(aria-hidden)を描く", () => {
    const { unmount } = render(
      <SidePanel isOpen onClose={() => {}} title="既定">
        本文
      </SidePanel>,
    );
    expect(screen.getByRole("dialog").querySelector("div[aria-hidden='true']")).toBeNull();
    unmount();
    render(
      <SidePanel isOpen onClose={() => {}} title="シート" narrowLayout="sheet">
        本文
      </SidePanel>,
    );
    expect(screen.getByRole("dialog").querySelectorAll("div[aria-hidden='true']")).toHaveLength(1);
  });
});
