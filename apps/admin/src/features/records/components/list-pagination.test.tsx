import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { ListPagination } from "./list-pagination";

it("24 件 / 20 件で 2 ページの番号と範囲を出し、次のページで onPageChange(2)", async () => {
  const onPageChange = vi.fn();
  render(
    <ListPagination
      page={1}
      pageCount={2}
      total={24}
      perPage={20}
      onPageChange={onPageChange}
      onPerPageChange={vi.fn()}
    />,
  );
  expect(screen.getByRole("navigation", { name: "ページ送り" })).toBeInTheDocument();
  expect(screen.getByText("24 件中 1〜20 件")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "1 ページ目" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  expect(screen.getByRole("button", { name: "2 ページ目" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "前のページ" })).toBeDisabled();
  await userEvent.click(screen.getByRole("button", { name: "次のページ" }));
  expect(onPageChange).toHaveBeenCalledWith(2);
});

it("1 ページの件数の変更は onPerPageChange(50)", async () => {
  const onPerPageChange = vi.fn();
  render(
    <ListPagination
      page={1}
      pageCount={2}
      total={24}
      perPage={20}
      onPageChange={vi.fn()}
      onPerPageChange={onPerPageChange}
    />,
  );
  await userEvent.click(screen.getByRole("button", { name: /1 ページの件数/ }));
  await userEvent.click(screen.getByRole("option", { name: "1 ページ 50 件" }));
  expect(onPerPageChange).toHaveBeenCalledWith(50);
});
