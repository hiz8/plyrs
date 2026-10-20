import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { BulkBar, type BulkBarProps } from "./bulk-bar";

function setup(over: Partial<BulkBarProps> = {}) {
  const props: BulkBarProps = {
    selectedCount: 3,
    pageCount: 20,
    onSelectPage: vi.fn(),
    onClear: vi.fn(),
    onAction: vi.fn(),
    progress: null,
    failure: null,
    ...over,
  };
  render(<BulkBar {...props} />);
  return props;
}

it("メニューの「公開」で onAction({ kind: 'publish' })、「ステータスを変更」の「下書き」で status", async () => {
  const props = setup();
  expect(screen.getByText("3 件を選択中")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "一括操作" }));
  await userEvent.click(screen.getByRole("menuitem", { name: "公開" }));
  expect(props.onAction).toHaveBeenCalledWith({ kind: "publish" });
  await userEvent.click(screen.getByRole("button", { name: "一括操作" }));
  await userEvent.click(screen.getByRole("menuitem", { name: "下書き" }));
  expect(props.onAction).toHaveBeenLastCalledWith({ kind: "status", status: "draft" });
});

it("実行中は進捗バーと「残りを中止」を出し aria-busy", async () => {
  const onCancel = vi.fn();
  setup({ progress: { kind: "publish", done: 2, total: 5, onCancel } });
  expect(screen.getByRole("region", { name: "一括操作" })).toHaveAttribute("aria-busy", "true");
  expect(screen.getByRole("progressbar")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "一括操作" })).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "残りを中止" }));
  expect(onCancel).toHaveBeenCalled();
});

it("一部失敗は「公開をもう一度試す」を出す", async () => {
  const onRetry = vi.fn();
  setup({ failure: { kind: "publish", onRetry } });
  expect(screen.getByText("(失敗したもの)")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /このページの/ })).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "公開をもう一度試す" }));
  expect(onRetry).toHaveBeenCalled();
});

it("実行中の文言は progressbar の名前として 1 回だけ読み上げる", () => {
  setup({ progress: { kind: "publish", done: 2, total: 8, onCancel: vi.fn() } });
  expect(screen.getByRole("progressbar", { name: "公開しています…" })).toBeInTheDocument();
  // Spinner の見た目の文字だけ(aria-hidden)
  expect(screen.getAllByText("公開しています…")).toHaveLength(1);
});
