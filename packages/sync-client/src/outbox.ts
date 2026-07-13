import type { AckResult, ClientChange, SyncRecord } from "@plyrs/sync-protocol";
import { SyncRejectedError } from "./errors";
import type { SyncStorage } from "./storage";

interface PendingEntry {
  change: ClientChange;
  resolve: (record: SyncRecord) => void;
  reject: (error: Error) => void;
}

// 未 ack の変更を保持する。永続化するのは変更そのものだけ（Promise は再起動で失われるが、
// リロード後の再送は hydrate() が返す一覧をエンジンが送り直すことで担保する）。
export class Outbox {
  private readonly entries = new Map<string, PendingEntry>();

  constructor(private readonly storage: SyncStorage) {}

  async hydrate(): Promise<ClientChange[]> {
    const restored = await this.storage.loadOutbox();
    for (const change of restored) {
      if (!this.entries.has(change.changeId)) {
        // リロード後の再送分は待ち手がいないので、解決先は捨てる（UI は再同期で追随する）
        this.entries.set(change.changeId, {
          change,
          resolve: () => undefined,
          reject: () => undefined,
        });
      }
    }
    return restored;
  }

  // Promise を直接返すと async 関数の戻り値が採用（adopt）されて入れ子が潰れるため、
  // ack 待ちの Promise はオブジェクトに包んで返す。
  async enqueue(change: ClientChange): Promise<{ acked: Promise<SyncRecord> }> {
    let resolve!: (record: SyncRecord) => void;
    let reject!: (error: Error) => void;
    const acked = new Promise<SyncRecord>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    // 待ち手が付くまでの間の未処理 rejection を無害化する
    acked.catch(() => undefined);

    this.entries.set(change.changeId, { change, resolve, reject });
    await this.persist();
    return { acked };
  }

  async settle(changeId: string, result: AckResult): Promise<void> {
    const entry = this.entries.get(changeId);
    if (entry === undefined) {
      return;
    }
    this.entries.delete(changeId);
    await this.persist();

    if (result.ok) {
      entry.resolve(result.record);
      return;
    }
    entry.reject(new SyncRejectedError(result.code, result.message, result.conflicts ?? []));
  }

  pending(): ClientChange[] {
    return [...this.entries.values()].map((entry) => entry.change);
  }

  async failAll(error: Error): Promise<void> {
    const entries = [...this.entries.values()];
    this.entries.clear();
    await this.persist();
    for (const entry of entries) {
      entry.reject(error);
    }
  }

  private async persist(): Promise<void> {
    await this.storage.saveOutbox(this.pending());
  }
}
