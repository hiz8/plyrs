import type { QueryClient } from "@tanstack/react-query";
import type { SlotRegistry } from "@plyrs/ui";
import type { AdminApi } from "./admin-api";
import type { ApiClient } from "./api-client";
import type { SuperApi } from "./super-api";
import type { TenantSync } from "./sync";
import type { TokenManager } from "./token-manager";

// ルーターのコンテキストの型。router.tsx(エントリ)と routes/__root.tsx の両方が参照するので、エントリから切り出して置く

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
