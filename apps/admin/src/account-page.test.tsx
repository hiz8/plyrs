import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { baseAuthedRoutes, jsonResponse } from "./test-utils/api-stubs";
import { authedRoutes, renderAt } from "./test-utils/shell-harness";

// 成功のトーストを出すテストは account-password-change.test.tsx に分ける
// (トーストが残った後の同じファイルの次のテストで jsdom が戻らなくなるため)
afterEach(() => {
  localStorage.clear();
  document.documentElement.style.colorScheme = "";
});

describe("アカウント設定", () => {
  it("h1「アカウント設定」と 4 枚のカード(メール・パスワード・テーマ・所属サイト)が出る", async () => {
    renderAt("/t/blog/account", authedRoutes());
    expect(
      await screen.findByRole("heading", { level: 1, name: "アカウント設定" }),
    ).toBeInTheDocument();
    for (const name of ["メールアドレス", "パスワードの変更", "テーマ", "所属しているサイト"]) {
      expect(await screen.findByRole("region", { name })).toBeInTheDocument();
    }
    expect(await screen.findByText("owner@example.com", { selector: "p" })).toBeInTheDocument();
    expect(await screen.findByText("現在のサイト")).toBeInTheDocument();
  });

  it("現在のパスワードが違うと現在のパスワード欄の下に文が出て入力は残る", async () => {
    const post = vi.fn(() => jsonResponse(403, { error: "wrong_password" }));
    const router = renderAt("/t/blog/account", authedRoutes({ "/auth/password": post }));
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("現在のパスワード"), "old-password");
    await user.type(
      screen.getByLabelText("新しいパスワード", { selector: "input" }),
      "brand-new-password",
    );
    await user.type(screen.getByLabelText("新しいパスワード(確認)"), "brand-new-password");
    await user.click(screen.getByRole("button", { name: "パスワードを変更" }));
    const message = await screen.findByText(/現在のパスワードが違います/);
    const field = screen.getByLabelText("現在のパスワード");
    expect(field.getAttribute("aria-describedby")).toContain(message.id);
    expect(field).toHaveValue("old-password");
    expect(router.state.location.pathname).toBe("/t/blog/account");
  });

  it("テーマを選ぶと colorScheme が変わる", async () => {
    renderAt("/t/blog/account", authedRoutes());
    await userEvent.setup().click(await screen.findByRole("radio", { name: "ダーク" }));
    expect(document.documentElement.style.colorScheme).toBe("dark");
  });

  it("閲覧者でも開ける", async () => {
    const contentTypes = authedRoutes()["/v1/t/t1/content-types"];
    renderAt(
      "/t/blog/account",
      baseAuthedRoutes(
        contentTypes === undefined ? {} : { "/v1/t/t1/content-types": contentTypes },
        "viewer",
      ),
    );
    expect(
      await screen.findByRole("heading", { level: 1, name: "アカウント設定" }),
    ).toBeInTheDocument();
  });
});
