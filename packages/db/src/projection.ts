import { index, integer, primaryKey, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

// design-spec §12.2: 公開読み取りモデル（共有投影 D1）。
// ここだけは「コンテンツ系に tenant_id を持たない」原則を意図的に破る:
// 投影は真実源ではない使い捨ての派生物であり、載るのは publish 済み＝公開意図のデータのみ。

export const projectedRecords = sqliteTable(
  "projected_records",
  {
    tenantId: text("tenant_id").notNull(),
    recordId: text("record_id").notNull(),
    type: text("type").notNull(),
    // G4: フィールド key が 'slug' かつ text かつ unique のフィールドだけを実カラムへ昇格
    slug: text("slug"),
    publishedAt: text("published_at").notNull(),
    data: text("data").notNull(), // JSON: 型固有フィールドは実カラムに昇格しない
    sourceVersion: integer("source_version").notNull(), // どの records.version の投影か（参考情報）
    // CRITICAL fix（レビュー指摘）: 順序逆転ガード本体（§12.3）。source_version は publish/unpublish で
    // 変化しないため順序トークンになれない。DO 発行の単調な publish 世代番号をここに使う。
    publishSeq: integer("publish_seq").notNull().default(0),
    projectedAt: integer("projected_at").notNull(), // epoch ms。再投影の mark-and-sweep 用
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.recordId] }),
    index("idx_projected_records_type_published").on(table.tenantId, table.type, table.publishedAt),
    index("idx_projected_records_type_slug").on(table.tenantId, table.type, table.slug),
    index("idx_projected_records_sweep").on(table.tenantId, table.projectedAt),
  ],
);

// CRITICAL fix（レビュー指摘。probe で再現済み）: projected_records の upsert は ON CONFLICT の
// UPDATE 枝でしか publish_seq ガードが効かない。行が既に消えている（unpublish 済み）ときは
// 無条件 INSERT になるため、ページ読み取り後に unpublish が先着した再投影の書き込みが、消えた
// はずのレコードを平文 INSERT で復活させてしまう。この墓標テーブルで「この publish_seq 以下の
// 書き込みはもう有効な公開ではない」という事実を projected_records とは別に保持し、INSERT 側にも
// ガードをかける。
// あえて projected_records に「unpublished」フラグを足さない: Phase 5b の公開読み取り API は
// projected_records を直接読む。同テーブルにフラグを足すと、どこか 1 箇所のクエリがフィルタを
// 忘れただけで非公開データが漏れる。別テーブルなら「行が無ければ見えない」という構造そのものが
// フェイルセーフになる。
export const projectionTombstones = sqliteTable(
  "projection_tombstones",
  {
    tenantId: text("tenant_id").notNull(),
    recordId: text("record_id").notNull(),
    publishSeq: integer("publish_seq").notNull(),
    tombstonedAt: integer("tombstoned_at").notNull(), // epoch ms。再投影 sweep の GC 基準
  },
  (table) => [primaryKey({ columns: [table.tenantId, table.recordId] })],
);

export const projectedRelations = sqliteTable(
  "projected_relations",
  {
    tenantId: text("tenant_id").notNull(),
    sourceId: text("source_id").notNull(),
    sourceField: text("source_field").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    ordinal: integer("ordinal").notNull().default(0),
    // origin は DO 側 relations と同じ語彙（'field' | 'body'）。body 由来は Phase 7 で入る
    origin: text("origin").notNull().default("field"),
    // Phase 8 裁定 4: snapshotEmbed "value" の凍結埋め込み(AssetEmbed の JSON)。
    // null = 素の ID 参照。公開 read はこの値をそのまま fields へインラインする(§12.5)。
    embed: text("embed"),
  },
  (table) => [
    primaryKey({
      columns: [table.tenantId, table.sourceId, table.sourceField, table.origin, table.ordinal],
    }),
    index("idx_projected_relations_target").on(table.tenantId, table.targetId),
    index("idx_projected_relations_target_type").on(
      table.tenantId,
      table.targetType,
      table.targetId,
    ),
  ],
);

// design-spec §12.2: 索引専用サイドテーブル。レコード復元には使わない（EAV ではない）。
// フィルタ/ソートで record_id を絞り、実体は projected_records から 1 回の join で取る。
export const projectionIndex = sqliteTable(
  "projection_index",
  {
    tenantId: text("tenant_id").notNull(),
    type: text("type").notNull(),
    fieldKey: text("field_key").notNull(),
    valueText: text("value_text"),
    valueNum: real("value_num"), // number / boolean(0|1)。TEXT 一列に混ぜるとソートが壊れる
    valueDate: text("value_date"), // ISO8601（文字列ソート = 時系列ソート）
    recordId: text("record_id").notNull(),
  },
  (table) => [
    index("idx_projection_index_text").on(
      table.tenantId,
      table.type,
      table.fieldKey,
      table.valueText,
    ),
    index("idx_projection_index_num").on(
      table.tenantId,
      table.type,
      table.fieldKey,
      table.valueNum,
    ),
    index("idx_projection_index_date").on(
      table.tenantId,
      table.type,
      table.fieldKey,
      table.valueDate,
    ),
    index("idx_projection_index_record").on(table.tenantId, table.recordId),
  ],
);

// Phase 5b: 公開 read API のためのフィールドカタログ。公開経路は DO 内の content_types を
// 読めない（DO を起こさないことがコスト設計の前提。§12.7）ため、「どのフィールドが索引宣言
// 済みで、値が projection_index のどの型別カラムに入っているか・複数値か」をここへ投影する。
// kind: 'text' | 'num' | 'bool' | 'date' は projection_index の対応カラム（bool は value_num の
// 0/1）。'relation' は projected_relations を引くフィールド。multi=1 はソート不可（行分割により
// 順序が未定義。ロードマップ §9）。record の upsert に相乗りする LWW 更新で、再投影の
// mark-and-sweep が宣言から消えた行を掃く（projected_at はそのための列）。
export const projectionFields = sqliteTable(
  "projection_fields",
  {
    tenantId: text("tenant_id").notNull(),
    type: text("type").notNull(),
    fieldKey: text("field_key").notNull(),
    kind: text("kind").notNull(),
    multi: integer("multi").notNull().default(0),
    projectedAt: integer("projected_at").notNull(), // epoch ms。再投影の mark-and-sweep 用
  },
  (table) => [primaryKey({ columns: [table.tenantId, table.type, table.fieldKey] })],
);
