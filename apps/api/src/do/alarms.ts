// design-spec §9.6: DO の alarm は 1 オブジェクトにつき 1 本。複数の論理タイマーを
// 単一 alarm に多重化する。最早の due_at が物理アラームを持つ（earliest-wins）。
// Phase 5a では kind = 'outbox_sweep' のみ。Phase 9 でモジュール向けに汎用化する。

export const OUTBOX_SWEEP = "outbox_sweep";

// コミット直後に排出できなかった分を数秒後に拾い直す（§12.3 の「コミットの事実」に依存する保証）
export const SWEEP_DELAY_MS = 5_000;
// 排出しきれなかった場合の再試行間隔
export const SWEEP_RETRY_MS = 30_000;

export function minDueAt(sql: SqlStorage): number | null {
  return sql
    .exec<{ min_due: number | null }>("SELECT MIN(due_at) AS min_due FROM alarm_registry")
    .one().min_due;
}

// 既存登録より早い時刻だけを採用する（後から来た遅い希望で前倒し済みの起床を遅らせない）
export function registerAlarm(sql: SqlStorage, kind: string, dueAt: number): number {
  sql.exec(
    "INSERT INTO alarm_registry (kind, due_at) VALUES (?, ?) ON CONFLICT(kind) DO UPDATE SET due_at = MIN(due_at, excluded.due_at)",
    kind,
    dueAt,
  );
  const min = minDueAt(sql);
  // 直前に INSERT したので NULL にはならないが、型の上では絞る
  return min ?? dueAt;
}

export function clearAlarm(sql: SqlStorage, kind: string): void {
  sql.exec("DELETE FROM alarm_registry WHERE kind = ?", kind);
}

export function dueKinds(sql: SqlStorage, nowMs: number): string[] {
  return sql
    .exec<{ kind: string }>(
      "SELECT kind FROM alarm_registry WHERE due_at <= ? ORDER BY due_at",
      nowMs,
    )
    .toArray()
    .map((row) => row.kind);
}
