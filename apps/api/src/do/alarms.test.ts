import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import {
  clearAlarm,
  clearServicedAlarm,
  dueKinds,
  minDueAt,
  OUTBOX_SWEEP,
  registerAlarm,
  SWEEP_DELAY_MS,
  SWEEP_RETRY_MS,
} from "./alarms";

// ストレージ分離はテストファイル単位のため、テストごとに DO 名を変えて独立させる
function freshStub() {
  return env.TENANT_DO.get(env.TENANT_DO.idFromName(crypto.randomUUID()));
}

describe("alarm registry timing constants (design-spec §9.6)", () => {
  it("keeps SWEEP_DELAY_MS and SWEEP_RETRY_MS strictly positive", () => {
    // 0 や負値だと dispatcher の Math.max に隠れたまま、過去/即時にスケジュールされ続けて
    // DO をホットループさせる。ここで直接ピン留めする。
    expect(SWEEP_DELAY_MS).toBeGreaterThan(0);
    expect(SWEEP_RETRY_MS).toBeGreaterThan(0);
  });
});

describe("alarm registry helpers", () => {
  it("registerAlarm keeps the earliest due time when the same kind is registered twice", async () => {
    const stub = freshStub();
    await stub.ping(); // constructor を走らせてテーブルを用意する
    await runInDurableObject(stub, async (_instance, state) => {
      const sql = state.storage.sql;
      expect(registerAlarm(sql, OUTBOX_SWEEP, 2_000)).toBe(2_000);
      // 後から来た遅い希望では前倒し済みの起床を遅らせない
      expect(registerAlarm(sql, OUTBOX_SWEEP, 5_000)).toBe(2_000);
      // 早い希望は採用する
      expect(registerAlarm(sql, OUTBOX_SWEEP, 1_000)).toBe(1_000);
    });
  });

  it("registerAlarm returns the new global minimum across kinds, not just its own kind", async () => {
    const stub = freshStub();
    await stub.ping();
    await runInDurableObject(stub, async (_instance, state) => {
      const sql = state.storage.sql;
      expect(registerAlarm(sql, "kind_a", 5_000)).toBe(5_000);
      // 別 kind が早ければ、そちらが物理アラームの根拠になる（全体最小）
      expect(registerAlarm(sql, "kind_b", 1_000)).toBe(1_000);
      // kind_a を更に遅らせても、全体最小は kind_b のまま
      expect(registerAlarm(sql, "kind_a", 9_000)).toBe(1_000);
    });
  });

  it("clearAlarm removes only its own kind, leaving other kinds' registrations intact", async () => {
    const stub = freshStub();
    await stub.ping();
    await runInDurableObject(stub, async (_instance, state) => {
      const sql = state.storage.sql;
      registerAlarm(sql, OUTBOX_SWEEP, 1_000);
      registerAlarm(sql, "other_kind", 2_000);
      clearAlarm(sql, OUTBOX_SWEEP);
      expect(dueKinds(sql, 10_000)).toEqual(["other_kind"]);
      expect(minDueAt(sql)).toBe(2_000);
    });
  });

  it("dueKinds returns only kinds due at or before now, in due order, excluding future ones", async () => {
    const stub = freshStub();
    await stub.ping();
    await runInDurableObject(stub, async (_instance, state) => {
      const sql = state.storage.sql;
      const now = Date.now();
      // 到来済み 2 件（順序が入れ替わる登録順にして ORDER BY を確かめる）+ 1 時間後の未到来 1 件
      registerAlarm(sql, "due_later", now - 1_000);
      registerAlarm(sql, "due_earlier", now - 5_000);
      registerAlarm(sql, "not_due_yet", now + 60 * 60 * 1_000);
      expect(dueKinds(sql, now)).toEqual(["due_earlier", "due_later"]);
    });
  });

  it("minDueAt returns null on an empty registry", async () => {
    const stub = freshStub();
    await stub.ping();
    await runInDurableObject(stub, async (_instance, state) => {
      expect(minDueAt(state.storage.sql)).toBeNull();
    });
  });

  // MINOR fix（レビュー指摘）: sweepOutbox() は drainOutbox() の await 中に割り込んだ
  // 別の publish/unpublish/delete/push が張った「sweep 開始より後の」新しい登録を
  // 巻き添えで消してはならない。clearServicedAlarm はその境界（startedAt）を明示的に
  // 受け取ることでこれを実現する ―― clearAlarm と違い、kind 全体を無条件に消さない。
  it("clearServicedAlarm removes only registrations at or before the given time, sparing later ones", async () => {
    const stub = freshStub();
    await stub.ping();
    await runInDurableObject(stub, async (_instance, state) => {
      const sql = state.storage.sql;
      const startedAt = 5_000;
      // sweep 開始時点で既にあった登録（サービス対象）
      registerAlarm(sql, OUTBOX_SWEEP, startedAt - 1_000);
      clearServicedAlarm(sql, OUTBOX_SWEEP, startedAt);
      expect(minDueAt(sql)).toBeNull();

      // ちょうど startedAt な登録も「サービス対象」に含む（<=）
      registerAlarm(sql, OUTBOX_SWEEP, startedAt);
      clearServicedAlarm(sql, OUTBOX_SWEEP, startedAt);
      expect(minDueAt(sql)).toBeNull();

      // sweep 開始「後」に割り込みが張った登録は消さない
      registerAlarm(sql, OUTBOX_SWEEP, startedAt + 1_000);
      clearServicedAlarm(sql, OUTBOX_SWEEP, startedAt);
      expect(minDueAt(sql)).toBe(startedAt + 1_000);
    });
  });

  it("clearServicedAlarm removes only its own kind, leaving other kinds intact regardless of due_at", async () => {
    const stub = freshStub();
    await stub.ping();
    await runInDurableObject(stub, async (_instance, state) => {
      const sql = state.storage.sql;
      registerAlarm(sql, OUTBOX_SWEEP, 1_000);
      registerAlarm(sql, "other_kind", 1_000);
      clearServicedAlarm(sql, OUTBOX_SWEEP, 10_000);
      expect(dueKinds(sql, 10_000)).toEqual(["other_kind"]);
    });
  });
});
