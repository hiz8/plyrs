import type { ContentTypeDefinition } from "@plyrs/metamodel";
import type { SyncRecord } from "@plyrs/sync-protocol";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, type Mock } from "vitest";
import { createAppContext, getRouter } from "./router";
import { FakeSocket } from "./test-utils/fake-socket";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

type Handler = Mock<(init?: RequestInit) => Response>;

function stubFetch(routes: Record<string, Handler>): typeof fetch {
  return async (input, init) => {
    const path =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.pathname
          : new URL(input.url).pathname;
    const handler = routes[path];
    if (handler === undefined) {
      throw new Error(`unexpected fetch: ${path}`);
    }
    return handler(init ?? undefined);
  };
}

const blogTenant = { id: "t1", slug: "blog", name: "Blog", role: "owner" };

function authedRoutes(overrides: Record<string, Handler> = {}): Record<string, Handler> {
  return {
    "/auth/tenants": vi.fn(() => jsonResponse(200, { tenants: [blogTenant] })),
    "/auth/token": vi.fn(() => jsonResponse(200, { token: "jwt-abc", expiresIn: 900 })),
    "/v1/t/t1/content-types": vi.fn(() => jsonResponse(200, { contentTypes: [] })),
    // Task 11: エディタルートが record-editor:toolbar/panel スロット経由で
    // publication を fetch するようになったため、既存のエディタ系テストにも要スタブ。
    [`/v1/t/t1/records/${RECORD_1}/publication`]: vi.fn(() =>
      jsonResponse(200, { published: false }),
    ),
    ...overrides,
  };
}

const articleType: ContentTypeDefinition = {
  id: "018f2b6a-7a0a-7000-8000-000000000001",
  key: "article",
  name: "記事",
  source: "user",
  version: 1,
  fields: [{ key: "title", type: "text", required: true }],
};

function article(id: string, title: string, overrides: Partial<SyncRecord> = {}): SyncRecord {
  return {
    id,
    type: "article",
    input: { title },
    fieldVersions: { title: 1 },
    status: "draft",
    seq: 2,
    version: 1,
    deletedAt: null,
    updatedAt: "2026-07-17T00:00:00Z",
    updatedBy: "u1",
    ...overrides,
  };
}

const RECORD_1 = "018f2b6a-7a0a-7000-8000-000000000101";

// ソケットを test 側で握るヘルパー。エンジンの接続確立ごとに新しい FakeSocket を返す。
function socketHarness() {
  const sockets: FakeSocket[] = [];
  const connect = async () => {
    const socket = new FakeSocket();
    sockets.push(socket);
    return socket;
  };
  return {
    sockets,
    connect,
    // noUncheckedIndexedAccess: 呼び出し側は必ず接続確立後に呼ぶ前提(実行時には未到達)。
    // `!` は使わず、他の未定義ガード同様に明示 throw で境界を扱う。
    latest: (): FakeSocket => {
      const socket = sockets[sockets.length - 1];
      if (socket === undefined) {
        throw new Error("expected at least one connected socket");
      }
      return socket;
    },
  };
}

async function bootstrapped(socket: FakeSocket, records: SyncRecord[]) {
  await vi.waitFor(() => expect(socket.parsed()).toContainEqual({ type: "hello", checkpoint: 0 }));
  socket.deliver({
    type: "welcome",
    protocolVersion: 1,
    contentTypes: [articleType],
    serverSeq: 10,
  });
  socket.deliver({ type: "sync", records, serverSeq: 10, complete: true });
}

function renderAt(
  path: string,
  harness: ReturnType<typeof socketHarness>,
  routes = authedRoutes(),
) {
  const router = getRouter({
    context: createAppContext(stubFetch(routes), { connect: () => harness.connect }),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  render(<RouterProvider router={router} />);
  return router;
}

describe("record 一覧（/t/$tenantSlug/records/$typeKey）", () => {
  it("lists synced records with workflow status", async () => {
    const harness = socketHarness();
    renderAt("/t/blog/records/article", harness);
    await vi.waitFor(() => expect(harness.sockets.length).toBe(1));
    await bootstrapped(harness.latest(), [article(RECORD_1, "こんにちは")]);
    expect(await screen.findByRole("cell", { name: "こんにちは" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "下書き" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "新規レコード" })).toBeInTheDocument();
  });

  it("shows the syncing state until the bootstrap completes", async () => {
    const harness = socketHarness();
    renderAt("/t/blog/records/article", harness);
    expect(await screen.findByText(/同期中/)).toBeInTheDocument();
  });
});

describe("record 新規作成", () => {
  it("inserts a record through the collection and pushes it to the socket", async () => {
    const harness = socketHarness();
    renderAt("/t/blog/records/article/new", harness);
    await vi.waitFor(() => expect(harness.sockets.length).toBe(1));
    await bootstrapped(harness.latest(), []);

    const user = userEvent.setup();
    await user.type(await screen.findByRole("textbox", { name: "title" }), "新しい記事");
    await user.click(screen.getByRole("button", { name: "作成" }));

    // push が飛び、input に title が載る
    await vi.waitFor(() => {
      const push = harness
        .latest()
        .parsed()
        .find((message) => (message as { type: string }).type === "push") as
        | {
            changes: {
              recordId: string;
              typeKey: string;
              input: Record<string, unknown>;
              changeId: string;
              status?: string;
            }[];
          }
        | undefined;
      expect(push).toBeDefined();
      expect(push?.changes[0]).toMatchObject({
        typeKey: "article",
        input: { title: "新しい記事" },
        status: "draft",
      });
    });

    // ack を返すと一覧へ遷移し、確定レコードが表示される
    const push = harness
      .latest()
      .parsed()
      .find((message) => (message as { type: string }).type === "push") as {
      changes: { recordId: string; changeId: string }[];
    };
    const change = push.changes[0];
    if (change === undefined) throw new Error("expected a pushed change");
    harness.latest().deliver({
      type: "ack",
      changeId: change.changeId,
      result: { ok: true, record: article(change.recordId, "新しい記事", { seq: 11, version: 1 }) },
    });
    expect(await screen.findByRole("cell", { name: "新しい記事" })).toBeInTheDocument();
  });
});

describe("record エディタ", () => {
  it("edits an existing record and pushes only the changed field", async () => {
    const harness = socketHarness();
    renderAt(`/t/blog/records/article/${RECORD_1}`, harness);
    await vi.waitFor(() => expect(harness.sockets.length).toBe(1));
    await bootstrapped(harness.latest(), [article(RECORD_1, "旧タイトル")]);

    const user = userEvent.setup();
    const input = await screen.findByRole("textbox", { name: "title" });
    await user.clear(input);
    await user.type(input, "新タイトル");
    await user.click(screen.getByRole("button", { name: "保存" }));

    await vi.waitFor(() => {
      const push = harness
        .latest()
        .parsed()
        .find((message) => (message as { type: string }).type === "push") as
        | {
            changes: {
              recordId: string;
              changedFields: string[];
              baseFieldVersions: Record<string, number>;
            }[];
          }
        | undefined;
      expect(push?.changes[0]).toMatchObject({
        recordId: RECORD_1,
        changedFields: ["title"],
        baseFieldVersions: { title: 1 },
      });
    });
  });

  it("shows a not-found message for a missing record after sync completes", async () => {
    const harness = socketHarness();
    renderAt(`/t/blog/records/article/${RECORD_1}`, harness);
    await vi.waitFor(() => expect(harness.sockets.length).toBe(1));
    await bootstrapped(harness.latest(), []);
    expect(await screen.findByText(/レコードが見つかりません/)).toBeInTheDocument();
  });

  it("deletes the record after confirmation and navigates back to the list", async () => {
    const harness = socketHarness();
    renderAt(`/t/blog/records/article/${RECORD_1}`, harness);
    await vi.waitFor(() => expect(harness.sockets.length).toBe(1));
    await bootstrapped(harness.latest(), [article(RECORD_1, "消える記事")]);

    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "削除" }));
    await user.click(await screen.findByRole("button", { name: "削除を確定" }));

    await vi.waitFor(() => {
      const push = harness
        .latest()
        .parsed()
        .find((message) => (message as { type: string }).type === "push") as
        | { changes: { op: string; recordId: string; changeId: string }[] }
        | undefined;
      expect(push?.changes[0]).toMatchObject({ op: "delete", recordId: RECORD_1 });
    });
    const push = harness
      .latest()
      .parsed()
      .find((message) => (message as { type: string }).type === "push") as {
      changes: { changeId: string }[];
    };
    const change = push.changes[0];
    if (change === undefined) throw new Error("expected a pushed change");
    harness.latest().deliver({
      type: "ack",
      changeId: change.changeId,
      result: {
        ok: true,
        record: article(RECORD_1, "", { seq: 12, deletedAt: "2026-07-17T01:00:00Z", input: {} }),
      },
    });
    expect(await screen.findByText(/レコードはまだありません/)).toBeInTheDocument();
  });

  it("shows the unknown-type message for a type that does not exist", async () => {
    const harness = socketHarness();
    renderAt("/t/blog/records/ghost", harness);
    await vi.waitFor(() => expect(harness.sockets.length).toBe(1));
    await bootstrapped(harness.latest(), []);
    expect(await screen.findByText(/未知のコンテンツタイプ/)).toBeInTheDocument();
  });

  it("keeps the form mounted with unsaved input across a disconnect (§12 必須①)", async () => {
    const harness = socketHarness();
    renderAt(`/t/blog/records/article/${RECORD_1}`, harness);
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
    expect(screen.getByRole("status")).toHaveTextContent(/再同期中/);

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
    await vi.waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
    expect(screen.getByRole("textbox", { name: "title" })).toHaveValue("未保存の編集");
  });
});
