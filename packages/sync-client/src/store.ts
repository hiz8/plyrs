import type { SyncRecord } from "@plyrs/sync-protocol";

export type StoreChange =
  | { kind: "upsert"; record: SyncRecord }
  | { kind: "delete"; recordId: string; typeKey: string };

// ロードマップ §7 の契約: 同じ record が重複配信されうる（upgrade 〜 hello の間に
// 他クライアントの push があると change が welcome より先に届き、bootstrap にも再登場する）。
// record は全状態なので「id ごとに seq が大きい方を採用」で収束する。
export class RecordStore {
  private readonly records = new Map<string, SyncRecord>();
  // トゥームストーンの seq も覚える（消えた record を古い配信で復活させないため）
  private readonly seqs = new Map<string, number>();

  apply(record: SyncRecord): StoreChange | null {
    const knownSeq = this.seqs.get(record.id) ?? 0;
    if (record.seq <= knownSeq) {
      return null;
    }
    this.seqs.set(record.id, record.seq);

    if (record.deletedAt !== null) {
      const previous = this.records.get(record.id);
      this.records.delete(record.id);
      return {
        kind: "delete",
        recordId: record.id,
        typeKey: previous?.type ?? record.type,
      };
    }

    this.records.set(record.id, record);
    return { kind: "upsert", record };
  }

  get(recordId: string): SyncRecord | undefined {
    return this.records.get(recordId);
  }

  listByType(typeKey: string): SyncRecord[] {
    return [...this.records.values()]
      .filter((record) => record.type === typeKey)
      .toSorted((left, right) => left.seq - right.seq);
  }

  seqOf(recordId: string): number {
    return this.seqs.get(recordId) ?? 0;
  }

  clear(): void {
    this.records.clear();
    this.seqs.clear();
  }
}
