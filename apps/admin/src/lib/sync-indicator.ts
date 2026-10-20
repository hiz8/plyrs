import type { SyncStatus } from "@plyrs/sync-client";

export type SyncIndicatorState = "syncing" | "ready" | "disconnected";

// 一度でも同期できた後の再接続は「同期中」ではなく「切断」として見せる。
export function syncIndicatorState(status: SyncStatus, hasSynced: boolean): SyncIndicatorState {
  if (status === "closed") return "disconnected";
  if (status === "ready") return "ready";
  return hasSynced ? "disconnected" : "syncing";
}
