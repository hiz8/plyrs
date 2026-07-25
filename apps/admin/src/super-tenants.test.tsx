import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, type Mock } from "vitest";
import { createAppContext, getRouter } from "./router";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// このファイルは同一パスに複数メソッド(GET 一覧 / POST 作成、PATCH 改名 / DELETE 削除)が
// ぶら下がる super/v1 テナント API を検証するため、super-login.test.tsx の stubFetch を
// `${method} ${path}` キーへ拡張する。ハンドラには完全な URL も渡し、クエリ文字列
// (?q=...)を直接アサートできるようにする。
type Handler = Mock<(url: string, init?: RequestInit) => Response>;

function stubFetch(routes: Record<string, Handler>): typeof fetch {
  return async (input, init) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const path = new URL(url, "http://localhost").pathname;
    const method = init?.method ?? "GET";
    const key = `${method} ${path}`;
    const handler = routes[key];
    if (handler === undefined) {
      throw new Error(`unexpected fetch: ${key}`);
    }
    return handler(url, init ?? undefined);
  };
}

function renderAt(path: string, routes: Record<string, Handler>) {
  const router = getRouter({
    context: createAppContext(stubFetch(routes)),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  render(<RouterProvider router={router} />);
  return router;
}

function meHandler(): Handler {
  return vi.fn(() => jsonResponse(200, { adminId: "a1", email: "admin@example.com" }));
}

const blog = {
  id: "t1",
  slug: "blog",
  name: "Blog",
  createdAt: "2026-07-01T00:00:00Z",
  memberCount: 3,
};
const shop = {
  id: "t2",
  slug: "shop",
  name: "Shop",
  createdAt: "2026-07-02T00:00:00Z",
  memberCount: 1,
};

describe("super tenant management", () => {
  it("lists tenants and creates one with an owner email", async () => {
    const me = meHandler();
    const created = {
      id: "t3",
      slug: "new-co",
      name: "New Co",
      createdAt: "2026-07-19T00:00:00Z",
      memberCount: 1,
    };
    const listTenants: Handler = vi
      .fn()
      .mockReturnValueOnce(jsonResponse(200, { tenants: [blog, shop] }))
      .mockReturnValue(jsonResponse(200, { tenants: [blog, shop, created] }));
    const createTenant: Handler = vi.fn(() => jsonResponse(201, { tenantId: "t3" }));
    renderAt("/super", {
      "GET /super-auth/me": me,
      "GET /super/v1/tenants": listTenants,
      "POST /super/v1/tenants": createTenant,
    });

    expect(await screen.findByRole("heading", { name: "テナント" })).toBeInTheDocument();
    expect(await screen.findByText("blog")).toBeInTheDocument();
    expect(screen.getByText("shop")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("テナント名"), "New Co");
    await user.type(screen.getByLabelText("slug"), "new-co");
    await user.type(screen.getByLabelText("オーナーのメールアドレス(任意)"), "owner@example.com");
    await user.click(screen.getByRole("button", { name: "作成" }));

    expect(createTenant).toHaveBeenCalledTimes(1);
    const createInit = createTenant.mock.calls[0]?.[1];
    expect(JSON.parse(String((createInit as RequestInit).body))).toStrictEqual({
      name: "New Co",
      slug: "new-co",
      ownerEmail: "owner@example.com",
    });

    // mutation 成功 → invalidateQueries → 一覧の再取得
    expect(await screen.findByText("new-co")).toBeInTheDocument();
    expect(listTenants).toHaveBeenCalledTimes(2);
  });

  // Minor 掃除(§16-5): ownerEmail 省略時、body に "" ではなくキー自体が入らないことの専用テスト
  // (admin 側に追加 — apps/api 側は複数テストで ownerEmail 省略の作成自体は通しているが、
  // UI が組み立てる送信 body の形そのものを専用に確認したテストはなかった)。
  it("creates a tenant without sending an ownerEmail key when the field is left blank", async () => {
    const me = meHandler();
    const created = {
      id: "t9",
      slug: "solo",
      name: "Solo",
      createdAt: "2026-07-20T00:00:00Z",
      memberCount: 0,
    };
    const listTenants: Handler = vi
      .fn()
      .mockReturnValueOnce(jsonResponse(200, { tenants: [] }))
      .mockReturnValue(jsonResponse(200, { tenants: [created] }));
    const createTenant: Handler = vi.fn(() => jsonResponse(201, { tenantId: "t9" }));
    renderAt("/super", {
      "GET /super-auth/me": me,
      "GET /super/v1/tenants": listTenants,
      "POST /super/v1/tenants": createTenant,
    });

    expect(await screen.findByRole("heading", { name: "テナント" })).toBeInTheDocument();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("テナント名"), "Solo");
    await user.type(screen.getByLabelText("slug"), "solo");
    await user.click(screen.getByRole("button", { name: "作成" }));

    expect(createTenant).toHaveBeenCalledTimes(1);
    const createInit = createTenant.mock.calls[0]?.[1];
    expect(JSON.parse(String((createInit as RequestInit).body))).toStrictEqual({
      name: "Solo",
      slug: "solo",
    });
    expect(await screen.findByText("Solo")).toBeInTheDocument();
  });

  // Minor 掃除(§16-5): rename の PATCH body・応答反映の専用テスト(admin 側に追加 —
  // apps/api 側は status 200 と監査ログのみ確認しており、UI からの送信 body は未検証だった)。
  it("renames a tenant", async () => {
    const me = meHandler();
    const renamed = { ...blog, name: "Blog Renamed" };
    const listTenants: Handler = vi
      .fn()
      .mockReturnValueOnce(jsonResponse(200, { tenants: [blog] }))
      .mockReturnValue(jsonResponse(200, { tenants: [renamed] }));
    const renameTenant: Handler = vi.fn(() => jsonResponse(200, { ok: true }));
    renderAt("/super", {
      "GET /super-auth/me": me,
      "GET /super/v1/tenants": listTenants,
      "PATCH /super/v1/tenants/t1": renameTenant,
    });

    expect(await screen.findByText("Blog")).toBeInTheDocument();
    const user = userEvent.setup();
    const row = screen.getByText("Blog").closest("tr");
    if (row === null) {
      throw new Error("row not found");
    }
    await user.click(within(row).getByRole("button", { name: "名称変更" }));
    const nameInput = screen.getByLabelText("名前");
    await user.clear(nameInput);
    await user.type(nameInput, "Blog Renamed");
    await user.click(screen.getByRole("button", { name: "保存" }));

    expect(renameTenant).toHaveBeenCalledTimes(1);
    const renameInit = renameTenant.mock.calls[0]?.[1];
    expect(JSON.parse(String((renameInit as RequestInit).body))).toStrictEqual({
      name: "Blog Renamed",
    });
    // mutation 成功 → invalidateQueries → 一覧の再取得で新しい名前が反映される
    expect(await screen.findByText("Blog Renamed")).toBeInTheDocument();
    expect(listTenants).toHaveBeenCalledTimes(2);
  });

  it("deletes a tenant only after slug confirmation", async () => {
    const me = meHandler();
    const listTenants = vi.fn(() => jsonResponse(200, { tenants: [blog, shop] }));
    const deleteTenant = vi.fn(() => jsonResponse(200, { ok: true }));
    renderAt("/super", {
      "GET /super-auth/me": me,
      "GET /super/v1/tenants": listTenants,
      "DELETE /super/v1/tenants/t1": deleteTenant,
    });

    expect(await screen.findByText("blog")).toBeInTheDocument();
    const user = userEvent.setup();
    const row = screen.getByText("blog").closest("tr");
    if (row === null) {
      throw new Error("row not found");
    }
    const { getByRole } = within(row);
    await user.click(getByRole("button", { name: "削除" }));

    expect(await screen.findByRole("alertdialog", { name: "テナントの削除" })).toBeInTheDocument();
    const confirmInput = screen.getByLabelText("確認用 slug");
    await user.type(confirmInput, "not-blog");
    await user.click(screen.getByRole("button", { name: "削除を確定" }));
    expect(deleteTenant).not.toHaveBeenCalled();

    await user.clear(confirmInput);
    await user.type(confirmInput, "blog");
    await user.click(screen.getByRole("button", { name: "削除を確定" }));
    expect(deleteTenant).toHaveBeenCalledTimes(1);
  });

  it("shows members on the detail page and revokes a membership", async () => {
    const me = meHandler();
    const listTenants = vi.fn(() => jsonResponse(200, { tenants: [blog] }));
    const alice = { userId: "u1", email: "alice@example.com", role: "owner", createdAt: "" };
    const bob = { userId: "u2", email: "bob@example.com", role: "editor", createdAt: "" };
    const listMembers = vi.fn(() => jsonResponse(200, { members: [alice, bob] }));
    const revokeMember = vi.fn(() => jsonResponse(200, { ok: true, disconnected: 0 }));
    renderAt("/super/tenants/t1", {
      "GET /super-auth/me": me,
      "GET /super/v1/tenants": listTenants,
      "GET /super/v1/tenants/t1/members": listMembers,
      "DELETE /super/v1/tenants/t1/members/u2": revokeMember,
    });

    expect(await screen.findByText("Blog")).toBeInTheDocument();
    expect(screen.getByText("blog")).toBeInTheDocument();
    expect(await screen.findByText("alice@example.com")).toBeInTheDocument();
    expect(screen.getByText("bob@example.com")).toBeInTheDocument();

    const user = userEvent.setup();
    const bobRow = screen.getByText("bob@example.com").closest("tr");
    if (bobRow === null) {
      throw new Error("row not found");
    }
    await user.click(within(bobRow).getByRole("button", { name: "剥奪" }));
    await user.click(screen.getByRole("button", { name: "剥奪を確定" }));

    expect(revokeMember).toHaveBeenCalledTimes(1);
  });

  it("bans a user from the users page", async () => {
    const me = meHandler();
    const alice = { id: "u1", email: "alice@example.com", createdAt: "", membershipCount: 2 };
    const listUsers: Handler = vi.fn(() => jsonResponse(200, { users: [alice] }));
    const banUser: Handler = vi.fn(() => jsonResponse(200, { ok: true, disconnected: 1 }));
    renderAt("/super/users", {
      "GET /super-auth/me": me,
      "GET /super/v1/users": listUsers,
      "POST /super/v1/users/u1/ban": banUser,
    });

    expect(await screen.findByText("alice@example.com")).toBeInTheDocument();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("メールアドレスで検索"), "alice");
    await user.click(screen.getByRole("button", { name: "検索" }));

    expect(listUsers).toHaveBeenCalledTimes(2);
    const secondCallUrl = listUsers.mock.calls[1]?.[0] as string;
    expect(secondCallUrl).toContain("q=alice");

    await user.click(screen.getByRole("button", { name: "BAN" }));
    await user.click(screen.getByRole("button", { name: "BAN を確定" }));

    expect(banUser).toHaveBeenCalledTimes(1);
  });

  // Minor 掃除(§16-5): unban の送信 body(なし)・応答反映の専用テスト(admin 側に追加 —
  // apps/api 側は既に status/body/isBlocked/監査ログまで確認済みだが、UI からの送信内容の
  // 専用テストはなかった)。
  it("unbans a user", async () => {
    const me = meHandler();
    const alice = { id: "u1", email: "alice@example.com", createdAt: "", membershipCount: 2 };
    const listUsers: Handler = vi.fn(() => jsonResponse(200, { users: [alice] }));
    const unbanUser: Handler = vi.fn(() => jsonResponse(200, { ok: true }));
    renderAt("/super/users", {
      "GET /super-auth/me": me,
      "GET /super/v1/users": listUsers,
      "POST /super/v1/users/u1/unban": unbanUser,
    });

    expect(await screen.findByText("alice@example.com")).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "BAN 解除" }));
    await user.click(screen.getByRole("button", { name: "解除を確定" }));

    expect(unbanUser).toHaveBeenCalledTimes(1);
    const unbanInit = unbanUser.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(unbanInit?.body).toBeUndefined();
    expect(listUsers).toHaveBeenCalledTimes(2);
  });
});
