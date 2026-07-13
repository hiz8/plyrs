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

// レビュー指摘（MINOR）: drainOutbox() は PROJECTION_QUEUE.send() を await するため、その最中は
// DO の input gate が保持されない ―― 別の publish/unpublish/delete/push がこの sweep の途中に
// 割り込んで新しい登録（この sweep が始まった後の due_at）を armSweep() できてしまう。
// sweepOutbox() が無条件に clearAlarm(kind) すると、割り込みが張ったばかりの新しい登録まで
// 巻き添えで消してしまい、その publish の sweep が SWEEP_DELAY_MS(5s) 後ではなく次の
// SWEEP_RETRY_MS(30s) 後まで遅延する。sweep の開始時刻（startedAt）以前に存在していた登録
// だけを消せば、割り込みが張った新しい登録（due_at > startedAt。armSweep は必ず
// 現在時刻より後の due_at しか登録しないため、割り込みの発生が sweep 開始後である以上これは
// 恒真）は生き残る。
export function clearServicedAlarm(sql: SqlStorage, kind: string, startedAt: number): void {
  sql.exec("DELETE FROM alarm_registry WHERE kind = ? AND due_at <= ?", kind, startedAt);
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

// alarm() が呼ばれたという事実自体が「レジストリの最早 due_at が到来した」ことの証明になる
// （物理アラームは常にその最早 due_at に合わせて張るため）。実時計がそれよりわずかに早く
// 見えても（早期起床やクロック誤差）到来したものとして扱う ―― さもないと dueKinds が何も
// 返さず、同じ時刻へ張り直すだけの起床ループに陥る。この繰り上げはレジストリ自身の最早値が
// 上限であり、それより遅い他の kind を前倒しする効果はない。
export function effectiveNow(sql: SqlStorage): number {
  const earliestDue = minDueAt(sql);
  return earliestDue === null ? Date.now() : Math.max(Date.now(), earliestDue);
}
