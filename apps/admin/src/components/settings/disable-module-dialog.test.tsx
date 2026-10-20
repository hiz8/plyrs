import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ModuleSummary } from "../../lib/admin-api";
import { MODULE_LABELS } from "../../lib/labels";
import { DisableModuleDialog } from "./disable-module-dialog";

const booking: ModuleSummary = {
  moduleId: "booking",
  name: "予約",
  description: null,
  navTypes: ["booking.slot"],
  version: 1,
  enabled: true,
  appliedVersion: 1,
};

function renderDialog(counts: { key: string; name: string; count: number }[] | null) {
  render(
    <DisableModuleDialog
      target={{ module: booking, counts }}
      onConfirm={vi.fn()}
      onCancel={vi.fn()}
      isPending={false}
    />,
  );
}

describe("DisableModuleDialog", () => {
  it("件数があれば内訳つきの注記を出す", () => {
    renderDialog([
      { key: "booking.reservation", name: "予約", count: 3 },
      { key: "booking.slot", name: "予約枠", count: 2 },
    ]);
    expect(screen.getByText(MODULE_LABELS.disableDialog.title("予約"))).toBeVisible();
    expect(screen.getByText(MODULE_LABELS.disableDialog.body("予約"))).toBeVisible();
    expect(
      screen.getByText(MODULE_LABELS.disableDialog.keep("予約 3 件、予約枠 2 件")),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "無効にする" })).toBeVisible();
  });

  it("未同期なら件数の無い注記を出す", () => {
    renderDialog(null);
    expect(screen.getByText(MODULE_LABELS.disableDialog.keepUnknown)).toBeVisible();
  });
});
