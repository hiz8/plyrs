import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RotateCw } from "lucide-react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastRegion, createToaster } from "./toast";

afterEach(() => {
  vi.useRealTimers();
});

describe("トースト(h-common-surface.md 11 章)", () => {
  it("成功は status で読み上げ、5 秒で消える", () => {
    vi.useFakeTimers();
    const toaster = createToaster();
    render(<ToastRegion toaster={toaster} />);
    act(() => {
      toaster.success("公開しました");
    });
    expect(screen.getByRole("status")).toHaveTextContent("公開しました");
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(screen.queryByText("公開しました")).not.toBeInTheDocument();
  });

  it("エラーは alert で、閉じるまで残り、操作を押すと実行して閉じる", async () => {
    const user = userEvent.setup();
    const toaster = createToaster();
    const onAction = vi.fn();
    render(<ToastRegion toaster={toaster} />);
    act(() => {
      toaster.error("公開できませんでした", { label: "再試行", icon: RotateCw, onAction });
    });
    expect(screen.getByRole("alert")).toHaveTextContent("公開できませんでした");
    await user.click(screen.getByRole("button", { name: "再試行" }));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("公開できませんでした")).not.toBeInTheDocument();
  });

  it("閉じるボタンで閉じる", async () => {
    const user = userEvent.setup();
    const toaster = createToaster();
    render(<ToastRegion toaster={toaster} />);
    act(() => {
      toaster.error("削除できませんでした");
    });
    await user.click(screen.getByRole("button", { name: "閉じる" }));
    expect(screen.queryByText("削除できませんでした")).not.toBeInTheDocument();
  });

  it("別々に作ったトーストは互いに見えない", () => {
    const first = createToaster();
    const second = createToaster();
    render(<ToastRegion toaster={second} />);
    act(() => {
      first.success("A");
    });
    expect(screen.queryByText("A")).not.toBeInTheDocument();
  });
});
