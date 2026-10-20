import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ContentTypeDefinition } from "@plyrs/metamodel";
import type { SyncRecord } from "@plyrs/sync-protocol";
import { describe, expect, it, vi } from "vitest";
import {
  authedRoutes,
  bootstrapped,
  jsonResponse,
  renderAt,
  socketHarness,
} from "./test-utils/records-harness";

const slotType: ContentTypeDefinition = {
  id: "018f2b6a-7a0a-7000-8000-000000000009",
  key: "booking.slot",
  name: "予約枠",
  source: "plugin",
  pluginId: "booking",
  version: 1,
  fields: [{ key: "title", type: "text" }],
};

function slot(id: string): SyncRecord {
  return {
    id,
    type: "booking.slot",
    input: { title: id },
    fieldVersions: { title: 1 },
    status: "draft",
    seq: 2,
    version: 1,
    deletedAt: null,
    updatedAt: "2026-07-17T00:00:00Z",
    updatedBy: "u1",
  };
}

const bookingModule = {
  moduleId: "booking",
  name: "予約",
  description: "予約を受け付けます。",
  navTypes: ["booking.slot"],
  version: 2,
  enabled: true,
  appliedVersion: 2,
};

describe("設定 › モジュール(無効化)", () => {
  it("無効にするは確認に件数を出し、確認で POST disable する", async () => {
    const disable = vi.fn((_init?: RequestInit) =>
      jsonResponse(200, { ok: true, module: { ...bookingModule, enabled: false } }),
    );
    const harness = socketHarness();
    renderAt(
      "/t/blog/settings/modules",
      harness,
      authedRoutes({
        "/v1/t/t1/modules": vi.fn(() => jsonResponse(200, { modules: [bookingModule] })),
        "/v1/t/t1/modules/booking/disable": disable,
      }),
    );
    await vi.waitFor(() => expect(harness.sockets.length).toBe(1));
    await bootstrapped(
      harness.latest(),
      [slot("018f2b6a-7a0a-7000-8000-000000000a01"), slot("018f2b6a-7a0a-7000-8000-000000000a02")],
      [slotType],
    );
    const user = userEvent.setup();
    fireEvent.click(await screen.findByRole("button", { name: "無効にする" }));
    const dialog = await screen.findByRole("dialog", {
      name: "予約モジュールを無効にしますか？",
    });
    await waitFor(() => expect(dialog).toHaveTextContent("予約枠 2 件"));
    expect(disable).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "無効にする" }));
    await waitFor(() => expect(disable).toHaveBeenCalledTimes(1));
    expect(
      await within(screen.getByRole("region", { name: "通知" })).findByText("予約を無効にしました"),
    ).toBeInTheDocument();
  });
});
