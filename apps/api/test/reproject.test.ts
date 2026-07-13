import { createExecutionContext, createMessageBatch, getQueueResult } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import worker from "../src/index";
import { handleProjectionJob } from "../src/projection/consumer";
import { REPROJECT_PAGE_SIZE, type ProjectionJob } from "../src/projection/jobs";
import { articleType, auth, uuid, validArticleInput } from "./fixtures";
import { asPublishResult, asReprojectResult, asWriteResult } from "./rpc-unwrap";

async function deliver(jobs: ProjectionJob[]) {
  const batch = createMessageBatch<ProjectionJob>(
    "plyrs-projection",
    jobs.map((body, i) => ({ id: `m${i}`, timestamp: new Date(1_000 + i), attempts: 1, body })),
  );
  const ctx = createExecutionContext();
  await worker.queue(batch, env, ctx);
  return getQueueResult(batch, ctx);
}

async function projectedIds(tenantId: string): Promise<string[]> {
  const { results } = await env.PROJECTION_DB.prepare(
    "SELECT record_id FROM projected_records WHERE tenant_id = ? ORDER BY record_id",
  )
    .bind(tenantId)
    .all<{ record_id: string }>();
  return results.map((row) => row.record_id);
}

// 幽霊行の掃除確認に使う汎用カウンタ。projected_relations だけ結合キーが source_id。
async function countRows(table: string, tenantId: string, recordId: string): Promise<number> {
  const column = table === "projected_relations" ? "source_id" : "record_id";
  const row = await env.PROJECTION_DB.prepare(
    `SELECT COUNT(*) AS n FROM ${table} WHERE tenant_id = ? AND ${column} = ?`,
  )
    .bind(tenantId, recordId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

// テスト(e): 自己連鎖を実ブローカー（SELF.queue()）に頼らず決定的に駆動するため、
// consumer が `env.PROJECTION_QUEUE.send()` するたびに実キューへは投げず捕まえる偽の Queue。
function capturingQueue(onSend: (job: ProjectionJob) => void): Queue<ProjectionJob> {
  const metrics = { backlogCount: 0, backlogBytes: 0 };
  return {
    metrics: () => Promise.resolve(metrics),
    send: async (job) => {
      onSend(job);
      return { metadata: { metrics } };
    },
    sendBatch: async () => {
      throw new Error("sendBatch is not used by the reprojection chain");
    },
  };
}

describe("tenant reprojection (design-spec §12.3b)", () => {
  it("rebuilds the projection from snapshots and sweeps rows that are no longer published", async () => {
    const tenantId = crypto.randomUUID();
    const stub = env.TENANT_DO.get(env.TENANT_DO.idFromName(tenantId));
    await stub.registerContentType(articleType(), auth("owner1"));

    for (const n of [400, 401, 402]) {
      const written = asWriteResult(
        await stub.writeRecord(
          "article",
          { recordId: uuid(n), input: { ...validArticleInput(), slug: `s-${n}` } },
          auth("owner1"),
        ),
      );
      expect(written.ok).toBe(true);
      await stub.publishRecord(tenantId, uuid(n), auth("owner1"));
    }
    // publish 経路の排出分を投影に反映
    // NOTE: publishSeq は brief 執筆後に追加された順序ガード本体（source_version とは別物）。
    // フレッシュな DO で publish を 400→401→402 の順に呼んだので 1,2,3 が採番される。
    await deliver([
      { jobType: "upsert", tenantId, recordId: uuid(400), sourceVersion: 1, publishSeq: 1 },
      { jobType: "upsert", tenantId, recordId: uuid(401), sourceVersion: 1, publishSeq: 2 },
      { jobType: "upsert", tenantId, recordId: uuid(402), sourceVersion: 1, publishSeq: 3 },
    ]);
    expect(await projectedIds(tenantId)).toStrictEqual([uuid(400), uuid(401), uuid(402)]);

    // 投影にだけ存在する幽霊行を作る（乖離の再現）。3 テーブルすべてに仕込む — projected_records
    // だけだと projected_relations の COUNT は最初から 0 で「掃除できた」ことを何も検証しない
    // vacuous な assertion になり、projection_index はそもそもチェックされない（レビュー指摘）。
    const ghostId = uuid(499);
    await env.PROJECTION_DB.batch([
      env.PROJECTION_DB.prepare(
        "INSERT INTO projected_records (tenant_id, record_id, type, slug, published_at, data, source_version, projected_at) VALUES (?, ?, 'article', 'ghost', '2026-01-01T00:00:00.000Z', '{}', 1, 1)",
      ).bind(tenantId, ghostId),
      env.PROJECTION_DB.prepare(
        "INSERT INTO projected_relations (tenant_id, source_id, source_field, target_type, target_id, ordinal, origin) VALUES (?, ?, 'authors', 'author', 'ghost-author', 0, 'field')",
      ).bind(tenantId, ghostId),
      env.PROJECTION_DB.prepare(
        "INSERT INTO projection_index (tenant_id, type, field_key, value_text, value_num, value_date, record_id) VALUES (?, 'article', 'slug', 'ghost', NULL, NULL, ?)",
      ).bind(tenantId, ghostId),
    ]);
    expect(await countRows("projected_relations", tenantId, ghostId)).toBe(1);
    expect(await countRows("projection_index", tenantId, ghostId)).toBe(1);

    const started = asReprojectResult(await stub.startReprojection(tenantId, auth("owner1")));
    expect(started.ok).toBe(true);
    if (!started.ok) {
      return;
    }

    await deliver([{ jobType: "reproject", tenantId, cursor: null, epoch: started.epoch }]);

    // snapshot に無い幽霊行が消え、公開中の 3 件だけが残る
    expect(await projectedIds(tenantId)).toStrictEqual([uuid(400), uuid(401), uuid(402)]);
    // 3 テーブルとも掃かれている（projected_relations / projection_index も実際に検証する）
    expect(await countRows("projected_relations", tenantId, ghostId)).toBe(0);
    expect(await countRows("projection_index", tenantId, ghostId)).toBe(0);
  });

  it("backfills projection_index rows for a newly indexed field", async () => {
    const tenantId = crypto.randomUUID();
    const stub = env.TENANT_DO.get(env.TENANT_DO.idFromName(tenantId));
    await stub.registerContentType(articleType(), auth("owner1"));
    const recordId = uuid(410);
    await stub.writeRecord("article", { recordId, input: validArticleInput() }, auth("owner1"));
    await stub.publishRecord(tenantId, recordId, auth("owner1"));
    // このテナントで最初の publish なので publishSeq は 1
    await deliver([{ jobType: "upsert", tenantId, recordId, sourceVersion: 1, publishSeq: 1 }]);

    const before = await env.PROJECTION_DB.prepare(
      "SELECT COUNT(*) AS n FROM projection_index WHERE tenant_id = ? AND field_key = 'tags'",
    )
      .bind(tenantId)
      .first<{ n: number }>();
    expect(before?.n).toBe(0);

    // tags を後から indexed 宣言する（DO の VIRTUAL generated column は既存行を書き換えないが、
    // 投影側のサイドテーブルはバックフィルが要る — §12.3b の非対称）
    const withIndexedTags = articleType();
    const tags = withIndexedTags.fields.find((field) => field.key === "tags");
    if (tags?.type === "select") {
      tags.config.indexed = true;
    }
    await stub.registerContentType(withIndexedTags, auth("owner1"));

    const started = asReprojectResult(await stub.startReprojection(tenantId, auth("owner1")));
    expect(started.ok).toBe(true);
    if (!started.ok) {
      return;
    }
    await deliver([{ jobType: "reproject", tenantId, cursor: null, epoch: started.epoch }]);

    const after = await env.PROJECTION_DB.prepare(
      "SELECT value_text FROM projection_index WHERE tenant_id = ? AND field_key = 'tags'",
    )
      .bind(tenantId)
      .all<{ value_text: string }>();
    expect(after.results.map((row) => row.value_text)).toStrictEqual(["tech"]);
  });

  it("denies reprojection to editors", async () => {
    const tenantId = crypto.randomUUID();
    const stub = env.TENANT_DO.get(env.TENANT_DO.idFromName(tenantId));
    const denied = asReprojectResult(await stub.startReprojection(tenantId, auth("eve", "editor")));
    expect(denied).toMatchObject({ ok: false, code: "forbidden" });
  });
});

describe("reprojection self-chains across pages (design-spec §12.3b)", () => {
  // CRITICAL fix 検証の一環: これまでのテストは全テナントの公開件数が REPROJECT_PAGE_SIZE
  // 未満で、自己連鎖そのものを経由していなかった。ここではちょうど 2 ページ分（境界ケース）を
  // 公開する — loadPublishedPage は payloads.length === limit のときだけ nextCursor を非 null に
  // するため、ちょうど倍数で終わるテナントは「もう次が無い」ことを示す実質空のページ取得が
  // もう1往復必要になり、その空ページが sweep を担う（consumer.ts のコメント参照）。
  it("[race e] walks an exact multiple of REPROJECT_PAGE_SIZE and runs the sweep on the terminal empty page", async () => {
    const tenantId = crypto.randomUUID();
    const stub = env.TENANT_DO.get(env.TENANT_DO.idFromName(tenantId));
    await stub.registerContentType(articleType(), auth("owner1"));

    const total = REPROJECT_PAGE_SIZE * 2; // 100件 = ちょうど2ページ分
    const base = 1000;
    const recordIds: string[] = [];
    for (let i = 0; i < total; i += 1) {
      const recordId = uuid(base + i);
      recordIds.push(recordId);
      const written = asWriteResult(
        await stub.writeRecord(
          "article",
          { recordId, input: { ...validArticleInput(), slug: `page-${base + i}` } },
          auth("owner1"),
        ),
      );
      expect(written.ok).toBe(true);
      const published = asPublishResult(
        await stub.publishRecord(tenantId, recordId, auth("owner1")),
      );
      expect(published.ok).toBe(true);
    }

    // 幽霊行（snapshot に存在しない）も仕込み、最後の sweep が連鎖の果てでも効くことを確認する
    const ghostId = uuid(1999);
    await env.PROJECTION_DB.prepare(
      "INSERT INTO projected_records (tenant_id, record_id, type, slug, published_at, data, source_version, projected_at) VALUES (?, ?, 'article', 'ghost', '2026-01-01T00:00:00.000Z', '{}', 1, 1)",
    )
      .bind(tenantId, ghostId)
      .run();

    const started = asReprojectResult(await stub.startReprojection(tenantId, auth("owner1")));
    expect(started.ok).toBe(true);
    if (!started.ok) {
      return;
    }

    // 自己連鎖は consumer が env.PROJECTION_QUEUE.send() で次ページを積むだけ。実ブローカー
    // （SELF.queue()、既知に壊れている）には頼らず、送出されたジョブをその場で
    // handleProjectionJob に渡して駆動する。
    const queued: ProjectionJob[] = [];
    const fakeEnv: Env = {
      ...env,
      PROJECTION_QUEUE: capturingQueue((job) => queued.push(job)),
    };

    let job: ProjectionJob = {
      jobType: "reproject",
      tenantId,
      cursor: null,
      epoch: started.epoch,
    };
    const epochsSeen: number[] = [];
    let hops = 0;
    // 安全弁: 連鎖が終わらない事故が再発してもテストがハングせず FAIL で落ちるよう上限を置く。
    while (hops < 10) {
      hops += 1;
      if (job.jobType === "reproject") {
        epochsSeen.push(job.epoch);
      }
      await handleProjectionJob(fakeEnv, job, Date.now());
      const next = queued.shift();
      if (next === undefined) {
        break;
      }
      job = next;
    }

    // page1(50件) → page2(50件, cursor=最後のrecord) → page3(0件・空ページ = sweep) の3ホップ
    expect(hops).toBe(3);
    expect(queued).toStrictEqual([]);
    // epoch は連鎖の全ホップで同一でなければならない
    expect(epochsSeen).toStrictEqual([started.epoch, started.epoch, started.epoch]);

    // 全件がちょうど1回ずつ投影されている
    const ids = await projectedIds(tenantId);
    expect(ids).toHaveLength(total);
    expect(new Set(ids)).toStrictEqual(new Set(recordIds));

    // 連鎖の果てでも幽霊行の sweep は効く
    expect(
      await env.PROJECTION_DB.prepare(
        "SELECT COUNT(*) AS n FROM projected_records WHERE tenant_id = ? AND record_id = ?",
      )
        .bind(tenantId, ghostId)
        .first<{ n: number }>(),
    ).toMatchObject({ n: 0 });
  }, 30_000);
});

// CRITICAL fix 検証の一環: sweep の DELETE ... WHERE projected_at < epoch は「この歩きより前に
// 投影された行」だけを掃く。歩きの最中に走った通常の publish は projected_at >= epoch になり、
// 巻き込まれてはならない（consumer.ts の handleReprojectJob 冒頭コメント参照）。
describe("reprojection sweep spares in-flight publishes (design-spec §12.3b)", () => {
  it("[race f] a publish landing during the walk (projected_at >= epoch) survives the sweep", async () => {
    const tenantId = crypto.randomUUID();
    const epoch = 5_000;

    // 歩きより前からあった、掃除対象の投影行（projected_at < epoch）
    await env.PROJECTION_DB.prepare(
      "INSERT INTO projected_records (tenant_id, record_id, type, slug, published_at, data, source_version, projected_at) VALUES (?, ?, 'article', 'stale-ghost', '2020-01-01T00:00:00.000Z', '{}', 1, ?)",
    )
      .bind(tenantId, uuid(1500), epoch - 1_000)
      .run();

    // 歩きの最中に着地した通常 publish（projected_at >= epoch）。snapshot には存在しないので
    // 歩きのページには載らないが、sweep の WHERE projected_at < epoch はこの行を巻き込まない。
    await env.PROJECTION_DB.prepare(
      "INSERT INTO projected_records (tenant_id, record_id, type, slug, published_at, data, source_version, projected_at) VALUES (?, ?, 'article', 'in-flight', '2026-01-01T00:00:00.000Z', '{}', 1, ?)",
    )
      .bind(tenantId, uuid(1501), epoch + 1_000)
      .run();

    await handleProjectionJob(
      env,
      { jobType: "reproject", tenantId, cursor: null, epoch },
      epoch + 2_000,
    );

    expect(
      await env.PROJECTION_DB.prepare(
        "SELECT COUNT(*) AS n FROM projected_records WHERE tenant_id = ? AND record_id = ?",
      )
        .bind(tenantId, uuid(1500))
        .first<{ n: number }>(),
    ).toMatchObject({ n: 0 });

    expect(
      await env.PROJECTION_DB.prepare(
        "SELECT COUNT(*) AS n FROM projected_records WHERE tenant_id = ? AND record_id = ?",
      )
        .bind(tenantId, uuid(1501))
        .first<{ n: number }>(),
    ).toMatchObject({ n: 1 });
  });
});

// CRITICAL fix の Step 3: 歩き終わりの sweep は墓標も GC する。epoch より前に立てられた墓標は
// この歩きが発行するどの書き込みも守る必要が無い。epoch 以降（歩きの最中）に立てられた墓標
// （本物の unpublish）は残さなければならない。
describe("reprojection sweep GCs stale tombstones (CRITICAL fix)", () => {
  it("removes a tombstone older than the epoch but keeps one created during the walk", async () => {
    const tenantId = crypto.randomUUID();
    const epoch = 5_000;

    const staleTombstoneId = uuid(1510);
    const freshTombstoneId = uuid(1511);
    await env.PROJECTION_DB.batch([
      env.PROJECTION_DB.prepare(
        "INSERT INTO projection_tombstones (tenant_id, record_id, publish_seq, tombstoned_at) VALUES (?, ?, 1, ?)",
      ).bind(tenantId, staleTombstoneId, epoch - 1_000),
      env.PROJECTION_DB.prepare(
        "INSERT INTO projection_tombstones (tenant_id, record_id, publish_seq, tombstoned_at) VALUES (?, ?, 1, ?)",
      ).bind(tenantId, freshTombstoneId, epoch + 1_000),
    ]);

    await handleProjectionJob(
      env,
      { jobType: "reproject", tenantId, cursor: null, epoch },
      epoch + 2_000,
    );

    const remaining = await env.PROJECTION_DB.prepare(
      "SELECT record_id FROM projection_tombstones WHERE tenant_id = ? ORDER BY record_id",
    )
      .bind(tenantId)
      .all<{ record_id: string }>();
    expect(remaining.results.map((row) => row.record_id)).toStrictEqual([freshTombstoneId]);
  });
});
