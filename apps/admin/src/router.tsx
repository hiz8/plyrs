import { QueryClient } from "@tanstack/react-query";
import { createRouter, type RouterHistory } from "@tanstack/react-router";
import { createSlotRegistry, type SlotRegistry } from "@plyrs/ui";
import type { ConnectFn } from "@plyrs/sync-client";
import { createBrowserConnect } from "@plyrs/sync-client/browser";
import { ErrorScreen } from "./components/error-screen";
import { PublicationPanel } from "./components/publication-panel";
import { PublishToolbar } from "./components/publish-toolbar";
import { StatusControl } from "./components/status-control";
import { createAdminApi, type AdminApi } from "./lib/admin-api";
import { createApiClient, type ApiClient } from "./lib/api-client";
import { createSuperApi, type SuperApi } from "./lib/super-api";
import { createTenantSync, type TenantSync } from "./lib/sync";
import { createTokenManager, type TokenManager } from "./lib/token-manager";
import { routeTree } from "./routeTree.gen";

export type SyncFactory = (tenantId: string) => TenantSync;

export interface RouterContext {
  queryClient: QueryClient;
  api: ApiClient;
  adminApi: AdminApi;
  superApi: SuperApi;
  tokens: TokenManager;
  slots: SlotRegistry;
  sync: SyncFactory;
}

export interface AppContextOptions {
  /** テスト用: tenantId ごとの ConnectFn を差し替える(既定はブラウザ WS) */
  connect?: (tenantId: string) => ConnectFn;
}

function browserConnect(tenantId: string, tokens: TokenManager): ConnectFn {
  // WS upgrade は admin Worker の service binding プロキシ(/v1)に乗る(server.ts 参照)
  const url = new URL(`/v1/t/${tenantId}/sync`, window.location.origin);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return createBrowserConnect({
    url: url.toString(),
    // 再接続のたびに最新トークンを載せる(60 秒マージンの先回りは token-manager が担う)
    getToken: () => tokens.getToken(tenantId),
  });
}

// 既定はグローバル fetch を束縛したラッパー(ブラウザで detached fetch を呼ぶと
// Illegal invocation になるため、素の `fetch` を既定値にしない)。テストはスタブを渡す。
export function createAppContext(
  fetchImpl: typeof fetch = (...args) => fetch(...args),
  options?: AppContextOptions,
): RouterContext {
  const api = createApiClient(fetchImpl);
  const tokens = createTokenManager({ issueToken: api.issueToken });
  const adminApi = createAdminApi(tokens, fetchImpl);
  const superApi = createSuperApi(fetchImpl);
  const slots = createSlotRegistry();
  // コアのナビ項目。モジュール(Phase 9)も同じ register 経路で項目を足す(design-spec §9.9)
  slots.register("nav:item", {
    id: "core.content-types",
    label: "コンテンツタイプ",
    to: "/t/$tenantSlug/content-types",
    order: 0,
  });
  slots.register("nav:item", {
    id: "core.assets",
    label: "アセット",
    to: "/t/$tenantSlug/assets",
    order: 1,
  });
  slots.register("nav:item", {
    id: "core.modules",
    label: "モジュール",
    to: "/t/$tenantSlug/modules",
    order: 2,
  });
  // 裁定 5(2026-07-17): コア自身が record-editor スロットに登録する(ドッグフーディング)。
  // モジュール(Phase 9)も同じ register 経路で操作・パネルを足す。
  slots.register("record-editor:toolbar", { id: "core.publish", order: 0, render: PublishToolbar });
  slots.register("record-editor:toolbar", { id: "core.status", order: 1, render: StatusControl });
  slots.register("record-editor:panel", {
    id: "core.publication",
    title: "公開状態",
    order: 0,
    render: PublicationPanel,
  });
  const connectFor = options?.connect ?? ((tenantId: string) => browserConnect(tenantId, tokens));
  const sync: SyncFactory = (tenantId) =>
    createTenantSync({
      connect: connectFor(tenantId),
      // 4001(トークン失効)で engine が呼ぶ。キャッシュを無視して再発行し、
      // 次の connect の getToken が新トークンを拾う。
      refreshToken: async () => {
        await tokens.getToken(tenantId, { forceRefresh: true });
      },
    });
  return { queryClient: new QueryClient(), api, adminApi, superApi, tokens, slots, sync };
}

export function getRouter(options?: { context?: RouterContext; history?: RouterHistory }) {
  return createRouter({
    routeTree,
    context: options?.context ?? createAppContext(),
    defaultPreload: "intent",
    defaultErrorComponent: ErrorScreen,
    // workerd の SSR は相対 URL fetch を解決できないため、
    // loader/beforeLoad をクライアント専用化する。シェル配信(server.ts)が主防御で、
    // これは SSR ハンドラに落ちた場合の二次防御。
    defaultSsr: false,
    ...(options?.history ? { history: options.history } : {}),
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
