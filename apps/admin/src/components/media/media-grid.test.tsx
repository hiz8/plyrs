import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import type { UploadEntry } from "../../lib/use-uploads";
import { mediaRow, MEDIA_ID_A, MEDIA_ID_B } from "../../test-utils/media-rows";
import { MediaGrid, type MediaGridProps } from "./media-grid";

const rows = [
  mediaRow(MEDIA_ID_A, { filename: "a.png", content_type: "image/png" }),
  mediaRow(MEDIA_ID_B, { filename: "b.pdf", content_type: "application/pdf" }),
];

function setup(over: Partial<MediaGridProps> = {}) {
  const props: MediaGridProps = {
    rows,
    resolveUrl: vi.fn().mockResolvedValue("blob:x"),
    orphanIds: new Set([MEDIA_ID_B]),
    uploads: [],
    onRetryUpload: vi.fn(),
    onRemoveUpload: vi.fn(),
    selection: undefined,
    onOpen: vi.fn(),
    showDropHint: false,
    ...over,
  };
  render(<MediaGrid {...props} />);
  return props;
}

it("行をタイルで描き、未使用にバッジ、タイルを押すと onOpen", async () => {
  const props = setup();
  const grid = screen.getByRole("grid", { name: "メディアの一覧" });
  expect(within(grid).getAllByRole("row")).toHaveLength(2);
  expect(within(grid).getByText("未使用")).toBeInTheDocument();
  await userEvent.click(within(grid).getByText("a.png"));
  expect(props.onOpen).toHaveBeenCalledWith(MEDIA_ID_A);
});

it("orphanIds が null ならバッジを出さない", () => {
  setup({ orphanIds: null });
  expect(screen.queryByText("未使用")).toBeNull();
});

it("仮タイルを先頭に描き、再試行と取り除くがコールバックを呼ぶ", async () => {
  const failed: UploadEntry = {
    key: "k1",
    item: { file: new File(["x"], "bad.png"), status: "failed", reason: "error" },
  };
  const rejected: UploadEntry = {
    key: "k2",
    item: {
      file: new File(["x"], "big.png"),
      status: "failed",
      reason: "too_large",
    },
  };
  const props = setup({ uploads: [failed, rejected] });
  expect(screen.getByText("bad.png")).toBeInTheDocument();
  expect(screen.getByText("アップロードできませんでした")).toBeInTheDocument();
  expect(screen.getByText("20 MB を超えるファイルはアップロードできません")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: /再試行/ }));
  expect(props.onRetryUpload).toHaveBeenCalledWith("k1");
  await userEvent.click(screen.getByRole("button", { name: /取り除く/ }));
  expect(props.onRemoveUpload).toHaveBeenCalledWith("k2");
});

it("selection が無ければチェックボックスとドロップ案内が無い", () => {
  setup({ showDropHint: false });
  expect(screen.queryByRole("checkbox")).toBeNull();
  expect(screen.queryByText(/ドロップしてアップロード/)).toBeNull();
});

it("selection があればチェックボックスで選べ、showDropHint で案内が出る", async () => {
  const onSelectionChange = vi.fn();
  setup({
    selection: { selectedKeys: new Set(), onSelectionChange, isDisabled: false },
    showDropHint: true,
  });
  expect(screen.getByText(/ドロップしてアップロード/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole("checkbox", { name: /a\.png/ }));
  expect(onSelectionChange).toHaveBeenCalledWith(new Set([MEDIA_ID_A]));
});

it("selection.isDisabled なら全ての行が aria-disabled になる", () => {
  setup({
    selection: { selectedKeys: new Set(), onSelectionChange: vi.fn(), isDisabled: true },
  });
  const tileRows = within(screen.getByRole("grid", { name: "メディアの一覧" })).getAllByRole("row");
  expect(tileRows).toHaveLength(2);
  for (const row of tileRows) expect(row).toHaveAttribute("aria-disabled", "true");
});
