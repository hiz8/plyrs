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
