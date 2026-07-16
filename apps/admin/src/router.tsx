import { QueryClient } from "@tanstack/react-query";
import { createRouter, type RouterHistory } from "@tanstack/react-router";
import { createSlotRegistry, type SlotRegistry } from "@plyrs/ui";
import { createAdminApi, type AdminApi } from "./lib/admin-api";
import { createApiClient, type ApiClient } from "./lib/api-client";
import { createTokenManager, type TokenManager } from "./lib/token-manager";
import { routeTree } from "./routeTree.gen";

export interface RouterContext {
  queryClient: QueryClient;
  api: ApiClient;
  adminApi: AdminApi;
  tokens: TokenManager;
  slots: SlotRegistry;
}

// 既定はグローバル fetch を束縛したラッパー（ブラウザで detached fetch を呼ぶと
// Illegal invocation になるため、素の `fetch` を既定値にしない）。テストはスタブを渡す。
export function createAppContext(
  fetchImpl: typeof fetch = (...args) => fetch(...args),
): RouterContext {
  const api = createApiClient(fetchImpl);
  const tokens = createTokenManager({ issueToken: api.issueToken });
  const adminApi = createAdminApi(tokens, fetchImpl);
  const slots = createSlotRegistry();
  // コアのナビ項目。モジュール（Phase 9）も同じ register 経路で項目を足す（design-spec §9.9）
  slots.register("nav:item", {
    id: "core.content-types",
    label: "コンテンツタイプ",
    to: "/t/$tenantSlug/content-types",
    order: 0,
  });
  return { queryClient: new QueryClient(), api, adminApi, tokens, slots };
}

export function getRouter(options?: { context?: RouterContext; history?: RouterHistory }) {
  return createRouter({
    routeTree,
    context: options?.context ?? createAppContext(),
    defaultPreload: "intent",
    ...(options?.history ? { history: options.history } : {}),
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
