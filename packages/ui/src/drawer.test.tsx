import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { Drawer } from "./drawer";

it("開くとダイアログとして名前が付き、Esc で閉じる", async () => {
  const onOpenChange = vi.fn();
  render(
    <Drawer isOpen onOpenChange={onOpenChange} label="メニュー">
      <a href="/x">項目</a>
    </Drawer>,
  );
  const dialog = await screen.findByRole("dialog", { name: "メニュー" });
  expect(dialog).toContainElement(screen.getByRole("link", { name: "項目" }));
  await userEvent.setup().keyboard("{Escape}");
  expect(onOpenChange).toHaveBeenCalledWith(false);
});

it("暗幕を押すと閉じる", async () => {
  const onOpenChange = vi.fn();
  render(
    <Drawer isOpen onOpenChange={onOpenChange} label="メニュー">
      <a href="/x">項目</a>
    </Drawer>,
  );
  const dialog = await screen.findByRole("dialog", { name: "メニュー" });
  // Dialog -> Modal -> ModalOverlay(暗幕)
  const overlay = dialog.parentElement?.parentElement;
  if (overlay == null) throw new Error("暗幕が見つからない");
  await userEvent.setup().click(overlay);
  expect(onOpenChange).toHaveBeenCalledWith(false);
});

it("閉じているときは何も描かない", () => {
  render(
    <Drawer isOpen={false} onOpenChange={() => {}} label="メニュー">
      x
    </Drawer>,
  );
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
