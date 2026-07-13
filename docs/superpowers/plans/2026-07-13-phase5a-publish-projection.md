# Phase 5a: publish → アウトボックス → Queues → 投影 D1 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** publish / unpublish を DO に実装し、アウトボックス + alarm 多重化 sweeper + Cloudflare Queues consumer を経由して、共有投影 D1（3テーブル）へ冪等に write-through する経路を、テナント単位の再投影ジョブ込みで通す。

**Architecture:** DO 内で `published_snapshots` を作る/消すのと同一トランザクションで `outbox` 行と `alarm_registry` 行を書く（`setAlarm` は `transactionSync` に参加しロールバックで巻き戻ることを実証済み ＝ 原子的）。正常系はコミット直後に Queues へ送出し、落ちた分は alarm sweeper が拾い直す。consumer は DO へ RPC で投影ペイロードを取りに行き（メッセージ本体にデータを載せないので 128KB 制限に当たらない）、`source_version` ガード付きの D1 `batch()` で 3 テーブルを原子的に張り替える。投影は snapshot から決定的に再構築できる派生物であり、テナント単位の再投影ジョブが mark-and-sweep で作り直す。

**Tech Stack:** Cloudflare Durable Objects (SQLite) / Cloudflare Queues / D1 / Drizzle ORM / Hono / Vitest 4 + @cloudflare/vitest-pool-workers 0.18

## Global Constraints

- 対象ブランチ: `worktree-phase5a-publish-projection`（`main` = `40f99c8` から分岐）。EnterWorktree 直後に `git reset --hard main` を実行すること（baseRef が古い origin/main を指すため）。
- **`git stash` / `git stash pop` の使用禁止**（スタックはリポジトリ共有。他セッションの stash を誤適用した事故が実際に起きている）。作業の退避が必要なら明示的にコミットする。
- **`@ts-expect-error` の使用禁止**。RPC 戻り値の型は `apps/api/src/rpc-unwrap.ts` の型付きアンラップ関数を通す（Cloudflare の `Rpc.Serializable` 検査が `Record<string, unknown>` を含む `ok:true` 枝を `never` に潰すため）。
- TypeScript strict + `noUncheckedIndexedAccess` + `verbatimModuleSyntax`。`any` 禁止。
- 検証コマンド（リポジトリルートで実行）: `pnpm lint` / `pnpm format:check` / `pnpm typecheck` / `pnpm test`。**レポートには実際のコマンド出力を貼ること**（「通った」という主張だけでは不可）。
- `apps/api` のテストは `vitest run --no-isolate --max-workers=1`（WS + DO テストの要件）。全テストファイルが 1 つの miniflare インスタンスとストレージを共有するため、**テスト間で衝突しない一意な ID（`crypto.randomUUID()` 由来の接頭辞、`freshStub()`）を使う**こと。
- コード中のコメントは日本語。参照する仕様は `docs/design-spec.md`（§7 / §9.6 / §12）。
- 実証済みの前提（Phase 5a のプローブで確認、推測ではない）:
  - `ctx.storage.setAlarm()` は `transactionSync` の中から呼べ、**ロールバックで巻き戻る**。ただし `Promise<void>` を返すので、クロージャ内では `await` せず promise を掴み、トランザクションを出てから `await` する。
  - DO の `env` は Queues producer バインディングを持ち、`await this.env.QUEUE.send()` は RPC 内でも `alarm()` 内でも動く。
  - `cloudflare:test` の `runDurableObjectAlarm(stub)` でアラームを決定論的に実行できる。**この経路では `alarm()` の `alarmInfo` 引数は `undefined`** で渡るため、ハンドラは引数を使わない実装にする。
  - `evictDurableObject(stub)` でインスタンスだけ破棄でき、constructor の再アームをテストできる。
  - **`SELF.queue()` は壊れている**（`DataCloneError`）。使ってはいけない。queue consumer のテストは `createMessageBatch` + `worker.queue(batch, env, ctx)` + `getQueueResult` か、`env.QUEUE.send()` → ポーリングで行う。
  - `max_batch_timeout: 0` にしないと 1 メッセージあたり約 1 秒待たされる（0 なら約 35ms）。

---

## 裁定済みの設計判断（ユーザー確認済み、2026-07-13）

| # | 論点 | 決定 |
|---|------|------|
| G4 | 投影の `slug` 実カラムへの昇格規約 | フィールド key が `slug` かつ `type: "text"` かつ `config.unique === true` のフィールド値のみ昇格。該当が無ければ `slug = NULL` |
| — | `snapshotEmbed: "value"` の実装範囲 | **Phase 5a では実装しない**（id 解決のみ）。埋め込み対象フィールドの語彙はアセット型と一緒に Phase 8 で決める |
| — | 公開中 record の削除（トゥームストーン化） | **delete は unpublish を強制する**。`deleteRecord` は snapshot を消し、outbox に delete ジョブを積む（archive は仕様どおり強制 unpublish しない） |
| — | 公開 read API のパス（G3） | `/public/v1/:tenantSlug/...`。**Phase 5b の範囲**。5a では公開 read エンドポイントを作らない |

## Phase 5a のスコープ外（Phase 5b で実装）

- 公開 read API（単体 / 一覧 / フィルタ / ソート / カーソルページネーション / 関係解決）
- tenantSlug → tenantId 解決（コントロールプレーン D1 + KV キャッシュ）
- エッジキャッシュ（Cache API / KV）

---

## ファイル構成

**新規作成:**

| ファイル | 責務 |
|---------|------|
| `packages/db/src/projection.ts` | 投影 D1 の 3 テーブル（drizzle スキーマ） |
| `packages/db/drizzle-projection.config.ts` | 投影 D1 のマイグレーション生成設定 |
| `packages/db/drizzle-projection/*.sql` | 生成されるマイグレーション（コミットする） |
| `apps/api/src/projection/payload.ts` | **純関数**: content_type 定義 + snapshot → 投影ペイロード（slug 昇格 / 型別 index 行） |
| `apps/api/src/projection/jobs.ts` | Queues メッセージ型（upsert / delete / reproject）と定数 |
| `apps/api/src/projection/consumer.ts` | 投影 D1 への冪等な書き込み（version ガード + `batch()`） |
| `apps/api/src/do/publish.ts` | DO 側の publish / unpublish / カスケード unpublish / snapshot 読み出し |
| `apps/api/src/do/outbox.ts` | outbox 行の enqueue / 未送出行の読み出し / 送出済みマーク |
| `apps/api/src/do/alarms.ts` | alarm 多重化レジストリ（登録 / 最小 due / 期限到来 kind / 解除） |
| `apps/api/src/projection/payload.test.ts` | payload 純関数のユニットテスト |
| `apps/api/test/publish.test.ts` | publish / unpublish / カスケードの DO テスト |
| `apps/api/test/sweeper.test.ts` | alarm レジストリ + sweeper + 再アームのテスト |
| `apps/api/test/projection-consumer.test.ts` | consumer の冪等性 / version ガード / 3テーブル張り替え |
| `apps/api/test/reproject.test.ts` | 再投影ジョブ（ページング + mark-and-sweep） |
| `apps/api/test/projection-e2e.test.ts` | publish → 実 Queue → 投影 D1 の配線テスト |

**変更:**

| ファイル | 変更内容 |
|---------|---------|
| `packages/db/src/schema.ts` | DO 側に `published_snapshots` / `outbox` / `alarm_registry` / `do_config` を追加 |
| `packages/db/src/index.ts` | 追加テーブルの再エクスポート |
| `packages/db/package.json` | `exports["./projection"]` と `generate:projection` スクリプト |
| `packages/db/drizzle/*` | DO マイグレーション 0001 を生成（`migrations.js` も更新される） |
| `apps/api/wrangler.jsonc` | `PROJECTION_DB` バインディング + Queues producer / consumer |
| `apps/api/env.d.ts` | `PROJECTION_DB` / `PROJECTION_QUEUE` / `TEST_PROJECTION_MIGRATIONS` |
| `apps/api/vitest.config.ts` | 投影 D1 マイグレーションの読み込み |
| `apps/api/test/apply-migrations.ts` | 投影 D1 へのマイグレーション適用 |
| `apps/api/src/index.ts` | default export を `{ fetch, queue }` に変更（consumer 追加） |
| `apps/api/src/auth/permissions.ts` | `record:publish` / `projection:rebuild` の追加 |
| `apps/api/src/tenant-do.ts` | publish / unpublish / 再投影 RPC、outbox 送出、`alarm()` ハンドラ、constructor 再アーム |
| `apps/api/src/do/delete-record.ts` | 削除時のカスケード unpublish |
| `apps/api/src/rpc-unwrap.ts` | 新 RPC 戻り値のアンラップ関数 |
| `apps/api/src/routes/tenant.ts` | `POST .../publish` / `.../unpublish` / `POST .../reproject` |
| `docs/superpowers/plans/2026-07-12-implementation-roadmap.md` | Phase 5a 完了と 5b への申し送り |

---

## Task 1: 投影 D1 のスキーマとバインディング

**Files:**
- Create: `packages/db/src/projection.ts`
- Create: `packages/db/drizzle-projection.config.ts`
- Create: `packages/db/src/projection.test.ts`
- Create: `apps/api/test/projection-binding.test.ts`
- Modify: `packages/db/package.json`
- Modify: `apps/api/wrangler.jsonc`
- Modify: `apps/api/env.d.ts`
- Modify: `apps/api/vitest.config.ts`
- Modify: `apps/api/test/apply-migrations.ts`

**Interfaces:**
- Consumes: なし（最初のタスク）
- Produces: 投影 D1 のテーブル `projected_records` / `projected_relations` / `projection_index`、バインディング `env.PROJECTION_DB`（`D1Database`）。以降の全タスクがこの物理スキーマに依存する。

- [ ] **Step 1: 投影スキーマのテストを書く**

`packages/db/src/projection.test.ts`:

```ts
import { getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { projectedRecords, projectedRelations, projectionIndex } from "./projection";

describe("@plyrs/db projection schema", () => {
  it("defines the three projection tables from design-spec §12.2", () => {
    expect(getTableName(projectedRecords)).toBe("projected_records");
    expect(getTableName(projectedRelations)).toBe("projected_relations");
    expect(getTableName(projectionIndex)).toBe("projection_index");
  });

  it("carries tenant_id on every projection table (shared D1)", () => {
    expect(projectedRecords.tenantId).toBeDefined();
    expect(projectedRelations.tenantId).toBeDefined();
    expect(projectionIndex.tenantId).toBeDefined();
  });

  it("types projection_index values into text / num / date columns", () => {
    expect(projectionIndex.valueText).toBeDefined();
    expect(projectionIndex.valueNum).toBeDefined();
    expect(projectionIndex.valueDate).toBeDefined();
  });
});
```

- [ ] **Step 2: テストが落ちることを確認**

Run: `pnpm --filter @plyrs/db test`
Expected: FAIL（`Cannot find module './projection'`）

- [ ] **Step 3: 投影スキーマを実装**

`packages/db/src/projection.ts`:

```ts
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
    sourceVersion: integer("source_version").notNull(), // 順序逆転ガード（§12.3）
    projectedAt: integer("projected_at").notNull(), // epoch ms。再投影の mark-and-sweep 用
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.recordId] }),
    index("idx_projected_records_type_published").on(table.tenantId, table.type, table.publishedAt),
    index("idx_projected_records_type_slug").on(table.tenantId, table.type, table.slug),
    index("idx_projected_records_sweep").on(table.tenantId, table.projectedAt),
  ],
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
```

`packages/db/src/index.ts` はこのタスクでは触らない（投影は `@plyrs/db/projection` サブパスで公開する）。

- [ ] **Step 4: drizzle 設定とスクリプトを追加**

`packages/db/drizzle-projection.config.ts`:

```ts
import { defineConfig } from "drizzle-kit";

// 投影 D1（共有・publish 派生）用。generate 専用 — 適用はテストの applyD1Migrations /
// 本番の `wrangler d1 migrations apply`。
export default defineConfig({
  out: "./drizzle-projection",
  schema: "./src/projection.ts",
  dialect: "sqlite",
});
```

`packages/db/package.json` の `exports` と `scripts` を変更（他のキーは変えない）:

```json
  "exports": {
    ".": "./src/index.ts",
    "./control-plane": "./src/control-plane.ts",
    "./projection": "./src/projection.ts",
    "./migrations": "./drizzle/migrations.js"
  },
  "scripts": {
    "generate": "drizzle-kit generate",
    "generate:d1": "drizzle-kit generate --config drizzle-d1.config.ts",
    "generate:projection": "drizzle-kit generate --config drizzle-projection.config.ts",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
```

- [ ] **Step 5: マイグレーションを生成**

Run: `pnpm --filter @plyrs/db generate:projection`
Expected: `packages/db/drizzle-projection/0000_<名前>.sql` と `meta/` が生成される。生成された SQL を **必ず開いて確認**し、3 テーブル + 索引が入っていることを確かめる（ファイル名のランダム部分は drizzle-kit が決めるのでそのまま採用する）。

- [ ] **Step 6: db パッケージのテストを通す**

Run: `pnpm --filter @plyrs/db test`
Expected: PASS（既存 4 + 新規 3）

- [ ] **Step 7: バインディングを配線**

`apps/api/wrangler.jsonc`（`d1_databases` を差し替え）:

```jsonc
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "plyrs-control-plane",
      "database_id": "00000000-0000-0000-0000-000000000000",
      "migrations_dir": "../../packages/db/drizzle-d1",
    },
    {
      "binding": "PROJECTION_DB",
      "database_name": "plyrs-projection",
      "database_id": "00000000-0000-0000-0000-000000000001",
      "migrations_dir": "../../packages/db/drizzle-projection",
    },
  ],
```

`apps/api/env.d.ts` の `EnvBindings` に追加（**このファイルに `import`/`export` 文を足してはいけない** — グローバル宣言スクリプトでなくなると `Env` の拡張が全て無効になる。型参照は inline `import("...")` で書く）:

```ts
  DB: D1Database;
  // design-spec §12.2: 共有投影 D1（publish 派生の公開読み取りモデル）
  PROJECTION_DB: D1Database;
```

そして `TEST_MIGRATIONS` の隣に:

```ts
  TEST_PROJECTION_MIGRATIONS: import("cloudflare:test").D1Migration[];
```

`apps/api/vitest.config.ts`:

```ts
export default defineConfig(async () => {
  const migrations = await readD1Migrations(path.join(here, "../../packages/db/drizzle-d1"));
  const projectionMigrations = await readD1Migrations(
    path.join(here, "../../packages/db/drizzle-projection"),
  );
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            TEST_PROJECTION_MIGRATIONS: projectionMigrations,
            JWT_SECRET: "test-secret-do-not-use-in-prod",
          },
        },
      }),
    ],
    test: {
      include: ["test/**/*.test.ts", "src/**/*.test.ts"],
      setupFiles: ["./test/apply-migrations.ts"],
    },
  };
});
```

`apps/api/test/apply-migrations.ts`:

```ts
import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";

// setup はテストファイルごとのストレージ分離の外で複数回走りうるが、
// applyD1Migrations は未適用分だけを適用するため冪等で安全。
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
await applyD1Migrations(env.PROJECTION_DB, env.TEST_PROJECTION_MIGRATIONS);
```

- [ ] **Step 8: バインディングのスモークテストを書く**

`apps/api/test/projection-binding.test.ts`:

```ts
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

describe("projection D1 binding", () => {
  it("has the three projection tables migrated", async () => {
    const { results } = await env.PROJECTION_DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    ).all<{ name: string }>();
    const names = results.map((row) => row.name);
    expect(names).toContain("projected_records");
    expect(names).toContain("projected_relations");
    expect(names).toContain("projection_index");
  });

  it("is a different database from the control plane", async () => {
    const { results } = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'projected_records'",
    ).all<{ name: string }>();
    expect(results).toHaveLength(0);
  });
});
```

- [ ] **Step 9: テストを実行**

Run: `pnpm --filter @plyrs/api test -- test/projection-binding.test.ts`
Expected: PASS（2 tests）

- [ ] **Step 10: コミット**

```bash
git add packages/db apps/api/wrangler.jsonc apps/api/env.d.ts apps/api/vitest.config.ts apps/api/test/apply-migrations.ts apps/api/test/projection-binding.test.ts
git commit -m "feat: add the shared projection D1 schema and binding"
```

---

## Task 2: DO 側の運用テーブル（snapshots / outbox / alarm registry / config）

**Files:**
- Modify: `packages/db/src/schema.ts`
- Modify: `packages/db/src/index.ts`
- Modify: `packages/db/src/schema.test.ts`
- Create: `packages/db/drizzle/0001_*.sql`（生成物）

**Interfaces:**
- Consumes: なし
- Produces: DO-SQLite のテーブル `published_snapshots(record_id, type, data, relations, published_at, published_by, source_version)` / `outbox(id, job_type, record_id, source_version, enqueued_at, sent)` / `alarm_registry(kind, due_at)` / `do_config(key, value)`。Task 4〜7 が SQL で直接触る。

- [ ] **Step 1: 失敗するテストを書く**

`packages/db/src/schema.test.ts` の末尾（`describe` の中）に追加:

```ts
  it("defines the publish / outbox / alarm operational tables (design-spec §7 / §9.6 / §12.3)", () => {
    expect(getTableName(publishedSnapshots)).toBe("published_snapshots");
    expect(getTableName(outbox)).toBe("outbox");
    expect(getTableName(alarmRegistry)).toBe("alarm_registry");
    expect(getTableName(doConfig)).toBe("do_config");
  });

  it("gives the outbox its ordering and delivery bookkeeping", () => {
    expect(outbox.jobType).toBeDefined();
    expect(outbox.sourceVersion).toBeDefined();
    expect(outbox.sent).toBeDefined();
  });
```

同ファイル冒頭の import を差し替え:

```ts
import {
  alarmRegistry,
  contentTypes,
  doConfig,
  outbox,
  publishedSnapshots,
  records,
  relations,
} from "./schema";
```

- [ ] **Step 2: テストが落ちることを確認**

Run: `pnpm --filter @plyrs/db test`
Expected: FAIL（`publishedSnapshots` などが export されていない）

- [ ] **Step 3: スキーマを追加**

`packages/db/src/schema.ts` の末尾に追加（既存 3 テーブルは変更しない）:

```ts
// design-spec §7: 公開状態の真実源は published_snapshots 行の存在。records 側に公開フラグを持たない。
export const publishedSnapshots = sqliteTable("published_snapshots", {
  recordId: text("record_id").primaryKey(), // records.id と 1 対 1
  type: text("type").notNull(),
  data: text("data").notNull(), // publish 時点の data のコピー（JSON）
  relations: text("relations").notNull(), // publish 時点の関係の凍結投影（JSON）
  publishedAt: text("published_at").notNull(),
  publishedBy: text("published_by").notNull(),
  sourceVersion: integer("source_version").notNull(), // どの records.version を publish したか
});

// design-spec §12.3: アウトボックス。DO コミットと投影 D1 書き込みの dual-write を分離する。
export const outbox = sqliteTable(
  "outbox",
  {
    id: text("id").primaryKey(), // uuidv7
    jobType: text("job_type").notNull(), // 'upsert' | 'delete'
    recordId: text("record_id").notNull(),
    sourceVersion: integer("source_version").notNull(),
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
```

`packages/db/src/index.ts`:

```ts
export {
  alarmRegistry,
  contentTypes,
  doConfig,
  outbox,
  publishedSnapshots,
  records,
  relations,
} from "./schema";
```

- [ ] **Step 4: DO マイグレーションを生成**

Run: `pnpm --filter @plyrs/db generate`
Expected: `packages/db/drizzle/0001_<名前>.sql` が生成され、`packages/db/drizzle/migrations.js` に 0001 のエントリが追加される。生成 SQL を開いて **`CREATE TABLE` 4 本だけ**であること（既存 3 テーブルの再構築が含まれていないこと）を確認する — records の再構築は Phase 2 申し送りのとおり動的 `g_*` generated column を黙って消すため、含まれていたら即座に停止して報告すること。

- [ ] **Step 5: テストを通す**

Run: `pnpm --filter @plyrs/db test`
Expected: PASS（既存 + 新規 2）

- [ ] **Step 6: DO がマイグレーションを適用できることを確認**

Run: `pnpm --filter @plyrs/api test -- test/smoke.test.ts`
Expected: PASS（TenantDO の constructor が 0001 を適用して起動する）

- [ ] **Step 7: コミット**

```bash
git add packages/db
git commit -m "feat: add snapshots, outbox, and the alarm registry to the DO schema"
```

---

## Task 3: 投影ペイロードの構築（純関数）

**Files:**
- Create: `apps/api/src/projection/payload.ts`
- Create: `apps/api/src/projection/payload.test.ts`

**Interfaces:**
- Consumes: `FieldDefinition`（`@plyrs/metamodel`）
- Produces:
  - `interface PublishedSnapshot { recordId: string; type: string; data: Record<string, unknown>; relations: ProjectionRelationRow[]; publishedAt: string; publishedBy: string; sourceVersion: number }`
  - `interface ProjectionRelationRow { sourceField: string; targetType: string; targetId: string; ordinal: number; origin: string }`
  - `interface ProjectionIndexRow { fieldKey: string; valueText: string | null; valueNum: number | null; valueDate: string | null }`
  - `interface ProjectionPayload { recordId: string; type: string; slug: string | null; publishedAt: string; data: Record<string, unknown>; sourceVersion: number; relations: ProjectionRelationRow[]; index: ProjectionIndexRow[] }`
  - `function buildProjectionPayload(fields: FieldDefinition[], snapshot: PublishedSnapshot): ProjectionPayload`
  - `function promoteSlug(fields: FieldDefinition[], data: Record<string, unknown>): string | null`

- [ ] **Step 1: 失敗するテストを書く**

`apps/api/src/projection/payload.test.ts`:

```ts
import type { FieldDefinition } from "@plyrs/metamodel";
import { describe, expect, it } from "vitest";
import { buildProjectionPayload, promoteSlug, type PublishedSnapshot } from "./payload";

const fields: FieldDefinition[] = [
  { key: "title", type: "text", required: true },
  { key: "slug", type: "text", required: true, config: { unique: true, indexed: true } },
  { key: "published_at", type: "datetime", config: { indexed: true } },
  { key: "reading_minutes", type: "number", config: { indexed: true } },
  { key: "featured", type: "boolean", config: { indexed: true } },
  {
    key: "tags",
    type: "select",
    config: {
      options: [
        { value: "tech", label: "Tech" },
        { value: "life", label: "Life" },
      ],
      multiple: true,
      indexed: true,
    },
  },
  { key: "body", type: "richtext" },
  {
    key: "authors",
    type: "relation",
    config: { allowedTypes: ["author"], cardinality: "many", ordered: true },
  },
];

function snapshot(data: Record<string, unknown>): PublishedSnapshot {
  return {
    recordId: "r1",
    type: "article",
    data,
    relations: [
      { sourceField: "authors", targetType: "author", targetId: "a1", ordinal: 0, origin: "field" },
    ],
    publishedAt: "2026-07-13T00:00:00.000Z",
    publishedBy: "u1",
    sourceVersion: 3,
  };
}

describe("buildProjectionPayload", () => {
  it("promotes a unique text field keyed 'slug' into the slug column (G4)", () => {
    expect(promoteSlug(fields, { slug: "hello" })).toBe("hello");
  });

  it("does not promote a 'slug' field that is not declared unique", () => {
    const notUnique: FieldDefinition[] = [{ key: "slug", type: "text" }];
    expect(promoteSlug(notUnique, { slug: "hello" })).toBeNull();
  });

  it("leaves slug null when the value is missing or empty", () => {
    expect(promoteSlug(fields, {})).toBeNull();
    expect(promoteSlug(fields, { slug: "" })).toBeNull();
  });

  it("routes indexed values into the typed columns", () => {
    const payload = buildProjectionPayload(
      fields,
      snapshot({
        title: "t",
        slug: "hello",
        published_at: "2026-07-01T00:00:00.000Z",
        reading_minutes: 7,
        featured: true,
        tags: ["tech", "life"],
      }),
    );
    expect(payload.index).toContainEqual({
      fieldKey: "slug",
      valueText: "hello",
      valueNum: null,
      valueDate: null,
    });
    expect(payload.index).toContainEqual({
      fieldKey: "published_at",
      valueText: null,
      valueNum: null,
      valueDate: "2026-07-01T00:00:00.000Z",
    });
    expect(payload.index).toContainEqual({
      fieldKey: "reading_minutes",
      valueText: null,
      valueNum: 7,
      valueDate: null,
    });
    expect(payload.index).toContainEqual({
      fieldKey: "featured",
      valueText: null,
      valueNum: 1,
      valueDate: null,
    });
  });

  it("emits one row per value for an indexed multi-select (any-of semantics)", () => {
    const payload = buildProjectionPayload(fields, snapshot({ tags: ["tech", "life"] }));
    const tagRows = payload.index.filter((row) => row.fieldKey === "tags");
    expect(tagRows.map((row) => row.valueText)).toStrictEqual(["tech", "life"]);
  });

  it("skips fields that are absent, null, or not indexed", () => {
    const payload = buildProjectionPayload(fields, snapshot({ title: "t", body: { doc: {} } }));
    expect(payload.index).toStrictEqual([]);
  });

  it("skips values whose runtime type does not match the field type (tolerant read)", () => {
    const payload = buildProjectionPayload(
      fields,
      snapshot({ reading_minutes: "seven", featured: "yes", slug: 42 }),
    );
    expect(payload.index).toStrictEqual([]);
    expect(payload.slug).toBeNull();
  });

  it("carries the record, relations, and source version through unchanged", () => {
    const payload = buildProjectionPayload(fields, snapshot({ slug: "hello", title: "t" }));
    expect(payload).toMatchObject({
      recordId: "r1",
      type: "article",
      slug: "hello",
      publishedAt: "2026-07-13T00:00:00.000Z",
      sourceVersion: 3,
      data: { slug: "hello", title: "t" },
    });
    expect(payload.relations).toStrictEqual([
      { sourceField: "authors", targetType: "author", targetId: "a1", ordinal: 0, origin: "field" },
    ]);
  });

  it("degrades to an empty index when the content type is unknown (fields = [])", () => {
    const payload = buildProjectionPayload([], snapshot({ slug: "hello" }));
    expect(payload.index).toStrictEqual([]);
    expect(payload.slug).toBeNull();
  });
});
```

- [ ] **Step 2: テストが落ちることを確認**

Run: `pnpm --filter @plyrs/api test -- src/projection/payload.test.ts`
Expected: FAIL（`Cannot find module './payload'`）

- [ ] **Step 3: 純関数を実装**

`apps/api/src/projection/payload.ts`:

```ts
import type { FieldDefinition } from "@plyrs/metamodel";

export interface ProjectionRelationRow {
  sourceField: string;
  targetType: string;
  targetId: string;
  ordinal: number;
  origin: string; // 'field' | 'body'
}

export interface ProjectionIndexRow {
  fieldKey: string;
  valueText: string | null;
  valueNum: number | null;
  valueDate: string | null;
}

// DO 内 published_snapshots 行のドメイン表現（design-spec §7）
export interface PublishedSnapshot {
  recordId: string;
  type: string;
  data: Record<string, unknown>;
  relations: ProjectionRelationRow[];
  publishedAt: string;
  publishedBy: string;
  sourceVersion: number;
}

// 投影 D1 の 3 テーブルへ書き込む全量（consumer はこれを D1 batch に落とすだけ）
export interface ProjectionPayload {
  recordId: string;
  type: string;
  slug: string | null;
  publishedAt: string;
  data: Record<string, unknown>;
  sourceVersion: number;
  relations: ProjectionRelationRow[];
  index: ProjectionIndexRow[];
}

// G4: 新しい宣言語彙を増やさず「key が 'slug' の unique な text フィールド」を実カラムへ昇格する
export function promoteSlug(
  fields: FieldDefinition[],
  data: Record<string, unknown>,
): string | null {
  const field = fields.find(
    (candidate) =>
      candidate.key === "slug" && candidate.type === "text" && candidate.config?.unique === true,
  );
  if (field === undefined) {
    return null;
  }
  const value = data["slug"];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function row(fieldKey: string, part: Partial<ProjectionIndexRow>): ProjectionIndexRow {
  return { fieldKey, valueText: null, valueNum: null, valueDate: null, ...part };
}

// design-spec §12.2: 値は型別カラムに振り分ける（数値・日付を TEXT 一列で持つとソートが壊れる）。
// data は寛容読み（型定義とズレた値がありうる）なので、型が合わない値は索引に入れない。
function indexRowsForField(field: FieldDefinition, data: Record<string, unknown>): ProjectionIndexRow[] {
  const value = data[field.key];
  if (value === undefined || value === null) {
    return [];
  }
  switch (field.type) {
    case "text":
      return field.config?.indexed === true && typeof value === "string"
        ? [row(field.key, { valueText: value })]
        : [];
    case "number":
      return field.config?.indexed === true && typeof value === "number" && Number.isFinite(value)
        ? [row(field.key, { valueNum: value })]
        : [];
    case "boolean":
      return field.config?.indexed === true && typeof value === "boolean"
        ? [row(field.key, { valueNum: value ? 1 : 0 })]
        : [];
    case "datetime":
      return field.config?.indexed === true && typeof value === "string"
        ? [row(field.key, { valueDate: value })]
        : [];
    case "select": {
      if (field.config.indexed !== true) {
        return [];
      }
      // 複数選択の索引は 1 値 = 1 行（§12.4: フィルタは自然に any-of 意味論になる）
      if (field.config.multiple === true) {
        return Array.isArray(value)
          ? value
              .filter((entry): entry is string => typeof entry === "string")
              .map((entry) => row(field.key, { valueText: entry }))
          : [];
      }
      return typeof value === "string" ? [row(field.key, { valueText: value })] : [];
    }
    default:
      // json / richtext / relation は indexed を持てない（metamodel が構造的に拒否する）
      return [];
  }
}

export function buildProjectionPayload(
  fields: FieldDefinition[],
  snapshot: PublishedSnapshot,
): ProjectionPayload {
  return {
    recordId: snapshot.recordId,
    type: snapshot.type,
    slug: promoteSlug(fields, snapshot.data),
    publishedAt: snapshot.publishedAt,
    data: snapshot.data,
    sourceVersion: snapshot.sourceVersion,
    relations: snapshot.relations,
    index: fields.flatMap((field) => indexRowsForField(field, snapshot.data)),
  };
}
```

- [ ] **Step 4: テストを通す**

Run: `pnpm --filter @plyrs/api test -- src/projection/payload.test.ts`
Expected: PASS（8 tests）

- [ ] **Step 5: コミット**

```bash
git add apps/api/src/projection
git commit -m "feat: build projection payloads from published snapshots"
```

---

## Task 4: DO の publish / unpublish と削除カスケード

**Files:**
- Create: `apps/api/src/do/publish.ts`
- Create: `apps/api/src/do/outbox.ts`
- Create: `apps/api/test/publish.test.ts`
- Modify: `apps/api/src/do/delete-record.ts`
- Modify: `apps/api/src/auth/permissions.ts`
- Modify: `apps/api/src/tenant-do.ts`
- Modify: `apps/api/src/rpc-unwrap.ts`
- Modify: `apps/api/src/routes/tenant.ts`

**Interfaces:**
- Consumes: `buildProjectionPayload` / `PublishedSnapshot` / `ProjectionPayload` / `ProjectionRelationRow`（Task 3）、`loadRecord`（`./write-record`）、`loadContentTypeByKey`（`./content-types`）、`requireOperation`（`./authorize`）
- Produces:
  - `apps/api/src/do/outbox.ts`: `type OutboxJobType = "upsert" | "delete"`、`interface OutboxRow { id: string; jobType: OutboxJobType; recordId: string; sourceVersion: number }`、`function enqueueOutbox(sql: SqlStorage, id: string, jobType: OutboxJobType, recordId: string, sourceVersion: number, now: string): void`、`function unsentOutbox(sql: SqlStorage, limit: number): OutboxRow[]`、`function markOutboxSent(sql: SqlStorage, id: string): void`、`function countUnsent(sql: SqlStorage): number`
  - `apps/api/src/do/publish.ts`: `interface PublishDeps { sql: SqlStorage; now: () => string; newId: () => string }`、`type PublishResult = { ok: true; snapshot: PublishedSnapshot } | { ok: false; code: "not_found" | "record_deleted" | "forbidden"; message: string }`、`type UnpublishResult = { ok: true; recordId: string; sourceVersion: number } | { ok: false; code: "not_published" | "forbidden"; message: string }`、`function publishRecordCore(deps, recordId: string, actor: string): PublishResult`、`function unpublishRecordCore(deps, recordId: string): UnpublishResult`、`function loadProjectionPayload(sql: SqlStorage, recordId: string): ProjectionPayload | null`、`function loadPublishedPage(sql: SqlStorage, cursor: string | null, limit: number): { payloads: ProjectionPayload[]; nextCursor: string | null }`
  - RPC: `TenantDO.publishRecord(tenantId, recordId, auth)` / `unpublishRecord(tenantId, recordId, auth)` / `getProjectionPayload(recordId)` / `getPublishedPage(cursor, limit)`
  - 権限: `Operation` に `"record:publish"` と `"projection:rebuild"` を追加（owner: 両方 / editor: publish のみ / viewer: なし）

- [ ] **Step 1: 失敗するテストを書く**

`apps/api/test/publish.test.ts`:

```ts
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { articleType, auth, uuid, validArticleInput } from "./fixtures";
import {
  asDeleteResult,
  asProjectionPayload,
  asPublishResult,
  asUnpublishResult,
  asWriteResult,
} from "./rpc-unwrap";

const TENANT = "tenant-publish";

function freshStub() {
  return env.TENANT_DO.get(env.TENANT_DO.idFromName(crypto.randomUUID()));
}

describe("publish / unpublish (design-spec §7)", () => {
  let stub: ReturnType<typeof freshStub>;

  beforeEach(async () => {
    stub = freshStub();
    const registered = await stub.registerContentType(articleType(), auth("owner1"));
    expect(registered.ok).toBe(true);
    const written = asWriteResult(
      await stub.writeRecord(
        "article",
        { recordId: uuid(100), input: validArticleInput() },
        auth("owner1"),
      ),
    );
    expect(written.ok).toBe(true);
  });

  it("freezes the record into a snapshot and queues an upsert job", async () => {
    const result = asPublishResult(await stub.publishRecord(TENANT, uuid(100), auth("owner1")));
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.snapshot).toMatchObject({
      recordId: uuid(100),
      type: "article",
      publishedBy: "owner1",
      sourceVersion: 1,
    });
    // relations は publish 時点の凍結投影（design-spec §7）
    expect(result.snapshot.relations).toContainEqual(
      expect.objectContaining({ sourceField: "authors", targetType: "author", ordinal: 0 }),
    );

    const payload = asProjectionPayload(await stub.getProjectionPayload(uuid(100)));
    expect(payload).not.toBeNull();
    expect(payload?.slug).toBe("hello");
    expect(payload?.sourceVersion).toBe(1);
  });

  it("keeps the snapshot frozen while the record keeps changing", async () => {
    await stub.publishRecord(TENANT, uuid(100), auth("owner1"));
    const edited = asWriteResult(
      await stub.writeRecord(
        "article",
        { recordId: uuid(100), input: { ...validArticleInput(), title: "編集後" } },
        auth("owner1"),
      ),
    );
    expect(edited.ok).toBe(true);

    const payload = asProjectionPayload(await stub.getProjectionPayload(uuid(100)));
    expect(payload?.data["title"]).toBe("こんにちは");
    expect(payload?.sourceVersion).toBe(1);
  });

  it("republish advances the snapshot's source version", async () => {
    await stub.publishRecord(TENANT, uuid(100), auth("owner1"));
    await stub.writeRecord(
      "article",
      { recordId: uuid(100), input: { ...validArticleInput(), title: "編集後" } },
      auth("owner1"),
    );
    const republished = asPublishResult(
      await stub.publishRecord(TENANT, uuid(100), auth("owner1")),
    );
    expect(republished.ok).toBe(true);
    if (republished.ok) {
      expect(republished.snapshot.sourceVersion).toBe(2);
      expect(republished.snapshot.data["title"]).toBe("編集後");
    }
  });

  it("unpublish removes the snapshot", async () => {
    await stub.publishRecord(TENANT, uuid(100), auth("owner1"));
    const result = asUnpublishResult(
      await stub.unpublishRecord(TENANT, uuid(100), auth("owner1")),
    );
    expect(result).toMatchObject({ ok: true, sourceVersion: 1 });
    expect(asProjectionPayload(await stub.getProjectionPayload(uuid(100)))).toBeNull();
  });

  it("rejects unpublish when nothing is published", async () => {
    const result = asUnpublishResult(
      await stub.unpublishRecord(TENANT, uuid(100), auth("owner1")),
    );
    expect(result).toMatchObject({ ok: false, code: "not_published" });
  });

  it("refuses to publish a missing or deleted record", async () => {
    const missing = asPublishResult(await stub.publishRecord(TENANT, uuid(199), auth("owner1")));
    expect(missing).toMatchObject({ ok: false, code: "not_found" });

    await stub.deleteRecord(uuid(100), auth("owner1"));
    const deleted = asPublishResult(await stub.publishRecord(TENANT, uuid(100), auth("owner1")));
    expect(deleted).toMatchObject({ ok: false, code: "record_deleted" });
  });

  it("cascades unpublish when a published record is deleted (裁定 2026-07-13)", async () => {
    await stub.publishRecord(TENANT, uuid(100), auth("owner1"));
    const deleted = asDeleteResult(await stub.deleteRecord(uuid(100), auth("owner1")));
    expect(deleted.ok).toBe(true);
    expect(asProjectionPayload(await stub.getProjectionPayload(uuid(100)))).toBeNull();
  });

  it("denies publish to viewers and allows it to editors", async () => {
    const denied = asPublishResult(
      await stub.publishRecord(TENANT, uuid(100), auth("mallory", "viewer")),
    );
    expect(denied).toMatchObject({ ok: false, code: "forbidden" });

    const allowed = asPublishResult(
      await stub.publishRecord(TENANT, uuid(100), auth("eve", "editor")),
    );
    expect(allowed.ok).toBe(true);
  });
});
```

- [ ] **Step 2: テストが落ちることを確認**

Run: `pnpm --filter @plyrs/api test -- test/publish.test.ts`
Expected: FAIL（`stub.publishRecord is not a function` / `asPublishResult` が無い）

- [ ] **Step 3: outbox ヘルパを実装**

`apps/api/src/do/outbox.ts`:

```ts
export type OutboxJobType = "upsert" | "delete";

export interface OutboxRow {
  id: string;
  jobType: OutboxJobType;
  recordId: string;
  sourceVersion: number;
}

interface RawOutboxRow extends Record<string, SqlStorageValue> {
  id: string;
  job_type: string;
  record_id: string;
  source_version: number;
}

// design-spec §12.3: publish/unpublish のコミットと同一トランザクションで積む。
export function enqueueOutbox(
  sql: SqlStorage,
  id: string,
  jobType: OutboxJobType,
  recordId: string,
  sourceVersion: number,
  now: string,
): void {
  sql.exec(
    "INSERT INTO outbox (id, job_type, record_id, source_version, enqueued_at, sent) VALUES (?, ?, ?, ?, ?, 0)",
    id,
    jobType,
    recordId,
    sourceVersion,
    now,
  );
}

export function unsentOutbox(sql: SqlStorage, limit: number): OutboxRow[] {
  return sql
    .exec<RawOutboxRow>(
      "SELECT id, job_type, record_id, source_version FROM outbox WHERE sent = 0 ORDER BY rowid LIMIT ?",
      limit,
    )
    .toArray()
    .map((row) => ({
      id: row.id,
      jobType: row.job_type as OutboxJobType,
      recordId: row.record_id,
      sourceVersion: row.source_version,
    }));
}

export function markOutboxSent(sql: SqlStorage, id: string): void {
  sql.exec("UPDATE outbox SET sent = 1 WHERE id = ?", id);
}

export function countUnsent(sql: SqlStorage): number {
  return sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM outbox WHERE sent = 0").one().n;
}

// sent=1 の行は単調増加する（§12.3 の掃除方針）。送出済みは即削除する。
export function purgeSent(sql: SqlStorage): void {
  sql.exec("DELETE FROM outbox WHERE sent = 1");
}
```

- [ ] **Step 4: publish コアを実装**

`apps/api/src/do/publish.ts`:

```ts
import {
  buildProjectionPayload,
  type ProjectionPayload,
  type ProjectionRelationRow,
  type PublishedSnapshot,
} from "../projection/payload";
import { loadContentTypeByKey } from "./content-types";
import { enqueueOutbox } from "./outbox";
import { loadRecord } from "./write-record";

export interface PublishDeps {
  sql: SqlStorage;
  now: () => string;
  newId: () => string;
}

export type PublishResult =
  | { ok: true; snapshot: PublishedSnapshot }
  | { ok: false; code: "not_found" | "record_deleted" | "forbidden"; message: string };

export type UnpublishResult =
  | { ok: true; recordId: string; sourceVersion: number }
  | { ok: false; code: "not_published" | "forbidden"; message: string };

interface RawSnapshotRow extends Record<string, SqlStorageValue> {
  record_id: string;
  type: string;
  data: string;
  relations: string;
  published_at: string;
  published_by: string;
  source_version: number;
}

function rowToSnapshot(row: RawSnapshotRow): PublishedSnapshot {
  return {
    recordId: row.record_id,
    type: row.type,
    data: JSON.parse(row.data) as Record<string, unknown>,
    relations: JSON.parse(row.relations) as ProjectionRelationRow[],
    publishedAt: row.published_at,
    publishedBy: row.published_by,
    sourceVersion: row.source_version,
  };
}

// publish 時点の関係を凍結投影する（field 由来も body 由来も両方。§7）
export function loadRelationRows(sql: SqlStorage, recordId: string): ProjectionRelationRow[] {
  return sql
    .exec<{
      source_field: string;
      target_type: string;
      target_id: string;
      ordinal: number;
      origin: string;
    }>(
      "SELECT source_field, target_type, target_id, ordinal, origin FROM relations WHERE source_id = ? ORDER BY source_field, origin, ordinal",
      recordId,
    )
    .toArray()
    .map((row) => ({
      sourceField: row.source_field,
      targetType: row.target_type,
      targetId: row.target_id,
      ordinal: row.ordinal,
      origin: row.origin,
    }));
}

export function publishRecordCore(
  deps: PublishDeps,
  recordId: string,
  actor: string,
): PublishResult {
  const record = loadRecord(deps.sql, recordId);
  if (record === null) {
    return { ok: false, code: "not_found", message: `record not found: ${recordId}` };
  }
  if (record.deletedAt !== null) {
    return { ok: false, code: "record_deleted", message: `record is deleted: ${recordId}` };
  }
  const now = deps.now();
  const snapshot: PublishedSnapshot = {
    recordId,
    type: record.type,
    data: record.data,
    relations: loadRelationRows(deps.sql, recordId),
    publishedAt: now,
    publishedBy: actor,
    sourceVersion: record.version,
  };
  deps.sql.exec(
    "INSERT OR REPLACE INTO published_snapshots (record_id, type, data, relations, published_at, published_by, source_version) VALUES (?, ?, ?, ?, ?, ?, ?)",
    snapshot.recordId,
    snapshot.type,
    JSON.stringify(snapshot.data),
    JSON.stringify(snapshot.relations),
    snapshot.publishedAt,
    snapshot.publishedBy,
    snapshot.sourceVersion,
  );
  enqueueOutbox(deps.sql, deps.newId(), "upsert", recordId, snapshot.sourceVersion, now);
  return { ok: true, snapshot };
}

export function unpublishRecordCore(deps: PublishDeps, recordId: string): UnpublishResult {
  const row = deps.sql
    .exec<{
      source_version: number;
    }>("SELECT source_version FROM published_snapshots WHERE record_id = ?", recordId)
    .toArray()[0];
  if (row === undefined) {
    return { ok: false, code: "not_published", message: `record is not published: ${recordId}` };
  }
  deps.sql.exec("DELETE FROM published_snapshots WHERE record_id = ?", recordId);
  // §12.3: delete ジョブにも発行時点の version を載せる（遅れて届いた delete が republish を消さないため）
  enqueueOutbox(deps.sql, deps.newId(), "delete", recordId, row.source_version, deps.now());
  return { ok: true, recordId, sourceVersion: row.source_version };
}

// 裁定（2026-07-13）: delete は unpublish を強制する。未公開なら何もしない。
export function cascadeUnpublish(deps: PublishDeps, recordId: string): void {
  unpublishRecordCore(deps, recordId);
}

export function loadProjectionPayload(sql: SqlStorage, recordId: string): ProjectionPayload | null {
  const row = sql
    .exec<RawSnapshotRow>("SELECT * FROM published_snapshots WHERE record_id = ?", recordId)
    .toArray()[0];
  if (row === undefined) {
    return null;
  }
  const snapshot = rowToSnapshot(row);
  // 型定義が消えていても投影は落とさない（索引が空になるだけ）。寛容読みの姿勢と揃える。
  const contentType = loadContentTypeByKey(sql, snapshot.type);
  return buildProjectionPayload(contentType?.fields ?? [], snapshot);
}

// 再投影のページング（record_id 順の keyset ページネーション）
export function loadPublishedPage(
  sql: SqlStorage,
  cursor: string | null,
  limit: number,
): { payloads: ProjectionPayload[]; nextCursor: string | null } {
  const rows =
    cursor === null
      ? sql
          .exec<RawSnapshotRow>(
            "SELECT * FROM published_snapshots ORDER BY record_id LIMIT ?",
            limit,
          )
          .toArray()
      : sql
          .exec<RawSnapshotRow>(
            "SELECT * FROM published_snapshots WHERE record_id > ? ORDER BY record_id LIMIT ?",
            cursor,
            limit,
          )
          .toArray();
  const payloads = rows.map((row) => {
    const snapshot = rowToSnapshot(row);
    const contentType = loadContentTypeByKey(sql, snapshot.type);
    return buildProjectionPayload(contentType?.fields ?? [], snapshot);
  });
  const last = payloads[payloads.length - 1];
  const nextCursor = payloads.length === limit && last !== undefined ? last.recordId : null;
  return { payloads, nextCursor };
}
```

- [ ] **Step 5: 権限に record:publish / projection:rebuild を足す**

`apps/api/src/auth/permissions.ts`:

```ts
export type Operation =
  | "type:manage"
  | "record:write"
  | "record:delete"
  | "record:read"
  | "record:publish"
  | "projection:rebuild";

// design-spec §11.5: デフォルトロールの権限展開表はコードに焼く（アプリと共にデプロイ）。
// モジュール宣言権限（Phase 9）は有効化時に DO の config へ書き込まれ、同じ判定面に加わる。
const ROLE_PERMISSIONS: Record<Role, readonly Operation[]> = {
  owner: [
    "type:manage",
    "record:write",
    "record:delete",
    "record:read",
    "record:publish",
    "projection:rebuild",
  ],
  editor: ["record:write", "record:delete", "record:read", "record:publish"],
  viewer: ["record:read"],
};
```

`apps/api/src/auth/permissions.test.ts` に追加:

```ts
  it("lets owners rebuild the projection but not editors", () => {
    expect(can("owner", "projection:rebuild")).toBe(true);
    expect(can("editor", "projection:rebuild")).toBe(false);
  });

  it("lets owners and editors publish, but not viewers", () => {
    expect(can("owner", "record:publish")).toBe(true);
    expect(can("editor", "record:publish")).toBe(true);
    expect(can("viewer", "record:publish")).toBe(false);
  });
```

- [ ] **Step 6: 削除カスケードを配線**

`apps/api/src/do/delete-record.ts` の `deleteRecordCore` に、`relations` 削除の直後（`return` の前）を追加。deps の型も広げる:

```ts
import { cascadeUnpublish } from "./publish";
import type { RecordSnapshot } from "./types";
import { loadRecord } from "./write-record";

export type DeleteRecordResult =
  | { ok: true; record: RecordSnapshot }
  | { ok: false; code: "not_found" | "already_deleted" | "forbidden"; message: string };

export interface DeleteDeps {
  sql: SqlStorage;
  nextSeq: () => number;
  now: () => string;
  newId: () => string;
}

// G2: 削除はトゥームストーン。row は同期の削除伝搬（Phase 4）のために残す。
export function deleteRecordCore(
  deps: DeleteDeps,
  recordId: string,
  actor: string,
): DeleteRecordResult {
```

本体の `deps.sql.exec("DELETE FROM relations WHERE source_id = ?", recordId);` の直後に:

```ts
  // 裁定（2026-07-13）: 削除された実体が公開され続ける事故を構造的に防ぐ。
  // archive（ワークフロー軸）は仕様どおり強制 unpublish しない — delete だけが強制する。
  cascadeUnpublish({ sql: deps.sql, now: () => now, newId: deps.newId }, recordId);
```

- [ ] **Step 7: RPC アンラップ関数を足す**

`apps/api/src/rpc-unwrap.ts` の末尾に追加:

```ts
import type { PublishResult, UnpublishResult } from "./do/publish";
import type { ProjectionPayload } from "./projection/payload";

export function asPublishResult(value: unknown): PublishResult {
  return value as PublishResult;
}

export function asUnpublishResult(value: unknown): UnpublishResult {
  return value as UnpublishResult;
}

export function asProjectionPayload(value: unknown): ProjectionPayload | null {
  return value as ProjectionPayload | null;
}

export function asPublishedPage(value: unknown): {
  payloads: ProjectionPayload[];
  nextCursor: string | null;
} {
  return value as { payloads: ProjectionPayload[]; nextCursor: string | null };
}
```

（import はファイル先頭の既存 import 群にまとめること。）

- [ ] **Step 8: DO に RPC を足す**

`apps/api/src/tenant-do.ts`:

import に追加:

```ts
import {
  loadProjectionPayload,
  loadPublishedPage,
  publishRecordCore,
  unpublishRecordCore,
  type PublishResult,
  type UnpublishResult,
} from "./do/publish";
import type { ProjectionPayload } from "./projection/payload";
```

`deleteRecord` の `deleteRecordCore` 呼び出しに `newId` を渡すよう修正:

```ts
    const result = this.ctx.storage.transactionSync(() =>
      deleteRecordCore(
        {
          sql: this.ctx.storage.sql,
          nextSeq: () => ++this.seq,
          now: () => new Date().toISOString(),
          newId: () => uuidv7(),
        },
        recordId,
        auth.userId,
      ),
    );
```

クラスに追加（`deleteRecord` の後）:

```ts
  // DO は自分が idFromName のどの名前で起きたかを知らない。投影ジョブの宛先に必要なので永続化する。
  private rememberTenant(tenantId: string): void {
    this.ctx.storage.sql.exec(
      "INSERT OR REPLACE INTO do_config (key, value) VALUES ('tenant_id', ?)",
      tenantId,
    );
  }

  publishRecord(tenantId: string, recordId: string, auth: AuthContext): PublishResult {
    const denial = requireOperation(auth, "record:publish");
    if (denial !== null) {
      return denial;
    }
    return this.ctx.storage.transactionSync(() => {
      this.rememberTenant(tenantId);
      return publishRecordCore(
        {
          sql: this.ctx.storage.sql,
          now: () => new Date().toISOString(),
          newId: () => uuidv7(),
        },
        recordId,
        auth.userId,
      );
    });
  }

  unpublishRecord(tenantId: string, recordId: string, auth: AuthContext): UnpublishResult {
    const denial = requireOperation(auth, "record:publish");
    if (denial !== null) {
      return denial;
    }
    return this.ctx.storage.transactionSync(() => {
      this.rememberTenant(tenantId);
      return unpublishRecordCore(
        {
          sql: this.ctx.storage.sql,
          now: () => new Date().toISOString(),
          newId: () => uuidv7(),
        },
        recordId,
      );
    });
  }

  // Queues consumer が投影ペイロードを取りに来る経路（メッセージ本体にデータを載せない）
  getProjectionPayload(recordId: string): ProjectionPayload | null {
    return loadProjectionPayload(this.ctx.storage.sql, recordId);
  }

  getPublishedPage(
    cursor: string | null,
    limit: number,
  ): { payloads: ProjectionPayload[]; nextCursor: string | null } {
    return loadPublishedPage(this.ctx.storage.sql, cursor, limit);
  }
```

**注意**: この時点では outbox 行は積まれるだけで送出されない（Queue producer は Task 6）。テストは outbox 行と snapshot の状態だけを見る。

- [ ] **Step 9: テストを通す**

Run: `pnpm --filter @plyrs/api test -- test/publish.test.ts`
Expected: PASS（8 tests）

Run: `pnpm --filter @plyrs/api test`
Expected: 既存テストも全て PASS（`deleteRecordCore` の deps 変更が既存の呼び出し元を壊していないこと）

- [ ] **Step 10: HTTP ルートを足す**

`apps/api/src/routes/tenant.ts`:

`ERROR_STATUS` に追加:

```ts
  not_published: 409,
```

import に `asPublishResult` / `asUnpublishResult` を追加し、`.delete(...)` の後にルートを追加:

```ts
  .post("/:tenantId/records/:recordId/publish", async (c) => {
    const result = asPublishResult(
      await stubFor(c).publishRecord(
        c.req.param("tenantId"),
        c.req.param("recordId"),
        c.get("auth"),
      ),
    );
    return result.ok ? c.json(result) : c.json(result, statusFor(result.code));
  })
  .post("/:tenantId/records/:recordId/unpublish", async (c) => {
    const result = asUnpublishResult(
      await stubFor(c).unpublishRecord(
        c.req.param("tenantId"),
        c.req.param("recordId"),
        c.get("auth"),
      ),
    );
    return result.ok ? c.json(result) : c.json(result, statusFor(result.code));
  });
```

- [ ] **Step 11: ルートのテストを足す**

`apps/api/test/publish.test.ts` の末尾に別 describe を追加（`gate.test.ts` の `bootstrapTenant` と同じ手順で認証を通す — signup → cookie → tenant 作成 → `/auth/token`）:

```ts
import app from "../src/index";

const RUN_ID = crypto.randomUUID().slice(0, 8);
let n = 0;
function unique(prefix: string): string {
  n += 1;
  return `${prefix}${RUN_ID}-${n}`;
}

function json(body: unknown, headers: Record<string, string> = {}): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  };
}

async function bootstrapTenant(): Promise<{ tenantId: string; bearer: string }> {
  const email = `${unique("owner")}@example.com`;
  const signup = await app.request("/auth/signup", json({ email, password: "hunter2hunter2" }), env);
  const cookie = (signup.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  const created = await app.request(
    "/v1/tenants",
    json({ name: "T", slug: unique("t-") }, { cookie }),
    env,
  );
  const { tenantId } = (await created.json()) as { tenantId: string };
  const issued = await app.request("/auth/token", json({ tenantId }, { cookie }), env);
  const { token } = (await issued.json()) as { token: string };
  return { tenantId, bearer: `Bearer ${token}` };
}

describe("publish routes", () => {
  it("publishes and unpublishes through HTTP", async () => {
    const { tenantId, bearer } = await bootstrapTenant();
    const authHeader = { authorization: bearer };

    await app.request(
      `/v1/t/${tenantId}/content-types`,
      { ...json(articleType(), authHeader), method: "PUT" },
      env,
    );
    await app.request(
      `/v1/t/${tenantId}/records/article/${uuid(120)}`,
      { ...json({ input: validArticleInput() }, authHeader), method: "PUT" },
      env,
    );

    const published = await app.request(
      `/v1/t/${tenantId}/records/${uuid(120)}/publish`,
      json({}, authHeader),
      env,
    );
    expect(published.status).toBe(200);

    const unpublished = await app.request(
      `/v1/t/${tenantId}/records/${uuid(120)}/unpublish`,
      json({}, authHeader),
      env,
    );
    expect(unpublished.status).toBe(200);

    const again = await app.request(
      `/v1/t/${tenantId}/records/${uuid(120)}/unpublish`,
      json({}, authHeader),
      env,
    );
    expect(again.status).toBe(409);
  });
});
```

- [ ] **Step 12: テストを実行してコミット**

Run: `pnpm --filter @plyrs/api test -- test/publish.test.ts`
Expected: PASS（9 tests）

```bash
git add apps/api
git commit -m "feat: publish and unpublish records into DO snapshots"
```

---

## Task 5: Queues consumer（冪等 upsert / delete + version ガード）

**Files:**
- Create: `apps/api/src/projection/jobs.ts`
- Create: `apps/api/src/projection/consumer.ts`
- Create: `apps/api/test/projection-consumer.test.ts`
- Modify: `apps/api/wrangler.jsonc`
- Modify: `apps/api/env.d.ts`
- Modify: `apps/api/src/index.ts`

**Interfaces:**
- Consumes: `ProjectionPayload`（Task 3）、RPC `getProjectionPayload` / `getPublishedPage`（Task 4）、`asProjectionPayload` / `asPublishedPage`（Task 4）
- Produces:
  - `apps/api/src/projection/jobs.ts`: `interface UpsertJob { jobType: "upsert"; tenantId: string; recordId: string; sourceVersion: number }`、`interface DeleteJob { jobType: "delete"; tenantId: string; recordId: string; sourceVersion: number }`、`interface ReprojectJob { jobType: "reproject"; tenantId: string; cursor: string | null; epoch: number }`、`type ProjectionJob = UpsertJob | DeleteJob | ReprojectJob`、`const REPROJECT_PAGE_SIZE = 50`
  - `apps/api/src/projection/consumer.ts`: `function upsertStatements(db: D1Database, tenantId: string, payload: ProjectionPayload, projectedAt: number): D1PreparedStatement[]`、`function deleteStatements(db: D1Database, tenantId: string, recordId: string, sourceVersion: number): D1PreparedStatement[]`、`function handleProjectionJob(env: Env, job: ProjectionJob, nowMs: number): Promise<void>`
  - バインディング `env.PROJECTION_QUEUE`（`Queue<ProjectionJob>`）、Worker の `queue` ハンドラ

- [ ] **Step 1: 失敗するテストを書く**

`apps/api/test/projection-consumer.test.ts`:

```ts
import { createExecutionContext, createMessageBatch, getQueueResult } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import worker from "../src/index";
import type { ProjectionJob } from "../src/projection/jobs";
import { articleType, auth, uuid, validArticleInput } from "./fixtures";
import { asPublishResult, asWriteResult } from "./rpc-unwrap";

const QUEUE_NAME = "plyrs-projection";

// createMessageBatch の messages 配列は非 experimental な workers-types 下では
// 実質 any に落ちて型検査されない。ここで型を固定する。
function batchOf(jobs: ProjectionJob[]) {
  return createMessageBatch<ProjectionJob>(
    QUEUE_NAME,
    jobs.map((body, i) => ({
      id: `m${i}`,
      timestamp: new Date(1_000 + i),
      attempts: 1,
      body,
    })),
  );
}

async function deliver(jobs: ProjectionJob[]) {
  const batch = batchOf(jobs);
  const ctx = createExecutionContext();
  await worker.queue(batch, env, ctx);
  return getQueueResult(batch, ctx);
}

interface ProjectedRow {
  type: string;
  slug: string | null;
  data: string;
  source_version: number;
}

async function projected(tenantId: string, recordId: string): Promise<ProjectedRow | null> {
  return env.PROJECTION_DB.prepare(
    "SELECT type, slug, data, source_version FROM projected_records WHERE tenant_id = ? AND record_id = ?",
  )
    .bind(tenantId, recordId)
    .first<ProjectedRow>();
}

async function countRows(table: string, tenantId: string, recordId: string): Promise<number> {
  const column = table === "projected_relations" ? "source_id" : "record_id";
  const row = await env.PROJECTION_DB.prepare(
    `SELECT COUNT(*) AS n FROM ${table} WHERE tenant_id = ? AND ${column} = ?`,
  )
    .bind(tenantId, recordId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

describe("projection consumer (design-spec §12.3)", () => {
  let tenantId: string;
  let stub: DurableObjectStub<import("../src/tenant-do").TenantDO>;
  const recordId = uuid(200);

  beforeEach(async () => {
    tenantId = crypto.randomUUID();
    stub = env.TENANT_DO.get(env.TENANT_DO.idFromName(tenantId));
    await stub.registerContentType(articleType(), auth("owner1"));
    const written = asWriteResult(
      await stub.writeRecord("article", { recordId, input: validArticleInput() }, auth("owner1")),
    );
    expect(written.ok).toBe(true);
    const published = asPublishResult(await stub.publishRecord(tenantId, recordId, auth("owner1")));
    expect(published.ok).toBe(true);
  });

  it("upserts the record, its relations, and its index rows, then acks", async () => {
    const result = await deliver([
      { jobType: "upsert", tenantId, recordId, sourceVersion: 1 },
    ]);
    expect(result.explicitAcks).toStrictEqual(["m0"]);
    expect(result.retryMessages).toStrictEqual([]);

    const row = await projected(tenantId, recordId);
    expect(row).toMatchObject({ type: "article", slug: "hello", source_version: 1 });
    expect(JSON.parse(row?.data ?? "{}")).toMatchObject({ title: "こんにちは" });
    // authors x2 + hero x1
    expect(await countRows("projected_relations", tenantId, recordId)).toBe(3);
    // slug + published_at（fixtures の indexed 宣言は 2 つ）
    expect(await countRows("projection_index", tenantId, recordId)).toBe(2);
  });

  it("is idempotent under redelivery (at-least-once)", async () => {
    const job: ProjectionJob = { jobType: "upsert", tenantId, recordId, sourceVersion: 1 };
    await deliver([job]);
    await deliver([job]);

    expect(await countRows("projected_relations", tenantId, recordId)).toBe(3);
    expect(await countRows("projection_index", tenantId, recordId)).toBe(2);
  });

  it("ignores an upsert older than what is already projected (order guard)", async () => {
    await stub.writeRecord(
      "article",
      { recordId, input: { ...validArticleInput(), title: "第2版" } },
      auth("owner1"),
    );
    await stub.publishRecord(tenantId, recordId, auth("owner1"));
    // 新しい版（v2）が先に着き、古い版（v1）のジョブが遅れて届く
    await deliver([{ jobType: "upsert", tenantId, recordId, sourceVersion: 2 }]);
    await deliver([{ jobType: "upsert", tenantId, recordId, sourceVersion: 1 }]);

    const row = await projected(tenantId, recordId);
    expect(row?.source_version).toBe(2);
    expect(JSON.parse(row?.data ?? "{}")).toMatchObject({ title: "第2版" });
  });

  it("deletes the record and its side tables on an unpublish job", async () => {
    await deliver([{ jobType: "upsert", tenantId, recordId, sourceVersion: 1 }]);
    await stub.unpublishRecord(tenantId, recordId, auth("owner1"));
    await deliver([{ jobType: "delete", tenantId, recordId, sourceVersion: 1 }]);

    expect(await projected(tenantId, recordId)).toBeNull();
    expect(await countRows("projected_relations", tenantId, recordId)).toBe(0);
    expect(await countRows("projection_index", tenantId, recordId)).toBe(0);
  });

  it("ignores a delete whose version is older than the projection (republish won)", async () => {
    await deliver([{ jobType: "upsert", tenantId, recordId, sourceVersion: 1 }]);
    await stub.writeRecord(
      "article",
      { recordId, input: { ...validArticleInput(), title: "第2版" } },
      auth("owner1"),
    );
    await stub.publishRecord(tenantId, recordId, auth("owner1"));
    await deliver([{ jobType: "upsert", tenantId, recordId, sourceVersion: 2 }]);
    // unpublish(v1) が遅れて届く — 既に republish(v2) が載っているので無視されなければならない
    await deliver([{ jobType: "delete", tenantId, recordId, sourceVersion: 1 }]);

    expect(await projected(tenantId, recordId)).not.toBeNull();
  });

  it("retries the message when the job cannot be handled", async () => {
    // 未知のジョブ種別（将来のジョブが古い Worker に届いた場合）は ack せず retry させる
    const bogus = { jobType: "bogus", tenantId, recordId, sourceVersion: 1 } as unknown as ProjectionJob;
    const result = await deliver([bogus]);
    expect(result.explicitAcks).toStrictEqual([]);
    expect(result.retryMessages).toStrictEqual([{ msgId: "m0" }]);
  });
});
```

- [ ] **Step 2: テストが落ちることを確認**

Run: `pnpm --filter @plyrs/api test -- test/projection-consumer.test.ts`
Expected: FAIL（`worker.queue is not a function`）

- [ ] **Step 3: ジョブ型を定義**

`apps/api/src/projection/jobs.ts`:

```ts
// design-spec §12.3: Queues に載るジョブ。メッセージにはデータを載せず、consumer が DO へ
// 取りに行く（128KB のメッセージ上限に record のサイズを従属させない）。
export interface UpsertJob {
  jobType: "upsert";
  tenantId: string;
  recordId: string;
  sourceVersion: number;
}

export interface DeleteJob {
  jobType: "delete";
  tenantId: string;
  recordId: string;
  sourceVersion: number;
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
```

- [ ] **Step 4: consumer を実装**

`apps/api/src/projection/consumer.ts`:

```ts
import { asProjectionPayload, asPublishedPage } from "../rpc-unwrap";
import { REPROJECT_PAGE_SIZE, type ProjectionJob } from "./jobs";
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
```

この時点では `REPROJECT_PAGE_SIZE` と `asPublishedPage` は未使用なので import しないこと（未使用 import は lint が落とす）。Task 7 で追加する。

- [ ] **Step 5: Queue バインディングと consumer を配線**

`apps/api/wrangler.jsonc` の末尾に追加:

```jsonc
  "queues": {
    "producers": [{ "binding": "PROJECTION_QUEUE", "queue": "plyrs-projection" }],
    "consumers": [
      {
        "queue": "plyrs-projection",
        // 0 にしないとテストが 1 メッセージあたり約 1 秒待たされる（実測）
        "max_batch_timeout": 0,
        "max_batch_size": 10,
        "max_retries": 3,
      },
    ],
  },
```

`apps/api/env.d.ts` の `EnvBindings` に追加:

```ts
  // design-spec §12.3: アウトボックス排出先。DO からも Worker からも送る
  PROJECTION_QUEUE: Queue<import("./src/projection/jobs").ProjectionJob>;
```

`apps/api/src/index.ts`:

```ts
import { Hono } from "hono";
import { handleProjectionJob } from "./projection/consumer";
import type { ProjectionJob } from "./projection/jobs";
import { authRoutes } from "./routes/auth";
import { tenantRoutes } from "./routes/tenant";
import { tenantAdminRoutes } from "./routes/tenants";

export { TenantDO } from "./tenant-do";

const app = new Hono<{ Bindings: Env }>();
app.route("/auth", authRoutes);
app.route("/v1/tenants", tenantAdminRoutes);
app.route("/v1/t", tenantRoutes);
app.notFound((c) => c.json({ error: "not_found" }, 404));

export default {
  fetch: app.fetch,
  // design-spec §12.3: 投影 consumer。冪等なので at-least-once 配信をそのまま受ける。
  async queue(batch: MessageBatch<ProjectionJob>, env: Env): Promise<void> {
    const nowMs = Date.now();
    for (const message of batch.messages) {
      try {
        await handleProjectionJob(env, message.body, nowMs);
        message.ack();
      } catch (error) {
        console.error("projection job failed", message.body, error);
        message.retry();
      }
    }
  },
} satisfies ExportedHandler<Env, ProjectionJob>;
```

**注意**: 既存テストは `import app from "../src/index"` で Hono アプリを直接使っている（`app.request(...)`）。default export が変わるとそれらが壊れる。**`app` を名前付きでも export する**こと:

```ts
export { app };
```

そして既存テスト（`gate.test.ts` / `auth-routes.test.ts` / `control-plane-smoke.test.ts` など `app.request` を使う全ファイル）の import を `import { app } from "../src/index";` に書き換える。どのファイルが該当するかは `grep -rl 'from "../src/index"' apps/api/test` で洗い出すこと。

- [ ] **Step 6: テストを通す**

Run: `pnpm --filter @plyrs/api test -- test/projection-consumer.test.ts`
Expected: PASS（6 tests）

Run: `pnpm --filter @plyrs/api test`
Expected: 全 PASS（`app` の import 書き換え漏れがないこと）

- [ ] **Step 7: コミット**

```bash
git add apps/api
git commit -m "feat: project published snapshots into D1 from a queue consumer"
```

---

## Task 6: alarm 多重化レジストリと outbox sweeper（producer）

**Files:**
- Create: `apps/api/src/do/alarms.ts`
- Create: `apps/api/test/sweeper.test.ts`
- Modify: `apps/api/src/tenant-do.ts`

**Interfaces:**
- Consumes: `unsentOutbox` / `markOutboxSent` / `countUnsent` / `purgeSent`（Task 4）、`ProjectionJob`（Task 5）
- Produces:
  - `apps/api/src/do/alarms.ts`: `const OUTBOX_SWEEP = "outbox_sweep"`、`const SWEEP_DELAY_MS = 5_000`、`const SWEEP_RETRY_MS = 30_000`、`function registerAlarm(sql: SqlStorage, kind: string, dueAt: number): number`（登録して新しい最小 due を返す）、`function clearAlarm(sql: SqlStorage, kind: string): void`、`function dueKinds(sql: SqlStorage, nowMs: number): string[]`、`function minDueAt(sql: SqlStorage): number | null`
  - `TenantDO.alarm()`（多重化ディスパッチャ）、`TenantDO.pendingOutbox()`（テスト用: 未送出件数）

- [ ] **Step 1: 失敗するテストを書く**

`apps/api/test/sweeper.test.ts`:

```ts
import { env } from "cloudflare:workers";
import { evictDurableObject, runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { articleType, auth, uuid, validArticleInput } from "./fixtures";
import { asPublishResult, asWriteResult } from "./rpc-unwrap";

describe("outbox sweeper on the alarm registry (design-spec §9.6 / §12.3)", () => {
  let tenantId: string;
  let stub: DurableObjectStub<import("../src/tenant-do").TenantDO>;
  const recordId = uuid(300);

  beforeEach(async () => {
    tenantId = crypto.randomUUID();
    stub = env.TENANT_DO.get(env.TENANT_DO.idFromName(tenantId));
    await stub.registerContentType(articleType(), auth("owner1"));
    const written = asWriteResult(
      await stub.writeRecord("article", { recordId, input: validArticleInput() }, auth("owner1")),
    );
    expect(written.ok).toBe(true);
  });

  it("drains the outbox on the publish path and leaves nothing pending", async () => {
    const published = asPublishResult(await stub.publishRecord(tenantId, recordId, auth("owner1")));
    expect(published.ok).toBe(true);
    expect(await stub.pendingOutbox()).toBe(0);
  });

  it("arms an alarm in the same transaction as the outbox row", async () => {
    await stub.publishRecord(tenantId, recordId, auth("owner1"));
    await runInDurableObject(stub, async (_instance, state) => {
      // 正常系で排出済みでも、レジストリの掃除は sweeper の仕事なのでアラームは張られたまま
      expect(await state.storage.getAlarm()).not.toBeNull();
    });
  });

  it("sweeps unsent rows and clears its registration when the outbox is empty", async () => {
    await stub.publishRecord(tenantId, recordId, auth("owner1"));
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    expect(await stub.pendingOutbox()).toBe(0);

    await runInDurableObject(stub, async (_instance, state) => {
      // 未送出が無くなったので登録は消え、次のアラームも張られない
      expect(await state.storage.getAlarm()).toBeNull();
    });
  });

  it("re-arms the alarm from the registry when the DO restarts", async () => {
    await stub.publishRecord(tenantId, recordId, auth("owner1"));
    await runInDurableObject(stub, async (_instance, state) => {
      // アラームを失った状態（sweeper のバグ・リトライ枯渇等）を再現
      await state.storage.deleteAlarm();
      expect(await state.storage.getAlarm()).toBeNull();
    });

    await evictDurableObject(stub);
    await stub.ping(); // constructor を走らせる

    await runInDurableObject(stub, async (_instance, state) => {
      expect(await state.storage.getAlarm()).not.toBeNull();
    });
  });
});
```

- [ ] **Step 2: テストが落ちることを確認**

Run: `pnpm --filter @plyrs/api test -- test/sweeper.test.ts`
Expected: FAIL（`stub.pendingOutbox is not a function`）

- [ ] **Step 3: alarm レジストリを実装**

`apps/api/src/do/alarms.ts`:

```ts
// design-spec §9.6: DO の alarm は 1 オブジェクトにつき 1 本。複数の論理タイマーを
// 単一 alarm に多重化する。最早の due_at が物理アラームを持つ（earliest-wins）。
// Phase 5a では kind = 'outbox_sweep' のみ。Phase 9 でモジュール向けに汎用化する。

export const OUTBOX_SWEEP = "outbox_sweep";

// コミット直後に排出できなかった分を数秒後に拾い直す（§12.3 の「コミットの事実」に依存する保証）
export const SWEEP_DELAY_MS = 5_000;
// 排出しきれなかった場合の再試行間隔
export const SWEEP_RETRY_MS = 30_000;

export function minDueAt(sql: SqlStorage): number | null {
  return sql.exec<{ min_due: number | null }>("SELECT MIN(due_at) AS min_due FROM alarm_registry")
    .one().min_due;
}

// 既存登録より早い時刻だけを採用する（後から来た遅い希望で前倒し済みの起床を遅らせない）
export function registerAlarm(sql: SqlStorage, kind: string, dueAt: number): number {
  sql.exec(
    "INSERT INTO alarm_registry (kind, due_at) VALUES (?, ?) ON CONFLICT(kind) DO UPDATE SET due_at = MIN(due_at, excluded.due_at)",
    kind,
    dueAt,
  );
  const min = minDueAt(sql);
  // 直前に INSERT したので NULL にはならないが、型の上では絞る
  return min ?? dueAt;
}

export function clearAlarm(sql: SqlStorage, kind: string): void {
  sql.exec("DELETE FROM alarm_registry WHERE kind = ?", kind);
}

export function dueKinds(sql: SqlStorage, nowMs: number): string[] {
  return sql
    .exec<{ kind: string }>("SELECT kind FROM alarm_registry WHERE due_at <= ? ORDER BY due_at", nowMs)
    .toArray()
    .map((row) => row.kind);
}
```

- [ ] **Step 4: DO に sweeper と producer を実装**

`apps/api/src/tenant-do.ts`:

import に追加:

```ts
import {
  clearAlarm,
  dueKinds,
  minDueAt,
  OUTBOX_SWEEP,
  registerAlarm,
  SWEEP_DELAY_MS,
  SWEEP_RETRY_MS,
} from "./do/alarms";
import { countUnsent, markOutboxSent, purgeSent, unsentOutbox } from "./do/outbox";
import type { ProjectionJob } from "./projection/jobs";
```

constructor の `blockConcurrencyWhile` に再アームを追加（既存の migrate / seq 復元の後）:

```ts
    ctx.blockConcurrencyWhile(async () => {
      await migrate(this.db, migrations);
      const row = ctx.storage.sql
        .exec<{ max_seq: number | null }>("SELECT MAX(seq) AS max_seq FROM records")
        .one();
      this.seq = row.max_seq ?? 0;
      // 保険: アラームを失っても（sweeper のバグ・リトライ枯渇）、次に DO が起きた時に張り直す。
      // outbox 行とアラームは同一トランザクションで書くため通常は失われない。
      const due = minDueAt(ctx.storage.sql);
      if (due !== null && (await ctx.storage.getAlarm()) === null) {
        await ctx.storage.setAlarm(due);
      }
    });
```

`publishRecord` / `unpublishRecord` / `deleteRecord` を「トランザクション内でアラーム登録 → トランザクション後に await → 排出」の形に統一する。`publishRecord` は次のとおり（`unpublishRecord` も同じ形。`deleteRecord` は `deleteRecordCore` の結果が ok のときだけ登録する）:

```ts
  async publishRecord(
    tenantId: string,
    recordId: string,
    auth: AuthContext,
  ): Promise<PublishResult> {
    const denial = requireOperation(auth, "record:publish");
    if (denial !== null) {
      return denial;
    }
    // setAlarm は transactionSync に参加し、ロールバックで巻き戻る（実証済み）。
    // クロージャ内では await できないので promise を掴み、トランザクションを出てから待つ。
    let armed: Promise<void> | null = null;
    const result = this.ctx.storage.transactionSync(() => {
      this.rememberTenant(tenantId);
      const inner = publishRecordCore(
        {
          sql: this.ctx.storage.sql,
          now: () => new Date().toISOString(),
          newId: () => uuidv7(),
        },
        recordId,
        auth.userId,
      );
      if (inner.ok) {
        armed = this.armSweep(Date.now() + SWEEP_DELAY_MS);
      }
      return inner;
    });
    if (armed !== null) {
      await armed;
    }
    if (result.ok) {
      await this.drainOutbox();
    }
    return result;
  }
```

クラスに追加:

```ts
  // 登録して物理アラームを最小 due に張り直す（§9.6 の多重化）
  private armSweep(dueAt: number): Promise<void> {
    const min = registerAlarm(this.ctx.storage.sql, OUTBOX_SWEEP, dueAt);
    return this.ctx.storage.setAlarm(min);
  }

  private tenantId(): string | null {
    const row = this.ctx.storage.sql
      .exec<{ value: string }>("SELECT value FROM do_config WHERE key = 'tenant_id'")
      .toArray()[0];
    return row?.value ?? null;
  }

  // アウトボックスの排出。正常系は publish 直後に呼ぶ。失敗しても例外を投げない
  // （コミットは済んでいる。拾い直すのは sweeper の仕事 = §12.3 の「コミットの事実」に依存する保証）。
  private async drainOutbox(): Promise<void> {
    const tenantId = this.tenantId();
    if (tenantId === null) {
      console.error("outbox drain skipped: tenant id is unknown");
      return;
    }
    for (const row of unsentOutbox(this.ctx.storage.sql, 50)) {
      const job: ProjectionJob =
        row.jobType === "delete"
          ? {
              jobType: "delete",
              tenantId,
              recordId: row.recordId,
              sourceVersion: row.sourceVersion,
            }
          : {
              jobType: "upsert",
              tenantId,
              recordId: row.recordId,
              sourceVersion: row.sourceVersion,
            };
      try {
        // 送出してからマークする。逆順にするとメッセージを失う（重複は consumer が冪等に吸収する）。
        await this.env.PROJECTION_QUEUE.send(job);
        markOutboxSent(this.ctx.storage.sql, row.id);
      } catch (error) {
        console.error("outbox send failed", row.id, error);
        return; // 残りは sweeper に任せる
      }
    }
  }

  // テスト用: 未送出件数
  pendingOutbox(): number {
    return countUnsent(this.ctx.storage.sql);
  }

  override async alarm(): Promise<void> {
    // runDurableObjectAlarm() 経由では alarmInfo が undefined で渡るため引数は使わない
    const now = Date.now();
    for (const kind of dueKinds(this.ctx.storage.sql, now)) {
      if (kind === OUTBOX_SWEEP) {
        await this.sweepOutbox();
      }
    }
    const min = minDueAt(this.ctx.storage.sql);
    if (min !== null) {
      await this.ctx.storage.setAlarm(min);
    }
  }

  private async sweepOutbox(): Promise<void> {
    await this.drainOutbox();
    // MIN() 意味論の登録では過去の due を前倒しのまま残してしまうので、消してから登録し直す
    clearAlarm(this.ctx.storage.sql, OUTBOX_SWEEP);
    if (countUnsent(this.ctx.storage.sql) > 0) {
      registerAlarm(this.ctx.storage.sql, OUTBOX_SWEEP, Date.now() + SWEEP_RETRY_MS);
      return;
    }
    // 全行送出済み → 登録を消して no-op で終わる（§12.3）
    purgeSent(this.ctx.storage.sql);
  }
```

**注意**: `publishRecord` / `unpublishRecord` / `deleteRecord` は `async` になる（戻り値が `Promise<...>` になる）。RPC 呼び出し側は既に `await` しているため透過的だが、`apps/api/src/routes/tenant.ts` の型は自動で追随する。既存テストの `await stub.deleteRecord(...)` も問題ない。

- [ ] **Step 5: テストを通す**

Run: `pnpm --filter @plyrs/api test -- test/sweeper.test.ts`
Expected: PASS（4 tests）

Run: `pnpm --filter @plyrs/api test`
Expected: 全 PASS

- [ ] **Step 6: コミット**

```bash
git add apps/api
git commit -m "feat: drain the outbox through an alarm-multiplexed sweeper"
```

---

## Task 7: テナント単位の再投影ジョブ

**Files:**
- Create: `apps/api/test/reproject.test.ts`
- Modify: `apps/api/src/projection/consumer.ts`
- Modify: `apps/api/src/tenant-do.ts`
- Modify: `apps/api/src/routes/tenant.ts`
- Modify: `apps/api/src/rpc-unwrap.ts`

**Interfaces:**
- Consumes: `loadPublishedPage`（Task 4）、`upsertStatements` / `ProjectionJob` / `REPROJECT_PAGE_SIZE`（Task 5）
- Produces:
  - `TenantDO.startReprojection(tenantId: string, auth: AuthContext): Promise<{ ok: true; epoch: number } | { ok: false; code: "forbidden"; message: string }>`
  - `asReprojectResult(value: unknown)` （`apps/api/src/rpc-unwrap.ts`）
  - `POST /v1/t/:tenantId/reproject`
  - consumer の `reproject` 分岐（ページごとに upsert し、cursor で自己連鎖し、最後に epoch より古い行を掃く）

- [ ] **Step 1: 失敗するテストを書く**

`apps/api/test/reproject.test.ts`:

```ts
import { createExecutionContext, createMessageBatch, getQueueResult } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import worker from "../src/index";
import type { ProjectionJob } from "../src/projection/jobs";
import { articleType, auth, uuid, validArticleInput } from "./fixtures";
import { asReprojectResult, asWriteResult } from "./rpc-unwrap";

async function deliver(jobs: ProjectionJob[]) {
  const batch = createMessageBatch<ProjectionJob>(
    "plyrs-projection",
    jobs.map((body, i) => ({ id: `m${i}`, timestamp: new Date(1_000 + i), attempts: 1, body })),
  );
  const ctx = createExecutionContext();
  await worker.queue(batch, env, ctx);
  return getQueueResult(batch, ctx);
}

async function projectedIds(tenantId: string): Promise<string[]> {
  const { results } = await env.PROJECTION_DB.prepare(
    "SELECT record_id FROM projected_records WHERE tenant_id = ? ORDER BY record_id",
  )
    .bind(tenantId)
    .all<{ record_id: string }>();
  return results.map((row) => row.record_id);
}

describe("tenant reprojection (design-spec §12.3b)", () => {
  it("rebuilds the projection from snapshots and sweeps rows that are no longer published", async () => {
    const tenantId = crypto.randomUUID();
    const stub = env.TENANT_DO.get(env.TENANT_DO.idFromName(tenantId));
    await stub.registerContentType(articleType(), auth("owner1"));

    for (const n of [400, 401, 402]) {
      const written = asWriteResult(
        await stub.writeRecord(
          "article",
          { recordId: uuid(n), input: { ...validArticleInput(), slug: `s-${n}` } },
          auth("owner1"),
        ),
      );
      expect(written.ok).toBe(true);
      await stub.publishRecord(tenantId, uuid(n), auth("owner1"));
    }
    // publish 経路の排出分を投影に反映
    await deliver([
      { jobType: "upsert", tenantId, recordId: uuid(400), sourceVersion: 1 },
      { jobType: "upsert", tenantId, recordId: uuid(401), sourceVersion: 1 },
      { jobType: "upsert", tenantId, recordId: uuid(402), sourceVersion: 1 },
    ]);
    expect(await projectedIds(tenantId)).toStrictEqual([uuid(400), uuid(401), uuid(402)]);

    // 投影にだけ存在する幽霊行を作る（乖離の再現）
    await env.PROJECTION_DB.prepare(
      "INSERT INTO projected_records (tenant_id, record_id, type, slug, published_at, data, source_version, projected_at) VALUES (?, ?, 'article', 'ghost', '2026-01-01T00:00:00.000Z', '{}', 1, 1)",
    )
      .bind(tenantId, uuid(499))
      .run();

    const started = asReprojectResult(await stub.startReprojection(tenantId, auth("owner1")));
    expect(started.ok).toBe(true);
    if (!started.ok) {
      return;
    }

    await deliver([{ jobType: "reproject", tenantId, cursor: null, epoch: started.epoch }]);

    // snapshot に無い幽霊行が消え、公開中の 3 件だけが残る
    expect(await projectedIds(tenantId)).toStrictEqual([uuid(400), uuid(401), uuid(402)]);

    const orphanRelations = await env.PROJECTION_DB.prepare(
      "SELECT COUNT(*) AS n FROM projected_relations WHERE tenant_id = ? AND source_id = ?",
    )
      .bind(tenantId, uuid(499))
      .first<{ n: number }>();
    expect(orphanRelations?.n).toBe(0);
  });

  it("backfills projection_index rows for a newly indexed field", async () => {
    const tenantId = crypto.randomUUID();
    const stub = env.TENANT_DO.get(env.TENANT_DO.idFromName(tenantId));
    await stub.registerContentType(articleType(), auth("owner1"));
    const recordId = uuid(410);
    await stub.writeRecord("article", { recordId, input: validArticleInput() }, auth("owner1"));
    await stub.publishRecord(tenantId, recordId, auth("owner1"));
    await deliver([{ jobType: "upsert", tenantId, recordId, sourceVersion: 1 }]);

    const before = await env.PROJECTION_DB.prepare(
      "SELECT COUNT(*) AS n FROM projection_index WHERE tenant_id = ? AND field_key = 'tags'",
    )
      .bind(tenantId)
      .first<{ n: number }>();
    expect(before?.n).toBe(0);

    // tags を後から indexed 宣言する（DO の VIRTUAL generated column は既存行を書き換えないが、
    // 投影側のサイドテーブルはバックフィルが要る — §12.3b の非対称）
    const withIndexedTags = articleType();
    const tags = withIndexedTags.fields.find((field) => field.key === "tags");
    if (tags?.type === "select") {
      tags.config.indexed = true;
    }
    await stub.registerContentType(withIndexedTags, auth("owner1"));

    const started = asReprojectResult(await stub.startReprojection(tenantId, auth("owner1")));
    expect(started.ok).toBe(true);
    if (!started.ok) {
      return;
    }
    await deliver([{ jobType: "reproject", tenantId, cursor: null, epoch: started.epoch }]);

    const after = await env.PROJECTION_DB.prepare(
      "SELECT value_text FROM projection_index WHERE tenant_id = ? AND field_key = 'tags'",
    )
      .bind(tenantId)
      .all<{ value_text: string }>();
    expect(after.results.map((row) => row.value_text)).toStrictEqual(["tech"]);
  });

  it("denies reprojection to editors", async () => {
    const tenantId = crypto.randomUUID();
    const stub = env.TENANT_DO.get(env.TENANT_DO.idFromName(tenantId));
    const denied = asReprojectResult(
      await stub.startReprojection(tenantId, auth("eve", "editor")),
    );
    expect(denied).toMatchObject({ ok: false, code: "forbidden" });
  });
});
```

- [ ] **Step 2: テストが落ちることを確認**

Run: `pnpm --filter @plyrs/api test -- test/reproject.test.ts`
Expected: FAIL（`stub.startReprojection is not a function`）

- [ ] **Step 3: consumer の reproject 分岐を実装**

`apps/api/src/projection/consumer.ts` の暫定 `handleReprojectJob` と末尾の暫定 `export { REPROJECT_PAGE_SIZE, asPublishedPage }` を削除し、次に置き換える:

```ts
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
    // 共有 D1 への書き込み集中を避けるため 1 ページずつ自己連鎖する（§12.3b の運用注記）
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
```

import を `import { REPROJECT_PAGE_SIZE, type ProjectionJob, type ReprojectJob } from "./jobs";` に、`handleProjectionJob` の `case "reproject"` を `await handleReprojectJob(env, job, nowMs);` に更新する（`job` は判別可能ユニオンで `ReprojectJob` に絞られる）。

- [ ] **Step 4: DO の RPC とルートを実装**

`apps/api/src/tenant-do.ts` に追加:

```ts
  async startReprojection(
    tenantId: string,
    auth: AuthContext,
  ): Promise<{ ok: true; epoch: number } | { ok: false; code: "forbidden"; message: string }> {
    const denial = requireOperation(auth, "projection:rebuild");
    if (denial !== null) {
      return denial;
    }
    this.ctx.storage.transactionSync(() => {
      this.rememberTenant(tenantId);
    });
    const epoch = Date.now();
    // 再投影は outbox を経由しない（publish のような原子性要求が無く、失敗しても再実行すれば足りる）
    await this.env.PROJECTION_QUEUE.send({ jobType: "reproject", tenantId, cursor: null, epoch });
    return { ok: true, epoch };
  }
```

`apps/api/src/rpc-unwrap.ts` に追加:

```ts
export function asReprojectResult(
  value: unknown,
): { ok: true; epoch: number } | { ok: false; code: "forbidden"; message: string } {
  return value as { ok: true; epoch: number } | { ok: false; code: "forbidden"; message: string };
}
```

`apps/api/src/routes/tenant.ts` に追加（`asReprojectResult` を import）:

```ts
  .post("/:tenantId/reproject", async (c) => {
    const result = asReprojectResult(
      await stubFor(c).startReprojection(c.req.param("tenantId"), c.get("auth")),
    );
    return result.ok ? c.json(result) : c.json(result, statusFor(result.code));
  });
```

- [ ] **Step 5: テストを通す**

Run: `pnpm --filter @plyrs/api test -- test/reproject.test.ts`
Expected: PASS（3 tests）

- [ ] **Step 6: コミット**

```bash
git add apps/api
git commit -m "feat: rebuild a tenant projection with a cursor-chained reprojection job"
```

---

## Task 8: 実キューを通した配線テストとロードマップ更新

**Files:**
- Create: `apps/api/test/projection-e2e.test.ts`
- Modify: `docs/superpowers/plans/2026-07-12-implementation-roadmap.md`

**Interfaces:**
- Consumes: 全タスクの成果
- Produces: なし（検証とドキュメント）

- [ ] **Step 1: E2E 配線テストを書く**

`apps/api/test/projection-e2e.test.ts`:

```ts
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { articleType, auth, uuid, validArticleInput } from "./fixtures";
import { asPublishResult, asWriteResult } from "./rpc-unwrap";

// Queue の配送は非同期（miniflare のブローカ経由）。フラッシュ API は無いのでポーリングする。
async function waitFor<T>(read: () => Promise<T | null>, timeoutMs = 5_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (value !== null) {
      return value;
    }
    if (Date.now() > deadline) {
      throw new Error("timed out waiting for the projection");
    }
    await scheduler.wait(25);
  }
}

describe("publish → outbox → queue → projection D1 (wiring)", () => {
  it("projects a published record without any test-side queue plumbing", async () => {
    const tenantId = crypto.randomUUID();
    const stub = env.TENANT_DO.get(env.TENANT_DO.idFromName(tenantId));
    const recordId = uuid(500);

    await stub.registerContentType(articleType(), auth("owner1"));
    const written = asWriteResult(
      await stub.writeRecord("article", { recordId, input: validArticleInput() }, auth("owner1")),
    );
    expect(written.ok).toBe(true);

    const published = asPublishResult(await stub.publishRecord(tenantId, recordId, auth("owner1")));
    expect(published.ok).toBe(true);

    const row = await waitFor(() =>
      env.PROJECTION_DB.prepare(
        "SELECT slug, source_version FROM projected_records WHERE tenant_id = ? AND record_id = ?",
      )
        .bind(tenantId, recordId)
        .first<{ slug: string; source_version: number }>(),
    );
    expect(row).toMatchObject({ slug: "hello", source_version: 1 });
  });

  it("removes the projection when the record is unpublished", async () => {
    const tenantId = crypto.randomUUID();
    const stub = env.TENANT_DO.get(env.TENANT_DO.idFromName(tenantId));
    const recordId = uuid(501);

    await stub.registerContentType(articleType(), auth("owner1"));
    await stub.writeRecord("article", { recordId, input: validArticleInput() }, auth("owner1"));
    await stub.publishRecord(tenantId, recordId, auth("owner1"));
    await waitFor(() =>
      env.PROJECTION_DB.prepare(
        "SELECT record_id FROM projected_records WHERE tenant_id = ? AND record_id = ?",
      )
        .bind(tenantId, recordId)
        .first<{ record_id: string }>(),
    );

    await stub.unpublishRecord(tenantId, recordId, auth("owner1"));
    const gone = await waitFor(async () => {
      const row = await env.PROJECTION_DB.prepare(
        "SELECT record_id FROM projected_records WHERE tenant_id = ? AND record_id = ?",
      )
        .bind(tenantId, recordId)
        .first<{ record_id: string }>();
      return row === null ? "gone" : null;
    });
    expect(gone).toBe("gone");
  });

  it("cascades the unpublish into the projection when the record is deleted", async () => {
    const tenantId = crypto.randomUUID();
    const stub = env.TENANT_DO.get(env.TENANT_DO.idFromName(tenantId));
    const recordId = uuid(502);

    await stub.registerContentType(articleType(), auth("owner1"));
    await stub.writeRecord("article", { recordId, input: validArticleInput() }, auth("owner1"));
    await stub.publishRecord(tenantId, recordId, auth("owner1"));
    await waitFor(() =>
      env.PROJECTION_DB.prepare(
        "SELECT record_id FROM projected_records WHERE tenant_id = ? AND record_id = ?",
      )
        .bind(tenantId, recordId)
        .first<{ record_id: string }>(),
    );

    await stub.deleteRecord(recordId, auth("owner1"));
    const gone = await waitFor(async () => {
      const row = await env.PROJECTION_DB.prepare(
        "SELECT record_id FROM projected_records WHERE tenant_id = ? AND record_id = ?",
      )
        .bind(tenantId, recordId)
        .first<{ record_id: string }>();
      return row === null ? "gone" : null;
    });
    expect(gone).toBe("gone");
  });
});
```

- [ ] **Step 2: テストを実行**

Run: `pnpm --filter @plyrs/api test -- test/projection-e2e.test.ts`
Expected: PASS（3 tests）

失敗する場合、原因は「producer バインディング名 / キュー名 / consumer 登録」の配線ミスである可能性が高い（unit テストは `worker.queue` を直接呼ぶのでブローカを通らない）。`wrangler.jsonc` の `producers[].queue` と `consumers[].queue` が同じ文字列であることを確認すること。

- [ ] **Step 3: 全体検証**

Run（リポジトリルート）:
```bash
pnpm lint && pnpm format:check && pnpm typecheck && pnpm test
```
Expected: すべて PASS。テスト総数は 236（Phase 4b 時点）+ 本 Phase の新規分。**出力をそのままレポートに貼ること**。

- [ ] **Step 4: ロードマップを更新**

`docs/superpowers/plans/2026-07-12-implementation-roadmap.md`:

1. 計画ファイル表に行を追加: `| 5a | \`2026-07-13-phase5a-publish-projection.md\` | 完了（2026-07-13 main へマージ） |`
2. 末尾に「## 9. Phase 5a 完了時の申し送り」を追加し、最低限次を書く:
   - **Phase 5b（公開 read API）への申し送り**: 投影 3 テーブルの物理形（`projected_records` の PK は `(tenant_id, record_id)`、slug は `(tenant_id, type, slug)` 索引で引く）/ `projection_index` は「フィルタで record_id を絞る」用途に限る（復元に使わない）/ 複数値 select は行分割で any-of 意味論・**ソートは単一値フィールドのみ**/ 公開経路の関係解決は `projected_relations` に対してのみ行い、参照先が未公開なら不在として扱う / 公開パスは `/public/v1/:tenantSlug/...`（tenantSlug → tenantId はコントロールプレーン D1 + KV キャッシュ、DO 非経由）。
   - **G3 / G4 の確定内容**（本計画の裁定表をそのまま転記）。
   - **未解決 / 将来対応**: DLQ 未設定（`max_retries: 3` 超過でメッセージは失われる。Phase 10 の運用整備で DLQ + 監視を入れる）/ `snapshotEmbed: "value"` 未実装（Phase 8）/ 「archived かつ公開中」の健全性チェック（Phase 10）/ 再投影は 1 ページずつ自己連鎖する設計であり、途中で失敗すると sweep が走らず古い行が残る（再実行で回復する）。
   - **Phase 9（モジュール）への申し送り**: alarm レジストリ（`alarm_registry(kind, due_at)`）は既に多重化されており、`kind` を `module_id` に読み替えるだけで汎用化できる。`TenantDO.alarm()` のディスパッチ分岐だけがシステム固有。

- [ ] **Step 5: コミット**

```bash
git add apps/api/test/projection-e2e.test.ts docs/superpowers/plans
git commit -m "test: prove the publish path reaches the projection through the real queue"
```

---

## セルフレビュー（計画作成者による確認）

**仕様カバレッジ:**

| design-spec | 対応タスク |
|-------------|-----------|
| §7 published_snapshots / publish / unpublish | Task 2, 4 |
| §7 公開状態の真実源 = snapshot 行の存在（records に公開フラグを持たない） | Task 2, 4 |
| §9.6 alarm 多重化レジストリ（コア実装） | Task 2, 6 |
| §12.2 投影 3 テーブル + tenant_id + 型別 index 値 | Task 1, 3 |
| §12.2 slug 昇格（G4） | Task 3 |
| §12.3 アウトボックス + Queues consumer + 冪等 upsert | Task 4, 5 |
| §12.3 順序逆転ガード（upsert / delete 双方） | Task 5 |
| §12.3 3 テーブル更新の原子性（D1 batch） | Task 5 |
| §12.3 sweeper（コミットの事実に依存する排出保証） | Task 6 |
| §12.3b 再投影ジョブ（乖離復旧 + indexed 後付けバックフィル） | Task 7 |

**Phase 5b に残るもの**: §12.4 公開クエリ語彙 / §12.5 公開経路の関係解決 / §12.6 キャッシュ / G3 テナント解決。

**型の一貫性**: `ProjectionPayload` / `PublishedSnapshot` / `ProjectionJob` は Task 3・5 で定義し、Task 4・6・7 が同じ名前で参照する。`deleteRecordCore` の deps は Task 4 で `DeleteDeps`（`newId` 追加）に変わり、呼び出し元は `tenant-do.ts` のみ。
