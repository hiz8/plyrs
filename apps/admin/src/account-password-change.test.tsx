import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { jsonResponse } from "./test-utils/api-stubs";
import { authedRoutes, renderAt } from "./test-utils/shell-harness";

it("パスワードを変更すると POST /auth/password を呼び、入力が空に戻ってトーストが出る", async () => {
  const post = vi.fn((_init?: RequestInit) => jsonResponse(200, { ok: true, revokedSessions: 2 }));
  renderAt("/t/blog/account", authedRoutes({ "/auth/password": post }));
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText("現在のパスワード"), "old-password");
  await user.type(
    screen.getByLabelText("新しいパスワード", { selector: "input" }),
    "brand-new-password",
  );
  await user.type(screen.getByLabelText("新しいパスワード(確認)"), "brand-new-password");
  await user.click(screen.getByRole("button", { name: "パスワードを変更" }));
  await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
  expect(JSON.parse(String(post.mock.calls[0]?.[0]?.body))).toStrictEqual({
    currentPassword: "old-password",
    newPassword: "brand-new-password",
  });
  expect(
    await within(screen.getByRole("region", { name: "通知" })).findByText(
      "パスワードを変更しました。他の端末 2 件をログアウトしました",
    ),
  ).toBeInTheDocument();
  await waitFor(() => expect(screen.getByLabelText("現在のパスワード")).toHaveValue(""));
});
