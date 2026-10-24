import { ASSET_TYPE_DEFINITION, type ContentTypeDefinition } from "@plyrs/metamodel";
import type { SyncRecord } from "@plyrs/sync-protocol";
import { createMemoryHistory } from "@tanstack/react-router";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, type Mock } from "vitest";
import { createAppContext, getRouter } from "./router";
import { FakeSocket } from "./test-utils/fake-socket";
import { renderRouter } from "./test-utils/records-harness";

// richtext-flow.test.tsx と同じヘルパー様式(このリポジトリはテストファイル間でヘルパーを
// 共有しない既存方針 — コピーで良い)。

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

type Handler = Mock<(init?: RequestInit) => Response>;

function stubFetch(routes: Record<string, Handler>): typeof fetch {
  return async (input, init) => {
    // uploadAsset は `path?filename=...` を文字列のまま fetch に渡す(admin-api.ts)。
    // richtext-flow.test.tsx の版は文字列入力のクエリを剥がさないため、ここではクエリ付き
    // 文字列にも対応できるよう常に URL 経由でパス名だけを取り出す(base はダミーの相対解決用)。
    const raw =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const path = new URL(raw, "http://localhost").pathname;
    const handler = routes[path];
    if (handler === undefined) {
      throw new Error(`unexpected fetch: ${path}`);
    }
    return handler(init ?? undefined);
  };
}

function authedRoutes(): Record<string, Handler> {
  return {
    "/auth/tenants": vi.fn(() =>
      jsonResponse(200, { tenants: [{ id: "t1", slug: "blog", name: "Blog", role: "owner" }] }),
    ),
    "/auth/token": vi.fn(() => jsonResponse(200, { token: "jwt-abc", expiresIn: 900 })),
    "/v1/t/t1/content-types": vi.fn(() => jsonResponse(200, { contentTypes: [] })),
  };
}

// Phase 8 裁定: メディアフィールド(hero)は allowedTypes ["asset"] の関係フィールド。
const mediaArticleType: ContentTypeDefinition = {
  id: "018f2b6a-7a0a-7000-8000-000000000d01",
  key: "article",
  name: "記事",
  source: "user",
  version: 1,
  fields: [
    { key: "title", type: "text", required: true },
    {
      key: "hero",
      type: "relation",
      config: { allowedTypes: ["asset"], cardinality: "one", snapshotEmbed: "value" },
    },
    { key: "body", type: "richtext" },
  ],
};

const ASSET_1 = "018f2b6a-7a0a-7000-8000-000000000e01";

function assetRecord(
  id: string,
  filename: string,
  overrides: Partial<SyncRecord> = {},
): SyncRecord {
  return {
    id,
    type: "asset",
    input: {
      filename,
      content_type: "image/png",
      size: 3,
      r2_key: `t1/${id}`,
    },
    fieldVersions: {},
    status: "draft",
    seq: 3,
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
    // noUncheckedIndexedAccess: richtext-flow.test.tsx と同じ境界ガード方針(`!` は使わない)
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
    contentTypes: [ASSET_TYPE_DEFINITION, mediaArticleType],
    serverSeq: 10,
  });
  socket.deliver({ type: "sync", records, serverSeq: 10, complete: true });
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

function renderNewRecord(
  harness: ReturnType<typeof socketHarness>,
  routes: Record<string, Handler>,
) {
  const router = getRouter({
    context: createAppContext(stubFetch(routes), { connect: () => harness.connect }),
    history: createMemoryHistory({ initialEntries: ["/t/blog/content/article/new"] }),
  });
  renderRouter(router);
  return router;
}

describe("メディアフィールドと本文画像 (record 編集)", () => {
  it("selects an asset from the dialog and pushes the relation ref", async () => {
    const harness = socketHarness();
    renderNewRecord(harness, authedRoutes());
    await vi.waitFor(() => expect(harness.sockets.length).toBe(1));
    await bootstrapped(harness.latest(), [assetRecord(ASSET_1, "one.png")]);

    const user = userEvent.setup();
    await user.type(await screen.findByRole("textbox", { name: "title" }), "新しい記事");
    await user.click(screen.getByRole("button", { name: "アセットを選択" }));
    await user.click(await screen.findByRole("button", { name: /one\.png/ }));
    await user.click(
      within(screen.getByRole("region", { name: "公開" })).getByRole("button", {
        name: "下書き保存",
      }),
    );

    await vi.waitFor(() => expect(pushes(harness.latest()).length).toBe(1));
    const change = pushes(harness.latest())[0];
    if (change === undefined) throw new Error("expected a pushed change");
    expect(change.input["hero"]).toEqual({ type: "asset", id: ASSET_1 });
    expect(change.changedFields).toEqual(expect.arrayContaining(["hero", "title"]));
    // 新規作成は全量 push のため title も載る
    expect(change.input["title"]).toBe("新しい記事");
  });

  it("inserts an assetImage node from the toolbar and pushes it in the body", async () => {
    const harness = socketHarness();
    renderNewRecord(harness, authedRoutes());
    await vi.waitFor(() => expect(harness.sockets.length).toBe(1));
    await bootstrapped(harness.latest(), [assetRecord(ASSET_1, "one.png")]);

    const user = userEvent.setup();
    await user.type(await screen.findByRole("textbox", { name: "title" }), "本文画像テスト");
    await user.click(screen.getByRole("button", { name: "画像" }));
    await user.click(await screen.findByRole("button", { name: /one\.png/ }));
    await user.click(
      within(screen.getByRole("region", { name: "公開" })).getByRole("button", {
        name: "下書き保存",
      }),
    );

    await vi.waitFor(() => expect(pushes(harness.latest()).length).toBe(1));
    const change = pushes(harness.latest())[0];
    if (change === undefined) throw new Error("expected a pushed change");
    const body = change.input["body"] as { doc: { content: Array<Record<string, unknown>> } };
    expect(body.doc.content).toContainEqual({
      type: "assetImage",
      attrs: { recordType: "asset", recordId: ASSET_1, label: "one.png" },
    });
  });
});
