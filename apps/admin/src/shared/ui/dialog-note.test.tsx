import { render, screen } from "@testing-library/react";
import { Clock } from "lucide-react";
import { expect, it } from "vitest";
import { DialogNote } from "./dialog-note";

it("本文とアイコン(装飾)を描き、role を渡せる", () => {
  const { container } = render(
    <DialogNote tone="warning" icon={Clock} role="status">
      反映が遅れます
    </DialogNote>,
  );
  expect(screen.getByRole("status")).toHaveTextContent("反映が遅れます");
  expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
});

it("アイコン無しでも本文を描く", () => {
  const { container } = render(<DialogNote tone="danger">失敗</DialogNote>);
  expect(screen.getByText("失敗")).toBeInTheDocument();
  expect(container.querySelector("svg")).toBeNull();
});
