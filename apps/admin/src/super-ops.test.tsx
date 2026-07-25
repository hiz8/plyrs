import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, type Mock } from "vitest";
import { createAppContext, getRouter } from "./router";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// super-tenants.test.tsx と同じ様式: 同一パスに複数メソッドがぶら下がるため
// `${method} ${path}` キーで振り分け、完全な URL も渡してクエリ文字列を検証可能にする。
// 戻り値を Response | Promise<Response> にしているのは isPending disable テストが
// 応答タイミングを手動制御する deferred な Response を返す必要があるため。
type Handler = Mock<(url: string, init?: RequestInit) => Response | Promise<Response>>;

// isPending 中の二重発火防止テスト用: 応答タイミングを手動で握るための小さな deferred。
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

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
  memberCount: 0,
};

describe("super operations pages", () => {
  it("runs a health check on the tenant detail page", async () => {
    const me = meHandler();
    const listTenants = vi.fn(() => jsonResponse(200, { tenants: [blog] }));
    const listMembers = vi.fn(() => jsonResponse(200, { members: [] }));
    const health = vi.fn(() =>
      jsonResponse(200, {
        archivedPublished: [
          { recordId: "r1", type: "article", publishedAt: "2026-07-10T00:00:00Z" },
        ],
        legacyAssetType: true,
        legacyRichtextRecords: [{ recordId: "r2", type: "page", fieldKey: "body" }],
      }),
    );
    renderAt("/super/tenants/t1", {
      "GET /super-auth/me": me,
      "GET /super/v1/tenants": listTenants,
      "GET /super/v1/tenants/t1/members": listMembers,
      "GET /super/v1/tenants/t1/health": health,
    });

    expect(await screen.findByText("Blog")).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "健全性チェックを実行" }));

    expect(await screen.findByText("r1")).toBeInTheDocument();
    expect(screen.getByText("article")).toBeInTheDocument();
    expect(screen.getByText("2026-07-10T00:00:00Z")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("旧形式の asset 型が検出されました");
    expect(screen.getByText("r2")).toBeInTheDocument();
    expect(screen.getByText("page")).toBeInTheDocument();
    expect(screen.getByText("body")).toBeInTheDocument();
    expect(health).toHaveBeenCalledTimes(1);
  });

  it("scans and deletes orphan assets", async () => {
    const me = meHandler();
    const listTenants = vi.fn(() => jsonResponse(200, { tenants: [blog] }));
    const listMembers = vi.fn(() => jsonResponse(200, { members: [] }));
    const scanOrphans = vi.fn(() =>
      jsonResponse(200, {
        orphans: [
          { key: "t1/orphan-1", size: 10 },
          { key: "t1/orphan-2", size: 20 },
        ],
      }),
    );
    const deleteOrphans: Handler = vi.fn(() => jsonResponse(200, { ok: true, deleted: 1 }));
    renderAt("/super/tenants/t1", {
      "GET /super-auth/me": me,
      "GET /super/v1/tenants": listTenants,
      "GET /super/v1/tenants/t1/members": listMembers,
      "GET /super/v1/tenants/t1/orphan-assets": scanOrphans,
      "DELETE /super/v1/tenants/t1/orphan-assets": deleteOrphans,
    });

    expect(await screen.findByText("Blog")).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "孤児アセットを走査" }));

    expect(await screen.findByText("t1/orphan-1")).toBeInTheDocument();
    expect(screen.getByText("t1/orphan-2")).toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: "t1/orphan-1" }));
    await user.click(screen.getByRole("button", { name: "選択を削除" }));

    expect(
      await screen.findByRole("alertdialog", { name: "孤児アセットの削除" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "削除を確定" }));

    expect(deleteOrphans).toHaveBeenCalledTimes(1);
    const deleteInit = deleteOrphans.mock.calls[0]?.[1];
    expect(JSON.parse(String((deleteInit as RequestInit).body))).toStrictEqual({
      keys: ["t1/orphan-1"],
    });
  });

  it("triggers a reprojection with confirmation", async () => {
    const me = meHandler();
    const listTenants = vi.fn(() => jsonResponse(200, { tenants: [blog] }));
    const listMembers = vi.fn(() => jsonResponse(200, { members: [] }));
    const reproject = vi.fn(() => jsonResponse(200, { ok: true, epoch: 4 }));
    renderAt("/super/tenants/t1", {
      "GET /super-auth/me": me,
      "GET /super/v1/tenants": listTenants,
      "GET /super/v1/tenants/t1/members": listMembers,
      "POST /super/v1/tenants/t1/reproject": reproject,
    });

    expect(await screen.findByText("Blog")).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "再投影を開始" }));

    expect(await screen.findByRole("alertdialog", { name: "再投影の確認" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "開始を確定" }));

    expect(reproject).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("再投影を開始しました(epoch: 4)")).toBeInTheDocument();
  });

  it("lists dead letters and replays one", async () => {
    const me = meHandler();
    const listDeadLetters = vi.fn(() =>
      jsonResponse(200, {
        deadLetters: [
          {
            id: "dlq-1",
            queue: "plyrs-projection",
            body: "{}",
            failedAt: "2026-07-15T00:00:00Z",
            replayedAt: null,
          },
        ],
      }),
    );
    const replay = vi.fn(() => jsonResponse(200, { ok: true }));
    const discard = vi.fn(() => jsonResponse(200, { ok: true }));
    renderAt("/super/dlq", {
      "GET /super-auth/me": me,
      "GET /super/v1/dead-letters": listDeadLetters,
      "POST /super/v1/dead-letters/dlq-1/replay": replay,
      "DELETE /super/v1/dead-letters/dlq-1": discard,
    });

    expect(await screen.findByText("plyrs-projection")).toBeInTheDocument();
    expect(screen.getByText("2026-07-15T00:00:00Z")).toBeInTheDocument();

    const user = userEvent.setup();
    const row = screen.getByText("plyrs-projection").closest("tr");
    if (row === null) {
      throw new Error("row not found");
    }
    await user.click(within(row).getByRole("button", { name: "再投入" }));
    expect(replay).toHaveBeenCalledTimes(1);

    await user.click(within(row).getByRole("button", { name: "破棄" }));
    expect(
      await screen.findByRole("alertdialog", { name: "デッドレターの破棄" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "破棄を確定" }));
    expect(discard).toHaveBeenCalledTimes(1);
  });

  // Minor 掃除(§16 レビュー Important): replayMutation はページ単位の単一 useMutation
  // インスタンスのため、isPending だけで disable すると無関係な他の行のボタンまで
  // disable されてしまう。2 行以上のフィクスチャで、実行中の行だけが disable され
  // 他の行は enabled のままであることを固定する。
  it("disables only the replaying row's button while its replay request is pending", async () => {
    const me = meHandler();
    const listDeadLetters = vi.fn(() =>
      jsonResponse(200, {
        deadLetters: [
          {
            id: "dlq-1",
            queue: "plyrs-projection",
            body: "{}",
            failedAt: "2026-07-15T00:00:00Z",
            replayedAt: null,
          },
          {
            id: "dlq-2",
            queue: "plyrs-modules",
            body: "{}",
            failedAt: "2026-07-16T00:00:00Z",
            replayedAt: null,
          },
        ],
      }),
    );
    const { promise: replayPromise, resolve: resolveReplay } = deferred<Response>();
    const replay: Handler = vi.fn(() => replayPromise);
    renderAt("/super/dlq", {
      "GET /super-auth/me": me,
      "GET /super/v1/dead-letters": listDeadLetters,
      "POST /super/v1/dead-letters/dlq-1/replay": replay,
    });

    expect(await screen.findByText("plyrs-projection")).toBeInTheDocument();
    const user = userEvent.setup();
    const row1 = screen.getByText("plyrs-projection").closest("tr");
    const row2 = screen.getByText("plyrs-modules").closest("tr");
    if (row1 === null || row2 === null) {
      throw new Error("row not found");
    }
    const replayButton1 = within(row1).getByRole("button", { name: "再投入" });
    const replayButton2 = within(row2).getByRole("button", { name: "再投入" });
    await user.click(replayButton1);

    expect(replayButton1).toBeDisabled();
    expect(replayButton2).toBeEnabled();
    resolveReplay(jsonResponse(200, { ok: true }));
    await waitFor(() => expect(replayButton1).toBeEnabled());
  });

  it("shows the audit log", async () => {
    const me = meHandler();
    const listAuditLogs = vi.fn(() =>
      jsonResponse(200, {
        auditLogs: [
          {
            id: "log-1",
            actorId: "admin-1",
            action: "tenant.create",
            targetType: "tenant",
            targetId: "t9",
            detail: "{}",
            createdAt: "2026-07-18T00:00:00Z",
          },
        ],
      }),
    );
    renderAt("/super/audit", {
      "GET /super-auth/me": me,
      "GET /super/v1/audit-logs": listAuditLogs,
    });

    expect(await screen.findByText("tenant.create")).toBeInTheDocument();
    expect(screen.getByText("admin-1")).toBeInTheDocument();
    expect(screen.getByText("tenant:t9")).toBeInTheDocument();
    expect(screen.getByText("2026-07-18T00:00:00Z")).toBeInTheDocument();
  });

  it("lists modules and redistributes type definitions", async () => {
    const me = meHandler();
    const listModules = vi.fn(() =>
      jsonResponse(200, {
        modules: [{ moduleId: "booking", version: 2, name: "予約", enabledTenants: 3 }],
      }),
    );
    const redistribute = vi.fn(() => jsonResponse(202, { ok: true }));
    renderAt("/super/modules", {
      "GET /super-auth/me": me,
      "GET /super/v1/modules": listModules,
      "POST /super/v1/modules/booking/redistribute": redistribute,
    });

    expect(await screen.findByText("booking")).toBeInTheDocument();
    expect(screen.getByText("予約")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "型定義を再配布" }));
    expect(redistribute).toHaveBeenCalledTimes(1);
  });

  // Minor 掃除(§16 レビュー Important): redistributeMutation もページ単位の単一
  // useMutation インスタンスのため、isPending だけで disable すると無関係な他の行の
  // ボタンまで disable されてしまう。2 行以上のフィクスチャで、実行中の行だけが
  // disable され他の行は enabled のままであることを固定する。
  it("disables only the redistributing row's button while its request is pending", async () => {
    const me = meHandler();
    const listModules = vi.fn(() =>
      jsonResponse(200, {
        modules: [
          { moduleId: "booking", version: 2, name: "予約", enabledTenants: 3 },
          { moduleId: "crm", version: 1, name: "CRM", enabledTenants: 1 },
        ],
      }),
    );
    const { promise: redistributePromise, resolve: resolveRedistribute } = deferred<Response>();
    const redistribute: Handler = vi.fn(() => redistributePromise);
    renderAt("/super/modules", {
      "GET /super-auth/me": me,
      "GET /super/v1/modules": listModules,
      "POST /super/v1/modules/booking/redistribute": redistribute,
    });

    expect(await screen.findByText("booking")).toBeInTheDocument();
    const user = userEvent.setup();
    const row1 = screen.getByText("booking").closest("tr");
    const row2 = screen.getByText("crm").closest("tr");
    if (row1 === null || row2 === null) {
      throw new Error("row not found");
    }
    const redistributeButton1 = within(row1).getByRole("button", { name: "型定義を再配布" });
    const redistributeButton2 = within(row2).getByRole("button", { name: "型定義を再配布" });
    await user.click(redistributeButton1);

    expect(redistributeButton1).toBeDisabled();
    expect(redistributeButton2).toBeEnabled();
    resolveRedistribute(jsonResponse(202, { ok: true }));
    await waitFor(() => expect(redistributeButton1).toBeEnabled());
  });
});
