import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SyncRecord } from "@plyrs/sync-protocol";
import { describe, expect, it, vi } from "vitest";
import type { BulkBarProps } from "./components/bulk-bar";
import {
  article,
  authedRoutes,
  bootstrapped,
  jsonResponse,
  renderAt,
  socketHarness,
  type Handler,
} from "./test-utils/records-harness";

// 一括操作の配線だけを試すので、メニュー(RAC のポップオーバー)は素のボタンに差し替える
vi.mock("./components/bulk-bar", () => ({
  BulkBar: (props: BulkBarProps) => (
    <div role="region" aria-label="一括操作">
      <span>選択 {props.selectedCount}</span>
      {props.progress !== null && <span>実行中 {props.progress.done}</span>}
      <button type="button" onClick={() => props.onAction({ kind: "publish" })}>
        一括公開
      </button>
      <button type="button" onClick={() => props.onAction({ kind: "status", status: "draft" })}>
        一括ステータス下書き
      </button>
      {props.failure !== null && (
        <button type="button" onClick={props.failure.onRetry}>
          再試行
        </button>
      )}
      <button type="button" onClick={props.onClear}>
        解除
      </button>
    </div>
  ),
}));

const BASE = "/t/blog/content/article";
const ID_A = "018f2b6a-7a0a-7000-8000-000000000401";
const ID_B = "018f2b6a-7a0a-7000-8000-000000000402";

type Push = { changes: { changeId: string; status?: string }[] };

function records(status: SyncRecord["status"] = "draft"): SyncRecord[] {
  return [
    article(ID_A, "記事 A", { status, updatedAt: "2026-07-17T02:00:00Z" }),
    article(ID_B, "記事 B", { status, updatedAt: "2026-07-17T01:00:00Z" }),
  ];
}

async function setup(routes: Record<string, Handler>, status: SyncRecord["status"] = "draft") {
  const harness = socketHarness();
  renderAt(BASE, harness, authedRoutes(routes));
  await vi.waitFor(() => expect(harness.sockets.length).toBe(1));
  await bootstrapped(harness.latest(), records(status));
  const grid = within(await screen.findByRole("grid", { name: "記事の一覧" }));
  return { harness, grid, user: userEvent.setup() };
}

async function selectBoth(user: ReturnType<typeof userEvent.setup>) {
  const grid = within(await screen.findByRole("grid", { name: "記事の一覧" }));
  for (const box of grid.getAllByRole("checkbox").slice(1)) await user.click(box);
  await screen.findByText("選択 2");
}

function publishPath(id: string) {
  return `/v1/t/t1/records/${id}/publish`;
}

describe("一覧の一括操作", () => {
  it("選んだ行を順に公開し、トーストで件数を知らせて選択を解除する", async () => {
    const calls: string[] = [];
    const handler = (id: string): Handler =>
      vi.fn(() => {
        calls.push(id);
        return jsonResponse(200, { ok: true });
      });
    const { user } = await setup({
      [publishPath(ID_A)]: handler(ID_A),
      [publishPath(ID_B)]: handler(ID_B),
    });
    await selectBoth(user);
    await user.click(screen.getByRole("button", { name: "一括公開" }));
    const toasts = within(await screen.findByRole("region", { name: "通知" }));
    expect(await toasts.findByText("2 件を公開しました")).toBeInTheDocument();
    expect(calls).toEqual([ID_A, ID_B]);
    expect(screen.queryByRole("region", { name: "一括操作" })).not.toBeInTheDocument();
  });

  it("一部が失敗すると失敗分だけを選択に残し、再試行は失敗分だけを呼ぶ", async () => {
    let failB = true;
    const calls: string[] = [];
    const { user, grid } = await setup({
      [publishPath(ID_A)]: vi.fn(() => {
        calls.push(ID_A);
        return jsonResponse(200, { ok: true });
      }),
      [publishPath(ID_B)]: vi.fn(() => {
        calls.push(ID_B);
        return failB ? jsonResponse(500, { error: "internal" }) : jsonResponse(200, { ok: true });
      }),
    });
    await selectBoth(user);
    await user.click(screen.getByRole("button", { name: "一括公開" }));
    const toasts = within(await screen.findByRole("region", { name: "通知" }));
    expect(
      await toasts.findByText("1 件を公開しました。1 件は公開できませんでした"),
    ).toBeInTheDocument();
    expect(await screen.findByText("選択 1")).toBeInTheDocument();
    expect(grid.getAllByText("失敗")).toHaveLength(1);

    failB = false;
    await user.click(screen.getByRole("button", { name: "再試行" }));
    await vi.waitFor(() => expect(calls).toEqual([ID_A, ID_B, ID_B]));
    await vi.waitFor(() =>
      expect(screen.queryByRole("region", { name: "一括操作" })).not.toBeInTheDocument(),
    );
  });

  it("ステータスの一括変更は status を push する", async () => {
    const { harness, user, grid } = await setup({}, "ready");
    await user.click(grid.getAllByRole("checkbox")[1] as HTMLElement);
    await user.click(await screen.findByRole("button", { name: "一括ステータス下書き" }));
    const pushOf = () =>
      harness
        .latest()
        .parsed()
        .find((m) => (m as { type: string }).type === "push") as Push | undefined;
    await vi.waitFor(() => expect(pushOf()?.changes[0]?.status).toBe("draft"));
  });

  it("URL のクエリが変わると選択を解除する", async () => {
    const { user } = await setup({});
    await selectBoth(user);
    await user.click(screen.getByRole("tab", { name: /^未公開/ }));
    await vi.waitFor(() =>
      expect(screen.queryByRole("region", { name: "一括操作" })).not.toBeInTheDocument(),
    );
  });
});
