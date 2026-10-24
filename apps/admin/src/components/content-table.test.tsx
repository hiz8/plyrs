import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import type { SyncRecord } from "@plyrs/sync-protocol";
import type { ListRow } from "../lib/content-list";
import type { ContentTypeDefinition } from "@plyrs/metamodel";
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

const baseType: ContentTypeDefinition = {
  id: "018f2b6a-7a0a-7000-8000-000000000001",
  key: "article",
  name: "記事",
  source: "user",
  version: 1,
  fields: [
    { key: "title", type: "text", required: true },
    { key: "subtitle", type: "text", label: "副題" },
    { key: "views", type: "number" },
    { key: "slug", type: "text", label: "URL", config: { unique: true } },
  ],
};

function setup(over: Partial<ContentTableProps> = {}) {
  const props: ContentTableProps = {
    tenantSlug: "blog",
    typeKey: "article",
    typeName: "記事",
    contentType: baseType,
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

it("listColumns の列がタイトルの右に並び、見出しは表示名、狭い画面で隠れる", () => {
  const r = row("r1", "はじめの記事");
  setup({
    contentType: { ...baseType, listColumns: ["subtitle", "views"] },
    rows: [
      {
        ...r,
        record: { ...r.record, input: { title: "はじめの記事", subtitle: "補足", views: 1234 } },
      },
    ],
  });
  const names = screen.getAllByRole("columnheader").map((h) => h.textContent ?? "");
  expect(names.filter((t) => t !== "")).toEqual([
    "タイトル",
    "副題",
    "views",
    "公開",
    "ステータス",
    "更新",
  ]);
  const subtitle = screen.getByRole("columnheader", { name: "副題" });
  expect(subtitle).not.toHaveAttribute("aria-sort");
  // 狭い画面で隠す列(ステータス)と同じクラス = hideOnNarrow。タイトルとは違う
  const status = screen.getByRole("columnheader", { name: "ステータス" });
  expect(subtitle.className).toBe(status.className);
  const title = screen.getByRole("columnheader", { name: /タイトル/ });
  expect(subtitle.className).not.toBe(title.className);
  expect(screen.getByText("補足")).toHaveAttribute("title", "補足");
  expect(screen.getByText((1234).toLocaleString("ja-JP"))).toBeInTheDocument();
});

it("slug の追加列は等幅のクラスが付く", () => {
  const r = row("r1", "はじめの記事");
  setup({
    contentType: { ...baseType, listColumns: ["slug", "subtitle"] },
    rows: [
      { ...r, record: { ...r.record, input: { title: "t", slug: "hello", subtitle: "補足" } } },
    ],
  });
  expect(screen.getByText("hello").className).not.toBe(screen.getByText("補足").className);
});
