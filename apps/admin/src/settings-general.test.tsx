import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  articleType,
  authedRoutes,
  bootstrapped,
  jsonResponse,
  renderAt,
  socketHarness,
} from "./test-utils/records-harness";

const tenantsOf = (name: string) =>
  jsonResponse(200, { tenants: [{ id: "t1", slug: "blog", name, role: "owner" }] });

describe("設定 › 一般", () => {
  it("/settings は一般へ転送し、h1「設定」とタブ 4 つが出て、一般が選ばれている", async () => {
    const router = renderAt("/t/blog/settings", socketHarness());
    expect(await screen.findByRole("heading", { level: 1, name: "設定" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/t/blog/settings/general");
    expect(screen.getAllByRole("tab")).toHaveLength(4);
    expect(screen.getByRole("tab", { name: "一般" })).toHaveAttribute("aria-selected", "true");
  });

  it("サイト名を保存すると PATCH /v1/t/t1/site を呼び、tenants を取り直してトーストを出す", async () => {
    const patch = vi.fn((_init?: RequestInit) => jsonResponse(200, { ok: true, name: "新名称" }));
    // 保存後の取り直し(2 回目以降)は新しい名前を返す
    const tenants = vi
      .fn()
      .mockImplementationOnce(() => tenantsOf("Blog"))
      .mockImplementation(() => tenantsOf("新名称"));
    const routes = authedRoutes({ "/v1/t/t1/site": patch, "/auth/tenants": tenants });
    renderAt("/t/blog/settings/general", socketHarness(), routes);
    const user = userEvent.setup();
    const input = await screen.findByRole("textbox", { name: "サイト名" });
    const callsBefore = tenants.mock.calls.length;
    await user.clear(input);
    await user.type(input, "新名称");
    await user.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    expect(JSON.parse(String(patch.mock.calls[0]?.[0]?.body))).toStrictEqual({ name: "新名称" });
    await waitFor(() => expect(tenants.mock.calls.length).toBeGreaterThan(callsBefore));
    // サイドバーの現在のサイト名が新しい名前に変わる(context の tenant が更新される)
    await waitFor(() => expect(screen.getAllByTitle("新名称").length).toBeGreaterThan(0));
    expect(
      await within(screen.getByRole("region", { name: "通知" })).findByText("保存しました"),
    ).toBeInTheDocument();
  });

  it("公開 API のベース URL は /_config のオリジンと slug から作り、型があれば例の行も出す", async () => {
    const harness = socketHarness();
    const routes = authedRoutes({
      "/_config": vi.fn(() => jsonResponse(200, { publicApiOrigin: "https://api.example" })),
    });
    renderAt("/t/blog/settings/general", harness, routes);
    await vi.waitFor(() => harness.latest());
    await bootstrapped(harness.latest(), [], [articleType]);
    expect(await screen.findByText("https://api.example/public/v1/blog/")).toBeInTheDocument();
    expect(await screen.findByText("例: 記事の一覧")).toBeInTheDocument();
    expect(
      screen.getByText("https://api.example/public/v1/blog/records/article"),
    ).toBeInTheDocument();
  });

  it("編集者が /settings/general を開くとホームへ転送される", async () => {
    const router = renderAt(
      "/t/blog/settings/general",
      socketHarness(),
      authedRoutes({}, "editor"),
    );
    await waitFor(() => expect(router.state.location.pathname).toBe("/t/blog"));
  });

  it("タブを押すと URL が変わる", async () => {
    const router = renderAt("/t/blog/settings/general", socketHarness());
    await userEvent.setup().click(await screen.findByRole("tab", { name: "モジュール" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/t/blog/settings/modules"));
  });

  it("/_config の取得に失敗すると公開 API のカードに alert と再試行が出て、再試行でベース URL が出る", async () => {
    const config = vi
      .fn()
      .mockImplementationOnce(() => jsonResponse(500, { error: "boom" }))
      .mockImplementation(() => jsonResponse(200, { publicApiOrigin: "https://api.example" }));
    renderAt("/t/blog/settings/general", socketHarness(), authedRoutes({ "/_config": config }));
    const card = await screen.findByRole("region", { name: "公開 API" });
    expect(await within(card).findByRole("alert")).toHaveTextContent("設定を読み込めませんでした");
    await userEvent.setup().click(within(card).getByRole("button", { name: "再試行" }));
    expect(
      await within(card).findByText("https://api.example/public/v1/blog/"),
    ).toBeInTheDocument();
    expect(within(card).queryByRole("alert")).not.toBeInTheDocument();
  });
});
