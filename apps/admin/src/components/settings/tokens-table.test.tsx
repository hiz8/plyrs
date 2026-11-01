import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import type { TokenSummary } from "../../lib/admin-api";
import { TOKEN_LABELS } from "../../lib/labels";
import { tokenRows } from "../../lib/tokens";
import { RevokeTokenDialog } from "./revoke-token-dialog";
import { TokensTable } from "./tokens-table";

const NOW = new Date("2026-11-01T00:00:00Z");

const active: TokenSummary = {
  id: "tok1",
  userId: "u1",
  name: "Claude Code",
  scopes: ["record:read"],
  expiresAt: "2026-12-01T00:00:00Z",
  createdAt: "2026-10-01T00:00:00Z",
  lastUsedAt: null,
  revokedAt: null,
};
const revoked: TokenSummary = {
  ...active,
  id: "tok2",
  name: "old",
  revokedAt: "2026-10-20T00:00:00Z",
};

it("名前・スコープ・期限・最終利用を出し、有効な行だけ失効ボタンがある", async () => {
  const user = userEvent.setup();
  const onRevoke = vi.fn();
  render(<TokensTable rows={tokenRows([active, revoked], NOW)} onRevoke={onRevoke} />);
  expect(screen.getByText("Claude Code")).toBeInTheDocument();
  expect(screen.getAllByText(TOKEN_LABELS.scopes["record:read"]).length).toBeGreaterThan(0);
  expect(screen.getByText(TOKEN_LABELS.status.revoked)).toBeInTheDocument();
  const buttons = screen.getAllByRole("button", { name: /を失効/ });
  expect(buttons).toHaveLength(1);
  await user.click(buttons[0]!);
  expect(onRevoke).toHaveBeenCalledWith(active);
});

it("失効の確認ダイアログは名前と戻せない旨を出し、確認で onConfirm", async () => {
  const user = userEvent.setup();
  const onConfirm = vi.fn();
  render(
    <RevokeTokenDialog
      target={active}
      onConfirm={onConfirm}
      onCancel={vi.fn()}
      isPending={false}
    />,
  );
  expect(screen.getByText(TOKEN_LABELS.revokeDialog.title("Claude Code"))).toBeVisible();
  expect(screen.getByText(TOKEN_LABELS.revokeDialog.body)).toBeVisible();
  await user.click(screen.getByRole("button", { name: TOKEN_LABELS.revokeDialog.confirm }));
  expect(onConfirm).toHaveBeenCalled();
});
