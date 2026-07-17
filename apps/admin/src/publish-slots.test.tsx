import type { ContentTypeDefinition, WorkflowStatus } from "@plyrs/metamodel";
import type { SyncRecord } from "@plyrs/sync-protocol";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { fireEvent, render, screen } from "@testing-library/react";
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

const articleType: ContentTypeDefinition = {
  id: "018f2b6a-7a0a-7000-8000-000000000001",
  key: "article",
  name: "記事",
  source: "user",
  version: 1,
  fields: [{ key: "title", type: "text", required: true }],
};

function article(overrides: Partial<SyncRecord> = {}): SyncRecord {
  return {
    id: RECORD_1,
    type: "article",
    input: { title: "記事タイトル" },
    fieldVersions: { title: 1 },
    status: "draft",
    seq: 2,
    version: 3,
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
    // noUncheckedIndexedAccess: records-flow.test.tsx と同じ境界ガード方針(呼び出し側は
    // 必ず接続確立後に呼ぶ前提。`!` は使わず、明示 throw で境界を扱う)。
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

function routesWith(
  role: string,
  overrides: Record<string, Handler> = {},
): Record<string, Handler> {
  return {
    "/auth/tenants": vi.fn(() =>
      jsonResponse(200, { tenants: [{ id: "t1", slug: "blog", name: "Blog", role }] }),
    ),
    "/auth/token": vi.fn(() => jsonResponse(200, { token: "jwt-abc", expiresIn: 900 })),
    "/v1/t/t1/content-types": vi.fn(() => jsonResponse(200, { contentTypes: [] })),
    [`/v1/t/t1/records/${RECORD_1}/publication`]: vi.fn(() =>
      jsonResponse(200, { published: false }),
    ),
    ...overrides,
  };
}

function renderEditor(harness: ReturnType<typeof socketHarness>, routes: Record<string, Handler>) {
  const router = getRouter({
    context: createAppContext(stubFetch(routes), { connect: () => harness.connect }),
    history: createMemoryHistory({ initialEntries: [`/t/blog/records/article/${RECORD_1}`] }),
  });
  render(<RouterProvider router={router} />);
  return router;
}

// react-aria-components の Select（packages/ui/src/select.tsx）は、このページ規模の
// フル DOM 上でポップオーバーを開閉する操作(userEvent.click、testing-library の
// findBy*、fireEvent 経由でのオプションクリックいずれも)と組み合わせると応答が
// 返らなくなることを実測した(jsdom 環境で CPU 張り付きの無限ループ。単体の
// select.test.tsx やシンプルなページでは再現しない — 詳細な切り分け手順は
// task-11-report.md 参照)。react-aria-components はモバイル/オートフィル互換のため
// 非表示のネイティブ <select> も同時に描画し、その change イベントを内部の
// onSelectionChange に橋渡しする。ポップオーバーを一切開かずにこの隠し select へ
// change イベントを送ることで、同じ選択操作を安定して再現する。
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

describe("publish / unpublish（record-editor:toolbar スロット）", () => {
  it("publishes the record and refreshes the publication panel", async () => {
    const harness = socketHarness();
    let published = false;
    const publicationHandler: Handler = vi.fn(() =>
      published
        ? jsonResponse(200, {
            published: true,
            publishedAt: "2026-07-17T02:00:00Z",
            publishedBy: "u1",
            sourceVersion: 3,
          })
        : jsonResponse(200, { published: false }),
    );
    const publishHandler: Handler = vi.fn(() => {
      published = true;
      return jsonResponse(200, { ok: true });
    });
    renderEditor(
      harness,
      routesWith("owner", {
        [`/v1/t/t1/records/${RECORD_1}/publication`]: publicationHandler,
        [`/v1/t/t1/records/${RECORD_1}/publish`]: publishHandler,
      }),
    );
    await vi.waitFor(() => expect(harness.sockets.length).toBe(1));
    await bootstrapped(harness.latest(), [article()]);

    // panel: 未公開表示
    expect(await screen.findByText(/未公開/)).toBeInTheDocument();

    await userEvent.setup().click(await screen.findByRole("button", { name: "公開" }));
    expect(await screen.findByText(/公開中/)).toBeInTheDocument();
    expect(publishHandler).toHaveBeenCalledTimes(1);
    // 公開中は「公開を取り下げ」も出る
    expect(screen.getByRole("button", { name: "公開を取り下げ" })).toBeInTheDocument();
  });

  it("shows the stale indicator when the record changed after publish", async () => {
    const harness = socketHarness();
    renderEditor(
      harness,
      routesWith("owner", {
        [`/v1/t/t1/records/${RECORD_1}/publication`]: vi.fn(() =>
          jsonResponse(200, {
            published: true,
            publishedAt: "2026-07-17T02:00:00Z",
            publishedBy: "u1",
            sourceVersion: 1, // record.version = 3 > 1 → 未公開の変更あり
          }),
        ),
      }),
    );
    await vi.waitFor(() => expect(harness.sockets.length).toBe(1));
    await bootstrapped(harness.latest(), [article()]);
    expect(await screen.findByText(/未公開の変更があります/)).toBeInTheDocument();
  });

  it("disables publish actions for viewers", async () => {
    const harness = socketHarness();
    renderEditor(harness, routesWith("viewer"));
    await vi.waitFor(() => expect(harness.sockets.length).toBe(1));
    await bootstrapped(harness.latest(), [article()]);
    const publish = await screen.findByRole("button", { name: "公開" });
    expect(publish).toBeDisabled();
  });
});

describe("ワークフロー status 操作（record-editor:toolbar スロット）", () => {
  it("pushes a status-only change through the sync engine", async () => {
    const harness = socketHarness();
    renderEditor(harness, routesWith("owner"));
    await vi.waitFor(() => expect(harness.sockets.length).toBe(1));
    await bootstrapped(harness.latest(), [article()]);

    await selectWorkflowStatus("in_review");

    await vi.waitFor(() => {
      const push = harness
        .latest()
        .parsed()
        .find((message) => (message as { type: string }).type === "push") as
        | { changes: { recordId: string; status?: string; changedFields: string[] }[] }
        | undefined;
      expect(push?.changes[0]).toMatchObject({
        recordId: RECORD_1,
        status: "in_review",
        changedFields: [],
      });
    });
  });

  it("warns before archiving a record that is still published (design-spec §7)", async () => {
    const harness = socketHarness();
    renderEditor(
      harness,
      routesWith("owner", {
        [`/v1/t/t1/records/${RECORD_1}/publication`]: vi.fn(() =>
          jsonResponse(200, {
            published: true,
            publishedAt: "2026-07-17T02:00:00Z",
            publishedBy: "u1",
            sourceVersion: 3,
          }),
        ),
      }),
    );
    await vi.waitFor(() => expect(harness.sockets.length).toBe(1));
    await bootstrapped(harness.latest(), [article()]);
    // publication クエリが published:true で解決するのを待つ(「公開を取り下げ」は
    // published===true のときだけ描画される)。先に解決していないと onSelect が
    // まだ publication.data===undefined のまま archive 分岐を通り過ぎてしまう。
    await vi.waitFor(() => {
      expect(document.body.textContent).toMatch(/公開を取り下げ/);
    });

    await selectWorkflowStatus("archived");

    // まだ push されず、警告が出る
    await vi.waitFor(() => {
      expect(document.body.textContent).toMatch(/まだ公開中です/);
    });
    const pushedBefore = harness
      .latest()
      .parsed()
      .filter((message) => (message as { type: string }).type === "push");
    expect(pushedBefore).toHaveLength(0);

    const archiveButton = Array.from(document.querySelectorAll("button")).find(
      (element) => element.textContent === "公開したままアーカイブ",
    );
    if (archiveButton === undefined) {
      throw new Error("archive-anyway button not found");
    }
    fireEvent.click(archiveButton);
    await vi.waitFor(() => {
      const push = harness
        .latest()
        .parsed()
        .find((message) => (message as { type: string }).type === "push") as
        | { changes: { status?: string }[] }
        | undefined;
      expect(push?.changes[0]).toMatchObject({ status: "archived" });
    });
  });
});
