import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Ellipsis, Pencil, Trash2 } from "lucide-react";
import { expect, it, vi } from "vitest";
import { Button, IconButton } from "./button";
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

it("現在のサイトは名前に「(現在)」を含み、キーボードのフォーカスが来ると見た目が変わる", async () => {
  const user = userEvent.setup();
  render(
    <Menu
      label="サイト"
      trigger={<IconButton icon={Ellipsis} label="サイト切替" />}
      onAction={vi.fn()}
    >
      <MenuItem id="a" isCurrent>
        サイト A
      </MenuItem>
      <MenuItem id="b">サイト B</MenuItem>
    </Menu>,
  );
  screen.getByRole("button", { name: "サイト切替" }).focus();
  await user.keyboard("{Enter}");
  const current = await screen.findByRole("menuitem", { name: "サイト A(現在)" });
  expect(current).toHaveFocus();
  const focusedClass = current.className;
  await user.keyboard("{ArrowDown}");
  expect(screen.getByRole("menuitem", { name: "サイト B" })).toHaveFocus();
  expect(current.className).not.toBe(focusedClass);
});

it("detail は右に補足として出て、名前にも含まれる", async () => {
  render(
    <Menu trigger={<Button>サイト</Button>} label="サイトを切り替え" onAction={() => {}}>
      <MenuItem id="a" detail="管理者">
        Blog
      </MenuItem>
    </Menu>,
  );
  await userEvent.setup().click(screen.getByRole("button", { name: "サイト" }));
  expect(await screen.findByRole("menuitem", { name: "Blog 管理者" })).toBeInTheDocument();
});
