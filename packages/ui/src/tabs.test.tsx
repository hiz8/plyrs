import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { Tabs } from "./tabs";

it("keyboardActivation=manual は矢印キーでは選ばず、Enter で選ぶ", async () => {
  const user = userEvent.setup();
  const onSelectionChange = vi.fn();
  render(
    <Tabs
      label="区分"
      items={[
        { id: "a", label: "甲" },
        { id: "b", label: "乙" },
      ]}
      selectedKey="a"
      onSelectionChange={onSelectionChange}
      keyboardActivation="manual"
    >
      {(id) => <p>{id}</p>}
    </Tabs>,
  );
  await user.click(screen.getByRole("tab", { name: "甲" }));
  onSelectionChange.mockClear();
  await user.keyboard("{ArrowRight}");
  expect(screen.getByRole("tab", { name: "乙" })).toHaveFocus();
  expect(onSelectionChange).not.toHaveBeenCalled();
  await user.keyboard("{Enter}");
  expect(onSelectionChange).toHaveBeenCalledWith("b");
});
