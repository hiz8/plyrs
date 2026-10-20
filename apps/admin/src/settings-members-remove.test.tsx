import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { authedRoutes, jsonResponse, renderAt, socketHarness } from "./test-utils/records-harness";

const owner = {
  userId: "u1",
  email: "owner@example.com",
  role: "owner",
  createdAt: "2026-07-16T00:00:00Z",
};
const viewer = {
  userId: "u2",
  email: "viewer@example.com",
  role: "viewer",
  createdAt: "2026-07-17T00:00:00Z",
};

describe("設定 › メンバー(外す)", () => {
  it("「外す」は確認を経て DELETE し、409 last_owner ならエラーのトーストを出して一覧を取り直す", async () => {
    const members = vi.fn(() => jsonResponse(200, { members: [owner, viewer] }));
    const del = vi.fn((_init?: RequestInit) => jsonResponse(409, { error: "last_owner" }));
    renderAt(
      "/t/blog/settings/members",
      socketHarness(),
      authedRoutes({ "/v1/t/t1/members": members, "/v1/t/t1/members/u2": del }),
    );
    const user = userEvent.setup();
    fireEvent.click(await screen.findByRole("button", { name: "viewer@example.comを外す" }));
    const dialog = await screen.findByRole("alertdialog", {
      name: "viewer@example.com をメンバーから外しますか？",
    });
    const getsBefore = members.mock.calls.length;
    await user.click(within(dialog).getByRole("button", { name: "外す" }));
    await waitFor(() => expect(del).toHaveBeenCalledTimes(1));
    expect(del.mock.calls[0]?.[0]?.method).toBe("DELETE");
    expect(
      await within(screen.getByRole("region", { name: "通知" })).findByText(/最後の管理者/),
    ).toBeInTheDocument();
    await waitFor(() => expect(members.mock.calls.length).toBeGreaterThan(getsBefore));
  });
});
