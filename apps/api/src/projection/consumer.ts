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
//
// CRITICAL fix（レビュー指摘、probe で再現済み）: 上の 1) は ON CONFLICT の UPDATE 枝でしか
// 効かない。行が既に消えている（unpublish 済み）ときは無条件 INSERT になり、再投影がページを
// 読んだ「後」に unpublish の delete ジョブが先着すると、古い publish_seq を運ぶ書き込みが
// 消えたはずのレコードを復活させてしまう（relations/index の EXISTS ガードは書き込み「後」の
// 状態を見るため、復活した行がある限り一緒に張り替わる — 防波堤にならない）。
// projection_tombstones に「この publish_seq 以下はもう有効な公開ではない」を記録し、
// INSERT を SELECT ... WHERE NOT EXISTS(自分より新しい墓標が無い) にすることで、行の有無に
// 関わらず古い書き込みを弾く。SQLite は SELECT に WHERE 節がある INSERT...SELECT に対しても
// upsert（ON CONFLICT）を許す。
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
         SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9
         WHERE NOT EXISTS (SELECT 1 FROM projection_tombstones
                            WHERE tenant_id = ?1 AND record_id = ?2 AND publish_seq > ?8)
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
    // 勝った書き込みは自分の世代以下の墓標を消す（republish の publish_seq は常にそれ以前の
    // unpublish より真に大きいため、これは自分が上書きした墓標しか消さない）。
    db
      .prepare(
        `DELETE FROM projection_tombstones
         WHERE tenant_id = ?1 AND record_id = ?2 AND publish_seq <= ?3`,
      )
      .bind(tenantId, payload.recordId, payload.publishSeq),
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
//
// CRITICAL fix（レビュー指摘）: delete と同じ batch で墓標を立てる。これが無いと、この delete の
// 後に届く「delete より古い publish_seq を運ぶ」書き込み（stale な再投影のページ読み取りなど）が
// 行の不在に乗じて平文 INSERT で復活できてしまう（upsertStatements 側のコメント参照）。
export function deleteStatements(
  db: D1Database,
  tenantId: string,
  recordId: string,
  publishSeq: number,
  tombstonedAt: number,
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
        `INSERT INTO projection_tombstones (tenant_id, record_id, publish_seq, tombstoned_at)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(tenant_id, record_id) DO UPDATE SET
           publish_seq = MAX(projection_tombstones.publish_seq, excluded.publish_seq),
           tombstoned_at = excluded.tombstoned_at`,
      )
      .bind(tenantId, recordId, publishSeq, tombstonedAt),
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
    // CRITICAL fix: 墓標も歩き終わりで GC する。epoch より前に立てられた墓標は、この歩きが
    // 発行するどの書き込みも守る必要がない（この歩きが読んだページはすべて epoch 以降に走った
    // ので、それより古い墓標が対象にしていた delete はもう反映済みか無関係）。epoch 以降に
    // 立てられた墓標（歩きの最中に起きた本物の unpublish）は消さずに残す。
    env.PROJECTION_DB.prepare(
      "DELETE FROM projection_tombstones WHERE tenant_id = ?1 AND tombstoned_at < ?2",
    ).bind(job.tenantId, job.epoch),
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
        deleteStatements(env.PROJECTION_DB, job.tenantId, job.recordId, job.publishSeq, nowMs),
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
