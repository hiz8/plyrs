import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { typeRow } from "../../test-utils/type-rows";
import { TypeTable } from "./type-table";

function renderTable(rows: ReturnType<typeof typeRow>[], canManage = true) {
  const onDelete = vi.fn();
  render(
    <TypeTable
      rows={rows}
      slug="blog"
      canManage={canManage}
      isReordering={false}
      onReorder={vi.fn()}
      onDelete={onDelete}
    />,
  );
  return onDelete;
}

it("表示名・説明・API 名・フィールド数・件数と、0 件の型にだけ削除を出す", async () => {
  const user = userEvent.setup();
  const news = typeRow(
    {
      key: "news",
      name: "お知らせ",
      description: "告知",
      fields: [{ key: "title", type: "text", required: true }],
    },
    0,
  );
  const blog = typeRow({ key: "blog", name: "ブログ" }, 3);
  const onDelete = renderTable([news, blog]);
  expect(screen.getByRole("link", { name: "お知らせ" })).toHaveAttribute(
    "href",
    "/t/blog/settings/content-types/news/edit",
  );
  expect(screen.getByText("API 名: news")).toBeInTheDocument();
  expect(screen.getByText(/告知/)).toBeInTheDocument();
  expect(screen.getByText("0 件")).toBeInTheDocument();
  expect(screen.getByText("3 件")).toBeInTheDocument();
  expect(screen.getAllByRole("link", { name: "編集" })).toHaveLength(2);
  const deletes = screen.getAllByRole("button", { name: "削除" });
  expect(deletes).toHaveLength(1);
  await user.click(deletes[0] as HTMLElement);
  expect(onDelete).toHaveBeenCalledWith(news);
});

it("件数が null ならスケルトンで削除が無い", () => {
  renderTable([typeRow({ key: "news", name: "お知らせ" }, null)]);
  expect(screen.queryByRole("button", { name: "削除" })).not.toBeInTheDocument();
  expect(screen.queryByText(/件$/)).not.toBeInTheDocument();
});

it("canManage が false ならつまみと削除が無く「フィールドを見る」のリンク", () => {
  renderTable([typeRow({ key: "news", name: "お知らせ" }, 0)], false);
  expect(screen.queryByRole("button", { name: "お知らせを並べ替え" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "削除" })).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "編集" })).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "フィールドを見る" })).toHaveAttribute(
    "href",
    "/t/blog/settings/content-types/news/edit",
  );
});
