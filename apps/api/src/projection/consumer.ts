import { asProjectionPayload } from "../rpc-unwrap";
import type { ProjectionJob } from "./jobs";
import type { ProjectionPayload } from "./payload";

// version ガードの要:
// 1) projected_records を「自分の version が現行以上のときだけ」条件付き upsert する。
// 2) relations / index は「upsert 後に自分の version が現に載っているときだけ」張り替える。
// これで古いジョブは 1) で弾かれ、2) も EXISTS が偽になるため新しい投影を壊せない。
// 再配信（同一 version）は 1) が >= で通り、2) も真になるので同じ内容を冪等に書き直す。
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
           (tenant_id, record_id, type, slug, published_at, data, source_version, projected_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
         ON CONFLICT(tenant_id, record_id) DO UPDATE SET
           type = excluded.type,
           slug = excluded.slug,
           published_at = excluded.published_at,
           data = excluded.data,
           source_version = excluded.source_version,
           projected_at = excluded.projected_at
         WHERE excluded.source_version >= projected_records.source_version`,
      )
      .bind(
        tenantId,
        payload.recordId,
        payload.type,
        payload.slug,
        payload.publishedAt,
        JSON.stringify(payload.data),
        payload.sourceVersion,
        projectedAt,
      ),
    db
      .prepare(
        `DELETE FROM projected_relations
         WHERE tenant_id = ?1 AND source_id = ?2
           AND EXISTS (SELECT 1 FROM projected_records
                       WHERE tenant_id = ?1 AND record_id = ?2 AND source_version = ?3)`,
      )
      .bind(tenantId, payload.recordId, payload.sourceVersion),
    db
      .prepare(
        `DELETE FROM projection_index
         WHERE tenant_id = ?1 AND record_id = ?2
           AND EXISTS (SELECT 1 FROM projected_records
                       WHERE tenant_id = ?1 AND record_id = ?2 AND source_version = ?3)`,
      )
      .bind(tenantId, payload.recordId, payload.sourceVersion),
  ];

  for (const relation of payload.relations) {
    statements.push(
      db
        .prepare(
          `INSERT INTO projected_relations
             (tenant_id, source_id, source_field, target_type, target_id, ordinal, origin)
           SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7
           WHERE EXISTS (SELECT 1 FROM projected_records
                         WHERE tenant_id = ?1 AND record_id = ?2 AND source_version = ?8)`,
        )
        .bind(
          tenantId,
          payload.recordId,
          relation.sourceField,
          relation.targetType,
          relation.targetId,
          relation.ordinal,
          relation.origin,
          payload.sourceVersion,
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
                         WHERE tenant_id = ?1 AND record_id = ?7 AND source_version = ?8)`,
        )
        .bind(
          tenantId,
          payload.type,
          indexRow.fieldKey,
          indexRow.valueText,
          indexRow.valueNum,
          indexRow.valueDate,
          payload.recordId,
          payload.sourceVersion,
        ),
    );
  }
  return statements;
}

// §12.3: delete も version ガードする（unpublish 発行後に republish が先着した場合に消さない）
export function deleteStatements(
  db: D1Database,
  tenantId: string,
  recordId: string,
  sourceVersion: number,
): D1PreparedStatement[] {
  return [
    db
      .prepare(
        `DELETE FROM projected_records
         WHERE tenant_id = ?1 AND record_id = ?2 AND source_version <= ?3`,
      )
      .bind(tenantId, recordId, sourceVersion),
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
        deleteStatements(env.PROJECTION_DB, job.tenantId, job.recordId, job.sourceVersion),
      );
      return;
    }
    case "reproject": {
      // 再投影は Task 7 で実装する。それまでは未実装として retry に落とす。
      throw new Error("reprojection is not implemented yet");
    }
    default: {
      // 未知のジョブは retry させる（観測点）
      throw new Error(`unknown projection job: ${JSON.stringify(job)}`);
    }
  }
}
