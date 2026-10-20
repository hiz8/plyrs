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

it("already_member の文は入力欄と aria-describedby で結ばれる", () => {
  renderDialog({ kind: "already_member" });
  const input = screen.getByRole("textbox", { name: MEMBER_LABELS.addDialog.email });
  const message = screen.getByText(MEMBER_LABELS.addDialog.alreadyMember);
  expect(input.getAttribute("aria-describedby")?.split(" ")).toContain(message.id);
});

it("other は role=alert で message を出す", () => {
  renderDialog({ kind: "other", message: "通信に失敗しました" });
  expect(screen.getByRole("alert")).toHaveTextContent("通信に失敗しました");
});

it("URL をコピーを押すと signupUrl を clipboard に書く", async () => {
  const user = userEvent.setup();
  const writeText = vi.fn().mockResolvedValue(undefined);
  // userEvent.setup() が clipboard を差し替えるので、その後に自前のものを載せる
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  renderDialog({ kind: "unregistered" });
  await user.click(screen.getByRole("button", { name: MEMBER_LABELS.addDialog.copyUrl }));
  expect(writeText).toHaveBeenCalledWith("https://app.example.com/signup");
  Reflect.deleteProperty(navigator, "clipboard");
});

it("失敗の表示中にメール欄へ入力すると onClearFailure を呼ぶ", async () => {
  const onClearFailure = vi.fn();
  render(
    <AddMemberDialog
      isOpen
      onOpenChange={vi.fn()}
      onSubmit={vi.fn()}
      isPending={false}
      failure={{ kind: "already_member" }}
      onClearFailure={onClearFailure}
      signupUrl="https://app.example.com/signup"
    />,
  );
  await userEvent
    .setup()
    .type(screen.getByRole("textbox", { name: MEMBER_LABELS.addDialog.email }), "a");
  expect(onClearFailure).toHaveBeenCalled();
});
