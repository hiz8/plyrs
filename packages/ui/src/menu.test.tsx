import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Ellipsis, Pencil, Trash2 } from "lucide-react";
import { expect, it, vi } from "vitest";
import { IconButton } from "./button";
import { Menu, MenuItem, MenuSection, MenuSeparator } from "./menu";

it("トリガーで開き、選んだ項目の id を onAction に渡す。無効の項目は選べない", async () => {
  const user = userEvent.setup();
  const onAction = vi.fn();
  render(
    <Menu
      label="行の操作"
      trigger={<IconButton icon={Ellipsis} label="その他" />}
      onAction={onAction}
    >
      <MenuSection title="お知らせ">
        <MenuItem id="edit" icon={Pencil}>
          編集
        </MenuItem>
        <MenuItem id="unpublish" isDisabled>
          公開を取り下げる
        </MenuItem>
      </MenuSection>
      <MenuSeparator />
      <MenuItem id="delete" icon={Trash2} tone="danger">
        削除
      </MenuItem>
    </Menu>,
  );
  await user.click(screen.getByRole("button", { name: "その他" }));
  const menu = await screen.findByRole("menu", { name: "行の操作" });
  expect(menu).toHaveTextContent("お知らせ");
  expect(screen.getByRole("menuitem", { name: "公開を取り下げる" })).toHaveAttribute(
    "aria-disabled",
    "true",
  );
  await user.click(screen.getByRole("menuitem", { name: "削除" }));
  expect(onAction).toHaveBeenCalledWith("delete");
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
});
