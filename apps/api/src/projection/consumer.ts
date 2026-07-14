import { asProjectionPayload, asPublishedPage } from "../rpc-unwrap";
import {
  REPROJECT_PAGE_SIZE,
  SWEEP_SKEW_MARGIN_MS,
  type ProjectionJob,
  type ReprojectJob,
} from "./jobs";
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

  // Phase 5b: フィールドカタログ（型レベル情報）。publish_seq ガードは意図的に掛けない ——
  // カタログは record の世代ではなく「payload を組み立てた時点の content_types」を写すため、
  // stale な record ジョブが運ぶカタログも内容的には現在の宣言である（LWW で十分。型定義変更と
  // 競合してズレても、次の publish か再投影が上書きする）。record 側のガードで弾かれたジョブが
  // カタログだけ更新しても無害。record の EXISTS ガードにも載せない: 公開レコードが 0 件でも
  // フィルタ検証の 400/空結果の区別はカタログに依存しないため（検証は「宣言があるか」だけを見る）。
  for (const catalogRow of payload.catalog) {
    statements.push(
      db
        .prepare(
          `INSERT INTO projection_fields (tenant_id, type, field_key, kind, multi, projected_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6)
           ON CONFLICT(tenant_id, type, field_key) DO UPDATE SET
             kind = excluded.kind,
             multi = excluded.multi,
             projected_at = excluded.projected_at`,
        )
        .bind(
          tenantId,
          payload.type,
          catalogRow.fieldKey,
          catalogRow.kind,
          catalogRow.multi ? 1 : 0,
          projectedAt,
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
  // レビュー指摘（重大）: job.epoch は DO のアイソレートで刻んだ Date.now()、projected_at は
  // この consumer のアイソレートで刻んだ Date.now() ―― 別アイソレートの別時計であり、
  // 単純な大小比較で「歩きより前」を判定できる関係にない（他の GC を epoch ベースで比較する
  // 手を退けた理由と同種の話。上の Task 7 コメント参照）。歩きの開始直後に publish された
  // 行が、わずかに遅れた consumer の時計で job.epoch より前の projected_at を刻んでしまうと
  // （歩きのページ読み取りには載らないので通常の張り替えでは救われない）、この sweep が
  // 現に公開中の行を誤って消してしまう。
  // SWEEP_SKEW_MARGIN_MS だけ境界を過去へずらす（= より新しいものまで「まだ歩きの前」と
  // 許容する）方向だけが安全である: 境界を甘くし過ぎて本来消すべき幽霊行を見逃しても、
  // その行は次にどの書き込みからも触られないため projected_at が古いまま残り、次回の
  // 再投影ウォークの sweep が同じ境界で確実に掃く（1 ウォーク分だけ延命する無害な遅延）。
  // 逆に境界を厳しくする方向の間違いは、生きている公開行を削除するという取り返しのつかない
  // 事故になる（消えた行を復活させるのは手動の再投影しかない）。
  await env.PROJECTION_DB.batch([
    env.PROJECTION_DB.prepare(
      "DELETE FROM projected_records WHERE tenant_id = ?1 AND projected_at < ?2",
    ).bind(job.tenantId, job.epoch - SWEEP_SKEW_MARGIN_MS),
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
    // Phase 5b: 宣言から消えたフィールドのカタログ行を掃く。境界の向きの議論は上の
    // projected_records と同一（甘い方向にしか間違えない）。
    env.PROJECTION_DB.prepare(
      "DELETE FROM projection_fields WHERE tenant_id = ?1 AND projected_at < ?2",
    ).bind(job.tenantId, job.epoch - SWEEP_SKEW_MARGIN_MS),
  ]);
  // Task 7（レビュー指摘、probe で決定的に再現済み）: ここで墓標を GC してはならない。
  // startReprojection にロックが無いため、2 つの歩きが独立した epoch を持って同時に走りうる
  // （オーナーが「再構築」を連打するだけで起きる）。時刻ベースの GC（epoch より前の墓標を消す、
  // 猶予時間を延ばす、等）はどう変えても同じ穴が開き直す: 後発の歩きの epoch は先発の歩きが
  // まだ守り続けたい墓標の tombstoned_at より新しくなり得るため、後発の sweep が先発のために
  // 立っている墓標を消し、先発が遅れて発行する stale な書き込みが無防備になって消えたはずの
  // レコードを復活させる（しかも projected_at はどちらの epoch より新しくなるため、以後どちらの
  // 歩きの sweep にも掃かれない — レビューが再現した実際の障害）。epoch と tombstoned_at は
  // そもそも別のアイソレートが別のタイミングで刻む別の時計であり、時刻を比較して安全に GC
  // できる関係にない。
  // 墓標の GC が無くても安全かつ有界である: 墓標は基本的には「次の勝った書き込み」が自分で消す
  // （upsertStatements の `DELETE FROM projection_tombstones WHERE ... publish_seq <= ours`）ため、
  // 定常状態で墓標が残っているのは「一度は公開されて、今は非公開のレコード」に対応する。
  // ただし Queues は at-least-once なので常にそうとは限らない: publish(seq1) →
  // unpublish(seq2, 墓標が立って配信済み) → republish(seq3, 墓標は消えて行は生きている) の後に
  // seq2 の delete ジョブが再配信されると、deleteStatements の INSERT ... ON CONFLICT DO UPDATE は
  // 無条件なので、現に公開中（seq3）のレコードに対して古い世代（seq2）の墓標が孤児として
  // 再び立つことがある。これは無害である: 墓標が弾くのは「自分より新しい publish_seq を運ぶ
  // 書き込み」だけ（upsertStatements の `publish_seq > ?8` ガード）なので、この孤児墓標が
  // 弾けるのは seq2 以下の書き込みに限られ、それは定義上すでに stale であり seq3 以降の
  // 正当な書き込みを妨げたり行を復活させたりはできない。かつ主キーが (tenant_id, record_id)
  // なので、1 レコードにつき最大 1 行にしか増えない。
  // したがって墓標テーブルの行数は「操作回数」ではなく「レコード数」に有界であり、定期的な
  // 運用 GC は Phase 10 の関心事とする（tombstoned_at 列はそのために残してある。今回は対象外）。
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
