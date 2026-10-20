import type { ContentTypeDefinition } from "@plyrs/metamodel";
import type { SyncRecord } from "@plyrs/sync-protocol";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { render } from "@testing-library/react";
import { vi, expect, type Mock } from "vitest";
import { createAppContext, getRouter } from "../router";
import { FakeSocket } from "./fake-socket";

// records-flow / publish-box-flow など、編集・作成画面を router 経由で試すテストの共通の下地。
// RAC の Modal を開く場面はここでは扱わない(ファイルを分ける)

export function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export type Handler = Mock<(init?: RequestInit) => Response | Promise<Response>>;

export function stubFetch(routes: Record<string, Handler>): typeof fetch {
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

export const RECORD_1 = "018f2b6a-7a0a-7000-8000-000000000101";

export function blogTenant(role = "owner") {
  return { id: "t1", slug: "blog", name: "Blog", role };
}

export function authedRoutes(
  overrides: Record<string, Handler> = {},
  role = "owner",
): Record<string, Handler> {
  return {
    "/auth/turnstile-config": vi.fn(() => jsonResponse(200, { siteKey: null })),
    "/auth/tenants": vi.fn(() => jsonResponse(200, { tenants: [blogTenant(role)] })),
    "/auth/me": vi.fn(() => jsonResponse(200, { userId: "u1", email: "owner@example.com" })),
    "/auth/token": vi.fn(() => jsonResponse(200, { token: "jwt-abc", expiresIn: 900 })),
    "/v1/t/t1/modules": vi.fn(() => jsonResponse(200, { modules: [] })),
    "/v1/t/t1/content-types": vi.fn(() => jsonResponse(200, { contentTypes: [] })),
    "/v1/t/t1/publications": vi.fn(() => jsonResponse(200, { publications: [], nextCursor: null })),
    [`/v1/t/t1/records/${RECORD_1}/publication`]: vi.fn(() =>
      jsonResponse(200, { published: false }),
    ),
    ...overrides,
  };
}

export const articleType: ContentTypeDefinition = {
  id: "018f2b6a-7a0a-7000-8000-000000000001",
  key: "article",
  name: "記事",
  source: "user",
  version: 1,
  fields: [{ key: "title", type: "text", required: true }],
};

export function article(
  id: string,
  title: string,
  overrides: Partial<SyncRecord> = {},
): SyncRecord {
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

// ソケットを test 側で握るヘルパー。エンジンの接続確立ごとに新しい FakeSocket を返す。
export function socketHarness() {
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

export type SocketHarness = ReturnType<typeof socketHarness>;

export async function bootstrapped(socket: FakeSocket, records: SyncRecord[]) {
  await vi.waitFor(() => expect(socket.parsed()).toContainEqual({ type: "hello", checkpoint: 0 }));
  socket.deliver({
    type: "welcome",
    protocolVersion: 1,
    contentTypes: [articleType],
    serverSeq: 10,
  });
  socket.deliver({ type: "sync", records, serverSeq: 10, complete: true });
}

export function renderAt(path: string, harness: SocketHarness, routes = authedRoutes()) {
  const router = getRouter({
    context: createAppContext(stubFetch(routes), { connect: () => harness.connect }),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  renderRouter(router);
  return router;
}

// router 経由のテストの描画。root ルートが <html> を描くため、既定の描画先(body の中の div)だと React の
// 管理する body(singleton)の内側に root が入る。この状態で RAC の Modal / Toast が document.body へ
// portal を作ると、以降 portal の外の要素へのフォーカスやクリックで React のイベント委譲が
// 戻らなくなる。描画先を body にして、root と portal の container を一致させる
export function renderRouter(router: ReturnType<typeof getRouter>) {
  return render(<RouterProvider router={router} />, { container: document.body });
}
