import { env } from "cloudflare:workers";
import { evictDurableObject, runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { SWEEP_DELAY_MS, SWEEP_RETRY_MS } from "../src/do/alarms";
import { articleType, auth, uuid, validArticleInput } from "./fixtures";
import { asPublishResult, asWriteResult } from "./rpc-unwrap";

describe("outbox sweeper on the alarm registry (design-spec §9.6 / §12.3)", () => {
  let tenantId: string;
  let stub: DurableObjectStub<import("../src/tenant-do").TenantDO>;
  const recordId = uuid(300);

  beforeEach(async () => {
    tenantId = crypto.randomUUID();
    stub = env.TENANT_DO.get(env.TENANT_DO.idFromName(tenantId));
    await stub.registerContentType(articleType(), auth("owner1"));
    const written = asWriteResult(
      await stub.writeRecord("article", { recordId, input: validArticleInput() }, auth("owner1")),
    );
    expect(written.ok).toBe(true);
  });

  it("drains the outbox on the publish path and leaves nothing pending", async () => {
    const published = asPublishResult(await stub.publishRecord(tenantId, recordId, auth("owner1")));
    expect(published.ok).toBe(true);
    expect(await stub.pendingOutbox()).toBe(0);
  });

  it("arms an alarm in the same transaction as the outbox row", async () => {
    await stub.publishRecord(tenantId, recordId, auth("owner1"));
    await runInDurableObject(stub, async (_instance, state) => {
      // 正常系で排出済みでも、レジストリの掃除は sweeper の仕事なのでアラームは張られたまま
      expect(await state.storage.getAlarm()).not.toBeNull();
    });
  });

  it("sweeps unsent rows and clears its registration when the outbox is empty", async () => {
    await stub.publishRecord(tenantId, recordId, auth("owner1"));
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    expect(await stub.pendingOutbox()).toBe(0);

    await runInDurableObject(stub, async (_instance, state) => {
      // 未送出が無くなったので登録は消え、次のアラームも張られない
      expect(await state.storage.getAlarm()).toBeNull();
    });
  });

  it("re-arms the alarm from the registry when the DO restarts", async () => {
    await stub.publishRecord(tenantId, recordId, auth("owner1"));
    await runInDurableObject(stub, async (_instance, state) => {
      // アラームを失った状態（sweeper のバグ・リトライ枯渇等）を再現
      await state.storage.deleteAlarm();
      expect(await state.storage.getAlarm()).toBeNull();
    });

    await evictDurableObject(stub);
    await stub.ping(); // constructor を走らせる

    await runInDurableObject(stub, async (_instance, state) => {
      expect(await state.storage.getAlarm()).not.toBeNull();
    });
  });

  // MINOR fix（レビュー指摘）: drainOutbox() は PROJECTION_QUEUE.send() を await するため、その
  // 最中は input gate が保持されない ―― 別の publish がちょうどその隙に割り込んで新しい登録
  // （この sweep が始まった後の due_at）を張れる。sweepOutbox() が無条件に kind 全体を消す
  // 実装だと、割り込みが張ったばかりの登録まで巻き添えで消してしまい、その publish の sweep が
  // SWEEP_DELAY_MS(5s) 後ではなく次の SWEEP_RETRY_MS(30s) 後まで遅延する。
  //
  // stub 越しの RPC 呼び出しでこの競合を起こそうとすると、RPC ディスパッチ自体のオーバーヘッドで
  // sweepOutbox() が競合する隙が生まれる前に完走してしまい再現しない（実測で確認済み）。
  // runInDurableObject が渡す実インスタンスへ直接メソッドを呼べば、RPC ディスパッチを経由しない
  // ぶん両者が同一 tick で走り始め、sweepOutbox() が最初の PROJECTION_QUEUE.send() で中断した
  // 「その隙」に publishRecord() の transactionSync（同期）が正確に割り込む。sweepOutbox は
  // private なので型だけ絞ったキャストでアクセスする（@ts-expect-error や any は使わない）。
  it("keeps a registration made by a concurrent publish during the drain instead of clobbering it", async () => {
    // まず通常に publish して tenant_id を確定させる（drainOutbox は do_config の tenant_id が
    // 分からないと即 return してしまい、PROJECTION_QUEUE.send を await する隙が生まれない）。
    // この publish 自身の drainOutbox で outbox は空になるが、sweep 用の登録は
    // レジストリに残ったままになる（sweeper だけがそれを消す設計）。
    const published0 = asPublishResult(
      await stub.publishRecord(tenantId, recordId, auth("owner1")),
    );
    expect(published0.ok).toBe(true);
    expect(await stub.pendingOutbox()).toBe(0);

    const secondRecordId = uuid(301);
    const written = asWriteResult(
      await stub.writeRecord(
        "article",
        { recordId: secondRecordId, input: { ...validArticleInput(), slug: "second" } },
        auth("owner1"),
      ),
    );
    expect(written.ok).toBe(true);

    const { publishOk, dueAt } = await runInDurableObject(stub, async (instance, state) => {
      // sweep が実際に PROJECTION_QUEUE.send を await するよう、未送出行を直接仕込む
      // （RPC 経路を通すと即座に排出されてしまい、割り込みの隙が生まれない）。
      state.storage.sql.exec(
        "INSERT INTO outbox (id, job_type, record_id, source_version, publish_seq, enqueued_at, sent) VALUES (?, 'upsert', ?, 1, 1, ?, 0)",
        crypto.randomUUID(),
        recordId,
        new Date().toISOString(),
      );

      const priv = instance as unknown as { sweepOutbox: (startedAt: number) => Promise<void> };
      // どちらも await せず同一 tick で起動する。sweepOutbox() は最初の PROJECTION_QUEUE.send()
      // で中断し、その隙に publishRecord() の同期トランザクション（新しい登録を張る）が挟まる。
      const sweepPromise = priv.sweepOutbox(Date.now());
      const publishPromise = instance.publishRecord(tenantId, secondRecordId, auth("owner1"));
      const [, publishResult] = await Promise.all([sweepPromise, publishPromise]);
      const row = state.storage.sql
        .exec<{ due_at: number }>("SELECT due_at FROM alarm_registry WHERE kind = 'outbox_sweep'")
        .toArray()[0];
      return { publishOk: publishResult.ok, dueAt: row?.due_at ?? null };
    });
    expect(publishOk).toBe(true);

    // 割り込んだ publish が張った登録（due_at はスイープ開始より後）が生き残っていれば、
    // 次のアラームは SWEEP_RETRY_MS(30s) 後ではなく、もっと早く（SWEEP_DELAY_MS(5s) 前後で）
    // 来るはずである。
    expect(dueAt).not.toBeNull();
    // SWEEP_RETRY_MS(30s) よりずっと早い、SWEEP_DELAY_MS(5s) 級の猶予に収まっていることを
    // 固定する（クロックの揺れを許して SWEEP_RETRY_MS の半分を境界に取る）。
    expect(dueAt as number).toBeLessThan(Date.now() + SWEEP_RETRY_MS / 2);
    expect(SWEEP_DELAY_MS).toBeLessThan(SWEEP_RETRY_MS);
  });
});
