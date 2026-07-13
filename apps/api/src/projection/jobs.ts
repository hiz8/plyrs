// design-spec §12.3: Queues に載るジョブ。メッセージにはデータを載せず、consumer が DO へ
// 取りに行く（128KB のメッセージ上限に record のサイズを従属させない）。
export interface UpsertJob {
  jobType: "upsert";
  tenantId: string;
  recordId: string;
  sourceVersion: number; // 参考情報（どの records.version の publish か）。順序ガードには使わない
  // CRITICAL fix: 投影の順序ガード本体。DO 発行の単調な publish 世代番号（source_version とは別物）。
  publishSeq: number;
}

export interface DeleteJob {
  jobType: "delete";
  tenantId: string;
  recordId: string;
  sourceVersion: number; // 参考情報
  publishSeq: number; // CRITICAL fix: 投影の順序ガード本体
}

// §12.3b: テナント単位の再投影。cursor で自己連鎖し、epoch より古い投影行を最後に掃く。
export interface ReprojectJob {
  jobType: "reproject";
  tenantId: string;
  cursor: string | null;
  epoch: number; // epoch ms。この時刻より前に投影された行が sweep 対象
}

export type ProjectionJob = UpsertJob | DeleteJob | ReprojectJob;

// 共有 D1 への書き込み集中を避けるため小さめに刻む（§12.3b の運用注記）
export const REPROJECT_PAGE_SIZE = 50;

// レビュー指摘（重大）: epoch は DO のアイソレートで刻んだ Date.now()、projected_at は
// キュー consumer のアイソレートで刻んだ Date.now() ―― 別アイソレートの別時計であり、
// 単純に比較してよい関係にない（歩き終わりの sweep がまさにこの比較をしている）。歩きの
// 開始直後に publish された行が、わずかに遅れた consumer の時計で epoch より前の
// projected_at を持ってしまうと、歩きに載らなかったその行を sweep が誤って消してしまう。
// consumer.ts の handleReprojectJob 冒頭コメント参照。
export const SWEEP_SKEW_MARGIN_MS = 60_000;
