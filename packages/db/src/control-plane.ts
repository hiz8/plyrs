import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

// design-spec §2: コントロールプレーン（ID・認可）。テナントデータ本体（DO）の外側の中央 D1。
// 「テナントのデータを開いてよいか」を、そのデータを開かずに判定するための真実源。

export const tenants = sqliteTable(
  "tenants",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [uniqueIndex("idx_tenants_slug").on(table.slug)],
);

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [uniqueIndex("idx_users_email").on(table.email)],
);

// design-spec §2: 二層化により (user_id, tenant_id, role) の素直な形
export const memberships = sqliteTable(
  "memberships",
  {
    userId: text("user_id").notNull(),
    tenantId: text("tenant_id").notNull(),
    role: text("role").notNull(), // 'owner' | 'editor' | 'viewer'（apps/api 側 permissions.ts が真実源）
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.tenantId] }),
    index("idx_memberships_tenant").on(table.tenantId),
  ],
);

// design-spec §11.2: セッションの真実源は中央 D1。トークンは平文を保存せずハッシュのみ。
export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    tokenHash: text("token_hash").notNull(),
    userId: text("user_id").notNull(),
    expiresAt: text("expires_at").notNull(),
    createdAt: text("created_at").notNull(),
    revokedAt: text("revoked_at"),
  },
  (table) => [
    uniqueIndex("idx_sessions_token_hash").on(table.tokenHash),
    index("idx_sessions_user").on(table.userId),
  ],
);

// Phase 9: モジュール有効化の control-plane ミラー。真実源は各テナント DO の module_registry
// で、この表は型定義再配布(§4.2 の Queues 配信)が「どのテナントに配るか」を DO を起こさずに
// 列挙するための派生。enable/disable の HTTP ルートが best-effort で書く(失敗しても DO 側の
// 起床時遅延適用が安全網)。
export const tenantModules = sqliteTable(
  "tenant_modules",
  {
    tenantId: text("tenant_id").notNull(),
    moduleId: text("module_id").notNull(),
    enabled: integer("enabled").notNull().default(0),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.moduleId] }),
    index("idx_tenant_modules_module").on(table.moduleId, table.enabled),
  ],
);
