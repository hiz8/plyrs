import type { SyncStatus } from "@plyrs/sync-client";

export type SyncIndicatorState = "syncing" | "ready" | "disconnected";

// 同期の表示(シェルの同期インジケーター)の文言。使うのはシェルだけなので、状態の型と同じ場所に置く
export const SYNC_INDICATOR_LABELS: Record<SyncIndicatorState, string> = {
  syncing: "同期中…",
  ready: "同期済み",
  disconnected: "再接続しています…",
};

// 一度でも同期できた後の再接続は「同期中」ではなく「切断」として見せる。
export function syncIndicatorState(status: SyncStatus, hasSynced: boolean): SyncIndicatorState {
  if (status === "closed") return "disconnected";
  if (status === "ready") return "ready";
  return hasSynced ? "disconnected" : "syncing";
}
