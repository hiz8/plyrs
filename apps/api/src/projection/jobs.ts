// design-spec §12.3: Queues に載るジョブ。メッセージにはデータを載せず、consumer が DO へ
// 取りに行く（128KB のメッセージ上限に record のサイズを従属させない）。
export interface UpsertJob {
  jobType: "upsert";
  tenantId: string;
  recordId: string;
  sourceVersion: number; // 参考情報（どの records.version の publish か）。順序ガードには使わない
  // CRITICAL fix: 公開用 DB への反映の順序ガード本体。DO 発行の単調な `publish_seq`（source_version とは別物）。
  publishSeq: number;
}

export interface DeleteJob {
  jobType: "delete";
  tenantId: string;
  recordId: string;
  sourceVersion: number; // 参考情報
  publishSeq: number; // CRITICAL fix: 公開用 DB への反映の順序ガード本体
}

// §12.3b: テナント単位の公開用 DB の再構築。cursor で次のジョブを自分で送り、epoch より古い公開用 DB の行を最後に削除する。
export interface ReprojectJob {
  jobType: "reproject";
  tenantId: string;
  cursor: string | null;
  epoch: number; // epoch ms。この時刻より前に反映された行が sweep 対象
}

export type ProjectionJob = UpsertJob | DeleteJob | ReprojectJob;

// 公開用 DB への書き込み集中を避けるため小さめに刻む（§12.3b の運用注記）
export const REPROJECT_PAGE_SIZE = 50;

// レビュー指摘（重大）: epoch は DO のアイソレートで刻んだ Date.now()、projected_at は
// キュー consumer のアイソレートで刻んだ Date.now() ―― 別アイソレートの別時計であり、
// 単純に比較してよい関係にない（公開用 DB の再構築を終える sweep がまさにこの比較をしている）。公開用 DB の再構築の
// 開始直後に publish された行が、わずかに遅れた consumer の時計で epoch より前の
// projected_at を持ってしまうと、再構築のページ読み取りに載らなかったその行を sweep が誤って消してしまう。
// consumer.ts の handleReprojectJob 冒頭コメント参照。
export const SWEEP_SKEW_MARGIN_MS = 60_000;
