import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import type { SyncRecord } from "@plyrs/sync-protocol";
import type { ListRow } from "../lib/content-list";
import { ContentTable, type ContentTableProps } from "./content-table";

const now = new Date("2026-10-20T00:00:00Z");
const row = (id: string, title: string, over: Partial<ListRow> = {}): ListRow => ({
  record: {
    id,
    type: "article",
    input: {},
    fieldVersions: {},
    status: "in_review",
    seq: 1,
    version: 2,
    deletedAt: null,
    updatedAt: "2026-10-19T00:00:00Z",
    updatedBy: "u1",
  } satisfies SyncRecord,
  title,
  searchKey: title,
  publication: "changed",
  ...over,
});

function setup(over: Partial<ContentTableProps> = {}) {
  const props: ContentTableProps = {
    tenantSlug: "blog",
    typeKey: "article",
    typeName: "記事",
    rows: [row("r1", "はじめの記事"), row("r2", "二つ目", { publication: "published" })],
    sort: { column: "updated", order: "desc" },
    onSortChange: vi.fn(),
    selection: { selectedKeys: new Set(), onSelectionChange: vi.fn(), isDisabled: false },
    failedIds: new Set(),
    canWrite: true,
    onDelete: vi.fn(),
    now,
    ...over,
  };
  render(<ContentTable {...props} />);
  return props;
}

it("行にタイトルのリンク・公開バッジ・ステータスバッジ・相対時刻を出す", () => {
  setup();
  const table = screen.getByRole("grid", { name: "記事の一覧" });
  expect(within(table).getByRole("link", { name: "はじめの記事" })).toHaveAttribute(
    "href",
    "/t/blog/content/article/r1",
  );
  expect(within(table).getAllByText("公開中・未反映の変更あり").length).toBeGreaterThan(0);
  expect(within(table).getAllByText("レビュー中").length).toBeGreaterThan(0);
  expect(table.querySelector("time")).not.toBeNull();
});

it("見出しのチェックで表示中の行を全選択し、Set で通知する", async () => {
  const props = setup();
  await userEvent.click(screen.getByRole("checkbox", { name: /すべて|Select All/ }));
  expect(props.selection?.onSelectionChange).toHaveBeenCalledWith(new Set(["r1", "r2"]));
});

it("更新の見出しを押すと onSortChange(updated, asc)", async () => {
  const props = setup();
  await userEvent.click(screen.getByRole("columnheader", { name: /更新/ }));
  expect(props.onSortChange).toHaveBeenCalledWith("updated", "asc");
});

it("failedIds の行の公開列に「失敗」を添える", () => {
  setup({ failedIds: new Set(["r2"]) });
  expect(screen.getAllByText("失敗")).toHaveLength(1);
});

it("閲覧者は選択列が無く、行の操作は「表示」だけ", () => {
  setup({ selection: undefined, canWrite: false });
  expect(screen.queryByRole("checkbox")).toBeNull();
  expect(screen.getAllByRole("link", { name: "表示" })).toHaveLength(2);
  expect(screen.queryByRole("link", { name: "編集" })).toBeNull();
  expect(screen.queryByRole("button", { name: "削除" })).toBeNull();
});
