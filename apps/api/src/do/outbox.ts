export type OutboxJobType = "upsert" | "delete";

export interface OutboxRow {
  id: string;
  jobType: OutboxJobType;
  recordId: string;
  sourceVersion: number;
  publishSeq: number;
}

interface RawOutboxRow extends Record<string, SqlStorageValue> {
  id: string;
  job_type: string;
  record_id: string;
  source_version: number;
  publish_seq: number;
}

// design-spec §12.3: publish/unpublish のコミットと同一トランザクションで積む。
// publishSeq が投影ジョブの順序ガード本体（source_version は参考情報。CRITICAL fix 参照）。
export function enqueueOutbox(
  sql: SqlStorage,
  id: string,
  jobType: OutboxJobType,
  recordId: string,
  sourceVersion: number,
  publishSeq: number,
  now: string,
): void {
  sql.exec(
    "INSERT INTO outbox (id, job_type, record_id, source_version, publish_seq, enqueued_at, sent) VALUES (?, ?, ?, ?, ?, ?, 0)",
    id,
    jobType,
    recordId,
    sourceVersion,
    publishSeq,
    now,
  );
}

export function unsentOutbox(sql: SqlStorage, limit: number): OutboxRow[] {
  return sql
    .exec<RawOutboxRow>(
      "SELECT id, job_type, record_id, source_version, publish_seq FROM outbox WHERE sent = 0 ORDER BY rowid LIMIT ?",
      limit,
    )
    .toArray()
    .map((row) => ({
      id: row.id,
      jobType: row.job_type as OutboxJobType,
      recordId: row.record_id,
      sourceVersion: row.source_version,
      publishSeq: row.publish_seq,
    }));
}

export function markOutboxSent(sql: SqlStorage, id: string): void {
  sql.exec("UPDATE outbox SET sent = 1 WHERE id = ?", id);
}

export function countUnsent(sql: SqlStorage): number {
  return sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM outbox WHERE sent = 0").one().n;
}

// sent=1 の行は単調増加する（§12.3 の掃除方針）。送出済みは即削除する。
export function purgeSent(sql: SqlStorage): void {
  sql.exec("DELETE FROM outbox WHERE sent = 1");
}
