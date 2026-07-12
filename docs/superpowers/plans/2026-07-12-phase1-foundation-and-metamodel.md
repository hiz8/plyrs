# Phase 1: モノレポ基盤 + metamodel パッケージ 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** pnpm モノレポの土台（TS strict / oxlint / oxfmt / Vitest / CI）を作り、その上に `packages/metamodel`（フィールド型パレットのメタスキーマ、content_type 定義スキーマ、実行時 Zod スキーマ生成、寛容 read、relation 分離）を純関数群として TDD で実装する。

**Architecture:** metamodel はランタイム非依存の純関数パッケージ（Node / Workers / ブラウザ共用）。「型定義をデータとして持つ」（design-spec 4章）の物理形をここで確定し、後続の DO 書き込み経路（Phase 2）・同期（Phase 4）・管理画面フォーム（Phase 6)がすべてこのパッケージを消費する。Zod v4 でメタスキーマ（フィールド定義そのものの検証）と実行時スキーマ（content_type から生成する record 入力の検証）の二層を実装する。

**Tech Stack:** pnpm 10 workspaces（catalogs）/ TypeScript（strict + noUncheckedIndexedAccess）/ Zod v4 / Vitest 4 / oxlint 1.x / oxfmt（exact pin）/ GitHub Actions

## Global Constraints

- TypeScript は `strict: true` + `noUncheckedIndexedAccess: true`（tech-selection 2.1）
- oxfmt は **exact pin**（`^` 禁止。tech-selection 1.4 / 3章）
- ID は UUIDv7、36文字ハイフン付き小文字表記（tech-selection 2.10。仕様書の「ULID」は UUIDv7 に読み替え）
- datetime は UTC ISO8601（`Z` 終端のみ受理、オフセット付き拒否。design-spec 5章）
- 関係フィールドの値は `data` JSON に入れない（design-spec 6章）→ `splitRecordInput` が分離する
- システムフィールド `id/createdAt/updatedAt/createdBy/updatedBy/status/version` はユーザー定義フィールドの key として予約（design-spec 5章）
- プラグイン所有型は `pluginId.name` 形式で名前空間化、ユーザー型に `.` は使用不可（design-spec 4.1章）
- ワークフロー status は `draft | in_review | ready | archived` の4値固定（design-spec 7章）
- 依存バージョンは pnpm catalog で一元管理（tech-selection 2.2）
- パッケージ名スコープは `@plyrs/`

**設計判断（このフェーズで固定するもの）:**

- **record 入力スキーマは looseObject（未知キーは検証せず保持）**: 仕様 4.2 の「未知フィールドは無視（ただし破棄せず保持）」と遅延適合に従う。旧型定義時代のフィールドを含む record を、新しい定義しか知らないクライアントが再書き込みしても未知キーが破棄・拒否されない。タイポの黙過というトレードオフは、管理画面が定義済みフィールドしか書かないことで実質吸収する。
- **relation の値の正規形は `{type, id}` の参照オブジェクト**（多態 allowedTypes に対応。cardinality `one` は単一オブジェクト、`many` は配列）。
- **richtext の正規形はエンベロープ `{schemaVersion, doc}`**（tech-selection 2.7。doc の中身＝ProseMirror JSON はこの層では不透明な JSON 値として扱い、Phase 7 で検証を深める）。
- **TypeScript 7（ネイティブ版）を採用**。万一ツール互換の問題が出たら catalog を 5.9 系に差し替える（1行変更で全パッケージに効く）。

---

### Task 1: モノレポ土台

**Files:**
- Create: `pnpm-workspace.yaml`
- Create: `package.json`
- Create: `tsconfig.base.json`
- Create: `.oxlintrc.json`
- Create: `.gitignore`

**Interfaces:**
- Consumes: なし（最初のタスク）
- Produces: catalog 名 `typescript` / `zod` / `vitest` / `@types/node`（後続タスクの package.json が `"catalog:"` で参照）、ルートスクリプト `lint` / `format` / `format:check`

- [ ] **Step 1: ワークスペース定義と catalog を書く**

`pnpm-workspace.yaml`:

```yaml
packages:
  - "apps/*"
  - "packages/*"

catalog:
  typescript: "~7.0.2"
  zod: "^4.4.3"
  vitest: "^4.1.10"
  "@types/node": "^26.1.1"
```

- [ ] **Step 2: ルート package.json を書く**

`package.json`:

```json
{
  "name": "plyrs",
  "private": true,
  "packageManager": "pnpm@10.26.1",
  "scripts": {
    "lint": "oxlint .",
    "format": "oxfmt .",
    "format:check": "oxfmt --check .",
    "typecheck": "pnpm -r run typecheck",
    "test": "pnpm -r run test"
  },
  "devDependencies": {
    "oxlint": "^1.73.0",
    "oxfmt": "0.58.0"
  }
}
```

（oxfmt は exact pin、oxlint は minor 追従可 — tech-selection 3章のバージョン方針どおり）

- [ ] **Step 3: 共有 tsconfig を書く**

`tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": []
  }
}
```

- [ ] **Step 4: oxlint 設定と .gitignore を書く**

`.oxlintrc.json`:

```json
{
  "categories": {
    "correctness": "error",
    "suspicious": "warn"
  },
  "ignorePatterns": ["dist", "node_modules", ".wrangler", "coverage"]
}
```

`.gitignore`:

```
node_modules/
dist/
coverage/
.wrangler/
*.log
.env
.env.*
!.env.example
.DS_Store
```

- [ ] **Step 5: インストールとツール動作確認**

Run: `pnpm install`
Expected: ロックファイル `pnpm-lock.yaml` が生成され、エラーなく完了

Run: `pnpm lint`
Expected: `Found 0 warnings and 0 errors`（対象ファイルがまだ無くても正常終了すること）

Run: `pnpm format:check`
Expected: 差分なしで正常終了（exit 0）

- [ ] **Step 6: Commit**

```bash
git add pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json .oxlintrc.json .gitignore
git commit -m "chore: set up pnpm monorepo with oxlint/oxfmt toolchain"
```

---

### Task 2: metamodel パッケージ雛形 + システムフィールド定数

**Files:**
- Create: `packages/metamodel/package.json`
- Create: `packages/metamodel/tsconfig.json`
- Create: `packages/metamodel/vitest.config.ts`
- Create: `packages/metamodel/src/system-fields.ts`
- Test: `packages/metamodel/src/system-fields.test.ts`

**Interfaces:**
- Consumes: Task 1 の catalog（`"catalog:"` 参照）と `tsconfig.base.json`
- Produces: `SYSTEM_FIELD_KEYS: readonly string[]`（7要素）、`type SystemFieldKey`、`WORKFLOW_STATUSES: readonly ["draft","in_review","ready","archived"]`、`type WorkflowStatus`（Task 3 の fieldKeySchema と Phase 2 の DO スキーマが参照）

- [ ] **Step 1: パッケージ設定3ファイルを書く**

`packages/metamodel/package.json`:

```json
{
  "name": "@plyrs/metamodel",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "zod": "catalog:"
  },
  "devDependencies": {
    "@types/node": "catalog:",
    "typescript": "catalog:",
    "vitest": "catalog:"
  }
}
```

（`exports` が `.ts` を直接指すのは意図的: 消費側は常に Vite / wrangler / Vitest がバンドルするため、ビルドステップを持たない。tech-selection 2.2 のモノレポ型共有方針）

`packages/metamodel/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src", "vitest.config.ts"]
}
```

`packages/metamodel/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
  },
});
```

- [ ] **Step 2: 失敗するテストを書く**

`packages/metamodel/src/system-fields.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  SYSTEM_FIELD_KEYS,
  WORKFLOW_STATUSES,
} from "./system-fields";

describe("system fields", () => {
  it("defines the seven system field keys from design-spec §5", () => {
    expect(SYSTEM_FIELD_KEYS).toEqual([
      "id",
      "createdAt",
      "updatedAt",
      "createdBy",
      "updatedBy",
      "status",
      "version",
    ]);
  });

  it("defines the four workflow statuses from design-spec §7 (no 'published')", () => {
    expect(WORKFLOW_STATUSES).toEqual(["draft", "in_review", "ready", "archived"]);
    expect(WORKFLOW_STATUSES).not.toContain("published");
  });
});
```

- [ ] **Step 3: テストが失敗することを確認**

Run: `pnpm install && pnpm --filter @plyrs/metamodel test`
Expected: FAIL — `Cannot find module './system-fields'`（または同等の解決エラー）

- [ ] **Step 4: 実装を書く**

`packages/metamodel/src/system-fields.ts`:

```ts
// design-spec §5: 全型に無償付与されるシステムフィールド。
// ユーザー定義フィールドの key として使用不可（field-types.ts で強制）。
export const SYSTEM_FIELD_KEYS = [
  "id",
  "createdAt",
  "updatedAt",
  "createdBy",
  "updatedBy",
  "status",
  "version",
] as const;

export type SystemFieldKey = (typeof SYSTEM_FIELD_KEYS)[number];

// design-spec §7: records.status はワークフロー専用の固定4値。
// 公開状態は published_snapshots の有無が真実源であり、'published' という値は存在しない。
export const WORKFLOW_STATUSES = ["draft", "in_review", "ready", "archived"] as const;

export type WorkflowStatus = (typeof WORKFLOW_STATUSES)[number];
```

- [ ] **Step 5: テストが通ることを確認**

Run: `pnpm --filter @plyrs/metamodel test`
Expected: PASS（2 tests）

Run: `pnpm --filter @plyrs/metamodel typecheck`
Expected: エラーなし

- [ ] **Step 6: Commit**

```bash
git add packages/metamodel pnpm-lock.yaml
git commit -m "feat: scaffold @plyrs/metamodel with system field constants"
```

---

### Task 3: フィールド定義メタスキーマ

**Files:**
- Create: `packages/metamodel/src/field-types.ts`
- Test: `packages/metamodel/src/field-types.test.ts`

**Interfaces:**
- Consumes: `SYSTEM_FIELD_KEYS`（Task 2）
- Produces: `fieldDefinitionSchema`（Zod discriminated union）、`type FieldDefinition`、`type RelationFieldDefinition`、`FIELD_KEY_PATTERN: RegExp`（Task 4 が型 key の検証に再利用）

フィールド型パレット（design-spec §5）: スカラー基底 `text / number / boolean / datetime / json` + 構造型 `select / richtext / relation`。indexed / unique は宣言ベースで `config` に持つ（design-spec §5 論点J・33）。`indexed` は json / richtext / relation を除く全型に許可（json は不透明、richtext は本文、relation は relations テーブル側の索引で解決するため）。`unique` は一意性が意味を持つ **text / number / datetime のみ**に許可する（boolean は高々2値で無意味、select は選択肢集合ゆえ用途が薄い — 2026-07-12 ユーザー決定）。

- [ ] **Step 1: 失敗するテストを書く**

`packages/metamodel/src/field-types.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { fieldDefinitionSchema } from "./field-types";

describe("fieldDefinitionSchema", () => {
  it("accepts a minimal text field", () => {
    const result = fieldDefinitionSchema.safeParse({ key: "title", type: "text" });
    expect(result.success).toBe(true);
  });

  it("accepts a text field with maxLength / indexed / unique config", () => {
    const result = fieldDefinitionSchema.safeParse({
      key: "slug",
      type: "text",
      required: true,
      config: { maxLength: 200, indexed: true, unique: true },
    });
    expect(result.success).toBe(true);
  });

  it("rejects a key that collides with a system field", () => {
    const result = fieldDefinitionSchema.safeParse({ key: "createdAt", type: "text" });
    expect(result.success).toBe(false);
  });

  it("rejects a key that is not snake_case", () => {
    for (const key of ["Title", "1title", "my-field", "my.field"]) {
      expect(fieldDefinitionSchema.safeParse({ key, type: "text" }).success).toBe(false);
    }
  });

  it("rejects unknown config keys (strict objects)", () => {
    const result = fieldDefinitionSchema.safeParse({
      key: "title",
      type: "text",
      config: { maxLenght: 10 },
    });
    expect(result.success).toBe(false);
  });

  it("rejects indexed/unique on a json field (opaque escape hatch)", () => {
    const result = fieldDefinitionSchema.safeParse({
      key: "meta",
      type: "json",
      config: { indexed: true },
    });
    expect(result.success).toBe(false);
  });

  it("accepts a select field and rejects duplicate option values", () => {
    const base = {
      key: "category",
      type: "select",
      config: {
        options: [
          { value: "tech", label: "Tech" },
          { value: "life", label: "Life" },
        ],
        multiple: true,
        indexed: true,
      },
    };
    expect(fieldDefinitionSchema.safeParse(base).success).toBe(true);

    const dup = {
      ...base,
      config: {
        ...base.config,
        options: [
          { value: "tech", label: "Tech" },
          { value: "tech", label: "Tech again" },
        ],
      },
    };
    expect(fieldDefinitionSchema.safeParse(dup).success).toBe(false);
  });

  it("accepts a relation field with full config", () => {
    const result = fieldDefinitionSchema.safeParse({
      key: "authors",
      type: "relation",
      required: true,
      config: {
        allowedTypes: ["author"],
        cardinality: "many",
        ordered: true,
        snapshotEmbed: "id",
      },
    });
    expect(result.success).toBe(true);
  });

  it("rejects a relation field with empty allowedTypes or missing cardinality", () => {
    expect(
      fieldDefinitionSchema.safeParse({
        key: "authors",
        type: "relation",
        config: { allowedTypes: [], cardinality: "many" },
      }).success,
    ).toBe(false);
    expect(
      fieldDefinitionSchema.safeParse({
        key: "authors",
        type: "relation",
        config: { allowedTypes: ["author"] },
      }).success,
    ).toBe(false);
  });

  it("accepts richtext and datetime fields", () => {
    expect(fieldDefinitionSchema.safeParse({ key: "body", type: "richtext" }).success).toBe(true);
    expect(
      fieldDefinitionSchema.safeParse({
        key: "published_at",
        type: "datetime",
        config: { indexed: true },
      }).success,
    ).toBe(true);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm --filter @plyrs/metamodel test`
Expected: FAIL — `Cannot find module './field-types'`

- [ ] **Step 3: 実装を書く**

`packages/metamodel/src/field-types.ts`:

```ts
import { z } from "zod";
import { SYSTEM_FIELD_KEYS } from "./system-fields";

export const FIELD_KEY_PATTERN = /^[a-z][a-z0-9_]*$/;

export const fieldKeySchema = z
  .string()
  .regex(FIELD_KEY_PATTERN, "field key must be snake_case starting with a letter")
  .refine((key) => !(SYSTEM_FIELD_KEYS as readonly string[]).includes(key), {
    message: "field key collides with a reserved system field",
  });

const indexableConfig = {
  indexed: z.boolean().optional(),
  unique: z.boolean().optional(),
} as const;

const baseFieldShape = {
  key: fieldKeySchema,
  required: z.boolean().optional(),
} as const;

export const textFieldSchema = z.strictObject({
  ...baseFieldShape,
  type: z.literal("text"),
  config: z
    .strictObject({ ...indexableConfig, maxLength: z.number().int().positive().optional() })
    .optional(),
});

export const numberFieldSchema = z.strictObject({
  ...baseFieldShape,
  type: z.literal("number"),
  config: z
    .strictObject({ ...indexableConfig, integer: z.boolean().optional() })
    .optional(),
});

export const booleanFieldSchema = z.strictObject({
  ...baseFieldShape,
  type: z.literal("boolean"),
  config: z.strictObject({ indexed: z.boolean().optional() }).optional(),
});

export const datetimeFieldSchema = z.strictObject({
  ...baseFieldShape,
  type: z.literal("datetime"),
  config: z.strictObject({ ...indexableConfig }).optional(),
});

// json は不透明な脱出ハッチ（design-spec §5): indexed / unique を認めない
export const jsonFieldSchema = z.strictObject({
  ...baseFieldShape,
  type: z.literal("json"),
  config: z.strictObject({}).optional(),
});

export const selectFieldSchema = z
  .strictObject({
    ...baseFieldShape,
    type: z.literal("select"),
    config: z.strictObject({
      options: z
        .array(z.strictObject({ value: z.string().min(1), label: z.string().min(1) }))
        .min(1),
      multiple: z.boolean().optional(),
      indexed: z.boolean().optional(),
    }),
  })
  .superRefine((field, ctx) => {
    const values = field.config.options.map((option) => option.value);
    if (new Set(values).size !== values.length) {
      ctx.addIssue({
        code: "custom",
        path: ["config", "options"],
        message: "select option values must be unique",
      });
    }
  });

export const richtextFieldSchema = z.strictObject({
  ...baseFieldShape,
  type: z.literal("richtext"),
  config: z.strictObject({}).optional(),
});

export const relationFieldSchema = z.strictObject({
  ...baseFieldShape,
  type: z.literal("relation"),
  config: z.strictObject({
    allowedTypes: z.array(z.string().min(1)).min(1),
    cardinality: z.enum(["one", "many"]),
    ordered: z.boolean().optional(),
    snapshotEmbed: z.enum(["id", "value"]).optional(),
  }),
});

export const fieldDefinitionSchema = z.discriminatedUnion("type", [
  textFieldSchema,
  numberFieldSchema,
  booleanFieldSchema,
  datetimeFieldSchema,
  jsonFieldSchema,
  selectFieldSchema,
  richtextFieldSchema,
  relationFieldSchema,
]);

export type FieldDefinition = z.infer<typeof fieldDefinitionSchema>;
export type RelationFieldDefinition = z.infer<typeof relationFieldSchema>;
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm --filter @plyrs/metamodel test`
Expected: PASS（system-fields 2 + field-types 10 tests）

Run: `pnpm --filter @plyrs/metamodel typecheck`
Expected: エラーなし

- [ ] **Step 5: Commit**

```bash
git add packages/metamodel/src/field-types.ts packages/metamodel/src/field-types.test.ts
git commit -m "feat: add field definition meta-schema for the field type palette"
```

---

### Task 4: content_type 定義スキーマと名前空間規則

**Files:**
- Create: `packages/metamodel/src/content-type.ts`
- Test: `packages/metamodel/src/content-type.test.ts`

**Interfaces:**
- Consumes: `fieldDefinitionSchema` / `FIELD_KEY_PATTERN`（Task 3）
- Produces: `contentTypeDefinitionSchema`、`type ContentTypeDefinition`（Task 5・6 と Phase 2 の content_type 登録 API が消費。プロパティ: `id / key / name / fields / source / pluginId? / version`）

名前空間規則（design-spec §4.1）: `source='plugin'` の型 key は `{pluginId}.{name}` 形式必須。`source='user' | 'system'` の型 key に `.` は使用不可。`pluginId` は `source='plugin'` のときのみ許可・必須。

- [ ] **Step 1: 失敗するテストを書く**

`packages/metamodel/src/content-type.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { contentTypeDefinitionSchema } from "./content-type";

const UUID = "018f2b6a-7a0a-7000-8000-000000000001";

const baseType = {
  id: UUID,
  key: "article",
  name: "記事",
  fields: [
    { key: "title", type: "text", required: true },
    { key: "body", type: "richtext" },
  ],
  source: "user",
  version: 1,
};

describe("contentTypeDefinitionSchema", () => {
  it("accepts a valid user type", () => {
    expect(contentTypeDefinitionSchema.safeParse(baseType).success).toBe(true);
  });

  it("rejects duplicate field keys", () => {
    const result = contentTypeDefinitionSchema.safeParse({
      ...baseType,
      fields: [
        { key: "title", type: "text" },
        { key: "title", type: "number" },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a user type key containing a dot (reserved for plugins)", () => {
    const result = contentTypeDefinitionSchema.safeParse({ ...baseType, key: "booking.slot" });
    expect(result.success).toBe(false);
  });

  it("rejects pluginId on a user type", () => {
    const result = contentTypeDefinitionSchema.safeParse({ ...baseType, pluginId: "booking" });
    expect(result.success).toBe(false);
  });

  it("accepts a plugin type with a namespaced key", () => {
    const result = contentTypeDefinitionSchema.safeParse({
      ...baseType,
      key: "booking.slot",
      source: "plugin",
      pluginId: "booking",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a plugin type without pluginId", () => {
    const result = contentTypeDefinitionSchema.safeParse({
      ...baseType,
      key: "booking.slot",
      source: "plugin",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a plugin type whose key is outside its namespace", () => {
    const result = contentTypeDefinitionSchema.safeParse({
      ...baseType,
      key: "mailer.campaign",
      source: "plugin",
      pluginId: "booking",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a non-uuid id and a non-positive version", () => {
    expect(contentTypeDefinitionSchema.safeParse({ ...baseType, id: "not-a-uuid" }).success).toBe(false);
    expect(contentTypeDefinitionSchema.safeParse({ ...baseType, version: 0 }).success).toBe(false);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm --filter @plyrs/metamodel test`
Expected: FAIL — `Cannot find module './content-type'`

- [ ] **Step 3: 実装を書く**

`packages/metamodel/src/content-type.ts`:

```ts
import { z } from "zod";
import { FIELD_KEY_PATTERN, fieldDefinitionSchema } from "./field-types";

export const PLUGIN_ID_PATTERN = /^[a-z][a-z0-9_]*$/;
export const PLUGIN_TYPE_KEY_PATTERN = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;

export const contentTypeDefinitionSchema = z
  .strictObject({
    id: z.uuid(),
    key: z.string().min(1),
    name: z.string().min(1),
    fields: z.array(fieldDefinitionSchema),
    source: z.enum(["user", "plugin", "system"]),
    pluginId: z.string().regex(PLUGIN_ID_PATTERN).optional(),
    version: z.number().int().positive(),
  })
  .superRefine((contentType, ctx) => {
    const seen = new Set<string>();
    for (const field of contentType.fields) {
      if (seen.has(field.key)) {
        ctx.addIssue({
          code: "custom",
          path: ["fields"],
          message: `duplicate field key: ${field.key}`,
        });
      }
      seen.add(field.key);
    }

    if (contentType.source === "plugin") {
      if (contentType.pluginId === undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["pluginId"],
          message: "pluginId is required when source is 'plugin'",
        });
      } else if (
        !PLUGIN_TYPE_KEY_PATTERN.test(contentType.key) ||
        !contentType.key.startsWith(`${contentType.pluginId}.`)
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["key"],
          message: `plugin type key must be namespaced as '${contentType.pluginId}.<name>'`,
        });
      }
      return;
    }

    if (contentType.pluginId !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["pluginId"],
        message: "pluginId is only allowed when source is 'plugin'",
      });
    }
    if (!FIELD_KEY_PATTERN.test(contentType.key)) {
      ctx.addIssue({
        code: "custom",
        path: ["key"],
        message: "type key must be snake_case without dots",
      });
    }
  });

export type ContentTypeDefinition = z.infer<typeof contentTypeDefinitionSchema>;
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm --filter @plyrs/metamodel test`
Expected: PASS（累計 20 tests）

- [ ] **Step 5: Commit**

```bash
git add packages/metamodel/src/content-type.ts packages/metamodel/src/content-type.test.ts
git commit -m "feat: add content type definition schema with plugin namespace rules"
```

---

### Task 5: record 入力スキーマの実行時生成 + relation 分離

**Files:**
- Create: `packages/metamodel/src/record-schema.ts`
- Test: `packages/metamodel/src/record-schema.test.ts`

**Interfaces:**
- Consumes: `ContentTypeDefinition`（Task 4）、`FieldDefinition` / `RelationFieldDefinition`（Task 3）
- Produces:
  - `buildFieldValueSchema(field: FieldDefinition): z.ZodType<unknown>`（Task 6 の寛容 read が再利用）
  - `buildRecordInputSchema(contentType: ContentTypeDefinition): z.ZodObject`（validate-on-write の実体。Phase 2 の DO 書き込み経路と Phase 6 のフォームが消費）
  - `splitRecordInput(contentType, input): { data: Record<string, unknown>; relations: Array<{ fieldKey: string; refs: RelationRef[] }> }`（Phase 2 が relations テーブル再投影に使用）
  - `relationRefSchema`、`type RelationRef = { type: string; id: string }`
  - `richTextEnvelopeSchema`、`jsonValueSchema`、`type JsonValue`

- [ ] **Step 1: 失敗するテストを書く**

`packages/metamodel/src/record-schema.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { ContentTypeDefinition } from "./content-type";
import { buildRecordInputSchema, splitRecordInput } from "./record-schema";

const UUID = (n: number) => `018f2b6a-7a0a-7000-8000-00000000000${n}`;

const articleType: ContentTypeDefinition = {
  id: UUID(1),
  key: "article",
  name: "記事",
  source: "user",
  version: 1,
  fields: [
    { key: "title", type: "text", required: true, config: { maxLength: 200 } },
    { key: "published_at", type: "datetime", config: { indexed: true } },
    { key: "category", type: "select", config: { options: [{ value: "tech", label: "Tech" }, { value: "life", label: "Life" }], multiple: true } },
    { key: "body", type: "richtext" },
    { key: "authors", type: "relation", required: true, config: { allowedTypes: ["author"], cardinality: "many", ordered: true } },
    { key: "hero", type: "relation", config: { allowedTypes: ["asset"], cardinality: "one", snapshotEmbed: "value" } },
  ],
};

const validInput = {
  title: "こんにちは",
  published_at: "2026-07-12T00:00:00Z",
  category: ["tech"],
  body: { schemaVersion: 1, doc: { type: "doc", content: [] } },
  authors: [
    { type: "author", id: UUID(2) },
    { type: "author", id: UUID(3) },
  ],
  hero: { type: "asset", id: UUID(4) },
};

describe("buildRecordInputSchema", () => {
  it("accepts a fully valid input", () => {
    expect(buildRecordInputSchema(articleType).safeParse(validInput).success).toBe(true);
  });

  it("rejects when a required field is missing", () => {
    const { title: _title, ...rest } = validInput;
    expect(buildRecordInputSchema(articleType).safeParse(rest).success).toBe(false);
  });

  it("accepts when an optional field is absent", () => {
    const { hero: _hero, published_at: _p, ...rest } = validInput;
    expect(buildRecordInputSchema(articleType).safeParse(rest).success).toBe(true);
  });

  it("rejects a datetime with a timezone offset (UTC 'Z' only)", () => {
    const result = buildRecordInputSchema(articleType).safeParse({
      ...validInput,
      published_at: "2026-07-12T09:00:00+09:00",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a select value outside the declared options", () => {
    const result = buildRecordInputSchema(articleType).safeParse({
      ...validInput,
      category: ["sports"],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a relation ref whose type is not in allowedTypes", () => {
    const result = buildRecordInputSchema(articleType).safeParse({
      ...validInput,
      hero: { type: "author", id: UUID(2) },
    });
    expect(result.success).toBe(false);
  });

  it("rejects text longer than maxLength", () => {
    const result = buildRecordInputSchema(articleType).safeParse({
      ...validInput,
      title: "a".repeat(201),
    });
    expect(result.success).toBe(false);
  });

  it("preserves unknown keys (lazy conformance: 未知フィールドは保持)", () => {
    const result = buildRecordInputSchema(articleType).safeParse({
      ...validInput,
      legacy_field: "old value",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data["legacy_field"]).toBe("old value");
    }
  });
});

describe("splitRecordInput", () => {
  it("separates relation fields from data fields", () => {
    const { data, relations } = splitRecordInput(articleType, {
      ...validInput,
      legacy_field: "old value",
    });

    expect(Object.keys(data).sort()).toEqual(
      ["body", "category", "legacy_field", "published_at", "title"],
    );
    expect(relations).toEqual([
      {
        fieldKey: "authors",
        refs: [
          { type: "author", id: UUID(2) },
          { type: "author", id: UUID(3) },
        ],
      },
      { fieldKey: "hero", refs: [{ type: "asset", id: UUID(4) }] },
    ]);
  });

  it("normalizes cardinality 'one' into a single-element ref list", () => {
    const { relations } = splitRecordInput(articleType, validInput);
    const hero = relations.find((r) => r.fieldKey === "hero");
    expect(hero?.refs).toHaveLength(1);
  });

  it("omits absent relation fields", () => {
    const { hero: _hero, ...rest } = validInput;
    const { relations } = splitRecordInput(articleType, rest);
    expect(relations.map((r) => r.fieldKey)).toEqual(["authors"]);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm --filter @plyrs/metamodel test`
Expected: FAIL — `Cannot find module './record-schema'`

- [ ] **Step 3: 実装を書く**

`packages/metamodel/src/record-schema.ts`:

```ts
import { z } from "zod";
import type { ContentTypeDefinition } from "./content-type";
import type { FieldDefinition, RelationFieldDefinition } from "./field-types";

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

// tech-selection 2.7: AST ルートに schemaVersion を刻む。doc（ProseMirror JSON）は
// この層では不透明な JSON 値。ノード構造の検証は richtext 実装フェーズで深める。
export const richTextEnvelopeSchema = z.strictObject({
  schemaVersion: z.number().int().positive(),
  doc: jsonValueSchema,
});

export const relationRefSchema = z.strictObject({
  type: z.string().min(1),
  id: z.uuid(),
});

export type RelationRef = z.infer<typeof relationRefSchema>;

export function buildFieldValueSchema(field: FieldDefinition): z.ZodType<unknown> {
  switch (field.type) {
    case "text": {
      const maxLength = field.config?.maxLength;
      return maxLength === undefined ? z.string() : z.string().max(maxLength);
    }
    case "number":
      return field.config?.integer ? z.number().int() : z.number();
    case "boolean":
      return z.boolean();
    case "datetime":
      // 既定で UTC 'Z' 終端のみ受理（オフセット付きは拒否）— design-spec §5
      return z.iso.datetime();
    case "json":
      return jsonValueSchema;
    case "select": {
      const values = field.config.options.map((option) => option.value);
      const single = z.enum(values as [string, ...string[]]);
      return field.config.multiple ? z.array(single) : single;
    }
    case "richtext":
      return richTextEnvelopeSchema;
    case "relation": {
      const ref = relationRefSchema.refine(
        (value) => field.config.allowedTypes.includes(value.type),
        { message: `relation target type must be one of: ${field.config.allowedTypes.join(", ")}` },
      );
      return field.config.cardinality === "many" ? z.array(ref) : ref;
    }
  }
}

// validate-on-write の実体。looseObject により型定義に無いキーは検証せず素通しで保持する
// （design-spec §4.2 の遅延適合: 旧型定義時代のフィールドを破棄も拒否もしない）。
export function buildRecordInputSchema(contentType: ContentTypeDefinition) {
  const shape: Record<string, z.ZodType<unknown>> = {};
  for (const field of contentType.fields) {
    const valueSchema = buildFieldValueSchema(field);
    shape[field.key] = field.required ? valueSchema : valueSchema.optional();
  }
  return z.looseObject(shape);
}

export interface SplitRecordInput {
  data: Record<string, unknown>;
  relations: Array<{ fieldKey: string; refs: RelationRef[] }>;
}

// 前提: input は buildRecordInputSchema で検証済み（キャストはこの前提に依る）。
// data には relation 以外の全キー（未知キー含む）が入り、relation は
// cardinality 'one' も含めて refs 配列に正規化する — design-spec §6「関係は data に入れない」。
export function splitRecordInput(
  contentType: ContentTypeDefinition,
  input: Record<string, unknown>,
): SplitRecordInput {
  const relationFields = new Map<string, RelationFieldDefinition>();
  for (const field of contentType.fields) {
    if (field.type === "relation") {
      relationFields.set(field.key, field);
    }
  }

  const data: Record<string, unknown> = {};
  const relations: SplitRecordInput["relations"] = [];

  for (const field of contentType.fields) {
    const relationField = relationFields.get(field.key);
    if (relationField === undefined) {
      continue;
    }
    const value = input[field.key];
    if (value === undefined) {
      continue;
    }
    const refs =
      relationField.config.cardinality === "many"
        ? (value as RelationRef[])
        : [value as RelationRef];
    relations.push({ fieldKey: field.key, refs });
  }

  for (const [key, value] of Object.entries(input)) {
    if (!relationFields.has(key)) {
      data[key] = value;
    }
  }

  return { data, relations };
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm --filter @plyrs/metamodel test`
Expected: PASS（累計 31 tests）

Run: `pnpm --filter @plyrs/metamodel typecheck`
Expected: エラーなし

- [ ] **Step 5: Commit**

```bash
git add packages/metamodel/src/record-schema.ts packages/metamodel/src/record-schema.test.ts
git commit -m "feat: add runtime record schema generation and relation splitting"
```

---

### Task 6: 寛容 read（tolerant read）

**Files:**
- Create: `packages/metamodel/src/tolerant-read.ts`
- Test: `packages/metamodel/src/tolerant-read.test.ts`

**Interfaces:**
- Consumes: `buildFieldValueSchema`（Task 5）、`ContentTypeDefinition`（Task 4）
- Produces: `tolerantReadData(contentType, raw): { values: Record<string, unknown>; unknownKeys: string[]; invalidKeys: string[] }`（Phase 4 のクライアントコレクションと Phase 6 の表示層が消費）

design-spec §4.2: 読み取りは寛容。欠損は不在扱い、現行定義に不適合な旧形の値も不在扱い（ただし破棄しない — raw データそのものは呼び出し元が保持し続ける）、未知フィールドは無視しつつ保持対象として報告する。

- [ ] **Step 1: 失敗するテストを書く**

`packages/metamodel/src/tolerant-read.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { ContentTypeDefinition } from "./content-type";
import { tolerantReadData } from "./tolerant-read";

const articleType: ContentTypeDefinition = {
  id: "018f2b6a-7a0a-7000-8000-000000000001",
  key: "article",
  name: "記事",
  source: "user",
  version: 3,
  fields: [
    { key: "title", type: "text", required: true },
    { key: "view_count", type: "number", config: { integer: true } },
    { key: "authors", type: "relation", config: { allowedTypes: ["author"], cardinality: "many" } },
  ],
};

describe("tolerantReadData", () => {
  it("returns valid known fields", () => {
    const result = tolerantReadData(articleType, { title: "hello", view_count: 42 });
    expect(result.values).toEqual({ title: "hello", view_count: 42 });
    expect(result.unknownKeys).toEqual([]);
    expect(result.invalidKeys).toEqual([]);
  });

  it("treats missing fields as absent (even required ones — read is tolerant)", () => {
    const result = tolerantReadData(articleType, {});
    expect(result.values).toEqual({});
    expect(result.invalidKeys).toEqual([]);
  });

  it("treats values that no longer match the current definition as absent, reporting them", () => {
    const result = tolerantReadData(articleType, { title: 123, view_count: "many" });
    expect(result.values).toEqual({});
    expect(result.invalidKeys.sort()).toEqual(["title", "view_count"]);
  });

  it("reports unknown keys without dropping them from the caller's raw data", () => {
    const raw = { title: "hello", legacy_field: "keep me" };
    const result = tolerantReadData(articleType, raw);
    expect(result.values).toEqual({ title: "hello" });
    expect(result.unknownKeys).toEqual(["legacy_field"]);
    expect(raw.legacy_field).toBe("keep me");
  });

  it("skips relation fields (relations are not stored in data)", () => {
    const result = tolerantReadData(articleType, {
      title: "hello",
      authors: [{ type: "author", id: "018f2b6a-7a0a-7000-8000-000000000002" }],
    });
    expect(result.values).toEqual({ title: "hello" });
    // authors は定義済みフィールドなので unknown ではないが、data には本来存在しない
    expect(result.unknownKeys).toEqual([]);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm --filter @plyrs/metamodel test`
Expected: FAIL — `Cannot find module './tolerant-read'`

- [ ] **Step 3: 実装を書く**

`packages/metamodel/src/tolerant-read.ts`:

```ts
import type { ContentTypeDefinition } from "./content-type";
import { buildFieldValueSchema } from "./record-schema";

export interface TolerantReadResult {
  values: Record<string, unknown>;
  unknownKeys: string[];
  invalidKeys: string[];
}

// design-spec §4.2 寛容 read: records が最新の型定義に適合している保証はない前提で読む。
// 欠損・不適合は不在扱い（破棄はしない — raw は呼び出し元が保持）、未知キーは報告のみ。
export function tolerantReadData(
  contentType: ContentTypeDefinition,
  raw: Record<string, unknown>,
): TolerantReadResult {
  const values: Record<string, unknown> = {};
  const invalidKeys: string[] = [];
  const definedKeys = new Set<string>();

  for (const field of contentType.fields) {
    definedKeys.add(field.key);
    if (field.type === "relation") {
      continue;
    }
    const rawValue = raw[field.key];
    if (rawValue === undefined) {
      continue;
    }
    const result = buildFieldValueSchema(field).safeParse(rawValue);
    if (result.success) {
      values[field.key] = result.data;
    } else {
      invalidKeys.push(field.key);
    }
  }

  const unknownKeys = Object.keys(raw).filter((key) => !definedKeys.has(key));
  return { values, unknownKeys, invalidKeys };
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm --filter @plyrs/metamodel test`
Expected: PASS（累計 36 tests）

- [ ] **Step 5: Commit**

```bash
git add packages/metamodel/src/tolerant-read.ts packages/metamodel/src/tolerant-read.test.ts
git commit -m "feat: add tolerant read for lazy schema conformance"
```

---

### Task 7: 公開エクスポート + CI

**Files:**
- Create: `packages/metamodel/src/index.ts`
- Create: `.github/workflows/ci.yml`
- Test: `packages/metamodel/src/index.test.ts`

**Interfaces:**
- Consumes: Task 2〜6 の全モジュール
- Produces: `@plyrs/metamodel` のパッケージ公開面（後続フェーズはすべて `import { ... } from "@plyrs/metamodel"` で消費する）

- [ ] **Step 1: 失敗するテストを書く**

`packages/metamodel/src/index.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import * as metamodel from "./index";

describe("@plyrs/metamodel public surface", () => {
  it("exports the full public API", () => {
    expect(metamodel.SYSTEM_FIELD_KEYS).toBeDefined();
    expect(metamodel.WORKFLOW_STATUSES).toBeDefined();
    expect(metamodel.fieldDefinitionSchema).toBeDefined();
    expect(metamodel.contentTypeDefinitionSchema).toBeDefined();
    expect(metamodel.buildFieldValueSchema).toBeTypeOf("function");
    expect(metamodel.buildRecordInputSchema).toBeTypeOf("function");
    expect(metamodel.splitRecordInput).toBeTypeOf("function");
    expect(metamodel.tolerantReadData).toBeTypeOf("function");
    expect(metamodel.relationRefSchema).toBeDefined();
    expect(metamodel.richTextEnvelopeSchema).toBeDefined();
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm --filter @plyrs/metamodel test`
Expected: FAIL — `Cannot find module './index'`

- [ ] **Step 3: index.ts を書く**

`packages/metamodel/src/index.ts`:

```ts
export {
  SYSTEM_FIELD_KEYS,
  WORKFLOW_STATUSES,
  type SystemFieldKey,
  type WorkflowStatus,
} from "./system-fields";
export {
  FIELD_KEY_PATTERN,
  fieldDefinitionSchema,
  fieldKeySchema,
  relationFieldSchema,
  type FieldDefinition,
  type RelationFieldDefinition,
} from "./field-types";
export {
  PLUGIN_ID_PATTERN,
  PLUGIN_TYPE_KEY_PATTERN,
  contentTypeDefinitionSchema,
  type ContentTypeDefinition,
} from "./content-type";
export {
  buildFieldValueSchema,
  buildRecordInputSchema,
  jsonValueSchema,
  relationRefSchema,
  richTextEnvelopeSchema,
  splitRecordInput,
  type JsonValue,
  type RelationRef,
  type SplitRecordInput,
} from "./record-schema";
export { tolerantReadData, type TolerantReadResult } from "./tolerant-read";
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm --filter @plyrs/metamodel test`
Expected: PASS（累計 37 tests）

- [ ] **Step 5: CI workflow を書く**

`.github/workflows/ci.yml`:

```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm format:check
      - run: pnpm typecheck
      - run: pnpm test
```

- [ ] **Step 6: 全チェックをローカルで通す**

Run: `pnpm lint && pnpm format:check && pnpm typecheck && pnpm test`
Expected: すべて成功（lint 0 error / フォーマット差分なし / 型エラーなし / 37 tests PASS）

フォーマット差分が出た場合は `pnpm format` を実行してから再確認する。

- [ ] **Step 7: Commit**

```bash
git add packages/metamodel/src/index.ts packages/metamodel/src/index.test.ts .github/workflows/ci.yml
git commit -m "feat: add metamodel public exports and CI workflow"
```

---

## Self-Review 結果

- **Spec coverage**: Phase 1 のスコープ（フィールド型パレット §5、メタモデル §4、名前空間 §4.1、寛容 read / validate-on-write §4.2、関係の data 非格納 §6、システムフィールド §5、ワークフロー4値 §7）はすべてタスクに対応づけた。DO・同期・投影は後続フェーズ（ロードマップ参照）。
- **Placeholder scan**: 全ステップに実コード・実コマンド・期待結果を記載済み。TBD なし。
- **Type consistency**: `ContentTypeDefinition`（Task 4）→ Task 5・6 の引数型、`buildFieldValueSchema`（Task 5）→ Task 6 の再利用、`RelationRef` / `SplitRecordInput` の形は全タスクで一致していることを確認した。
- **注意点（実行者向け)**: Zod v4 の API（`z.strictObject` / `z.looseObject` / `z.uuid()` / `z.iso.datetime()` / discriminated union メンバーへの `superRefine`）を前提とする。zod@^4.4.3 で全テストが通ることが Task 3〜6 の検証で確認される。TypeScript 7 でツール互換問題が出た場合は catalog の `typescript` を `~5.9.0` に差し替えてよい（コードは変更不要）。
