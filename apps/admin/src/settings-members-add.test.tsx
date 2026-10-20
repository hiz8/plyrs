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

describe("設定 › メンバー(追加)", () => {
  it("未登録なら案内と URL のコピーを出し、入力し直すと追加できる", async () => {
    const members = vi.fn((init?: RequestInit) => {
      if (init?.method === "POST") {
        return members.mock.calls.filter(([i]) => i?.method === "POST").length === 1
          ? jsonResponse(404, { error: "user_not_found" })
          : jsonResponse(200, {
              member: { ...owner, userId: "u9", email: "new@example.com", role: "editor" },
            });
      }
      return jsonResponse(200, { members: [owner] });
    });
    renderAt(
      "/t/blog/settings/members",
      socketHarness(),
      authedRoutes({ "/v1/t/t1/members": members }),
    );
    const user = userEvent.setup();
    fireEvent.click(await screen.findByRole("button", { name: "メンバーを追加" }));
    const dialog = await screen.findByRole("dialog", { name: "メンバーを追加" });
    await user.type(
      within(dialog).getByRole("textbox", { name: /メールアドレス/ }),
      "new@example.com",
    );
    await user.click(within(dialog).getByRole("button", { name: "追加する" }));

    const alert = await within(dialog).findByRole("alert");
    expect(alert).toHaveTextContent("このメールアドレスのユーザーは登録されていません");
    expect(within(alert).getByText("http://localhost:3000/signup")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "メンバーを追加" })).toBeInTheDocument();

    const getsBefore = members.mock.calls.filter(([i]) => i?.method !== "POST").length;
    await user.click(within(dialog).getByRole("button", { name: "追加する" }));
    expect(
      await within(screen.getByRole("region", { name: "通知" })).findByText(
        "new@example.com を追加しました",
      ),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "メンバーを追加" })).not.toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(members.mock.calls.filter(([i]) => i?.method !== "POST").length).toBeGreaterThan(
        getsBefore,
      ),
    );
    const posts = members.mock.calls.filter(([i]) => i?.method === "POST");
    expect(JSON.parse(String(posts[1]?.[0]?.body))).toStrictEqual({
      email: "new@example.com",
      role: "editor",
    });
  });
});
