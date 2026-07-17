import { createContext, useContext, useSyncExternalStore, type ReactNode } from "react";
import type { ContentTypeDefinition } from "@plyrs/metamodel";
import type { SyncStatus } from "@plyrs/sync-client";
import type { TenantSync } from "./sync";

const SyncContext = createContext<TenantSync | null>(null);

export function TenantSyncProvider({ sync, children }: { sync: TenantSync; children: ReactNode }) {
  return <SyncContext.Provider value={sync}>{children}</SyncContext.Provider>;
}

export function useTenantSync(): TenantSync {
  const sync = useContext(SyncContext);
  if (sync === null) {
    throw new Error("useTenantSync must be used under TenantSyncProvider");
  }
  return sync;
}

export function useSyncStatus(sync: TenantSync): SyncStatus {
  return useSyncExternalStore(sync.subscribe, sync.getStatus);
}

export function useSyncTypes(sync: TenantSync): ContentTypeDefinition[] {
  // getTypes はメッセージ受信時のみ参照が変わる(安定参照)ため snapshot として安全
  return useSyncExternalStore(sync.subscribe, sync.getTypes);
}
