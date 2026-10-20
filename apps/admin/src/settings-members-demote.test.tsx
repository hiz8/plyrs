import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { authedRoutes, jsonResponse, renderAt, socketHarness } from "./test-utils/records-harness";

vi.mock("./components/settings/role-select", async () => {
  const { RoleSelectMock } = await import("./test-utils/role-select-mock");
  return { RoleSelect: RoleSelectMock };
});

const owner = {
  userId: "u1",
  email: "owner@example.com",
  role: "owner",
  createdAt: "2026-07-16T00:00:00Z",
};
const editor = {
  userId: "u2",
  email: "editor@example.com",
  role: "editor",
  createdAt: "2026-07-17T00:00:00Z",
};

describe("設定 › メンバー(ロールを下げる)", () => {
  it("ロールを下げると確認に最大 15 分の案内が出て、確認で PATCH する", async () => {
    const patch = vi.fn((_init?: RequestInit) =>
      jsonResponse(200, { member: { ...editor, role: "viewer" } }),
    );
    renderAt(
      "/t/blog/settings/members",
      socketHarness(),
      authedRoutes({
        "/v1/t/t1/members": vi.fn(() => jsonResponse(200, { members: [owner, editor] })),
        "/v1/t/t1/members/u2": patch,
      }),
    );
    const user = userEvent.setup();
    fireEvent.change(await screen.findByLabelText("editor@example.comのロール"), {
      target: { value: "viewer" },
    });
    const dialog = await screen.findByRole("dialog", {
      name: "editor@example.com を閲覧者にしますか？",
    });
    expect(dialog).toHaveTextContent("反映まで最大 15 分かかります");
    expect(patch).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "閲覧者にする" }));
    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    expect(JSON.parse(String(patch.mock.calls[0]?.[0]?.body))).toStrictEqual({ role: "viewer" });
  });
});
