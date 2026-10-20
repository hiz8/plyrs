import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
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
const viewer = {
  userId: "u2",
  email: "viewer@example.com",
  role: "viewer",
  createdAt: "2026-07-17T00:00:00Z",
};
const owner2 = {
  userId: "u3",
  email: "second@example.com",
  role: "owner",
  createdAt: "2026-07-18T00:00:00Z",
};

function routesWith(members: unknown[], extra = {}) {
  return authedRoutes({
    "/v1/t/t1/members": vi.fn(() => jsonResponse(200, { members })),
    ...extra,
  });
}

describe("設定 › メンバー(一覧)", () => {
  it("メンバーを API の順のまま出し、自分の行に「自分」、ロール説明カードが 3 枚", async () => {
    renderAt("/t/blog/settings/members", socketHarness(), routesWith([viewer, owner, owner2]));
    const table = await screen.findByRole("grid", { name: "メンバーの一覧" });
    const rows = within(table).getAllByRole("row");
    // viewer(2 件目より新しい)が先頭。並べ替えず API の順のまま出す
    expect(rows[1]).toHaveTextContent("viewer@example.com");
    expect(rows[2]).toHaveTextContent("owner@example.com");
    expect(rows[2]).toHaveTextContent("自分");
    expect(rows[3]).toHaveTextContent("second@example.com");
    expect(screen.getByText(/すべての操作に加えて/)).toBeInTheDocument();
    expect(
      screen.getByText(/コンテンツとメディアの作成・編集・公開ができます/),
    ).toBeInTheDocument();
    expect(screen.getByText(/コンテンツとメディアを見るだけです/)).toBeInTheDocument();
  });

  it("自分が最後の管理者の行は操作の代わりに「最後の管理者」と理由を出し、管理者が 2 人なら操作が出る", async () => {
    renderAt("/t/blog/settings/members", socketHarness(), routesWith([owner, viewer]));
    expect(await screen.findByRole("button", { name: "最後の管理者" })).toBeInTheDocument();
    expect(screen.queryByLabelText("owner@example.comのロール")).toBeNull();
    expect(screen.queryByRole("button", { name: "owner@example.comを外す" })).toBeNull();
    expect(screen.getByRole("button", { name: "viewer@example.comを外す" })).toBeInTheDocument();
    cleanup();

    renderAt("/t/blog/settings/members", socketHarness(), routesWith([owner, viewer, owner2]));
    expect(await screen.findByLabelText("owner@example.comのロール")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "最後の管理者" })).toBeNull();
    expect(screen.getByRole("button", { name: "owner@example.comを外す" })).toBeInTheDocument();
  });

  it("取得に失敗すると中身だけにエラーと再試行が出て、再試行で一覧が出る", async () => {
    const members = vi
      .fn()
      // membersQueryOptions は retry: 1 なので、最初の 2 回(初回と自動の再試行)を失敗させる
      .mockImplementationOnce(() => jsonResponse(500, { error: "boom" }))
      .mockImplementationOnce(() => jsonResponse(500, { error: "boom" }))
      .mockImplementation(() => jsonResponse(200, { members: [owner, viewer] }));
    renderAt(
      "/t/blog/settings/members",
      socketHarness(),
      authedRoutes({ "/v1/t/t1/members": members }),
    );
    expect(
      await screen.findByText("メンバー一覧を取得できませんでした", {}, { timeout: 5000 }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "設定" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "再試行" }));
    expect(await screen.findByText("viewer@example.com")).toBeInTheDocument();
  });

  it("ロールを上げると確認なしで PATCH してトーストを出す", async () => {
    const patch = vi.fn((_init?: RequestInit) =>
      jsonResponse(200, { member: { ...viewer, role: "editor" } }),
    );
    renderAt(
      "/t/blog/settings/members",
      socketHarness(),
      routesWith([owner, viewer], { "/v1/t/t1/members/u2": patch }),
    );
    const select = await screen.findByLabelText("viewer@example.comのロール");
    fireEvent.change(select, { target: { value: "editor" } });
    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    expect(patch.mock.calls[0]?.[0]?.method).toBe("PATCH");
    expect(JSON.parse(String(patch.mock.calls[0]?.[0]?.body))).toStrictEqual({ role: "editor" });
    expect(
      await within(screen.getByRole("region", { name: "通知" })).findByText(
        "viewer@example.com を編集者にしました",
      ),
    ).toBeInTheDocument();
  });
});
