import type { ContentTypeDefinition } from "@plyrs/metamodel";
import type { ClientChange, SyncRecord } from "@plyrs/sync-protocol";
import { createCollection, type Collection } from "@tanstack/db";
import { v7 as uuidv7 } from "uuid";
import type { SyncEngine } from "./engine";
import type { StoreChange } from "./store";

// @tanstack/db は BETA（0.6.x）。破壊的変更の影響をこの1ファイルに閉じ込める。
// エンジンコア（engine/store/outbox）は tanstack-db に一切依存しない。

interface SyncHandles {
  begin: () => void;
  // 実 API（ChangeMessageOrDeleteKeyMessage<T, TKey>）は insert/update に value（key 無し、
  // getKey から導出される）を、delete には value 抜きで key のみを要求する（DeleteKeyMessage）。
  write: (
    message: { type: "insert" | "update"; value: SyncRecord } | { type: "delete"; key: string },
  ) => void;
  commit: () => void;
  markReady: () => void;
}

interface Entry {
  collection: Collection<SyncRecord, string>;
  handles: SyncHandles | null;
  // 同期状態に書き込んだキー。collection.get() は楽観的オーバーレイ越しの見え方であり、
  // 「同期状態に存在するか」とは別物なので、判定にはこちらを使う。
  syncedKeys: Set<string>;
}

function toChange(
  typeKey: string,
  record: SyncRecord,
  op: ClientChange["op"],
  previous: SyncRecord | undefined,
): ClientChange {
  const changedFields =
    op === "delete"
      ? []
      : [...new Set([...Object.keys(record.input), ...Object.keys(previous?.input ?? {})])].filter(
          (key) => JSON.stringify(record.input[key]) !== JSON.stringify(previous?.input[key]),
        );
  const baseFieldVersions: Record<string, number> = {};
  for (const key of changedFields) {
    const version = previous?.fieldVersions[key];
    if (version !== undefined) {
      baseFieldVersions[key] = version;
    }
  }
  return {
    changeId: uuidv7(),
    recordId: record.id,
    typeKey,
    op,
    input: op === "delete" ? {} : record.input,
    changedFields,
    baseFieldVersions,
    status: record.status,
  };
}

export class CollectionRegistry {
  private readonly entries = new Map<string, Entry>();
  private ready = false;

  constructor(private readonly engine: SyncEngine) {}

  sync(types: ContentTypeDefinition[]): void {
    for (const type of types) {
      if (this.entries.has(type.key)) {
        continue;
      }
      this.entries.set(type.key, this.createEntry(type.key));
    }
  }

  get(typeKey: string): Collection<SyncRecord, string> | undefined {
    return this.entries.get(typeKey)?.collection;
  }

  keys(): string[] {
    return [...this.entries.keys()];
  }

  markReady(): void {
    this.ready = true;
    for (const entry of this.entries.values()) {
      entry.handles?.markReady();
    }
  }

  applyStoreChange(change: StoreChange): void {
    const typeKey = change.kind === "upsert" ? change.record.type : change.typeKey;
    const entry = this.entries.get(typeKey);
    const handles = entry?.handles;
    if (entry === undefined || handles === null || handles === undefined) {
      return;
    }
    handles.begin();
    if (change.kind === "upsert") {
      const exists = entry.syncedKeys.has(change.record.id);
      handles.write({ type: exists ? "update" : "insert", value: change.record });
      entry.syncedKeys.add(change.record.id);
    } else if (entry.syncedKeys.has(change.recordId)) {
      // 削除は同期状態に書き込んだキーに対してのみ発行する
      handles.write({ type: "delete", key: change.recordId });
      entry.syncedKeys.delete(change.recordId);
    }
    handles.commit();
  }

  private createEntry(typeKey: string): Entry {
    const entry: Entry = {
      collection: undefined as unknown as Collection<SyncRecord, string>,
      handles: null,
      syncedKeys: new Set(),
    };

    const push = async (record: SyncRecord, op: ClientChange["op"]): Promise<void> => {
      const previous = this.engine.store.get(record.id);
      const change = toChange(typeKey, record, op, previous);
      // 楽観的オーバーレイはハンドラの解決で落ちるため、確定レコードを
      // 同期状態にマージしてから resolve する（ちらつき防止）。
      // ack が {ok:false} なら SyncRejectedError が throw され、tanstack-db が自動ロールバックする。
      const confirmed = await this.engine.push(change);
      this.applyStoreChange(
        confirmed.deletedAt === null
          ? { kind: "upsert", record: confirmed }
          : { kind: "delete", recordId: confirmed.id, typeKey },
      );
    };

    entry.collection = createCollection<SyncRecord, string>({
      getKey: (row) => row.id,
      // 実 API では startSync のデフォルトは false（購読が来るまで sync() が呼ばれない）。
      // CollectionRegistry は購読者の有無に関わらずエンジンのイベントを即座に反映する必要がある
      // ため、明示的に true にする（ブリーフには無かった指定）。
      startSync: true,
      sync: {
        rowUpdateMode: "full",
        sync: (handles) => {
          entry.handles = handles;
          if (this.ready) {
            handles.markReady();
          }
          return () => {
            entry.handles = null;
          };
        },
      },
      onInsert: async ({ transaction }) => {
        for (const mutation of transaction.mutations) {
          await push(mutation.modified, "upsert");
        }
      },
      onUpdate: async ({ transaction }) => {
        for (const mutation of transaction.mutations) {
          await push(mutation.modified, "upsert");
        }
      },
      onDelete: async ({ transaction }) => {
        for (const mutation of transaction.mutations) {
          await push(mutation.original, "delete");
        }
      },
    });

    return entry;
  }
}
