# Phase 2: テナント DO 書き込み経路 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** テナント Durable Object（SQLite backend）のコンテンツ書き込み経路 — content_type 登録（indexed 宣言の generated column DDL 込み）、record の validate-on-write、version / field_versions / seq の帳簿、relations 再投影、unique システムフック、トゥームストーン削除 — を vitest-pool-workers で検証可能な形で実装する。

**Architecture:** `packages/db` が Drizzle スキーマとマイグレーションを持ち、`apps/api` が TenantDO（RPC メソッド群）とその純関数コアを持つ。変異はすべて `ctx.storage.transactionSync` 内の同期 raw SQL（原子性）、マイグレーションと単発読み取りは Drizzle。ドメインロジックは `SqlStorage` を受け取る純関数（`src/do/*.ts`）に置き、DO クラスは配線に徹する。検証は @cloudflare/vitest-pool-workers（workerd 上で DO 実体を起動、RPC + `runInDurableObject` で観察）。

**Tech Stack:** Drizzle ORM 0.45（durable-sqlite）/ drizzle-kit 0.31 / wrangler 4.110 / @cloudflare/vitest-pool-workers 0.18（vitest 4.1）/ uuid v7 / @plyrs/metamodel（Phase 1 成果物）

## Global Constraints

- 新規依存はすべて catalog 経由: `drizzle-orm ^0.45.2` / `drizzle-kit ^0.31.10` / `wrangler ^4.110.0` / `@cloudflare/vitest-pool-workers ^0.18.4` / `@cloudflare/workers-types ^5.20260712.1` / `uuid ^14.0.1`（既存: zod ^4.4.3 / vitest ^4.1.10 / typescript ~7.0.2 / @types/node ^26.1.1）
- **vitest-pool-workers 0.18 系の現行 API**: vitest.config は `cloudflareTest()` Vite プラグイン + `defineConfig`（旧 `defineWorkersConfig` / `defineWorkersProject` は廃止）。テストの `env` は **`cloudflare:workers`** から、`runInDurableObject` は `cloudflare:test` から import する
- wrangler.jsonc: `compatibility_date: "2026-07-12"`、DO は `new_sqlite_classes`。RPC はこの compat date で自動有効（追加設定不要）
- **変異系**（records / relations / content_types の書き込み、DDL）は `this.ctx.storage.transactionSync(() => ...)` 内の同期 `sql.exec` で行う。マイグレーションと読み取りは Drizzle / 生 SQL どちらでも可
- ID は小文字 UUID（metamodel の `uuidSchema` が検証）。DO 内でのサーバー生成は `uuid` パッケージの `v7()`
- **required は非空（G7 裁定 2026-07-12）**: required の text は `.min(1)`、required の many-relation / multiple-select は要素≥1。Task 1 で metamodel に適用する
- record の `data` は relation フィールドを含まない（`splitRecordInput` が分離、design-spec §6）。relations は派生データであり、書き込みのたびに該当 record の全 relation フィールドを削除→再挿入で**再投影**する
- `version` は**適用された**書き込みごとに +1。`field_versions` は**変更された**フィールドのみ +1。変更ゼロの書き込みは適用せず `applied: false` を返す（決定: 「受理したあらゆる書き込みで+1」は「適用された書き込み」と解釈する）
- `seq` は DO 全体で単調増加（G2 先置き。同期チェックポイントの基盤）。ロールバック時の欠番は許容
- 削除は**トゥームストーン**（`deleted_at` セット + relations 行削除）。物理削除しない
- RPC の引数・戻り値は structured-cloneable な plain object。ドメイン失敗は throw ではなく `{ ok: false, code, message }` を返す
- ストレージ分離は**テストファイル単位**のため、テストごとに DO 名をランダム化する: `env.TENANT_DO.get(env.TENANT_DO.idFromName(crypto.randomUUID()))`
- **各タスクのコミット前に `pnpm format` を実行**し、コミット後のツリーで `pnpm format:check` が exit 0 になる状態を保つ（Phase 1 の Critical 再発防止）。`pnpm lint` は警告ゼロ
- TDD 必須（RED を確認してから GREEN）

**既知の不確定要素（実装者向け・遭遇時の対処）:**

1. **モノレポの `.ts` 直接 exports が workerd バンドルを通るか**は公式実例が未確認（調査結果 UNCONFIRMED）。Task 3 のスモークテストが最初に検証する。通らなければ BLOCKED で報告（対処はコントローラが判断）。
2. `@plyrs/db/migrations`（drizzle-kit 生成の `migrations.js`）の**型宣言は手書き**（Task 2）。生成物の形が宣言と違ったら、実際の形に合わせて `migrations.d.ts` を直し、報告に明記。
3. tsc が `cloudflare:workers` モジュールを解決できない場合、`apps/api/tsconfig.json` の `types` の `"@cloudflare/workers-types"` を `"@cloudflare/workers-types/experimental"` に差し替える（それでも駄目なら BLOCKED）。
4. oxfmt が `wrangler.jsonc` を扱えず format:check が落ちる場合は `.oxfmtignore` に `wrangler.jsonc` を追加してよい（ツールスキャン除外の既存方針に従う。コメントを1行添える）。

## ファイル構成（このフェーズで確定する形）

```
packages/db/
  package.json            # @plyrs/db。exports: "." → src/index.ts, "./migrations" → drizzle/migrations.js
  tsconfig.json
  vitest.config.ts
  drizzle.config.ts       # dialect sqlite / driver durable-sqlite / out ./drizzle
  drizzle/                # drizzle-kit generate の出力（コミットする）+ 手書き migrations.d.ts
  src/schema.ts           # DO コア3テーブル（content_types / records / relations）
  src/index.ts            # schema 再エクスポート
  src/schema.test.ts
apps/api/
  package.json            # @plyrs/api
  tsconfig.json
  wrangler.jsonc          # TenantDO バインディング + new_sqlite_classes
  vitest.config.ts        # cloudflareTest プラグイン
  env.d.ts                # Env と ProvidedEnv
  src/index.ts            # Worker エントリ（TenantDO export + 501 fetch）
  src/tenant-do.ts        # TenantDO クラス（配線のみ）
  src/do/types.ts         # RecordSnapshot / WriteRecordParams / WriteRecordResult
  src/do/content-types.ts # 登録・取得コア（純関数）
  src/do/index-ddl.ts     # indexed 宣言 → generated column DDL
  src/do/diff.ts          # jsonDeepEqual / computeChangeSet（純関数）
  src/do/write-record.ts  # 書き込み経路コア（純関数）
  src/do/hooks.ts         # beforeWrite フックパイプライン
  src/do/unique-check.ts  # unique システムフック
  src/do/delete-record.ts # トゥームストーン削除コア
  test/fixtures.ts
  test/smoke.test.ts
  test/content-types.test.ts
  test/index-ddl.test.ts
  test/diff.test.ts
  test/write-record.test.ts
  test/unique.test.ts
  test/delete.test.ts
```

---

### Task 1: metamodel — required の非空強制（G7 適用）

**Files:**
- Modify: `packages/metamodel/src/record-schema.ts`（`buildFieldValueSchema` の text / select / relation 分岐）
- Test: `packages/metamodel/src/record-schema.test.ts`（追記）
- Test: `packages/metamodel/src/tolerant-read.test.ts`（追記1件）

**Interfaces:**
- Consumes: 既存の `buildFieldValueSchema(field)` / `buildRecordInputSchema(contentType)`
- Produces: シグネチャ不変。挙動変更のみ — `field.required === true` のとき text は `.min(1)`、many-relation / multiple-select は `.min(1)` 配列。寛容 read（`tolerantReadData`）は `buildFieldValueSchema` 経由で自動的に「required の空値 = invalidKeys」となる

- [ ] **Step 1: 失敗するテストを書く**

`packages/metamodel/src/record-schema.test.ts` の `articleType` fixture の `fields` 配列に、optional text を1つ追加する（`title` の直後）:

```ts
    { key: "subtitle", type: "text" },
```

同ファイルの `describe("buildRecordInputSchema", ...)` 内に4テストを追加:

```ts
  it("rejects an empty string for a required text field (G7)", () => {
    const result = buildRecordInputSchema(articleType).safeParse({
      ...validInput,
      title: "",
    });
    expect(result.success).toBe(false);
  });

  it("accepts an empty string for an optional text field", () => {
    const result = buildRecordInputSchema(articleType).safeParse({
      ...validInput,
      subtitle: "",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an empty array for a required many-relation (G7)", () => {
    const result = buildRecordInputSchema(articleType).safeParse({
      ...validInput,
      authors: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects an empty array for a required multiple-select (G7)", () => {
    const surveyType: ContentTypeDefinition = {
      id: "018f2b6a-7a0a-7000-8000-000000000009",
      key: "survey",
      name: "調査",
      source: "user",
      version: 1,
      fields: [
        {
          key: "topics",
          type: "select",
          required: true,
          config: { options: [{ value: "a", label: "A" }], multiple: true },
        },
      ],
    };
    expect(buildRecordInputSchema(surveyType).safeParse({ topics: [] }).success).toBe(false);
    expect(buildRecordInputSchema(surveyType).safeParse({ topics: ["a"] }).success).toBe(true);
  });
```

`packages/metamodel/src/tolerant-read.test.ts` の describe 内に1テスト追加:

```ts
  it("reports an empty required text value as invalid (G7 semantics)", () => {
    const result = tolerantReadData(articleType, { title: "" });
    expect(result.values).toEqual({});
    expect(result.invalidKeys).toEqual(["title"]);
  });
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm --filter @plyrs/metamodel test`
Expected: FAIL — G7 系4テスト（required 空文字 / 空配列を現状は受理してしまう）と tolerant-read の1テストが落ちる。optional text のテストは通る

- [ ] **Step 3: 実装（buildFieldValueSchema の3分岐を変更）**

`packages/metamodel/src/record-schema.ts` の `buildFieldValueSchema` を次のとおり変更する。

text 分岐（変更前 → 変更後）:

```ts
    case "text": {
      const maxLength = field.config?.maxLength;
      // G7 (2026-07-12 決定): required の text は空文字を拒否する
      let schema = field.required ? z.string().min(1) : z.string();
      if (maxLength !== undefined) {
        schema = schema.max(maxLength);
      }
      return schema;
    }
```

select 分岐の return 行:

```ts
      const multi = z.array(single);
      // G7: required の multiple-select は空配列を拒否する
      return field.config.multiple ? (field.required ? multi.min(1) : multi) : single;
```

relation 分岐の return 行:

```ts
      const many = z.array(ref);
      // G7: required の many-relation は空配列を拒否する
      return field.config.cardinality === "many" ? (field.required ? many.min(1) : many) : ref;
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm --filter @plyrs/metamodel test` → 全件 PASS（46件目安）
Run: `pnpm --filter @plyrs/metamodel typecheck` → エラーなし

- [ ] **Step 5: フォーマットとコミット**

```bash
pnpm format
git add packages/metamodel/src/record-schema.ts packages/metamodel/src/record-schema.test.ts packages/metamodel/src/tolerant-read.test.ts
git commit -m "feat: enforce non-empty values for required fields (G7)"
```

---

### Task 2: @plyrs/db — DO コア3テーブルの Drizzle スキーマとマイグレーション

**Files:**
- Modify: `pnpm-workspace.yaml`（catalog 追記）
- Create: `packages/db/package.json` / `tsconfig.json` / `vitest.config.ts` / `drizzle.config.ts`
- Create: `packages/db/src/schema.ts` / `src/index.ts`
- Create: `packages/db/drizzle/migrations.d.ts`（手書き型宣言。`drizzle-kit generate` の出力と同居）
- Test: `packages/db/src/schema.test.ts`

**Interfaces:**
- Consumes: catalog（drizzle-orm / drizzle-kit）
- Produces: `@plyrs/db` から `contentTypes` / `records` / `relations`（sqliteTable）、`@plyrs/db/migrations` から drizzle-kit 生成のマイグレーションバンドル（default export）。Task 3 の TenantDO が `migrate(db, migrations)` に渡す

- [ ] **Step 1: catalog に新規依存を追記**

`pnpm-workspace.yaml` の `catalog:` に追記（既存4行は維持）:

```yaml
  drizzle-orm: "^0.45.2"
  drizzle-kit: "^0.31.10"
  wrangler: "^4.110.0"
  "@cloudflare/vitest-pool-workers": "^0.18.4"
  "@cloudflare/workers-types": "^5.20260712.1"
  uuid: "^14.0.1"
```

- [ ] **Step 2: パッケージ設定4ファイルを書く**

`packages/db/package.json`:

```json
{
  "name": "@plyrs/db",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./migrations": "./drizzle/migrations.js"
  },
  "scripts": {
    "generate": "drizzle-kit generate",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "drizzle-orm": "catalog:"
  },
  "devDependencies": {
    "@types/node": "catalog:",
    "drizzle-kit": "catalog:",
    "typescript": "catalog:",
    "vitest": "catalog:"
  }
}
```

`packages/db/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src", "drizzle.config.ts", "vitest.config.ts"]
}
```

`packages/db/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
  },
});
```

`packages/db/drizzle.config.ts`:

```ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  out: "./drizzle",
  schema: "./src/schema.ts",
  dialect: "sqlite",
  driver: "durable-sqlite",
});
```

- [ ] **Step 3: 失敗するテストを書く**

`packages/db/src/schema.test.ts`:

```ts
import { getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { contentTypes, records, relations } from "./schema";

describe("@plyrs/db schema", () => {
  it("defines the three DO core tables from design-spec §6", () => {
    expect(getTableName(contentTypes)).toBe("content_types");
    expect(getTableName(records)).toBe("records");
    expect(getTableName(relations)).toBe("relations");
  });

  it("gives records the sync bookkeeping columns (seq / field_versions / deleted_at)", () => {
    expect(records.seq).toBeDefined();
    expect(records.fieldVersions).toBeDefined();
    expect(records.deletedAt).toBeDefined();
  });
});
```

- [ ] **Step 4: テストが失敗することを確認**

Run: `pnpm install && pnpm --filter @plyrs/db test`
Expected: FAIL — `Cannot find module './schema'`

- [ ] **Step 5: スキーマを書く**

`packages/db/src/schema.ts`:

```ts
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
```

`packages/db/src/index.ts`:

```ts
export { contentTypes, records, relations } from "./schema";
```

- [ ] **Step 6: テストが通ることを確認**

Run: `pnpm --filter @plyrs/db test` → PASS（2件）
Run: `pnpm --filter @plyrs/db typecheck` → エラーなし

- [ ] **Step 7: マイグレーションを生成し、型宣言を添える**

Run: `pnpm --filter @plyrs/db generate`
Expected: `packages/db/drizzle/` に SQL ファイル・`meta/` に加えて **`migrations.js`**（journal + SQL を埋め込んだバンドル）が生成される。`ls packages/db/drizzle` で確認。

`packages/db/drizzle/migrations.d.ts`（手書き。生成物の形が異なる場合は実物に合わせて修正し報告に明記）:

```ts
// drizzle-kit generate (driver: durable-sqlite) が出力する migrations.js の手書き型宣言。
// drizzle-orm/durable-sqlite/migrator の migrate() に渡すためだけの形。
interface DurableSqliteMigrations {
  journal: {
    entries: Array<{ idx: number; when: number; tag: string; breakpoints: boolean }>;
  };
  migrations: Record<string, string>;
}
declare const migrations: DurableSqliteMigrations;
export default migrations;
```

- [ ] **Step 8: フォーマットとコミット**

```bash
pnpm format
git add pnpm-workspace.yaml pnpm-lock.yaml packages/db
git commit -m "feat: add @plyrs/db with DO core schema and durable-sqlite migrations"
```

---

### Task 3: apps/api スキャフォールド + TenantDO 起動スモーク

**Files:**
- Create: `apps/api/package.json` / `tsconfig.json` / `wrangler.jsonc` / `vitest.config.ts` / `env.d.ts`
- Create: `apps/api/src/index.ts` / `src/tenant-do.ts`
- Test: `apps/api/test/smoke.test.ts`

**Interfaces:**
- Consumes: `@plyrs/db`（schema / migrations）、`@plyrs/metamodel`（contentTypeDefinitionSchema — バンドル検証を兼ねる）
- Produces: `TenantDO` クラス（`ping(): string`、`validateContentTypeInput(input: unknown): { valid: boolean }`）と `Env`（`TENANT_DO: DurableObjectNamespace<TenantDO>`）。以降のタスクは TenantDO にメソッドを追加していく

- [ ] **Step 1: パッケージ設定5ファイルを書く**

`apps/api/package.json`:

```json
{
  "name": "@plyrs/api",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@plyrs/db": "workspace:*",
    "@plyrs/metamodel": "workspace:*",
    "drizzle-orm": "catalog:",
    "uuid": "catalog:",
    "zod": "catalog:"
  },
  "devDependencies": {
    "@cloudflare/vitest-pool-workers": "catalog:",
    "@cloudflare/workers-types": "catalog:",
    "typescript": "catalog:",
    "vitest": "catalog:",
    "wrangler": "catalog:"
  }
}
```

`apps/api/wrangler.jsonc`（コメントなしの純 JSON で書く — oxfmt 互換のため）:

```jsonc
{
  "name": "plyrs-api",
  "main": "src/index.ts",
  "compatibility_date": "2026-07-12",
  "durable_objects": {
    "bindings": [{ "name": "TENANT_DO", "class_name": "TenantDO" }]
  },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["TenantDO"] }]
}
```

`apps/api/vitest.config.ts`:

```ts
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: "./wrangler.jsonc" } })],
  test: {
    include: ["test/**/*.test.ts", "src/**/*.test.ts"],
  },
});
```

`apps/api/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "types": ["@cloudflare/workers-types", "@cloudflare/vitest-pool-workers/types"]
  },
  "include": ["src", "test", "env.d.ts", "vitest.config.ts"]
}
```

（tsc が `cloudflare:workers` を解決できない場合は既知の不確定要素3の手順で `/experimental` に差し替え）

`apps/api/env.d.ts`:

```ts
interface Env {
  TENANT_DO: DurableObjectNamespace<import("./src/tenant-do").TenantDO>;
}

declare module "cloudflare:workers" {
  interface ProvidedEnv extends Env {}
}
```

- [ ] **Step 2: 失敗するテストを書く**

`apps/api/test/smoke.test.ts`:

```ts
import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { TenantDO } from "../src/tenant-do";

// ストレージ分離はテストファイル単位のため、テストごとに DO 名を変えて独立させる
function freshStub() {
  return env.TENANT_DO.get(env.TENANT_DO.idFromName(crypto.randomUUID()));
}

describe("TenantDO smoke", () => {
  it("answers ping over RPC", async () => {
    expect(await freshStub().ping()).toBe("pong");
  });

  it("runs migrations on construction (core tables exist)", async () => {
    const stub = freshStub();
    await stub.ping();
    await runInDurableObject(stub, async (instance, state) => {
      expect(instance).toBeInstanceOf(TenantDO);
      const tables = state.storage.sql
        .exec<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        .toArray()
        .map((row) => row.name);
      expect(tables).toEqual(expect.arrayContaining(["content_types", "records", "relations"]));
    });
  });

  it("bundles @plyrs/metamodel into the DO (monorepo TS exports probe)", async () => {
    const result = await freshStub().validateContentTypeInput({ nonsense: true });
    expect(result).toEqual({ valid: false });
  });
});
```

- [ ] **Step 3: テストが失敗することを確認**

Run: `pnpm install && pnpm --filter @plyrs/api test`
Expected: FAIL — `../src/tenant-do` が存在しない（解決エラー）

- [ ] **Step 4: TenantDO と Worker エントリを書く**

`apps/api/src/tenant-do.ts`:

```ts
import { DurableObject } from "cloudflare:workers";
import { drizzle, type DrizzleSqliteDODatabase } from "drizzle-orm/durable-sqlite";
import { migrate } from "drizzle-orm/durable-sqlite/migrator";
import * as schema from "@plyrs/db";
import migrations from "@plyrs/db/migrations";
import { contentTypeDefinitionSchema } from "@plyrs/metamodel";

export class TenantDO extends DurableObject<Env> {
  private readonly db: DrizzleSqliteDODatabase<typeof schema>;
  // DO 全体の単調 seq（G2）。single-writer なのでメモリ保持 + 起動時復元で十分
  private seq = 0;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.db = drizzle(ctx.storage, { schema });
    ctx.blockConcurrencyWhile(async () => {
      await migrate(this.db, migrations);
      const row = ctx.storage.sql
        .exec<{ max_seq: number | null }>("SELECT MAX(seq) AS max_seq FROM records")
        .one();
      this.seq = row.max_seq ?? 0;
    });
  }

  ping(): string {
    return "pong";
  }

  // モノレポの .ts 直接 exports が workerd バンドルを通ることの早期検証を兼ねる
  validateContentTypeInput(input: unknown): { valid: boolean } {
    return { valid: contentTypeDefinitionSchema.safeParse(input).success };
  }
}
```

`apps/api/src/index.ts`:

```ts
export { TenantDO } from "./tenant-do";

export default {
  async fetch(): Promise<Response> {
    return new Response("plyrs api: not yet implemented", { status: 501 });
  },
} satisfies ExportedHandler<Env>;
```

- [ ] **Step 5: テストが通ることを確認**

Run: `pnpm --filter @plyrs/api test` → PASS（3件）
Run: `pnpm --filter @plyrs/api typecheck` → エラーなし
Run: `pnpm typecheck && pnpm test` → 全パッケージ green

- [ ] **Step 6: フォーマットとコミット**

```bash
pnpm format
git add pnpm-lock.yaml apps/api
git commit -m "feat: scaffold apps/api with TenantDO bootstrap and workerd smoke tests"
```

（`.oxfmtignore` に追記した場合はそれも含める）

---

### Task 4: content_type 登録・取得 RPC

**Files:**
- Create: `apps/api/src/do/content-types.ts`
- Modify: `apps/api/src/tenant-do.ts`（メソッド追加）
- Create: `apps/api/test/fixtures.ts`
- Test: `apps/api/test/content-types.test.ts`

**Interfaces:**
- Consumes: `contentTypeDefinitionSchema` / `ContentTypeDefinition` / `FieldDefinition`（metamodel）
- Produces:
  - `interface ContentTypeRow { id; key; name; fields: FieldDefinition[]; source: "user"|"plugin"|"system"; pluginId: string|null; createdAt; updatedAt; version: number }`
  - `loadContentTypeByKey(sql: SqlStorage, key: string): ContentTypeRow | null`
  - `rowToDefinition(row: ContentTypeRow): ContentTypeDefinition`
  - `registerContentTypeCore(sql: SqlStorage, input: unknown, now: string): RegisterContentTypeResult`
  - `type RegisterContentTypeResult = { ok: true; contentType: ContentTypeRow } | { ok: false; code: "validation_failed" | "id_mismatch"; message: string }`
  - TenantDO RPC: `registerContentType(input: unknown)` / `getContentType(key: string): ContentTypeRow | null`

- [ ] **Step 1: fixture を書く**

`apps/api/test/fixtures.ts`:

```ts
import type { ContentTypeDefinition } from "@plyrs/metamodel";

// 16進数字のみで構成される決定的な小文字 UUID（v7 形式）
export function uuid(n: number): string {
  return `018f2b6a-7a0a-7000-8000-${n.toString().padStart(12, "0")}`;
}

export function articleType(): ContentTypeDefinition {
  return {
    id: uuid(1),
    key: "article",
    name: "記事",
    source: "user",
    version: 1,
    fields: [
      { key: "title", type: "text", required: true, config: { maxLength: 200 } },
      { key: "slug", type: "text", required: true, config: { unique: true, indexed: true } },
      { key: "published_at", type: "datetime", config: { indexed: true } },
      {
        key: "tags",
        type: "select",
        config: {
          options: [
            { value: "tech", label: "Tech" },
            { value: "life", label: "Life" },
          ],
          multiple: true,
        },
      },
      { key: "body", type: "richtext" },
      {
        key: "authors",
        type: "relation",
        required: true,
        config: { allowedTypes: ["author"], cardinality: "many", ordered: true },
      },
      { key: "hero", type: "relation", config: { allowedTypes: ["asset"], cardinality: "one" } },
    ],
  };
}

export function validArticleInput(): Record<string, unknown> {
  return {
    title: "こんにちは",
    slug: "hello",
    published_at: "2026-07-12T00:00:00Z",
    tags: ["tech"],
    body: { schemaVersion: 1, doc: { type: "doc", content: [] } },
    authors: [
      { type: "author", id: uuid(2) },
      { type: "author", id: uuid(3) },
    ],
    hero: { type: "asset", id: uuid(4) },
  };
}
```

- [ ] **Step 2: 失敗するテストを書く**

`apps/api/test/content-types.test.ts`:

```ts
import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { articleType, uuid } from "./fixtures";

function freshStub() {
  return env.TENANT_DO.get(env.TENANT_DO.idFromName(crypto.randomUUID()));
}

describe("content type registration", () => {
  it("registers a valid user type with server-managed version 1", async () => {
    const stub = freshStub();
    const result = await stub.registerContentType(articleType());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.contentType.version).toBe(1);
      expect(result.contentType.key).toBe("article");
    }
  });

  it("persists the row and returns parsed fields via getContentType", async () => {
    const stub = freshStub();
    await stub.registerContentType(articleType());
    const row = await stub.getContentType("article");
    expect(row?.name).toBe("記事");
    expect(row?.fields.map((f) => f.key)).toContain("slug");
    await runInDurableObject(stub, async (_instance, state) => {
      const stored = state.storage.sql
        .exec<{ key: string; version: number }>("SELECT key, version FROM content_types")
        .one();
      expect(stored).toEqual({ key: "article", version: 1 });
    });
  });

  it("bumps the version when re-registering the same type (same id)", async () => {
    const stub = freshStub();
    await stub.registerContentType(articleType());
    const next = articleType();
    next.name = "記事（改）";
    const result = await stub.registerContentType(next);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.contentType.version).toBe(2);
      expect(result.contentType.name).toBe("記事（改）");
    }
  });

  it("rejects a re-register under the same key with a different id", async () => {
    const stub = freshStub();
    await stub.registerContentType(articleType());
    const impostor = { ...articleType(), id: uuid(99) };
    const result = await stub.registerContentType(impostor);
    expect(result).toMatchObject({ ok: false, code: "id_mismatch" });
  });

  it("rejects an invalid definition (duplicate field keys)", async () => {
    const stub = freshStub();
    const bad = articleType();
    bad.fields = [
      { key: "title", type: "text" },
      { key: "title", type: "number" },
    ];
    const result = await stub.registerContentType(bad);
    expect(result).toMatchObject({ ok: false, code: "validation_failed" });
  });

  it("accepts a namespaced plugin type and returns null for unknown keys", async () => {
    const stub = freshStub();
    const pluginType = {
      ...articleType(),
      id: uuid(5),
      key: "booking.slot",
      source: "plugin" as const,
      pluginId: "booking",
    };
    const result = await stub.registerContentType(pluginType);
    expect(result.ok).toBe(true);
    expect(await stub.getContentType("no_such_type")).toBeNull();
  });
});
```

- [ ] **Step 3: テストが失敗することを確認**

Run: `pnpm --filter @plyrs/api test`
Expected: FAIL — `stub.registerContentType is not a function`（RPC メソッド未定義）系のエラー

- [ ] **Step 4: コアと配線を書く**

`apps/api/src/do/content-types.ts`:

```ts
import {
  contentTypeDefinitionSchema,
  type ContentTypeDefinition,
  type FieldDefinition,
} from "@plyrs/metamodel";
import type { z } from "zod";

export interface ContentTypeRow {
  id: string;
  key: string;
  name: string;
  fields: FieldDefinition[];
  source: "user" | "plugin" | "system";
  pluginId: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export type RegisterContentTypeResult =
  | { ok: true; contentType: ContentTypeRow }
  | { ok: false; code: "validation_failed" | "id_mismatch"; message: string };

interface RawContentTypeRow {
  id: string;
  key: string;
  name: string;
  fields: string;
  source: string;
  plugin_id: string | null;
  created_at: string;
  updated_at: string;
  version: number;
}

export function issuesToMessage(issues: z.core.$ZodIssue[]): string {
  return issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
}

export function loadContentTypeByKey(sql: SqlStorage, key: string): ContentTypeRow | null {
  const row = sql
    .exec<RawContentTypeRow>("SELECT * FROM content_types WHERE key = ?", key)
    .toArray()[0];
  if (row === undefined) {
    return null;
  }
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    fields: JSON.parse(row.fields) as FieldDefinition[],
    source: row.source as ContentTypeRow["source"],
    pluginId: row.plugin_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: row.version,
  };
}

export function rowToDefinition(row: ContentTypeRow): ContentTypeDefinition {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    fields: row.fields,
    source: row.source,
    pluginId: row.pluginId ?? undefined,
    version: row.version,
  };
}

export function registerContentTypeCore(
  sql: SqlStorage,
  input: unknown,
  now: string,
): RegisterContentTypeResult {
  const parsed = contentTypeDefinitionSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: "validation_failed", message: issuesToMessage(parsed.error.issues) };
  }
  const def = parsed.data;
  const prev = loadContentTypeByKey(sql, def.key);
  if (prev !== null && prev.id !== def.id) {
    return {
      ok: false,
      code: "id_mismatch",
      message: `type key '${def.key}' is already registered with a different id`,
    };
  }
  // version はサーバー管理（入力の version は無視する）
  const version = prev === null ? 1 : prev.version + 1;
  const fieldsJson = JSON.stringify(def.fields);
  if (prev === null) {
    sql.exec(
      "INSERT INTO content_types (id, key, name, fields, source, plugin_id, created_at, updated_at, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      def.id,
      def.key,
      def.name,
      fieldsJson,
      def.source,
      def.pluginId ?? null,
      now,
      now,
      version,
    );
  } else {
    sql.exec(
      "UPDATE content_types SET name = ?, fields = ?, source = ?, plugin_id = ?, updated_at = ?, version = ? WHERE id = ?",
      def.name,
      fieldsJson,
      def.source,
      def.pluginId ?? null,
      now,
      version,
      def.id,
    );
  }
  return {
    ok: true,
    contentType: {
      id: def.id,
      key: def.key,
      name: def.name,
      fields: def.fields,
      source: def.source,
      pluginId: def.pluginId ?? null,
      createdAt: prev?.createdAt ?? now,
      updatedAt: now,
      version,
    },
  };
}
```

`apps/api/src/tenant-do.ts` — import に追記し、クラスにメソッドを追加:

```ts
import {
  loadContentTypeByKey,
  registerContentTypeCore,
  type ContentTypeRow,
  type RegisterContentTypeResult,
} from "./do/content-types";
```

```ts
  registerContentType(input: unknown): RegisterContentTypeResult {
    const now = new Date().toISOString();
    return this.ctx.storage.transactionSync(() =>
      registerContentTypeCore(this.ctx.storage.sql, input, now),
    );
  }

  getContentType(key: string): ContentTypeRow | null {
    return loadContentTypeByKey(this.ctx.storage.sql, key);
  }
```

- [ ] **Step 5: テストが通ることを確認**

Run: `pnpm --filter @plyrs/api test` → PASS（9件）
Run: `pnpm --filter @plyrs/api typecheck` → エラーなし
（`issuesToMessage` の `z.core.$ZodIssue` 型が Zod v4 で異なる場合は `parsed.error.issues` の実型に合わせ、変更内容を報告に明記）

- [ ] **Step 6: フォーマットとコミット**

```bash
pnpm format
git add apps/api/src/do/content-types.ts apps/api/src/tenant-do.ts apps/api/test/fixtures.ts apps/api/test/content-types.test.ts
git commit -m "feat: add content type registration and lookup to TenantDO"
```

---

### Task 5: indexed 宣言 → generated column DDL

**Files:**
- Create: `apps/api/src/do/index-ddl.ts`
- Modify: `apps/api/src/do/content-types.ts`（registerContentTypeCore に DDL 適用を追加）
- Test: `apps/api/test/index-ddl.test.ts`

**Interfaces:**
- Consumes: `FieldDefinition`（metamodel）、`SqlStorage`
- Produces:
  - `indexedColumns(fields: FieldDefinition[]): IndexedColumn[]`（`{ fieldKey: string; columnType: "TEXT"|"NUMERIC"|"INTEGER" }`）
  - `computeIndexDdlDiff(prev: FieldDefinition[] | null, next: FieldDefinition[]): { add: IndexedColumn[]; drop: IndexedColumn[] }`
  - `generatedColumnName(typeKey: string, fieldKey: string): string`（`g_<typeKey('.'→'__')>_<fieldKey>`）
  - `applyIndexDdl(sql: SqlStorage, typeKey: string, prev: FieldDefinition[] | null, next: FieldDefinition[]): void`

昇格対象は**単一値フィールドのみ**（text / number / boolean / datetime / 単一 select で `indexed: true`）。multiple select の配列は行分割が必要なため DO 側索引の対象外（公開側の projection_index が担う — design-spec §12.2）。

- [ ] **Step 1: 失敗するテストを書く**

`apps/api/test/index-ddl.test.ts`:

```ts
import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import type { FieldDefinition } from "@plyrs/metamodel";
import {
  computeIndexDdlDiff,
  generatedColumnName,
  indexedColumns,
} from "../src/do/index-ddl";
import { articleType } from "./fixtures";

function freshStub() {
  return env.TENANT_DO.get(env.TENANT_DO.idFromName(crypto.randomUUID()));
}

describe("indexedColumns / computeIndexDdlDiff (pure)", () => {
  it("promotes only single-valued indexed fields with type-mapped columns", () => {
    const fields: FieldDefinition[] = [
      { key: "slug", type: "text", config: { indexed: true } },
      { key: "views", type: "number", config: { indexed: true } },
      { key: "featured", type: "boolean", config: { indexed: true } },
      { key: "published_at", type: "datetime", config: { indexed: true } },
      {
        key: "category",
        type: "select",
        config: { options: [{ value: "a", label: "A" }], indexed: true },
      },
      {
        key: "tags",
        type: "select",
        config: { options: [{ value: "a", label: "A" }], multiple: true, indexed: true },
      },
      { key: "plain", type: "text" },
      { key: "body", type: "richtext" },
    ];
    expect(indexedColumns(fields)).toEqual([
      { fieldKey: "slug", columnType: "TEXT" },
      { fieldKey: "views", columnType: "NUMERIC" },
      { fieldKey: "featured", columnType: "INTEGER" },
      { fieldKey: "published_at", columnType: "TEXT" },
      { fieldKey: "category", columnType: "TEXT" },
    ]);
  });

  it("computes add / drop / type-change diffs", () => {
    const prev: FieldDefinition[] = [
      { key: "a", type: "text", config: { indexed: true } },
      { key: "b", type: "text", config: { indexed: true } },
    ];
    const next: FieldDefinition[] = [
      { key: "a", type: "number", config: { indexed: true } },
      { key: "c", type: "datetime", config: { indexed: true } },
    ];
    const diff = computeIndexDdlDiff(prev, next);
    expect(diff.add).toEqual([
      { fieldKey: "a", columnType: "NUMERIC" },
      { fieldKey: "c", columnType: "TEXT" },
    ]);
    expect(diff.drop).toEqual([
      { fieldKey: "a", columnType: "TEXT" },
      { fieldKey: "b", columnType: "TEXT" },
    ]);
  });

  it("namespaces generated column names by sanitized type key", () => {
    expect(generatedColumnName("article", "slug")).toBe("g_article_slug");
    expect(generatedColumnName("booking.slot", "starts_at")).toBe("g_booking__slot_starts_at");
  });
});

describe("applyIndexDdl (integration via registerContentType)", () => {
  it("adds generated columns and partial indexes for indexed fields", async () => {
    const stub = freshStub();
    await stub.registerContentType(articleType());
    await runInDurableObject(stub, async (_instance, state) => {
      const tableDdl = state.storage.sql
        .exec<{ sql: string }>("SELECT sql FROM sqlite_master WHERE type='table' AND name='records'")
        .one().sql;
      expect(tableDdl).toContain("g_article_slug");
      expect(tableDdl).toContain("g_article_published_at");
      const indexes = state.storage.sql
        .exec<{ name: string }>("SELECT name FROM sqlite_master WHERE type='index'")
        .toArray()
        .map((row) => row.name);
      expect(indexes).toEqual(
        expect.arrayContaining(["idx_g_article_slug", "idx_g_article_published_at"]),
      );
    });
  });

  it("drops the column and index when the indexed declaration is removed", async () => {
    const stub = freshStub();
    await stub.registerContentType(articleType());
    const next = articleType();
    next.fields = next.fields.map((field) =>
      field.key === "published_at" ? { ...field, config: {} } : field,
    );
    const result = await stub.registerContentType(next);
    expect(result.ok).toBe(true);
    await runInDurableObject(stub, async (_instance, state) => {
      const tableDdl = state.storage.sql
        .exec<{ sql: string }>("SELECT sql FROM sqlite_master WHERE type='table' AND name='records'")
        .one().sql;
      expect(tableDdl).toContain("g_article_slug");
      expect(tableDdl).not.toContain("g_article_published_at");
      const indexes = state.storage.sql
        .exec<{ name: string }>("SELECT name FROM sqlite_master WHERE type='index'")
        .toArray()
        .map((row) => row.name);
      expect(indexes).not.toContain("idx_g_article_published_at");
    });
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm --filter @plyrs/api test`
Expected: FAIL — `../src/do/index-ddl` の解決エラー

- [ ] **Step 3: 実装を書く**

`apps/api/src/do/index-ddl.ts`:

```ts
import type { FieldDefinition } from "@plyrs/metamodel";

export interface IndexedColumn {
  fieldKey: string;
  columnType: "TEXT" | "NUMERIC" | "INTEGER";
}

// 単一値フィールドのみ昇格。multiple select は行分割が必要なため対象外（design-spec §12.2 の
// projection_index が公開側で担う）。json / richtext / relation はそもそも indexed を持てない。
export function indexedColumns(fields: FieldDefinition[]): IndexedColumn[] {
  const out: IndexedColumn[] = [];
  for (const field of fields) {
    switch (field.type) {
      case "text":
      case "datetime":
        if (field.config?.indexed === true) {
          out.push({ fieldKey: field.key, columnType: "TEXT" });
        }
        break;
      case "number":
        if (field.config?.indexed === true) {
          out.push({ fieldKey: field.key, columnType: "NUMERIC" });
        }
        break;
      case "boolean":
        if (field.config?.indexed === true) {
          out.push({ fieldKey: field.key, columnType: "INTEGER" });
        }
        break;
      case "select":
        if (field.config.indexed === true && field.config.multiple !== true) {
          out.push({ fieldKey: field.key, columnType: "TEXT" });
        }
        break;
      default:
        break;
    }
  }
  return out;
}

export function sanitizeTypeKey(typeKey: string): string {
  return typeKey.replace(/\./g, "__");
}

export function generatedColumnName(typeKey: string, fieldKey: string): string {
  return `g_${sanitizeTypeKey(typeKey)}_${fieldKey}`;
}

export interface IndexDdlDiff {
  add: IndexedColumn[];
  drop: IndexedColumn[];
}

export function computeIndexDdlDiff(
  prev: FieldDefinition[] | null,
  next: FieldDefinition[],
): IndexDdlDiff {
  const prevCols = new Map(indexedColumns(prev ?? []).map((col) => [col.fieldKey, col]));
  const nextCols = new Map(indexedColumns(next).map((col) => [col.fieldKey, col]));
  const add: IndexedColumn[] = [];
  const drop: IndexedColumn[] = [];
  for (const [key, col] of nextCols) {
    const before = prevCols.get(key);
    if (before === undefined) {
      add.push(col);
    } else if (before.columnType !== col.columnType) {
      drop.push(before);
      add.push(col);
    }
  }
  for (const [key, col] of prevCols) {
    if (!nextCols.has(key)) {
      drop.push(col);
    }
  }
  return { add, drop };
}

// key / typeKey は metamodel 検証済み（/^[a-z][a-z0-9_.]*$/）のため、識別子・リテラル埋め込みが安全。
export function applyIndexDdl(
  sql: SqlStorage,
  typeKey: string,
  prev: FieldDefinition[] | null,
  next: FieldDefinition[],
): void {
  const { add, drop } = computeIndexDdlDiff(prev, next);
  for (const col of drop) {
    const name = generatedColumnName(typeKey, col.fieldKey);
    sql.exec(`DROP INDEX IF EXISTS idx_${name}`);
    sql.exec(`ALTER TABLE records DROP COLUMN ${name}`);
  }
  for (const col of add) {
    const name = generatedColumnName(typeKey, col.fieldKey);
    sql.exec(
      `ALTER TABLE records ADD COLUMN ${name} ${col.columnType} GENERATED ALWAYS AS (json_extract(data, '$.${col.fieldKey}')) VIRTUAL`,
    );
    sql.exec(`CREATE INDEX idx_${name} ON records(${name}) WHERE type = '${typeKey}'`);
  }
}
```

`apps/api/src/do/content-types.ts` を修正 — import を追加:

```ts
import { applyIndexDdl } from "./index-ddl";
```

`registerContentTypeCore` の `return { ok: true, ... }` の直前（INSERT/UPDATE の後）に1行追加:

```ts
  applyIndexDdl(sql, def.key, prev?.fields ?? null, def.fields);
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm --filter @plyrs/api test` → PASS（14件）

- [ ] **Step 5: フォーマットとコミット**

```bash
pnpm format
git add apps/api/src/do/index-ddl.ts apps/api/src/do/content-types.ts apps/api/test/index-ddl.test.ts
git commit -m "feat: apply generated column DDL for indexed field declarations"
```

---

### Task 6: 変更検知の純関数（jsonDeepEqual / computeChangeSet）

**Files:**
- Create: `apps/api/src/do/diff.ts`
- Test: `apps/api/src/do/diff.test.ts`（純関数なので src 側に同居。vitest.config の include が `src/**/*.test.ts` も拾う）

**Interfaces:**
- Consumes: `splitRecordInput` / `ContentTypeDefinition` / `RelationRef`（metamodel）
- Produces:
  - `jsonDeepEqual(a: unknown, b: unknown): boolean`
  - `interface ChangeSet { data: Record<string, unknown>; relationWrites: Array<{ fieldKey: string; refs: RelationRef[] }>; changedFields: string[]; dataChanged: boolean }`
  - `computeChangeSet(contentType: ContentTypeDefinition, input: Record<string, unknown>, prevData: Record<string, unknown> | null, prevRelations: Map<string, RelationRef[]>): ChangeSet`

セマンティクス（record 単位の全置換、design-spec §10.2）:
- `data` = `splitRecordInput` の data 側（未知キー込み・全置換）
- `changedFields` = 型定義済みフィールドのうち値が変わったもの（relation は prevRelations との配列比較、省略は `[]` 扱い＝クリア）
- `dataChanged` = data JSON 全体の差（未知キーだけの変更も適用対象にするため）
- `relationWrites` は**全 relation フィールド**の新しい姿（再投影は毎回全フィールド張り直し）

- [ ] **Step 1: 失敗するテストを書く**

`apps/api/src/do/diff.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { RelationRef } from "@plyrs/metamodel";
import { computeChangeSet, jsonDeepEqual } from "./diff";
import { articleType, uuid, validArticleInput } from "../../test/fixtures";

describe("jsonDeepEqual", () => {
  it("compares primitives, arrays and objects structurally", () => {
    expect(jsonDeepEqual(1, 1)).toBe(true);
    expect(jsonDeepEqual("a", "b")).toBe(false);
    expect(jsonDeepEqual([1, [2]], [1, [2]])).toBe(true);
    expect(jsonDeepEqual([1, 2], [2, 1])).toBe(false);
    expect(jsonDeepEqual({ a: { b: 1 } }, { a: { b: 1 } })).toBe(true);
    expect(jsonDeepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(jsonDeepEqual(null, undefined)).toBe(false);
    expect(jsonDeepEqual(undefined, undefined)).toBe(true);
  });
});

describe("computeChangeSet", () => {
  const type = articleType();
  const input = validArticleInput();

  function prevRelationsOf(refsInput: Record<string, unknown>): Map<string, RelationRef[]> {
    const map = new Map<string, RelationRef[]>();
    map.set("authors", refsInput["authors"] as RelationRef[]);
    map.set("hero", [refsInput["hero"] as RelationRef]);
    return map;
  }

  it("marks every provided field as changed for a new record", () => {
    const change = computeChangeSet(type, input, null, new Map());
    expect(change.changedFields.sort()).toEqual(
      ["authors", "body", "hero", "published_at", "slug", "tags", "title"].sort(),
    );
    expect(change.dataChanged).toBe(true);
    expect(change.data["authors"]).toBeUndefined();
    expect(change.relationWrites).toEqual([
      { fieldKey: "authors", refs: input["authors"] },
      { fieldKey: "hero", refs: [input["hero"]] },
    ]);
  });

  it("detects a single scalar change", () => {
    const { data: prevData } = splitPrev(input);
    const next = { ...input, title: "改題" };
    const change = computeChangeSet(type, next, prevData, prevRelationsOf(input));
    expect(change.changedFields).toEqual(["title"]);
  });

  it("detects relation reorder as a change to that field only", () => {
    const { data: prevData } = splitPrev(input);
    const authors = input["authors"] as RelationRef[];
    const reversed = [...authors].reverse();
    const change = computeChangeSet(type, { ...input, authors: reversed }, prevData, prevRelationsOf(input));
    expect(change.changedFields).toEqual(["authors"]);
  });

  it("treats an omitted optional relation as cleared", () => {
    const { data: prevData } = splitPrev(input);
    const { hero: _hero, ...withoutHero } = input;
    const change = computeChangeSet(type, withoutHero, prevData, prevRelationsOf(input));
    expect(change.changedFields).toEqual(["hero"]);
    expect(change.relationWrites.find((w) => w.fieldKey === "hero")?.refs).toEqual([]);
  });

  it("reports unknown-key-only edits via dataChanged with empty changedFields", () => {
    const { data: prevData } = splitPrev(input);
    const change = computeChangeSet(
      type,
      { ...input, legacy_field: "new value" },
      prevData,
      prevRelationsOf(input),
    );
    expect(change.changedFields).toEqual([]);
    expect(change.dataChanged).toBe(true);
  });

  it("returns a no-op change set for identical input", () => {
    const { data: prevData } = splitPrev(input);
    const change = computeChangeSet(type, { ...input }, prevData, prevRelationsOf(input));
    expect(change.changedFields).toEqual([]);
    expect(change.dataChanged).toBe(false);
  });
});

// prev 側 data を metamodel と同じ分離規則で作るためのヘルパ
import { splitRecordInput } from "@plyrs/metamodel";
function splitPrev(input: Record<string, unknown>) {
  return splitRecordInput(articleType(), input);
}
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm --filter @plyrs/api test`
Expected: FAIL — `./diff` の解決エラー

- [ ] **Step 3: 実装を書く**

`apps/api/src/do/diff.ts`:

```ts
import {
  splitRecordInput,
  type ContentTypeDefinition,
  type RelationRef,
} from "@plyrs/metamodel";

export function jsonDeepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) {
    return true;
  }
  if (typeof a !== typeof b || a === null || b === null) {
    return false;
  }
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) {
      return false;
    }
    return a.every((value, i) => jsonDeepEqual(value, b[i]));
  }
  if (typeof a === "object") {
    if (Array.isArray(b) || typeof b !== "object") {
      return false;
    }
    const keysA = Object.keys(a);
    const keysB = Object.keys(b as object);
    if (keysA.length !== keysB.length) {
      return false;
    }
    return keysA.every(
      (key) =>
        Object.hasOwn(b as object, key) &&
        jsonDeepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
    );
  }
  return false;
}

export interface ChangeSet {
  data: Record<string, unknown>;
  relationWrites: Array<{ fieldKey: string; refs: RelationRef[] }>;
  changedFields: string[];
  dataChanged: boolean;
}

function refsEqual(a: RelationRef[], b: RelationRef[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  return a.every((ref, i) => ref.type === b[i]?.type && ref.id === b[i]?.id);
}

// record 単位の全置換（design-spec §10.2）: input が defined/unknown 両キーの真実。
// 省略された relation フィールドは [] = クリアとして扱う。
export function computeChangeSet(
  contentType: ContentTypeDefinition,
  input: Record<string, unknown>,
  prevData: Record<string, unknown> | null,
  prevRelations: Map<string, RelationRef[]>,
): ChangeSet {
  const { data, relations } = splitRecordInput(contentType, input);
  const changedFields: string[] = [];

  for (const field of contentType.fields) {
    if (field.type === "relation") {
      const nextRefs = relations.find((write) => write.fieldKey === field.key)?.refs ?? [];
      const prevRefs = prevRelations.get(field.key) ?? [];
      if (!refsEqual(prevRefs, nextRefs)) {
        changedFields.push(field.key);
      }
      continue;
    }
    const before = prevData === null ? undefined : prevData[field.key];
    if (!jsonDeepEqual(before, data[field.key])) {
      changedFields.push(field.key);
    }
  }

  const relationWrites = contentType.fields
    .filter((field) => field.type === "relation")
    .map((field) => ({
      fieldKey: field.key,
      refs: relations.find((write) => write.fieldKey === field.key)?.refs ?? [],
    }));

  return {
    data,
    relationWrites,
    changedFields,
    dataChanged: !jsonDeepEqual(prevData ?? null, data) && !(prevData === null && false),
  };
}
```

注意: `dataChanged` の式は「新規（prevData === null）は常に true、既存は data JSON の構造比較」を意味すればよい。上式が読みにくければ次の等価な形に直してよい（推奨）:

```ts
  const dataChanged = prevData === null ? true : !jsonDeepEqual(prevData, data);
```

を計算してから `return { data, relationWrites, changedFields, dataChanged };` とする。

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm --filter @plyrs/api test` → PASS（21件）

- [ ] **Step 5: フォーマットとコミット**

```bash
pnpm format
git add apps/api/src/do/diff.ts apps/api/src/do/diff.test.ts
git commit -m "feat: add change detection primitives for the record write path"
```

---

### Task 7: writeRecord 本体（検証・帳簿・全置換・relations 再投影・no-op）

**Files:**
- Create: `apps/api/src/do/types.ts`
- Create: `apps/api/src/do/write-record.ts`
- Modify: `apps/api/src/tenant-do.ts`（`writeRecord` / `getRecord` RPC 追加）
- Test: `apps/api/test/write-record.test.ts`

**Interfaces:**
- Consumes: `buildRecordInputSchema` / `WORKFLOW_STATUSES`（metamodel）、`computeChangeSet`（Task 6）、`ContentTypeRow` / `rowToDefinition` / `issuesToMessage`（Task 4）、`uuid` の `v7`
- Produces（`src/do/types.ts`）:

```ts
import type { WorkflowStatus } from "@plyrs/metamodel";

export interface RecordSnapshot {
  id: string;
  type: string;
  data: Record<string, unknown>;
  fieldVersions: Record<string, number>;
  status: WorkflowStatus;
  seq: number;
  version: number;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string;
  deletedAt: string | null;
}

export interface WriteRecordParams {
  recordId: string;
  input: Record<string, unknown>;
  status?: WorkflowStatus;
  actor: string;
}

export type WriteErrorCode =
  | "unknown_type"
  | "validation_failed"
  | "invalid_status"
  | "record_deleted"
  | "unique_violation";

export type WriteRecordResult =
  | { ok: true; record: RecordSnapshot; changedFields: string[]; applied: boolean }
  | { ok: false; code: WriteErrorCode; message: string };
```

- Produces（`src/do/write-record.ts`）: `loadRecord(sql, id): RecordSnapshot | null`、`loadRelationRefs(sql, sourceId): Map<string, RelationRef[]>`、`writeRecordCore(deps: WriteDeps, contentType: ContentTypeRow, params: WriteRecordParams): WriteRecordResult`（`WriteDeps = { sql: SqlStorage; nextSeq: () => number; now: () => string; newRelationId: () => string }`）
- TenantDO RPC: `writeRecord(typeKey: string, params: WriteRecordParams): WriteRecordResult`、`getRecord(id: string): RecordSnapshot | null`

- [ ] **Step 1: 失敗するテストを書く**

`apps/api/test/write-record.test.ts`:

```ts
import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { articleType, uuid, validArticleInput } from "./fixtures";

function freshStub() {
  return env.TENANT_DO.get(env.TENANT_DO.idFromName(crypto.randomUUID()));
}

describe("writeRecord", () => {
  let stub: ReturnType<typeof freshStub>;

  beforeEach(async () => {
    stub = freshStub();
    const registered = await stub.registerContentType(articleType());
    expect(registered.ok).toBe(true);
  });

  it("creates a record with bookkeeping columns and reprojected relations", async () => {
    const result = await stub.writeRecord("article", {
      recordId: uuid(10),
      input: validArticleInput(),
      actor: "user-a",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.applied).toBe(true);
    expect(result.record.version).toBe(1);
    expect(result.record.seq).toBe(1);
    expect(result.record.status).toBe("draft");
    expect(result.record.fieldVersions).toMatchObject({ title: 1, slug: 1, authors: 1, hero: 1 });
    // data には relation フィールドが入らない
    expect(result.record.data["authors"]).toBeUndefined();

    await runInDurableObject(stub, async (_instance, state) => {
      const stored = state.storage.sql
        .exec<{ data: string }>("SELECT data FROM records WHERE id = ?", uuid(10))
        .one();
      expect(JSON.parse(stored.data)["authors"]).toBeUndefined();
      const rels = state.storage.sql
        .exec<{ source_field: string; target_id: string; ordinal: number }>(
          "SELECT source_field, target_id, ordinal FROM relations WHERE source_id = ? ORDER BY source_field, ordinal",
          uuid(10),
        )
        .toArray();
      expect(rels).toEqual([
        { source_field: "authors", target_id: uuid(2), ordinal: 0 },
        { source_field: "authors", target_id: uuid(3), ordinal: 1 },
        { source_field: "hero", target_id: uuid(4), ordinal: 0 },
      ]);
    });
  });

  it("rejects input that fails validate-on-write (missing required title)", async () => {
    const { title: _t, ...rest } = validArticleInput();
    const result = await stub.writeRecord("article", {
      recordId: uuid(11),
      input: rest,
      actor: "user-a",
    });
    expect(result).toMatchObject({ ok: false, code: "validation_failed" });
  });

  it("rejects an empty required text through the whole stack (G7)", async () => {
    const result = await stub.writeRecord("article", {
      recordId: uuid(12),
      input: { ...validArticleInput(), title: "" },
      actor: "user-a",
    });
    expect(result).toMatchObject({ ok: false, code: "validation_failed" });
  });

  it("returns unknown_type for an unregistered type", async () => {
    const result = await stub.writeRecord("nope", {
      recordId: uuid(13),
      input: validArticleInput(),
      actor: "user-a",
    });
    expect(result).toMatchObject({ ok: false, code: "unknown_type" });
  });

  it("bumps only the changed field's counter on update", async () => {
    await stub.writeRecord("article", { recordId: uuid(14), input: validArticleInput(), actor: "a" });
    const result = await stub.writeRecord("article", {
      recordId: uuid(14),
      input: { ...validArticleInput(), title: "改題" },
      actor: "b",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.applied).toBe(true);
    expect(result.record.version).toBe(2);
    expect(result.record.seq).toBe(2);
    expect(result.record.fieldVersions["title"]).toBe(2);
    expect(result.record.fieldVersions["slug"]).toBe(1);
    expect(result.record.updatedBy).toBe("b");
    expect(result.changedFields).toEqual(["title"]);
  });

  it("treats an identical write as a no-op (no version/seq bump)", async () => {
    await stub.writeRecord("article", { recordId: uuid(15), input: validArticleInput(), actor: "a" });
    const result = await stub.writeRecord("article", {
      recordId: uuid(15),
      input: validArticleInput(),
      actor: "a",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.applied).toBe(false);
    expect(result.record.version).toBe(1);
  });

  it("applies unknown-key-only edits (lazy conformance carries them)", async () => {
    await stub.writeRecord("article", { recordId: uuid(16), input: validArticleInput(), actor: "a" });
    const result = await stub.writeRecord("article", {
      recordId: uuid(16),
      input: { ...validArticleInput(), legacy_field: "kept" },
      actor: "a",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.applied).toBe(true);
    expect(result.record.data["legacy_field"]).toBe("kept");
    expect(result.changedFields).toEqual([]);
  });

  it("reprojects relations on reorder and clears omitted optional relations", async () => {
    const input = validArticleInput();
    await stub.writeRecord("article", { recordId: uuid(17), input, actor: "a" });
    const reordered = {
      ...input,
      authors: [
        { type: "author", id: uuid(3) },
        { type: "author", id: uuid(2) },
      ],
    };
    const { hero: _hero, ...withoutHero } = reordered;
    const result = await stub.writeRecord("article", {
      recordId: uuid(17),
      input: withoutHero,
      actor: "a",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.changedFields.sort()).toEqual(["authors", "hero"]);
    await runInDurableObject(stub, async (_instance, state) => {
      const rels = state.storage.sql
        .exec<{ source_field: string; target_id: string; ordinal: number }>(
          "SELECT source_field, target_id, ordinal FROM relations WHERE source_id = ? ORDER BY source_field, ordinal",
          uuid(17),
        )
        .toArray();
      expect(rels).toEqual([
        { source_field: "authors", target_id: uuid(3), ordinal: 0 },
        { source_field: "authors", target_id: uuid(2), ordinal: 1 },
      ]);
    });
  });

  it("changes workflow status alone (version bump, no field version change)", async () => {
    await stub.writeRecord("article", { recordId: uuid(18), input: validArticleInput(), actor: "a" });
    const result = await stub.writeRecord("article", {
      recordId: uuid(18),
      input: validArticleInput(),
      status: "in_review",
      actor: "a",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.applied).toBe(true);
    expect(result.record.status).toBe("in_review");
    expect(result.record.version).toBe(2);
    expect(result.changedFields).toEqual([]);
  });

  it("exposes the stored record via getRecord", async () => {
    await stub.writeRecord("article", { recordId: uuid(19), input: validArticleInput(), actor: "a" });
    const record = await stub.getRecord(uuid(19));
    expect(record?.type).toBe("article");
    expect(record?.data["title"]).toBe("こんにちは");
    expect(await stub.getRecord(uuid(99))).toBeNull();
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm --filter @plyrs/api test`
Expected: FAIL — `stub.writeRecord is not a function` 系

- [ ] **Step 3: types.ts と write-record.ts を書く**

`apps/api/src/do/types.ts` は本タスクの Interfaces 節のコードをそのまま作成する。

`apps/api/src/do/write-record.ts`:

```ts
import {
  buildRecordInputSchema,
  WORKFLOW_STATUSES,
  type RelationRef,
  type WorkflowStatus,
} from "@plyrs/metamodel";
import { issuesToMessage, rowToDefinition, type ContentTypeRow } from "./content-types";
import { computeChangeSet } from "./diff";
import type { RecordSnapshot, WriteRecordParams, WriteRecordResult } from "./types";

interface RawRecordRow {
  id: string;
  type: string;
  data: string;
  field_versions: string;
  status: string;
  seq: number;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
  created_by: string;
  updated_by: string;
  version: number;
}

function rowToSnapshot(row: RawRecordRow): RecordSnapshot {
  return {
    id: row.id,
    type: row.type,
    data: JSON.parse(row.data) as Record<string, unknown>,
    fieldVersions: JSON.parse(row.field_versions) as Record<string, number>,
    status: row.status as WorkflowStatus,
    seq: row.seq,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    deletedAt: row.deleted_at,
  };
}

export function loadRecord(sql: SqlStorage, id: string): RecordSnapshot | null {
  const row = sql.exec<RawRecordRow>("SELECT * FROM records WHERE id = ?", id).toArray()[0];
  return row === undefined ? null : rowToSnapshot(row);
}

export function loadRelationRefs(sql: SqlStorage, sourceId: string): Map<string, RelationRef[]> {
  const rows = sql
    .exec<{ source_field: string; target_type: string; target_id: string }>(
      "SELECT source_field, target_type, target_id FROM relations WHERE source_id = ? AND origin = 'field' ORDER BY source_field, ordinal",
      sourceId,
    )
    .toArray();
  const map = new Map<string, RelationRef[]>();
  for (const row of rows) {
    const list = map.get(row.source_field) ?? [];
    list.push({ type: row.target_type, id: row.target_id });
    map.set(row.source_field, list);
  }
  return map;
}

export interface WriteDeps {
  sql: SqlStorage;
  nextSeq: () => number;
  now: () => string;
  newRelationId: () => string;
}

export function writeRecordCore(
  deps: WriteDeps,
  contentType: ContentTypeRow,
  params: WriteRecordParams,
): WriteRecordResult {
  if (
    params.status !== undefined &&
    !(WORKFLOW_STATUSES as readonly string[]).includes(params.status)
  ) {
    return { ok: false, code: "invalid_status", message: `invalid status: ${params.status}` };
  }

  const definition = rowToDefinition(contentType);
  const parsed = buildRecordInputSchema(definition).safeParse(params.input);
  if (!parsed.success) {
    return { ok: false, code: "validation_failed", message: issuesToMessage(parsed.error.issues) };
  }

  const prev = loadRecord(deps.sql, params.recordId);
  if (prev !== null && prev.deletedAt !== null) {
    return { ok: false, code: "record_deleted", message: `record is deleted: ${params.recordId}` };
  }
  if (prev !== null && prev.type !== contentType.key) {
    return {
      ok: false,
      code: "validation_failed",
      message: `record ${params.recordId} belongs to type '${prev.type}'`,
    };
  }

  const prevRelations =
    prev === null ? new Map<string, RelationRef[]>() : loadRelationRefs(deps.sql, params.recordId);
  const change = computeChangeSet(
    definition,
    parsed.data as Record<string, unknown>,
    prev?.data ?? null,
    prevRelations,
  );

  const nextStatus: WorkflowStatus = params.status ?? prev?.status ?? "draft";
  const statusChanged = prev !== null && nextStatus !== prev.status;
  const applied =
    prev === null || change.dataChanged || change.changedFields.length > 0 || statusChanged;
  if (!applied && prev !== null) {
    return { ok: true, record: prev, changedFields: [], applied: false };
  }

  const now = deps.now();
  const fieldVersions: Record<string, number> = { ...(prev?.fieldVersions ?? {}) };
  for (const key of change.changedFields) {
    fieldVersions[key] = (fieldVersions[key] ?? 0) + 1;
  }
  const seq = deps.nextSeq();
  const version = (prev?.version ?? 0) + 1;
  const dataJson = JSON.stringify(change.data);
  const fieldVersionsJson = JSON.stringify(fieldVersions);

  if (prev === null) {
    deps.sql.exec(
      "INSERT INTO records (id, type, data, field_versions, status, seq, deleted_at, created_at, updated_at, created_by, updated_by, version) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)",
      params.recordId,
      contentType.key,
      dataJson,
      fieldVersionsJson,
      nextStatus,
      seq,
      now,
      now,
      params.actor,
      params.actor,
      version,
    );
  } else {
    deps.sql.exec(
      "UPDATE records SET data = ?, field_versions = ?, status = ?, seq = ?, updated_at = ?, updated_by = ?, version = ? WHERE id = ?",
      dataJson,
      fieldVersionsJson,
      nextStatus,
      seq,
      now,
      params.actor,
      version,
      params.recordId,
    );
  }

  // relations は派生データ: 全 relation フィールドを削除→再挿入で再投影（design-spec §6）
  for (const write of change.relationWrites) {
    deps.sql.exec(
      "DELETE FROM relations WHERE source_id = ? AND source_field = ?",
      params.recordId,
      write.fieldKey,
    );
    write.refs.forEach((ref, ordinal) => {
      deps.sql.exec(
        "INSERT INTO relations (id, source_id, source_field, target_type, target_id, ordinal, origin) VALUES (?, ?, ?, ?, ?, ?, 'field')",
        deps.newRelationId(),
        params.recordId,
        write.fieldKey,
        ref.type,
        ref.id,
        ordinal,
      );
    });
  }

  const record: RecordSnapshot = {
    id: params.recordId,
    type: contentType.key,
    data: change.data,
    fieldVersions,
    status: nextStatus,
    seq,
    version,
    createdAt: prev?.createdAt ?? now,
    updatedAt: now,
    createdBy: prev?.createdBy ?? params.actor,
    updatedBy: params.actor,
    deletedAt: null,
  };
  return { ok: true, record, changedFields: change.changedFields, applied: true };
}
```

- [ ] **Step 4: TenantDO に配線する**

`apps/api/src/tenant-do.ts` — import 追記:

```ts
import { v7 as uuidv7 } from "uuid";
import { loadRecord, writeRecordCore } from "./do/write-record";
import type { RecordSnapshot, WriteRecordParams, WriteRecordResult } from "./do/types";
```

クラスにメソッド追加:

```ts
  writeRecord(typeKey: string, params: WriteRecordParams): WriteRecordResult {
    const contentType = loadContentTypeByKey(this.ctx.storage.sql, typeKey);
    if (contentType === null) {
      return { ok: false, code: "unknown_type", message: `unknown content type: ${typeKey}` };
    }
    return this.ctx.storage.transactionSync(() =>
      writeRecordCore(
        {
          sql: this.ctx.storage.sql,
          nextSeq: () => ++this.seq,
          now: () => new Date().toISOString(),
          newRelationId: () => uuidv7(),
        },
        contentType,
        params,
      ),
    );
  }

  getRecord(id: string): RecordSnapshot | null {
    return loadRecord(this.ctx.storage.sql, id);
  }
```

- [ ] **Step 5: テストが通ることを確認**

Run: `pnpm --filter @plyrs/api test` → PASS（31件）
Run: `pnpm --filter @plyrs/api typecheck` → エラーなし

- [ ] **Step 6: フォーマットとコミット**

```bash
pnpm format
git add apps/api/src/do/types.ts apps/api/src/do/write-record.ts apps/api/src/tenant-do.ts apps/api/test/write-record.test.ts
git commit -m "feat: add the record write path with versioning and relation reprojection"
```

---

### Task 8: beforeWrite フックパイプライン + unique システムフック

**Files:**
- Create: `apps/api/src/do/hooks.ts`
- Create: `apps/api/src/do/unique-check.ts`
- Modify: `apps/api/src/do/write-record.ts`（フック実行を差し込む）
- Test: `apps/api/test/unique.test.ts`

**Interfaces:**
- Consumes: `ContentTypeRow`（Task 4）、`RecordSnapshot`（Task 7 の types.ts）
- Produces:
  - `interface BeforeWriteContext { contentType: ContentTypeRow; recordId: string; data: Record<string, unknown>; prev: RecordSnapshot | null; sql: SqlStorage }`
  - `type HookRejection = { code: "unique_violation"; message: string }`（Phase 3 で code が増える）
  - `type BeforeWriteHook = (ctx: BeforeWriteContext) => HookRejection | null`
  - `runBeforeWriteHooks(hooks: readonly BeforeWriteHook[], ctx: BeforeWriteContext): HookRejection | null`
  - `uniqueCheckHook: BeforeWriteHook`
  - write-record.ts 内の `systemBeforeWriteHooks: readonly BeforeWriteHook[] = [uniqueCheckHook]`

フックは design-spec §9.3 の「同期バリデーションフック（DO 内・書き込み拒否可能）」。認可第2段（Phase 3）とモジュールフック（Phase 9）が同じパイプラインに乗る。

- [ ] **Step 1: 失敗するテストを書く**

`apps/api/test/unique.test.ts`:

```ts
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { articleType, uuid, validArticleInput } from "./fixtures";

function freshStub() {
  return env.TENANT_DO.get(env.TENANT_DO.idFromName(crypto.randomUUID()));
}

describe("unique system hook", () => {
  let stub: ReturnType<typeof freshStub>;

  beforeEach(async () => {
    stub = freshStub();
    await stub.registerContentType(articleType());
    await stub.writeRecord("article", {
      recordId: uuid(20),
      input: validArticleInput(),
      actor: "a",
    });
  });

  it("rejects a second record with the same unique slug", async () => {
    const result = await stub.writeRecord("article", {
      recordId: uuid(21),
      input: { ...validArticleInput(), title: "別記事" },
      actor: "a",
    });
    expect(result).toMatchObject({ ok: false, code: "unique_violation" });
    expect(await stub.getRecord(uuid(21))).toBeNull();
  });

  it("allows updating the record that owns the unique value", async () => {
    const result = await stub.writeRecord("article", {
      recordId: uuid(20),
      input: { ...validArticleInput(), title: "改題" },
      actor: "a",
    });
    expect(result.ok).toBe(true);
  });

  it("allows the same slug in a different content type", async () => {
    const noteType = {
      ...articleType(),
      id: uuid(30),
      key: "note",
      fields: [
        { key: "title", type: "text" as const, required: true },
        { key: "slug", type: "text" as const, config: { unique: true } },
      ],
    };
    await stub.registerContentType(noteType);
    const result = await stub.writeRecord("note", {
      recordId: uuid(31),
      input: { title: "ノート", slug: "hello" },
      actor: "a",
    });
    expect(result.ok).toBe(true);
  });

  it("ignores records without the optional unique field", async () => {
    const noteType = {
      ...articleType(),
      id: uuid(32),
      key: "memo",
      fields: [
        { key: "title", type: "text" as const, required: true },
        { key: "slug", type: "text" as const, config: { unique: true } },
      ],
    };
    await stub.registerContentType(noteType);
    const first = await stub.writeRecord("memo", {
      recordId: uuid(33),
      input: { title: "一" },
      actor: "a",
    });
    const second = await stub.writeRecord("memo", {
      recordId: uuid(34),
      input: { title: "二" },
      actor: "a",
    });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm --filter @plyrs/api test`
Expected: FAIL — 1件目「rejects a second record with the same unique slug」が `ok: true` を返して落ちる（unique 未実装のため）。他3件は通る

- [ ] **Step 3: 実装を書く**

`apps/api/src/do/hooks.ts`:

```ts
import type { ContentTypeRow } from "./content-types";
import type { RecordSnapshot } from "./types";

// design-spec §9.3: DO 内同期バリデーションフック。書き込みを拒否できる。
// 認可第2段（Phase 3）・モジュールフック（Phase 9）も同じパイプラインに乗る。
export interface BeforeWriteContext {
  contentType: ContentTypeRow;
  recordId: string;
  data: Record<string, unknown>;
  prev: RecordSnapshot | null;
  sql: SqlStorage;
}

export type HookRejection = { code: "unique_violation"; message: string };

export type BeforeWriteHook = (ctx: BeforeWriteContext) => HookRejection | null;

export function runBeforeWriteHooks(
  hooks: readonly BeforeWriteHook[],
  ctx: BeforeWriteContext,
): HookRejection | null {
  for (const hook of hooks) {
    const rejection = hook(ctx);
    if (rejection !== null) {
      return rejection;
    }
  }
  return null;
}
```

`apps/api/src/do/unique-check.ts`:

```ts
import type { BeforeWriteHook } from "./hooks";

// design-spec §5・33: unique はシステム定義 beforeWrite フックとして強制する。
// unique を持てるのは text / number / datetime のみ（G7 と同日の裁定）。
export const uniqueCheckHook: BeforeWriteHook = (ctx) => {
  for (const field of ctx.contentType.fields) {
    if (field.type !== "text" && field.type !== "number" && field.type !== "datetime") {
      continue;
    }
    if (field.config?.unique !== true) {
      continue;
    }
    const value = ctx.data[field.key];
    if (value === undefined) {
      continue;
    }
    const clash = ctx.sql
      .exec<{ id: string }>(
        `SELECT id FROM records WHERE type = ? AND deleted_at IS NULL AND id <> ? AND json_extract(data, '$.${field.key}') = ? LIMIT 1`,
        ctx.contentType.key,
        ctx.recordId,
        value as string | number,
      )
      .toArray()[0];
    if (clash !== undefined) {
      return {
        code: "unique_violation",
        message: `field '${field.key}' must be unique within type '${ctx.contentType.key}' (conflicts with record ${clash.id})`,
      };
    }
  }
  return null;
};
```

`apps/api/src/do/write-record.ts` を修正 — import 追記:

```ts
import { runBeforeWriteHooks, type BeforeWriteHook } from "./hooks";
import { uniqueCheckHook } from "./unique-check";
```

モジュールスコープに追加:

```ts
const systemBeforeWriteHooks: readonly BeforeWriteHook[] = [uniqueCheckHook];
```

`writeRecordCore` 内、`const now = deps.now();` の**直前**に挿入（適用判定の後・変異の前）:

```ts
  const rejection = runBeforeWriteHooks(systemBeforeWriteHooks, {
    contentType,
    recordId: params.recordId,
    data: change.data,
    prev,
    sql: deps.sql,
  });
  if (rejection !== null) {
    return { ok: false, code: rejection.code, message: rejection.message };
  }
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm --filter @plyrs/api test` → PASS（35件）

- [ ] **Step 5: フォーマットとコミット**

```bash
pnpm format
git add apps/api/src/do/hooks.ts apps/api/src/do/unique-check.ts apps/api/src/do/write-record.ts apps/api/test/unique.test.ts
git commit -m "feat: add beforeWrite hook pipeline with the unique system hook"
```

---

### Task 9: deleteRecord（トゥームストーン）

**Files:**
- Create: `apps/api/src/do/delete-record.ts`
- Modify: `apps/api/src/tenant-do.ts`（`deleteRecord` RPC 追加）
- Test: `apps/api/test/delete.test.ts`

**Interfaces:**
- Consumes: `loadRecord`（Task 7）、`RecordSnapshot`（types.ts）
- Produces:
  - `type DeleteRecordResult = { ok: true; record: RecordSnapshot } | { ok: false; code: "not_found" | "already_deleted"; message: string }`
  - `deleteRecordCore(deps: { sql: SqlStorage; nextSeq: () => number; now: () => string }, recordId: string, actor: string): DeleteRecordResult`
  - TenantDO RPC: `deleteRecord(recordId: string, actor: string): DeleteRecordResult`

削除の意味論（G2 裁定・ロードマップ §1）: `deleted_at` をセットし version / seq を進め、relations の順向き行を消す。row は同期のトゥームストーンとして残る。`getRecord` は削除済みでも snapshot（`deletedAt` 付き）を返す — 不在との区別は呼び出し側の責務。

- [ ] **Step 1: 失敗するテストを書く**

`apps/api/test/delete.test.ts`:

```ts
import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { articleType, uuid, validArticleInput } from "./fixtures";

function freshStub() {
  return env.TENANT_DO.get(env.TENANT_DO.idFromName(crypto.randomUUID()));
}

describe("deleteRecord (tombstone)", () => {
  let stub: ReturnType<typeof freshStub>;

  beforeEach(async () => {
    stub = freshStub();
    await stub.registerContentType(articleType());
    await stub.writeRecord("article", {
      recordId: uuid(40),
      input: validArticleInput(),
      actor: "a",
    });
  });

  it("sets the tombstone and removes outgoing relations", async () => {
    const result = await stub.deleteRecord(uuid(40), "b");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.record.deletedAt).not.toBeNull();
    expect(result.record.version).toBe(2);
    expect(result.record.seq).toBe(2);
    expect(result.record.updatedBy).toBe("b");
    await runInDurableObject(stub, async (_instance, state) => {
      const relCount = state.storage.sql
        .exec<{ n: number }>("SELECT COUNT(*) AS n FROM relations WHERE source_id = ?", uuid(40))
        .one().n;
      expect(relCount).toBe(0);
      const row = state.storage.sql
        .exec<{ deleted_at: string | null }>(
          "SELECT deleted_at FROM records WHERE id = ?",
          uuid(40),
        )
        .one();
      expect(row.deleted_at).not.toBeNull();
    });
  });

  it("keeps the tombstone visible via getRecord", async () => {
    await stub.deleteRecord(uuid(40), "b");
    const record = await stub.getRecord(uuid(40));
    expect(record?.deletedAt).not.toBeNull();
  });

  it("rejects writes to a deleted record", async () => {
    await stub.deleteRecord(uuid(40), "b");
    const result = await stub.writeRecord("article", {
      recordId: uuid(40),
      input: validArticleInput(),
      actor: "a",
    });
    expect(result).toMatchObject({ ok: false, code: "record_deleted" });
  });

  it("rejects double deletion and unknown ids distinctly", async () => {
    await stub.deleteRecord(uuid(40), "b");
    expect(await stub.deleteRecord(uuid(40), "b")).toMatchObject({
      ok: false,
      code: "already_deleted",
    });
    expect(await stub.deleteRecord(uuid(41), "b")).toMatchObject({ ok: false, code: "not_found" });
  });

  it("frees unique values for new records (unique ignores tombstones)", async () => {
    await stub.deleteRecord(uuid(40), "b");
    const result = await stub.writeRecord("article", {
      recordId: uuid(42),
      input: validArticleInput(),
      actor: "a",
    });
    expect(result.ok).toBe(true);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm --filter @plyrs/api test`
Expected: FAIL — `stub.deleteRecord is not a function` 系

- [ ] **Step 3: 実装を書く**

`apps/api/src/do/delete-record.ts`:

```ts
import type { RecordSnapshot } from "./types";
import { loadRecord } from "./write-record";

export type DeleteRecordResult =
  | { ok: true; record: RecordSnapshot }
  | { ok: false; code: "not_found" | "already_deleted"; message: string };

// G2: 削除はトゥームストーン。row は同期の削除伝搬（Phase 4）のために残す。
export function deleteRecordCore(
  deps: { sql: SqlStorage; nextSeq: () => number; now: () => string },
  recordId: string,
  actor: string,
): DeleteRecordResult {
  const prev = loadRecord(deps.sql, recordId);
  if (prev === null) {
    return { ok: false, code: "not_found", message: `record not found: ${recordId}` };
  }
  if (prev.deletedAt !== null) {
    return { ok: false, code: "already_deleted", message: `record already deleted: ${recordId}` };
  }
  const now = deps.now();
  const seq = deps.nextSeq();
  const version = prev.version + 1;
  deps.sql.exec(
    "UPDATE records SET deleted_at = ?, updated_at = ?, updated_by = ?, seq = ?, version = ? WHERE id = ?",
    now,
    now,
    actor,
    seq,
    version,
    recordId,
  );
  deps.sql.exec("DELETE FROM relations WHERE source_id = ?", recordId);
  return {
    ok: true,
    record: { ...prev, deletedAt: now, updatedAt: now, updatedBy: actor, seq, version },
  };
}
```

`apps/api/src/tenant-do.ts` — import 追記とメソッド追加:

```ts
import { deleteRecordCore, type DeleteRecordResult } from "./do/delete-record";
```

```ts
  deleteRecord(recordId: string, actor: string): DeleteRecordResult {
    return this.ctx.storage.transactionSync(() =>
      deleteRecordCore(
        {
          sql: this.ctx.storage.sql,
          nextSeq: () => ++this.seq,
          now: () => new Date().toISOString(),
        },
        recordId,
        actor,
      ),
    );
  }
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm --filter @plyrs/api test` → PASS（40件）

- [ ] **Step 5: フォーマットとコミット**

```bash
pnpm format
git add apps/api/src/do/delete-record.ts apps/api/src/tenant-do.ts apps/api/test/delete.test.ts
git commit -m "feat: add tombstone deletion to the record write path"
```

---

### Task 10: 全体整合の最終確認

**Files:**
- Modify: なし（確認のみ。差分が出た場合のみ修正をコミット）

**Interfaces:**
- Consumes: 全タスクの成果物
- Produces: ルート4コマンド green のブランチ最終状態

- [ ] **Step 1: ルート全チェック**

Run: `pnpm lint && pnpm format:check && pnpm typecheck && pnpm test`
Expected: すべて exit 0・警告ゼロ。metamodel（46目安）+ db（2）+ api（40目安）全 PASS

- [ ] **Step 2: クリーンツリー確認**

Run: `git status --short --untracked-files=no`
Expected: 出力なし（未コミットの変更が残っていない）

- [ ] **Step 3: 差分が出た場合のみ**

フォーマット差分・型エラー等が出たら修正し、内容に応じた `chore:`/`fix:` コミットを作る（対象パスのみ `git add`）。

---

## Self-Review 結果

- **Spec coverage:** ロードマップ §2 Phase 2 行の項目 — Drizzle スキーマ（Task 2）、TenantDO + JIT migration（Task 3）、書き込み経路 validate→hook→帳簿→再投影（Task 6-8）、システム unique フック（Task 8）、content_type 登録 API（Task 4）、宣言ベース indexed の generated column DDL（Task 5）、削除トゥームストーン（Task 9）、G7 適用（Task 1）、seq 先置き（Task 2/7）— すべてタスクに対応。§4 申し送りの「ordinal = refs 配列 index」（Task 7 実装・テスト済み）、「重複 ref の dedup 方針」→ **裁定: dedup しない**（検証済み入力の verbatim 反映。UI 側の責務とし、Phase 4 の集合的マージ検討時に再訪）。alarm レジスタ・outbox は Phase 5 のスコープ（ロードマップの Phase 2 行に書かれた「outbox / alarm・有効化レジストリ」のスキーマ定義は、使用фェーズでのマイグレーション追加の方が YAGNI 適合のため意図的に Phase 5/9 へ送る）。
- **Placeholder scan:** TBD/TODO なし。条件付き指示（既知の不確定要素1-4）はすべて具体的な対処コマンド・変更内容付き。
- **Type consistency:** `ContentTypeRow`（Task 4）→ Task 7/8 の参照、`RecordSnapshot`/`WriteRecordParams`/`WriteRecordResult`（Task 7 types.ts）→ Task 8/9 の参照、`issuesToMessage`/`rowToDefinition`（Task 4）→ Task 7 の import、`computeChangeSet`（Task 6）→ Task 7 の呼び出し、`uniqueCheckHook`（Task 8）の text/number/datetime 限定 ↔ metamodel の unique 許可型 — 一致を確認済み。
- **実行者への注意:** Task 6 の `dataChanged` は本文中の注意書きどおり簡潔な形（三項演算子）での実装を推奨。テスト件数はレビュー修正で増えうるため「目安」であり、全件 PASS が基準。
