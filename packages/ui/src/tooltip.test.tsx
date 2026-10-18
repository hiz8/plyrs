import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import { Button } from "./button";
import { Tooltip } from "./tooltip";

it("フォーカスで内容を出し、Esc で閉じる", async () => {
  render(
    <Tooltip content="2026/10/17 10:00">
      <Button variant="secondary">10 分前</Button>
    </Tooltip>,
  );
  await userEvent.tab();
  expect(await screen.findByRole("tooltip")).toHaveTextContent("2026/10/17 10:00");
  await userEvent.keyboard("{Escape}");
  expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
});
