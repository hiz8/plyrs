import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { MediaBulkBar, type MediaBulkBarProps } from "./media-bulk-bar";

function setup(over: Partial<MediaBulkBarProps> = {}) {
  const props: MediaBulkBarProps = {
    selectedCount: 3,
    totalCount: 20,
    onSelectAll: vi.fn(),
    onClear: vi.fn(),
    onDelete: vi.fn(),
    progress: null,
    failure: null,
    ...over,
  };
  render(<MediaBulkBar {...props} />);
  return props;
}

it("選択中の件数と削除・すべてを選択・解除、進行中は進捗と中止", async () => {
  const props = setup();
  expect(screen.getByText("3 件を選択中")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "削除" }));
  expect(props.onDelete).toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "20 件すべてを選択" }));
  expect(props.onSelectAll).toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "選択を解除" }));
  expect(props.onClear).toHaveBeenCalled();
});

it("実行中は進捗バーと「残りを中止」を出し aria-busy", async () => {
  const onCancel = vi.fn();
  setup({ progress: { done: 2, total: 5, onCancel } });
  expect(screen.getByRole("region", { name: "一括操作" })).toHaveAttribute("aria-busy", "true");
  expect(screen.getByRole("progressbar")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "削除" })).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "残りを中止" }));
  expect(onCancel).toHaveBeenCalled();
});

it("失敗があれば「削除をもう一度試す」を出す", async () => {
  const onRetry = vi.fn();
  setup({ failure: { onRetry } });
  await userEvent.click(screen.getByRole("button", { name: "削除をもう一度試す" }));
  expect(onRetry).toHaveBeenCalled();
});
