import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { DIALOGS } from "../lib/labels";
import type { useLeaveGuard } from "../lib/use-leave-guard";
import { LeaveGuardDialog } from "./leave-guard-dialog";

it("blocked のとき確認が出て、破棄して移動は proceed、編集を続けるは reset を呼ぶ", async () => {
  const user = userEvent.setup();
  const proceed = vi.fn();
  const reset = vi.fn();
  const blocker = { status: "blocked", proceed, reset } as unknown as ReturnType<
    typeof useLeaveGuard
  >;
  render(<LeaveGuardDialog blocker={blocker} body="本文です" />);
  const dialog = await screen.findByRole("alertdialog", { name: DIALOGS.leave.title });
  expect(within(dialog).getByText("本文です")).toBeInTheDocument();
  await user.click(within(dialog).getByRole("button", { name: DIALOGS.leave.stay }));
  expect(reset).toHaveBeenCalledTimes(1);
  expect(proceed).not.toHaveBeenCalled();
  await user.click(within(dialog).getByRole("button", { name: DIALOGS.leave.discard }));
  expect(proceed).toHaveBeenCalledTimes(1);
});
