import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { Cell, Column, Row, Table, TableBody, TableHeader } from "./table";

const rows = [
  { id: "a", title: "年末年始のお知らせ", updated: "10 分前" },
  { id: "b", title: "秋のキャンペーン", updated: "昨日" },
];

it("選択列を自動で足し、並べ替えと選択を呼び出し側へ渡す", async () => {
  const user = userEvent.setup();
  const onSortChange = vi.fn();
  const onSelectionChange = vi.fn();
  render(
    <Table
      aria-label="お知らせ"
      selectionMode="multiple"
      sortDescriptor={{ column: "updated", direction: "descending" }}
      onSortChange={onSortChange}
      onSelectionChange={onSelectionChange}
    >
      <TableHeader>
        <Column id="title" isRowHeader allowsSorting>
          タイトル
        </Column>
        <Column id="updated" allowsSorting hideOnNarrow>
          更新
        </Column>
      </TableHeader>
      <TableBody items={rows}>
        {(row) => (
          <Row id={row.id}>
            <Cell>{row.title}</Cell>
            <Cell hideOnNarrow>{row.updated}</Cell>
          </Row>
        )}
      </TableBody>
    </Table>,
  );
  const table = screen.getByRole("grid", { name: "お知らせ" });
  // 見出しの全選択 + 各行
  expect(within(table).getAllByRole("checkbox")).toHaveLength(3);
  expect(screen.getByRole("columnheader", { name: /更新/ })).toHaveAttribute(
    "aria-sort",
    "descending",
  );
  await user.click(screen.getByRole("columnheader", { name: /タイトル/ }));
  expect(onSortChange).toHaveBeenCalledWith({ column: "title", direction: "ascending" });
  await user.click(
    within(screen.getByRole("row", { name: /秋のキャンペーン/ })).getByRole("checkbox"),
  );
  expect(onSelectionChange).toHaveBeenCalled();
});

it("selectionMode が無ければ選択列を出さない", () => {
  render(
    <Table aria-label="メンバー">
      <TableHeader>
        <Column id="name" isRowHeader>
          名前
        </Column>
      </TableHeader>
      <TableBody items={[{ id: "u1", name: "管理者" }]}>
        {(row) => (
          <Row id={row.id}>
            <Cell>{row.name}</Cell>
          </Row>
        )}
      </TableBody>
    </Table>,
  );
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
});
