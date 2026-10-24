import { QueryClient } from "@tanstack/react-query";
import type { ContentTypeDefinition } from "@plyrs/metamodel";
import type { SyncRecord } from "@plyrs/sync-protocol";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { render } from "@testing-library/react";
import { vi, expect } from "vitest";
import { createAppContext, getRouter, type RouterContext } from "../router";
import { baseAuthedRoutes, blogTenantOf, jsonResponse, stubFetch, type Handler } from "./api-stubs";
import { FakeSocket } from "./fake-socket";
import { createFakeXhr } from "./fake-xhr";

// records-flow / publish-box-flow など、編集・作成画面を router 経由で試すテストの共通の下地。
// RAC の Modal を開く場面はここでは扱わない(ファイルを分ける)

export { jsonResponse, stubFetch, type Handler };

export const RECORD_1 = "018f2b6a-7a0a-7000-8000-000000000101";

export function blogTenant(role = "owner") {
  return blogTenantOf(role);
}

export function authedRoutes(
  overrides: Record<string, Handler> = {},
  role = "owner",
): Record<string, Handler> {
  return baseAuthedRoutes(
    {
      "/v1/t/t1/content-types": vi.fn(() => jsonResponse(200, { contentTypes: [] })),
      [`/v1/t/t1/records/${RECORD_1}/publication`]: vi.fn(() =>
        jsonResponse(200, { published: false }),
      ),
      ...overrides,
    },
    role,
  );
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

export async function bootstrapped(
  socket: FakeSocket,
  records: SyncRecord[],
  types: ContentTypeDefinition[] = [articleType],
) {
  await vi.waitFor(() => expect(socket.parsed()).toContainEqual({ type: "hello", checkpoint: 0 }));
  socket.deliver({
    type: "welcome",
    protocolVersion: 1,
    contentTypes: types,
    serverSeq: 10,
  });
  socket.deliver({ type: "sync", records, serverSeq: 10, complete: true });
}

export function renderAt(
  path: string,
  harness: SocketHarness,
  routes = authedRoutes(),
  // スロットへの登録など、描画前に context を触りたいテスト向け
  setup?: (context: RouterContext) => void,
) {
  const context = createAppContext(stubFetch(routes), {
    connect: () => harness.connect,
    // アップロード(XHR。K6・K7)は同じ routes を引く
    createXhr: createFakeXhr(routes),
    // 取得失敗のテストがリトライの待ちで遅くならないようにする
    queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  });
  setup?.(context);
  const router = getRouter({
    context,
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
