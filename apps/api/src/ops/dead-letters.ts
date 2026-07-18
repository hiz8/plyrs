// Phase 10 裁定: DLQ は「キュー内滞留」ではなく D1 退避。ack は durable insert 完了後
// (§9 の「黙って ack しない」の意図は「ack より先に永続化する」で保存される)。
// キュー名は環境サフィックス付き(例: plyrs-projection-preview-dlq)でも動くよう、
// 完全一致表ではなく「-dlq を剥ぐ」規約で source を導出する(Task 15 の env 分割と対)。
export async function parkDeadLetter(
  env: Env,
  dlqQueue: string,
  message: { id: string; body: unknown },
): Promise<void> {
  if (!dlqQueue.endsWith("-dlq")) {
    throw new Error(`not a dlq: ${dlqQueue}`);
  }
  const source = dlqQueue.slice(0, -"-dlq".length);
  await env.DB.prepare(
    "INSERT OR REPLACE INTO dead_letters (id, queue, body, failed_at, replayed_at) VALUES (?1, ?2, ?3, ?4, NULL)",
  )
    .bind(message.id, source, JSON.stringify(message.body), new Date().toISOString())
    .run();
}
