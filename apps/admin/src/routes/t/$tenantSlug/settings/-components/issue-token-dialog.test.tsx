import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { TOKEN_LABELS } from "../-lib/settings-labels";
import { IssueTokenDialog } from "./issue-token-dialog";

// M1-4: 発行ダイアログ。名前・スコープ・期限を入れて発行し、発行直後だけ token を見せる

function renderDialog(
  role: "owner" | "editor" = "owner",
  issued: { token: string; expiresAt: string } | null = null,
  onSubmit = vi.fn(),
) {
  render(
    <IssueTokenDialog
      isOpen
      role={role}
      issued={issued}
      onOpenChange={vi.fn()}
      onSubmit={onSubmit}
      isPending={false}
      failure={null}
    />,
  );
  return onSubmit;
}

it("管理者には record:publish の箱が出るが既定では外れていて、発行すると名前・スコープ・期限を渡す", async () => {
  const user = userEvent.setup();
  const onSubmit = renderDialog("owner");
  const publish = screen.getByRole("checkbox", { name: TOKEN_LABELS.scopes["record:publish"] });
  expect(publish).not.toBeChecked();
  expect(screen.getByRole("checkbox", { name: TOKEN_LABELS.scopes["record:read"] })).toBeChecked();
  // M5c の申し送り(2026-11-08): 提案は既定で付ける。提案は書き込みの一種なので期限は書き込みの規則(既定 30 日)
  expect(
    screen.getByRole("checkbox", { name: TOKEN_LABELS.scopes["record:propose"] }),
  ).toBeChecked();
  const submit = screen.getByRole("button", { name: TOKEN_LABELS.issueDialog.submit });
  expect(submit).toBeDisabled();
  await user.type(screen.getByRole("textbox", { name: TOKEN_LABELS.issueDialog.name }), "CI");
  await user.click(submit);
  expect(onSubmit).toHaveBeenCalledWith({
    name: "CI",
    scopes: ["record:read", "record:propose"],
    expiresInDays: 30,
  });
});

it("読み取りだけに絞ると期限の既定が 90 日になり、書き込みを足すと 30 日に戻る", async () => {
  const user = userEvent.setup();
  const onSubmit = renderDialog("owner");
  await user.type(screen.getByRole("textbox", { name: TOKEN_LABELS.issueDialog.name }), "bot");
  await user.click(screen.getByRole("checkbox", { name: TOKEN_LABELS.scopes["record:propose"] }));
  expect(screen.queryByText(TOKEN_LABELS.issueDialog.writeExpiryNote)).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: TOKEN_LABELS.issueDialog.submit }));
  expect(onSubmit).toHaveBeenLastCalledWith({
    name: "bot",
    scopes: ["record:read"],
    expiresInDays: 90,
  });
  await user.click(screen.getByRole("checkbox", { name: TOKEN_LABELS.scopes["record:write"] }));
  expect(screen.getByText(TOKEN_LABELS.issueDialog.writeExpiryNote)).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: TOKEN_LABELS.issueDialog.submit }));
  expect(onSubmit).toHaveBeenLastCalledWith({
    name: "bot",
    scopes: ["record:read", "record:write"],
    expiresInDays: 30,
  });
});

it("record:write を付けて record:propose を外すと、提案に回れなくなる旨を出す(付け直すと消える)", async () => {
  const user = userEvent.setup();
  renderDialog("owner");
  const propose = screen.getByRole("checkbox", { name: TOKEN_LABELS.scopes["record:propose"] });
  await user.click(screen.getByRole("checkbox", { name: TOKEN_LABELS.scopes["record:write"] }));
  expect(screen.queryByText(TOKEN_LABELS.issueDialog.noProposeNote)).not.toBeInTheDocument();
  await user.click(propose);
  expect(screen.getByText(TOKEN_LABELS.issueDialog.noProposeNote)).toBeInTheDocument();
  await user.click(propose);
  expect(screen.queryByText(TOKEN_LABELS.issueDialog.noProposeNote)).not.toBeInTheDocument();
});

it("record:write が無ければ record:propose を外しても注意は出ない", async () => {
  const user = userEvent.setup();
  renderDialog("owner");
  await user.click(screen.getByRole("checkbox", { name: TOKEN_LABELS.scopes["record:propose"] }));
  expect(screen.queryByText(TOKEN_LABELS.issueDialog.noProposeNote)).not.toBeInTheDocument();
});

it("管理者以外には record:publish の箱を出さない", () => {
  renderDialog("editor");
  expect(
    screen.queryByRole("checkbox", { name: TOKEN_LABELS.scopes["record:publish"] }),
  ).not.toBeInTheDocument();
});

it("発行直後は token を 1 回だけ表示してコピーでき、閉じると二度と見られない旨を出す", () => {
  renderDialog("owner", { token: "plyrs_pat_abc", expiresAt: "2026-12-01T00:00:00Z" });
  expect(screen.getByText("plyrs_pat_abc")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: TOKEN_LABELS.issued.copy })).toBeInTheDocument();
  expect(screen.getByText(TOKEN_LABELS.issued.onceWarning)).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: TOKEN_LABELS.issueDialog.submit }),
  ).not.toBeInTheDocument();
});
