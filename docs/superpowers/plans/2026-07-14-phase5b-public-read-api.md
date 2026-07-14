# Phase 5b: 公開 read API 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 投影 D1 だけを読む公開 read API（単体取得 / 一覧 + フィルタ + ソート + カーソル / 関係解決 / エッジキャッシュ）を実装する。DO は絶対に起こさない。

**Architecture:** `/public/v1/:tenantSlug/...` の Hono ルートが、コントロールプレーン D1 + KV キャッシュでテナントを解決し（G3）、共有投影 D1（projected_records / projected_relations / projection_index）だけを読む。フィルタ/ソートの検証と型別カラムの選択には、本フェーズで新設する **projection_fields（フィールドカタログ表）** を使う — 公開経路は DO 内の content_types を読めないため、「どのフィールドが索引宣言済みか・値がどの型別カラムにあるか・複数値か」を投影 upsert に相乗りして投影しておく（§12.2「フィールドの型は content_types から既知なので、クエリ層が適切な列を選べる」の公開側の実体）。前段に Cache API の短 TTL エッジキャッシュを置く（§12.6）。

**Tech Stack:** Hono / Cloudflare Workers（D1, KV, Cache API, Queues）/ drizzle-kit（migration 生成のみ）/ @cloudflare/vitest-pool-workers

## 裁定済み事項（2026-07-14。変更禁止）

1. **クエリ語彙**: `filter[field]=value`（ブラケット記法）。同一キー繰り返し = any-of（OR）、異なるフィールド間 = AND。関係メンバーシップも `filter[authors]=<recordId>` と同形。`sort=-published_at` / `limit` / `cursor` / `include`。単体取得は id と slug で別パス（レコード ID は UUID で slug とパス上区別できないため）:
   - `GET /public/v1/:tenantSlug/records/:type` — 一覧
   - `GET /public/v1/:tenantSlug/records/:type/:id` — id 単体
   - `GET /public/v1/:tenantSlug/records/:type/slug/:slug` — slug 単体
2. **カーソル**: keyset（ソートキー値, record_id）を JSON→base64url した**無署名**不透明トークン。tenant/type/フィルタはトークンに含めず毎回リクエストから束縛（改ざんしても他テナントに構造的に到達不能）。デコード不能・型不整合は 400。
3. **関係展開**: 既定はレコード内の関係フィールドを ID（参照オブジェクト）のまま返す。`?include=authors,category` 指定時のみトップレベル `included[]` に参照先レコードを重複排除して同梱。1 段のみ（ネスト不可）。未公開の参照先は included に現れない（ソフト参照）。
4. **キャッシュ**: Cache API + 短 TTL（`s-maxage=30`）。publish 時パージなし。キーは解決後の tenantId で正規化。
5. **レスポンス形**: 内部値（source_version / publish_seq / projected_at）非公開。単体 = `{ id, type, slug, publishedAt, fields }`、一覧 = `{ items, included?, nextCursor }`。publish_seq の ETag への内部利用は可。

## Global Constraints

- **公開 read は DO を絶対に起こさない**: `src/public/**` と `src/routes/public.ts` から `env.TENANT_DO` に触れるコードを書いてはならない（design-spec §3・§12.7 のコスト前提）。
- **公開 API は `projection_tombstones` を読まない**。`projected_records` に「未公開か」のフィルタや公開状態フラグを足してはならない（行が無ければ見えない、が構造的フェイルセーフ。Phase 5a 申し送り）。
- **フィルタ/ソートは索引宣言済みフィールドに限る**（無制限クエリは許さない）。**ソートは単一値の索引フィールドのみ**（複数値のソートは未定義 → 400 で拒否）。
- **関係解決は projected_relations に対してのみ**。参照先が投影に無ければ不在として扱う（エラーにしない）。
- `@ts-expect-error` と `any` は禁止。DO の RPC 戻り値は `apps/api/src/rpc-unwrap.ts` の型付きアンラップを必ず通す。
- bare `git stash` / `git stash pop` 禁止（スタックはリポジトリ共有）。node_modules をシンボリックリンクで用意しない。
- テストは全ファイルが 1 つの miniflare インスタンスとストレージを共有する（`vitest run --no-isolate --max-workers=1`）。**テナント ID は必ず `crypto.randomUUID()`**、レコード ID は `test/fixtures.ts` の `uuid(n)` でファイルごとに衝突しないレンジを使う。
- `SELF.queue()` は壊れている（DataCloneError）。Queue consumer は `worker.queue(batch, env, ctx)` + `createMessageBatch` / `getQueueResult` で叩く。
- drizzle マイグレーションは**必ず drizzle-kit で実生成**する（手書き禁止）。生成後に `pnpm format`（リポジトリルートで）を実行する。
- コメントは既存コードに合わせて日本語で書く（設計根拠を書く。what の逐語訳を書かない）。
- 公開ルートに認証を入れない（公開経路。§11 の認可はこの経路に存在しない）。
- テストコマンド（apps/api 単体ファイル）: `pnpm --filter @plyrs/api exec vitest run --no-isolate --max-workers=1 <path>`。全体: `pnpm --filter @plyrs/api test`。
- エラーレスポンスは既存の `{ error: "<code>" }` 形。クエリ検証エラーのみ `{ error: "bad_query", message: "<詳細>" }`。

## ファイル構造（このタスク分割で確定）

```
packages/db/src/projection.ts                 (Modify) projectionFields 表を追加
packages/db/drizzle-projection/0003_*.sql     (Generate) drizzle-kit 実生成
apps/api/src/projection/payload.ts            (Modify) ProjectionPayload に catalog を追加
apps/api/src/projection/consumer.ts           (Modify) カタログ upsert + 再投影 sweep
apps/api/src/public/tenant-resolver.ts        (Create) tenantSlug → tenantId（KV + control-plane D1）
apps/api/src/public/cursor.ts                 (Create) keyset カーソルの encode/decode
apps/api/src/public/catalog.ts                (Create) projection_fields のローダ
apps/api/src/public/query.ts                  (Create) クエリ文字列のパース/検証
apps/api/src/public/sql.ts                    (Create) 一覧 SQL ビルダ
apps/api/src/public/serialize.ts              (Create) 行 → 公開レスポンス形
apps/api/src/public/include.ts                (Create) 関係展開（included[]）
apps/api/src/public/cache.ts                  (Create) キャッシュキー正規化 + withEdgeCache
apps/api/src/routes/public.ts                 (Create) 公開ルート（Hono）
apps/api/src/index.ts                         (Modify) /public/v1 マウント
apps/api/wrangler.jsonc                       (Modify) TENANT_SLUGS KV バインディング
apps/api/env.d.ts                             (Modify) TENANT_SLUGS 型
apps/api/test/public-helpers.ts               (Create) 公開 API テスト共通ヘルパ
docs/design-spec.md                           (Modify) §12.2 に projection_fields を追記
```

---

### Task 1: projection_fields（フィールドカタログ表）のスキーマと migration

**Files:**
- Modify: `packages/db/src/projection.ts`
- Modify: `packages/db/src/projection.test.ts`
- Generate: `packages/db/drizzle-projection/0003_*.sql`

**Interfaces:**
- Consumes: 既存の drizzle スキーマ定義パターン（同ファイル内）
- Produces: `projectionFields`（drizzle table。列: `tenant_id, type, field_key, kind, multi, projected_at`、PK `(tenant_id, type, field_key)`）。Task 3 の consumer と Task 6 の `loadCatalog` がこの物理表を読む。`kind` の語彙は `'text' | 'num' | 'bool' | 'date' | 'relation'`（Task 2 の `CatalogKind`）。

- [ ] **Step 1: 失敗するテストを書く**

`packages/db/src/projection.test.ts` の import を更新し、describe 末尾（`keeps unpublish tombstones...` の it の後）にテストを追加:

```ts
// import 文を以下に置き換え
import {
  projectedRecords,
  projectedRelations,
  projectionFields,
  projectionIndex,
  projectionTombstones,
} from "./projection";
```

```ts
  // Phase 5b: 公開 read API は DO を起こせないため、「どのフィールドがフィルタ/ソート可能で、
  // 値がどの型別カラムに入っているか・複数値か」を content_types から投影しておく必要がある
  // （§12.4「フィルタ/ソートは索引宣言済みフィールドに限る」を DO 非経由で検証するための表）。
  it("keeps a per-type field catalog for the public read API (Phase 5b)", () => {
    expect(getTableName(projectionFields)).toBe("projection_fields");
    expect(projectionFields.tenantId).toBeDefined();
    expect(projectionFields.type).toBeDefined();
    expect(projectionFields.fieldKey).toBeDefined();
    expect(projectionFields.kind).toBeDefined();
    expect(projectionFields.multi).toBeDefined();
    expect(projectionFields.projectedAt).toBeDefined();
  });
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm --filter @plyrs/db test`
Expected: FAIL — `"projectionFields" is not exported` 相当のエラー

- [ ] **Step 3: スキーマを実装**

`packages/db/src/projection.ts` の末尾に追加:

```ts
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
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm --filter @plyrs/db test`
Expected: PASS（全テスト green）

- [ ] **Step 5: migration を実生成し、フォーマットする（手書き禁止）**

Run: `pnpm --filter @plyrs/db generate:projection && pnpm format`
Expected: `packages/db/drizzle-projection/0003_<自動命名>.sql` が生成され、`CREATE TABLE projection_fields` と PK 定義を含む。`meta/` 配下のスナップショットも更新される。生成物の中身を目視確認し、レポートに貼る。

- [ ] **Step 6: apps/api のテストが壊れていないことを確認（migration は vitest.config が自動で拾う）**

Run: `pnpm --filter @plyrs/api test`
Expected: PASS（既存 311 tests green のまま）

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/projection.ts packages/db/src/projection.test.ts packages/db/drizzle-projection/
git commit -m "feat: add the projection_fields catalog table for the public read api"
```

---

### Task 2: ProjectionPayload にカタログ行を載せる

**Files:**
- Modify: `apps/api/src/projection/payload.ts`
- Modify: `apps/api/src/projection/payload.test.ts`

**Interfaces:**
- Consumes: `FieldDefinition`（@plyrs/metamodel）
- Produces:
  - `export type CatalogKind = "text" | "num" | "bool" | "date" | "relation"`
  - `export interface CatalogRow { fieldKey: string; kind: CatalogKind; multi: boolean }`
  - `export function catalogRowsForFields(fields: FieldDefinition[]): CatalogRow[]`
  - `ProjectionPayload` に `catalog: CatalogRow[]` フィールドが追加される（Task 3 の consumer が書き込みに使う）

- [ ] **Step 1: 失敗するテストを書く**

`apps/api/src/projection/payload.test.ts` の import を更新し、ファイル末尾に describe を追加:

```ts
// import 文を以下に置き換え
import {
  buildProjectionPayload,
  catalogRowsForFields,
  promoteSlug,
  type PublishedSnapshot,
} from "./payload";
```

```ts
// Phase 5b: 公開 read API が「フィルタ/ソート可能なフィールドと型別カラム」を DO 非経由で
// 知るためのカタログ。indexed 宣言済みスカラーと関係フィールドだけが載る = 「フィルタ/ソートは
// 索引宣言済みフィールドに限る」（§12.4）の実体。
describe("catalogRowsForFields", () => {
  it("lists indexed scalar fields with their typed column kind", () => {
    const rows = catalogRowsForFields(fields);
    expect(rows).toContainEqual({ fieldKey: "slug", kind: "text", multi: false });
    expect(rows).toContainEqual({ fieldKey: "published_at", kind: "date", multi: false });
    expect(rows).toContainEqual({ fieldKey: "reading_minutes", kind: "num", multi: false });
    expect(rows).toContainEqual({ fieldKey: "featured", kind: "bool", multi: false });
  });

  it("marks an indexed multi-select as multi (sortable: no, filter: any-of)", () => {
    const rows = catalogRowsForFields(fields);
    expect(rows).toContainEqual({ fieldKey: "tags", kind: "text", multi: true });
  });

  it("always lists relation fields (projected_relations is projected unconditionally)", () => {
    const rows = catalogRowsForFields(fields);
    expect(rows).toContainEqual({ fieldKey: "authors", kind: "relation", multi: true });
  });

  it("omits fields that are not indexed and cannot be filtered", () => {
    const keys = catalogRowsForFields(fields).map((row) => row.fieldKey);
    expect(keys).not.toContain("title"); // indexed 宣言なし
    expect(keys).not.toContain("body"); // richtext は indexed を持てない
  });

  it("rides on buildProjectionPayload", () => {
    const payload = buildProjectionPayload(fields, snapshot({ slug: "hello" }));
    expect(payload.catalog).toStrictEqual(catalogRowsForFields(fields));
  });
});
```

（`fields` / `snapshot` は同ファイル既存のフィクスチャをそのまま使う。`fields` には `authors` relation / `tags` multi-select indexed / `title` 非 indexed が既にある。）

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm --filter @plyrs/api exec vitest run --no-isolate --max-workers=1 src/projection/payload.test.ts`
Expected: FAIL — `catalogRowsForFields` が未定義

- [ ] **Step 3: 実装**

`apps/api/src/projection/payload.ts` — `ProjectionIndexRow` の直後に型を追加し、`ProjectionPayload` に `catalog` を足し、`buildProjectionPayload` を拡張:

```ts
// Phase 5b: 公開 read API のフィールドカタログ（§12.4）。kind は projection_index の型別カラム
// （bool は value_num の 0/1）に対応し、'relation' は projected_relations を引く。multi=true は
// ソート不可（行分割で順序が未定義）。
export type CatalogKind = "text" | "num" | "bool" | "date" | "relation";

export interface CatalogRow {
  fieldKey: string;
  kind: CatalogKind;
  multi: boolean;
}

// indexed 宣言済みスカラーと関係フィールドだけが載る。関係は projected_relations が常に全量
// 投影されるため宣言不要でフィルタ（メンバーシップ）可能。
export function catalogRowsForFields(fields: FieldDefinition[]): CatalogRow[] {
  const rows: CatalogRow[] = [];
  for (const field of fields) {
    switch (field.type) {
      case "text":
        if (field.config?.indexed === true) {
          rows.push({ fieldKey: field.key, kind: "text", multi: false });
        }
        break;
      case "number":
        if (field.config?.indexed === true) {
          rows.push({ fieldKey: field.key, kind: "num", multi: false });
        }
        break;
      case "boolean":
        if (field.config?.indexed === true) {
          rows.push({ fieldKey: field.key, kind: "bool", multi: false });
        }
        break;
      case "datetime":
        if (field.config?.indexed === true) {
          rows.push({ fieldKey: field.key, kind: "date", multi: false });
        }
        break;
      case "select":
        if (field.config.indexed === true) {
          rows.push({ fieldKey: field.key, kind: "text", multi: field.config.multiple === true });
        }
        break;
      case "relation":
        rows.push({
          fieldKey: field.key,
          kind: "relation",
          multi: field.config.cardinality === "many",
        });
        break;
      default:
        // json / richtext はフィルタ/ソート不可（indexed を構造的に持てない）
        break;
    }
  }
  return rows;
}
```

`ProjectionPayload` interface に 1 行追加:

```ts
  index: ProjectionIndexRow[];
  catalog: CatalogRow[]; // Phase 5b: 公開 read API のフィルタ/ソート検証用（型レベル情報）
```

`buildProjectionPayload` の return に 1 行追加:

```ts
    index: fields.flatMap((field) => indexRowsForField(field, snapshot.data)),
    catalog: catalogRowsForFields(fields),
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm --filter @plyrs/api exec vitest run --no-isolate --max-workers=1 src/projection/payload.test.ts`
Expected: PASS

- [ ] **Step 5: typecheck（ProjectionPayload を組む他の箇所が壊れていないか）**

Run: `pnpm --filter @plyrs/api typecheck`
Expected: PASS（`buildProjectionPayload` 経由でしか payload を組んでいないため追随不要のはず。エラーが出たらその箇所も `catalog` を通す）

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/projection/payload.ts apps/api/src/projection/payload.test.ts
git commit -m "feat: carry the field catalog on the projection payload"
```

---

### Task 3: consumer がカタログを書き、再投影 sweep が掃く

**Files:**
- Modify: `apps/api/src/projection/consumer.ts`
- Create: `apps/api/test/projection-catalog.test.ts`

**Interfaces:**
- Consumes: `ProjectionPayload.catalog`（Task 2）、`projection_fields` 表（Task 1）
- Produces: `upsertStatements()` がカタログ行を LWW upsert する。`handleReprojectJob` の終端 sweep が `projected_at < epoch - SWEEP_SKEW_MARGIN_MS` のカタログ行を削除する。`deleteStatements()` はカタログに触らない（型レベル情報のため）。

- [ ] **Step 1: 失敗するテストを書く**

Create `apps/api/test/projection-catalog.test.ts`:

```ts
import { createExecutionContext, createMessageBatch, getQueueResult } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import worker from "../src/index";
import type { ProjectionJob } from "../src/projection/jobs";
import type { TenantDO } from "../src/tenant-do";
import { articleType, auth, uuid, validArticleInput } from "./fixtures";
import { asPublishResult, asWriteResult } from "./rpc-unwrap";

const QUEUE_NAME = "plyrs-projection";

async function deliver(jobs: ProjectionJob[]) {
  const batch = createMessageBatch<ProjectionJob>(
    QUEUE_NAME,
    jobs.map((body, i) => ({ id: `m${i}`, timestamp: new Date(1_000 + i), attempts: 1, body })),
  );
  const ctx = createExecutionContext();
  await worker.queue(batch, env, ctx);
  return getQueueResult(batch, ctx);
}

interface CatalogRow {
  field_key: string;
  kind: string;
  multi: number;
}

async function catalogRows(tenantId: string, type: string): Promise<CatalogRow[]> {
  const { results } = await env.PROJECTION_DB.prepare(
    "SELECT field_key, kind, multi FROM projection_fields WHERE tenant_id = ?1 AND type = ?2 ORDER BY field_key",
  )
    .bind(tenantId, type)
    .all<CatalogRow>();
  return results;
}

describe("projection field catalog (Phase 5b)", () => {
  let tenantId: string;
  let stub: DurableObjectStub<TenantDO>;
  const recordId = uuid(300);
  let upsertJob: ProjectionJob;

  beforeEach(async () => {
    tenantId = crypto.randomUUID();
    stub = env.TENANT_DO.get(env.TENANT_DO.idFromName(tenantId));
    await stub.registerContentType(articleType(), auth("owner1"));
    const written = asWriteResult(
      await stub.writeRecord("article", { recordId, input: validArticleInput() }, auth("owner1")),
    );
    expect(written.ok).toBe(true);
    const published = asPublishResult(await stub.publishRecord(tenantId, recordId, auth("owner1")));
    if (!published.ok) {
      throw new Error(`publish failed: ${published.code}`);
    }
    upsertJob = {
      jobType: "upsert",
      tenantId,
      recordId,
      sourceVersion: published.snapshot.sourceVersion,
      publishSeq: published.snapshot.publishSeq,
    };
  });

  it("projects the catalog rows alongside the record upsert", async () => {
    await deliver([upsertJob]);
    // articleType: slug(text idx) / published_at(datetime idx) / authors(relation many) /
    // hero(relation one)。tags は indexed 宣言が無いので載らない。title / body も載らない。
    expect(await catalogRows(tenantId, "article")).toStrictEqual([
      { field_key: "authors", kind: "relation", multi: 1 },
      { field_key: "hero", kind: "relation", multi: 0 },
      { field_key: "published_at", kind: "date", multi: 0 },
      { field_key: "slug", kind: "text", multi: 0 },
    ]);
  });

  it("is idempotent under redelivery", async () => {
    await deliver([upsertJob]);
    await deliver([upsertJob]);
    expect((await catalogRows(tenantId, "article")).length).toBe(4);
  });

  it("does not touch the catalog on a delete job (type-level info outlives one record)", async () => {
    await deliver([upsertJob]);
    await deliver([
      {
        jobType: "delete",
        tenantId,
        recordId,
        sourceVersion: 1,
        publishSeq: upsertJob.jobType === "upsert" ? upsertJob.publishSeq + 1 : 0,
      },
    ]);
    expect((await catalogRows(tenantId, "article")).length).toBe(4);
  });

  it("sweeps catalog rows the reprojection walk did not refresh (removed declarations)", async () => {
    await deliver([upsertJob]);
    // 宣言から消えたフィールドの残骸を偽装（projected_at が sweep 境界より十分古い行）
    await env.PROJECTION_DB.prepare(
      "INSERT INTO projection_fields (tenant_id, type, field_key, kind, multi, projected_at) VALUES (?1, 'article', 'ghost', 'text', 0, ?2)",
    )
      .bind(tenantId, Date.now() - 10 * 60_000)
      .run();
    await deliver([{ jobType: "reproject", tenantId, cursor: null, epoch: Date.now() }]);
    const keys = (await catalogRows(tenantId, "article")).map((row) => row.field_key);
    expect(keys).not.toContain("ghost");
    // 歩きが刷新した現役の 4 行は生き残る
    expect(keys).toStrictEqual(["authors", "hero", "published_at", "slug"]);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm --filter @plyrs/api exec vitest run --no-isolate --max-workers=1 test/projection-catalog.test.ts`
Expected: FAIL — `projects the catalog rows...` で `toStrictEqual([])` 側（カタログ行が 0 件）

- [ ] **Step 3: consumer を実装**

`apps/api/src/projection/consumer.ts` の `upsertStatements()` 内、`for (const indexRow of payload.index)` ループの**後**（`return statements;` の前）に追加:

```ts
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
```

`handleReprojectJob` の終端 sweep の `PROJECTION_DB.batch([...])` 配列の末尾（projection_index の DELETE の後）に追加:

```ts
    // Phase 5b: 宣言から消えたフィールドのカタログ行を掃く。境界の向きの議論は上の
    // projected_records と同一（甘い方向にしか間違えない）。
    env.PROJECTION_DB.prepare(
      "DELETE FROM projection_fields WHERE tenant_id = ?1 AND projected_at < ?2",
    ).bind(job.tenantId, job.epoch - SWEEP_SKEW_MARGIN_MS),
```

`deleteStatements()` は変更しない。

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm --filter @plyrs/api exec vitest run --no-isolate --max-workers=1 test/projection-catalog.test.ts`
Expected: PASS（4 tests）

- [ ] **Step 5: 既存の consumer / e2e テストが壊れていないことを確認**

Run: `pnpm --filter @plyrs/api exec vitest run --no-isolate --max-workers=1 test/projection-consumer.test.ts test/projection-e2e.test.ts test/reproject.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/projection/consumer.ts apps/api/test/projection-catalog.test.ts
git commit -m "feat: project the field catalog and sweep it on reprojection"
```

---

### Task 4: TENANT_SLUGS KV バインディングとテナント解決

**Files:**
- Modify: `apps/api/wrangler.jsonc`
- Modify: `apps/api/env.d.ts`
- Create: `apps/api/src/public/tenant-resolver.ts`
- Create: `apps/api/test/public-tenant-resolver.test.ts`

**Interfaces:**
- Consumes: `env.DB`（control-plane D1 の `tenants(id, slug, ...)`）、新 KV `env.TENANT_SLUGS`
- Produces: `export async function resolveTenantId(env: Env, slug: string): Promise<string | null>`（null = 未知のテナント）

- [ ] **Step 1: バインディングを追加**

`apps/api/wrangler.jsonc` の `kv_namespaces` を置き換え:

```jsonc
  "kv_namespaces": [
    { "binding": "BLOCKLIST", "id": "00000000000000000000000000000000" },
    // Phase 5b (G3): 公開 read の tenantSlug→tenantId 解決キャッシュ。BLOCKLIST は認証用なので流用しない
    { "binding": "TENANT_SLUGS", "id": "00000000000000000000000000000001" },
  ],
```

`apps/api/env.d.ts` の `EnvBindings` 内、`BLOCKLIST: KVNamespace;` の直後に追加:

```ts
  // Phase 5b (G3): 公開 read の tenantSlug→tenantId 解決キャッシュ（公開経路は DO を起こさない）
  TENANT_SLUGS: KVNamespace;
```

- [ ] **Step 2: 失敗するテストを書く**

Create `apps/api/test/public-tenant-resolver.test.ts`:

```ts
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { resolveTenantId } from "../src/public/tenant-resolver";

async function seedTenant(id: string, slug: string): Promise<void> {
  await env.DB.prepare("INSERT INTO tenants (id, slug, name, created_at) VALUES (?1, ?2, ?3, ?4)")
    .bind(id, slug, `tenant ${slug}`, "2026-07-14T00:00:00.000Z")
    .run();
}

function freshSlug(): string {
  return `t-${crypto.randomUUID().slice(0, 12)}`;
}

describe("resolveTenantId (design-spec §12.7 / G3)", () => {
  it("resolves a known slug through the control-plane D1", async () => {
    const id = crypto.randomUUID();
    const slug = freshSlug();
    await seedTenant(id, slug);
    expect(await resolveTenantId(env, slug)).toBe(id);
  });

  it("serves repeat lookups from KV (D1 row can disappear, the answer stays)", async () => {
    const id = crypto.randomUUID();
    const slug = freshSlug();
    await seedTenant(id, slug);
    expect(await resolveTenantId(env, slug)).toBe(id);
    await env.DB.prepare("DELETE FROM tenants WHERE id = ?1").bind(id).run();
    // KV にキャッシュ済みなので、D1 から消えても TTL 内は解決できる（結果整合を受容）
    expect(await resolveTenantId(env, slug)).toBe(id);
  });

  it("caches a miss (a slug created right after keeps 404ing until the TTL)", async () => {
    const slug = freshSlug();
    expect(await resolveTenantId(env, slug)).toBeNull();
    await seedTenant(crypto.randomUUID(), slug);
    // 負キャッシュが効いている（未知 slug 連打でコントロールプレーン D1 を叩かせない）
    expect(await resolveTenantId(env, slug)).toBeNull();
  });

  it("returns null for an unknown slug", async () => {
    expect(await resolveTenantId(env, freshSlug())).toBeNull();
  });
});
```

- [ ] **Step 3: テストが失敗することを確認**

Run: `pnpm --filter @plyrs/api exec vitest run --no-isolate --max-workers=1 test/public-tenant-resolver.test.ts`
Expected: FAIL — モジュール `../src/public/tenant-resolver` が存在しない

- [ ] **Step 4: 実装**

Create `apps/api/src/public/tenant-resolver.ts`:

```ts
// design-spec §12.7 / G3（2026-07-13 裁定）: 公開 read のテナント解決。
// tenantSlug → tenantId をコントロールプレーン D1 + KV キャッシュで解決し、DO は絶対に
// 起こさない。KV は結果整合（〜60s）だが、この対応は slug の付け替えでしか変わらず、
// TTL で陳腐化が有界なので公開経路には十分。

const HIT_TTL_SECONDS = 300;
// KV の最小 TTL は 60s。未知 slug の連打がコントロールプレーン D1 へ素通りするのを防ぐ負キャッシュ
const MISS_TTL_SECONDS = 60;

interface CacheEntry {
  id: string | null; // null = 「存在しない」を覚えた負キャッシュ
}

export async function resolveTenantId(env: Env, slug: string): Promise<string | null> {
  const key = `tenant-slug:${slug}`;
  const cached = await env.TENANT_SLUGS.get<CacheEntry>(key, "json");
  if (cached !== null) {
    return cached.id;
  }
  const row = await env.DB.prepare("SELECT id FROM tenants WHERE slug = ?1")
    .bind(slug)
    .first<{ id: string }>();
  const id = row?.id ?? null;
  await env.TENANT_SLUGS.put(key, JSON.stringify({ id } satisfies CacheEntry), {
    expirationTtl: id === null ? MISS_TTL_SECONDS : HIT_TTL_SECONDS,
  });
  return id;
}
```

- [ ] **Step 5: テストが通ることを確認**

Run: `pnpm --filter @plyrs/api exec vitest run --no-isolate --max-workers=1 test/public-tenant-resolver.test.ts`
Expected: PASS（4 tests）

- [ ] **Step 6: Commit**

```bash
git add apps/api/wrangler.jsonc apps/api/env.d.ts apps/api/src/public/tenant-resolver.ts apps/api/test/public-tenant-resolver.test.ts
git commit -m "feat: resolve public tenant slugs via control-plane d1 with a kv cache"
```

---

### Task 5: keyset カーソルのコーデック

**Files:**
- Create: `apps/api/src/public/cursor.ts`
- Create: `apps/api/src/public/cursor.test.ts`

**Interfaces:**
- Consumes: なし（純粋関数）
- Produces:
  - `export interface CursorPayload { k: string | number | null; id: string }`
  - `export function encodeCursor(payload: CursorPayload): string`
  - `export function decodeCursor(token: string): CursorPayload | null`（null = 不正トークン → 呼び出し側が 400）

- [ ] **Step 1: 失敗するテストを書く**

Create `apps/api/src/public/cursor.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { decodeCursor, encodeCursor } from "./cursor";

describe("keyset cursor codec (裁定 2026-07-14: 無署名 base64url)", () => {
  it("round-trips string, number, and unicode sort keys", () => {
    const cases = [
      { k: "2026-07-14T00:00:00.000Z", id: "018f2b6a-7a0a-7000-8000-000000000001" },
      { k: 42.5, id: "r2" },
      { k: "日本語のタイトル", id: "r3" },
      { k: null, id: "r4" },
    ];
    for (const payload of cases) {
      expect(decodeCursor(encodeCursor(payload))).toStrictEqual(payload);
    }
  });

  it("emits url-safe tokens (no +, /, =)", () => {
    const token = encodeCursor({ k: "a?b&c=d/e+f", id: "r1" });
    expect(token).not.toMatch(/[+/=]/u);
  });

  it("rejects garbage, non-json, and wrong shapes with null (caller turns it into 400)", () => {
    expect(decodeCursor("%%%not-base64%%%")).toBeNull();
    expect(decodeCursor(btoa("not json"))).toBeNull();
    expect(decodeCursor(btoa(JSON.stringify(["k", "id"])))).toBeNull();
    expect(decodeCursor(btoa(JSON.stringify({ k: "x" })))).toBeNull(); // id 欠落
    expect(decodeCursor(btoa(JSON.stringify({ k: { nested: true }, id: "r" })))).toBeNull();
    expect(decodeCursor(btoa(JSON.stringify({ k: "x", id: 7 })))).toBeNull(); // id が非文字列
    expect(decodeCursor("")).toBeNull();
  });

  it("caps token length (defense against abuse)", () => {
    expect(decodeCursor("A".repeat(600))).toBeNull();
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm --filter @plyrs/api exec vitest run --no-isolate --max-workers=1 src/public/cursor.test.ts`
Expected: FAIL — モジュールが存在しない

- [ ] **Step 3: 実装**

Create `apps/api/src/public/cursor.ts`:

```ts
// 裁定（2026-07-14）: keyset カーソル。(ソートキー値, record_id) を JSON→base64url した
// 無署名の不透明トークン。tenant / type / フィルタ条件はトークンに含めず毎回リクエストから
// 束縛するため、改ざんしても他テナントのデータには構造的に到達できない（署名を持たない根拠）。
// デコード不能・型不整合は呼び出し側（query.ts）が 400 にする。

export interface CursorPayload {
  k: string | number | null; // ソートキー値（published_at 文字列 / projection_index の索引値）
  id: string; // record_id タイブレーク
}

const MAX_TOKEN_LENGTH = 512;

export function encodeCursor(payload: CursorPayload): string {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

export function decodeCursor(token: string): CursorPayload | null {
  if (token.length === 0 || token.length > MAX_TOKEN_LENGTH) {
    return null;
  }
  let binary: string;
  try {
    binary = atob(token.replaceAll("-", "+").replaceAll("_", "/"));
  } catch {
    return null;
  }
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  const candidate = parsed as { k?: unknown; id?: unknown };
  if (typeof candidate.id !== "string" || candidate.id.length === 0) {
    return null;
  }
  const k = candidate.k ?? null;
  if (k !== null && typeof k !== "string" && typeof k !== "number") {
    return null;
  }
  return { k, id: candidate.id };
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm --filter @plyrs/api exec vitest run --no-isolate --max-workers=1 src/public/cursor.test.ts`
Expected: PASS（4 tests）

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/public/cursor.ts apps/api/src/public/cursor.test.ts
git commit -m "feat: add the keyset cursor codec for public list pagination"
```

---

### Task 6: カタログローダとクエリパーサ

**Files:**
- Create: `apps/api/src/public/catalog.ts`
- Create: `apps/api/src/public/catalog.test.ts`
- Create: `apps/api/src/public/query.ts`
- Create: `apps/api/src/public/query.test.ts`

**Interfaces:**
- Consumes: `CatalogKind`（Task 2）、`decodeCursor` / `CursorPayload`（Task 5）、`projection_fields` 表（Task 1/3）
- Produces:
  - `export interface CatalogEntry { kind: CatalogKind; multi: boolean }` / `export type Catalog = Map<string, CatalogEntry>`
  - `export async function loadCatalog(db: D1Database, tenantId: string, type: string): Promise<Catalog>`
  - `export interface ScalarFilter { target: "index"; fieldKey: string; column: "value_text" | "value_num" | "value_date"; values: (string | number)[] }`
  - `export interface RelationFilter { target: "relations"; fieldKey: string; values: string[] }`
  - `export type ListFilter = ScalarFilter | RelationFilter`
  - `export interface ListSort { fieldKey: string; column: "published_at" | "value_text" | "value_num" | "value_date"; direction: "asc" | "desc" }`
  - `export interface ListCursor { k: string | number; id: string }`
  - `export interface ListQuery { filters: ListFilter[]; sort: ListSort; limit: number; cursor: ListCursor | null; include: string[] }`
  - `export type ParseResult = { ok: true; query: ListQuery } | { ok: false; error: string }`
  - `export function parseListQuery(params: Record<string, string[]>, catalog: Catalog): ParseResult`
  - `export function parseInclude(raw: string, catalog: Catalog): { ok: true; include: string[] } | { ok: false; error: string }`
  - 定数 `DEFAULT_LIMIT = 20` / `MAX_LIMIT = 100`

- [ ] **Step 1: 失敗するテストを書く（カタログローダ）**

Create `apps/api/src/public/catalog.test.ts`:

```ts
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { loadCatalog } from "./catalog";

describe("loadCatalog", () => {
  it("loads the projected field catalog into a map", async () => {
    const tenantId = crypto.randomUUID();
    const rows = [
      ["rating", "num", 0],
      ["tags", "text", 1],
      ["authors", "relation", 1],
    ] as const;
    for (const [fieldKey, kind, multi] of rows) {
      await env.PROJECTION_DB.prepare(
        "INSERT INTO projection_fields (tenant_id, type, field_key, kind, multi, projected_at) VALUES (?1, 'post', ?2, ?3, ?4, 0)",
      )
        .bind(tenantId, fieldKey, kind, multi)
        .run();
    }
    const catalog = await loadCatalog(env.PROJECTION_DB, tenantId, "post");
    expect(catalog.get("rating")).toStrictEqual({ kind: "num", multi: false });
    expect(catalog.get("tags")).toStrictEqual({ kind: "text", multi: true });
    expect(catalog.get("authors")).toStrictEqual({ kind: "relation", multi: true });
    expect(catalog.get("nope")).toBeUndefined();
  });

  it("returns an empty map for an unknown type (no rows)", async () => {
    const catalog = await loadCatalog(env.PROJECTION_DB, crypto.randomUUID(), "ghost");
    expect(catalog.size).toBe(0);
  });
});
```

- [ ] **Step 2: 失敗するテストを書く（パーサ）**

Create `apps/api/src/public/query.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { Catalog } from "./catalog";
import { encodeCursor } from "./cursor";
import { DEFAULT_LIMIT, parseInclude, parseListQuery } from "./query";

function catalog(): Catalog {
  return new Map([
    ["slug", { kind: "text", multi: false }],
    ["rating", { kind: "num", multi: false }],
    ["featured", { kind: "bool", multi: false }],
    ["event_at", { kind: "date", multi: false }],
    ["tags", { kind: "text", multi: true }],
    ["authors", { kind: "relation", multi: true }],
    // ユーザーが published_at という索引フィールドを宣言したケース（システム列と同名）
    ["published_at", { kind: "date", multi: false }],
  ]);
}

function emptyCatalog(): Catalog {
  return new Map();
}

describe("parseListQuery (§12.4 の語彙)", () => {
  it("defaults to -published_at (system column), limit 20, no filters", () => {
    const parsed = parseListQuery({}, emptyCatalog());
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.query).toStrictEqual({
      filters: [],
      sort: { fieldKey: "published_at", column: "published_at", direction: "desc" },
      limit: DEFAULT_LIMIT,
      cursor: null,
      include: [],
    });
  });

  it("routes scalar filters to the typed column, any-of within a key", () => {
    const parsed = parseListQuery(
      { "filter[rating]": ["3", "5"], "filter[slug]": ["hello"] },
      catalog(),
    );
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.query.filters).toContainEqual({
      target: "index",
      fieldKey: "rating",
      column: "value_num",
      values: [3, 5],
    });
    expect(parsed.query.filters).toContainEqual({
      target: "index",
      fieldKey: "slug",
      column: "value_text",
      values: ["hello"],
    });
  });

  it("parses boolean filters as true/false onto value_num", () => {
    const parsed = parseListQuery({ "filter[featured]": ["true"] }, catalog());
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.query.filters).toStrictEqual([
      { target: "index", fieldKey: "featured", column: "value_num", values: [1] },
    ]);
  });

  it("routes relation fields to a membership filter", () => {
    const parsed = parseListQuery({ "filter[authors]": ["a1", "a2"] }, catalog());
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.query.filters).toStrictEqual([
      { target: "relations", fieldKey: "authors", values: ["a1", "a2"] },
    ]);
  });

  it("rejects filters on fields absent from the catalog (索引宣言済みに限る)", () => {
    expect(parseListQuery({ "filter[title]": ["x"] }, catalog()).ok).toBe(false);
  });

  it("rejects malformed scalar values (bad number / bad boolean)", () => {
    expect(parseListQuery({ "filter[rating]": ["abc"] }, catalog()).ok).toBe(false);
    expect(parseListQuery({ "filter[featured]": ["yes"] }, catalog()).ok).toBe(false);
  });

  it("rejects unknown query params (無制限クエリは許さない)", () => {
    expect(parseListQuery({ utm_source: ["x"] }, catalog()).ok).toBe(false);
    expect(parseListQuery({ "fitler[slug]": ["x"] }, catalog()).ok).toBe(false);
  });

  it("sorts by an indexed single-value field, both directions", () => {
    const asc = parseListQuery({ sort: ["rating"] }, catalog());
    const desc = parseListQuery({ sort: ["-rating"] }, catalog());
    if (!asc.ok || !desc.ok) throw new Error("expected ok");
    expect(asc.query.sort).toStrictEqual({
      fieldKey: "rating",
      column: "value_num",
      direction: "asc",
    });
    expect(desc.query.sort.direction).toBe("desc");
  });

  it("prefers a user-declared indexed field over the system published_at (shadowing)", () => {
    const parsed = parseListQuery({ sort: ["-published_at"] }, catalog());
    if (!parsed.ok) throw new Error(parsed.error);
    // カタログにあるのでシステム列ではなく projection_index の value_date を使う
    expect(parsed.query.sort).toStrictEqual({
      fieldKey: "published_at",
      column: "value_date",
      direction: "desc",
    });
    // カタログに無ければシステム列へフォールバック
    const fallback = parseListQuery({ sort: ["-published_at"] }, emptyCatalog());
    if (!fallback.ok) throw new Error(fallback.error);
    expect(fallback.query.sort.column).toBe("published_at");
  });

  it("rejects sorting on multi-value / relation / undeclared fields", () => {
    expect(parseListQuery({ sort: ["tags"] }, catalog()).ok).toBe(false); // 複数値は未定義
    expect(parseListQuery({ sort: ["authors"] }, catalog()).ok).toBe(false);
    expect(parseListQuery({ sort: ["title"] }, catalog()).ok).toBe(false);
    expect(parseListQuery({ sort: ["!!"] }, catalog()).ok).toBe(false);
  });

  it("validates limit as an integer within 1..100", () => {
    const ok = parseListQuery({ limit: ["100"] }, emptyCatalog());
    if (!ok.ok) throw new Error(ok.error);
    expect(ok.query.limit).toBe(100);
    expect(parseListQuery({ limit: ["0"] }, emptyCatalog()).ok).toBe(false);
    expect(parseListQuery({ limit: ["101"] }, emptyCatalog()).ok).toBe(false);
    expect(parseListQuery({ limit: ["2.5"] }, emptyCatalog()).ok).toBe(false);
    expect(parseListQuery({ limit: ["-1"] }, emptyCatalog()).ok).toBe(false);
  });

  it("accepts a cursor whose key type matches the sort column", () => {
    const token = encodeCursor({ k: 5, id: "r1" });
    const parsed = parseListQuery({ sort: ["-rating"], cursor: [token] }, catalog());
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.query.cursor).toStrictEqual({ k: 5, id: "r1" });
  });

  it("rejects a cursor whose key type mismatches the sort column", () => {
    const stringKey = encodeCursor({ k: "2026-01-01", id: "r1" });
    expect(parseListQuery({ sort: ["-rating"], cursor: [stringKey] }, catalog()).ok).toBe(false);
    const numberKey = encodeCursor({ k: 5, id: "r1" });
    expect(parseListQuery({ cursor: [numberKey] }, emptyCatalog()).ok).toBe(false); // 既定は文字列
    expect(parseListQuery({ cursor: ["///not-a-cursor"] }, emptyCatalog()).ok).toBe(false);
  });

  it("validates include against relation fields and normalizes order", () => {
    const parsed = parseListQuery({ include: ["authors"] }, catalog());
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.query.include).toStrictEqual(["authors"]);
    expect(parseListQuery({ include: ["tags"] }, catalog()).ok).toBe(false); // relation ではない
    expect(parseListQuery({ include: ["ghost"] }, catalog()).ok).toBe(false);
  });

  it("rejects repeated reserved params", () => {
    expect(parseListQuery({ limit: ["5", "10"] }, emptyCatalog()).ok).toBe(false);
  });
});

describe("parseInclude", () => {
  it("splits, trims, dedupes, and sorts", () => {
    const result = parseInclude(" authors ,authors", catalog());
    if (!result.ok) throw new Error(result.error);
    expect(result.include).toStrictEqual(["authors"]);
  });

  it("rejects empty and non-relation fields", () => {
    expect(parseInclude("", catalog()).ok).toBe(false);
    expect(parseInclude("slug", catalog()).ok).toBe(false);
  });
});
```

- [ ] **Step 3: テストが失敗することを確認**

Run: `pnpm --filter @plyrs/api exec vitest run --no-isolate --max-workers=1 src/public/catalog.test.ts src/public/query.test.ts`
Expected: FAIL — 両モジュールが存在しない

- [ ] **Step 4: 実装**

Create `apps/api/src/public/catalog.ts`:

```ts
import type { CatalogKind } from "../projection/payload";

// projection_fields（Phase 5b で追加したフィールドカタログ表）を Map へロードする。
// 公開 read API がフィルタ/ソート/include の検証と型別カラムの選択に使う。
export interface CatalogEntry {
  kind: CatalogKind;
  multi: boolean;
}

export type Catalog = Map<string, CatalogEntry>;

export async function loadCatalog(
  db: D1Database,
  tenantId: string,
  type: string,
): Promise<Catalog> {
  const { results } = await db
    .prepare(
      "SELECT field_key, kind, multi FROM projection_fields WHERE tenant_id = ?1 AND type = ?2",
    )
    .bind(tenantId, type)
    .all<{ field_key: string; kind: string; multi: number }>();
  const catalog: Catalog = new Map();
  for (const row of results) {
    catalog.set(row.field_key, { kind: row.kind as CatalogKind, multi: row.multi === 1 });
  }
  return catalog;
}
```

Create `apps/api/src/public/query.ts`:

```ts
import type { Catalog } from "./catalog";
import { decodeCursor } from "./cursor";

// §12.4 のクエリ語彙（裁定 2026-07-14: filter[] ブラケット記法）。
// - filter[field]=v は同一キー繰り返しで any-of、異なるフィールド間で AND。
// - フィルタ/ソートは索引宣言済みフィールド（カタログに載っているもの）に限る。
// - ソートは単一値フィールドのみ（複数値は行分割で順序が未定義 → 400）。
// - 予約パラメータ以外は 400（無制限クエリを許さない・キャッシュキーの分裂を防ぐ）。

export interface ScalarFilter {
  target: "index";
  fieldKey: string;
  column: "value_text" | "value_num" | "value_date";
  values: (string | number)[];
}

export interface RelationFilter {
  target: "relations";
  fieldKey: string;
  values: string[];
}

export type ListFilter = ScalarFilter | RelationFilter;

export interface ListSort {
  fieldKey: string;
  // published_at はシステム列（projected_records）、それ以外は projection_index の型別カラム
  column: "published_at" | "value_text" | "value_num" | "value_date";
  direction: "asc" | "desc";
}

export interface ListCursor {
  k: string | number;
  id: string;
}

export interface ListQuery {
  filters: ListFilter[];
  sort: ListSort;
  limit: number;
  cursor: ListCursor | null;
  include: string[];
}

export type ParseResult = { ok: true; query: ListQuery } | { ok: false; error: string };

export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;
const MAX_FILTERS = 8;
const MAX_FILTER_VALUES = 20;
const MAX_INCLUDE_FIELDS = 5;

const FILTER_KEY_PATTERN = /^filter\[([a-z][a-z0-9_]*)\]$/u;
const SORT_PATTERN = /^(-?)([a-z][a-z0-9_]*)$/u;
const RESERVED_PARAMS = new Set(["sort", "limit", "cursor", "include"]);

const COLUMN_BY_KIND = {
  text: "value_text",
  num: "value_num",
  bool: "value_num",
  date: "value_date",
} as const;

type ScalarKind = keyof typeof COLUMN_BY_KIND;

function parseScalarValues(kind: ScalarKind, raw: string[]): (string | number)[] | null {
  switch (kind) {
    case "num": {
      const values = raw.map((value) => Number(value));
      return values.every((value) => Number.isFinite(value)) && raw.every((v) => v.trim() !== "")
        ? values
        : null;
    }
    case "bool": {
      const values: number[] = [];
      for (const value of raw) {
        if (value === "true") {
          values.push(1);
        } else if (value === "false") {
          values.push(0);
        } else {
          return null;
        }
      }
      return values;
    }
    default:
      return raw;
  }
}

export function parseInclude(
  raw: string,
  catalog: Catalog,
): { ok: true; include: string[] } | { ok: false; error: string } {
  const keys = raw
    .split(",")
    .map((key) => key.trim())
    .filter((key) => key.length > 0);
  if (keys.length === 0 || keys.length > MAX_INCLUDE_FIELDS) {
    return { ok: false, error: "bad include" };
  }
  for (const key of keys) {
    const entry = catalog.get(key);
    if (entry === undefined || entry.kind !== "relation") {
      return { ok: false, error: `include field is not a relation: ${key}` };
    }
  }
  return { ok: true, include: [...new Set(keys)].sort() };
}

export function parseListQuery(params: Record<string, string[]>, catalog: Catalog): ParseResult {
  const filters: ListFilter[] = [];
  let sortParam: string | null = null;
  let limitParam: string | null = null;
  let cursorParam: string | null = null;
  let includeParam: string | null = null;

  for (const [key, rawValues] of Object.entries(params)) {
    const filterMatch = FILTER_KEY_PATTERN.exec(key);
    if (filterMatch !== null) {
      const fieldKey = filterMatch[1] ?? "";
      const entry = catalog.get(fieldKey);
      if (entry === undefined) {
        return { ok: false, error: `filter field is not indexed: ${fieldKey}` };
      }
      if (rawValues.length === 0 || rawValues.length > MAX_FILTER_VALUES) {
        return { ok: false, error: `bad filter value count: ${fieldKey}` };
      }
      if (filters.length >= MAX_FILTERS) {
        return { ok: false, error: "too many filters" };
      }
      if (entry.kind === "relation") {
        filters.push({ target: "relations", fieldKey, values: rawValues });
      } else {
        const values = parseScalarValues(entry.kind, rawValues);
        if (values === null) {
          return { ok: false, error: `bad filter value for ${entry.kind} field: ${fieldKey}` };
        }
        filters.push({ target: "index", fieldKey, column: COLUMN_BY_KIND[entry.kind], values });
      }
      continue;
    }
    if (!RESERVED_PARAMS.has(key)) {
      return { ok: false, error: `unknown query param: ${key}` };
    }
    const single = rawValues.length === 1 ? rawValues[0] : undefined;
    if (single === undefined) {
      return { ok: false, error: `query param must appear once: ${key}` };
    }
    if (key === "sort") {
      sortParam = single;
    } else if (key === "limit") {
      limitParam = single;
    } else if (key === "cursor") {
      cursorParam = single;
    } else {
      includeParam = single;
    }
  }

  // sort。カタログ優先: ユーザーが published_at という索引フィールドを宣言していたら
  // そちら（projection_index）を使い、無ければシステム列 projected_records.published_at。
  // 既定ソート（sort 未指定）は常にシステム列（カタログの有無に依存させない）。
  let sort: ListSort = { fieldKey: "published_at", column: "published_at", direction: "desc" };
  if (sortParam !== null) {
    const match = SORT_PATTERN.exec(sortParam);
    if (match === null) {
      return { ok: false, error: `bad sort: ${sortParam}` };
    }
    const direction: "asc" | "desc" = match[1] === "-" ? "desc" : "asc";
    const fieldKey = match[2] ?? "";
    const entry = catalog.get(fieldKey);
    if (entry !== undefined) {
      if (entry.kind === "relation") {
        return { ok: false, error: `sort field is not sortable: ${fieldKey}` };
      }
      if (entry.multi) {
        return { ok: false, error: `sort field is multi-valued: ${fieldKey}` };
      }
      sort = { fieldKey, column: COLUMN_BY_KIND[entry.kind], direction };
    } else if (fieldKey === "published_at") {
      sort = { fieldKey, column: "published_at", direction };
    } else {
      return { ok: false, error: `sort field is not indexed: ${fieldKey}` };
    }
  }

  let limit = DEFAULT_LIMIT;
  if (limitParam !== null) {
    if (!/^\d{1,3}$/u.test(limitParam)) {
      return { ok: false, error: `bad limit: ${limitParam}` };
    }
    limit = Number(limitParam);
    if (limit < 1 || limit > MAX_LIMIT) {
      return { ok: false, error: `bad limit: ${limitParam}` };
    }
  }

  let cursor: ListCursor | null = null;
  if (cursorParam !== null) {
    const decoded = decodeCursor(cursorParam);
    if (decoded === null || decoded.k === null) {
      return { ok: false, error: "bad cursor" };
    }
    const expectsNumber = sort.column === "value_num";
    if (expectsNumber ? typeof decoded.k !== "number" : typeof decoded.k !== "string") {
      return { ok: false, error: "bad cursor" };
    }
    cursor = { k: decoded.k, id: decoded.id };
  }

  let include: string[] = [];
  if (includeParam !== null) {
    const result = parseInclude(includeParam, catalog);
    if (!result.ok) {
      return result;
    }
    include = result.include;
  }

  return { ok: true, query: { filters, sort, limit, cursor, include } };
}
```

- [ ] **Step 5: テストが通ることを確認**

Run: `pnpm --filter @plyrs/api exec vitest run --no-isolate --max-workers=1 src/public/catalog.test.ts src/public/query.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/public/catalog.ts apps/api/src/public/catalog.test.ts apps/api/src/public/query.ts apps/api/src/public/query.test.ts
git commit -m "feat: parse and validate the public list query vocabulary against the field catalog"
```

---

### Task 7: 一覧 SQL ビルダ（実 D1 で検証）

**Files:**
- Create: `apps/api/src/public/sql.ts`
- Create: `apps/api/src/public/sql.test.ts`

**Interfaces:**
- Consumes: `ListQuery` / `ListFilter`（Task 6）
- Produces:
  - `export interface BuiltQuery { sql: string; binds: (string | number)[] }`
  - `export interface ListRow { record_id: string; type: string; slug: string | null; published_at: string; data: string; publish_seq: number; sort_value?: string | number }`
  - `export function buildListQuery(tenantId: string, type: string, query: ListQuery): BuiltQuery`（LIMIT は `query.limit + 1` — 呼び出し側が次ページ有無を判定）
  - `export function placeholders(count: number): string`（`"?, ?, ?"` — Task 8 の include も使う）

- [ ] **Step 1: 失敗するテストを書く**

Create `apps/api/src/public/sql.test.ts`（実 PROJECTION_DB に直接行を播種して、組んだ SQL を実行して検証する）:

```ts
import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import type { ListQuery } from "./query";
import { buildListQuery, placeholders, type ListRow } from "./sql";

// このテスト専用の合成テナント。投影は派生ストアなので直接播種してよい
// （consumer 経由の播種は Task 10 以降の統合テストが担う）。
const tenantId = crypto.randomUUID();

function defaults(): ListQuery {
  return {
    filters: [],
    sort: { fieldKey: "published_at", column: "published_at", direction: "desc" },
    limit: 10,
    cursor: null,
    include: [],
  };
}

async function run(query: ListQuery): Promise<string[]> {
  const built = buildListQuery(tenantId, "post", query);
  const { results } = await env.PROJECTION_DB.prepare(built.sql)
    .bind(...built.binds)
    .all<ListRow>();
  return results.map((row) => row.record_id);
}

beforeAll(async () => {
  // p1: rating 5, category tech / p2: rating 5, category life / p3: rating 3, tech
  // p4: rating 無し / p1 と p2 は author a1 を参照
  const records = [
    ["p1", "2026-07-01T00:00:00.000Z"],
    ["p2", "2026-07-02T00:00:00.000Z"],
    ["p3", "2026-07-03T00:00:00.000Z"],
    ["p4", "2026-07-03T00:00:00.000Z"], // p3 と同時刻（record_id タイブレークの検証）
  ] as const;
  for (const [id, publishedAt] of records) {
    await env.PROJECTION_DB.prepare(
      "INSERT INTO projected_records (tenant_id, record_id, type, slug, published_at, data, source_version, publish_seq, projected_at) VALUES (?1, ?2, 'post', ?2, ?3, '{}', 1, 1, 0)",
    )
      .bind(tenantId, id, publishedAt)
      .run();
  }
  const index = [
    ["p1", "rating", 5],
    ["p2", "rating", 5],
    ["p3", "rating", 3],
  ] as const;
  for (const [id, key, num] of index) {
    await env.PROJECTION_DB.prepare(
      "INSERT INTO projection_index (tenant_id, type, field_key, value_text, value_num, value_date, record_id) VALUES (?1, 'post', ?2, NULL, ?3, NULL, ?4)",
    )
      .bind(tenantId, key, num, id)
      .run();
  }
  const category = [
    ["p1", "tech"],
    ["p2", "life"],
    ["p3", "tech"],
  ] as const;
  for (const [id, value] of category) {
    await env.PROJECTION_DB.prepare(
      "INSERT INTO projection_index (tenant_id, type, field_key, value_text, value_num, value_date, record_id) VALUES (?1, 'post', 'category', ?2, NULL, NULL, ?3)",
    )
      .bind(tenantId, value, id)
      .run();
  }
  for (const source of ["p1", "p2"]) {
    await env.PROJECTION_DB.prepare(
      "INSERT INTO projected_relations (tenant_id, source_id, source_field, target_type, target_id, ordinal, origin) VALUES (?1, ?2, 'authors', 'author', 'a1', 0, 'field')",
    )
      .bind(tenantId, source)
      .run();
  }
});

describe("buildListQuery (実 D1 で実行)", () => {
  it("orders by system published_at desc with record_id tiebreak", async () => {
    expect(await run(defaults())).toStrictEqual(["p4", "p3", "p2", "p1"]);
  });

  it("pages with a keyset cursor over ties", async () => {
    const query = { ...defaults(), limit: 1 };
    // p4 と p3 は同時刻。p4 の後のカーソルで p3 が返る（タイブレークが効く）
    const afterP4 = { ...query, cursor: { k: "2026-07-03T00:00:00.000Z", id: "p4" } };
    expect(await run(afterP4)).toStrictEqual(["p3", "p2"].slice(0, 2)); // limit+1 で 2 行返る
  });

  it("sorts by an indexed numeric field, dropping records without a value", async () => {
    const desc = {
      ...defaults(),
      sort: { fieldKey: "rating", column: "value_num", direction: "desc" } as const,
    };
    expect(await run(desc)).toStrictEqual(["p2", "p1", "p3"]); // p4 は rating 無し → 除外
    const asc = {
      ...defaults(),
      sort: { fieldKey: "rating", column: "value_num", direction: "asc" } as const,
    };
    expect(await run(asc)).toStrictEqual(["p3", "p1", "p2"]);
  });

  it("pages through equal sort values with the record_id tiebreak", async () => {
    const query = {
      ...defaults(),
      sort: { fieldKey: "rating", column: "value_num", direction: "desc" } as const,
      cursor: { k: 5, id: "p2" },
    };
    expect(await run(query)).toStrictEqual(["p1", "p3"]);
  });

  it("applies scalar filters as any-of within a key, AND across keys", async () => {
    const anyOf = {
      ...defaults(),
      filters: [
        { target: "index", fieldKey: "category", column: "value_text", values: ["tech", "life"] },
      ] as ListQuery["filters"],
    };
    expect(await run(anyOf)).toStrictEqual(["p3", "p2", "p1"]);
    const combined = {
      ...defaults(),
      filters: [
        { target: "index", fieldKey: "category", column: "value_text", values: ["tech"] },
        { target: "index", fieldKey: "rating", column: "value_num", values: [5] },
      ] as ListQuery["filters"],
    };
    expect(await run(combined)).toStrictEqual(["p1"]);
  });

  it("applies relation membership filters", async () => {
    const query = {
      ...defaults(),
      filters: [
        { target: "relations", fieldKey: "authors", values: ["a1"] },
      ] as ListQuery["filters"],
    };
    expect(await run(query)).toStrictEqual(["p2", "p1"]);
  });

  it("fetches limit+1 rows so the caller can detect the next page", async () => {
    const built = buildListQuery(tenantId, "post", { ...defaults(), limit: 2 });
    const { results } = await env.PROJECTION_DB.prepare(built.sql)
      .bind(...built.binds)
      .all<ListRow>();
    expect(results.length).toBe(3);
  });

  it("exposes the sort value for index sorts (cursor minting)", async () => {
    const built = buildListQuery(tenantId, "post", {
      ...defaults(),
      sort: { fieldKey: "rating", column: "value_num", direction: "desc" },
    });
    const { results } = await env.PROJECTION_DB.prepare(built.sql)
      .bind(...built.binds)
      .all<ListRow>();
    expect(results[0]?.sort_value).toBe(5);
  });
});

describe("placeholders", () => {
  it("emits comma-separated question marks", () => {
    expect(placeholders(3)).toBe("?, ?, ?");
    expect(placeholders(1)).toBe("?");
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm --filter @plyrs/api exec vitest run --no-isolate --max-workers=1 src/public/sql.test.ts`
Expected: FAIL — モジュールが存在しない

- [ ] **Step 3: 実装**

Create `apps/api/src/public/sql.ts`:

```ts
import type { ListQuery } from "./query";

// 一覧クエリの物理形（§12.2 / ロードマップ §9）:
// - 実体は必ず projected_records から取る。projection_index は record_id を絞る索引専用
//   （レコード復元に使わない）。フィルタは非相関 IN サブクエリ（プランナが一度だけ実体化する）。
// - ソートがシステム列（published_at）なら (tenant_id, type, published_at) 索引で完結。
//   索引フィールドのソートは projection_index を 1 回 join する（単一値フィールドのみ =
//   parseListQuery が保証するため join は行を複製しない）。
// - keyset ページネーションは (ソート値, record_id) の行値比較。LIMIT は limit+1 で
//   次ページ有無を呼び出し側が判定する。
// 列名の文字列補間は query.ts の閉じた union（value_text|value_num|value_date|published_at）
// 由来のみで、ユーザー入力は一切補間しない。

export interface BuiltQuery {
  sql: string;
  binds: (string | number)[];
}

export interface ListRow {
  record_id: string;
  type: string;
  slug: string | null;
  published_at: string;
  data: string;
  publish_seq: number;
  sort_value?: string | number;
}

export function placeholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(", ");
}

export function buildListQuery(tenantId: string, type: string, query: ListQuery): BuiltQuery {
  const { sort, filters, cursor, limit } = query;
  const usesIndexSort = sort.column !== "published_at";
  const binds: (string | number)[] = [];

  let sql = "SELECT r.record_id, r.type, r.slug, r.published_at, r.data, r.publish_seq";
  if (usesIndexSort) {
    sql += `, s.${sort.column} AS sort_value`;
  }
  sql += " FROM projected_records r";
  if (usesIndexSort) {
    // IS NOT NULL: 型定義変更で kind が変わった直後の stale 行が NULL ソート値を運んで
    // カーソルを壊さないように（値を持つ行だけがソート対象という意味論にも一致する）
    sql +=
      " JOIN projection_index s ON s.tenant_id = r.tenant_id AND s.type = r.type" +
      ` AND s.record_id = r.record_id AND s.field_key = ? AND s.${sort.column} IS NOT NULL`;
    binds.push(sort.fieldKey);
  }
  sql += " WHERE r.tenant_id = ? AND r.type = ?";
  binds.push(tenantId, type);

  for (const filter of filters) {
    if (filter.target === "relations") {
      sql +=
        " AND r.record_id IN (SELECT source_id FROM projected_relations" +
        ` WHERE tenant_id = ? AND source_field = ? AND target_id IN (${placeholders(filter.values.length)}))`;
      binds.push(tenantId, filter.fieldKey, ...filter.values);
    } else {
      sql +=
        " AND r.record_id IN (SELECT record_id FROM projection_index" +
        ` WHERE tenant_id = ? AND type = ? AND field_key = ? AND ${filter.column} IN (${placeholders(filter.values.length)}))`;
      binds.push(tenantId, type, filter.fieldKey, ...filter.values);
    }
  }

  const sortExpr = usesIndexSort ? `s.${sort.column}` : "r.published_at";
  if (cursor !== null) {
    const op = sort.direction === "desc" ? "<" : ">";
    sql += ` AND (${sortExpr}, r.record_id) ${op} (?, ?)`;
    binds.push(cursor.k, cursor.id);
  }
  const dir = sort.direction === "desc" ? "DESC" : "ASC";
  sql += ` ORDER BY ${sortExpr} ${dir}, r.record_id ${dir} LIMIT ?`;
  binds.push(limit + 1);
  return { sql, binds };
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm --filter @plyrs/api exec vitest run --no-isolate --max-workers=1 src/public/sql.test.ts`
Expected: PASS（9 tests）。行値比較 `(a, b) < (?, ?)` が D1 で通ることもここで実証される。

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/public/sql.ts apps/api/src/public/sql.test.ts
git commit -m "feat: build keyset list queries over the projection tables"
```

---

### Task 8: シリアライザと関係展開（included[]）

**Files:**
- Create: `apps/api/src/public/serialize.ts`
- Create: `apps/api/src/public/include.ts`
- Create: `apps/api/src/public/include.test.ts`

**Interfaces:**
- Consumes: `placeholders`（Task 7）
- Produces:
  - `export interface PublicRecord { id: string; type: string; slug: string | null; publishedAt: string; fields: Record<string, unknown> }`
  - `export interface ProjectedRecordRow { record_id: string; type: string; slug: string | null; published_at: string; data: string }`
  - `export function toPublicRecord(row: ProjectedRecordRow): PublicRecord`
  - `export async function expandIncludes(db: D1Database, tenantId: string, sourceIds: string[], includeFields: string[]): Promise<PublicRecord[]>`（record_id 昇順で決定的に返す）

- [ ] **Step 1: 失敗するテストを書く**

Create `apps/api/src/public/include.test.ts`:

```ts
import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { expandIncludes } from "./include";
import { toPublicRecord } from "./serialize";

const tenantId = crypto.randomUUID();

async function seedRecord(id: string, type: string, data: Record<string, unknown>): Promise<void> {
  await env.PROJECTION_DB.prepare(
    "INSERT INTO projected_records (tenant_id, record_id, type, slug, published_at, data, source_version, publish_seq, projected_at) VALUES (?1, ?2, ?3, NULL, '2026-07-14T00:00:00.000Z', ?4, 1, 1, 0)",
  )
    .bind(tenantId, id, type, JSON.stringify(data))
    .run();
}

async function seedRelation(
  sourceId: string,
  sourceField: string,
  targetId: string,
  origin = "field",
): Promise<void> {
  await env.PROJECTION_DB.prepare(
    "INSERT INTO projected_relations (tenant_id, source_id, source_field, target_type, target_id, ordinal, origin) VALUES (?1, ?2, ?3, 'author', ?4, 0, ?5)",
  )
    .bind(tenantId, sourceId, sourceField, targetId, origin)
    .run();
}

beforeAll(async () => {
  await seedRecord("post1", "post", { title: "一" });
  await seedRecord("post2", "post", { title: "二" });
  await seedRecord("author1", "author", { name: "著者1" });
  await seedRecord("author2", "author", { name: "著者2" });
  // author3 は projected_records に存在しない = 未公開（ソフト参照で不在になる）
  await seedRelation("post1", "authors", "author1");
  await seedRelation("post1", "authors", "author3");
  await seedRelation("post2", "authors", "author1"); // 重複排除の検証
  await seedRelation("post2", "authors", "author2");
  await seedRelation("post2", "hero", "author2"); // 対象外フィールド
  await seedRelation("post1", "embedded", "author2", "body"); // body 由来は展開しない
});

describe("toPublicRecord (裁定 2026-07-14: 内部値非公開・fields 入れ子)", () => {
  it("maps the row into the public shape without internal values", () => {
    const record = toPublicRecord({
      record_id: "r1",
      type: "post",
      slug: "hello",
      published_at: "2026-07-14T00:00:00.000Z",
      data: JSON.stringify({ title: "t", rating: 5 }),
    });
    expect(record).toStrictEqual({
      id: "r1",
      type: "post",
      slug: "hello",
      publishedAt: "2026-07-14T00:00:00.000Z",
      fields: { title: "t", rating: 5 },
    });
  });
});

describe("expandIncludes (§12.5: projected_relations のみ・ソフト参照)", () => {
  it("collects published targets of the requested fields, deduped, sorted by id", async () => {
    const included = await expandIncludes(env.PROJECTION_DB, tenantId, ["post1", "post2"], [
      "authors",
    ]);
    expect(included.map((record) => record.id)).toStrictEqual(["author1", "author2"]);
  });

  it("silently drops unpublished targets (soft reference, no error)", async () => {
    const included = await expandIncludes(env.PROJECTION_DB, tenantId, ["post1"], ["authors"]);
    expect(included.map((record) => record.id)).toStrictEqual(["author1"]); // author3 は不在
  });

  it("only expands field-origin relations of the requested fields", async () => {
    const included = await expandIncludes(env.PROJECTION_DB, tenantId, ["post1"], ["embedded"]);
    expect(included).toStrictEqual([]); // body 由来は対象外
  });

  it("returns empty for empty inputs", async () => {
    expect(await expandIncludes(env.PROJECTION_DB, tenantId, [], ["authors"])).toStrictEqual([]);
    expect(await expandIncludes(env.PROJECTION_DB, tenantId, ["post1"], [])).toStrictEqual([]);
  });

  it("chunks large id lists under the D1 bind limit", async () => {
    // 120 ソース（実在するのは post1/post2 のみ）でもエラーにならず正しく返る
    const sources = Array.from({ length: 120 }, (_, i) => `ghost-${i}`).concat(["post1"]);
    const included = await expandIncludes(env.PROJECTION_DB, tenantId, sources, ["authors"]);
    expect(included.map((record) => record.id)).toStrictEqual(["author1"]);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm --filter @plyrs/api exec vitest run --no-isolate --max-workers=1 src/public/include.test.ts`
Expected: FAIL — モジュールが存在しない

- [ ] **Step 3: 実装**

Create `apps/api/src/public/serialize.ts`:

```ts
// 裁定（2026-07-14）: 内部値（source_version / publish_seq / projected_at）は公開しない。
// ユーザー定義フィールドは fields に入れ子（システム項目との名前衝突を構造で回避）。
export interface PublicRecord {
  id: string;
  type: string;
  slug: string | null;
  publishedAt: string;
  fields: Record<string, unknown>;
}

export interface ProjectedRecordRow {
  record_id: string;
  type: string;
  slug: string | null;
  published_at: string;
  data: string;
}

export function toPublicRecord(row: ProjectedRecordRow): PublicRecord {
  return {
    id: row.record_id,
    type: row.type,
    slug: row.slug,
    publishedAt: row.published_at,
    fields: JSON.parse(row.data) as Record<string, unknown>,
  };
}
```

Create `apps/api/src/public/include.ts`:

```ts
import { toPublicRecord, type ProjectedRecordRow, type PublicRecord } from "./serialize";
import { placeholders } from "./sql";

// §12.5: 公開経路の関係解決は projected_relations に対してのみ行う。参照先が投影に無ければ
// （未公開 / 取り下げ済み）その参照は黙って不在になる（ソフト参照。エラーにしない）。
// 展開は field 由来のみ（body 由来のリンクはレコード本文の関心。Phase 7）。

const CHUNK_SIZE = 50; // D1 のバインド上限（100/クエリ）への安全マージン

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

export async function expandIncludes(
  db: D1Database,
  tenantId: string,
  sourceIds: string[],
  includeFields: string[],
): Promise<PublicRecord[]> {
  if (sourceIds.length === 0 || includeFields.length === 0) {
    return [];
  }
  const targetIds = new Set<string>();
  for (const sourceChunk of chunk(sourceIds, CHUNK_SIZE)) {
    const { results } = await db
      .prepare(
        "SELECT DISTINCT target_id FROM projected_relations WHERE tenant_id = ? AND origin = 'field'" +
          ` AND source_field IN (${placeholders(includeFields.length)})` +
          ` AND source_id IN (${placeholders(sourceChunk.length)})`,
      )
      .bind(tenantId, ...includeFields, ...sourceChunk)
      .all<{ target_id: string }>();
    for (const row of results) {
      targetIds.add(row.target_id);
    }
  }
  const included: PublicRecord[] = [];
  for (const idChunk of chunk([...targetIds], CHUNK_SIZE)) {
    const { results } = await db
      .prepare(
        "SELECT record_id, type, slug, published_at, data FROM projected_records" +
          ` WHERE tenant_id = ? AND record_id IN (${placeholders(idChunk.length)})`,
      )
      .bind(tenantId, ...idChunk)
      .all<ProjectedRecordRow>();
    for (const row of results) {
      included.push(toPublicRecord(row));
    }
  }
  // 決定的な並び（レスポンス本文の安定 = テスト容易性とキャッシュ効率）
  included.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return included;
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm --filter @plyrs/api exec vitest run --no-isolate --max-workers=1 src/public/include.test.ts`
Expected: PASS（6 tests）

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/public/serialize.ts apps/api/src/public/include.ts apps/api/src/public/include.test.ts
git commit -m "feat: serialize public records and expand relations as a deduped included list"
```

---

### Task 9: エッジキャッシュヘルパ（Cache API + 短 TTL）

**Files:**
- Create: `apps/api/src/public/cache.ts`
- Create: `apps/api/src/public/cache.test.ts`

**Interfaces:**
- Consumes: なし（Cache API / ExecutionContext）
- Produces:
  - `export const PUBLIC_CACHE_TTL_SECONDS = 30`
  - `export function canonicalCacheUrl(tenantId: string, pathSuffix: string, params: Record<string, string[]>): string`
  - `export interface EdgeCacheContext { req: { raw: Request }; executionCtx: ExecutionContext }`（Hono の Context が構造的に満たす）
  - `export async function withEdgeCache(context: EdgeCacheContext, cacheUrl: string, produce: () => Promise<Response>): Promise<Response>`（200 のみ格納。ETag 一致で 304）

- [ ] **Step 1: 失敗するテストを書く**

Create `apps/api/src/public/cache.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { canonicalCacheUrl, PUBLIC_CACHE_TTL_SECONDS, withEdgeCache } from "./cache";

// ExecutionContext の無い環境（app.request 直呼び相当）を偽装する
function fakeContext(headers: Record<string, string> = {}) {
  return {
    req: { raw: new Request("https://example.com/x", { headers }) },
    get executionCtx(): ExecutionContext {
      throw new Error("no execution context");
    },
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("canonicalCacheUrl", () => {
  it("sorts keys and values so param order cannot split the cache", () => {
    const a = canonicalCacheUrl("t1", "records/post", {
      sort: ["-published_at"],
      "filter[tags]": ["y", "x"],
      limit: ["5"],
    });
    const b = canonicalCacheUrl("t1", "records/post", {
      limit: ["5"],
      "filter[tags]": ["x", "y"],
      sort: ["-published_at"],
    });
    expect(a).toBe(b);
  });

  it("keys by resolved tenant id, not by slug", () => {
    const a = canonicalCacheUrl("t1", "records/post", {});
    const b = canonicalCacheUrl("t2", "records/post", {});
    expect(a).not.toBe(b);
  });
});

describe("withEdgeCache (裁定 2026-07-14: Cache API + 短 TTL・パージなし)", () => {
  it("serves the second call from cache without invoking produce", async () => {
    const url = canonicalCacheUrl(crypto.randomUUID(), "records/post/id/r1", {});
    let calls = 0;
    const produce = async () => {
      calls += 1;
      return jsonResponse({ n: calls });
    };
    const first = await withEdgeCache(fakeContext(), url, produce);
    expect(await first.json()).toStrictEqual({ n: 1 });
    expect(first.headers.get("cache-control")).toBe(
      `public, max-age=0, s-maxage=${PUBLIC_CACHE_TTL_SECONDS}`,
    );
    const second = await withEdgeCache(fakeContext(), url, produce);
    expect(await second.json()).toStrictEqual({ n: 1 });
    expect(calls).toBe(1);
  });

  it("does not cache non-200 responses", async () => {
    const url = canonicalCacheUrl(crypto.randomUUID(), "records/post/id/missing", {});
    let calls = 0;
    const produce = async () => {
      calls += 1;
      return jsonResponse({ error: "not_found" }, 404);
    };
    expect((await withEdgeCache(fakeContext(), url, produce)).status).toBe(404);
    await withEdgeCache(fakeContext(), url, produce);
    expect(calls).toBe(2);
  });

  it("answers 304 when If-None-Match matches the response etag", async () => {
    const url = canonicalCacheUrl(crypto.randomUUID(), "records/post/id/r2", {});
    const produce = async () => {
      const response = jsonResponse({ v: 1 });
      response.headers.set("etag", 'W/"7"');
      return response;
    };
    const first = await withEdgeCache(fakeContext(), url, produce);
    expect(first.status).toBe(200);
    const revalidated = await withEdgeCache(fakeContext({ "if-none-match": 'W/"7"' }), url, produce);
    expect(revalidated.status).toBe(304);
    expect(await revalidated.text()).toBe("");
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm --filter @plyrs/api exec vitest run --no-isolate --max-workers=1 src/public/cache.test.ts`
Expected: FAIL — モジュールが存在しない

- [ ] **Step 3: 実装**

Create `apps/api/src/public/cache.ts`:

```ts
// 裁定（2026-07-14）/ §12.6: Cache API + 短 TTL。publish 時パージはしない —— 投影自体が
// publish から数秒の結果整合であり、Cache API のパージは同一 colo にしか効かないため、
// パージしても厳密さは得られない。短 TTL が陳腐化を有界化し、投影が常に正のため実害が小さい。
// キーは解決後の tenantId で刻む: tenantSlug の付け替えが起きても、古い slug のキャッシュが
// 別テナントの内容として生き残らないよう、恒久 ID に正規化する。

export const PUBLIC_CACHE_TTL_SECONDS = 30;

// 実在しない内部ホスト。Cache API のキーは URL 全体なので、公開ドメインと衝突しない
// 名前空間を切る（リクエスト URL をそのままキーにすると Host ヘッダ次第で分裂する）。
const CACHE_HOST = "https://plyrs-public-cache.internal";

export function canonicalCacheUrl(
  tenantId: string,
  pathSuffix: string,
  params: Record<string, string[]>,
): string {
  const search = new URLSearchParams();
  for (const key of Object.keys(params).sort()) {
    for (const value of [...(params[key] ?? [])].sort()) {
      search.append(key, value);
    }
  }
  const queryString = search.toString();
  return `${CACHE_HOST}/${tenantId}/${pathSuffix}${queryString === "" ? "" : `?${queryString}`}`;
}

export interface EdgeCacheContext {
  req: { raw: Request };
  executionCtx: ExecutionContext;
}

export async function withEdgeCache(
  context: EdgeCacheContext,
  cacheUrl: string,
  produce: () => Promise<Response>,
): Promise<Response> {
  const cache = caches.default;
  const key = new Request(cacheUrl, { method: "GET" });
  let response = await cache.match(key);
  if (response === undefined) {
    response = await produce();
    if (response.status === 200) {
      response.headers.set(
        "cache-control",
        `public, max-age=0, s-maxage=${PUBLIC_CACHE_TTL_SECONDS}`,
      );
      const stored = response.clone();
      let ctx: ExecutionContext | null = null;
      try {
        ctx = context.executionCtx;
      } catch {
        // ExecutionContext が無い環境（app.request 直呼びのテスト等）では同期で書く
        ctx = null;
      }
      const putPromise = cache.put(key, stored);
      if (ctx !== null) {
        ctx.waitUntil(putPromise);
      } else {
        await putPromise;
      }
    }
  }
  const etag = response.headers.get("etag");
  const ifNoneMatch = context.req.raw.headers.get("if-none-match");
  if (etag !== null && ifNoneMatch !== null && ifNoneMatch === etag) {
    return new Response(null, { status: 304, headers: response.headers });
  }
  return response;
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm --filter @plyrs/api exec vitest run --no-isolate --max-workers=1 src/public/cache.test.ts`
Expected: PASS（5 tests）。miniflare の Cache API が s-maxage を尊重して格納することもここで実証される。

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/public/cache.ts apps/api/src/public/cache.test.ts
git commit -m "feat: add the short-ttl edge cache helper for the public read path"
```

---

### Task 10: 公開ルート — 単体取得（id / slug）+ include + ETag + CORS + マウント

**Files:**
- Create: `apps/api/src/routes/public.ts`
- Modify: `apps/api/src/index.ts`
- Create: `apps/api/test/public-helpers.ts`
- Create: `apps/api/test/public-single.test.ts`

**Interfaces:**
- Consumes: Task 4〜9 の全 export（`resolveTenantId` / `loadCatalog` / `parseInclude` / `canonicalCacheUrl` / `withEdgeCache` / `expandIncludes` / `toPublicRecord`）
- Produces: `export const publicRoutes: Hono<{ Bindings: Env }>`。`/public/v1` にマウント。Task 11 がこのファイルに一覧ルートを**追加**する（このタスクでは一覧パスは 404 のまま）。

- [ ] **Step 1: テスト共通ヘルパを書く**

Create `apps/api/test/public-helpers.ts`:

```ts
import { createExecutionContext, createMessageBatch, getQueueResult } from "cloudflare:test";
import { env } from "cloudflare:workers";
import type { ContentTypeDefinition } from "@plyrs/metamodel";
import worker from "../src/index";
import type { ProjectionJob } from "../src/projection/jobs";
import type { TenantDO } from "../src/tenant-do";
import { auth, uuid } from "./fixtures";
import { asPublishResult, asWriteResult } from "./rpc-unwrap";

export async function seedTenant(tenantId: string, slug: string): Promise<void> {
  await env.DB.prepare("INSERT INTO tenants (id, slug, name, created_at) VALUES (?1, ?2, ?3, ?4)")
    .bind(tenantId, slug, `tenant ${slug}`, "2026-07-14T00:00:00.000Z")
    .run();
}

export function freshTenantSlug(): string {
  return `pub-${crypto.randomUUID().slice(0, 12)}`;
}

// 実 consumer コードへ決定的に配達する。実ブローカ経由の自動配達と重複しても冪等なので無害。
// SELF.queue() は DataCloneError で壊れているため必ずこの経路を使う（既知事実）。
export async function deliverJobs(jobs: ProjectionJob[]): Promise<void> {
  const batch = createMessageBatch<ProjectionJob>(
    "plyrs-projection",
    jobs.map((body, i) => ({ id: `m${i}`, timestamp: new Date(1_000 + i), attempts: 1, body })),
  );
  const ctx = createExecutionContext();
  await worker.queue(batch, env, ctx);
  await getQueueResult(batch, ctx);
}

// write + publish して、投影 upsert ジョブに必要な世代情報を返す
export async function writeAndPublish(
  stub: DurableObjectStub<TenantDO>,
  tenantId: string,
  type: string,
  recordId: string,
  input: Record<string, unknown>,
): Promise<ProjectionJob> {
  const written = asWriteResult(await stub.writeRecord(type, { recordId, input }, auth("owner1")));
  if (!written.ok) {
    throw new Error(`writeRecord failed: ${JSON.stringify(written)}`);
  }
  const published = asPublishResult(await stub.publishRecord(tenantId, recordId, auth("owner1")));
  if (!published.ok) {
    throw new Error(`publishRecord failed: ${JSON.stringify(published)}`);
  }
  return {
    jobType: "upsert",
    tenantId,
    recordId,
    sourceVersion: published.snapshot.sourceVersion,
    publishSeq: published.snapshot.publishSeq,
  };
}

export function authorType(): ContentTypeDefinition {
  return {
    id: uuid(400),
    key: "author",
    name: "著者",
    source: "user",
    version: 1,
    fields: [
      { key: "name", type: "text", required: true },
      { key: "slug", type: "text", config: { unique: true, indexed: true } },
    ],
  };
}

export function postType(): ContentTypeDefinition {
  return {
    id: uuid(401),
    key: "post",
    name: "投稿",
    source: "user",
    version: 1,
    fields: [
      { key: "title", type: "text", required: true },
      { key: "slug", type: "text", required: true, config: { unique: true, indexed: true } },
      { key: "rating", type: "number", config: { indexed: true } },
      { key: "featured", type: "boolean", config: { indexed: true } },
      { key: "event_at", type: "datetime", config: { indexed: true } },
      {
        key: "category",
        type: "select",
        config: {
          options: [
            { value: "tech", label: "Tech" },
            { value: "life", label: "Life" },
          ],
          indexed: true,
        },
      },
      {
        key: "tags",
        type: "select",
        config: {
          options: [
            { value: "x", label: "X" },
            { value: "y", label: "Y" },
            { value: "z", label: "Z" },
          ],
          multiple: true,
          indexed: true,
        },
      },
      {
        key: "authors",
        type: "relation",
        config: { allowedTypes: ["author"], cardinality: "many", ordered: true },
      },
    ],
  };
}
```

- [ ] **Step 2: 失敗するテストを書く**

Create `apps/api/test/public-single.test.ts`:

```ts
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { app } from "../src/index";
import type { TenantDO } from "../src/tenant-do";
import { auth, uuid } from "./fixtures";
import { asWriteResult } from "./rpc-unwrap";
import {
  authorType,
  deliverJobs,
  freshTenantSlug,
  postType,
  seedTenant,
  writeAndPublish,
} from "./public-helpers";

const author1 = uuid(410);
const author2 = uuid(411);
const author3 = uuid(412); // 書くが publish しない（ソフト参照の不在側）
const post1 = uuid(413);

describe("public single fetch (§12.4)", () => {
  let tenantId: string;
  let tenantSlug: string;
  let stub: DurableObjectStub<TenantDO>;

  beforeEach(async () => {
    tenantId = crypto.randomUUID();
    tenantSlug = freshTenantSlug();
    await seedTenant(tenantId, tenantSlug);
    stub = env.TENANT_DO.get(env.TENANT_DO.idFromName(tenantId));
    await stub.registerContentType(authorType(), auth("owner1"));
    await stub.registerContentType(postType(), auth("owner1"));
    const jobs = [
      await writeAndPublish(stub, tenantId, "author", author1, { name: "著者1", slug: "a-one" }),
      await writeAndPublish(stub, tenantId, "author", author2, { name: "著者2", slug: "a-two" }),
    ];
    const unpublished = asWriteResult(
      await stub.writeRecord(
        "author",
        { recordId: author3, input: { name: "未公開", slug: "a-three" } },
        auth("owner1"),
      ),
    );
    if (!unpublished.ok) {
      throw new Error("author3 write failed");
    }
    jobs.push(
      await writeAndPublish(stub, tenantId, "post", post1, {
        title: "最初の投稿",
        slug: "first-post",
        rating: 5,
        featured: true,
        event_at: "2026-07-10T00:00:00.000Z",
        category: "tech",
        tags: ["x", "y"],
        authors: [
          { type: "author", id: author1 },
          { type: "author", id: author2 },
          { type: "author", id: author3 },
        ],
      }),
    );
    await deliverJobs(jobs);
  });

  it("returns the public shape by id, without internal values", async () => {
    const response = await app.request(
      `/public/v1/${tenantSlug}/records/post/${post1}`,
      {},
      env,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      id: post1,
      type: "post",
      slug: "first-post",
      fields: { title: "最初の投稿", rating: 5, category: "tech" },
    });
    expect(typeof body["publishedAt"]).toBe("string");
    for (const internal of ["sourceVersion", "publishSeq", "projectedAt", "data"]) {
      expect(body).not.toHaveProperty(internal);
    }
    expect(response.headers.get("etag")).toMatch(/^W\/"\d+"$/u);
    expect(response.headers.get("cache-control")).toContain("s-maxage=");
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("returns the same record by slug", async () => {
    const response = await app.request(
      `/public/v1/${tenantSlug}/records/post/slug/first-post`,
      {},
      env,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { id: string };
    expect(body.id).toBe(post1);
  });

  it("404s when the id exists under a different type (url must tell the truth)", async () => {
    const response = await app.request(
      `/public/v1/${tenantSlug}/records/author/${post1}`,
      {},
      env,
    );
    expect(response.status).toBe(404);
  });

  it("404s for an unpublished record and an unknown tenant", async () => {
    expect(
      (await app.request(`/public/v1/${tenantSlug}/records/author/${author3}`, {}, env)).status,
    ).toBe(404);
    expect(
      (await app.request(`/public/v1/no-such-tenant/records/post/${post1}`, {}, env)).status,
    ).toBe(404);
  });

  it("expands include=authors into included[], dropping unpublished targets", async () => {
    const response = await app.request(
      `/public/v1/${tenantSlug}/records/post/${post1}?include=authors`,
      {},
      env,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      fields: { authors: unknown[] };
      included: { id: string }[];
    };
    // レコード内の参照値は ID のまま（3 件とも残る）
    expect(body.fields.authors.length).toBe(3);
    // included には公開済みの 2 件だけ（author3 はソフト参照で不在）
    expect(body.included.map((record) => record.id).sort()).toStrictEqual(
      [author1, author2].sort(),
    );
  });

  it("rejects include of a non-relation field and unknown params", async () => {
    expect(
      (
        await app.request(
          `/public/v1/${tenantSlug}/records/post/${post1}?include=title`,
          {},
          env,
        )
      ).status,
    ).toBe(400);
    expect(
      (await app.request(`/public/v1/${tenantSlug}/records/post/${post1}?foo=1`, {}, env)).status,
    ).toBe(400);
  });

  it("answers 304 to a matching If-None-Match", async () => {
    const first = await app.request(`/public/v1/${tenantSlug}/records/post/${post1}`, {}, env);
    const etag = first.headers.get("etag");
    if (etag === null) {
      throw new Error("no etag");
    }
    const second = await app.request(
      `/public/v1/${tenantSlug}/records/post/${post1}`,
      { headers: { "if-none-match": etag } },
      env,
    );
    expect(second.status).toBe(304);
  });

  it("answers CORS preflight", async () => {
    const response = await app.request(
      `/public/v1/${tenantSlug}/records/post/${post1}`,
      {
        method: "OPTIONS",
        headers: { origin: "https://example.com", "access-control-request-method": "GET" },
      },
      env,
    );
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
  });
});
```

- [ ] **Step 3: テストが失敗することを確認**

Run: `pnpm --filter @plyrs/api exec vitest run --no-isolate --max-workers=1 test/public-single.test.ts`
Expected: FAIL — `/public/v1/...` が既存の notFound に落ちて 404（および CORS ヘッダ欠如）

- [ ] **Step 4: ルートを実装**

Create `apps/api/src/routes/public.ts`:

```ts
import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { canonicalCacheUrl, withEdgeCache } from "../public/cache";
import { loadCatalog } from "../public/catalog";
import { expandIncludes } from "../public/include";
import { parseInclude } from "../public/query";
import { toPublicRecord, type ProjectedRecordRow } from "../public/serialize";
import { resolveTenantId } from "../public/tenant-resolver";

// design-spec §12.4〜12.7 / G3: 公開 read API。投影 D1（+ コントロールプレーン D1 と KV の
// テナント解決）だけを読み、DO は絶対に起こさない。認証なし（公開経路）。
// projection_tombstones は読まない: projected_records に行が無ければ見えない、が公開状態の全て。

// 型キーはプラグイン名前空間（blog.post）も通す。形が違うものは D1 を引かず 404
const TYPE_KEY_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)?$/u;
const MAX_PARAM_LENGTH = 256;

interface SingleRow extends ProjectedRecordRow {
  publish_seq: number;
}

type PublicEnv = { Bindings: Env };

const SINGLE_COLUMNS = "record_id, type, slug, published_at, data, publish_seq";

async function serveSingle(
  c: Context<PublicEnv>,
  lookup: "id" | "slug",
  value: string,
): Promise<Response> {
  const type = c.req.param("type") ?? "";
  const tenantSlug = c.req.param("tenantSlug") ?? "";
  if (!TYPE_KEY_PATTERN.test(type) || value.length === 0 || value.length > MAX_PARAM_LENGTH) {
    return c.json({ error: "not_found" }, 404);
  }
  const tenantId = await resolveTenantId(c.env, tenantSlug);
  if (tenantId === null) {
    return c.json({ error: "unknown_tenant" }, 404);
  }
  const params = c.req.queries();
  for (const key of Object.keys(params)) {
    if (key !== "include") {
      return c.json({ error: "bad_query", message: `unknown query param: ${key}` }, 400);
    }
  }
  let include: string[] = [];
  const includeParam = params["include"];
  if (includeParam !== undefined) {
    if (includeParam.length !== 1 || includeParam[0] === undefined) {
      return c.json({ error: "bad_query", message: "query param must appear once: include" }, 400);
    }
    const catalog = await loadCatalog(c.env.PROJECTION_DB, tenantId, type);
    const parsed = parseInclude(includeParam[0], catalog);
    if (!parsed.ok) {
      return c.json({ error: "bad_query", message: parsed.error }, 400);
    }
    include = parsed.include;
  }
  const cacheUrl = canonicalCacheUrl(tenantId, `records/${type}/${lookup}/${value}`, params);
  return withEdgeCache(c, cacheUrl, async () => {
    const row =
      lookup === "id"
        ? await c.env.PROJECTION_DB.prepare(
            `SELECT ${SINGLE_COLUMNS} FROM projected_records WHERE tenant_id = ?1 AND record_id = ?2 AND type = ?3`,
          )
            .bind(tenantId, value, type)
            .first<SingleRow>()
        : await c.env.PROJECTION_DB.prepare(
            `SELECT ${SINGLE_COLUMNS} FROM projected_records WHERE tenant_id = ?1 AND type = ?2 AND slug = ?3`,
          )
            .bind(tenantId, type, value)
            .first<SingleRow>();
    if (row === null) {
      return c.json({ error: "not_found" }, 404);
    }
    const record = toPublicRecord(row);
    const body =
      include.length > 0
        ? {
            ...record,
            included: await expandIncludes(c.env.PROJECTION_DB, tenantId, [row.record_id], include),
          }
        : record;
    const response = c.json(body);
    // 裁定: publish_seq は公開しないが ETag の弱い検証子としての内部利用は可
    response.headers.set("etag", `W/"${row.publish_seq}"`);
    return response;
  });
}

export const publicRoutes = new Hono<PublicEnv>()
  .use("*", cors({ origin: "*", allowMethods: ["GET", "HEAD", "OPTIONS"] }))
  // 注意: slug ルートを :id ルートより先に登録する（静的セグメント優先を明示的に保証）
  .get("/:tenantSlug/records/:type/slug/:slug", (c) =>
    serveSingle(c, "slug", c.req.param("slug") ?? ""),
  )
  .get("/:tenantSlug/records/:type/:id", (c) => serveSingle(c, "id", c.req.param("id") ?? ""));
```

`apps/api/src/index.ts` — import に `publicRoutes` を足し、既存ルートの後・notFound の前にマウント:

```ts
import { publicRoutes } from "./routes/public";
```

```ts
app.route("/v1/t", tenantRoutes);
// design-spec §12: 公開 read（認証なし・DO 非経由・投影 D1 のみ）
app.route("/public/v1", publicRoutes);
```

- [ ] **Step 5: テストが通ることを確認**

Run: `pnpm --filter @plyrs/api exec vitest run --no-isolate --max-workers=1 test/public-single.test.ts`
Expected: PASS（8 tests）

- [ ] **Step 6: typecheck と既存テスト**

Run: `pnpm --filter @plyrs/api typecheck && pnpm --filter @plyrs/api exec vitest run --no-isolate --max-workers=1 test/smoke.test.ts test/auth-routes.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/routes/public.ts apps/api/src/index.ts apps/api/test/public-helpers.ts apps/api/test/public-single.test.ts
git commit -m "feat: serve public single-record reads by id and slug"
```

---

### Task 11: 公開ルート — 一覧（フィルタ / ソート / カーソル / include）

**Files:**
- Modify: `apps/api/src/routes/public.ts`
- Create: `apps/api/test/public-list.test.ts`

**Interfaces:**
- Consumes: `parseListQuery` / `DEFAULT_LIMIT`（Task 6）、`buildListQuery` / `ListRow`（Task 7）、`encodeCursor`（Task 5）、その他 Task 10 と同じ
- Produces: `GET /:tenantSlug/records/:type` が `{ items, included?, nextCursor }` を返す

- [ ] **Step 1: 失敗するテストを書く**

Create `apps/api/test/public-list.test.ts`:

```ts
import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { app } from "../src/index";
import type { ProjectionJob } from "../src/projection/jobs";
import type { TenantDO } from "../src/tenant-do";
import { articleType, auth, uuid } from "./fixtures";
import {
  authorType,
  deliverJobs,
  freshTenantSlug,
  postType,
  seedTenant,
  writeAndPublish,
} from "./public-helpers";

const authorA = uuid(420);
const authorB = uuid(421);
// record_id タイブレークを決定的にするため昇順の id を使う
const posts = [uuid(430), uuid(431), uuid(432), uuid(433), uuid(434)];

interface ListBody {
  items: { id: string; publishedAt: string; fields: Record<string, unknown> }[];
  included?: { id: string }[];
  nextCursor: string | null;
}

async function list(tenantSlug: string, query: string): Promise<{ status: number; body: ListBody }> {
  const response = await app.request(
    `/public/v1/${tenantSlug}/records/post${query}`,
    {},
    env,
  );
  return { status: response.status, body: (await response.json()) as ListBody };
}

async function walk(tenantSlug: string, baseQuery: string): Promise<string[]> {
  const ids: string[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < 10; i += 1) {
    const query = cursor === null ? baseQuery : `${baseQuery}&cursor=${encodeURIComponent(cursor)}`;
    const { status, body } = await list(tenantSlug, query);
    if (status !== 200) {
      throw new Error(`list failed: ${status}`);
    }
    ids.push(...body.items.map((item) => item.id));
    cursor = body.nextCursor;
    if (cursor === null) {
      return ids;
    }
  }
  throw new Error("cursor walk did not terminate");
}

describe("public list (§12.4 / §12.5)", () => {
  let tenantId: string;
  let tenantSlug: string;
  let stub: DurableObjectStub<TenantDO>;

  beforeEach(async () => {
    tenantId = crypto.randomUUID();
    tenantSlug = freshTenantSlug();
    await seedTenant(tenantId, tenantSlug);
    stub = env.TENANT_DO.get(env.TENANT_DO.idFromName(tenantId));
    await stub.registerContentType(authorType(), auth("owner1"));
    await stub.registerContentType(postType(), auth("owner1"));
    const jobs: ProjectionJob[] = [
      await writeAndPublish(stub, tenantId, "author", authorA, { name: "A", slug: "wa" }),
      await writeAndPublish(stub, tenantId, "author", authorB, { name: "B", slug: "wb" }),
    ];
    // p0: rating5 tech [x]   authors[A]
    // p1: rating5 life [y]   authors[A,B]
    // p2: rating3 tech [x,y] authors[B]
    // p3: rating無し life [z] authors[]
    // p4: rating1 tech featured [x] authors[A]
    const inputs: Record<string, unknown>[] = [
      { title: "p0", slug: "s0", rating: 5, category: "tech", tags: ["x"], authors: [{ type: "author", id: authorA }] },
      { title: "p1", slug: "s1", rating: 5, category: "life", tags: ["y"], authors: [{ type: "author", id: authorA }, { type: "author", id: authorB }] },
      { title: "p2", slug: "s2", rating: 3, category: "tech", tags: ["x", "y"], authors: [{ type: "author", id: authorB }] },
      { title: "p3", slug: "s3", category: "life", tags: ["z"], authors: [] },
      { title: "p4", slug: "s4", rating: 1, category: "tech", featured: true, tags: ["x"], authors: [{ type: "author", id: authorA }] },
    ];
    for (const [i, input] of inputs.entries()) {
      const id = posts[i];
      if (id === undefined) {
        throw new Error("fixture mismatch");
      }
      jobs.push(await writeAndPublish(stub, tenantId, "post", id, input));
    }
    await deliverJobs(jobs);
  });

  it("lists everything with the default sort and no included key", async () => {
    const { status, body } = await list(tenantSlug, "");
    expect(status).toBe(200);
    expect(body.items.length).toBe(5);
    expect(body.nextCursor).toBeNull();
    expect(body.included).toBeUndefined();
    // 既定ソート: システム published_at 降順・record_id 降順タイブレーク。
    // 期待順はレスポンス自身の publishedAt から計算して検証する（publish 時刻は制御できないため）
    const got = body.items.map((item) => item.id);
    const expected = [...body.items]
      .sort((a, b) =>
        a.publishedAt === b.publishedAt
          ? b.id.localeCompare(a.id)
          : b.publishedAt.localeCompare(a.publishedAt),
      )
      .map((item) => item.id);
    expect(got).toStrictEqual(expected);
  });

  it("walks the full set with limit=2 without gaps or duplicates", async () => {
    const ids = await walk(tenantSlug, "?limit=2");
    expect(ids.length).toBe(5);
    expect(new Set(ids).size).toBe(5);
  });

  it("sorts by an indexed number field in both directions, excluding value-less records", async () => {
    const desc = await walk(tenantSlug, "?sort=-rating&limit=2");
    expect(desc).toStrictEqual([posts[1], posts[0], posts[2], posts[4]]); // 5,5,3,1（p3 除外・同値は id 降順）
    const asc = await walk(tenantSlug, "?sort=rating&limit=2");
    expect(asc).toStrictEqual([posts[4], posts[2], posts[0], posts[1]]);
  });

  it("filters: any-of within a key, AND across keys, booleans, multi-select", async () => {
    const tech = await list(tenantSlug, "?filter[category]=tech");
    expect(tech.body.items.map((item) => item.id).sort()).toStrictEqual(
      [posts[0], posts[2], posts[4]].sort(),
    );
    const anyOf = await list(tenantSlug, "?filter[category]=tech&filter[category]=life");
    expect(anyOf.body.items.length).toBe(5);
    const combined = await list(tenantSlug, "?filter[category]=tech&filter[rating]=5");
    expect(combined.body.items.map((item) => item.id)).toStrictEqual([posts[0]]);
    const featured = await list(tenantSlug, "?filter[featured]=true");
    expect(featured.body.items.map((item) => item.id)).toStrictEqual([posts[4]]);
    const tagX = await list(tenantSlug, "?filter[tags]=x&filter[tags]=z"); // any-of（1値=1行）
    expect(tagX.body.items.map((item) => item.id).sort()).toStrictEqual(
      [posts[0], posts[2], posts[3], posts[4]].sort(),
    );
  });

  it("filters by relation membership", async () => {
    const byA = await list(tenantSlug, `?filter[authors]=${authorA}`);
    expect(byA.body.items.map((item) => item.id).sort()).toStrictEqual(
      [posts[0], posts[1], posts[4]].sort(),
    );
  });

  it("expands include=authors across the page, deduped", async () => {
    const { body } = await list(tenantSlug, "?include=authors");
    expect(body.included?.map((record) => record.id).sort()).toStrictEqual(
      [authorA, authorB].sort(),
    );
  });

  it("rejects bad queries with 400", async () => {
    for (const query of [
      "?filter[title]=x", // 索引宣言なし
      "?sort=tags", // 複数値ソートは未定義
      "?sort=authors",
      "?limit=0",
      "?limit=101",
      "?cursor=@@@",
      "?include=rating",
      "?unknown=1",
    ]) {
      const { status } = await list(tenantSlug, query);
      expect(status, query).toBe(400);
    }
  });

  it("stops listing a record once its unpublish delete lands", async () => {
    const target = posts[0];
    if (target === undefined) {
      throw new Error("fixture mismatch");
    }
    await stub.unpublishRecord(tenantId, target, auth("owner1"));
    // unpublish の delete ジョブは outbox の最終行から publish_seq を読む
    const row = await runInDurableObject(stub, async (_instance, state) => {
      const rows = state.storage.sql
        .exec<{ publish_seq: number; source_version: number }>(
          "SELECT publish_seq, source_version FROM outbox WHERE job_type = 'delete' ORDER BY rowid DESC LIMIT 1",
        )
        .toArray();
      const last = rows[0];
      if (last === undefined) {
        throw new Error("no delete outbox row");
      }
      return last;
    });
    await deliverJobs([
      {
        jobType: "delete",
        tenantId,
        recordId: target,
        sourceVersion: row.source_version,
        publishSeq: row.publish_seq,
      },
    ]);
    const { body } = await list(tenantSlug, "");
    expect(body.items.map((item) => item.id)).not.toContain(target);
    const single = await app.request(`/public/v1/${tenantSlug}/records/post/${target}`, {}, env);
    expect(single.status).toBe(404);
  });
});

// ロードマップ §9 / G4 と published_at シャドーイング: ユーザーが published_at という索引
// フィールドを宣言している型（fixtures の articleType）では、sort=published_at はシステム列
// ではなく宣言フィールド（projection_index）で並ぶ。
describe("public list published_at shadowing", () => {
  it("orders by the user-declared published_at field, not the publish timestamp", async () => {
    const tenantId = crypto.randomUUID();
    const tenantSlug = freshTenantSlug();
    await seedTenant(tenantId, tenantSlug);
    const stub = env.TENANT_DO.get(env.TENANT_DO.idFromName(tenantId));
    await stub.registerContentType(articleType(), auth("owner1"));
    const early = uuid(440);
    const late = uuid(441);
    // publish 順は early が後、宣言フィールドの値は early が古い —— 並びが値に従うことを見る
    const jobs = [
      await writeAndPublish(stub, tenantId, "article", late, {
        title: "遅",
        slug: "late",
        published_at: "2026-07-13T00:00:00.000Z",
        authors: [{ type: "author", id: uuid(442) }],
      }),
      await writeAndPublish(stub, tenantId, "article", early, {
        title: "早",
        slug: "early",
        published_at: "2026-01-01T00:00:00.000Z",
        authors: [{ type: "author", id: uuid(442) }],
      }),
    ];
    await deliverJobs(jobs);
    const response = await app.request(
      `/public/v1/${tenantSlug}/records/article?sort=-published_at`,
      {},
      env,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { items: { id: string }[] };
    expect(body.items.map((item) => item.id)).toStrictEqual([late, early]);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm --filter @plyrs/api exec vitest run --no-isolate --max-workers=1 test/public-list.test.ts`
Expected: FAIL — 一覧パスが 404（Task 10 の時点ではルート未定義）

- [ ] **Step 3: 一覧ルートを実装**

`apps/api/src/routes/public.ts` — import を追加・更新（既存の `import { parseInclude } from "../public/query";` は下の行で**置き換える**。`loadCatalog` の import 行も型 import を足して置き換える）:

```ts
import { encodeCursor } from "../public/cursor";
import { parseInclude, parseListQuery } from "../public/query";
import { buildListQuery, type ListRow } from "../public/sql";
import { loadCatalog, type CatalogEntry } from "../public/catalog";
```

`publicRoutes` のチェーンの `.use("*", cors(...))` の直後（slug ルートの**前**）に一覧ルートを追加:

```ts
  .get("/:tenantSlug/records/:type", async (c) => {
    const type = c.req.param("type") ?? "";
    if (!TYPE_KEY_PATTERN.test(type)) {
      return c.json({ error: "not_found" }, 404);
    }
    const tenantId = await resolveTenantId(c.env, c.req.param("tenantSlug") ?? "");
    if (tenantId === null) {
      return c.json({ error: "unknown_tenant" }, 404);
    }
    const params = c.req.queries();
    // 最頻の「素の一覧」（フィルタ/ソート/include なし）でカタログの 1 クエリを節約する。
    // 空カタログでも既定ソート（システム published_at）と limit/cursor 検証は成立する。
    const needsCatalog = Object.keys(params).some(
      (key) => key === "sort" || key === "include" || key.startsWith("filter["),
    );
    const catalog = needsCatalog
      ? await loadCatalog(c.env.PROJECTION_DB, tenantId, type)
      : new Map<string, CatalogEntry>();
    const parsed = parseListQuery(params, catalog);
    if (!parsed.ok) {
      return c.json({ error: "bad_query", message: parsed.error }, 400);
    }
    const query = parsed.query;
    const cacheUrl = canonicalCacheUrl(tenantId, `records/${type}`, params);
    return withEdgeCache(c, cacheUrl, async () => {
      const built = buildListQuery(tenantId, type, query);
      const { results } = await c.env.PROJECTION_DB.prepare(built.sql)
        .bind(...built.binds)
        .all<ListRow>();
      const hasMore = results.length > query.limit;
      const page = hasMore ? results.slice(0, query.limit) : results;
      const last = page[page.length - 1];
      const nextCursor =
        hasMore && last !== undefined
          ? encodeCursor({
              k:
                query.sort.column === "published_at"
                  ? last.published_at
                  : (last.sort_value ?? null),
              id: last.record_id,
            })
          : null;
      const body: Record<string, unknown> = { items: page.map(toPublicRecord), nextCursor };
      if (query.include.length > 0) {
        body["included"] = await expandIncludes(
          c.env.PROJECTION_DB,
          tenantId,
          page.map((row) => row.record_id),
          query.include,
        );
      }
      return c.json(body);
    });
  })
```

（`unpublishRecord` の RPC シグネチャは `apps/api/src/tenant-do.ts` を確認して合わせること。テスト中の呼び出し `stub.unpublishRecord(target, auth("owner1"))` が違っていたら**テスト側を**実シグネチャに直す。）

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm --filter @plyrs/api exec vitest run --no-isolate --max-workers=1 test/public-list.test.ts test/public-single.test.ts`
Expected: PASS（キャッシュの巻き込みに注意 — 一覧テストはテナントごとに一意な slug/ID を使っているので、同一 URL の再利用は起きない）

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/public.ts apps/api/test/public-list.test.ts
git commit -m "feat: serve public list reads with filters, sort, keyset pagination, and include"
```

---

### Task 12: キャッシュ統合テスト・設計文書追記・全体検証

**Files:**
- Create: `apps/api/test/public-cache.test.ts`
- Modify: `docs/design-spec.md`（§12.2）

**Interfaces:**
- Consumes: Task 10/11 のルートと Task 9 のキャッシュ実装（新規コードなし。挙動の統合検証）

- [ ] **Step 1: 統合テストを書く**

Create `apps/api/test/public-cache.test.ts`:

```ts
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { app } from "../src/index";
import type { TenantDO } from "../src/tenant-do";
import { auth, uuid } from "./fixtures";
import {
  authorType,
  deliverJobs,
  freshTenantSlug,
  postType,
  seedTenant,
  writeAndPublish,
} from "./public-helpers";

const post1 = uuid(450);
const post2 = uuid(451);

describe("public edge cache (§12.6: Cache API + 短 TTL・パージなし)", () => {
  let tenantId: string;
  let tenantSlug: string;
  let stub: DurableObjectStub<TenantDO>;

  beforeEach(async () => {
    tenantId = crypto.randomUUID();
    tenantSlug = freshTenantSlug();
    await seedTenant(tenantId, tenantSlug);
    stub = env.TENANT_DO.get(env.TENANT_DO.idFromName(tenantId));
    await stub.registerContentType(authorType(), auth("owner1"));
    await stub.registerContentType(postType(), auth("owner1"));
    await deliverJobs([
      await writeAndPublish(stub, tenantId, "post", post1, {
        title: "キャッシュ対象",
        slug: "cached",
        authors: [],
      }),
    ]);
  });

  it("serves the cached single body within the TTL even if the projection changes", async () => {
    const path = `/public/v1/${tenantSlug}/records/post/${post1}`;
    const first = await app.request(path, {}, env);
    expect(first.status).toBe(200);
    const firstBody = await first.text();
    // 投影を直接書き換える（派生ストアなのでテスト操作として正当）
    await env.PROJECTION_DB.prepare(
      "UPDATE projected_records SET data = '{\"title\":\"改変後\"}' WHERE tenant_id = ?1 AND record_id = ?2",
    )
      .bind(tenantId, post1)
      .run();
    const second = await app.request(path, {}, env);
    expect(await second.text()).toBe(firstBody); // TTL 内はキャッシュが答える
  });

  it("normalizes the query string into one cache key (param order irrelevant)", async () => {
    const first = await app.request(
      `/public/v1/${tenantSlug}/records/post?limit=5&sort=-published_at`,
      {},
      env,
    );
    expect(first.status).toBe(200);
    const firstBody = await first.text();
    await env.PROJECTION_DB.prepare(
      "UPDATE projected_records SET data = '{\"title\":\"改変後2\"}' WHERE tenant_id = ?1 AND record_id = ?2",
    )
      .bind(tenantId, post1)
      .run();
    const reordered = await app.request(
      `/public/v1/${tenantSlug}/records/post?sort=-published_at&limit=5`,
      {},
      env,
    );
    expect(await reordered.text()).toBe(firstBody); // 並び替えても同じキャッシュキー
  });

  it("does not cache a 404 (the record appears as soon as the projection lands)", async () => {
    const path = `/public/v1/${tenantSlug}/records/post/${post2}`;
    expect((await app.request(path, {}, env)).status).toBe(404);
    await deliverJobs([
      await writeAndPublish(stub, tenantId, "post", post2, {
        title: "後から公開",
        slug: "late-pub",
        authors: [],
      }),
    ]);
    expect((await app.request(path, {}, env)).status).toBe(200);
  });
});
```

- [ ] **Step 2: テストを実行**

Run: `pnpm --filter @plyrs/api exec vitest run --no-isolate --max-workers=1 test/public-cache.test.ts`
Expected: PASS（3 tests）。FAIL した場合はキャッシュ実装（Task 9/10/11 の配線）のバグなので、superpowers:systematic-debugging で原因を特定してから直す。

- [ ] **Step 3: design-spec §12.2 に projection_fields を追記**

`docs/design-spec.md` の §12.2「投影の物理設計（3テーブル）」の projection_index の箇条書き（`- **projection_index（索引専用サイドテーブル）**: ...` の段落）の直後に追加:

```markdown
- **projection_fields（フィールドカタログ。Phase 5b で追加）**: `(tenant_id, type, field_key, kind, multi)`。公開 read API が「フィルタ/ソート可能なフィールドか・値がどの型別カラムにあるか・複数値か」を **DO を起こさずに**知るための、content_types の索引宣言部分の投影。「フィールドの型は `content_types` から既知なので、クエリ層が適切な列を選べる」（上記）の公開側の実体がこの表になる。record の投影 upsert に相乗りして LWW で更新し、再投影の mark-and-sweep が宣言から消えた行を掃く。
```

また、同節の「**投影の物理設計（3テーブル）**」という見出し文言を「**投影の物理設計（3テーブル＋カタログ）**」に変更する。

- [ ] **Step 4: 全体検証（リポジトリルートで）**

Run: `pnpm -r test`
Expected: PASS（Phase 5a 時点の 311 tests + 本フェーズ追加分がすべて green。**実出力の末尾サマリをレポートに貼る**）

Run: `pnpm typecheck && pnpm lint && pnpm format:check`
Expected: すべて PASS（format:check が落ちたら `pnpm format` を実行して差分をコミットに含める）

- [ ] **Step 5: Commit**

```bash
git add apps/api/test/public-cache.test.ts docs/design-spec.md
git commit -m "test: pin the public edge cache behavior and document the field catalog"
```

---

## Self-Review（計画作成時に実施済み）

- **§12.4**: 単体（id/slug）= Task 10、一覧 + フィルタ（等値・関係メンバーシップ・any-of）+ ソート（索引宣言済み・単一値のみ）+ カーソル = Task 6/7/11。無制限クエリ拒否 = parseListQuery の RESERVED_PARAMS / カタログ検証。
- **§12.5**: 関係解決は projected_relations のみ・ソフト参照 = Task 8。編集 UX の publish 時警告は管理 UI（Phase 6）のスコープで対象外。
- **§12.6**: Cache API + 短 TTL = Task 9/12。
- **G3**: `/public/v1/:tenantSlug/...`・KV + control-plane D1・DO 非経由 = Task 4/10。
- **申し送り**: tombstone 非参照（フィルタ無し）= 実装がそもそも読まない + Task 11 の unpublish テスト。複数値ソート拒否 = Task 6。projection_index はレコード復元に不使用 = Task 7 の設計（実体は必ず projected_records から）。
- **公開経路の DO 非到達**: `src/public/**` / `routes/public.ts` に TENANT_DO 参照なし（Global Constraints で禁止を明文化）。
- **型整合**: `CatalogKind`（payload.ts）→ `CatalogEntry`（catalog.ts）→ `parseListQuery` → `buildListQuery` → ルート、`CursorPayload`（k: null 許容）→ `ListCursor`（k: 非 null に絞る）の変換は Task 6 の parse 内。`placeholders` は Task 7 が定義し Task 8 が import。
