import { render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { MEMBER_LABELS } from "../../lib/labels";
import { DemoteMemberDialog, RemoveMemberDialog } from "./member-dialogs";

it("ロールを下げる確認は反映の遅れを案内し、自分なら設定を開けなくなる注記も出す", () => {
  render(
    <DemoteMemberDialog
      target={{ email: "me@example.com", to: "editor", isSelf: true }}
      otherOwners={["a@example.com", "b@example.com"]}
      onConfirm={vi.fn()}
      onCancel={vi.fn()}
      isPending={false}
    />,
  );
  expect(screen.getByText(MEMBER_LABELS.demote.title("me@example.com", "編集者"))).toBeVisible();
  expect(screen.getByText(MEMBER_LABELS.demote.toEditor)).toBeVisible();
  expect(screen.getByText(MEMBER_LABELS.demote.delay)).toBeVisible();
  expect(screen.getByText(MEMBER_LABELS.lockout("a@example.com、b@example.com"))).toBeVisible();
  expect(screen.getByRole("button", { name: "編集者にする" })).toBeVisible();
});

it("外す確認は自分なら危険色の「自分を外す」と他の管理者のメールを出す", () => {
  render(
    <RemoveMemberDialog
      target={{ email: "me@example.com", isSelf: true }}
      siteName="Blog"
      otherOwners={["a@example.com"]}
      onConfirm={vi.fn()}
      onCancel={vi.fn()}
      isPending={false}
    />,
  );
  expect(screen.getByText(MEMBER_LABELS.removeDialog.selfTitle)).toBeVisible();
  expect(
    screen.getByText(MEMBER_LABELS.removeDialog.selfBody("me@example.com", "Blog")),
  ).toBeVisible();
  expect(screen.getByText(MEMBER_LABELS.lockout("a@example.com"))).toBeVisible();
  expect(
    screen.getByRole("button", { name: MEMBER_LABELS.removeDialog.selfConfirm }),
  ).toBeVisible();
});

it("ロールを下げる確認は初期フォーカスが実行ボタンで、自分以外なら注記を出さない", async () => {
  render(
    <DemoteMemberDialog
      target={{ email: "x@example.com", to: "viewer", isSelf: false }}
      otherOwners={["a@example.com"]}
      onConfirm={vi.fn()}
      onCancel={vi.fn()}
      isPending={false}
    />,
  );
  expect(screen.getByText(MEMBER_LABELS.demote.toViewer)).toBeVisible();
  expect(screen.queryByText(MEMBER_LABELS.lockout("a@example.com"))).not.toBeInTheDocument();
  await waitFor(() => expect(screen.getByRole("button", { name: "閲覧者にする" })).toHaveFocus());
});

it("外す確認は自分以外ならメール入りの題と本文、初期フォーカスはキャンセル", async () => {
  render(
    <RemoveMemberDialog
      target={{ email: "x@example.com", isSelf: false }}
      siteName="Blog"
      otherOwners={["a@example.com"]}
      onConfirm={vi.fn()}
      onCancel={vi.fn()}
      isPending={false}
    />,
  );
  expect(screen.getByText(MEMBER_LABELS.removeDialog.title("x@example.com"))).toBeVisible();
  expect(screen.getByText(MEMBER_LABELS.removeDialog.body)).toBeVisible();
  expect(screen.getByRole("button", { name: MEMBER_LABELS.removeDialog.confirm })).toBeVisible();
  expect(screen.queryByText(MEMBER_LABELS.lockout("a@example.com"))).not.toBeInTheDocument();
  await waitFor(() => expect(screen.getByRole("button", { name: "キャンセル" })).toHaveFocus());
});

it("外す確認(自分)も初期フォーカスはキャンセル", async () => {
  render(
    <RemoveMemberDialog
      target={{ email: "me@example.com", isSelf: true }}
      siteName="Blog"
      otherOwners={["a@example.com"]}
      onConfirm={vi.fn()}
      onCancel={vi.fn()}
      isPending={false}
    />,
  );
  await waitFor(() => expect(screen.getByRole("button", { name: "キャンセル" })).toHaveFocus());
});
