import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { RejectProposalDialog } from "./resolve-dialogs";

// 16.8(M5c): 却下の理由は API の上限 500 字。超えたら送らずに欄の下で知らせる

it("理由が 500 字を超えると送らず、欄の下にエラーを出す", async () => {
  const onConfirm = vi.fn();
  render(
    <RejectProposalDialog isOpen onOpenChange={() => {}} isPending={false} onConfirm={onConfirm} />,
  );
  const user = userEvent.setup();
  const reason = screen.getByRole("textbox", { name: "理由(任意)" });
  await user.click(reason);
  await user.paste("あ".repeat(501));
  await user.click(screen.getByRole("button", { name: "却下する" }));
  expect(onConfirm).not.toHaveBeenCalled();
  expect(screen.getByText("500 文字以内で入力してください")).toBeInTheDocument();
});
