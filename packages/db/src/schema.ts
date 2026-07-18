import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

// design-spec §6: 1テナント DO-SQLite のコンテンツ中核3テーブル。
// tenant_id 列が無いのは DO 境界がテナント境界のため。

export const contentTypes = sqliteTable(
  "content_types",
  {
    id: text("id").primaryKey(),
    key: text("key").notNull(),
    name: text("name").notNull(),
    fields: text("fields").notNull(), // JSON: FieldDefinition[]
    source: text("source").notNull().default("user"),
    pluginId: text("plugin_id"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    version: integer("version").notNull().default(1),
  },
  (table) => [uniqueIndex("idx_content_types_key").on(table.key)],
);

export const records = sqliteTable(
  "records",
  {
    id: text("id").primaryKey(),
    type: text("type").notNull(),
    data: text("data").notNull(), // JSON: スカラー・enum・リッチテキスト AST のみ（relation は含まない）
    fieldVersions: text("field_versions").notNull().default("{}"), // JSON: {fieldKey: counter}
    status: text("status").notNull().default("draft"),
    seq: integer("seq").notNull(), // DO 全体の単調増分（G2 先置き）
    deletedAt: text("deleted_at"), // トゥームストーン（G2）
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    createdBy: text("created_by").notNull(),
    updatedBy: text("updated_by").notNull(),
    version: integer("version").notNull().default(1),
  },
  (table) => [
    index("idx_records_type").on(table.type),
    index("idx_records_type_status").on(table.type, table.status),
    uniqueIndex("idx_records_seq").on(table.seq),
  ],
);

export const relations = sqliteTable(
  "relations",
  {
    id: text("id").primaryKey(),
    sourceId: text("source_id").notNull(),
    sourceField: text("source_field").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(), // 存在は保証しない（ソフト参照）
    ordinal: integer("ordinal").notNull().default(0),
    origin: text("origin").notNull().default("field"), // 'field' | 'body'
  },
  (table) => [
    index("idx_relations_source").on(table.sourceId, table.sourceField),
    index("idx_relations_target").on(table.targetId),
    index("idx_relations_target_type").on(table.targetType, table.targetId),
  ],
);

// design-spec §7: 公開状態の真実源は published_snapshots 行の存在。records 側に公開フラグを持たない。
export const publishedSnapshots = sqliteTable("published_snapshots", {
  recordId: text("record_id").primaryKey(), // records.id と 1 対 1
  type: text("type").notNull(),
  data: text("data").notNull(), // publish 時点の data のコピー（JSON）
  relations: text("relations").notNull(), // publish 時点の関係の凍結投影（JSON）
  publishedAt: text("published_at").notNull(),
  publishedBy: text("published_by").notNull(),
  sourceVersion: integer("source_version").notNull(), // どの records.version を publish したか（参考情報。順序トークンではない）
  // CRITICAL fix（レビュー指摘）: records.version は publish/unpublish で変化しないため順序トークンに
  // なれない（unpublish→無編集republish が同じ version の upsert/delete を生む）。DO 全体で単調な
  // 世代カウンタを別途持ち、投影の順序ガードはこちらを使う。
  publishSeq: integer("publish_seq").notNull().default(0),
});

// design-spec §12.3: アウトボックス。DO コミットと投影 D1 書き込みの dual-write を分離する。
export const outbox = sqliteTable(
  "outbox",
  {
    id: text("id").primaryKey(), // uuidv7
    jobType: text("job_type").notNull(), // 'upsert' | 'delete'
    recordId: text("record_id").notNull(),
    sourceVersion: integer("source_version").notNull(), // 参考情報。順序トークンではない（上記参照）
    publishSeq: integer("publish_seq").notNull().default(0), // 投影ジョブの順序ガード本体
    enqueuedAt: text("enqueued_at").notNull(),
    sent: integer("sent").notNull().default(0), // 送出済みフラグ（0 | 1）
  },
  (table) => [index("idx_outbox_unsent").on(table.sent, table.enqueuedAt)],
);

// design-spec §9.6: DO の alarm は 1 本しかない。最早の due_at が物理アラームを持つ多重化レジストリ。
// Phase 5a では kind = 'outbox_sweep' のみ。Phase 9 でモジュール向けに汎用化する。
export const alarmRegistry = sqliteTable("alarm_registry", {
  kind: text("kind").primaryKey(),
  dueAt: integer("due_at").notNull(), // epoch ms
});

// DO 自身は idFromName の元になった tenantId を知らない。投影ジョブの宛先に必要なので永続化する。
export const doConfig = sqliteTable("do_config", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

// design-spec §9.5 / §11.5: テナントごとのモジュール有効化レジストリ。適用済みマニフェスト
// version(§4.2 の冪等再配布の適用状態)と、有効化時に展開した権限宣言(JSON:
// { grants: {opKey: roles[]}, typeWriteGuards: {typeKey: opKey} })も同居させる。
export const moduleRegistry = sqliteTable("module_registry", {
  moduleId: text("module_id").primaryKey(),
  enabled: integer("enabled").notNull().default(0), // 0 | 1
  appliedVersion: integer("applied_version").notNull().default(0),
  permissions: text("permissions").notNull().default("{}"),
  updatedAt: text("updated_at").notNull(),
});

// design-spec §9.3 / §9.4 ステップ5: afterWrite / afterPublish イベントの outbox。
// コミットと同一トランザクションで積み、Queues(plyrs-modules)へ排出する(§12.3 と同型)。
export const moduleEvents = sqliteTable(
  "module_events",
  {
    id: text("id").primaryKey(), // uuidv7
    moduleId: text("module_id").notNull(),
    event: text("event").notNull(), // 'afterWrite' | 'afterPublish'
    recordId: text("record_id").notNull(),
    type: text("type").notNull(),
    enqueuedAt: text("enqueued_at").notNull(),
    sent: integer("sent").notNull().default(0),
  },
  (table) => [index("idx_module_events_unsent").on(table.sent, table.enqueuedAt)],
);
