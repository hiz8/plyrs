import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { DropZone } from "./drop-zone";

it("ファイルを選ぶと onFiles に File の配列を渡す", async () => {
  const onFiles = vi.fn();
  const { container } = render(
    <DropZone onFiles={onFiles} description="画像・PDF・動画、1 ファイル 20 MB まで" />,
  );
  expect(screen.getByText("ここにファイルをドロップ")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "ファイルを選択" })).toBeInTheDocument();
  const input = container.ownerDocument.querySelector<HTMLInputElement>("input[type='file']");
  expect(input).not.toBeNull();
  const file = new File(["x"], "cover.png", { type: "image/png" });
  await userEvent.upload(input as HTMLInputElement, file);
  expect(onFiles).toHaveBeenCalledWith([file]);
});
