import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { ProgressBar, Spinner } from "./progress";

it("ProgressBar は progressbar として値と件数の文言を持つ", () => {
  render(<ProgressBar label="公開しています…" value={3} maxValue={10} valueLabel="3 / 10 件" />);
  const bar = screen.getByRole("progressbar", { name: "公開しています…" });
  expect(bar).toHaveAttribute("aria-valuenow", "3");
  expect(bar).toHaveAttribute("aria-valuetext", "3 / 10 件");
  expect(screen.getByText("3 / 10 件")).toBeInTheDocument();
});

it("Spinner は文言を出し、アイコンは読み上げない", () => {
  render(<Spinner label="アップロードしています…" />);
  const text = screen.getByText("アップロードしています…");
  expect(text.parentElement?.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
});

it("isLabelHidden は aria-label を残して見た目の題を出さない", () => {
  render(
    <ProgressBar
      label="公開しています…"
      value={2}
      maxValue={8}
      valueLabel="2 / 8 件"
      isLabelHidden
    />,
  );
  expect(screen.getByRole("progressbar", { name: "公開しています…" })).toBeInTheDocument();
  expect(screen.queryByText("公開しています…")).not.toBeInTheDocument();
  expect(screen.getByText("2 / 8 件")).toBeInTheDocument();
});
