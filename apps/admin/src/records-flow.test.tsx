import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { EDITOR_LABELS } from "./lib/labels";
import {
  article,
  articleType,
  authedRoutes,
  bootstrapped,
  jsonResponse,
  RECORD_1,
  renderAt,
  socketHarness,
  type Handler,
  type SocketHarness,
} from "./test-utils/records-harness";

type Push = {
  changes: {
    recordId: string;
    typeKey?: string;
    changeId: string;
    input: Record<string, unknown>;
    changedFields: string[];
    baseFieldVersions: Record<string, number>;
    status?: string;
  }[];
};

function pushOf(harness: SocketHarness): Push | undefined {
  return harness
    .latest()
    .parsed()
    .find((message) => (message as { type: string }).type === "push") as Push | undefined;
}

// 通知の領域は最初のトーストが出るまで描かれない
async function toasts() {
  return within(await screen.findByRole("region", { name: "通知" }));
}

// 下部固定バーにも同名のボタンがあるため、公開ボックスの中で探す
function publishBox() {
  return within(screen.getByRole("region", { name: "公開" }));
}

// 作成画面の ID は実行時に決まるため、publish / publication は URL の形で受ける
function routesForNewRecord(publish: Handler) {
  const routes = authedRoutes();
  return new Proxy(routes, {
    get(target, key: string) {
      if (/^\/v1\/t\/t1\/records\/[^/]+\/publish$/.test(key)) return publish;
      if (/^\/v1\/t\/t1\/records\/[^/]+\/publication$/.test(key) && !(key in target)) {
        return vi.fn(() => jsonResponse(200, { published: false }));
      }
      return target[key];
    },
  });
}

describe("record 一覧（/t/$tenantSlug/content/$typeKey）", () => {
  it("lists synced records with workflow status", async () => {
    const harness = socketHarness();
    renderAt("/t/blog/content/article", harness);
    await vi.waitFor(() => expect(harness.sockets.length).toBe(1));
    await bootstrapped(harness.latest(), [article(RECORD_1, "こんにちは")]);
    expect(await screen.findByRole("cell", { name: "こんにちは" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "下書き" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "記事を追加" })).toBeInTheDocument();
  });

  it("shows the syncing state until the bootstrap completes", async () => {
    const harness = socketHarness();
    renderAt("/t/blog/content/article", harness);
    expect(
      await screen.findByRole("heading", { level: 1, name: "読み込み中" }),
    ).toBeInTheDocument();
  });
});

describe("record 新規作成", () => {
  it("作成画面の下書き保存は insert を push し、ack の後に編集画面の URL へ置き換える", async () => {
    const harness = socketHarness();
    const router = renderAt("/t/blog/content/article/new", harness, routesForNewRecord(vi.fn()));
    await vi.waitFor(() => expect(harness.sockets.length).toBe(1));
    await bootstrapped(harness.latest(), []);

    const user = userEvent.setup();
    await user.type(await screen.findByRole("textbox", { name: "title" }), "新しい記事");
    await user.click(publishBox().getByRole("button", { name: "下書き保存" }));

    await vi.waitFor(() => {
      expect(pushOf(harness)?.changes[0]).toMatchObject({
        typeKey: "article",
        input: { title: "新しい記事" },
        status: "draft",
      });
    });
    const change = pushOf(harness)?.changes[0];
    if (change === undefined) throw new Error("expected a pushed change");
    // ack の前は作成画面のまま
    expect(router.state.location.pathname).toBe("/t/blog/content/article/new");

    harness.latest().deliver({
      type: "ack",
      changeId: change.changeId,
      result: { ok: true, record: article(change.recordId, "新しい記事", { seq: 11, version: 1 }) },
    });
    await vi.waitFor(() =>
      expect(router.state.location.pathname).toBe(`/t/blog/content/article/${change.recordId}`),
    );
    expect(await (await toasts()).findByText("保存しました")).toBeInTheDocument();
    expect(
      await screen.findByRole("heading", { level: 1, name: "記事を編集" }),
    ).toBeInTheDocument();
  });

  it("作成画面の公開は作成の確定後に公開し、編集画面の URL に置き換える", async () => {
    const harness = socketHarness();
    const publish: Handler = vi.fn(() => jsonResponse(200, { ok: true }));
    const router = renderAt("/t/blog/content/article/new", harness, routesForNewRecord(publish));
    await vi.waitFor(() => expect(harness.sockets.length).toBe(1));
    await bootstrapped(harness.latest(), []);

    const user = userEvent.setup();
    await user.type(await screen.findByRole("textbox", { name: "title" }), "公開する記事");
    await user.click(publishBox().getByRole("button", { name: "公開" }));

    await vi.waitFor(() => expect(pushOf(harness)).toBeDefined());
    const change = pushOf(harness)?.changes[0];
    if (change === undefined) throw new Error("expected a pushed change");
    // push の ack を待つ間は公開を呼ばない
    expect(publish).not.toHaveBeenCalled();

    harness.latest().deliver({
      type: "ack",
      changeId: change.changeId,
      result: { ok: true, record: article(change.recordId, "公開する記事", { seq: 11 }) },
    });
    await vi.waitFor(() => expect(publish).toHaveBeenCalledTimes(1));
    await vi.waitFor(() =>
      expect(router.state.location.pathname).toBe(`/t/blog/content/article/${change.recordId}`),
    );
    expect(await (await toasts()).findByText("公開しました")).toBeInTheDocument();
  });
});

describe("record エディタ", () => {
  it("編集画面の「下書き保存」は変更したフィールドだけを push する", async () => {
    const harness = socketHarness();
    renderAt(`/t/blog/content/article/${RECORD_1}`, harness);
    await vi.waitFor(() => expect(harness.sockets.length).toBe(1));
    await bootstrapped(harness.latest(), [article(RECORD_1, "旧タイトル")]);

    const user = userEvent.setup();
    const input = await screen.findByRole("textbox", { name: "title" });
    await user.clear(input);
    await user.type(input, "新タイトル");
    await user.click(publishBox().getByRole("button", { name: "下書き保存" }));

    await vi.waitFor(() => {
      expect(pushOf(harness)?.changes[0]).toMatchObject({
        recordId: RECORD_1,
        changedFields: ["title"],
        baseFieldVersions: { title: 1 },
      });
    });
  });

  it("閲覧者には読み取り専用のフォームと「表示」のパンくずが出て、ボタンが無い", async () => {
    const harness = socketHarness();
    renderAt(`/t/blog/content/article/${RECORD_1}`, harness, authedRoutes({}, "viewer"));
    await vi.waitFor(() => expect(harness.sockets.length).toBe(1));
    await bootstrapped(harness.latest(), [article(RECORD_1, "読むだけ")]);

    expect(await screen.findByRole("textbox", { name: "title" })).toHaveAttribute("readonly");
    expect(publishBox().queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText(EDITOR_LABELS.crumbView)).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "記事を表示" })).toBeInTheDocument();
  });

  it("存在しない id は見つからない旨を出す", async () => {
    const harness = socketHarness();
    renderAt(`/t/blog/content/article/${RECORD_1}`, harness);
    await vi.waitFor(() => expect(harness.sockets.length).toBe(1));
    await bootstrapped(harness.latest(), []);
    expect(await screen.findByText(EDITOR_LABELS.notFound)).toBeInTheDocument();
  });

  it("未知の型は見つからない旨を出す", async () => {
    const harness = socketHarness();
    renderAt("/t/blog/content/ghost/new", harness);
    await vi.waitFor(() => expect(harness.sockets.length).toBe(1));
    await bootstrapped(harness.latest(), []);
    expect(await screen.findByText(EDITOR_LABELS.unknownType("ghost"))).toBeInTheDocument();
  });

  it("未保存の入力は切断をまたいで残る(§12 必須①)", async () => {
    const harness = socketHarness();
    renderAt(`/t/blog/content/article/${RECORD_1}`, harness);
    await vi.waitFor(() => expect(harness.sockets.length).toBe(1));
    await bootstrapped(harness.latest(), [article(RECORD_1, "旧タイトル")]);

    const user = userEvent.setup();
    const input = await screen.findByRole("textbox", { name: "title" });
    await user.clear(input);
    await user.type(input, "未保存の編集");

    // 異常クローズ → engine は新しいソケットで再接続を試みる(checkpoint 10 の hello)
    harness.latest().close(1006);
    await vi.waitFor(() => expect(harness.sockets.length).toBe(2));

    // フォームはアンマウントされず、未保存入力と再同期バナーが出る
    expect(screen.getByRole("textbox", { name: "title" })).toHaveValue("未保存の編集");
    // 接続バナーは TenantPageHeader だけが描く(サイドバーの同期表示も status を持つので文言で探す)
    expect(screen.getByText(/接続が切れています/)).toBeInTheDocument();

    // 再同期が完了するとバナーが消える(差分 hello は checkpoint 10)
    const socket2 = harness.latest();
    await vi.waitFor(() =>
      expect(socket2.parsed()).toContainEqual({ type: "hello", checkpoint: 10 }),
    );
    socket2.deliver({
      type: "welcome",
      protocolVersion: 1,
      contentTypes: [articleType],
      serverSeq: 10,
    });
    socket2.deliver({ type: "sync", records: [], serverSeq: 10, complete: true });
    await vi.waitFor(() =>
      expect(screen.queryByText(/接続が切れています/)).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("textbox", { name: "title" })).toHaveValue("未保存の編集");
  });
});
