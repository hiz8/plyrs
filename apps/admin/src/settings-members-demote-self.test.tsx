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
const owner2 = {
  userId: "u2",
  email: "second@example.com",
  role: "owner",
  createdAt: "2026-07-17T00:00:00Z",
};

const tenantAs = (role: string) =>
  jsonResponse(200, { tenants: [{ id: "t1", slug: "blog", name: "Blog", role }] });

describe("設定 › メンバー(自分のロールを下げる)", () => {
  it("自分を閲覧者にすると確認に締め出しの注意が出て、成功するとホームへ移り設定が消える", async () => {
    const patch = vi.fn((_init?: RequestInit) =>
      jsonResponse(200, { member: { ...owner, role: "viewer" } }),
    );
    // 変更後の取り直しは閲覧者を返す
    const tenants = vi
      .fn()
      .mockImplementationOnce(() => tenantAs("owner"))
      .mockImplementation(() => tenantAs("viewer"));
    const router = renderAt(
      "/t/blog/settings/members",
      socketHarness(),
      authedRoutes({
        "/v1/t/t1/members": vi.fn(() => jsonResponse(200, { members: [owner, owner2] })),
        "/v1/t/t1/members/u1": patch,
        "/auth/tenants": tenants,
      }),
    );
    const user = userEvent.setup();
    fireEvent.change(await screen.findByLabelText("owner@example.comのロール"), {
      target: { value: "viewer" },
    });
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("second@example.com");
    await user.click(within(dialog).getByRole("button", { name: "閲覧者にする" }));
    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    expect(JSON.parse(String(patch.mock.calls[0]?.[0]?.body))).toStrictEqual({ role: "viewer" });
    await waitFor(() => expect(router.state.location.pathname).toBe("/t/blog"));
    expect(
      within(screen.getByRole("navigation", { name: "メインナビゲーション" })).queryByRole("link", {
        name: "設定",
      }),
    ).toBeNull();
  });
});
