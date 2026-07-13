import { asProjectionPayload, asPublishedPage } from "../rpc-unwrap";
import { REPROJECT_PAGE_SIZE, type ProjectionJob, type ReprojectJob } from "./jobs";
import type { ProjectionPayload } from "./payload";

// 順序ガードの要（CRITICAL fix: publish_seq を使う。source_version は publish/unpublish で
// 変化しないため順序トークンになれない — unpublish→無編集republish が同じ source_version の
// upsert/delete を生み、Queues の配信順序非保証と組み合わさると新しい世代を古いジョブが消しうる）:
// 1) projected_records を「自分の publish_seq が現行以上のときだけ」条件付き upsert する。
// 2) relations / index は「upsert 後に自分の publish_seq が現に載っているときだけ」張り替える。
// これで古いジョブは 1) で弾かれ、2) も EXISTS が偽になるため新しい投影を壊せない。
// 再配信（同一 publish_seq）は 1) が >= で通り、2) も真になるので同じ内容を冪等に書き直す。
// >= であって > ではない: 同一世代の再配信でも projected_at を更新する必要がある
// （再投影の mark-and-sweep が projected_at >= epoch を生存判定に使うため。Task 7）。
export function upsertStatements(
  db: D1Database,
  tenantId: string,
  payload: ProjectionPayload,
  projectedAt: number,
): D1PreparedStatement[] {
  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT INTO projected_records
           (tenant_id, record_id, type, slug, published_at, data, source_version, publish_seq, projected_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
         ON CONFLICT(tenant_id, record_id) DO UPDATE SET
           type = excluded.type,
           slug = excluded.slug,
           published_at = excluded.published_at,
           data = excluded.data,
           source_version = excluded.source_version,
           publish_seq = excluded.publish_seq,
           projected_at = excluded.projected_at
         WHERE excluded.publish_seq >= projected_records.publish_seq`,
      )
      .bind(
        tenantId,
        payload.recordId,
        payload.type,
        payload.slug,
        payload.publishedAt,
        JSON.stringify(payload.data),
        payload.sourceVersion,
        payload.publishSeq,
        projectedAt,
      ),
    db
      .prepare(
        `DELETE FROM projected_relations
         WHERE tenant_id = ?1 AND source_id = ?2
           AND EXISTS (SELECT 1 FROM projected_records
                       WHERE tenant_id = ?1 AND record_id = ?2 AND publish_seq = ?3)`,
      )
      .bind(tenantId, payload.recordId, payload.publishSeq),
    db
      .prepare(
        `DELETE FROM projection_index
         WHERE tenant_id = ?1 AND record_id = ?2
           AND EXISTS (SELECT 1 FROM projected_records
                       WHERE tenant_id = ?1 AND record_id = ?2 AND publish_seq = ?3)`,
      )
      .bind(tenantId, payload.recordId, payload.publishSeq),
  ];

  for (const relation of payload.relations) {
    statements.push(
      db
        .prepare(
          `INSERT INTO projected_relations
             (tenant_id, source_id, source_field, target_type, target_id, ordinal, origin)
           SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7
           WHERE EXISTS (SELECT 1 FROM projected_records
                         WHERE tenant_id = ?1 AND record_id = ?2 AND publish_seq = ?8)`,
        )
        .bind(
          tenantId,
          payload.recordId,
          relation.sourceField,
          relation.targetType,
          relation.targetId,
          relation.ordinal,
          relation.origin,
          payload.publishSeq,
        ),
    );
  }

  for (const indexRow of payload.index) {
    statements.push(
      db
        .prepare(
          `INSERT INTO projection_index
             (tenant_id, type, field_key, value_text, value_num, value_date, record_id)
           SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7
           WHERE EXISTS (SELECT 1 FROM projected_records
                         WHERE tenant_id = ?1 AND record_id = ?7 AND publish_seq = ?8)`,
        )
        .bind(
          tenantId,
          payload.type,
          indexRow.fieldKey,
          indexRow.valueText,
          indexRow.valueNum,
          indexRow.valueDate,
          payload.recordId,
          payload.publishSeq,
        ),
    );
  }
  return statements;
}

// §12.3: delete も publish_seq でガードする（unpublish 発行後に republish が先着した場合に消さない。
// CRITICAL fix: 以前は source_version でガードしていたが、それは publish/unpublish で変化しないため
// 同一世代を装った古い delete が新しい世代を消せてしまっていた）
export function deleteStatements(
  db: D1Database,
  tenantId: string,
  recordId: string,
  publishSeq: number,
): D1PreparedStatement[] {
  return [
    db
      .prepare(
        `DELETE FROM projected_records
         WHERE tenant_id = ?1 AND record_id = ?2 AND publish_seq <= ?3`,
      )
      .bind(tenantId, recordId, publishSeq),
    db
      .prepare(
        `DELETE FROM projected_relations
         WHERE tenant_id = ?1 AND source_id = ?2
           AND NOT EXISTS (SELECT 1 FROM projected_records
                           WHERE tenant_id = ?1 AND record_id = ?2)`,
      )
      .bind(tenantId, recordId),
    db
      .prepare(
        `DELETE FROM projection_index
         WHERE tenant_id = ?1 AND record_id = ?2
           AND NOT EXISTS (SELECT 1 FROM projected_records
                           WHERE tenant_id = ?1 AND record_id = ?2)`,
      )
      .bind(tenantId, recordId),
  ];
}

function stubFor(env: Env, tenantId: string) {
  return env.TENANT_DO.get(env.TENANT_DO.idFromName(tenantId));
}

// §12.3b: 投影は snapshot から決定的に再構築できる派生物。
// mark-and-sweep: このジョブが投影した行は projected_at >= epoch になる。全ページを投影し終えたら
// projected_at < epoch の行（= snapshot に無い / 別テナント時代の残骸）を掃く。
// 再投影の最中に走った通常の publish も projected_at >= epoch になるので巻き込まれない。
async function handleReprojectJob(env: Env, job: ReprojectJob, nowMs: number): Promise<void> {
  const page = asPublishedPage(
    await stubFor(env, job.tenantId).getPublishedPage(job.cursor, REPROJECT_PAGE_SIZE),
  );
  for (const payload of page.payloads) {
    await env.PROJECTION_DB.batch(
      upsertStatements(env.PROJECTION_DB, job.tenantId, payload, nowMs),
    );
  }
  if (page.nextCursor !== null) {
    // 共有 D1 への書き込み集中を避けるため 1 ページずつ自己連鎖する（§12.3b の運用注記）。
    // nextCursor は payloads.length === limit のときに非 null になる（loadPublishedPage の
    // 仕様）ため、ちょうど limit 件で終わる場合は「もう次が無い」空ページを取りに行く
    // 追加の 1 往復が発生する。その空ページは payloads.length(0) !== limit なので
    // nextCursor が null になり、下の sweep 分岐に落ちて掃除で終わる（無限連鎖しない）。
    await env.PROJECTION_QUEUE.send({
      jobType: "reproject",
      tenantId: job.tenantId,
      cursor: page.nextCursor,
      epoch: job.epoch,
    });
    return;
  }
  await env.PROJECTION_DB.batch([
    env.PROJECTION_DB.prepare(
      "DELETE FROM projected_records WHERE tenant_id = ?1 AND projected_at < ?2",
    ).bind(job.tenantId, job.epoch),
    env.PROJECTION_DB.prepare(
      `DELETE FROM projected_relations
       WHERE tenant_id = ?1
         AND NOT EXISTS (SELECT 1 FROM projected_records
                         WHERE tenant_id = ?1 AND record_id = projected_relations.source_id)`,
    ).bind(job.tenantId),
    env.PROJECTION_DB.prepare(
      `DELETE FROM projection_index
       WHERE tenant_id = ?1
         AND NOT EXISTS (SELECT 1 FROM projected_records
                         WHERE tenant_id = ?1 AND record_id = projection_index.record_id)`,
    ).bind(job.tenantId),
  ]);
}

export async function handleProjectionJob(
  env: Env,
  job: ProjectionJob,
  nowMs: number,
): Promise<void> {
  switch (job.jobType) {
    case "upsert": {
      const payload = asProjectionPayload(
        await stubFor(env, job.tenantId).getProjectionPayload(job.recordId),
      );
      if (payload === null) {
        // 送出後に unpublish された。その delete ジョブが後から正しい状態にする（ここでは触らない）
        return;
      }
      // 3 テーブルの張り替えは batch()（暗黙トランザクション）で原子的に（§12.3）
      await env.PROJECTION_DB.batch(
        upsertStatements(env.PROJECTION_DB, job.tenantId, payload, nowMs),
      );
      return;
    }
    case "delete": {
      await env.PROJECTION_DB.batch(
        deleteStatements(env.PROJECTION_DB, job.tenantId, job.recordId, job.publishSeq),
      );
      return;
    }
    case "reproject": {
      // 判別可能ユニオンで job は ReprojectJob に絞られる
      await handleReprojectJob(env, job, nowMs);
      return;
    }
    default: {
      // 未知のジョブは retry させる（観測点）
      throw new Error(`unknown projection job: ${JSON.stringify(job)}`);
    }
  }
}
