import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Select } from "./select";

describe("Select", () => {
  const items = [
    { value: "draft", label: "下書き" },
    { value: "ready", label: "公開準備完了" },
  ];

  it("opens the listbox and selects an item", async () => {
    const onChange = vi.fn();
    render(<Select label="ステータス" items={items} selectedValue="draft" onChange={onChange} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /ステータス/ }));
    await user.click(await screen.findByRole("option", { name: "公開準備完了" }));
    expect(onChange).toHaveBeenCalledWith("ready");
  });

  it("shows the placeholder when nothing is selected", () => {
    render(
      <Select
        label="型"
        items={items}
        selectedValue=""
        onChange={() => {}}
        placeholder="(未設定)"
      />,
    );
    expect(screen.getByRole("button", { name: /(未設定)/ })).toBeInTheDocument();
  });
});
