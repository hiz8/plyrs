import type { ContentTypeDefinition } from "@plyrs/metamodel";
import { SyncEngine, type ConnectFn, type SyncStatus } from "@plyrs/sync-client";
import { CollectionRegistry } from "@plyrs/sync-client/tanstack";

// ロードマップ §8「Phase 6 が守るべき配線契約(5点・全部必須)」の消化場所。
// 1. onContentTypes → registry.sync(呼ばないと live query が永久待機)
// 2. onReady → registry.markReady
// 3. onStoreChange → registry.applyStoreChange(未配線だと確定レコードがコレクションに載らない)
// 4. onReset → registry.reset(未配線だとサーバーリセット後にゴーストが残る)
// 5. engine ↔ registry の循環は `let registry!` の前方参照で解く
export interface TenantSync {
  readonly engine: SyncEngine;
  readonly registry: CollectionRegistry;
  getStatus(): SyncStatus;
  getTypes(): ContentTypeDefinition[];
  /** 初回同期(最初の ready)が完了したか。以降は切断中も true のまま(§12 必須①)。
      インスタンスの寿命はテナントレイアウトのマウントと一致する(裁定 4)。 */
  getHasSynced(): boolean;
  /** status / contentTypes の変化で発火(useSyncExternalStore 用) */
  subscribe(listener: () => void): () => void;
  start(): void;
  stop(): void;
}

export interface TenantSyncOptions {
  connect: ConnectFn;
  refreshToken?: () => Promise<void>;
  reconnectDelaysMs?: number[];
}

export function createTenantSync(options: TenantSyncOptions): TenantSync {
  let registry!: CollectionRegistry;
  let status: SyncStatus = "idle";
  let types: ContentTypeDefinition[] = [];
  let hasSynced = false;
  const listeners = new Set<() => void>();
  const emit = () => {
    for (const listener of listeners) {
      listener();
    }
  };
  const engine = new SyncEngine({
    connect: options.connect,
    ...(options.refreshToken !== undefined ? { refreshToken: options.refreshToken } : {}),
    ...(options.reconnectDelaysMs !== undefined
      ? { reconnectDelaysMs: options.reconnectDelaysMs }
      : {}),
    onContentTypes: (next) => {
      types = next;
      registry.sync(next);
      emit();
    },
    onReady: () => {
      hasSynced = true;
      registry.markReady();
      emit();
    },
    onStoreChange: (change) => registry.applyStoreChange(change),
    onReset: () => registry.reset(),
    onStatus: (next) => {
      status = next;
      emit();
    },
  });
  registry = new CollectionRegistry(engine);
  return {
    engine,
    registry,
    getStatus: () => status,
    getTypes: () => types,
    getHasSynced: () => hasSynced,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    // start()/stop() は fire-and-forget(engine 側が世代ガードで多重呼び出しに耐える)
    start: () => {
      void engine.start();
    },
    stop: () => {
      void engine.stop();
    },
  };
}
