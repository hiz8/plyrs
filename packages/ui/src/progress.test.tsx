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
