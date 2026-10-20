import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  authedRoutes,
  blogTenant,
  jsonResponse,
  renderAt,
  socketHarness,
} from "./test-utils/records-harness";

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

describe("設定 › メンバー(自分を外す)", () => {
  it("自分を外すと確認に他の管理者のメールが出て、成功するとサイト選択へ移る", async () => {
    const del = vi.fn((_init?: RequestInit) => jsonResponse(200, { ok: true }));
    const routes = authedRoutes({
      "/v1/t/t1/members": vi.fn(() => jsonResponse(200, { members: [owner, owner2] })),
      "/v1/t/t1/members/u1": del,
      // 2 つあれば /tenants が /t/blog へ転送されず、サイト選択に留まる
      "/auth/tenants": vi.fn(() =>
        jsonResponse(200, {
          tenants: [blogTenant(), { id: "t2", slug: "shop", name: "Shop", role: "owner" }],
        }),
      ),
    });
    const router = renderAt("/t/blog/settings/members", socketHarness(), routes);
    const user = userEvent.setup();
    fireEvent.click(await screen.findByRole("button", { name: "owner@example.comを外す" }));
    const dialog = await screen.findByRole("alertdialog", {
      name: "自分をこのサイトから外しますか？",
    });
    expect(dialog).toHaveTextContent("second@example.com");
    await user.click(within(dialog).getByRole("button", { name: "自分を外す" }));
    await waitFor(() => expect(del).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(router.state.location.pathname).toBe("/tenants"));
  });
});
