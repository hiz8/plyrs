import type { ClientChange } from "@plyrs/sync-protocol";

// 永続化の抽象。4b ではメモリ実装のみ（ブラウザの IndexedDB/localStorage 実装は
// Phase 6 の管理画面で足す）。永続化するのは checkpoint と未 ack のアウトボックス。
export interface SyncStorage {
  loadCheckpoint(): Promise<number>;
  saveCheckpoint(seq: number): Promise<void>;
  loadOutbox(): Promise<ClientChange[]>;
  saveOutbox(changes: ClientChange[]): Promise<void>;
}

export class MemorySyncStorage implements SyncStorage {
  private checkpoint = 0;
  private outbox: ClientChange[] = [];

  async loadCheckpoint(): Promise<number> {
    return this.checkpoint;
  }

  async saveCheckpoint(seq: number): Promise<void> {
    this.checkpoint = seq;
  }

  async loadOutbox(): Promise<ClientChange[]> {
    return [...this.outbox];
  }

  async saveOutbox(changes: ClientChange[]): Promise<void> {
    this.outbox = [...changes];
  }
}
