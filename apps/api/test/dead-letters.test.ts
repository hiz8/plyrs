import { createExecutionContext, createMessageBatch, env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { afterEach, describe, expect, it } from "vitest";
import { auditLogs, deadLetters } from "@plyrs/db/control-plane";
import worker, { app } from "../src/index";
import type { ProjectionJob } from "../src/projection/jobs";
import { articleType, auth, uuid, validArticleInput } from "./fixtures";
import { asPublishResult } from "./rpc-unwrap";
import { resetSuperAdmins, superEnv, superLogin } from "./super-login";

afterEach(async () => {
  await resetSuperAdmins();
  await drizzle(env.DB).delete(deadLetters); // 共有 D1 のリーク対策
});

// Queue の配送は非同期（miniflare のブローカ経由）。フラッシュ API は無いのでポーリングする
// (projection-e2e.test.ts と同じ様式)。
async function waitFor<T>(read: () => Promise<T | null>, timeoutMs = 5_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (value !== null) {
      return value;
    }
    if (Date.now() > deadline) {
      throw new Error("timed out waiting for the projection");
    }
    await scheduler.wait(25);
  }
}

function jsonReq(method: string, path: string, cookie: string, body?: unknown): Request {
  return new Request(`https://api.test${path}`, {
    method,
    headers: { "content-type": "application/json", cookie },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe("dead letter park & replay", () => {
  it("parks a DLQ message into D1 and acks (idempotent by message id)", async () => {
    // フルスイート時は他ファイルの module ジョブが実際に plyrs-modules-dlq へ移動し、
    // 今回の consumer 追加でその配送が非同期に割り込みうる(projection-e2e.test.ts と同じ
    // ブローカ共有の事情)。id で絞って読み、テーブル全体件数には依存しない。
    const msgId = `msg-${crypto.randomUUID()}`;
    const body: ProjectionJob = {
      jobType: "reproject",
      tenantId: crypto.randomUUID(),
      cursor: null,
      epoch: 1,
    };
    const batch = createMessageBatch<ProjectionJob>("plyrs-projection-dlq", [
      { id: msgId, timestamp: new Date(), body, attempts: 5 },
    ]);
    const ctx = createExecutionContext();
    await worker.queue(batch, env, ctx);
    await worker.queue(
      createMessageBatch<ProjectionJob>("plyrs-projection-dlq", [
        { id: msgId, timestamp: new Date(), body, attempts: 6 },
      ]),
      env,
      ctx,
    ); // 再配達しても 1 行のまま
    const rows = await drizzle(env.DB).select().from(deadLetters).where(eq(deadLetters.id, msgId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: msgId, queue: "plyrs-projection" });
    expect(JSON.parse(rows[0]?.body ?? "")).toEqual(body);
  });

  it("lists, replays to the source queue, and discards", async () => {
    const { cookie } = await superLogin();
    const e = superEnv();
    const tenantId = crypto.randomUUID();
    const stub = e.TENANT_DO.get(e.TENANT_DO.idFromName(tenantId));
    const recordId = uuid(1600);

    // テナント + 型 + record + publish(既存ヘルパ、projection-e2e.test.ts と同じ経路)。
    await stub.registerContentType(articleType(), auth("owner1"));
    await stub.writeRecord("article", { recordId, input: validArticleInput() }, auth("owner1"));
    const published = asPublishResult(
      await stub.publishRecord(tenantId, tenantId, recordId, auth("owner1")),
    );
    expect(published.ok).toBe(true);

    // publish の自然な排出（outbox → queue → projection、実ブローカ経由）を待ち、
    // 投影が一度出来上がった状態からスタートする。
    await waitFor(() =>
      env.PROJECTION_DB.prepare(
        "SELECT record_id FROM projected_records WHERE tenant_id = ? AND record_id = ?",
      )
        .bind(tenantId, recordId)
        .first<{ record_id: string }>(),
    );

    // 投影行の消失（手動介入・障害等）を再現する。reproject リプレイで復元できることを確認する。
    await env.PROJECTION_DB.prepare(
      "DELETE FROM projected_records WHERE tenant_id = ? AND record_id = ?",
    )
      .bind(tenantId, recordId)
      .run();
    expect(
      await env.PROJECTION_DB.prepare(
        "SELECT record_id FROM projected_records WHERE tenant_id = ? AND record_id = ?",
      )
        .bind(tenantId, recordId)
        .first<{ record_id: string }>(),
    ).toBeNull();

    // 「DLQ に park 済みの reproject ジョブ」を direct insert で再現する
    // (parkDeadLetter が -dlq を剥いだ後の queue 名で source を保存するのと同じ形)。
    const dlqId = `dlq-${crypto.randomUUID()}`;
    const job = { jobType: "reproject" as const, tenantId, cursor: null, epoch: Date.now() };
    await drizzle(env.DB)
      .insert(deadLetters)
      .values({
        id: dlqId,
        queue: "plyrs-projection",
        body: JSON.stringify(job),
        failedAt: new Date().toISOString(),
        replayedAt: null,
      });

    const listed = await app.request("/super/v1/dead-letters", { headers: { cookie } }, e);
    expect(listed.status).toBe(200);
    const { deadLetters: rows } = (await listed.json()) as {
      deadLetters: { id: string; queue: string; replayedAt: string | null }[];
    };
    expect(rows.find((row) => row.id === dlqId)).toMatchObject({
      queue: "plyrs-projection",
      replayedAt: null,
    });

    const replayed = await app.request(
      jsonReq("POST", `/super/v1/dead-letters/${dlqId}/replay`, cookie),
      undefined,
      e,
    );
    expect(replayed.status).toBe(200);
    expect(await replayed.json()).toEqual({ ok: true });

    // replay は実キューへ送出するだけ。実 miniflare ブローカ経由で projection consumer が走り、
    // 投影行が復元されるまでポーリングで観測する(projection-e2e.test.ts と同じ様式)。
    await waitFor(() =>
      env.PROJECTION_DB.prepare(
        "SELECT record_id FROM projected_records WHERE tenant_id = ? AND record_id = ?",
      )
        .bind(tenantId, recordId)
        .first<{ record_id: string }>(),
    );

    const afterReplay = (
      await drizzle(env.DB).select().from(deadLetters).where(eq(deadLetters.id, dlqId))
    )[0];
    expect(afterReplay?.replayedAt).not.toBeNull();

    const actionsAfterReplay = (
      await drizzle(env.DB).select({ action: auditLogs.action }).from(auditLogs)
    ).map((row) => row.action);
    expect(actionsAfterReplay).toContain("dlq.replay");

    const discarded = await app.request(
      jsonReq("DELETE", `/super/v1/dead-letters/${dlqId}`, cookie),
      undefined,
      e,
    );
    expect(discarded.status).toBe(200);
    expect(await discarded.json()).toEqual({ ok: true });
    expect(
      await drizzle(env.DB).select().from(deadLetters).where(eq(deadLetters.id, dlqId)),
    ).toHaveLength(0);

    const actionsAfterDiscard = (
      await drizzle(env.DB).select({ action: auditLogs.action }).from(auditLogs)
    ).map((row) => row.action);
    expect(actionsAfterDiscard).toContain("dlq.discard");
  });

  it("parks from env-suffixed dlq names and routes suffixed module queues", async () => {
    const batch = createMessageBatch<ProjectionJob>("plyrs-projection-preview-dlq", [
      {
        id: "msg-env",
        timestamp: new Date(),
        body: { jobType: "reproject", tenantId: "t", cursor: null, epoch: 1 },
        attempts: 5,
      },
    ]);
    await worker.queue(batch, env, createExecutionContext());
    const row = (
      await drizzle(env.DB).select().from(deadLetters).where(eq(deadLetters.id, "msg-env"))
    )[0];
    expect(row?.queue).toBe("plyrs-projection-preview");
  });
});
