import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { MEMBER_LABELS, ROLE_DESCRIPTIONS } from "../../lib/labels";
import { AddMemberDialog, type AddMemberFailure } from "./add-member-dialog";

function renderDialog(failure: AddMemberFailure = null, onSubmit = vi.fn()) {
  render(
    <AddMemberDialog
      isOpen
      onOpenChange={vi.fn()}
      onSubmit={onSubmit}
      isPending={false}
      failure={failure}
      signupUrl="https://app.example.com/signup"
    />,
  );
  return onSubmit;
}

it("メールとロールを入れて追加するを押すと onSubmit を呼ぶ", async () => {
  const user = userEvent.setup();
  const onSubmit = renderDialog();
  const submit = screen.getByRole("button", { name: MEMBER_LABELS.addDialog.submit });
  expect(submit).toBeDisabled();
  await user.type(screen.getByRole("textbox", { name: MEMBER_LABELS.addDialog.email }), "a@b.co");
  await user.click(submit);
  expect(onSubmit).toHaveBeenCalledWith("a@b.co", "editor");
});

it("未登録の案内はサインアップ URL とコピーを出す", () => {
  renderDialog({ kind: "unregistered" });
  expect(screen.getByRole("alert")).toHaveTextContent(MEMBER_LABELS.addDialog.unregistered);
  expect(screen.getByText("https://app.example.com/signup")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: MEMBER_LABELS.addDialog.copyUrl })).toBeInTheDocument();
  expect(screen.getByText(MEMBER_LABELS.addDialog.unregisteredHint)).toBeInTheDocument();
});

it("already_member は入力欄の下の文を出す", () => {
  renderDialog({ kind: "already_member" });
  expect(screen.getByText(MEMBER_LABELS.addDialog.alreadyMember)).toBeInTheDocument();
});

it("ロールを変えると説明が入れ替わる", async () => {
  const user = userEvent.setup();
  renderDialog();
  expect(screen.getByText(ROLE_DESCRIPTIONS.editor)).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: /ロール/ }));
  await user.click(await screen.findByRole("option", { name: "閲覧者" }));
  expect(screen.getByText(ROLE_DESCRIPTIONS.viewer)).toBeInTheDocument();
  expect(screen.queryByText(ROLE_DESCRIPTIONS.editor)).not.toBeInTheDocument();
});
