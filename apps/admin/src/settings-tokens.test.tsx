import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TOKEN_LABELS } from "./lib/labels";
import { authedRoutes, jsonResponse, renderAt, socketHarness } from "./test-utils/records-harness";

// M1-4: 設定 › 接続中のアプリ。一覧は GET /v1/t/t1/tokens、発行は POST、失効は DELETE。
// M3-5: OAuth の付与(GET /v1/t/t1/oauth-grants)も同じ一覧に並び、失効は DELETE /oauth-grants/:userId/:grantId。
// 管理者以外は画面に入れない(API 側も 403)。

const token = {
  id: "tok1",
  userId: "u1",
  name: "Claude Code",
  scopes: ["record:read"],
  expiresAt: "2099-12-01T00:00:00Z",
  createdAt: "2026-10-01T00:00:00Z",
  lastUsedAt: null,
  revokedAt: null,
};

const grant = {
  id: "g1",
  userId: "u2",
  email: "editor@example.com",
  clientId: "c1",
  clientName: "Claude",
  scopes: ["record:read"],
  createdAt: "2026-10-15T00:00:00Z",
  expiresAt: null,
  pending: false,
};

const noGrants = () => jsonResponse(200, { grants: [] });

describe("設定 › 接続中のアプリ", () => {
  it("一覧と接続先(/_config のオリジン + /mcp/t/<tenantId>)を出す", async () => {
    const routes = authedRoutes({
      "/v1/t/t1/tokens": vi.fn(() => jsonResponse(200, { tokens: [token] })),
      "/v1/t/t1/oauth-grants": vi.fn(noGrants),
      "/_config": vi.fn(() => jsonResponse(200, { publicApiOrigin: "https://api.example" })),
    });
    renderAt("/t/blog/settings/tokens", socketHarness(), routes);
    expect(await screen.findByText("Claude Code")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: TOKEN_LABELS.tab })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(await screen.findByText("https://api.example/mcp/t/t1")).toBeInTheDocument();
  });

  it("発行すると POST /v1/t/t1/tokens を呼び、返った token を 1 回だけ見せる", async () => {
    const post = vi.fn((_init?: RequestInit) =>
      jsonResponse(201, {
        id: "tok9",
        token: "plyrs_pat_secret",
        expiresAt: "2099-12-01T00:00:00Z",
      }),
    );
    const routes = authedRoutes({
      "/v1/t/t1/tokens": vi.fn((init?: RequestInit) =>
        init?.method === "POST" ? post(init) : jsonResponse(200, { tokens: [] }),
      ),
      "/v1/t/t1/oauth-grants": vi.fn(noGrants),
    });
    renderAt("/t/blog/settings/tokens", socketHarness(), routes);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: TOKEN_LABELS.issue }));
    await user.type(screen.getByRole("textbox", { name: TOKEN_LABELS.issueDialog.name }), "CI");
    await user.click(screen.getByRole("button", { name: TOKEN_LABELS.issueDialog.submit }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(JSON.parse(String(post.mock.calls[0]?.[0]?.body))).toStrictEqual({
      name: "CI",
      scopes: ["record:read"],
      expiresInDays: 90,
    });
    expect(await screen.findByText("plyrs_pat_secret")).toBeInTheDocument();
  });

  it("失効は確認の後に DELETE /v1/t/t1/tokens/:id を呼ぶ", async () => {
    const del = vi.fn(() => jsonResponse(200, { ok: true }));
    const routes = authedRoutes({
      "/v1/t/t1/tokens": vi.fn(() => jsonResponse(200, { tokens: [token] })),
      "/v1/t/t1/oauth-grants": vi.fn(noGrants),
      "/v1/t/t1/tokens/tok1": del,
    });
    renderAt("/t/blog/settings/tokens", socketHarness(), routes);
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", { name: TOKEN_LABELS.revokeOf("Claude Code") }),
    );
    await user.click(screen.getByRole("button", { name: TOKEN_LABELS.revokeDialog.confirm }));
    await waitFor(() => expect(del).toHaveBeenCalledTimes(1));
    expect(
      await within(screen.getByRole("region", { name: "通知" })).findByText(
        TOKEN_LABELS.revoked("Claude Code"),
      ),
    ).toBeInTheDocument();
  });

  it("OAuth の付与は PAT と同じ一覧に並び、失効は DELETE /v1/t/t1/oauth-grants/:userId/:grantId を呼ぶ(M3-5)", async () => {
    const del = vi.fn((_init?: RequestInit) => jsonResponse(200, { ok: true }));
    const routes = authedRoutes({
      "/v1/t/t1/tokens": vi.fn(() => jsonResponse(200, { tokens: [token] })),
      "/v1/t/t1/oauth-grants": vi.fn(() => jsonResponse(200, { grants: [grant] })),
      "/v1/t/t1/oauth-grants/u2/g1": del,
    });
    renderAt("/t/blog/settings/tokens", socketHarness(), routes);
    expect(await screen.findByText("Claude Code")).toBeInTheDocument();
    expect(await screen.findByText("Claude")).toBeInTheDocument();
    expect(screen.getByText("editor@example.com")).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: TOKEN_LABELS.revokeOf("Claude") }));
    expect(screen.getByText(TOKEN_LABELS.revokeDialog.bodyOauth)).toBeVisible();
    await user.click(screen.getByRole("button", { name: TOKEN_LABELS.revokeDialog.confirm }));
    await waitFor(() => expect(del).toHaveBeenCalledTimes(1));
    expect(del.mock.calls[0]?.[0]?.method).toBe("DELETE");
    expect(
      await within(screen.getByRole("region", { name: "通知" })).findByText(
        TOKEN_LABELS.revoked("Claude"),
      ),
    ).toBeInTheDocument();
  });

  it("OAuth の付与の取得だけ失敗しても PAT の一覧は出し、別に知らせる", async () => {
    const routes = authedRoutes({
      "/v1/t/t1/tokens": vi.fn(() => jsonResponse(200, { tokens: [token] })),
      "/v1/t/t1/oauth-grants": vi.fn(() => jsonResponse(500, { error: "boom" })),
    });
    renderAt("/t/blog/settings/tokens", socketHarness(), routes);
    expect(await screen.findByText("Claude Code")).toBeInTheDocument();
    expect(await screen.findByText(TOKEN_LABELS.grantsLoadFailed)).toBeInTheDocument();
  });

  it("編集者は画面に入れずホームへ戻る", async () => {
    const router = renderAt("/t/blog/settings/tokens", socketHarness(), authedRoutes({}, "editor"));
    await waitFor(() => expect(router.state.location.pathname).toBe("/t/blog"));
  });
});
