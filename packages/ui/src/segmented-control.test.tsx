import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SegmentedControl } from "./segmented-control";

const items = [
  { value: "light", label: "ライト" },
  { value: "dark", label: "ダーク" },
  { value: "system", label: "システム" },
];

describe("SegmentedControl", () => {
  it("radiogroup として描き、選ぶと onChange に値を渡す", async () => {
    const onChange = vi.fn();
    render(<SegmentedControl label="テーマ" items={items} value="light" onChange={onChange} />);
    expect(screen.getByRole("radiogroup", { name: "テーマ" })).toBeInTheDocument();
    expect(screen.getAllByRole("radio")).toHaveLength(3);
    expect(screen.getByRole("radio", { name: "ライト" })).toBeChecked();
    await userEvent.setup().click(screen.getByRole("radio", { name: "ダーク" }));
    expect(onChange).toHaveBeenCalledWith("dark");
  });

  it("選んだ値が checked になる", () => {
    render(<SegmentedControl label="テーマ" items={items} value="dark" onChange={() => {}} />);
    expect(screen.getByRole("radio", { name: "ダーク" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "ライト" })).not.toBeChecked();
  });

  it("isDisabled なら選べない", async () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl
        label="テーマ"
        items={items}
        value="light"
        onChange={onChange}
        isDisabled
      />,
    );
    await userEvent.setup().click(screen.getByRole("radio", { name: "ダーク" }));
    expect(onChange).not.toHaveBeenCalled();
  });
});
