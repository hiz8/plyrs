import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { UploadTile } from "./upload-tile";

it("5 つの状態を描き、再試行と取り除くがコールバックを呼ぶ", async () => {
  const onRetry = vi.fn();
  const onRemove = vi.fn();
  const { rerender } = render(<UploadTile name="a.png" state={{ kind: "queued" }} />);
  expect(screen.getByRole("group", { name: "a.png" })).toBeInTheDocument();
  expect(screen.getByText("順番待ち")).toBeInTheDocument();

  rerender(<UploadTile name="a.png" state={{ kind: "uploading" }} />);
  expect(screen.getByText("送信しています…", { selector: "[aria-live]" })).toBeInTheDocument();

  rerender(
    <UploadTile name="a.png" state={{ kind: "failed", message: "送信に失敗しました", onRetry }} />,
  );
  expect(screen.getByRole("alert")).toHaveTextContent("送信に失敗しました");
  await userEvent.click(screen.getByRole("button", { name: "再試行" }));
  expect(onRetry).toHaveBeenCalledTimes(1);

  rerender(
    <UploadTile
      name="a.png"
      state={{ kind: "rejected", message: "20 MB を超えています", detail: "24.8 MB", onRemove }}
    />,
  );
  expect(screen.getByRole("alert")).toHaveTextContent("20 MB を超えています");
  expect(screen.getByText("24.8 MB")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "取り除く" }));
  expect(onRemove).toHaveBeenCalledTimes(1);

  rerender(
    <UploadTile name="a.png" state={{ kind: "done" }} thumb={<img alt="" src="/a.png" />} />,
  );
  expect(screen.getByText("完了")).toBeInTheDocument();
});
