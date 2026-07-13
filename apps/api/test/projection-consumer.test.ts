import { createExecutionContext, createMessageBatch, getQueueResult } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import worker from "../src/index";
import type { ProjectionJob } from "../src/projection/jobs";
import { articleType, auth, uuid, validArticleInput } from "./fixtures";
import { asPublishResult, asWriteResult } from "./rpc-unwrap";

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
}

async function projected(tenantId: string, recordId: string): Promise<ProjectedRow | null> {
  return env.PROJECTION_DB.prepare(
    "SELECT type, slug, data, source_version FROM projected_records WHERE tenant_id = ? AND record_id = ?",
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

describe("projection consumer (design-spec §12.3)", () => {
  let tenantId: string;
  let stub: DurableObjectStub<import("../src/tenant-do").TenantDO>;
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
    const result = await deliver([{ jobType: "upsert", tenantId, recordId, sourceVersion: 1 }]);
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
    const job: ProjectionJob = { jobType: "upsert", tenantId, recordId, sourceVersion: 1 };
    await deliver([job]);
    await deliver([job]);

    expect(await countRows("projected_relations", tenantId, recordId)).toBe(3);
    expect(await countRows("projection_index", tenantId, recordId)).toBe(2);
  });

  it("ignores an upsert older than what is already projected (order guard)", async () => {
    await stub.writeRecord(
      "article",
      { recordId, input: { ...validArticleInput(), title: "第2版" } },
      auth("owner1"),
    );
    await stub.publishRecord(tenantId, recordId, auth("owner1"));
    // 新しい版（v2）が先に着き、古い版（v1）のジョブが遅れて届く
    await deliver([{ jobType: "upsert", tenantId, recordId, sourceVersion: 2 }]);
    await deliver([{ jobType: "upsert", tenantId, recordId, sourceVersion: 1 }]);

    const row = await projected(tenantId, recordId);
    expect(row?.source_version).toBe(2);
    expect(JSON.parse(row?.data ?? "{}")).toMatchObject({ title: "第2版" });
  });

  it("deletes the record and its side tables on an unpublish job", async () => {
    await deliver([{ jobType: "upsert", tenantId, recordId, sourceVersion: 1 }]);
    await stub.unpublishRecord(tenantId, recordId, auth("owner1"));
    await deliver([{ jobType: "delete", tenantId, recordId, sourceVersion: 1 }]);

    expect(await projected(tenantId, recordId)).toBeNull();
    expect(await countRows("projected_relations", tenantId, recordId)).toBe(0);
    expect(await countRows("projection_index", tenantId, recordId)).toBe(0);
  });

  it("ignores a delete whose version is older than the projection (republish won)", async () => {
    await deliver([{ jobType: "upsert", tenantId, recordId, sourceVersion: 1 }]);
    await stub.writeRecord(
      "article",
      { recordId, input: { ...validArticleInput(), title: "第2版" } },
      auth("owner1"),
    );
    await stub.publishRecord(tenantId, recordId, auth("owner1"));
    await deliver([{ jobType: "upsert", tenantId, recordId, sourceVersion: 2 }]);
    // unpublish(v1) が遅れて届く — 既に republish(v2) が載っているので無視されなければならない
    await deliver([{ jobType: "delete", tenantId, recordId, sourceVersion: 1 }]);

    expect(await projected(tenantId, recordId)).not.toBeNull();
  });

  it("retries the message when the job cannot be handled", async () => {
    // 未知のジョブ種別（将来のジョブが古い Worker に届いた場合）は ack せず retry させる
    const bogus = {
      jobType: "bogus",
      tenantId,
      recordId,
      sourceVersion: 1,
    } as unknown as ProjectionJob;
    const result = await deliver([bogus]);
    expect(result.explicitAcks).toStrictEqual([]);
    expect(result.retryMessages).toStrictEqual([{ msgId: "m0" }]);
  });
});
