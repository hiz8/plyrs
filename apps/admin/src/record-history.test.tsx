import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  article,
  articleType,
  authedRoutes,
  bootstrapped,
  jsonResponse,
  RECORD_1,
  renderAt,
  socketHarness,
} from "./test-utils/records-harness";

// 16.5(M2-5): record の履歴画面。一覧(経路のバッジ)・現在との差分・復元の確認とロール

const AGENT = "018f2b6a-7a0a-7000-8000-0000000000aa";

const historyBody = {
  ok: true,
  output: {
    items: [
      {
        historySeq: 2,
        kind: "write",
        version: 2,
        sourceVersion: null,
        status: "draft",
        changedFields: ["title"],
        actor: AGENT,
        via: "mcp",
        tokenId: "tok",
        clientId: null,
        restoredFrom: null,
        createdAt: "2026-11-02T00:10:00.000Z",
        updatedAt: "2026-11-02T00:10:00.000Z",
      },
      {
        historySeq: 1,
        kind: "write",
        version: 1,
        sourceVersion: null,
        status: "draft",
        changedFields: ["title"],
        actor: "u1",
        via: "sync",
        tokenId: null,
        clientId: null,
        restoredFrom: null,
        createdAt: "2026-11-02T00:00:00.000Z",
        updatedAt: "2026-11-02T00:00:00.000Z",
      },
    ],
    nextCursor: null,
  },
};

const compareBody = {
  ok: true,
  output: {
    from: { ref: "history", historySeq: 1, version: 1, at: "2026-11-02T00:00:00.000Z" },
    to: { ref: "current", version: 2, at: "2026-11-02T00:10:00.000Z" },
    fields: [{ key: "title", before: "旧タイトル", after: "新タイトル" }],
  },
};

function routesFor(role = "owner") {
  const history = vi.fn(() => jsonResponse(200, historyBody));
  const compare = vi.fn((_init?: RequestInit) => jsonResponse(200, compareBody));
  const restore = vi.fn((_init?: RequestInit) =>
    jsonResponse(200, { ok: true, output: { id: RECORD_1, version: 1 } }),
  );
  const routes = authedRoutes(
    {
      "/v1/t/t1/ops/record_history": history,
      "/v1/t/t1/ops/record_compare": compare,
      "/v1/t/t1/ops/record_restore": restore,
      "/v1/t/t1/members": vi.fn(() =>
        jsonResponse(200, {
          members: [{ userId: AGENT, email: "ai@example.com", role: "editor", createdAt: "" }],
        }),
      ),
    },
    role,
  );
  return { routes, history, compare, restore };
}

const PATH = `/t/blog/content/article/${RECORD_1}/history`;

async function open(role = "owner") {
  const harness = socketHarness();
  const stubs = routesFor(role);
  const router = renderAt(PATH, harness, stubs.routes);
  await vi.waitFor(() => harness.latest());
  await bootstrapped(harness.latest(), [article(RECORD_1, "新タイトル")], [articleType]);
  expect(await screen.findByRole("heading", { level: 1, name: "履歴" })).toBeInTheDocument();
  return { router, ...stubs };
}

describe("record の履歴画面", () => {
  it("版を新しい順に出し、MCP 経由の版には MCP のバッジとメンバー名が付く", async () => {
    await open();
    const list = await screen.findByRole("list", { name: "版の一覧" });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("MCP");
    expect(items[0]).toHaveTextContent("ai@example.com がMCPから 1 フィールドを変更");
    expect(items[1]).toHaveTextContent("管理画面");
  });

  it("版を選ぶと現在との差分がフィールドごとに出る", async () => {
    const { compare } = await open();
    const user = userEvent.setup();
    const list = await screen.findByRole("list", { name: "版の一覧" });
    await user.click(within(list).getAllByRole("button")[1]!);
    const panel = screen.getByRole("region", { name: "現在との差分" });
    expect(await within(panel).findByText("旧タイトル")).toBeInTheDocument();
    expect(within(panel).getByText("新タイトル")).toBeInTheDocument();
    expect(JSON.parse(String(compare.mock.calls[0]?.[0]?.body))).toStrictEqual({
      recordId: RECORD_1,
      from: 1,
    });
  });

  it("「この版に戻す」は確認を経て record_restore を呼び、編集画面へ戻る", async () => {
    const { router, restore } = await open();
    const user = userEvent.setup();
    const list = await screen.findByRole("list", { name: "版の一覧" });
    await user.click(within(list).getAllByRole("button")[1]!);
    const panel = screen.getByRole("region", { name: "現在との差分" });
    await user.click(await within(panel).findByRole("button", { name: "この版に戻す" }));
    const dialog = await screen.findByRole("dialog", { name: "この版に戻しますか？" });
    await user.click(within(dialog).getByRole("button", { name: "この版に戻す" }));
    await waitFor(() => expect(restore).toHaveBeenCalledTimes(1));
    expect(JSON.parse(String(restore.mock.calls[0]?.[0]?.body))).toStrictEqual({
      recordId: RECORD_1,
      historySeq: 1,
    });
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(`/t/blog/content/article/${RECORD_1}`),
    );
    expect(
      await within(screen.getByRole("region", { name: "通知" })).findByText("この版に戻しました"),
    ).toBeInTheDocument();
  });

  it("viewer には復元のボタンが無い", async () => {
    await open("viewer");
    const user = userEvent.setup();
    const list = await screen.findByRole("list", { name: "版の一覧" });
    await user.click(within(list).getAllByRole("button")[1]!);
    const panel = screen.getByRole("region", { name: "現在との差分" });
    expect(await within(panel).findByText("旧タイトル")).toBeInTheDocument();
    expect(within(panel).queryByRole("button", { name: "この版に戻す" })).not.toBeInTheDocument();
  });
});
