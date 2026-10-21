import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { Button } from "./button";
import { acceptsFile, collectDroppedFiles, DropZone } from "./drop-zone";

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

const png = new File(["x"], "a.PNG", { type: "image/png" });
const exe = new File(["x"], "b.exe", { type: "application/x-msdownload" });

it("acceptsFile は MIME 完全一致・type/*・拡張子(大文字小文字無視)・undefined を扱う", () => {
  expect(acceptsFile(exe, undefined)).toBe(true);
  expect(acceptsFile(png, ["image/png"])).toBe(true);
  expect(acceptsFile(png, ["image/jpeg"])).toBe(false);
  expect(acceptsFile(png, ["image/*"])).toBe(true);
  expect(acceptsFile(exe, ["image/*"])).toBe(false);
  expect(acceptsFile(png, [".png"])).toBe(true);
  expect(acceptsFile(png, [".pdf", ".PNG"])).toBe(true);
  expect(acceptsFile(exe, [".png"])).toBe(false);
});

it("collectDroppedFiles は非ファイルを除き、種類で絞り、単数なら先頭 1 件にする", async () => {
  const png2 = new File(["y"], "c.png", { type: "image/png" });
  const items = [
    { kind: "text" },
    { kind: "file", getFile: async () => png },
    { kind: "file", getFile: async () => exe },
    { kind: "file", getFile: async () => png2 },
  ];
  expect(await collectDroppedFiles(items, undefined, true)).toEqual([png, exe, png2]);
  expect(await collectDroppedFiles(items, ["image/*"], true)).toEqual([png, png2]);
  expect(await collectDroppedFiles(items, ["image/*"], false)).toEqual([png]);
});

it("選択経路でも acceptedFileTypes に合わないファイルは渡さない", async () => {
  const onFiles = vi.fn();
  const { container } = render(<DropZone onFiles={onFiles} acceptedFileTypes={["image/*"]} />);
  const input = container.ownerDocument.querySelector<HTMLInputElement>("input[type='file']");
  await userEvent.upload(input as HTMLInputElement, [png, exe], { applyAccept: false });
  expect(onFiles).toHaveBeenCalledWith([png]);
  onFiles.mockClear();
  await userEvent.upload(input as HTMLInputElement, exe, { applyAccept: false });
  expect(onFiles).not.toHaveBeenCalled();
});

it("isDisabled のときボタンは無効", () => {
  render(<DropZone onFiles={vi.fn()} isDisabled />);
  expect(screen.getByRole("button", { name: "ファイルを選択" })).toBeDisabled();
});

it("無効時は外枠だけを薄くし、中のボタンに opacity を重ねない", () => {
  const { unmount } = render(
    <Button variant="secondary" isDisabled>
      ファイルを選択
    </Button>,
  );
  const standalone = screen.getByRole("button", { name: "ファイルを選択" }).className.split(" ");
  unmount();
  render(<DropZone onFiles={vi.fn()} isDisabled />);
  const button = screen.getByRole("button", { name: "ファイルを選択" });
  expect(button).toBeDisabled();
  // 単体の無効ボタンとの差は opacity の 1 クラスだけ(cursor: not-allowed は残す)
  const inner = button.className.split(" ");
  expect(standalone.filter((name) => !inner.includes(name))).toHaveLength(1);
  expect(inner.filter((name) => !standalone.includes(name))).toHaveLength(0);
});

const classOf = (isFill: boolean) => {
  const { unmount } = render(<DropZone onFiles={() => {}} isFill={isFill} />);
  expect(screen.getByText("ここにファイルをドロップ")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "ファイルを選択" })).toBeInTheDocument();
  const cls = screen.getByText("ここにファイルをドロップ").parentElement?.className ?? "";
  unmount();
  return cls;
};

it("isFill は外枠に別のクラスを足し、ボタンと文言は同じ", () => {
  const normal = classOf(false);
  const fill = classOf(true);
  expect(fill).not.toBe(normal);
  expect(fill.split(" ").length).toBeGreaterThan(normal.split(" ").length);
});
