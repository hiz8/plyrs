import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Plus, X } from "lucide-react";
import { Button, IconButton } from "./button";

describe("Button (react-aria-components + StyleX)", () => {
  it("fires onPress and carries compiled classes", async () => {
    const onPress = vi.fn();
    render(<Button onPress={onPress}>保存</Button>);
    const button = screen.getByRole("button", { name: "保存" });
    expect(button.className.length).toBeGreaterThan(0);
    await userEvent.click(button);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("does not fire onPress when disabled", async () => {
    const onPress = vi.fn();
    render(
      <Button onPress={onPress} isDisabled>
        削除
      </Button>,
    );
    const button = screen.getByRole("button", { name: "削除" });
    expect(button).toBeDisabled();
    await userEvent.click(button);
    expect(onPress).not.toHaveBeenCalled();
  });

  it("varies classes by variant", () => {
    const { rerender } = render(<Button variant="primary">A</Button>);
    const primary = screen.getByRole("button", { name: "A" }).className;
    rerender(<Button variant="danger">A</Button>);
    expect(screen.getByRole("button", { name: "A" }).className).not.toBe(primary);
  });
});

describe("Button の D1 の見た目", () => {
  it("アイコンは装飾として読み上げず、名前は文字から取る", () => {
    render(<Button icon={Plus}>お知らせを追加</Button>);
    const button = screen.getByRole("button", { name: "お知らせを追加" });
    expect(button.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("テキストリンクと小型はクラスが変わる", () => {
    const { rerender } = render(<Button variant="secondary">A</Button>);
    const secondary = screen.getByRole("button", { name: "A" }).className;
    rerender(<Button variant="link">A</Button>);
    expect(screen.getByRole("button", { name: "A" }).className).not.toBe(secondary);
    rerender(
      <Button variant="secondary" size="sm">
        A
      </Button>,
    );
    expect(screen.getByRole("button", { name: "A" }).className).not.toBe(secondary);
  });
});

describe("IconButton", () => {
  it("label が名前になり、キーボードのフォーカスで同じ文言のツールチップを出す", async () => {
    const onPress = vi.fn();
    render(<IconButton icon={X} label="閉じる" onPress={onPress} />);
    const button = screen.getByRole("button", { name: "閉じる" });
    await userEvent.tab();
    expect(button).toHaveFocus();
    expect(await screen.findByRole("tooltip")).toHaveTextContent("閉じる");
    await userEvent.keyboard("{Enter}");
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
