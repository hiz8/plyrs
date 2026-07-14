import {
  createExecutionContext,
  createMessageBatch,
  getQueueResult,
  runInDurableObject,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import worker from "../src/index";
import { handleProjectionJob, upsertStatements } from "../src/projection/consumer";
import type { ProjectionJob } from "../src/projection/jobs";
import type { ProjectionPayload } from "../src/projection/payload";
import type { TenantDO } from "../src/tenant-do";
import { articleType, auth, uuid, validArticleInput } from "./fixtures";
import {
  asProjectionPayload,
  asPublishedPage,
  asPublishResult,
  asUnpublishResult,
  asWriteResult,
} from "./rpc-unwrap";

const QUEUE_NAME = "plyrs-projection";

// createMessageBatch の messages 配列は非 experimental な workers-types 下では
// 実質 any に落ちて型検査されない。ここで型を固定する。
function batchOf(jobs: ProjectionJob[]) {
  return createMessageBatch<ProjectionJob>(
    QUEUE_NAME,
    jobs.map((body, i) => ({
      id: `m${i}`,
      timestamp: new Date(1_000 + i),
      attempts: 1,
      body,
    })),
  );
}

async function deliver(jobs: ProjectionJob[]) {
  const batch = batchOf(jobs);
  const ctx = createExecutionContext();
  await worker.queue(batch, env, ctx);
  return getQueueResult(batch, ctx);
}

interface ProjectedRow {
  type: string;
  slug: string | null;
  data: string;
  source_version: number;
  publish_seq: number;
  projected_at: number;
}

async function projected(tenantId: string, recordId: string): Promise<ProjectedRow | null> {
  return env.PROJECTION_DB.prepare(
    "SELECT type, slug, data, source_version, publish_seq, projected_at FROM projected_records WHERE tenant_id = ? AND record_id = ?",
  )
    .bind(tenantId, recordId)
    .first<ProjectedRow>();
}

async function countRows(table: string, tenantId: string, recordId: string): Promise<number> {
  const column = table === "projected_relations" ? "source_id" : "record_id";
  const row = await env.PROJECTION_DB.prepare(
    `SELECT COUNT(*) AS n FROM ${table} WHERE tenant_id = ? AND ${column} = ?`,
  )
    .bind(tenantId, recordId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

interface OutboxRow extends Record<string, SqlStorageValue> {
  job_type: string;
  source_version: number;
  publish_seq: number;
}

// CRITICAL fix: 実際に DO が発行した publish_seq / source_version をテストが手組みせず読み出す。
// 世代番号の割り当ては DO のコンストラクタ復元込みの内部状態に依存するため、ハードコードした
// 番号は容易に嘘の前提になる（そしてこのバグ自体がまさにその手の思い込みで見逃されていた）。
async function lastOutboxRow(stub: DurableObjectStub<TenantDO>): Promise<OutboxRow> {
  return runInDurableObject(stub, async (_instance, state) => {
    const rows = state.storage.sql
      .exec<OutboxRow>(
        "SELECT job_type, source_version, publish_seq FROM outbox ORDER BY rowid DESC LIMIT 1",
      )
      .toArray();
    const row = rows[0];
    if (row === undefined) {
      throw new Error("no outbox row");
    }
    return row;
  });
}

describe("projection consumer (design-spec §12.3)", () => {
  let tenantId: string;
  let stub: DurableObjectStub<TenantDO>;
  const recordId = uuid(200);

  beforeEach(async () => {
    tenantId = crypto.randomUUID();
    stub = env.TENANT_DO.get(env.TENANT_DO.idFromName(tenantId));
    await stub.registerContentType(articleType(), auth("owner1"));
    const written = asWriteResult(
      await stub.writeRecord("article", { recordId, input: validArticleInput() }, auth("owner1")),
    );
    expect(written.ok).toBe(true);
    const published = asPublishResult(await stub.publishRecord(tenantId, recordId, auth("owner1")));
    expect(published.ok).toBe(true);
  });

  it("upserts the record, its relations, and its index rows, then acks", async () => {
    const outboxRow = await lastOutboxRow(stub);
    const result = await deliver([
      {
        jobType: "upsert",
        tenantId,
        recordId,
        sourceVersion: outboxRow.source_version,
        publishSeq: outboxRow.publish_seq,
      },
    ]);
    expect(result.explicitAcks).toStrictEqual(["m0"]);
    expect(result.retryMessages).toStrictEqual([]);

    const row = await projected(tenantId, recordId);
    expect(row).toMatchObject({ type: "article", slug: "hello", source_version: 1 });
    expect(JSON.parse(row?.data ?? "{}")).toMatchObject({ title: "こんにちは" });
    // authors x2 + hero x1
    expect(await countRows("projected_relations", tenantId, recordId)).toBe(3);
    // slug + published_at（fixtures の indexed 宣言は 2 つ）
    expect(await countRows("projection_index", tenantId, recordId)).toBe(2);
  });

  it("is idempotent under redelivery (at-least-once)", async () => {
    const outboxRow = await lastOutboxRow(stub);
    const job: ProjectionJob = {
      jobType: "upsert",
      tenantId,
      recordId,
      sourceVersion: outboxRow.source_version,
      publishSeq: outboxRow.publish_seq,
    };
    await deliver([job]);
    await deliver([job]);

    expect(await countRows("projected_relations", tenantId, recordId)).toBe(3);
    expect(await countRows("projection_index", tenantId, recordId)).toBe(2);
  });

  it("ignores an upsert older than what is already projected (order guard)", async () => {
    const v1 = await lastOutboxRow(stub);
    await stub.writeRecord(
      "article",
      { recordId, input: { ...validArticleInput(), title: "第2版" } },
      auth("owner1"),
    );
    await stub.publishRecord(tenantId, recordId, auth("owner1"));
    const v2 = await lastOutboxRow(stub);
    expect(v2.publish_seq).toBeGreaterThan(v1.publish_seq);
    // 新しい版（v2）が先に着き、古い版（v1）のジョブが遅れて届く
    await deliver([
      {
        jobType: "upsert",
        tenantId,
        recordId,
        sourceVersion: v2.source_version,
        publishSeq: v2.publish_seq,
      },
    ]);
    await deliver([
      {
        jobType: "upsert",
        tenantId,
        recordId,
        sourceVersion: v1.source_version,
        publishSeq: v1.publish_seq,
      },
    ]);

    const row = await projected(tenantId, recordId);
    expect(row?.source_version).toBe(2);
    expect(row?.publish_seq).toBe(v2.publish_seq);
    expect(JSON.parse(row?.data ?? "{}")).toMatchObject({ title: "第2版" });
  });

  it("deletes the record and its side tables on an unpublish job", async () => {
    const upsertRow = await lastOutboxRow(stub);
    await deliver([
      {
        jobType: "upsert",
        tenantId,
        recordId,
        sourceVersion: upsertRow.source_version,
        publishSeq: upsertRow.publish_seq,
      },
    ]);
    await stub.unpublishRecord(tenantId, recordId, auth("owner1"));
    const deleteRow = await lastOutboxRow(stub);
    await deliver([
      {
        jobType: "delete",
        tenantId,
        recordId,
        sourceVersion: deleteRow.source_version,
        publishSeq: deleteRow.publish_seq,
      },
    ]);

    expect(await projected(tenantId, recordId)).toBeNull();
    expect(await countRows("projected_relations", tenantId, recordId)).toBe(0);
    expect(await countRows("projection_index", tenantId, recordId)).toBe(0);
  });

  it("ignores a delete whose publish generation is older than the projection (republish won)", async () => {
    const v1 = await lastOutboxRow(stub);
    await deliver([
      {
        jobType: "upsert",
        tenantId,
        recordId,
        sourceVersion: v1.source_version,
        publishSeq: v1.publish_seq,
      },
    ]);
    await stub.writeRecord(
      "article",
      { recordId, input: { ...validArticleInput(), title: "第2版" } },
      auth("owner1"),
    );
    await stub.publishRecord(tenantId, recordId, auth("owner1"));
    const v2 = await lastOutboxRow(stub);
    await deliver([
      {
        jobType: "upsert",
        tenantId,
        recordId,
        sourceVersion: v2.source_version,
        publishSeq: v2.publish_seq,
      },
    ]);
    // v1 相当の delete（unpublish → republish のレースを想定）が遅れて届く —
    // 既に republish(v2) が載っているので無視されなければならない
    await deliver([
      {
        jobType: "delete",
        tenantId,
        recordId,
        sourceVersion: v1.source_version,
        publishSeq: v1.publish_seq,
      },
    ]);

    expect(await projected(tenantId, recordId)).not.toBeNull();
  });

  it("retries the message when the job cannot be handled", async () => {
    // 未知のジョブ種別（将来のジョブが古い Worker に届いた場合）は ack せず retry させる
    const bogus = {
      jobType: "bogus",
      tenantId,
      recordId,
      sourceVersion: 1,
      publishSeq: 1,
    } as unknown as ProjectionJob;
    const result = await deliver([bogus]);
    expect(result.explicitAcks).toStrictEqual([]);
    expect(result.retryMessages).toStrictEqual([{ msgId: "m0" }]);
  });
});

describe("publish generation ordering — CRITICAL fix (レビュー指摘)", () => {
  let tenantId: string;
  let stub: DurableObjectStub<TenantDO>;
  const recordId = uuid(201);

  beforeEach(async () => {
    tenantId = crypto.randomUUID();
    stub = env.TENANT_DO.get(env.TENANT_DO.idFromName(tenantId));
    await stub.registerContentType(articleType(), auth("owner1"));
    const written = asWriteResult(
      await stub.writeRecord("article", { recordId, input: validArticleInput() }, auth("owner1")),
    );
    expect(written.ok).toBe(true);
    const published = asPublishResult(await stub.publishRecord(tenantId, recordId, auth("owner1")));
    expect(published.ok).toBe(true);
  });

  // records.version は publish/unpublish で変化しない。unpublish → 無編集で republish すると
  // 同じ source_version の upsert/delete が 2 世代分アウトボックスに積まれ、Queues は配信順序を
  // 保証しないため、遅れて届いた古い delete が現に公開中の republish 後の行を消してしまいうる
  // （旧 source_version ガードに対しては FAIL することを修正前に確認済み — レポート参照）。
  it("survives a stale unpublish-delete that arrives after a same-source-version republish", async () => {
    const v1 = await lastOutboxRow(stub);
    await deliver([
      {
        jobType: "upsert",
        tenantId,
        recordId,
        sourceVersion: v1.source_version,
        publishSeq: v1.publish_seq,
      },
    ]);
    expect(await projected(tenantId, recordId)).not.toBeNull();

    // unpublish → delete が積まれる。source_version は変わらないが、世代番号は新しく採られる。
    const unpublished = asUnpublishResult(
      await stub.unpublishRecord(tenantId, recordId, auth("owner1")),
    );
    expect(unpublished).toMatchObject({ ok: true, sourceVersion: v1.source_version });
    const staleDelete = await lastOutboxRow(stub);
    expect(staleDelete.source_version).toBe(v1.source_version);
    expect(staleDelete.publish_seq).toBeGreaterThan(v1.publish_seq);

    // 編集せずに republish → records.version（source_version）は変わらないが世代番号はさらに進む
    const republished = asPublishResult(
      await stub.publishRecord(tenantId, recordId, auth("owner1")),
    );
    expect(republished.ok).toBe(true);
    if (republished.ok) {
      // 曖昧さの核心: republish の source_version は unpublish 時点の delete と同じ番号
      expect(republished.snapshot.sourceVersion).toBe(v1.source_version);
    }
    const republishRow = await lastOutboxRow(stub);
    expect(republishRow.publish_seq).toBeGreaterThan(staleDelete.publish_seq);

    // Cloudflare Queues は配信順序を保証しない: republish の upsert が先に届く
    await deliver([
      {
        jobType: "upsert",
        tenantId,
        recordId,
        sourceVersion: republishRow.source_version,
        publishSeq: republishRow.publish_seq,
      },
    ]);
    expect(await projected(tenantId, recordId)).not.toBeNull();

    // ...そして unpublish 時点の delete が遅れて届く。source_version は republish 後の行と同じだが、
    // 世代番号（publish_seq）は古い。
    await deliver([
      {
        jobType: "delete",
        tenantId,
        recordId,
        sourceVersion: staleDelete.source_version,
        publishSeq: staleDelete.publish_seq,
      },
    ]);

    // 現に公開中の行は生き残らなければならない
    expect(await projected(tenantId, recordId)).not.toBeNull();
  });
});

describe("upsertStatements — direct-call staleness guard (handleProjectionJob 越しでは検証できない)", () => {
  // handleProjectionJob は常に DO から「生きた」ペイロードを取り直すため、古い世代のペイロードを
  // 人為的に作って渡すことができない。ガードの本体（source_version/relations/index の張替え条件）を
  // 直接検証するには upsertStatements() を単体で呼ぶしかない。
  it("leaves a newer generation's data, relations, and index rows untouched when given a stale payload", async () => {
    const liveTenantId = crypto.randomUUID();
    const liveRecordId = uuid(300);

    // 現行世代（publish_seq = 9）を直接 D1 に仕込む
    await env.PROJECTION_DB.batch([
      env.PROJECTION_DB.prepare(
        `INSERT INTO projected_records
           (tenant_id, record_id, type, slug, published_at, data, source_version, publish_seq, projected_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        liveTenantId,
        liveRecordId,
        "article",
        "current-slug",
        "2026-07-01T00:00:00.000Z",
        JSON.stringify({ title: "現行版" }),
        9,
        9,
        5_000,
      ),
      env.PROJECTION_DB.prepare(
        `INSERT INTO projected_relations
           (tenant_id, source_id, source_field, target_type, target_id, ordinal, origin)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).bind(liveTenantId, liveRecordId, "authors", "author", "author-current", 0, "field"),
      env.PROJECTION_DB.prepare(
        `INSERT INTO projection_index
           (tenant_id, type, field_key, value_text, value_num, value_date, record_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).bind(liveTenantId, "article", "slug", "current-slug", null, null, liveRecordId),
    ]);

    // 古い世代（publish_seq = 3）のペイロードを手組みし、直接 upsertStatements() へ渡す
    const stalePayload: ProjectionPayload = {
      recordId: liveRecordId,
      type: "article",
      slug: "stale-slug",
      publishedAt: "2020-01-01T00:00:00.000Z",
      data: { title: "古い版" },
      sourceVersion: 1,
      publishSeq: 3,
      relations: [
        {
          sourceField: "authors",
          targetType: "author",
          targetId: "author-stale",
          ordinal: 0,
          origin: "field",
        },
      ],
      index: [{ fieldKey: "slug", valueText: "stale-slug", valueNum: null, valueDate: null }],
      catalog: [],
    };

    await env.PROJECTION_DB.batch(
      upsertStatements(env.PROJECTION_DB, liveTenantId, stalePayload, 6_000),
    );

    const row = await projected(liveTenantId, liveRecordId);
    expect(row).toMatchObject({
      type: "article",
      slug: "current-slug",
      source_version: 9,
      publish_seq: 9,
      projected_at: 5_000,
    });
    expect(JSON.parse(row?.data ?? "{}")).toMatchObject({ title: "現行版" });

    const relRows = await env.PROJECTION_DB.prepare(
      "SELECT target_id FROM projected_relations WHERE tenant_id = ? AND source_id = ?",
    )
      .bind(liveTenantId, liveRecordId)
      .all<{ target_id: string }>();
    expect(relRows.results.map((r) => r.target_id)).toStrictEqual(["author-current"]);

    const idxRows = await env.PROJECTION_DB.prepare(
      "SELECT value_text FROM projection_index WHERE tenant_id = ? AND record_id = ?",
    )
      .bind(liveTenantId, liveRecordId)
      .all<{ value_text: string | null }>();
    expect(idxRows.results.map((r) => r.value_text)).toStrictEqual(["current-slug"]);
  });
});

describe("projected_at refresh on redelivery — pins the >= guard (not >)", () => {
  let tenantId: string;
  let stub: DurableObjectStub<TenantDO>;
  const recordId = uuid(202);

  beforeEach(async () => {
    tenantId = crypto.randomUUID();
    stub = env.TENANT_DO.get(env.TENANT_DO.idFromName(tenantId));
    await stub.registerContentType(articleType(), auth("owner1"));
    const written = asWriteResult(
      await stub.writeRecord("article", { recordId, input: validArticleInput() }, auth("owner1")),
    );
    expect(written.ok).toBe(true);
    const published = asPublishResult(await stub.publishRecord(tenantId, recordId, auth("owner1")));
    expect(published.ok).toBe(true);
  });

  // 同一世代（同じ publish_seq）の再配信は at-least-once の下で普通に起こる。ガードが > だと
  // 2 回目の配信が弾かれ projected_at が最初の配信時刻のまま古くなる。Task 7 の再投影
  // mark-and-sweep は projected_at >= epoch を生存判定に使うため、それは生きている行を
  // 誤って掃く事故になる。>= であることをここで直接固定する。
  it("bumps projected_at when the same publish generation is redelivered", async () => {
    const v1 = await lastOutboxRow(stub);
    const job: ProjectionJob = {
      jobType: "upsert",
      tenantId,
      recordId,
      sourceVersion: v1.source_version,
      publishSeq: v1.publish_seq,
    };

    await handleProjectionJob(env, job, 1_000);
    const first = await projected(tenantId, recordId);
    expect(first?.projected_at).toBe(1_000);

    await handleProjectionJob(env, job, 2_000);
    const second = await projected(tenantId, recordId);
    expect(second?.projected_at).toBe(2_000);
  });
});

// CRITICAL fix（レビュー指摘、probe で再現済み）: upsertStatements() の projected_records 書き込みは
// ON CONFLICT の UPDATE 枝だけを publish_seq でガードしており、行が既に消えている（unpublish 済み）
// ときは無条件 INSERT になる。再投影がページを読んだ「後」に unpublish の delete ジョブが先着すると、
// 古い publish_seq を運ぶ再投影の書き込みが平文 INSERT として着地し、消えたはずのレコードを
// 復活させてしまう。relations/index の EXISTS ガードは書き込み後の状態を見るため、この復活した行が
// 存在する限り一緒に張り替わってしまう（防波堤にならない）。
describe("resurrection race — a stale write must not undo a delete (CRITICAL fix)", () => {
  it("[race a] blocks a stale upsertStatements() call after the delete already landed (incremental path)", async () => {
    const tenantId = crypto.randomUUID();
    const recordId = uuid(1000);
    const stub = env.TENANT_DO.get(env.TENANT_DO.idFromName(tenantId));
    await stub.registerContentType(articleType(), auth("owner1"));
    const written = asWriteResult(
      await stub.writeRecord("article", { recordId, input: validArticleInput() }, auth("owner1")),
    );
    expect(written.ok).toBe(true);
    const published = asPublishResult(await stub.publishRecord(tenantId, recordId, auth("owner1")));
    expect(published.ok).toBe(true);

    // 「再投影がページを読んだ」瞬間を模す: この時点ではまだ公開中（publish_seq 1）。
    // stalePayload はこの後 unpublish が起きたことを知らない。
    const stalePayload = asProjectionPayload(await stub.getProjectionPayload(recordId));
    if (stalePayload === null) {
      throw new Error("test setup invariant: record must be projectable right after publish");
    }

    // ここで編集者が unpublish する。delete ジョブが（再投影の書き込みより）先に届く。
    const unpublished = asUnpublishResult(
      await stub.unpublishRecord(tenantId, recordId, auth("owner1")),
    );
    expect(unpublished.ok).toBe(true);
    const deleteRow = await lastOutboxRow(stub);
    await deliver([
      {
        jobType: "delete",
        tenantId,
        recordId,
        sourceVersion: deleteRow.source_version,
        publishSeq: deleteRow.publish_seq,
      },
    ]);
    expect(await projected(tenantId, recordId)).toBeNull();

    // 遅れて届いた再投影由来の（stale な）書き込みを、consumer が実際に使う関数で直接再生する。
    await env.PROJECTION_DB.batch(
      upsertStatements(env.PROJECTION_DB, tenantId, stalePayload, Date.now()),
    );

    // 消えたレコードが復活していてはならない（relations/index も同様）
    expect(await projected(tenantId, recordId)).toBeNull();
    expect(await countRows("projected_relations", tenantId, recordId)).toBe(0);
    expect(await countRows("projection_index", tenantId, recordId)).toBe(0);
  });

  it("[race b] blocks a stale reprojection page-read from resurrecting the record", async () => {
    const tenantId = crypto.randomUUID();
    const liveRecordId = uuid(1001);
    const otherRecordId = uuid(1002);
    const stub = env.TENANT_DO.get(env.TENANT_DO.idFromName(tenantId));
    await stub.registerContentType(articleType(), auth("owner1"));

    for (const [n, recordId] of [
      [1001, liveRecordId],
      [1002, otherRecordId],
    ] as const) {
      const written = asWriteResult(
        await stub.writeRecord(
          "article",
          { recordId, input: { ...validArticleInput(), slug: `s-${n}` } },
          auth("owner1"),
        ),
      );
      expect(written.ok).toBe(true);
      const published = asPublishResult(
        await stub.publishRecord(tenantId, recordId, auth("owner1")),
      );
      expect(published.ok).toBe(true);
    }

    // handleReprojectJob が内部で行う「ページ読み取り」そのものを再現する
    // （getPublishedPage は reproject 経路専用の DO RPC）。この時点では両方とも公開中。
    const page = asPublishedPage(await stub.getPublishedPage(null, 50));
    expect(new Set(page.payloads.map((p) => p.recordId))).toStrictEqual(
      new Set([liveRecordId, otherRecordId]),
    );

    // 実際の unpublish が先に走り、delete ジョブが（reproject の書き込みより）先に届く。
    const unpublished = asUnpublishResult(
      await stub.unpublishRecord(tenantId, liveRecordId, auth("owner1")),
    );
    expect(unpublished.ok).toBe(true);
    const deleteRow = await lastOutboxRow(stub);
    await deliver([
      {
        jobType: "delete",
        tenantId,
        recordId: liveRecordId,
        sourceVersion: deleteRow.source_version,
        publishSeq: deleteRow.publish_seq,
      },
    ]);
    expect(await projected(tenantId, liveRecordId)).toBeNull();

    // handleReprojectJob の書き込みループそのもの（ページの各 payload に upsertStatements を掛けて
    // batch する）を、キャプチャした stale なページに対して再生する。
    for (const payload of page.payloads) {
      await env.PROJECTION_DB.batch(
        upsertStatements(env.PROJECTION_DB, tenantId, payload, Date.now()),
      );
    }

    // unpublish 済みの方は復活していない
    expect(await projected(tenantId, liveRecordId)).toBeNull();
    expect(await countRows("projected_relations", tenantId, liveRecordId)).toBe(0);
    expect(await countRows("projection_index", tenantId, liveRecordId)).toBe(0);
    // レースに無関係だったもう片方は普通に投影される
    expect(await projected(tenantId, otherRecordId)).not.toBeNull();
  });

  it("[race c] a republish (higher publish_seq) clears the tombstone left by the preceding unpublish", async () => {
    const tenantId = crypto.randomUUID();
    const recordId = uuid(1003);
    const stub = env.TENANT_DO.get(env.TENANT_DO.idFromName(tenantId));
    await stub.registerContentType(articleType(), auth("owner1"));
    const written = asWriteResult(
      await stub.writeRecord("article", { recordId, input: validArticleInput() }, auth("owner1")),
    );
    expect(written.ok).toBe(true);
    const published = asPublishResult(await stub.publishRecord(tenantId, recordId, auth("owner1")));
    expect(published.ok).toBe(true);
    const v1 = await lastOutboxRow(stub);
    await deliver([
      {
        jobType: "upsert",
        tenantId,
        recordId,
        sourceVersion: v1.source_version,
        publishSeq: v1.publish_seq,
      },
    ]);
    expect(await projected(tenantId, recordId)).not.toBeNull();

    // unpublish → delete ジョブ（墓標が立つ）
    const unpublished = asUnpublishResult(
      await stub.unpublishRecord(tenantId, recordId, auth("owner1")),
    );
    expect(unpublished.ok).toBe(true);
    const deleteRow = await lastOutboxRow(stub);
    await deliver([
      {
        jobType: "delete",
        tenantId,
        recordId,
        sourceVersion: deleteRow.source_version,
        publishSeq: deleteRow.publish_seq,
      },
    ]);
    expect(await projected(tenantId, recordId)).toBeNull();
    expect(await countRows("projection_tombstones", tenantId, recordId)).toBe(1);

    // republish（世代番号は unpublish より真に大きい）→ upsert ジョブ
    const republished = asPublishResult(
      await stub.publishRecord(tenantId, recordId, auth("owner1")),
    );
    expect(republished.ok).toBe(true);
    const v2 = await lastOutboxRow(stub);
    expect(v2.publish_seq).toBeGreaterThan(deleteRow.publish_seq);
    await deliver([
      {
        jobType: "upsert",
        tenantId,
        recordId,
        sourceVersion: v2.source_version,
        publishSeq: v2.publish_seq,
      },
    ]);

    expect(await projected(tenantId, recordId)).not.toBeNull();
    expect(await countRows("projection_tombstones", tenantId, recordId)).toBe(0);
  });
});

// Task 7（レビュー指摘、probe で決定的に再現済み）: TenantDO.startReprojection にロックが無いため、
// オーナーが「再構築」を連打するだけで独立した epoch を持つ 2 つの歩きが同時に走りうる。歩き終わりの
// sweep が「epoch より前の墓標」を GC していると、後発の歩きの sweep が「先発の、まだ着地していない
// 歩き」が依存している墓標を消してしまう。すると先発の歩きが遅れて発行する stale な書き込みが
// 無防備になり、消えたはずのレコードを平文 INSERT で復活させる（しかも projected_at はどちらの
// epoch より新しくなるため、以後どちらの歩きの sweep にも掃かれない）。
describe("overlapping reprojection walks cannot resurrect a record (Task 7 fix)", () => {
  it("a stale upsertStatements() call from an earlier, still in-flight walk stays blocked after a later, unrelated walk's terminal sweep runs", async () => {
    const tenantId = crypto.randomUUID();
    const recordId = uuid(1100);
    const stub = env.TENANT_DO.get(env.TENANT_DO.idFromName(tenantId));
    await stub.registerContentType(articleType(), auth("owner1"));
    const written = asWriteResult(
      await stub.writeRecord("article", { recordId, input: validArticleInput() }, auth("owner1")),
    );
    expect(written.ok).toBe(true);
    const published = asPublishResult(await stub.publishRecord(tenantId, recordId, auth("owner1")));
    expect(published.ok).toBe(true);

    const v1 = await lastOutboxRow(stub);
    await deliver([
      {
        jobType: "upsert",
        tenantId,
        recordId,
        sourceVersion: v1.source_version,
        publishSeq: v1.publish_seq,
      },
    ]);
    expect(await projected(tenantId, recordId)).not.toBeNull();

    // 「先発の歩き」がこのレコードのページを読んだ瞬間を模す。この時点ではまだ公開中
    // （unpublish はこの後起きる）。stalePayload はそれを知らないまま止め置かれる。
    const stalePayload = asProjectionPayload(await stub.getProjectionPayload(recordId));
    if (stalePayload === null) {
      throw new Error("test setup invariant: record must be projectable right after publish");
    }

    // 編集者が unpublish → delete ジョブが墓標を立てる
    const unpublished = asUnpublishResult(
      await stub.unpublishRecord(tenantId, recordId, auth("owner1")),
    );
    expect(unpublished.ok).toBe(true);
    const deleteRow = await lastOutboxRow(stub);
    await deliver([
      {
        jobType: "delete",
        tenantId,
        recordId,
        sourceVersion: deleteRow.source_version,
        publishSeq: deleteRow.publish_seq,
      },
    ]);
    expect(await projected(tenantId, recordId)).toBeNull();
    expect(await countRows("projection_tombstones", tenantId, recordId)).toBe(1);

    const tombstoneRow = await env.PROJECTION_DB.prepare(
      "SELECT tombstoned_at FROM projection_tombstones WHERE tenant_id = ? AND record_id = ?",
    )
      .bind(tenantId, recordId)
      .first<{ tombstoned_at: number }>();
    if (tombstoneRow === null) {
      throw new Error("test setup invariant: the delete job must plant a tombstone");
    }

    // 「後発の、無関係な歩き」が別の epoch で独立に走る。この時点でこのテナントに公開中のレコードは
    // 0 件なので、1 回の handleProjectionJob 呼び出しで終端 sweep まで完了する（空ページ即 sweep）。
    // epoch は上の墓標より確実に後の値にする（旧コードの GC 条件 tombstoned_at < epoch を確実に
    // 踏ませて、バグを再現できるようにするため）。
    await handleProjectionJob(
      env,
      { jobType: "reproject", tenantId, cursor: null, epoch: tombstoneRow.tombstoned_at + 1_000 },
      tombstoneRow.tombstoned_at + 2_000,
    );

    // 先発の歩きがまだ依存している墓標は、後発の歩きの終端 sweep を生き延びなければならない
    expect(await countRows("projection_tombstones", tenantId, recordId)).toBe(1);

    // 先発の歩きの遅延した stale write（unpublish 前の publish_seq を運ぶ）が今ごろ届く。
    // handleReprojectJob のページ読み取りループが実際に呼ぶのと同じ upsertStatements() を直接叩く。
    await env.PROJECTION_DB.batch(
      upsertStatements(env.PROJECTION_DB, tenantId, stalePayload, Date.now()),
    );

    // 消えたレコードが復活していてはならない（relations/index も同様）
    expect(await projected(tenantId, recordId)).toBeNull();
    expect(await countRows("projected_relations", tenantId, recordId)).toBe(0);
    expect(await countRows("projection_index", tenantId, recordId)).toBe(0);
  });
});

// projection D1 は全テナント共有なので、墓標の NOT EXISTS ガードは必ず tenant_id で絞る
// 必要がある。これまでこの絞り込みが壊れても検出できていたのは reproject.test.ts の
// 100件2ページ自己連鎖テストで record_id がたまたま衝突したときの、原因の分かりにくい
// 件数不一致だけだった。ここに狙い撃ちのテストを置く。
describe("tombstone guard scoping — tenant_id must gate the NOT EXISTS subquery", () => {
  it("does not let tenant A's tombstone block tenant B's upsert of the same record id", async () => {
    const recordId = uuid(1200);
    const tenantA = crypto.randomUUID();
    const tenantB = crypto.randomUUID();
    const stubA = env.TENANT_DO.get(env.TENANT_DO.idFromName(tenantA));
    const stubB = env.TENANT_DO.get(env.TENANT_DO.idFromName(tenantB));

    await stubA.registerContentType(articleType(), auth("owner1"));
    const writtenA = asWriteResult(
      await stubA.writeRecord("article", { recordId, input: validArticleInput() }, auth("owner1")),
    );
    expect(writtenA.ok).toBe(true);
    const publishedA = asPublishResult(
      await stubA.publishRecord(tenantA, recordId, auth("owner1")),
    );
    expect(publishedA.ok).toBe(true);

    await stubB.registerContentType(articleType(), auth("owner1"));
    const writtenB = asWriteResult(
      await stubB.writeRecord("article", { recordId, input: validArticleInput() }, auth("owner1")),
    );
    expect(writtenB.ok).toBe(true);
    const publishedB = asPublishResult(
      await stubB.publishRecord(tenantB, recordId, auth("owner1")),
    );
    expect(publishedB.ok).toBe(true);

    // テナント A だけ unpublish し、その delete ジョブを実配信して墓標を立てる
    // （publish_seq=1 → unpublish で publish_seq=2 の墓標）
    const unpublishedA = asUnpublishResult(
      await stubA.unpublishRecord(tenantA, recordId, auth("owner1")),
    );
    expect(unpublishedA.ok).toBe(true);
    const deleteRowA = await lastOutboxRow(stubA);
    await deliver([
      {
        jobType: "delete",
        tenantId: tenantA,
        recordId,
        sourceVersion: deleteRowA.source_version,
        publishSeq: deleteRowA.publish_seq,
      },
    ]);
    expect(await projected(tenantA, recordId)).toBeNull();
    expect(await countRows("projection_tombstones", tenantA, recordId)).toBe(1);

    // テナント B は公開したまま無関係。その upsert ジョブ（publish_seq=1）を配信する。
    // tenant_id が NOT EXISTS から抜けていると、テナント A の墓標（publish_seq=2 > 1）が
    // 誤ってこの書き込みを弾く。
    const upsertRowB = await lastOutboxRow(stubB);
    await deliver([
      {
        jobType: "upsert",
        tenantId: tenantB,
        recordId,
        sourceVersion: upsertRowB.source_version,
        publishSeq: upsertRowB.publish_seq,
      },
    ]);

    // 同じ record_id を持つだけの無関係なテナント A の墓標が、テナント B の正当な書き込みを
    // 弾いてはならない
    expect(await projected(tenantB, recordId)).not.toBeNull();
    // テナント A 側は unpublish 済みのまま
    expect(await projected(tenantA, recordId)).toBeNull();
  });
});
