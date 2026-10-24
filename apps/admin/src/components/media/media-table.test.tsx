import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { mediaRow, MEDIA_ID_A, MEDIA_ID_B } from "../../test-utils/media-rows";
import { MediaTable, type MediaTableProps } from "./media-table";

const rows = [
  mediaRow(MEDIA_ID_A, {
    filename: "a.png",
    content_type: "image/png",
    size: 2048,
    alt: "夕日の写真",
  }),
  mediaRow(MEDIA_ID_B, { filename: "b.pdf", content_type: "application/pdf", size: 100 }),
];

function setup(over: Partial<MediaTableProps> = {}) {
  const props: MediaTableProps = {
    detailHref: (id) => `/t/blog/media/${id}?sort=name`,
    rows,
    resolveUrl: vi.fn().mockResolvedValue("blob:x"),
    orphanIds: new Set([MEDIA_ID_B]),
    selection: undefined,
    now: new Date("2026-10-24T00:00:00Z"),
    ...over,
  };
  render(<MediaTable {...props} />);
  return props;
}

it("行にサムネイル・ファイル名のリンク・代替テキスト・種類・サイズ・日時・使用状況を出す", () => {
  setup();
  const table = screen.getByRole("grid", { name: "メディアの一覧" });
  expect(within(table).getByRole("columnheader", { name: "サムネイル" })).toBeInTheDocument();
  const link = within(table).getByRole("link", { name: "a.png" });
  expect(link).toHaveAttribute("href", `/t/blog/media/${MEDIA_ID_A}?sort=name`);
  expect(within(table).getByText("夕日の写真")).toBeInTheDocument();
  expect(within(table).getByText("代替テキストなし")).toBeInTheDocument();
  expect(within(table).getByText("画像")).toBeInTheDocument();
  // 種類の列とサムネイルの拡張子タグの 2 つ
  expect(within(table).getAllByText("PDF")).toHaveLength(2);
  expect(within(table).getByText("2.0 KB")).toBeInTheDocument();
  expect(within(table).getByText("使用中")).toBeInTheDocument();
  expect(within(table).getByText("未使用")).toBeInTheDocument();
  expect(within(table).getAllByRole("time").length).toBeGreaterThan(0);
});

it("orphanIds が null なら使用状況は —、selection が無ければ選択列が無い", () => {
  setup({ orphanIds: null });
  expect(screen.queryByText("使用中")).toBeNull();
  expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(2);
  expect(screen.queryByRole("checkbox")).toBeNull();
});

it("selection があれば選択列が出る", () => {
  setup({
    selection: { selectedKeys: new Set(), onSelectionChange: vi.fn(), isDisabled: false },
  });
  expect(screen.getAllByRole("checkbox")).toHaveLength(3);
});

it("ファイル名のリンクを押すと onBeforeOpen が呼ばれる(F29)", () => {
  const onBeforeOpen = vi.fn();
  setup({ onBeforeOpen });
  fireEvent.click(screen.getByRole("link", { name: "a.png" }));
  expect(onBeforeOpen).toHaveBeenCalledOnce();
});

it("selection.isDisabled なら全てのデータ行が aria-disabled になる", () => {
  setup({
    selection: { selectedKeys: new Set(), onSelectionChange: vi.fn(), isDisabled: true },
  });
  const table = screen.getByRole("grid", { name: "メディアの一覧" });
  const bodyRows = within(table)
    .getAllByRole("row")
    .filter((row) => within(row).queryAllByRole("columnheader").length === 0);
  expect(bodyRows).toHaveLength(2);
  for (const row of bodyRows) expect(row).toHaveAttribute("aria-disabled", "true");
});
