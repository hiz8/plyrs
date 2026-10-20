import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { AccountMenu } from "./account-menu";

it("「アカウント設定」が先頭にあり、押すと onOpenAccount を呼ぶ", async () => {
  const onOpenAccount = vi.fn();
  const user = userEvent.setup();
  render(
    <AccountMenu
      email="a@example.com"
      canSwitchSite
      onOpenAccount={onOpenAccount}
      onOpenSiteList={vi.fn()}
      onLogout={vi.fn()}
    />,
  );
  await user.click(screen.getByRole("button", { name: "アカウント" }));
  const items = await screen.findAllByRole("menuitem");
  expect(items.map((item) => item.textContent)).toEqual([
    "アカウント設定",
    "サイトを切り替え",
    "ログアウト",
  ]);
  await user.click(items[0] as HTMLElement);
  expect(onOpenAccount).toHaveBeenCalledTimes(1);
});

it("サイトが 1 つなら「サイトを切り替え」を出さない", async () => {
  const user = userEvent.setup();
  render(
    <AccountMenu
      email="a@example.com"
      canSwitchSite={false}
      onOpenAccount={vi.fn()}
      onOpenSiteList={vi.fn()}
      onLogout={vi.fn()}
    />,
  );
  await user.click(screen.getByRole("button", { name: "アカウント" }));
  const items = await screen.findAllByRole("menuitem");
  expect(items.map((item) => item.textContent)).toEqual(["アカウント設定", "ログアウト"]);
});
