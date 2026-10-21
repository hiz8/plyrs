import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Upload } from "lucide-react";
import { expect, it, vi } from "vitest";
import { FileButton } from "./file-button";

const input = () =>
  document.querySelector<HTMLInputElement>("input[type='file']") as HTMLInputElement;

it("ファイルを選ぶと onFiles に File の配列を渡し、同じファイルを続けて選べる", async () => {
  const onFiles = vi.fn();
  render(
    <FileButton onFiles={onFiles} icon={Upload}>
      追加
    </FileButton>,
  );
  expect(screen.getByRole("button", { name: "追加" })).toBeInTheDocument();
  const a = new File(["a"], "a.png", { type: "image/png" });
  const b = new File(["b"], "b.png", { type: "image/png" });
  await userEvent.upload(input(), [a, b]);
  expect(onFiles).toHaveBeenLastCalledWith([a, b]);
  expect(input().value).toBe("");
  await userEvent.upload(input(), a);
  expect(onFiles).toHaveBeenCalledTimes(2);
  expect(onFiles).toHaveBeenLastCalledWith([a]);
  expect(input().value).toBe("");
});

it("acceptedFileTypes に合わないファイルは渡さない", async () => {
  const onFiles = vi.fn();
  render(
    <FileButton onFiles={onFiles} acceptedFileTypes={["image/*"]}>
      追加
    </FileButton>,
  );
  const png = new File(["a"], "a.png", { type: "image/png" });
  const exe = new File(["b"], "b.exe", { type: "application/x-msdownload" });
  await userEvent.upload(input(), [png, exe], { applyAccept: false });
  expect(onFiles).toHaveBeenCalledWith([png]);
  onFiles.mockClear();
  await userEvent.upload(input(), exe, { applyAccept: false });
  expect(onFiles).not.toHaveBeenCalled();
});

it("isDisabled のときボタンは無効", () => {
  render(
    <FileButton onFiles={() => {}} isDisabled>
      追加
    </FileButton>,
  );
  expect(screen.getByRole("button", { name: "追加" })).toBeDisabled();
});
