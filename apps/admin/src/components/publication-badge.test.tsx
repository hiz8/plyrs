import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { PublicationBadge, WorkflowStatusBadge } from "./publication-badge";

it.each([
  ["published", "公開中"],
  ["changed", "公開中・未反映の変更あり"],
  ["unpublished", "未公開"],
] as const)("%s", (state, text) => {
  render(<PublicationBadge state={state} />);
  expect(screen.getByText(text)).toBeTruthy();
});

it("short 指定の changed は短い文だけを出す", () => {
  render(<PublicationBadge state="changed" short />);
  expect(screen.getByText("公開中・未反映")).toBeTruthy();
  expect(screen.queryByText("公開中・未反映の変更あり")).toBeNull();
});

it("ワークフロー状態のバッジは日本語の文言を出す", () => {
  render(<WorkflowStatusBadge status="in_review" />);
  expect(screen.getByText("レビュー中")).toBeTruthy();
});
