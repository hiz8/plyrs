import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { FileDropTarget } from "./file-drop-target";

const file = new File(["x"], "a.png", { type: "image/png" });
const items = [{ kind: "file", type: "image/png", getAsFile: () => file }];

it("ドラッグが入ると暗幕と件数が出て、ドロップで onFiles に File を渡す", async () => {
  const onFiles = vi.fn();
  render(
    <FileDropTarget onFiles={onFiles} hint="1 ファイル 20 MB まで">
      <p data-testid="body">本文</p>
    </FileDropTarget>,
  );
  const target = screen.getByTestId("body").parentElement as HTMLElement;
  fireEvent.dragEnter(target, {
    dataTransfer: { items, types: ["Files"], effectAllowed: "all", dropEffect: "copy" },
  });
  const status = await screen.findByRole("status");
  expect(status).toHaveTextContent("ここに置くとアップロードします");
  expect(status).toHaveTextContent("1 ファイル ・ 1 ファイル 20 MB まで");
  fireEvent.drop(target, {
    dataTransfer: {
      items,
      files: [file],
      types: ["Files"],
      effectAllowed: "all",
      dropEffect: "copy",
    },
  });
  await waitFor(() => expect(onFiles).toHaveBeenCalledWith([file]));
  await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
});

it("isDisabled なら暗幕を出さず onFiles を呼ばない", () => {
  const onFiles = vi.fn();
  render(
    <FileDropTarget onFiles={onFiles} hint="x" isDisabled>
      <p data-testid="body">本文</p>
    </FileDropTarget>,
  );
  const target = screen.getByTestId("body").parentElement as HTMLElement;
  fireEvent.dragEnter(target, {
    dataTransfer: { items, types: ["Files"], effectAllowed: "all", dropEffect: "copy" },
  });
  fireEvent.drop(target, {
    dataTransfer: {
      items,
      files: [file],
      types: ["Files"],
      effectAllowed: "all",
      dropEffect: "copy",
    },
  });
  expect(screen.queryByRole("status")).toBeNull();
  expect(onFiles).not.toHaveBeenCalled();
});

it("relatedTarget 無しの dragLeave では件数を残す", async () => {
  render(
    <FileDropTarget onFiles={vi.fn()} hint="1 ファイル 20 MB まで">
      <p data-testid="body">本文</p>
    </FileDropTarget>,
  );
  const child = screen.getByTestId("body");
  const zone = child.parentElement as HTMLElement;
  const dataTransfer = { items, types: ["Files"], effectAllowed: "all", dropEffect: "copy" };
  fireEvent.dragEnter(zone, { dataTransfer });
  fireEvent.dragEnter(child, { dataTransfer });
  expect(await screen.findByRole("status")).toHaveTextContent("1 ファイル ・");
  // 子から離れる(relatedTarget 無し)。RAC は zone に居るので暗幕は残り、件数も残る
  fireEvent.dragLeave(child);
  expect(screen.getByRole("status")).toHaveTextContent("1 ファイル ・ 1 ファイル 20 MB まで");
});
