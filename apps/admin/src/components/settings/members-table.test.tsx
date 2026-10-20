import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import type { MemberSummary } from "../../lib/admin-api";
import { MEMBER_LABELS } from "../../lib/labels";
import type { MemberRow } from "../../lib/members";
import { MembersTable } from "./members-table";

const owner: MemberSummary = {
  userId: "u1",
  email: "owner@example.com",
  role: "owner",
  createdAt: "2026-01-02T00:00:00.000Z",
};
const editor: MemberSummary = {
  userId: "u2",
  email: "editor@example.com",
  role: "editor",
  createdAt: "2026-02-03T00:00:00.000Z",
};

const ownerRow: MemberRow = { member: owner, isSelf: true, isLastOwner: true };
const editorRow: MemberRow = { member: editor, isSelf: false, isLastOwner: false };

it("自分の行に「自分」の印、最後の管理者の行は操作の代わりに「最後の管理者」と理由", async () => {
  const user = userEvent.setup();
  render(<MembersTable rows={[ownerRow]} onChangeRole={vi.fn()} onRemove={vi.fn()} />);
  expect(screen.getByText(MEMBER_LABELS.self)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /を外す/ })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /のロール/ })).not.toBeInTheDocument();
  const last = screen.getByRole("button", { name: MEMBER_LABELS.lastOwner });
  await user.tab();
  act(() => last.focus());
  expect(last).toHaveFocus();
  expect(await screen.findByRole("tooltip")).toHaveTextContent(MEMBER_LABELS.lastOwnerReason);
});

it("ロールを選ぶと onChangeRole に Role を渡し、「外す」で onRemove", async () => {
  const user = userEvent.setup();
  const onChangeRole = vi.fn();
  const onRemove = vi.fn();
  render(<MembersTable rows={[editorRow]} onChangeRole={onChangeRole} onRemove={onRemove} />);
  await user.click(screen.getByRole("button", { name: /editor@example\.com.*のロール/ }));
  await user.click(await screen.findByRole("option", { name: "閲覧者" }));
  expect(onChangeRole).toHaveBeenCalledWith(editor, "viewer");
  await user.click(screen.getByRole("button", { name: "editor@example.comを外す" }));
  expect(onRemove).toHaveBeenCalledWith(editor);
});
