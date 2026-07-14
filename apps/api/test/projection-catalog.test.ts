import {
  createExecutionContext,
  createMessageBatch,
  getQueueResult,
  runInDurableObject,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import worker from "../src/index";
import type { ProjectionJob } from "../src/projection/jobs";
import type { TenantDO } from "../src/tenant-do";
import { articleType, auth, uuid, validArticleInput } from "./fixtures";
import { asPublishResult, asWriteResult } from "./rpc-unwrap";

const QUEUE_NAME = "plyrs-projection";

async function deliver(jobs: ProjectionJob[]) {
  const batch = createMessageBatch<ProjectionJob>(
    QUEUE_NAME,
    jobs.map((body, i) => ({ id: `m${i}`, timestamp: new Date(1_000 + i), attempts: 1, body })),
  );
  const ctx = createExecutionContext();
  await worker.queue(batch, env, ctx);
  return getQueueResult(batch, ctx);
}

interface CatalogRow {
  field_key: string;
  kind: string;
  multi: number;
}

async function catalogRows(tenantId: string, type: string): Promise<CatalogRow[]> {
  const { results } = await env.PROJECTION_DB.prepare(
    "SELECT field_key, kind, multi FROM projection_fields WHERE tenant_id = ?1 AND type = ?2 ORDER BY field_key",
  )
    .bind(tenantId, type)
    .all<CatalogRow>();
  return results;
}

describe("projection field catalog (Phase 5b)", () => {
  let tenantId: string;
  let stub: DurableObjectStub<TenantDO>;
  const recordId = uuid(300);
  let upsertJob: ProjectionJob;

  beforeEach(async () => {
    tenantId = crypto.randomUUID();
    stub = env.TENANT_DO.get(env.TENANT_DO.idFromName(tenantId));
    await stub.registerContentType(articleType(), auth("owner1"));
    const written = asWriteResult(
      await stub.writeRecord("article", { recordId, input: validArticleInput() }, auth("owner1")),
    );
    expect(written.ok).toBe(true);
    const published = asPublishResult(await stub.publishRecord(tenantId, recordId, auth("owner1")));
    if (!published.ok) {
      throw new Error(`publish failed: ${published.code}`);
    }
    upsertJob = {
      jobType: "upsert",
      tenantId,
      recordId,
      sourceVersion: published.snapshot.sourceVersion,
      publishSeq: published.snapshot.publishSeq,
    };
  });

  it("projects the catalog rows alongside the record upsert", async () => {
    await deliver([upsertJob]);
    // articleType: slug(text idx) / published_at(datetime idx) / authors(relation many) /
    // hero(relation one)。tags は indexed 宣言が無いので載らない。title / body も載らない。
    expect(await catalogRows(tenantId, "article")).toStrictEqual([
      { field_key: "authors", kind: "relation", multi: 1 },
      { field_key: "hero", kind: "relation", multi: 0 },
      { field_key: "published_at", kind: "date", multi: 0 },
      { field_key: "slug", kind: "text", multi: 0 },
    ]);
  });

  it("is idempotent under redelivery", async () => {
    await deliver([upsertJob]);
    await deliver([upsertJob]);
    expect((await catalogRows(tenantId, "article")).length).toBe(4);
  });

  it("does not touch the catalog on a delete job (type-level info outlives one record)", async () => {
    await deliver([upsertJob]);
    await deliver([
      {
        jobType: "delete",
        tenantId,
        recordId,
        sourceVersion: 1,
        publishSeq: upsertJob.jobType === "upsert" ? upsertJob.publishSeq + 1 : 0,
      },
    ]);
    expect((await catalogRows(tenantId, "article")).length).toBe(4);
  });

  it("sweeps catalog rows the reprojection walk did not refresh (removed declarations)", async () => {
    await deliver([upsertJob]);
    // 宣言から消えたフィールドの残骸を偽装（projected_at が sweep 境界より十分古い行）
    await env.PROJECTION_DB.prepare(
      "INSERT INTO projection_fields (tenant_id, type, field_key, kind, multi, projected_at) VALUES (?1, 'article', 'ghost', 'text', 0, ?2)",
    )
      .bind(tenantId, Date.now() - 10 * 60_000)
      .run();
    await deliver([{ jobType: "reproject", tenantId, cursor: null, epoch: Date.now() }]);
    const keys = (await catalogRows(tenantId, "article")).map((row) => row.field_key);
    expect(keys).not.toContain("ghost");
    // 歩きが刷新した現役の 4 行は生き残る
    expect(keys).toStrictEqual(["authors", "hero", "published_at", "slug"]);
  });

  // Finding 3（important）: 公開レコードが 0 件になった型（全件 unpublish 済み）は歩きの
  // ページ読み取りに一度も乗らないため、カタログ更新は record payload への相乗り
  // （upsertStatements）でしか起きない。宣言（content_types）はまだ生きているのに、終端 sweep
  // （projected_at < epoch - margin）だけがカタログ行を「触られなかった残骸」として掃いてしまうと、
  // 以後このテナントのフィルタ/include 検証が「索引宣言なし」の 400 に化ける。
  // RED-first: 現行実装（sweep の前に DO からカタログを取り直さない）ではこのテストは落ちる。
  it("survives the terminal sweep for a type whose only record was unpublished (Finding 3)", async () => {
    await deliver([upsertJob]);
    expect((await catalogRows(tenantId, "article")).length).toBe(4);

    await stub.unpublishRecord(tenantId, recordId, auth("owner1"));
    // unpublish の delete ジョブは outbox の最終行から publish_seq / source_version を読む
    // （public-list.test.ts の「stops listing a record once its unpublish delete lands」と同じ手順）
    const outboxRow = await runInDurableObject(stub, async (_instance, state) => {
      const rows = state.storage.sql
        .exec<{ publish_seq: number; source_version: number }>(
          "SELECT publish_seq, source_version FROM outbox WHERE job_type = 'delete' ORDER BY rowid DESC LIMIT 1",
        )
        .toArray();
      const last = rows[0];
      if (last === undefined) {
        throw new Error("no delete outbox row");
      }
      return last;
    });
    await deliver([
      {
        jobType: "delete",
        tenantId,
        recordId,
        sourceVersion: outboxRow.source_version,
        publishSeq: outboxRow.publish_seq,
      },
    ]);
    // 公開レコードは 0 件になったが、型の宣言（content_types）はまだ生きている
    expect((await catalogRows(tenantId, "article")).length).toBe(4);

    // カタログ行の projected_at をわざと古くする ―― 実運用では「この型のレコードが unpublish
    // されて以降、誰も publish/unpublish していない期間」に相当する（catalog は record payload
    // への相乗りでしか更新されないため、この間 projected_at は unpublish 直前のまま進まない）。
    // このテストは同期的に進むため、何もしなければ projected_at と reproject の epoch がほぼ
    // 同時刻になり、SWEEP_SKEW_MARGIN_MS の甘さに守られてバグが再現しない（偽陰性）。
    await env.PROJECTION_DB.prepare(
      "UPDATE projection_fields SET projected_at = ?1 WHERE tenant_id = ?2 AND type = 'article'",
    )
      .bind(Date.now() - 10 * 60_000, tenantId)
      .run();

    // 再投影の歩き: 公開レコードが無いのでページ読み取りは空 → 即 sweep 分岐へ落ちる
    await deliver([{ jobType: "reproject", tenantId, cursor: null, epoch: Date.now() }]);
    expect(await catalogRows(tenantId, "article")).toStrictEqual([
      { field_key: "authors", kind: "relation", multi: 1 },
      { field_key: "hero", kind: "relation", multi: 0 },
      { field_key: "published_at", kind: "date", multi: 0 },
      { field_key: "slug", kind: "text", multi: 0 },
    ]);
  });
});
