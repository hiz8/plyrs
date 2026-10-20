import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { BLOG, NEWS, SLOT } from "./fixtures";
import { QuickAddRow } from "./quick-add-row";

it("型ごとのボタンをサイドバーの順に並べ、押すと onAdd に key を渡す", async () => {
  const onAdd = vi.fn();
  render(<QuickAddRow types={[NEWS, BLOG, SLOT]} onAdd={onAdd} />);
  expect(screen.getByText("新規追加")).toBeInTheDocument();
  const buttons = screen.getAllByRole("button");
  expect(buttons.map((b) => b.textContent)).toEqual(["お知らせ", "ブログ", "予約枠"]);
  await userEvent.click(screen.getByRole("button", { name: "ブログ" }));
  expect(onAdd).toHaveBeenCalledWith("blog");
});

it("利用者の型とモジュールの型の間に区切りを置き、読み込み中はスケルトンだけを出す", () => {
  const { container, rerender } = render(<QuickAddRow types={[NEWS, SLOT]} onAdd={vi.fn()} />);
  expect(container.querySelectorAll('[data-divider="true"]')).toHaveLength(1);
  rerender(<QuickAddRow types={[NEWS, BLOG]} onAdd={vi.fn()} />);
  expect(container.querySelectorAll('[data-divider="true"]')).toHaveLength(0);
  rerender(<QuickAddRow types={[]} onAdd={vi.fn()} isLoading />);
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
  expect(container.querySelectorAll('span[aria-hidden="true"]').length).toBeGreaterThanOrEqual(3);
});
