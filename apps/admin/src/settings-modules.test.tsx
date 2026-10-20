import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { NAV_LABELS } from "./lib/labels";
import { authedRoutes, jsonResponse, renderAt, socketHarness } from "./test-utils/records-harness";

const bookingModule = {
  moduleId: "booking",
  name: "予約",
  description: "予約枠を公開し、サイトの訪問者から予約を受け付けます。",
  navTypes: ["booking.slot"],
  version: 3,
  enabled: false,
  appliedVersion: 0,
};

describe("設定 › モジュール", () => {
  it("モジュールをカードで出し、有効にするを押すと POST enable → トーストと帯が出る", async () => {
    const list = vi
      .fn()
      .mockReturnValueOnce(jsonResponse(200, { modules: [bookingModule] }))
      .mockReturnValue(
        jsonResponse(200, { modules: [{ ...bookingModule, enabled: true, appliedVersion: 3 }] }),
      );
    const enable = vi.fn((_init?: RequestInit) =>
      jsonResponse(200, {
        ok: true,
        module: { ...bookingModule, enabled: true, appliedVersion: 3 },
      }),
    );
    renderAt(
      "/t/blog/settings/modules",
      socketHarness(),
      authedRoutes({ "/v1/t/t1/modules": list, "/v1/t/t1/modules/booking/enable": enable }),
    );
    const user = userEvent.setup();
    expect(await screen.findByText(bookingModule.description)).toBeVisible();
    await user.click(await screen.findByRole("button", { name: "有効にする" }));
    await waitFor(() => expect(enable).toHaveBeenCalledTimes(1));
    expect(
      await within(screen.getByRole("region", { name: "通知" })).findByText("予約を有効にしました"),
    ).toBeInTheDocument();
    expect(await screen.findByText("有効にしました。")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "無効にする" })).toBeVisible();
    expect(document.body).not.toHaveTextContent(/適用済み|v3/);
  });

  it("取得に失敗すると中身だけにエラーと再試行が出る", async () => {
    const list = vi
      .fn()
      // modulesQueryOptions は retry: 1 なので、最初の 2 回(初回と自動の再試行)を失敗させる
      .mockImplementationOnce(() => jsonResponse(500, { error: "boom" }))
      .mockImplementationOnce(() => jsonResponse(500, { error: "boom" }))
      .mockImplementation(() => jsonResponse(200, { modules: [bookingModule] }));
    renderAt(
      "/t/blog/settings/modules",
      socketHarness(),
      authedRoutes({ "/v1/t/t1/modules": list }),
    );
    expect(await screen.findByRole("alert", {}, { timeout: 5000 })).toBeVisible();
    expect(screen.getByRole("heading", { level: 1, name: "設定" })).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "再試行" }));
    expect(await screen.findByRole("button", { name: "有効にする" })).toBeVisible();
  });

  it("サイドバーの「設定」から入った設定画面にモジュールのタブがある", async () => {
    renderAt(
      "/t/blog/settings/modules",
      socketHarness(),
      authedRoutes({
        "/v1/t/t1/modules": vi.fn(() => jsonResponse(200, { modules: [bookingModule] })),
      }),
    );
    const tab = await screen.findByRole("tab", { name: "モジュール" });
    expect(tab).toHaveAttribute("aria-selected", "true");
    const mainNav = screen.getByRole("navigation", { name: NAV_LABELS.mainNav });
    expect(within(mainNav).queryByRole("link", { name: "モジュール" })).not.toBeInTheDocument();
  });
});
