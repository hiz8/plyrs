import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EDITOR_LABELS } from "./lib/labels";
import {
  article,
  authedRoutes,
  bootstrapped,
  jsonResponse,
  RECORD_1,
  renderAt,
  socketHarness,
} from "./test-utils/records-harness";

type Push = { changes: { changeId: string; op: string }[] };

describe("コンテンツの削除", () => {
  it("公開中のコンテンツの削除は警告付きの確認を経て一覧へ戻る", async () => {
    const harness = socketHarness();
    const router = renderAt(
      `/t/blog/content/article/${RECORD_1}`,
      harness,
      authedRoutes({
        [`/v1/t/t1/records/${RECORD_1}/publication`]: vi.fn(() =>
          jsonResponse(200, {
            published: true,
            publishedAt: "2026-07-17T02:00:00Z",
            publishedBy: "u1",
            sourceVersion: 1,
          }),
        ),
      }),
    );
    await vi.waitFor(() => expect(harness.sockets.length).toBe(1));
    await bootstrapped(harness.latest(), [article(RECORD_1, "旧タイトル")]);
    const box = within(await screen.findByRole("region", { name: "公開" }));
    await box.findByText("公開中");

    fireEvent.click(box.getByRole("button", { name: "削除" }));

    const dialog = await screen.findByRole("alertdialog", { name: "記事を削除しますか？" });
    expect(within(dialog).getByText(/この記事は公開中です/)).toBeInTheDocument();
    expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "キャンセル" }));

    fireEvent.click(within(dialog).getByRole("button", { name: "削除する" }));

    // 確認後すぐ一覧へ移る。確定を待つ間も「見つかりませんでした」には置き換わらない
    await vi.waitFor(() => expect(router.state.location.pathname).toBe("/t/blog/content/article"));
    expect(screen.queryByText(EDITOR_LABELS.notFound)).toBeNull();

    const pushOf = () =>
      harness
        .latest()
        .parsed()
        .find((message) => (message as { type: string }).type === "push") as Push | undefined;
    await vi.waitFor(() => expect(pushOf()?.changes[0]?.op).toBe("delete"));
    harness.latest().deliver({
      type: "ack",
      changeId: pushOf()?.changes[0]?.changeId ?? "",
      result: {
        ok: true,
        record: article(RECORD_1, "旧タイトル", {
          seq: 11,
          version: 2,
          deletedAt: "2026-07-17T03:00:00Z",
        }),
      },
    });

    expect(screen.queryByText(EDITOR_LABELS.notFound)).toBeNull();
    const toasts = within(await screen.findByRole("region", { name: "通知" }));
    expect(await toasts.findByText("削除しました")).toBeInTheDocument();
  });
});
