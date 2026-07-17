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

const RECORD_1 = "018f2b6a-7a0a-7000-8000-000000000101";

function authedRoutes(): Record<string, Handler> {
  return {
    "/auth/tenants": vi.fn(() =>
      jsonResponse(200, { tenants: [{ id: "t1", slug: "blog", name: "Blog", role: "owner" }] }),
    ),
    "/auth/token": vi.fn(() => jsonResponse(200, { token: "jwt-abc", expiresIn: 900 })),
    "/v1/t/t1/content-types": vi.fn(() => jsonResponse(200, { contentTypes: [] })),
    [`/v1/t/t1/records/${RECORD_1}/publication`]: vi.fn(() =>
      jsonResponse(200, { published: false }),
    ),
  };
}

const articleType: ContentTypeDefinition = {
  id: "018f2b6a-7a0a-7000-8000-000000000001",
  key: "article",
  name: "記事",
  source: "user",
  version: 1,
  fields: [
    { key: "title", type: "text", required: true },
    { key: "body", type: "richtext" },
  ],
};

function bodyEnvelope(text: string): Record<string, unknown> {
  return {
    schemaVersion: 1,
    doc: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] },
  };
}

function article(overrides: Partial<SyncRecord> = {}): SyncRecord {
  return {
    id: RECORD_1,
    type: "article",
    input: { title: "旧タイトル", body: bodyEnvelope("旧本文") },
    fieldVersions: { title: 1, body: 1 },
    status: "draft",
    seq: 2,
    version: 1,
    deletedAt: null,
    updatedAt: "2026-07-17T00:00:00Z",
    updatedBy: "u1",
    ...overrides,
  };
}

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
    // noUncheckedIndexedAccess: records-flow.test.tsx と同じ境界ガード方針(`!` は使わない)
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

function renderEditor(harness: ReturnType<typeof socketHarness>) {
  const router = getRouter({
    context: createAppContext(stubFetch(authedRoutes()), { connect: () => harness.connect }),
    history: createMemoryHistory({ initialEntries: [`/t/blog/records/article/${RECORD_1}`] }),
  });
  render(<RouterProvider router={router} />);
  return router;
}

interface PushedChange {
  changeId: string;
  recordId: string;
  input: Record<string, unknown>;
  changedFields: string[];
  baseFieldVersions: Record<string, number>;
  status?: string;
}

function pushes(socket: FakeSocket): PushedChange[] {
  return socket
    .parsed()
    .filter((message): message is { type: "push"; changes: PushedChange[] } => {
      return (message as { type: string }).type === "push";
    })
    .flatMap((message) => message.changes);
}

// 編集操作は 見出し1 トグル(ツールバー経由 = 実ユーザーと同一コードパス)で行う。
// jsdom は contenteditable へのタイピングを再現できないため(ui 側のテスト様式と同じ判断)。
async function toggleHeadingAndSave(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByRole("textbox", { name: "body" });
  await user.click(screen.getByRole("button", { name: "見出し1" }));
  await user.click(screen.getByRole("button", { name: "保存" }));
}

describe("richtext のワイヤレベル編集(/t/$tenantSlug/records/$typeKey/$recordId)", () => {
  it("pushes only the body with its base version and the schemaVersion envelope", async () => {
    const harness = socketHarness();
    renderEditor(harness);
    await vi.waitFor(() => expect(harness.sockets.length).toBe(1));
    await bootstrapped(harness.latest(), [article()]);

    const user = userEvent.setup();
    await toggleHeadingAndSave(user);

    await vi.waitFor(() => expect(pushes(harness.latest()).length).toBe(1));
    const change = pushes(harness.latest())[0];
    if (change === undefined) throw new Error("expected a pushed change");
    expect(change.changedFields).toEqual(["body"]);
    expect(change.baseFieldVersions).toEqual({ body: 1 });
    const body = change.input["body"] as {
      schemaVersion: number;
      doc: { content: Array<{ type: string }> };
    };
    expect(body.schemaVersion).toBe(1);
    expect(body.doc.content[0]?.type).toBe("heading");
    expect(change.input["title"]).toBe("旧タイトル");

    // ack で確定 → エラーバナーなし
    harness.latest().deliver({
      type: "ack",
      changeId: change.changeId,
      result: {
        ok: true,
        record: article({
          input: { title: "旧タイトル", body: change.input["body"] },
          fieldVersions: { title: 1, body: 2 },
          seq: 11,
          version: 2,
        }),
      },
    });
    await vi.waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });

  it("does not roll back another editor's change on untouched fields (§12 必須②)", async () => {
    const harness = socketHarness();
    renderEditor(harness);
    await vi.waitFor(() => expect(harness.sockets.length).toBe(1));
    await bootstrapped(harness.latest(), [article()]);

    const user = userEvent.setup();
    const title = await screen.findByRole("textbox", { name: "title" });
    await user.clear(title);
    await user.type(title, "自分の新タイトル");

    // 編集中に他者の本文変更が届く
    const theirs = bodyEnvelope("他者の新本文");
    harness.latest().deliver({
      type: "change",
      record: article({
        input: { title: "旧タイトル", body: theirs },
        fieldVersions: { title: 1, body: 2 },
        seq: 11,
        version: 2,
      }),
    });

    await user.click(screen.getByRole("button", { name: "保存" }));
    await vi.waitFor(() => expect(pushes(harness.latest()).length).toBe(1));
    const change = pushes(harness.latest())[0];
    if (change === undefined) throw new Error("expected a pushed change");
    // title だけが changedFields に載り、body は他者の版がそのまま運ばれる
    expect(change.changedFields).toEqual(["title"]);
    expect(change.baseFieldVersions).toEqual({ title: 1 });
    expect(change.input["body"]).toEqual(theirs);
  });
});

describe("本文競合の手動解決(裁定 3)", () => {
  async function conflictSetup(harness: ReturnType<typeof socketHarness>) {
    renderEditor(harness);
    await vi.waitFor(() => expect(harness.sockets.length).toBe(1));
    await bootstrapped(harness.latest(), [article()]);
    const user = userEvent.setup();
    await toggleHeadingAndSave(user);
    await vi.waitFor(() => expect(pushes(harness.latest()).length).toBe(1));
    const change = pushes(harness.latest())[0];
    if (change === undefined) throw new Error("expected a pushed change");
    // 実サーバーの順序どおり: 他者の change を配信してから conflict ack を返す
    const theirs = article({
      input: { title: "旧タイトル", body: bodyEnvelope("他者の本文") },
      fieldVersions: { title: 1, body: 2 },
      seq: 11,
      version: 2,
    });
    harness.latest().deliver({ type: "change", record: theirs });
    harness.latest().deliver({
      type: "ack",
      changeId: change.changeId,
      result: {
        ok: false,
        code: "conflict",
        message: "field conflicts: body",
        conflicts: [{ fieldKey: "body", baseVersion: 1, currentVersion: 2 }],
      },
    });
    return { user, change };
  }

  it("adopting the server version resets the editor without a second push", async () => {
    const harness = socketHarness();
    const { user } = await conflictSetup(harness);
    const dialog = await screen.findByRole("alertdialog", { name: "本文の競合" });
    expect(dialog).toHaveTextContent("他者の本文");
    await user.click(screen.getByRole("button", { name: "サーバー版を採用" }));
    await vi.waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(screen.getByRole("textbox", { name: "body" })).toHaveTextContent("他者の本文");
    expect(pushes(harness.latest()).length).toBe(1); // 再送なし
  });

  it("keeping mine re-pushes with the advanced base version and wins", async () => {
    const harness = socketHarness();
    const { user, change } = await conflictSetup(harness);
    await screen.findByRole("alertdialog", { name: "本文の競合" });
    await user.click(screen.getByRole("button", { name: "自分の版で上書き保存" }));
    await vi.waitFor(() => expect(pushes(harness.latest()).length).toBe(2));
    const second = pushes(harness.latest())[1];
    if (second === undefined) throw new Error("expected a second push");
    expect(second.changedFields).toEqual(["body"]);
    // 他者の版が store に確定済みのため base は 2 へ進む = サーバーはクリーン上書きとして受理
    expect(second.baseFieldVersions).toEqual({ body: 2 });
    expect(second.input["body"]).toEqual(change.input["body"]);
    harness.latest().deliver({
      type: "ack",
      changeId: second.changeId,
      result: {
        ok: true,
        record: article({
          input: { title: "旧タイトル", body: second.input["body"] },
          fieldVersions: { title: 1, body: 3 },
          seq: 12,
          version: 3,
        }),
      },
    });
    await vi.waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("suppresses the dialog when the server value equals my submission (§8 自己競合ガード)", async () => {
    const harness = socketHarness();
    renderEditor(harness);
    await vi.waitFor(() => expect(harness.sockets.length).toBe(1));
    await bootstrapped(harness.latest(), [article()]);
    const user = userEvent.setup();
    await toggleHeadingAndSave(user);
    await vi.waitFor(() => expect(pushes(harness.latest()).length).toBe(1));
    const change = pushes(harness.latest())[0];
    if (change === undefined) throw new Error("expected a pushed change");
    // ack 消失後の再送シナリオ: サーバーの現在値 = 自分が送った版(先行送信が適用済み)
    harness.latest().deliver({
      type: "change",
      record: article({
        input: { title: "旧タイトル", body: change.input["body"] },
        fieldVersions: { title: 1, body: 2 },
        seq: 11,
        version: 2,
      }),
    });
    harness.latest().deliver({
      type: "ack",
      changeId: change.changeId,
      result: {
        ok: false,
        code: "conflict",
        message: "field conflicts: body",
        conflicts: [{ fieldKey: "body", baseVersion: 1, currentVersion: 2 }],
      },
    });
    // ダイアログもエラーバナーも出ない(実質成功として静かに閉じる)
    await vi.waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
