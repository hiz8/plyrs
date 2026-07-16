import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Button } from "./button";

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
