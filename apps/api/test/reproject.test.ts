import { createExecutionContext, createMessageBatch, getQueueResult } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import worker from "../src/index";
import type { ProjectionJob } from "../src/projection/jobs";
import { articleType, auth, uuid, validArticleInput } from "./fixtures";
import { asReprojectResult, asWriteResult } from "./rpc-unwrap";

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

    // 投影にだけ存在する幽霊行を作る（乖離の再現）
    await env.PROJECTION_DB.prepare(
      "INSERT INTO projected_records (tenant_id, record_id, type, slug, published_at, data, source_version, projected_at) VALUES (?, ?, 'article', 'ghost', '2026-01-01T00:00:00.000Z', '{}', 1, 1)",
    )
      .bind(tenantId, uuid(499))
      .run();

    const started = asReprojectResult(await stub.startReprojection(tenantId, auth("owner1")));
    expect(started.ok).toBe(true);
    if (!started.ok) {
      return;
    }

    await deliver([{ jobType: "reproject", tenantId, cursor: null, epoch: started.epoch }]);

    // snapshot に無い幽霊行が消え、公開中の 3 件だけが残る
    expect(await projectedIds(tenantId)).toStrictEqual([uuid(400), uuid(401), uuid(402)]);

    const orphanRelations = await env.PROJECTION_DB.prepare(
      "SELECT COUNT(*) AS n FROM projected_relations WHERE tenant_id = ? AND source_id = ?",
    )
      .bind(tenantId, uuid(499))
      .first<{ n: number }>();
    expect(orphanRelations?.n).toBe(0);
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
