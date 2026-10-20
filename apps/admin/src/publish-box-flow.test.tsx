import type { WorkflowStatus } from "@plyrs/metamodel";
import { createMemoryHistory } from "@tanstack/react-router";
import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { createAppContext, getRouter } from "./router";
import {
  article,
  authedRoutes,
  bootstrapped,
  jsonResponse,
  RECORD_1,
  renderAt,
  socketHarness,
  renderRouter,
  stubFetch,
  type Handler,
  type SocketHarness,
} from "./test-utils/records-harness";

// 編集画面の公開ボックス(案 C)。RAC の Modal を開く操作(取り下げ・削除・アーカイブの確認)は
// ここでは扱わない

const PATH = `/t/blog/content/article/${RECORD_1}`;

type Push = { changes: { changeId: string; status?: string; changedFields: string[] }[] };

function pushOf(harness: SocketHarness): Push | undefined {
  return harness
    .latest()
    .parsed()
    .find((message) => (message as { type: string }).type === "push") as Push | undefined;
}

// 下部固定バーにも同名のボタンがあるため、公開ボックスの中で探す
function publishBox() {
  return within(screen.getByRole("region", { name: "公開" }));
}

// 通知の領域は最初のトーストが出るまで描かれない
async function toasts() {
  return within(await screen.findByRole("region", { name: "通知" }));
}

const PUBLISHED_AT = "2026-07-17T02:00:00Z";

function publishedState(sourceVersion: number) {
  return jsonResponse(200, {
    published: true,
    publishedAt: PUBLISHED_AT,
    publishedBy: "u1",
    sourceVersion,
  });
}

async function openEditor(harness: SocketHarness, routes: Record<string, Handler>, version = 3) {
  renderAt(PATH, harness, routes);
  await vi.waitFor(() => expect(harness.sockets.length).toBe(1));
  await bootstrapped(harness.latest(), [article(RECORD_1, "旧タイトル", { version })]);
  return userEvent.setup();
}

async function editTitle(user: ReturnType<typeof userEvent.setup>, value: string) {
  const input = await screen.findByRole("textbox", { name: "title" });
  await user.clear(input);
  await user.type(input, value);
}

// react-aria-components の Select は、ページ規模の DOM 上でポップオーバーを開閉すると jsdom で
// 戻らなくなることがある。RAC が描く非表示のネイティブ <select> の change で選択を再現する
async function selectWorkflowStatus(value: WorkflowStatus): Promise<void> {
  let nativeSelect: HTMLSelectElement | null = null;
  await vi.waitFor(() => {
    nativeSelect = document.querySelector("select");
    expect(nativeSelect).not.toBeNull();
  });
  if (nativeSelect === null) {
    throw new Error("hidden native select not found");
  }
  fireEvent.change(nativeSelect, { target: { value } });
}

describe("公開ボックス(/t/$tenantSlug/content/$typeKey/$recordId)", () => {
  it("未公開の「公開」は publish API を呼び、公開中のバッジと「更新」に変わる", async () => {
    const harness = socketHarness();
    let published = false;
    const publish: Handler = vi.fn(() => {
      published = true;
      return jsonResponse(200, { ok: true });
    });
    const user = await openEditor(
      harness,
      authedRoutes({
        [`/v1/t/t1/records/${RECORD_1}/publication`]: vi.fn(() =>
          published ? publishedState(3) : jsonResponse(200, { published: false }),
        ),
        [`/v1/t/t1/records/${RECORD_1}/publish`]: publish,
      }),
    );
    expect(await publishBox().findByText("未公開")).toBeInTheDocument();

    await user.click(publishBox().getByRole("button", { name: "公開" }));

    expect(await publishBox().findByText("公開中")).toBeInTheDocument();
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publishBox().getByRole("button", { name: "更新" })).toBeInTheDocument();
    expect(await (await toasts()).findByText("公開しました")).toBeInTheDocument();
  });

  it("未保存の編集がある状態の更新は、push の ack の後に publish を呼ぶ", async () => {
    const harness = socketHarness();
    const publish: Handler = vi.fn(() => jsonResponse(200, { ok: true }));
    const user = await openEditor(
      harness,
      authedRoutes({
        [`/v1/t/t1/records/${RECORD_1}/publication`]: vi.fn(() => publishedState(3)),
        [`/v1/t/t1/records/${RECORD_1}/publish`]: publish,
      }),
    );
    await publishBox().findByText("公開中");
    await editTitle(user, "新タイトル");
    await user.click(publishBox().getByRole("button", { name: "更新" }));

    await vi.waitFor(() => expect(pushOf(harness)).toBeDefined());
    const change = pushOf(harness)?.changes[0];
    if (change === undefined) throw new Error("expected a pushed change");
    expect(publish).not.toHaveBeenCalled();

    harness.latest().deliver({
      type: "ack",
      changeId: change.changeId,
      result: { ok: true, record: article(RECORD_1, "新タイトル", { seq: 11, version: 4 }) },
    });
    await vi.waitFor(() => expect(publish).toHaveBeenCalledTimes(1));
    expect(await (await toasts()).findByText("更新しました")).toBeInTheDocument();
  });

  it("公開に失敗すると保存は残り、エラーのトーストの「公開を再試行」で公開だけをやり直す", async () => {
    const harness = socketHarness();
    const publish: Handler = vi
      .fn<Handler>()
      .mockImplementationOnce(() => jsonResponse(500, { error: "internal" }))
      .mockImplementation(() => jsonResponse(200, { ok: true }));
    const user = await openEditor(
      harness,
      authedRoutes({ [`/v1/t/t1/records/${RECORD_1}/publish`]: publish }),
    );
    await editTitle(user, "新タイトル");
    await user.click(publishBox().getByRole("button", { name: "公開" }));

    await vi.waitFor(() => expect(pushOf(harness)).toBeDefined());
    const change = pushOf(harness)?.changes[0];
    if (change === undefined) throw new Error("expected a pushed change");
    harness.latest().deliver({
      type: "ack",
      changeId: change.changeId,
      result: { ok: true, record: article(RECORD_1, "新タイトル", { seq: 11, version: 2 }) },
    });

    const alert = await (await toasts()).findByRole("alert");
    expect(alert).toHaveTextContent("保存しましたが、公開できませんでした");
    expect(publish).toHaveBeenCalledTimes(1);

    await user.click(within(alert).getByRole("button", { name: "公開を再試行" }));
    await vi.waitFor(() => expect(publish).toHaveBeenCalledTimes(2));
    expect(await (await toasts()).findByText("公開しました")).toBeInTheDocument();
    // 保存のやり直しはしない
    const pushes = harness
      .latest()
      .parsed()
      .filter((message) => (message as { type: string }).type === "push");
    expect(pushes).toHaveLength(1);
  });

  it("公開後に編集されていると「未反映の変更があります」と「公開せずに保存」が出る", async () => {
    const harness = socketHarness();
    await openEditor(
      harness,
      authedRoutes({
        [`/v1/t/t1/records/${RECORD_1}/publication`]: vi.fn(() => publishedState(1)),
      }),
    );
    expect(await publishBox().findByText("未反映の変更があります")).toBeInTheDocument();
    expect(publishBox().getByRole("button", { name: "公開せずに保存" })).toBeInTheDocument();
    expect(publishBox().getByRole("button", { name: "更新" })).toBeInTheDocument();
  });

  it("切断中は「更新」が aria-disabled で「公開せずに保存」は押せる", async () => {
    const harness = socketHarness();
    await openEditor(
      harness,
      authedRoutes({
        [`/v1/t/t1/records/${RECORD_1}/publication`]: vi.fn(() => publishedState(1)),
      }),
    );
    await publishBox().findByText("未反映の変更があります");

    harness.latest().close(1006);
    await vi.waitFor(() =>
      expect(publishBox().getByRole("button", { name: "更新" })).toHaveAttribute(
        "aria-disabled",
        "true",
      ),
    );
    const secondary = publishBox().getByRole("button", { name: "公開せずに保存" });
    expect(secondary).not.toHaveAttribute("aria-disabled", "true");
    expect(secondary).toBeEnabled();
  });

  it("ステータスの変更は status だけを push しトーストを出す", async () => {
    const harness = socketHarness();
    await openEditor(harness, authedRoutes());
    await publishBox().findByText("未公開");

    await selectWorkflowStatus("in_review");

    await vi.waitFor(() => {
      expect(pushOf(harness)?.changes[0]).toMatchObject({
        status: "in_review",
        changedFields: [],
      });
    });
    const change = pushOf(harness)?.changes[0];
    if (change === undefined) throw new Error("expected a pushed change");
    harness.latest().deliver({
      type: "ack",
      changeId: change.changeId,
      result: {
        ok: true,
        record: article(RECORD_1, "旧タイトル", { status: "in_review", seq: 11, version: 4 }),
      },
    });
    expect(await (await toasts()).findByText("ステータスを変更しました")).toBeInTheDocument();
  });

  it("モジュールの panel スロットは公開ボックスの下に描かれ、コアの登録は無い", async () => {
    const harness = socketHarness();
    const context = createAppContext(stubFetch(authedRoutes()), {
      connect: () => harness.connect,
    });
    expect(context.slots.get("record-editor:toolbar")).toEqual([]);
    expect(context.slots.get("record-editor:panel")).toEqual([]);
    context.slots.register("record-editor:panel", {
      id: "booking.summary",
      title: "予約の概要",
      order: 0,
      render: ({ recordId }) => <p>予約 {recordId}</p>,
    });
    const router = getRouter({
      context,
      history: createMemoryHistory({ initialEntries: [PATH] }),
    });
    renderRouter(router);
    await vi.waitFor(() => expect(harness.sockets.length).toBe(1));
    await bootstrapped(harness.latest(), [article(RECORD_1, "旧タイトル")]);

    expect(
      await screen.findByRole("heading", { level: 2, name: "予約の概要" }),
    ).toBeInTheDocument();
    expect(screen.getByText(`予約 ${RECORD_1}`)).toBeInTheDocument();
    const box = screen.getByRole("region", { name: "公開" });
    const heading = screen.getByRole("heading", { level: 2, name: "予約の概要" });
    expect(box.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
