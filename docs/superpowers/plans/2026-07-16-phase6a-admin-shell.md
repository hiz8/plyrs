# Phase 6a: 管理画面シェル Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Phase 5c housekeeping を消化した上で、apps/admin（TanStack Start SPA）と packages/ui（react-aria-components + StyleX）を新設し、ログイン → テナント選択 → 認証済みシェル → content_type 一覧表示までを動くソフトウェアとして成立させる。

**Architecture:** admin は独立 Worker で、`/auth`・`/v1` へのリクエストを service binding で api Worker へ転送する same-origin プロキシ（SameSite=Strict のセッション cookie がそのまま機能し、CORS/CSRF 面を開かない）。短命 JWT はメモリのみ保持で exp 前に先回りリフレッシュ。URL はテナント slug を path に含める `/t/$tenantSlug/...`。スロット語彙（論点P）は SlotRegistry 機構 + `nav:item` の実配線 + `record-editor:*` の型予約が初版。

**Tech Stack:** React 19 / TanStack Start（SPA モード・exact pin）/ TanStack Router / TanStack Query / react-aria-components / StyleX（@stylexjs/unplugin）/ Vite + @cloudflare/vite-plugin / Vitest + jsdom + React Testing Library / Hono + Drizzle（api 側追加分）

## 裁定事項（2026-07-16 確定・全タスクの前提）

1. **デプロイ形態**: admin = 独立 Worker。`/auth`・`/v1` は service binding（`API`）で api Worker へ転送（same-origin）。
2. **トークン**: 短命 JWT はメモリのみ保持（storage 禁止）。exp の 60 秒前を切ったら `/auth/token` で再取得。リロード時はセッション cookie から再取得（1 往復）。
3. **URL 設計**: `/login`・`/signup`・`/tenants`（選択）→ `/t/$tenantSlug/content-types`。slug→tenantId は新設の `GET /auth/tenants` が返す一覧から解決。
4. **スロット語彙初版**: `nav:item`（実配線）+ `record-editor:panel` / `record-editor:toolbar`（型予約、6b で配線）。
5. **テスト**: Vitest + jsdom + RTL を packages/ui / apps/admin 共通。packages/ui = コンポーネント単体、apps/admin = 認証・ルーティングロジック（fetch スタブ）。実ブラウザ検証は Phase 10 の Playwright。
6. **404 応答**: `unknown_tenant` / `not_found` は統一しない（理由は Task 14 でロードマップに記録）。

## Global Constraints

- `@ts-expect-error` / `any` 禁止（型の橋渡しは rpc-unwrap 方式の文書化された cast 関数 1 箇所に閉じる）。
- commit 件名は **50 字上限**（verify-commit-message.sh フックが機械拒否する）。
- lint/format は oxlint / oxfmt。ゲートはルートの `pnpm lint` / `pnpm format:check` / `pnpm typecheck` / `pnpm test`。
- 依存はすべて `pnpm-workspace.yaml` の catalog 経由（`"catalog:"` 参照）。**exact pin**: `@tanstack/react-start` = `1.168.28`、`@tanstack/react-router` = `1.170.18`（Start 1.168.28 の直接依存と一致させる。ずらすと二重インストールになる）、`@stylexjs/stylex` / `@stylexjs/unplugin` = `0.19.0`（0.x のため）。
- apps/api の tsconfig は `"lib": ["ES2023"]`（DOM 禁止）。apps/admin / packages/ui は DOM が必要なので tsconfig を分ける。admin の Worker エントリ（src/server.ts）は DOM 混入を避けるため **別 tsconfig（tsconfig.worker.json）** で検査する。
- 格納・転送の datetime は常に UTC ISO8601 文字列（design-spec §5）。
- テナント slug の規則は `apps/api/src/routes/tenants.ts` の `TENANT_SLUG_PATTERN` / `TENANT_SLUG_MAX_LENGTH` が唯一の真実源。
- apps/api のテストは @cloudflare/vitest-pool-workers（`--no-isolate --max-workers=1`・全テスト共有ストレージ・ID は `crypto.randomUUID()`）。フロント側は素の Vitest + jsdom。
- 生成物（`apps/admin/src/routeTree.gen.ts`・`apps/admin/worker-configuration.d.ts`)はコミットするが lint/format の対象から除外する（Task 10）。

## File Structure（このフェーズで触るファイルの全体像）

```
apps/api/src/public/sql.ts              # Task 1: chunk / D1_BIND_CHUNK_SIZE を共有化
apps/api/src/public/include.ts          # Task 1,2: 共有 chunk 使用・二重読み解消・関数移設
apps/api/src/public/cache.ts            # Task 1: toSorted
apps/api/src/public/query.ts            # Task 1: toSorted / Task 4: date 書式検証
apps/api/src/public/catalog.ts          # Task 4: 未知 kind skip
apps/api/src/projection/payload.ts      # Task 4: CATALOG_KINDS / isCatalogKind
apps/api/src/routes/public.ts           # Task 1,2,3: chunk 削除・include 配線・cache 前段化
apps/api/src/routes/auth.ts             # Task 5: GET /auth/tenants
apps/api/src/routes/tenant.ts           # Task 6: GET /v1/t/:tenantId/content-types
apps/api/src/tenant-do.ts               # Task 6: listContentTypes RPC
apps/api/src/rpc-unwrap.ts              # Task 6: asContentTypeRows
apps/api/test/*                         # Task 1〜6 の各テスト
pnpm-workspace.yaml                     # Task 7: catalog 追加
packages/ui/*                           # Task 7,8,9: 新設（compose / tokens / Button / TextField / slots）
apps/admin/*                            # Task 10〜13: 新設（Start SPA + proxy + auth + shell）
.oxlintrc.json / .oxfmtignore           # Task 10: 生成物の除外
docs/superpowers/plans/2026-07-12-implementation-roadmap.md  # Task 14: §10 housekeeping 消化の記録
```

依存関係: Task 1→2→3 は同一ファイル群を触るため直列。Task 4・5・6 は相互独立（Task 1〜3 の後なら任意順）。Task 7→8/9（ui 内は 7 が先）。Task 10 は Task 7 の後。Task 11→12→13 は直列。Task 14 は最後。

---

### Task 1: chunk の共有化と Array#sort → toSorted の全消し

**Files:**
- Modify: `apps/api/src/public/sql.ts`（chunk / D1_BIND_CHUNK_SIZE を追加）
- Modify: `apps/api/src/public/sql.test.ts`（chunk のテスト追加）
- Modify: `apps/api/src/public/include.ts`（ローカル chunk を削除し共有版へ）
- Modify: `apps/api/src/routes/public.ts:44-52`（ローカル chunk を削除し共有版へ）
- Modify: `apps/api/src/public/cache.ts:19-20`・`apps/api/src/public/query.ts:118`（toSorted）
- Modify: `apps/api/test/public-list.test.ts`・`apps/api/test/public-single.test.ts`（toSorted）

**Interfaces:**
- Consumes: 既存の `placeholders(count: number): string`（sql.ts）
- Produces: `export const D1_BIND_CHUNK_SIZE = 50` / `export function chunk<T>(items: T[], size: number): T[][]`（Task 2 の include.ts が使う）

- [ ] **Step 1: 失敗するテストを書く**

`apps/api/src/public/sql.test.ts` の既存 import に `chunk` を追加し（`import { ..., chunk } from "./sql";`）、ファイル末尾に追加:

```ts
describe("chunk (Phase 5c: include.ts と routes/public.ts の重複解消)", () => {
  it("splits items into fixed-size chunks preserving order", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toStrictEqual([[1, 2], [3, 4], [5]]);
  });

  it("returns a single chunk when the list fits", () => {
    expect(chunk(["a"], 50)).toStrictEqual([["a"]]);
  });

  it("returns no chunks for an empty list", () => {
    expect(chunk([], 50)).toStrictEqual([]);
  });
});
```

- [ ] **Step 2: 失敗を確認**

Run: `pnpm --filter @plyrs/api test -- sql.test.ts`
Expected: FAIL（`chunk` が export されていない）

- [ ] **Step 3: sql.ts に実装し、2 つの重複定義を差し替える**

`apps/api/src/public/sql.ts` の `placeholders` の直後に追加:

```ts
// D1 のバインド上限（100/クエリ）に対する IN 句展開の安全マージン。placeholders() と同じく
// 「バインド列を組み立てる低水準ヘルパー」としてここに置く（Phase 5c: include.ts と
// routes/public.ts に重複していた定義の共有先）。
export const D1_BIND_CHUNK_SIZE = 50;

export function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}
```

`apps/api/src/public/include.ts`: 行 8〜16 の `const CHUNK_SIZE = 50;` と `function chunk<T>(...)` を削除し、import を次に変更。`chunk(sourceIds, CHUNK_SIZE)` / `chunk([...targetIds], CHUNK_SIZE)` の 2 箇所を `D1_BIND_CHUNK_SIZE` に変更:

```ts
import { chunk, D1_BIND_CHUNK_SIZE, placeholders } from "./sql";
```

`apps/api/src/routes/public.ts`: 行 44〜52 の `const RELATION_ID_CHUNK_SIZE = 50;` と `function chunk<T>(...)` を削除し、既存の sql import を次に変更。`chunk(recordIds, RELATION_ID_CHUNK_SIZE)` を `chunk(recordIds, D1_BIND_CHUNK_SIZE)` に変更:

```ts
import { buildListQuery, chunk, D1_BIND_CHUNK_SIZE, placeholders, type ListRow } from "../public/sql";
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm --filter @plyrs/api test`
Expected: PASS（397 tests + 新規 3）

- [ ] **Step 5: Array#sort → toSorted（lint warning 全消し）**

いずれも「コピーを作ってソート」または「map() の戻り値をソート」なので `toSorted` へ機械的に置換できる:

`apps/api/src/public/cache.ts:19-20`:
```ts
  for (const key of Object.keys(params).toSorted()) {
    for (const value of (params[key] ?? []).toSorted()) {
```
（旧: `Object.keys(params).sort()` / `[...(params[key] ?? [])].sort()` — toSorted は元配列を変更しないためスプレッドコピーも外す）

`apps/api/src/public/query.ts:118`:
```ts
  return { ok: true, include: [...new Set(keys)].toSorted() };
```

`apps/api/test/public-list.test.ts:142`: `const expected = [...body.items]` + `.sort((a, b) =>` → `const expected = body.items.toSorted((a, b) =>`（スプレッドを外す）

`apps/api/test/public-list.test.ts:176-177, 186-187, 193-194, 200-201` と `apps/api/test/public-single.test.ts:180-181`: すべて `〜.map(...).sort()` と `[...].sort()` の比較なので、`.sort()` を `.toSorted()` に置換（計 11 箇所。`pnpm lint` の警告出力を正として全件処理する）。

- [ ] **Step 6: lint がゼロ警告・テスト green を確認**

Run: `pnpm lint`
Expected: `no-array-sort` 警告が 0 件（"Found 0 warnings and 0 errors" 相当）

Run: `pnpm --filter @plyrs/api test`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/public/sql.ts apps/api/src/public/sql.test.ts apps/api/src/public/include.ts apps/api/src/public/cache.ts apps/api/src/public/query.ts apps/api/src/routes/public.ts apps/api/test/public-list.test.ts apps/api/test/public-single.test.ts
git commit -m "refactor: share chunk helper and use toSorted"
```

---

### Task 2: include 経路の projected_relations 二重読み解消

**Files:**
- Modify: `apps/api/src/public/include.ts`（全面書き換え: loadFieldRelationIdsForRecords を routes/public.ts から移設、collectIncludeTargetIds 新設、expandIncludes の引数変更）
- Modify: `apps/api/src/public/include.test.ts`（新 API に合わせ書き換え）
- Modify: `apps/api/src/routes/public.ts`（ローカル loadFieldRelationIdsForRecords を削除し include.ts 版を使用）

**Interfaces:**
- Consumes: Task 1 の `chunk` / `D1_BIND_CHUNK_SIZE`、既存 `toPublicRecord` / `ProjectedRecordRow` / `PublicRecord`（serialize.ts）、`placeholders`（sql.ts）
- Produces（Task 3 と Task 13 の HTTP 層が依存する最終形）:
  - `loadFieldRelationIdsForRecords(db: D1Database, tenantId: string, recordIds: string[]): Promise<Map<string, Record<string, string[]>>>`
  - `collectIncludeTargetIds(relationIds: Map<string, Record<string, string[]>>, includeFields: string[]): string[]`
  - `expandIncludes(db: D1Database, tenantId: string, targetIds: string[]): Promise<PublicRecord[]>`

**背景（ロードマップ §10 の defer）:** 単体/一覧レスポンスは常に `loadFieldRelationIdsForRecords` で projected_relations を読む。include 指定時は従来さらに `expandIncludes` が同じテーブルから DISTINCT target_id を引き直していた（二重読み）。対象 ID は 1 回目の読み取り結果から導出できる。

- [ ] **Step 1: 失敗するテストを書く（include.test.ts を新 API へ書き換え）**

`apps/api/src/public/include.test.ts` 全体を以下へ置き換える（seed ヘルパーと beforeAll・toPublicRecord の describe は現行のまま維持し、`expandIncludes` の describe を差し替え、import を変更する）:

```ts
import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import {
  collectIncludeTargetIds,
  expandIncludes,
  loadFieldRelationIdsForRecords,
} from "./include";
import { toPublicRecord } from "./serialize";

const tenantId = crypto.randomUUID();
let relationOrdinal = 0;

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
  const ordinal = relationOrdinal++;
  await env.PROJECTION_DB.prepare(
    "INSERT INTO projected_relations (tenant_id, source_id, source_field, target_type, target_id, ordinal, origin) VALUES (?1, ?2, ?3, 'author', ?4, ?5, ?6)",
  )
    .bind(tenantId, sourceId, sourceField, targetId, ordinal, origin)
    .run();
}

beforeAll(async () => {
  // テーブルをクリアして再セット
  await env.PROJECTION_DB.prepare("DELETE FROM projected_relations WHERE tenant_id = ?")
    .bind(tenantId)
    .run();
  await env.PROJECTION_DB.prepare("DELETE FROM projected_records WHERE tenant_id = ?")
    .bind(tenantId)
    .run();

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

describe("loadFieldRelationIdsForRecords (field 由来のみ・ordinal 順)", () => {
  it("maps record ids to per-field ordered target id arrays", async () => {
    const map = await loadFieldRelationIdsForRecords(env.PROJECTION_DB, tenantId, [
      "post1",
      "post2",
    ]);
    expect(map.get("post1")).toStrictEqual({ authors: ["author1", "author3"] });
    expect(map.get("post2")).toStrictEqual({
      authors: ["author1", "author2"],
      hero: ["author2"],
    });
  });

  it("excludes body-origin relations", async () => {
    const map = await loadFieldRelationIdsForRecords(env.PROJECTION_DB, tenantId, ["post1"]);
    expect(map.get("post1")?.["embedded"]).toBeUndefined();
  });

  it("chunks large id lists under the D1 bind limit", async () => {
    const sources = Array.from({ length: 120 }, (_, i) => `ghost-${i}`).concat(["post1"]);
    const map = await loadFieldRelationIdsForRecords(env.PROJECTION_DB, tenantId, sources);
    expect(map.get("post1")).toStrictEqual({ authors: ["author1", "author3"] });
  });
});

describe("collectIncludeTargetIds (Phase 5c: 二重読みの解消)", () => {
  it("collects ids of the requested fields only, deduped across records", async () => {
    const map = await loadFieldRelationIdsForRecords(env.PROJECTION_DB, tenantId, [
      "post1",
      "post2",
    ]);
    expect(collectIncludeTargetIds(map, ["authors"]).toSorted()).toStrictEqual([
      "author1",
      "author2",
      "author3",
    ]);
    expect(collectIncludeTargetIds(map, ["hero"])).toStrictEqual(["author2"]);
    expect(collectIncludeTargetIds(map, [])).toStrictEqual([]);
    expect(collectIncludeTargetIds(new Map(), ["authors"])).toStrictEqual([]);
  });
});

describe("expandIncludes (§12.5: projected_records の取得とソフト参照)", () => {
  it("fetches published targets sorted by id, dropping unpublished ones", async () => {
    const included = await expandIncludes(env.PROJECTION_DB, tenantId, [
      "author2",
      "author1",
      "author3",
    ]);
    expect(included.map((record) => record.id)).toStrictEqual(["author1", "author2"]);
  });

  it("returns empty for empty input", async () => {
    expect(await expandIncludes(env.PROJECTION_DB, tenantId, [])).toStrictEqual([]);
  });

  it("chunks large target lists under the D1 bind limit", async () => {
    const targets = Array.from({ length: 120 }, (_, i) => `ghost-${i}`).concat(["author1"]);
    const included = await expandIncludes(env.PROJECTION_DB, tenantId, targets);
    expect(included.map((record) => record.id)).toStrictEqual(["author1"]);
  });
});
```

- [ ] **Step 2: 失敗を確認**

Run: `pnpm --filter @plyrs/api test -- include.test.ts`
Expected: FAIL（`collectIncludeTargetIds` / `loadFieldRelationIdsForRecords` が include.ts に無い）

- [ ] **Step 3: include.ts を書き換える（完全な新内容）**

`apps/api/src/public/include.ts` 全体:

```ts
import { toPublicRecord, type ProjectedRecordRow, type PublicRecord } from "./serialize";
import { chunk, D1_BIND_CHUNK_SIZE, placeholders } from "./sql";

// §12.5: 公開経路の関係解決は projected_relations に対してのみ行う。参照先が投影に無ければ
// （未公開 / 取り下げ済み）その参照は黙って不在になる（ソフト参照。エラーにしない）。
// 展開は field 由来のみ（body 由来のリンクはレコード本文の関心。Phase 7）。

// design-spec §6: 関係は data に入らない（write-record.test.ts で確定済みの不変条件）ので
// toPublicRecord() が返す fields には関係フィールドの値が一切現れない。裁定（2026-07-14 #3）:
// 既定でも関係フィールドは ID 配列として fields に現れる — include は included[] の同梱だけを
// 制御し、fields の形を変えない。未公開参照先の ID も残る（ソフト参照で included にだけ現れない）。
// 単体・一覧の両方から呼ぶ: 対象 record_id 全件の field 由来の関係をチャンク内 1 回で引き、
// record_id → フィールド別 ID 配列 の Map を返す（カタログ不要: 非関係フィールドはそもそも行が無い）。
export async function loadFieldRelationIdsForRecords(
  db: D1Database,
  tenantId: string,
  recordIds: string[],
): Promise<Map<string, Record<string, string[]>>> {
  const byRecord = new Map<string, Record<string, string[]>>();
  for (const idChunk of chunk(recordIds, D1_BIND_CHUNK_SIZE)) {
    const { results } = await db
      .prepare(
        "SELECT source_id, source_field, target_id FROM projected_relations" +
          " WHERE tenant_id = ? AND origin = 'field'" +
          ` AND source_id IN (${placeholders(idChunk.length)})` +
          " ORDER BY source_field, ordinal",
      )
      .bind(tenantId, ...idChunk)
      .all<{ source_id: string; source_field: string; target_id: string }>();
    for (const row of results) {
      const byField = byRecord.get(row.source_id) ?? {};
      const list = byField[row.source_field] ?? [];
      list.push(row.target_id);
      byField[row.source_field] = list;
      byRecord.set(row.source_id, byField);
    }
  }
  return byRecord;
}

// Phase 5c housekeeping: include の対象 ID は loadFieldRelationIdsForRecords の結果から導出する
// （従来は projected_relations をもう一度 DISTINCT で引き直していた = 同一テーブルの二重読み）。
export function collectIncludeTargetIds(
  relationIds: Map<string, Record<string, string[]>>,
  includeFields: string[],
): string[] {
  const targetIds = new Set<string>();
  for (const byField of relationIds.values()) {
    for (const field of includeFields) {
      for (const id of byField[field] ?? []) {
        targetIds.add(id);
      }
    }
  }
  return [...targetIds];
}

export async function expandIncludes(
  db: D1Database,
  tenantId: string,
  targetIds: string[],
): Promise<PublicRecord[]> {
  if (targetIds.length === 0) {
    return [];
  }
  const included: PublicRecord[] = [];
  for (const idChunk of chunk(targetIds, D1_BIND_CHUNK_SIZE)) {
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
  return included.toSorted((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
```

- [ ] **Step 4: routes/public.ts を新 API に配線する**

`apps/api/src/routes/public.ts`:

1. ローカルの `loadFieldRelationIdsForRecords` 関数（コメントブロック含む）を削除する。
2. import を変更: `import { collectIncludeTargetIds, expandIncludes, loadFieldRelationIdsForRecords } from "../public/include";`
3. `serveSingle` の include 分岐を次に変更（`relationIds` は既に手前で取得済み）:

```ts
    const body =
      include.length > 0
        ? {
            ...base,
            included: await expandIncludes(
              c.env.PROJECTION_DB,
              tenantId,
              collectIncludeTargetIds(relationIds, include),
            ),
          }
        : base;
```

4. 一覧ルートの include 分岐を次に変更:

```ts
      if (query.include.length > 0) {
        body["included"] = await expandIncludes(
          c.env.PROJECTION_DB,
          tenantId,
          collectIncludeTargetIds(relationIds, query.include),
        );
      }
```

- [ ] **Step 5: テストが通ることを確認**

Run: `pnpm --filter @plyrs/api test`
Expected: PASS（public-single / public-list の include テストは挙動不変のため無修正で green のはず。落ちた場合は挙動が変わっている = 実装ミス）

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/public/include.ts apps/api/src/public/include.test.ts apps/api/src/routes/public.ts
git commit -m "refactor: derive include targets from one read"
```

---

### Task 3: cache.match をクエリ検証より前段へ

**Files:**
- Modify: `apps/api/src/routes/public.ts`（serveSingle と一覧ルートの再構成）
- Create: `apps/api/test/public-cache-order.test.ts`

**Interfaces:**
- Consumes: Task 2 の include.ts API、既存 `withEdgeCache` / `canonicalCacheUrl`（cache.ts）、`loadCatalog`（catalog.ts）、`parseListQuery` / `parseInclude`（query.ts）
- Produces: HTTP 挙動は不変（同一入力に同一応答）。キャッシュヒット時に投影 D1 を読まない、が新しい保証。

**背景（ロードマップ §10 の defer）:** 従来はカタログ読み込み（D1 1 クエリ）とクエリ検証をキャッシュ照会より先に行っていた。キャッシュキーは `canonicalCacheUrl(tenantId, path, params)` で全クエリパラメータを含むため、ヒットした応答は「同一パラメータで過去に 200 を返した」ことを意味し、検証の後回しは安全。400/404 は `withEdgeCache` が 200 以外を保存しないため汚染しない。テナント解決（KV/コントロールプレーン D1）はキャッシュキーに tenantId が要るため前段に残る。

- [ ] **Step 1: 失敗するテストを書く**

Create `apps/api/test/public-cache-order.test.ts`:

```ts
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/d1";
import { tenants } from "@plyrs/db/control-plane";
import { app } from "../src/index";

// Phase 5c housekeeping: cache.match をクエリ検証（カタログ読み込み含む）より前段に移した。
// ウォームキャッシュのヒット時には投影 D1 に一切触れないことを、PROJECTION_DB を
// 「触ったら throw する」バインディングに差し替えた env で実証する（キャッシュキーは全
// パラメータを含むため、ヒット = 同一パラメータで過去に 200 を返した、であり検証省略は安全）。

const RUN_ID = crypto.randomUUID().slice(0, 8);

async function seedTenant(slug: string): Promise<string> {
  const tenantId = crypto.randomUUID();
  await drizzle(env.DB)
    .insert(tenants)
    .values({ id: tenantId, slug, name: slug, createdAt: new Date().toISOString() });
  return tenantId;
}

function poisonedProjectionDb(): D1Database {
  return new Proxy({} as D1Database, {
    get() {
      throw new Error("PROJECTION_DB must not be touched on a cache hit");
    },
  });
}

describe("edge cache ordering (Phase 5c)", () => {
  it("serves a warm list from cache without touching the projection DB", async () => {
    const slug = `cache-order-${RUN_ID}`;
    const tenantId = await seedTenant(slug);
    await env.PROJECTION_DB.prepare(
      "INSERT INTO projected_records (tenant_id, record_id, type, slug, published_at, data, source_version, publish_seq, projected_at) VALUES (?1, ?2, 'post', NULL, '2026-07-16T00:00:00.000Z', ?3, 1, 1, 0)",
    )
      .bind(tenantId, crypto.randomUUID(), JSON.stringify({ title: "t" }))
      .run();
    const cold = await app.request(`/public/v1/${slug}/records/post`, {}, env);
    expect(cold.status).toBe(200);
    const warm = await app.request(
      `/public/v1/${slug}/records/post`,
      {},
      { ...env, PROJECTION_DB: poisonedProjectionDb() },
    );
    expect(warm.status).toBe(200);
    const body = (await warm.json()) as { items: unknown[] };
    expect(body.items.length).toBe(1);
  });

  it("serves a warm single record from cache without touching the projection DB", async () => {
    const slug = `cache-order-one-${RUN_ID}`;
    const tenantId = await seedTenant(slug);
    const recordId = crypto.randomUUID();
    await env.PROJECTION_DB.prepare(
      "INSERT INTO projected_records (tenant_id, record_id, type, slug, published_at, data, source_version, publish_seq, projected_at) VALUES (?1, ?2, 'post', NULL, '2026-07-16T00:00:00.000Z', ?3, 1, 1, 0)",
    )
      .bind(tenantId, recordId, JSON.stringify({ title: "t" }))
      .run();
    const cold = await app.request(`/public/v1/${slug}/records/post/${recordId}`, {}, env);
    expect(cold.status).toBe(200);
    const warm = await app.request(
      `/public/v1/${slug}/records/post/${recordId}`,
      {},
      { ...env, PROJECTION_DB: poisonedProjectionDb() },
    );
    expect(warm.status).toBe(200);
  });

  it("still rejects malformed queries (validation now runs inside the cache producer)", async () => {
    const slug = `cache-order-bad-${RUN_ID}`;
    await seedTenant(slug);
    const res = await app.request(`/public/v1/${slug}/records/post?filter[nope]=1`, {}, env);
    expect(res.status).toBe(400);
    // 400 はキャッシュされない: 2 回目も 400
    const again = await app.request(`/public/v1/${slug}/records/post?filter[nope]=1`, {}, env);
    expect(again.status).toBe(400);
  });
});
```

- [ ] **Step 2: 失敗を確認**

Run: `pnpm --filter @plyrs/api test -- public-cache-order.test.ts`
Expected: 最初の 2 テストが FAIL（現状はウォームリクエストでも `loadCatalog` / `parseListQuery` の前段で投影 D1 に触れる…一覧の「素の一覧」はカタログを読まないため 1 つ目は PASS する可能性がある。その場合も 2 つ目の単体 + include 検証パス、および Step 3 実施後の全 green で確認する。**FAIL/PASS の実際の出力をレポートに貼ること**）

- [ ] **Step 3: serveSingle と一覧ルートを再構成する**

`apps/api/src/routes/public.ts` の `serveSingle` を次の完全な形に置き換える:

```ts
async function serveSingle(
  c: Context<PublicEnv>,
  lookup: "id" | "slug",
  value: string,
): Promise<Response> {
  const type = c.req.param("type") ?? "";
  const tenantSlug = c.req.param("tenantSlug") ?? "";
  // "." / ".." はキャッシュキー URL のドットセグメント正規化の残余を閉じる（そもそも実 record_id /
  // slug ではないが、正規化経由でキャッシュキーが化けないよう入口で明示的に弾く）
  if (
    !isValidTypeKey(type) ||
    value.length === 0 ||
    value.length > MAX_PARAM_LENGTH ||
    value === "." ||
    value === ".."
  ) {
    return c.json({ error: "not_found" }, 404);
  }
  if (!isValidTenantSlug(tenantSlug)) {
    return c.json({ error: "unknown_tenant" }, 404);
  }
  const tenantId = await resolveTenantId(c.env, tenantSlug);
  if (tenantId === null) {
    return c.json({ error: "unknown_tenant" }, 404);
  }
  const params = c.req.queries();
  // slug は任意文字を含みうるため、キャッシュキー URL のフラグメント/クエリ境界に化けないようエンコードする
  const cacheUrl = canonicalCacheUrl(
    tenantId,
    `records/${type}/${lookup}/${encodeURIComponent(value)}`,
    params,
  );
  // Phase 5c: クエリ検証（カタログ読み込み含む）は produce の中 = キャッシュミス時のみ実行。
  // キャッシュキーが全パラメータを含むため、ヒット = 同一パラメータで過去に 200、で安全。
  return withEdgeCache(edgeCacheContextFor(c), cacheUrl, async () => {
    for (const key of Object.keys(params)) {
      if (key !== "include") {
        return c.json({ error: "bad_query", message: `unknown query param: ${key}` }, 400);
      }
    }
    let include: string[] = [];
    const includeParam = params["include"];
    if (includeParam !== undefined) {
      if (includeParam.length !== 1 || includeParam[0] === undefined) {
        return c.json(
          { error: "bad_query", message: "query param must appear once: include" },
          400,
        );
      }
      const catalog = await loadCatalog(c.env.PROJECTION_DB, tenantId, type);
      const parsed = parseInclude(includeParam[0], catalog);
      if (!parsed.ok) {
        return c.json({ error: "bad_query", message: parsed.error }, 400);
      }
      include = parsed.include;
    }
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
    // 既定でも関係フィールドは ID 配列として fields に現れる（裁定: include は included[] の
    // 同梱だけを制御し、fields の形を変えない。未公開参照先の ID も残る — ソフト参照で
    // included にだけ現れない）。
    const relationIds = await loadFieldRelationIdsForRecords(c.env.PROJECTION_DB, tenantId, [
      row.record_id,
    ]);
    const base = {
      ...record,
      fields: {
        ...record.fields,
        ...relationIds.get(row.record_id),
      },
    };
    const body =
      include.length > 0
        ? {
            ...base,
            included: await expandIncludes(
              c.env.PROJECTION_DB,
              tenantId,
              collectIncludeTargetIds(relationIds, include),
            ),
          }
        : base;
    const response = c.json(body);
    // 裁定: publish_seq は公開しないが ETag の弱い検証子としての内部利用は可
    response.headers.set("etag", `W/"${row.publish_seq}"`);
    return response;
  });
}
```

一覧ルート（`.get("/:tenantSlug/records/:type", ...)`）を次の完全な形に置き換える:

```ts
  .get("/:tenantSlug/records/:type", async (c) => {
    const type = c.req.param("type") ?? "";
    if (!isValidTypeKey(type)) {
      return c.json({ error: "not_found" }, 404);
    }
    const tenantSlug = c.req.param("tenantSlug") ?? "";
    if (!isValidTenantSlug(tenantSlug)) {
      return c.json({ error: "unknown_tenant" }, 404);
    }
    const tenantId = await resolveTenantId(c.env, tenantSlug);
    if (tenantId === null) {
      return c.json({ error: "unknown_tenant" }, 404);
    }
    const params = c.req.queries();
    const cacheUrl = canonicalCacheUrl(tenantId, `records/${type}`, params);
    // Phase 5c: 検証・カタログ読み込み・クエリ実行のすべてを produce の中へ（ヒット時に
    // 投影 D1 を一切読まない）。400 は withEdgeCache が保存しないためキャッシュを汚さない。
    return withEdgeCache(edgeCacheContextFor(c), cacheUrl, async () => {
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
      // 裁定（2026-07-14 controller amendment）: 一覧 items にも単体と同じく関係フィールドを
      // ID 配列として常時マージする（§6 の通り関係は data に入らないため、そのままでは items の
      // fields から欠落し単体レスポンスと形が食い違う）。include の有無で fields の形は変えない
      // （include は included[] の同梱だけを制御）。ページの record_id 全件をチャンク内 1 回で引く。
      const relationIds = await loadFieldRelationIdsForRecords(
        c.env.PROJECTION_DB,
        tenantId,
        page.map((row) => row.record_id),
      );
      const items = page.map((row) => {
        const record = toPublicRecord(row);
        return {
          ...record,
          fields: {
            ...record.fields,
            ...relationIds.get(row.record_id),
          },
        };
      });
      const body: Record<string, unknown> = { items, nextCursor };
      if (query.include.length > 0) {
        body["included"] = await expandIncludes(
          c.env.PROJECTION_DB,
          tenantId,
          collectIncludeTargetIds(relationIds, query.include),
        );
      }
      return c.json(body);
    });
  })
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm --filter @plyrs/api test`
Expected: PASS（public-cache.test.ts / public-list / public-single 含む全件 green）

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/public.ts apps/api/test/public-cache-order.test.ts
git commit -m "perf: check edge cache before query validation"
```

---

### Task 4: loadCatalog の未知 kind skip + date フィルタ書式検証

**Files:**
- Modify: `apps/api/src/projection/payload.ts:21`（CatalogKind を const 配列導出へ + isCatalogKind）
- Modify: `apps/api/src/public/catalog.ts`（未知 kind skip・cast 削除）
- Modify: `apps/api/src/public/catalog.test.ts`（skip テスト追加）
- Modify: `apps/api/src/public/query.ts`（date 書式検証）
- Modify: `apps/api/src/public/query.test.ts`（date テスト追加）

**Interfaces:**
- Consumes: 既存 `CatalogKind`（projection/payload.ts）、metamodel の datetime 書式規約（`z.iso.datetime()`・UTC 'Z' のみ）
- Produces: `export const CATALOG_KINDS` / `export function isCatalogKind(value: string): value is CatalogKind`（payload.ts）

- [ ] **Step 1: 失敗するテストを書く（catalog）**

`apps/api/src/public/catalog.test.ts` の describe 内に追加:

```ts
  it("skips rows with an unknown kind (Phase 5c: forward-compat guard)", async () => {
    const tenantId = crypto.randomUUID();
    for (const [fieldKey, kind] of [
      ["location", "geo"],
      ["title", "text"],
    ] as const) {
      await env.PROJECTION_DB.prepare(
        "INSERT INTO projection_fields (tenant_id, type, field_key, kind, multi, projected_at) VALUES (?1, 'post', ?2, ?3, 0, 0)",
      )
        .bind(tenantId, fieldKey, kind)
        .run();
    }
    const catalog = await loadCatalog(env.PROJECTION_DB, tenantId, "post");
    expect(catalog.get("location")).toBeUndefined();
    expect(catalog.get("title")).toStrictEqual({ kind: "text", multi: false });
  });
```

- [ ] **Step 2: 失敗するテストを書く（query の date 検証）**

`apps/api/src/public/query.test.ts` に追加（`Catalog` 型が未 import なら `import type { Catalog } from "./catalog";` を足す。既存テストのカタログ構築ヘルパーがあればそれに合わせてよいが、アサーション内容は変えない）:

```ts
  it("validates date filter values against the write-side format (Phase 5c)", () => {
    const catalog: Catalog = new Map([["published_at", { kind: "date", multi: false }]]);
    const bad = parseListQuery({ "filter[published_at]": ["not-a-date"] }, catalog);
    expect(bad.ok).toBe(false);
    // metamodel（record-schema）は UTC 'Z' のみ受理する。オフセット付きは書き込めない値なので 400
    const offset = parseListQuery({ "filter[published_at]": ["2026-07-12T09:00:00+09:00"] }, catalog);
    expect(offset.ok).toBe(false);
    const good = parseListQuery({ "filter[published_at]": ["2026-07-12T00:00:00Z"] }, catalog);
    expect(good.ok).toBe(true);
    const fractional = parseListQuery(
      { "filter[published_at]": ["2026-07-12T00:00:00.123Z"] },
      catalog,
    );
    expect(fractional.ok).toBe(true);
  });
```

- [ ] **Step 3: 失敗を確認**

Run: `pnpm --filter @plyrs/api test -- catalog.test.ts query.test.ts`
Expected: 追加した 2 テストが FAIL（未知 kind が Map に載る / "not-a-date" が ok:true になる）

- [ ] **Step 4: 実装**

`apps/api/src/projection/payload.ts` の行 21（`export type CatalogKind = ...`）を次に置き換える:

```ts
export const CATALOG_KINDS = ["text", "num", "bool", "date", "relation"] as const;
export type CatalogKind = (typeof CATALOG_KINDS)[number];

// Phase 5c housekeeping: projection_fields の kind は将来語彙が増えうる（record upsert への
// LWW 相乗り更新のため、旧コードが新 kind の行を読む窓がある）。未知 kind の行は
// 「宣言されていない」扱いで skip する保険（loadCatalog が使う）。
export function isCatalogKind(value: string): value is CatalogKind {
  return (CATALOG_KINDS as readonly string[]).includes(value);
}
```

`apps/api/src/public/catalog.ts` 全体:

```ts
import { isCatalogKind, type CatalogKind } from "../projection/payload";

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
    // Phase 5c: 未知 kind は「宣言されていない」扱いで skip（無検査 cast の除去も兼ねる）
    if (!isCatalogKind(row.kind)) {
      continue;
    }
    catalog.set(row.field_key, { kind: row.kind, multi: row.multi === 1 });
  }
  return catalog;
}
```

`apps/api/src/public/query.ts`: import に `import { z } from "zod";` を追加し、モジュール定数として `COLUMN_BY_KIND` の直前に追加:

```ts
// Phase 5c housekeeping: date フィルタ値は書き込み側（metamodel record-schema の
// z.iso.datetime() = UTC 'Z' のみ）と同じ書式だけを受理する。value_date には正規化済みの
// ISO8601 UTC 文字列しか入らないため、形の違う値は等値比較で決してヒットしない — D1 まで
// 運ばず 400 で早期に落とす。
const isoDatetime = z.iso.datetime();
```

`parseScalarValues` の switch に `"date"` の明示 case を追加（現状は default = text/date 共通で素通し）:

```ts
    case "date":
      return raw.every((value) => isoDatetime.safeParse(value).success) ? raw : null;
    default:
      return raw;
```

- [ ] **Step 5: テストが通ることを確認**

Run: `pnpm --filter @plyrs/api test`
Expected: PASS（既存の date フィルタを使う統合テストは正規の ISO8601 UTC 値を使っているため無修正で green のはず）

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/projection/payload.ts apps/api/src/public/catalog.ts apps/api/src/public/catalog.test.ts apps/api/src/public/query.ts apps/api/src/public/query.test.ts
git commit -m "fix: validate date filters and unknown kinds"
```

---

### Task 5: GET /auth/tenants（所属テナント一覧）

**Files:**
- Modify: `apps/api/src/routes/auth.ts`
- Modify: `apps/api/test/auth-routes.test.ts`

**Interfaces:**
- Consumes: 既存 `lookupSession` / `SESSION_COOKIE`（auth/session.ts）、`isBlocked`（auth/blocklist.ts）、`memberships` / `tenants`（@plyrs/db/control-plane）
- Produces: `GET /auth/tenants` → `200 { tenants: { id: string; slug: string; name: string; role: string }[] }`（slug 昇順）/ `401 { error: "unauthenticated" }` / `403 { error: "blocked" }`。**Task 11 の api-client（admin）がこの契約に依存する。**

**背景:** 管理画面のテナント選択画面と `/t/$tenantSlug` の slug→tenantId 解決には「自分の所属テナント一覧」が必要だが、既存 API に存在しない（Phase 3 は /auth/token で tenantId を要求するのみ）。セッション cookie 認証・/auth/token と同じ失効規律（blocked 403）で追加する。

- [ ] **Step 1: 失敗するテストを書く**

`apps/api/test/auth-routes.test.ts` の describe 内に追加:

```ts
  it("lists the session user's tenants with roles (Phase 6a)", async () => {
    const { cookie } = await signupAndLogin();
    const slugB = unique("b-");
    const slugA = unique("a-");
    await app.request("/v1/tenants", json({ name: "B", slug: slugB }, cookie), env);
    await app.request("/v1/tenants", json({ name: "A", slug: slugA }, cookie), env);
    const res = await app.request("/auth/tenants", { headers: { cookie } }, env);
    expect(res.status).toBe(200);
    const { tenants } = (await res.json()) as {
      tenants: { id: string; slug: string; name: string; role: string }[];
    };
    expect(tenants.map((t) => t.slug)).toStrictEqual([slugA, slugB]);
    expect(tenants.every((t) => t.role === "owner")).toBe(true);
    expect(tenants.every((t) => t.id.length === 36)).toBe(true);
  });

  it("rejects anonymous and blocked users on /auth/tenants", async () => {
    const anon = await app.request("/auth/tenants", {}, env);
    expect(anon.status).toBe(401);
    const { userId, cookie } = await signupAndLogin();
    await blockUser(env.BLOCKLIST, userId);
    const denied = await app.request("/auth/tenants", { headers: { cookie } }, env);
    expect(denied.status).toBe(403);
  });
```

（`slugA` は `a-` 接頭辞・`slugB` は `b-` 接頭辞なので slug 昇順 = `[slugA, slugB]`。`blockUser` は既に import 済み。）

- [ ] **Step 2: 失敗を確認**

Run: `pnpm --filter @plyrs/api test -- auth-routes.test.ts`
Expected: FAIL（GET /auth/tenants が 404）

- [ ] **Step 3: 実装**

`apps/api/src/routes/auth.ts`:

1. import 変更: `import { and, asc, eq } from "drizzle-orm";` / `import { memberships, tenants, users } from "@plyrs/db/control-plane";`
2. チェーン末尾（`.post("/token", ...)` の後）に追加:

```ts
  // Phase 6a: 管理画面のテナント選択（slug→tenantId の解決元）。セッション cookie で認証し、
  // membership を tenants に join して返す。/auth/token と同じく blocked ユーザーは 403。
  .get("/tenants", async (c) => {
    const token = getCookie(c, SESSION_COOKIE);
    const session = token === undefined ? null : await lookupSession(c.env.DB, token, new Date());
    if (session === null) {
      return c.json({ error: "unauthenticated" }, 401);
    }
    if (await isBlocked(c.env.BLOCKLIST, session.userId)) {
      return c.json({ error: "blocked" }, 403);
    }
    const rows = await drizzle(c.env.DB)
      .select({ id: tenants.id, slug: tenants.slug, name: tenants.name, role: memberships.role })
      .from(memberships)
      .innerJoin(tenants, eq(memberships.tenantId, tenants.id))
      .where(eq(memberships.userId, session.userId))
      .orderBy(asc(tenants.slug));
    return c.json({ tenants: rows });
  });
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm --filter @plyrs/api test -- auth-routes.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/auth.ts apps/api/test/auth-routes.test.ts
git commit -m "feat: add GET /auth/tenants membership list"
```

---

### Task 6: listContentTypes RPC + GET /v1/t/:tenantId/content-types

**Files:**
- Modify: `apps/api/src/tenant-do.ts`（listContentTypes メソッド追加）
- Modify: `apps/api/src/rpc-unwrap.ts` と `apps/api/test/rpc-unwrap.ts`（asContentTypeRows 追加）
- Modify: `apps/api/src/routes/tenant.ts`（GET 一覧ルート追加）
- Modify: `apps/api/test/content-types.test.ts`（DO レベルのテスト追加）
- Create: `apps/api/test/content-types-list.test.ts`（HTTP レベル）

**Interfaces:**
- Consumes: 既存 `loadAllContentTypeRows(sql: SqlStorage): ContentTypeRow[]`（do/content-types.ts、key 昇順を SQL で保証済み）、`tenantGate`、`stubFor`
- Produces:
  - DO RPC: `listContentTypes(): ContentTypeRow[]`
  - `asContentTypeRows(value: unknown): ContentTypeRow[]`（src と test の rpc-unwrap 両方）
  - `GET /v1/t/:tenantId/content-types`（Bearer 必須）→ `200 { contentTypes: ContentTypeRow[] }`。**Task 11 の admin-api（admin）がこの契約に依存する。**

**注意（Phase 2 申し送り）:** `Record<string, unknown>` を含む RPC 戻り値は Cloudflare の `Rpc.Serializable` 検査で型が潰れるため、テスト・ルートとも rpc-unwrap の型付きアンラップを経由する。`@ts-expect-error` 禁止。

- [ ] **Step 1: 失敗するテストを書く（DO レベル）**

`apps/api/test/content-types.test.ts` の import に `asContentTypeRows`（`./rpc-unwrap` から）を追加し、describe 内に追加:

```ts
  it("lists all content types ordered by key (Phase 6a)", async () => {
    const stub = freshStub();
    await stub.registerContentType(articleType(), auth("admin"));
    await stub.registerContentType(
      {
        id: uuid(9),
        key: "author",
        name: "著者",
        source: "user",
        version: 1,
        fields: [{ key: "name", type: "text", required: true }],
      },
      auth("admin"),
    );
    const rows = asContentTypeRows(await stub.listContentTypes());
    expect(rows.map((row) => row.key)).toStrictEqual(["article", "author"]);
    expect(rows[0]?.fields.some((field) => field.key === "title")).toBe(true);
    expect(rows[1]?.name).toBe("著者");
  });
```

`apps/api/test/rpc-unwrap.ts` に追加（既存の様式に合わせる）:

```ts
export function asContentTypeRows(value: unknown): ContentTypeRow[] {
  return value as ContentTypeRow[];
}
```

（`ContentTypeRow` の import が無ければ既存 import に追加する。）

- [ ] **Step 2: 失敗するテストを書く（HTTP レベル）**

Create `apps/api/test/content-types-list.test.ts`:

```ts
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { app } from "../src/index";
import { articleType } from "./fixtures";

// 共有ストレージ（--no-isolate）ではファイル間でも衝突しないよう、実行ごとのランダム接頭辞を混ぜる
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
  const signup = await app.request(
    "/auth/signup",
    json({ email, password: "hunter2hunter2" }),
    env,
  );
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

describe("GET /v1/t/:tenantId/content-types (Phase 6a)", () => {
  it("returns registered types to authenticated members", async () => {
    const { tenantId, bearer } = await bootstrapTenant();
    const put = await app.request(
      `/v1/t/${tenantId}/content-types`,
      {
        method: "PUT",
        headers: { "content-type": "application/json", authorization: bearer },
        body: JSON.stringify(articleType()),
      },
      env,
    );
    expect(put.status).toBe(200);
    const res = await app.request(
      `/v1/t/${tenantId}/content-types`,
      { headers: { authorization: bearer } },
      env,
    );
    expect(res.status).toBe(200);
    const { contentTypes } = (await res.json()) as {
      contentTypes: { key: string; name: string; version: number }[];
    };
    expect(contentTypes.map((t) => t.key)).toStrictEqual(["article"]);
    expect(contentTypes[0]?.version).toBe(1);
  });

  it("returns an empty list for a fresh tenant", async () => {
    const { tenantId, bearer } = await bootstrapTenant();
    const res = await app.request(
      `/v1/t/${tenantId}/content-types`,
      { headers: { authorization: bearer } },
      env,
    );
    expect(res.status).toBe(200);
    const { contentTypes } = (await res.json()) as { contentTypes: unknown[] };
    expect(contentTypes).toStrictEqual([]);
  });

  it("rejects unauthenticated listing (first-stage gate)", async () => {
    const { tenantId } = await bootstrapTenant();
    const res = await app.request(`/v1/t/${tenantId}/content-types`, {}, env);
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 3: 失敗を確認**

Run: `pnpm --filter @plyrs/api test -- content-types.test.ts content-types-list.test.ts`
Expected: FAIL（`listContentTypes` が存在しない / GET 一覧が 404）

- [ ] **Step 4: 実装**

`apps/api/src/tenant-do.ts` の `getContentType` メソッド（行 134 付近）の直後に追加:

```ts
  // Phase 6a: 管理画面の content_type 一覧（読み取り専用）。key 昇順は SQL 側で保証される。
  listContentTypes(): ContentTypeRow[] {
    return loadAllContentTypeRows(this.ctx.storage.sql);
  }
```

（`loadAllContentTypeRows` は import 済み。）

`apps/api/src/rpc-unwrap.ts` の `asContentTypeRow` の直後に追加:

```ts
export function asContentTypeRows(value: unknown): ContentTypeRow[] {
  return value as ContentTypeRow[];
}
```

`apps/api/src/routes/tenant.ts`: import の `asContentTypeRow` に並べて `asContentTypeRows` を追加し、`.get("/:tenantId/content-types/:key", ...)` の**直前**にルートを追加（静的セグメント優先の明示は不要だが、一覧 → 単体の並び順を保つ）:

```ts
  .get("/:tenantId/content-types", async (c) => {
    const rows = asContentTypeRows(await stubFor(c).listContentTypes());
    return c.json({ contentTypes: rows });
  })
```

- [ ] **Step 5: テストが通ることを確認**

Run: `pnpm --filter @plyrs/api test`
Expected: PASS（全件 green。ここまでで Task 1〜6 の api 変更が完結）

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/tenant-do.ts apps/api/src/rpc-unwrap.ts apps/api/test/rpc-unwrap.ts apps/api/src/routes/tenant.ts apps/api/test/content-types.test.ts apps/api/test/content-types-list.test.ts
git commit -m "feat: list content types over tenant HTTP API"
```

---

### Task 7: workspace catalog 追加 + packages/ui scaffold（compose ヘルパー + tokens + カナリアテスト）

**Files:**
- Modify: `pnpm-workspace.yaml`
- Create: `packages/ui/package.json`・`packages/ui/tsconfig.json`・`packages/ui/vitest.config.ts`・`packages/ui/vitest.setup.ts`
- Create: `packages/ui/src/index.ts`・`packages/ui/src/tokens.stylex.ts`・`packages/ui/src/compose.ts`
- Test: `packages/ui/src/compose.test.tsx`

**Interfaces:**
- Consumes: catalog の新規依存（下記）
- Produces:
  - `stylexRenderProps<TState>(resolve: (state: TState) => Parameters<typeof stylex.props>): (state: TState & { defaultClassName?: string | undefined }) => string`（Task 8 の全コンポーネントが使う）
  - `colors` / `spacing` / `typography`（`@plyrs/ui/tokens.stylex` サブパス。**index.ts から再 export しない** — StyleX の defineVars は `.stylex.ts` ファイルから直接 import されないとコンパイラが解決できない）

- [ ] **Step 1: pnpm-workspace.yaml の catalog を更新する**

`catalog:` セクション全体を以下に置き換える（既存キーは維持、新規キーをアルファベット順にマージ。`wrangler` は `@cloudflare/vite-plugin` の peer 要求 `^4.111.0` に合わせ下限を上げる）:

```yaml
catalog:
  "@cloudflare/vite-plugin": ^1.45.0
  "@cloudflare/vitest-pool-workers": ^0.18.4
  "@cloudflare/workers-types": ^5.20260712.1
  "@hono/zod-validator": ^0.8.0
  "@stylexjs/stylex": 0.19.0
  "@stylexjs/unplugin": 0.19.0
  "@tanstack/db": 0.6.14
  "@tanstack/react-query": ^5.101.2
  "@tanstack/react-router": 1.170.18
  "@tanstack/react-start": 1.168.28
  "@testing-library/dom": ^10.4.1
  "@testing-library/jest-dom": ^6.9.1
  "@testing-library/react": ^16.3.2
  "@testing-library/user-event": ^14.6.1
  "@types/node": ^26.1.1
  "@types/react": ^19.2.17
  "@types/react-dom": ^19.2.3
  "@vitejs/plugin-react": ^6.0.3
  drizzle-kit: ^0.31.10
  drizzle-orm: ^0.45.2
  hono: ^4.12.29
  jose: ^6.2.3
  jsdom: ^29.1.1
  partysocket: ^1.3.0
  react: ^19.2.7
  react-aria-components: ^1.19.0
  react-dom: ^19.2.7
  typescript: ~7.0.2
  uuid: ^14.0.1
  vite: ^8.1.5
  vitest: ^4.1.10
  wrangler: ^4.111.0
  zod: ^4.4.3
```

（バージョンは 2026-07-16 に npm registry の latest を実測した値。exact pin 3 件の根拠は Global Constraints を参照。）

- [ ] **Step 2: packages/ui の骨格を作る**

Create `packages/ui/package.json`:

```json
{
  "name": "@plyrs/ui",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./tokens.stylex": "./src/tokens.stylex.ts"
  },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@stylexjs/stylex": "catalog:",
    "react": "catalog:",
    "react-aria-components": "catalog:"
  },
  "devDependencies": {
    "@stylexjs/unplugin": "catalog:",
    "@testing-library/dom": "catalog:",
    "@testing-library/jest-dom": "catalog:",
    "@testing-library/react": "catalog:",
    "@testing-library/user-event": "catalog:",
    "@types/react": "catalog:",
    "@types/react-dom": "catalog:",
    "jsdom": "catalog:",
    "react-dom": "catalog:",
    "typescript": "catalog:",
    "vitest": "catalog:"
  }
}
```

Create `packages/ui/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx"
  },
  "include": ["src", "vitest.config.ts", "vitest.setup.ts"]
}
```

Create `packages/ui/vitest.config.ts`（**@stylexjs/unplugin を vitest でも通す** — テスト実行時に stylex.create がコンパイル済みであることが前提。コンパイル漏れは Step 4 のカナリアが即検出する）:

```ts
import stylex from "@stylexjs/unplugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [stylex.vite()],
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["./vitest.setup.ts"],
  },
});
```

Create `packages/ui/vitest.setup.ts`:

```ts
import "@testing-library/jest-dom/vitest";
```

Create `packages/ui/src/tokens.stylex.ts`:

```ts
import * as stylex from "@stylexjs/stylex";

// design-spec §9.9 / tech-selection §1.3: テーマは defineVars で型安全に持つ。
// ダークは prefers-color-scheme 追従（テナント別アクセント等の動的テーマは将来 createTheme で重ねる）。
// 注意: defineVars は .stylex.ts ファイルの named export でなければならず、消費側は
// このファイルを直接 import する（index.ts 経由の再 export はコンパイラが解決できない）。
const DARK = "@media (prefers-color-scheme: dark)";

export const colors = stylex.defineVars({
  bg: { default: "#ffffff", [DARK]: "#111418" },
  surface: { default: "#f6f7f8", [DARK]: "#1a1f24" },
  border: { default: "#d8dde3", [DARK]: "#333a42" },
  text: { default: "#1a1f24", [DARK]: "#e8eaed" },
  textMuted: { default: "#5f6b76", [DARK]: "#9aa5af" },
  accent: { default: "#2563eb", [DARK]: "#60a5fa" },
  accentText: { default: "#ffffff", [DARK]: "#0b1220" },
  danger: { default: "#dc2626", [DARK]: "#f87171" },
  focusRing: { default: "#2563eb", [DARK]: "#60a5fa" },
});

export const spacing = stylex.defineVars({
  xs: "4px",
  sm: "8px",
  md: "16px",
  lg: "24px",
  xl: "32px",
});

export const typography = stylex.defineVars({
  fontFamily:
    "system-ui, -apple-system, 'Segoe UI', 'Hiragino Kaku Gothic ProN', 'Noto Sans JP', sans-serif",
  sizeSm: "12px",
  sizeMd: "14px",
  sizeLg: "16px",
  sizeXl: "20px",
});
```

- [ ] **Step 3: 失敗するテストを書く（カナリア + compose）**

Create `packages/ui/src/compose.test.tsx`:

```tsx
import * as stylex from "@stylexjs/stylex";
import { describe, expect, it } from "vitest";
import { stylexRenderProps } from "./compose";

const styles = stylex.create({
  base: { color: "red" },
  pressed: { color: "blue" },
});

describe("stylexRenderProps (StyleX コンパイルのカナリア兼、状態→スタイル合成の唯一の経路)", () => {
  it("compiles stylex.create at transform time and yields class names", () => {
    // vitest.config の @stylexjs/unplugin が transform していれば create は throw しない。
    // ここが「stylex.create should never be called at runtime」等で落ちる場合、テスト
    // パイプラインで StyleX が未コンパイル — 作業を止めてコントローラへ報告すること
    // （フォールバック導入はコントローラの裁定事項）。
    const className = stylex.props(styles.base).className ?? "";
    expect(className.length).toBeGreaterThan(0);
  });

  it("resolves render-prop state into a merged className", () => {
    const resolve = stylexRenderProps<{ isPressed: boolean }>((state) => [
      styles.base,
      state.isPressed && styles.pressed,
    ]);
    const idle = resolve({ isPressed: false });
    const pressed = resolve({ isPressed: true });
    expect(idle.length).toBeGreaterThan(0);
    expect(pressed).not.toBe(idle);
  });
});
```

- [ ] **Step 4: インストールして失敗を確認**

Run: `CI=true pnpm install`（lockfile 更新を含むため frozen ではなく通常 install。出力に "Ignored build scripts" 警告が出た場合は、そのパッケージ名を `pnpm-workspace.yaml` の `onlyBuiltDependencies` に追記して再実行し、判断をレポートに残す）

Run: `pnpm --filter @plyrs/ui test`
Expected: FAIL（`./compose` が存在しない）

- [ ] **Step 5: compose.ts と index.ts を実装**

Create `packages/ui/src/compose.ts`:

```ts
import * as stylex from "@stylexjs/stylex";

// tech-selection §1.2: react-aria-components の className render prop（状態関数）と StyleX を
// 合成する唯一の経路。data 属性セレクタ（[data-hovered] 等）は StyleX の静的制約と相性が
// 悪いため、状態→スタイルの分岐は必ずこのヘルパー経由の render prop で行う。
type StyleXArgs = Parameters<typeof stylex.props>;

export function stylexRenderProps<TState>(
  resolve: (state: TState) => StyleXArgs,
): (state: TState & { defaultClassName?: string | undefined }) => string {
  return (state) => stylex.props(...resolve(state)).className ?? "";
}
```

Create `packages/ui/src/index.ts`:

```ts
export { stylexRenderProps } from "./compose";
```

- [ ] **Step 6: テストが通ることを確認**

Run: `pnpm --filter @plyrs/ui test`
Expected: PASS（2 tests）。**カナリアが落ちた場合はここで停止してコントローラへ報告する。**

Run: `pnpm --filter @plyrs/ui typecheck`
Expected: エラーなし

- [ ] **Step 7: Commit**

```bash
git add pnpm-workspace.yaml pnpm-lock.yaml packages/ui
git commit -m "feat: scaffold packages/ui with StyleX compose"
```

---

### Task 8: packages/ui の Button / TextField

**Files:**
- Create: `packages/ui/src/button.tsx`・`packages/ui/src/text-field.tsx`
- Modify: `packages/ui/src/index.ts`
- Test: `packages/ui/src/button.test.tsx`・`packages/ui/src/text-field.test.tsx`

**Interfaces:**
- Consumes: Task 7 の `stylexRenderProps`・tokens（`./tokens.stylex` を直接 import）
- Produces（Task 12・13 のフォーム/シェルが使う）:
  - `Button(props: { variant?: "primary" | "secondary" | "danger" } & Omit<RacButtonProps, "className" | "style">)`
  - `TextField(props: { label: string; errorMessage?: string | ((v: ValidationResult) => string) } & Omit<RacTextFieldProps, "className" | "style">)`

- [ ] **Step 1: 失敗するテストを書く**

Create `packages/ui/src/button.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Button } from "./button";

describe("Button (react-aria-components + StyleX)", () => {
  it("fires onPress and carries compiled classes", async () => {
    const onPress = vi.fn();
    render(<Button onPress={onPress}>保存</Button>);
    const button = screen.getByRole("button", { name: "保存" });
    expect(button.className.length).toBeGreaterThan(0);
    await userEvent.click(button);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("does not fire onPress when disabled", async () => {
    const onPress = vi.fn();
    render(
      <Button onPress={onPress} isDisabled>
        削除
      </Button>,
    );
    const button = screen.getByRole("button", { name: "削除" });
    expect(button).toBeDisabled();
    await userEvent.click(button);
    expect(onPress).not.toHaveBeenCalled();
  });

  it("varies classes by variant", () => {
    const { rerender } = render(<Button variant="primary">A</Button>);
    const primary = screen.getByRole("button").className;
    rerender(<Button variant="danger">A</Button>);
    expect(screen.getByRole("button").className).not.toBe(primary);
  });
});
```

Create `packages/ui/src/text-field.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { TextField } from "./text-field";

describe("TextField (react-aria-components + StyleX)", () => {
  it("associates the label with the input and accepts typing", async () => {
    render(<TextField label="メールアドレス" name="email" type="email" />);
    const input = screen.getByLabelText("メールアドレス");
    await userEvent.type(input, "a@example.com");
    expect(input).toHaveValue("a@example.com");
  });

  it("shows the error message when invalid", () => {
    render(<TextField label="パスワード" isInvalid errorMessage="12文字以上にしてください" />);
    expect(screen.getByText("12文字以上にしてください")).toBeInTheDocument();
  });

  it("does not render an error when valid", () => {
    render(<TextField label="名前" />);
    expect(screen.queryByText("12文字以上にしてください")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 失敗を確認**

Run: `pnpm --filter @plyrs/ui test`
Expected: FAIL（`./button` / `./text-field` が存在しない）

- [ ] **Step 3: 実装**

Create `packages/ui/src/button.tsx`:

```tsx
import * as stylex from "@stylexjs/stylex";
import {
  Button as RacButton,
  type ButtonProps as RacButtonProps,
  type ButtonRenderProps,
} from "react-aria-components";
import { stylexRenderProps } from "./compose";
import { colors, spacing, typography } from "./tokens.stylex";

const styles = stylex.create({
  base: {
    fontFamily: typography.fontFamily,
    fontSize: typography.sizeMd,
    paddingBlock: spacing.xs,
    paddingInline: spacing.md,
    borderRadius: "6px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: "transparent",
    cursor: "pointer",
    outline: "none",
  },
  primary: {
    backgroundColor: colors.accent,
    color: colors.accentText,
  },
  secondary: {
    backgroundColor: colors.surface,
    color: colors.text,
    borderColor: colors.border,
  },
  danger: {
    backgroundColor: colors.danger,
    color: colors.accentText,
  },
  hovered: { opacity: 0.9 },
  pressed: { opacity: 0.8 },
  focusVisible: {
    outlineWidth: "2px",
    outlineStyle: "solid",
    outlineColor: colors.focusRing,
    outlineOffset: "2px",
  },
  disabled: { opacity: 0.5, cursor: "default" },
});

export type ButtonVariant = "primary" | "secondary" | "danger";

export interface ButtonProps extends Omit<RacButtonProps, "className" | "style"> {
  variant?: ButtonVariant;
}

export function Button({ variant = "primary", ...props }: ButtonProps) {
  return (
    <RacButton
      {...props}
      className={stylexRenderProps<ButtonRenderProps>((state) => [
        styles.base,
        styles[variant],
        state.isHovered && styles.hovered,
        state.isPressed && styles.pressed,
        state.isFocusVisible && styles.focusVisible,
        state.isDisabled && styles.disabled,
      ])}
    />
  );
}
```

Create `packages/ui/src/text-field.tsx`:

```tsx
import * as stylex from "@stylexjs/stylex";
import {
  FieldError,
  Input,
  Label,
  TextField as RacTextField,
  type InputRenderProps,
  type TextFieldProps as RacTextFieldProps,
  type ValidationResult,
} from "react-aria-components";
import { stylexRenderProps } from "./compose";
import { colors, spacing, typography } from "./tokens.stylex";

const styles = stylex.create({
  field: {
    display: "flex",
    flexDirection: "column",
    gap: spacing.xs,
    fontFamily: typography.fontFamily,
  },
  label: { fontSize: typography.sizeSm, color: colors.textMuted },
  input: {
    fontSize: typography.sizeMd,
    paddingBlock: spacing.xs,
    paddingInline: spacing.sm,
    borderRadius: "6px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: colors.border,
    backgroundColor: colors.bg,
    color: colors.text,
    outline: "none",
  },
  inputFocused: { borderColor: colors.focusRing },
  error: { fontSize: typography.sizeSm, color: colors.danger },
});

export interface TextFieldProps extends Omit<RacTextFieldProps, "className" | "style"> {
  label: string;
  errorMessage?: string | ((validation: ValidationResult) => string);
}

export function TextField({ label, errorMessage, ...props }: TextFieldProps) {
  return (
    <RacTextField {...props} className={stylex.props(styles.field).className ?? ""}>
      <Label className={stylex.props(styles.label).className ?? ""}>{label}</Label>
      <Input
        className={stylexRenderProps<InputRenderProps>((state) => [
          styles.input,
          state.isFocused && styles.inputFocused,
        ])}
      />
      <FieldError className={stylex.props(styles.error).className ?? ""}>
        {errorMessage}
      </FieldError>
    </RacTextField>
  );
}
```

`packages/ui/src/index.ts` 全体:

```ts
export { stylexRenderProps } from "./compose";
export { Button, type ButtonProps, type ButtonVariant } from "./button";
export { TextField, type TextFieldProps } from "./text-field";
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm --filter @plyrs/ui test && pnpm --filter @plyrs/ui typecheck`
Expected: PASS / エラーなし

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src
git commit -m "feat: add Button and TextField to packages/ui"
```

---

### Task 9: packages/ui の SlotRegistry（論点P 初版）

**Files:**
- Create: `packages/ui/src/slots.ts`
- Modify: `packages/ui/src/index.ts`
- Test: `packages/ui/src/slots.test.ts`

**Interfaces:**
- Consumes: なし（純 TS）
- Produces（Task 12/13 の admin と Phase 6b/9 のモジュールが使う）:
  - `SlotContributions`（`"nav:item"` 実配線 / `"record-editor:panel"`・`"record-editor:toolbar"` 型予約）
  - `createSlotRegistry(): SlotRegistry`（`register` 重複 id は throw / `get` は order → id 順）

- [ ] **Step 1: 失敗するテストを書く**

Create `packages/ui/src/slots.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createSlotRegistry } from "./slots";

describe("SlotRegistry (design-spec §9.9 論点P 初版)", () => {
  it("returns contributions sorted by order then id", () => {
    const registry = createSlotRegistry();
    registry.register("nav:item", { id: "b", label: "B", to: "/t/$tenantSlug/b", order: 10 });
    registry.register("nav:item", { id: "a", label: "A", to: "/t/$tenantSlug/a", order: 0 });
    registry.register("nav:item", { id: "c", label: "C", to: "/t/$tenantSlug/c", order: 10 });
    expect(registry.get("nav:item").map((item) => item.id)).toStrictEqual(["a", "b", "c"]);
  });

  it("returns an empty list for a slot with no contributions", () => {
    const registry = createSlotRegistry();
    expect(registry.get("nav:item")).toStrictEqual([]);
  });

  it("rejects duplicate contribution ids per slot", () => {
    const registry = createSlotRegistry();
    registry.register("nav:item", { id: "x", label: "X", to: "/t/$tenantSlug/x", order: 0 });
    expect(() =>
      registry.register("nav:item", { id: "x", label: "X2", to: "/t/$tenantSlug/x2", order: 1 }),
    ).toThrow(/duplicate/);
  });

  it("does not mutate the stored order via the returned array", () => {
    const registry = createSlotRegistry();
    registry.register("nav:item", { id: "a", label: "A", to: "/t/$tenantSlug/a", order: 0 });
    registry.get("nav:item").pop();
    expect(registry.get("nav:item").length).toBe(1);
  });
});
```

- [ ] **Step 2: 失敗を確認**

Run: `pnpm --filter @plyrs/ui test -- slots.test.ts`
Expected: FAIL（`./slots` が存在しない）

- [ ] **Step 3: 実装**

Create `packages/ui/src/slots.ts`:

```ts
import type { ComponentType } from "react";

// design-spec §9.9（論点P）: 管理画面コアが定義する拡張スロットの語彙。2026-07-16 裁定の
// 最小初版 = nav:item のみ実配線し、record-editor:* は Phase 6b で配線する型予約。
// 語彙を増やすときは SlotContributions にキーを足す（登録機構は不変）。

interface SlotContributionBase {
  /** スロット内で一意。モジュール名前空間を推奨（例: "core.content-types", "booking.calendar"） */
  id: string;
  /** 昇順で並ぶ。同順位は id の辞書順 */
  order: number;
}

export interface NavItemContribution extends SlotContributionBase {
  label: string;
  /** TanStack Router のルートパス（例: "/t/$tenantSlug/content-types"）。params は描画側が束縛する */
  to: string;
}

// 型予約（Phase 6b で配線）: record 編集画面のサイドパネル
export interface RecordEditorPanelContribution extends SlotContributionBase {
  title: string;
  render: ComponentType<{ typeKey: string; recordId: string }>;
}

// 型予約（Phase 6b で配線）: record 編集画面のツールバーアクション
export interface RecordEditorToolbarContribution extends SlotContributionBase {
  render: ComponentType<{ typeKey: string; recordId: string }>;
}

export interface SlotContributions {
  "nav:item": NavItemContribution;
  "record-editor:panel": RecordEditorPanelContribution;
  "record-editor:toolbar": RecordEditorToolbarContribution;
}

export type SlotName = keyof SlotContributions;

export interface SlotRegistry {
  register<N extends SlotName>(slot: N, contribution: SlotContributions[N]): void;
  get<N extends SlotName>(slot: N): SlotContributions[N][];
}

export function createSlotRegistry(): SlotRegistry {
  // 値の実型はキーごとに異なるが、Map はキー連動型を表現できないため base で持ち、
  // get の返却時にキー対応型へ戻す（rpc-unwrap と同じ「文書化された境界 cast」）。
  const entries = new Map<SlotName, SlotContributionBase[]>();
  return {
    register(slot, contribution) {
      const list = entries.get(slot) ?? [];
      if (list.some((existing) => existing.id === contribution.id)) {
        throw new Error(`duplicate slot contribution: ${slot} / ${contribution.id}`);
      }
      entries.set(slot, [...list, contribution]);
    },
    get<N extends SlotName>(slot: N) {
      const list = entries.get(slot) ?? [];
      return list.toSorted(
        (a, b) => a.order - b.order || a.id.localeCompare(b.id),
      ) as SlotContributions[N][];
    },
  };
}
```

`packages/ui/src/index.ts` に追加:

```ts
export {
  createSlotRegistry,
  type NavItemContribution,
  type RecordEditorPanelContribution,
  type RecordEditorToolbarContribution,
  type SlotContributions,
  type SlotName,
  type SlotRegistry,
} from "./slots";
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm --filter @plyrs/ui test && pnpm --filter @plyrs/ui typecheck`
Expected: PASS / エラーなし

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src
git commit -m "feat: add slot registry with nav:item vocab"
```

---

### Task 10: apps/admin scaffold（TanStack Start SPA + service binding プロキシ）

**Files:**
- Create: `apps/admin/package.json`・`apps/admin/wrangler.jsonc`・`apps/admin/vite.config.ts`
- Create: `apps/admin/tsconfig.json`・`apps/admin/tsconfig.worker.json`
- Create: `apps/admin/vitest.config.ts`・`apps/admin/vitest.setup.ts`
- Create: `apps/admin/src/server.ts`・`apps/admin/src/router.tsx`・`apps/admin/src/routes/__root.tsx`・`apps/admin/src/routes/index.tsx`・`apps/admin/src/styles.css`・`apps/admin/src/vite-env.d.ts`
- Generate + Commit: `apps/admin/worker-configuration.d.ts`（`wrangler types`）・`apps/admin/src/routeTree.gen.ts`（`vite build`）
- Modify: `.oxlintrc.json`・`.oxfmtignore`（生成物の除外）
- Test: `apps/admin/src/router.test.tsx`

**Interfaces:**
- Consumes: Task 7 の catalog、api Worker 名 `plyrs-api`（apps/api/wrangler.jsonc の `name`）
- Produces（Task 11〜13 が依存する骨格）:
  - `getRouter(options?: { context?: RouterContext; history?: RouterHistory })`（Task 12 で拡張）
  - `RouterContext`（Task 10 時点は `{ queryClient: QueryClient }`。Task 12 で完全形に置き換える）
  - Worker エントリ `src/server.ts`（`/auth`・`/v1` → `env.API`、他 → Start ハンドラ）

**注意（RC 品目の停止条件）:** Step 6 の `vite build`（Start SPA モード + @cloudflare/vite-plugin + StyleX unplugin の組み合わせ）が失敗した場合は、回避策を自作せずエラー全文を添えて停止・報告すること（プラグイン順序・バージョンの裁定はコントローラが行う）。

- [ ] **Step 1: パッケージ定義と設定ファイルを作る**

Create `apps/admin/package.json`:

```json
{
  "name": "@plyrs/admin",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite dev",
    "build": "vite build",
    "cf-typegen": "wrangler types",
    "deploy": "pnpm run build && wrangler deploy",
    "test": "vitest run",
    "typecheck": "tsc --noEmit -p tsconfig.json && tsc --noEmit -p tsconfig.worker.json"
  },
  "dependencies": {
    "@plyrs/metamodel": "workspace:*",
    "@plyrs/ui": "workspace:*",
    "@stylexjs/stylex": "catalog:",
    "@tanstack/react-query": "catalog:",
    "@tanstack/react-router": "catalog:",
    "@tanstack/react-start": "catalog:",
    "react": "catalog:",
    "react-aria-components": "catalog:",
    "react-dom": "catalog:"
  },
  "devDependencies": {
    "@cloudflare/vite-plugin": "catalog:",
    "@stylexjs/unplugin": "catalog:",
    "@testing-library/dom": "catalog:",
    "@testing-library/jest-dom": "catalog:",
    "@testing-library/react": "catalog:",
    "@testing-library/user-event": "catalog:",
    "@types/react": "catalog:",
    "@types/react-dom": "catalog:",
    "@vitejs/plugin-react": "catalog:",
    "jsdom": "catalog:",
    "typescript": "catalog:",
    "vite": "catalog:",
    "vitest": "catalog:",
    "wrangler": "catalog:"
  }
}
```

Create `apps/admin/wrangler.jsonc`:

```jsonc
{
  "name": "plyrs-admin",
  "main": "src/server.ts",
  "compatibility_date": "2026-07-12",
  "compatibility_flags": ["nodejs_compat"],
  // 2026-07-16 裁定: admin は独立 Worker。/auth・/v1 は service binding で api Worker へ
  // 転送する same-origin プロキシ（SameSite=Strict のセッション cookie がそのまま機能する）。
  "services": [{ "binding": "API", "service": "plyrs-api" }],
}
```

Create `apps/admin/vite.config.ts`:

```ts
import { cloudflare } from "@cloudflare/vite-plugin";
import stylex from "@stylexjs/unplugin";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig(({ command }) => ({
  plugins: [
    cloudflare({
      viteEnvironment: { name: "ssr" },
      // dev でも service binding（API）を成立させる: api Worker を同じ dev サーバーで
      // auxiliary worker として起動する。build には含めない（api は独立デプロイ）。
      ...(command === "serve"
        ? { auxiliaryWorkers: [{ configPath: "../api/wrangler.jsonc" }] }
        : {}),
    }),
    // 管理画面は SPA 寄り（tech-selection §1.1）。シェルはビルド時に prerender される。
    tanstackStart({ spa: { enabled: true } }),
    // tech-selection §1.3: StyleX プラグインは @vitejs/plugin-react より前（Fast Refresh 維持）
    stylex.vite(),
    viteReact(),
  ],
}));
```

Create `apps/admin/tsconfig.json`（アプリ本体 = DOM。Worker エントリは除外して tsconfig.worker.json で検査する）:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx"
  },
  "include": ["src", "vite.config.ts", "vitest.config.ts", "vitest.setup.ts"],
  "exclude": ["src/server.ts"]
}
```

Create `apps/admin/tsconfig.worker.json`（Worker エントリ = DOM なし。ランタイム型は `wrangler types` の生成物が供給する）:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2023"],
    "jsx": "react-jsx"
  },
  "include": ["src/server.ts", "worker-configuration.d.ts"]
}
```

Create `apps/admin/vitest.config.ts`:

```ts
import stylex from "@stylexjs/unplugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [stylex.vite()],
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["./vitest.setup.ts"],
  },
});
```

Create `apps/admin/vitest.setup.ts`:

```ts
import "@testing-library/jest-dom/vitest";
```

- [ ] **Step 2: Worker エントリ（same-origin プロキシ）とアプリ骨格を作る**

Create `apps/admin/src/server.ts`:

```ts
import handler, { createServerEntry } from "@tanstack/react-start/server-entry";
import { env } from "cloudflare:workers";

// 2026-07-16 裁定: /auth・/v1 は service binding で api Worker へ転送する same-origin
// プロキシ。SameSite=Strict のセッション cookie がそのまま届き、CORS/CSRF 面を開かない。
// WebSocket（/v1/t/:tenantId/sync、Phase 6b で使用）の upgrade もこの転送に乗る。
// /public/v1 は転送しない（公開 read はヘッドレス契約 = api Worker の直接の責務）。
const API_PREFIXES = ["/auth", "/v1"];

function isApiPath(pathname: string): boolean {
  return API_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export default createServerEntry({
  fetch(request) {
    const { pathname } = new URL(request.url);
    if (isApiPath(pathname)) {
      return env.API.fetch(request);
    }
    return handler.fetch(request);
  },
});
```

Create `apps/admin/src/router.tsx`（Task 12 で RouterContext を完全形に置き換える。この時点では骨格のみ）:

```tsx
import { QueryClient } from "@tanstack/react-query";
import { createRouter, type RouterHistory } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export interface RouterContext {
  queryClient: QueryClient;
}

export function createAppContext(): RouterContext {
  return { queryClient: new QueryClient() };
}

export function getRouter(options?: { context?: RouterContext; history?: RouterHistory }) {
  return createRouter({
    routeTree,
    context: options?.context ?? createAppContext(),
    defaultPreload: "intent",
    ...(options?.history ? { history: options.history } : {}),
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
```

Create `apps/admin/src/routes/__root.tsx`:

```tsx
import { QueryClientProvider } from "@tanstack/react-query";
import {
  createRootRouteWithContext,
  HeadContent,
  Outlet,
  Scripts,
} from "@tanstack/react-router";
import type { ReactNode } from "react";
import type { RouterContext } from "../router";
import appCss from "../styles.css?url";

export const Route = createRootRouteWithContext<RouterContext>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "plyrs admin" },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  shellComponent: RootShell,
  component: RootComponent,
});

function RootShell({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="ja">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  return (
    <QueryClientProvider client={queryClient}>
      <Outlet />
    </QueryClientProvider>
  );
}
```

Create `apps/admin/src/routes/index.tsx`（Task 12 で `/tenants` へのリダイレクトに置き換えるプレースホルダ）:

```tsx
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: () => <p>plyrs admin</p>,
});
```

Create `apps/admin/src/styles.css`:

```css
* {
  box-sizing: border-box;
}

body {
  margin: 0;
}
```

Create `apps/admin/src/vite-env.d.ts`:

```ts
/// <reference types="vite/client" />

declare module "*.css?url" {
  const url: string;
  export default url;
}
```

- [ ] **Step 3: 生成物の lint/format 除外を先に入れる**

`.oxlintrc.json` の `ignorePatterns` を次に変更:

```json
  "ignorePatterns": [
    "dist",
    "node_modules",
    ".wrangler",
    "coverage",
    ".claude",
    ".superpowers",
    "**/routeTree.gen.ts",
    "**/worker-configuration.d.ts"
  ]
```

`.oxfmtignore` の末尾に追加:

```
# 生成物（tanstackStart / wrangler types が再生成する。手整形しない）
apps/admin/src/routeTree.gen.ts
apps/admin/worker-configuration.d.ts
```

- [ ] **Step 4: インストールと型生成**

Run: `CI=true pnpm install`
Expected: エラーなし（lockfile に @plyrs/admin が追加される）

Run: `pnpm --filter @plyrs/admin cf-typegen`
Expected: `apps/admin/worker-configuration.d.ts` が生成され、`Env` に `API: Fetcher` と `cloudflare:workers` モジュール宣言が含まれる（`grep -n "API" apps/admin/worker-configuration.d.ts` で確認）

- [ ] **Step 5: 失敗するスモークテストを書く**

Create `apps/admin/src/router.test.tsx`:

```tsx
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { getRouter } from "./router";

describe("router scaffold", () => {
  it("renders the index route at /", async () => {
    const router = getRouter({ history: createMemoryHistory({ initialEntries: ["/"] }) });
    render(<RouterProvider router={router} />);
    expect(await screen.findByText("plyrs admin")).toBeInTheDocument();
  });
});
```

Run: `pnpm --filter @plyrs/admin test`
Expected: FAIL（`./routeTree.gen` が未生成でモジュール解決に失敗）

- [ ] **Step 6: routeTree を生成してテストを通す**

Run: `pnpm --filter @plyrs/admin build`
Expected: `apps/admin/src/routeTree.gen.ts` が生成され、build が成功する（SPA シェルの prerender 込み）。**失敗したらエラー全文を添えて停止・報告（冒頭の停止条件）。**

Run: `pnpm --filter @plyrs/admin test`
Expected: PASS（1 test）

Run: `pnpm --filter @plyrs/admin typecheck`
Expected: tsconfig.json / tsconfig.worker.json の両方でエラーなし

- [ ] **Step 7: ルートゲートの確認**

Run: `pnpm lint && pnpm format:check`
Expected: エラー・警告なし（生成物が除外されていること）

- [ ] **Step 8: Commit**

```bash
git add pnpm-workspace.yaml pnpm-lock.yaml apps/admin .oxlintrc.json .oxfmtignore
git commit -m "feat: scaffold apps/admin with API proxy worker"
```

---

### Task 11: admin の認証コア（api-client + token-manager + admin-api）

**Files:**
- Create: `apps/admin/src/lib/api-client.ts`・`apps/admin/src/lib/token-manager.ts`・`apps/admin/src/lib/admin-api.ts`
- Test: `apps/admin/src/lib/api-client.test.ts`・`apps/admin/src/lib/token-manager.test.ts`・`apps/admin/src/lib/admin-api.test.ts`

**Interfaces:**
- Consumes: Task 5 の `GET /auth/tenants` 契約、Task 6 の `GET /v1/t/:tenantId/content-types` 契約、既存の `/auth/signup|login|logout|token`・`POST /v1/tenants` 契約、`FieldDefinition`（@plyrs/metamodel）
- Produces（Task 12/13 のルートが使う）:
  - `createApiClient(fetchImpl?: typeof fetch): ApiClient`（`signup` / `login` / `logout` / `listTenants(): Promise<TenantSummary[]>` / `createTenant` / `issueToken`）
  - `class ApiError extends Error { status: number; code: string }` / `throwApiError(response: Response): Promise<never>`
  - `createTokenManager({ issueToken, now? }): TokenManager`（`getToken(tenantId): Promise<string>` / `clear(): void`）
  - `createAdminApi(tokens: TokenManager, fetchImpl?: typeof fetch): AdminApi`（`listContentTypes(tenantId): Promise<ContentTypeSummary[]>`）
  - `TenantSummary = { id: string; slug: string; name: string; role: string }`
  - `ContentTypeSummary = { id; key; name; fields: FieldDefinition[]; source; pluginId; createdAt; updatedAt; version }`

- [ ] **Step 1: 失敗するテストを書く（token-manager）**

Create `apps/admin/src/lib/token-manager.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { createTokenManager } from "./token-manager";

describe("token manager (2026-07-16 裁定: メモリのみ + 先回りリフレッシュ)", () => {
  it("caches a token while it is outside the refresh margin", async () => {
    let now = 1_000_000;
    const issueToken = vi.fn().mockResolvedValue({ token: "t1", expiresIn: 900 });
    const manager = createTokenManager({ issueToken, now: () => now });
    expect(await manager.getToken("tenant-a")).toBe("t1");
    now += 800_000; // 残 100 秒 > 60 秒マージン
    expect(await manager.getToken("tenant-a")).toBe("t1");
    expect(issueToken).toHaveBeenCalledTimes(1);
  });

  it("refreshes proactively inside the 60s margin (Phase 4b 申し送り: exp 前の先回り)", async () => {
    let now = 0;
    const issueToken = vi
      .fn()
      .mockResolvedValueOnce({ token: "t1", expiresIn: 900 })
      .mockResolvedValueOnce({ token: "t2", expiresIn: 900 });
    const manager = createTokenManager({ issueToken, now: () => now });
    expect(await manager.getToken("a")).toBe("t1");
    now = 841_000; // 残 59 秒 < 60 秒マージン
    expect(await manager.getToken("a")).toBe("t2");
    expect(issueToken).toHaveBeenCalledTimes(2);
  });

  it("dedupes concurrent refreshes per tenant", async () => {
    const issueToken = vi.fn().mockResolvedValue({ token: "t", expiresIn: 900 });
    const manager = createTokenManager({ issueToken, now: () => 0 });
    const [a, b] = await Promise.all([manager.getToken("a"), manager.getToken("a")]);
    expect(a).toBe("t");
    expect(b).toBe("t");
    expect(issueToken).toHaveBeenCalledTimes(1);
  });

  it("keeps tokens per tenant and clear() drops them all", async () => {
    const issueToken = vi
      .fn()
      .mockImplementation((tenantId: string) =>
        Promise.resolve({ token: `t-${tenantId}`, expiresIn: 900 }),
      );
    const manager = createTokenManager({ issueToken, now: () => 0 });
    expect(await manager.getToken("a")).toBe("t-a");
    expect(await manager.getToken("b")).toBe("t-b");
    manager.clear();
    await manager.getToken("a");
    expect(issueToken).toHaveBeenCalledTimes(3);
  });

  it("does not cache failures", async () => {
    const issueToken = vi
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({ token: "t", expiresIn: 900 });
    const manager = createTokenManager({ issueToken, now: () => 0 });
    await expect(manager.getToken("a")).rejects.toThrow("boom");
    expect(await manager.getToken("a")).toBe("t");
  });
});
```

- [ ] **Step 2: 失敗するテストを書く（api-client / admin-api）**

Create `apps/admin/src/lib/api-client.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { ApiError, createApiClient } from "./api-client";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("api client (same-origin 相対パス・fetch 注入)", () => {
  it("posts credentials to /auth/login", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { userId: "u1" }));
    const api = createApiClient(fetchImpl);
    const result = await api.login("a@example.com", "hunter2hunter2");
    expect(result).toStrictEqual({ userId: "u1" });
    const [path, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(path).toBe("/auth/login");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toStrictEqual({
      email: "a@example.com",
      password: "hunter2hunter2",
    });
  });

  it("unwraps the tenants list from GET /auth/tenants", async () => {
    const tenants = [{ id: "t1", slug: "blog", name: "Blog", role: "owner" }];
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { tenants }));
    const api = createApiClient(fetchImpl);
    expect(await api.listTenants()).toStrictEqual(tenants);
    expect(fetchImpl.mock.calls[0]?.[0]).toBe("/auth/tenants");
  });

  it("throws ApiError carrying the server error code", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(401, { error: "unauthenticated" }));
    const api = createApiClient(fetchImpl);
    const error = await api.listTenants().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(401);
    expect((error as ApiError).code).toBe("unauthenticated");
  });

  it("falls back to unknown_error for non-JSON error bodies", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("Bad Gateway", { status: 502 }));
    const api = createApiClient(fetchImpl);
    const error = await api.logout().catch((e: unknown) => e);
    expect((error as ApiError).code).toBe("unknown_error");
  });
});
```

Create `apps/admin/src/lib/admin-api.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "./api-client";
import { createAdminApi } from "./admin-api";
import { createTokenManager } from "./token-manager";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function manager(token = "jwt-1") {
  return createTokenManager({
    issueToken: vi.fn().mockResolvedValue({ token, expiresIn: 900 }),
    now: () => 0,
  });
}

describe("admin api (Bearer 付き /v1/t/:tenantId)", () => {
  it("lists content types with a Bearer token from the manager", async () => {
    const contentTypes = [{ id: "c1", key: "article", name: "記事", fields: [], source: "user", pluginId: null, createdAt: "", updatedAt: "", version: 1 }];
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { contentTypes }));
    const adminApi = createAdminApi(manager(), fetchImpl);
    expect(await adminApi.listContentTypes("tenant-1")).toStrictEqual(contentTypes);
    const [path, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(path).toBe("/v1/t/tenant-1/content-types");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer jwt-1");
  });

  it("throws ApiError on gate rejection", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(403, { error: "wrong_tenant" }));
    const adminApi = createAdminApi(manager(), fetchImpl);
    const error = await adminApi.listContentTypes("tenant-1").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe("wrong_tenant");
  });
});
```

- [ ] **Step 3: 失敗を確認**

Run: `pnpm --filter @plyrs/admin test`
Expected: FAIL（lib モジュールが存在しない。router.test.tsx は PASS のまま）

- [ ] **Step 4: 実装**

Create `apps/admin/src/lib/api-client.ts`:

```ts
// 管理画面 → api Worker の HTTP 契約（すべて same-origin 相対パス。2026-07-16 裁定 #1）。
// fetch は注入可能（テストはスタブを渡す）。セッション cookie は same-origin fetch の既定で送られる。
export interface TenantSummary {
  id: string;
  slug: string;
  name: string;
  role: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(`${status}: ${code}`);
    this.name = "ApiError";
  }
}

export async function throwApiError(response: Response): Promise<never> {
  let code = "unknown_error";
  try {
    const body = (await response.json()) as { error?: unknown };
    if (typeof body.error === "string") {
      code = body.error;
    }
  } catch {
    // 本文が JSON でない（ゲートウェイ応答等）場合は unknown_error のまま
  }
  throw new ApiError(response.status, code);
}

const JSON_HEADERS = { "content-type": "application/json" } as const;

// 既定値はグローバル fetch を束縛したラッパー。素の `fetch` を既定値にすると、ブラウザで
// detached call（this 喪失）となり Illegal invocation を投げる。
export function createApiClient(fetchImpl: typeof fetch = (...args) => fetch(...args)) {
  async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetchImpl(path, init);
    if (!response.ok) {
      return throwApiError(response);
    }
    return (await response.json()) as T;
  }
  return {
    signup(email: string, password: string): Promise<{ userId: string }> {
      return requestJson("/auth/signup", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ email, password }),
      });
    },
    login(email: string, password: string): Promise<{ userId: string }> {
      return requestJson("/auth/login", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ email, password }),
      });
    },
    async logout(): Promise<void> {
      await requestJson<{ ok: boolean }>("/auth/logout", {
        method: "POST",
        headers: JSON_HEADERS,
        body: "{}",
      });
    },
    async listTenants(): Promise<TenantSummary[]> {
      const { tenants } = await requestJson<{ tenants: TenantSummary[] }>("/auth/tenants");
      return tenants;
    },
    createTenant(name: string, slug: string): Promise<{ tenantId: string }> {
      return requestJson("/v1/tenants", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ name, slug }),
      });
    },
    issueToken(tenantId: string): Promise<{ token: string; expiresIn: number }> {
      return requestJson("/auth/token", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ tenantId }),
      });
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
```

Create `apps/admin/src/lib/token-manager.ts`:

```ts
// 2026-07-16 裁定 #2: 短命 JWT（15 分）は JS メモリにだけ保持し、storage に置かない。
// exp の 60 秒前を切ったら /auth/token で再取得（Phase 4b 申し送りの「exp 前の先回り」）。
// ページリロード時はキャッシュが空になり、セッション cookie 経由の issueToken 1 往復で復元される。
export interface TokenManagerDeps {
  issueToken: (tenantId: string) => Promise<{ token: string; expiresIn: number }>;
  now?: () => number;
}

const REFRESH_MARGIN_MS = 60_000;

export function createTokenManager({ issueToken, now = Date.now }: TokenManagerDeps) {
  const cache = new Map<string, { token: string; expiresAt: number }>();
  const inflight = new Map<string, Promise<string>>();
  return {
    async getToken(tenantId: string): Promise<string> {
      const cached = cache.get(tenantId);
      if (cached !== undefined && cached.expiresAt - now() > REFRESH_MARGIN_MS) {
        return cached.token;
      }
      const pending = inflight.get(tenantId);
      if (pending !== undefined) {
        return pending;
      }
      const promise = issueToken(tenantId)
        .then(({ token, expiresIn }) => {
          cache.set(tenantId, { token, expiresAt: now() + expiresIn * 1000 });
          inflight.delete(tenantId);
          return token;
        })
        .catch((error: unknown) => {
          inflight.delete(tenantId);
          throw error;
        });
      inflight.set(tenantId, promise);
      return promise;
    },
    clear(): void {
      cache.clear();
      inflight.clear();
    },
  };
}

export type TokenManager = ReturnType<typeof createTokenManager>;
```

Create `apps/admin/src/lib/admin-api.ts`:

```ts
import type { FieldDefinition } from "@plyrs/metamodel";
import { throwApiError, type ApiClient } from "./api-client";
import type { TokenManager } from "./token-manager";

// Bearer 付きの管理 API（/v1/t/:tenantId/...）。トークンは token-manager が供給する。
// 形は apps/api の ContentTypeRow（rpc-unwrap.ts）と一致させる。
export interface ContentTypeSummary {
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

export function createAdminApi(
  tokens: TokenManager,
  fetchImpl: typeof fetch = (...args) => fetch(...args),
) {
  async function requestJson<T>(tenantId: string, path: string): Promise<T> {
    const token = await tokens.getToken(tenantId);
    const response = await fetchImpl(`/v1/t/${tenantId}${path}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      return throwApiError(response);
    }
    return (await response.json()) as T;
  }
  return {
    async listContentTypes(tenantId: string): Promise<ContentTypeSummary[]> {
      const { contentTypes } = await requestJson<{ contentTypes: ContentTypeSummary[] }>(
        tenantId,
        "/content-types",
      );
      return contentTypes;
    },
  };
}

export type AdminApi = ReturnType<typeof createAdminApi>;

// ApiClient は router context の組み立て（Task 12）で token-manager と束ねる
export type { ApiClient };
```

- [ ] **Step 5: テストが通ることを確認**

Run: `pnpm --filter @plyrs/admin test && pnpm --filter @plyrs/admin typecheck`
Expected: PASS / エラーなし

- [ ] **Step 6: Commit**

```bash
git add apps/admin/src/lib
git commit -m "feat: add admin auth core with token manager"
```

---

### Task 12: ログインフロー（login / signup / tenants ルート + RouterContext 完全形）

**Files:**
- Modify: `apps/admin/src/router.tsx`（RouterContext 完全形へ全置換）
- Modify: `apps/admin/src/routes/index.tsx`（/tenants へのリダイレクトへ全置換）
- Modify: `apps/admin/src/router.test.tsx`（リダイレクト後の期待へ更新）
- Create: `apps/admin/src/lib/queries.ts`・`apps/admin/src/routes/login.tsx`・`apps/admin/src/routes/signup.tsx`・`apps/admin/src/routes/tenants.tsx`
- Test: `apps/admin/src/auth-flow.test.tsx`（**src/routes/ 配下に置かない** — Start のルート生成器が routes/ 内の .tsx をルートとして解釈するため）

**Interfaces:**
- Consumes: Task 11 の `createApiClient` / `createTokenManager` / `createAdminApi` / `ApiError` / `TenantSummary`、Task 9 の `createSlotRegistry`、Task 8 の `Button` / `TextField`
- Produces（Task 13 が依存）:
  - `RouterContext = { queryClient: QueryClient; api: ApiClient; adminApi: AdminApi; tokens: TokenManager; slots: SlotRegistry }`
  - `createAppContext(fetchImpl?: typeof fetch): RouterContext`（`nav:item` に `core.content-types` を登録済み）
  - `tenantsQueryOptions(api: ApiClient)`（queryKey `["tenants"]`・staleTime 30s）
  - `contentTypesQueryOptions(adminApi: AdminApi, tenantId: string)`（queryKey `["content-types", tenantId]`）

- [ ] **Step 1: 失敗するテストを書く**

Create `apps/admin/src/auth-flow.test.tsx`:

```tsx
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, type Mock } from "vitest";
import { createAppContext, getRouter } from "./router";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

type Handler = Mock<(init?: RequestInit) => Response>;

// パス → ハンドラの素朴なスタブ。未定義パスへの fetch は即テスト失敗にする。
function stubFetch(routes: Record<string, Handler>): typeof fetch {
  return async (input, init) => {
    const path =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.pathname
          : new URL(input.url).pathname;
    const handler = routes[path];
    if (handler === undefined) {
      throw new Error(`unexpected fetch: ${path}`);
    }
    return handler(init ?? undefined);
  };
}

function renderAt(path: string, routes: Record<string, Handler>) {
  const router = getRouter({
    context: createAppContext(stubFetch(routes)),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  render(<RouterProvider router={router} />);
  return router;
}

describe("ログインフロー", () => {
  it("logs in and navigates to the tenant chooser", async () => {
    const login = vi.fn(() => jsonResponse(200, { userId: "u1" }));
    const tenants = vi.fn(() => jsonResponse(200, { tenants: [] }));
    renderAt("/login", { "/auth/login": login, "/auth/tenants": tenants });
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("メールアドレス"), "a@example.com");
    await user.type(screen.getByLabelText("パスワード"), "hunter2hunter2");
    await user.click(screen.getByRole("button", { name: "ログイン" }));
    expect(await screen.findByRole("heading", { name: "テナントを選択" })).toBeInTheDocument();
    expect(login).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String((login.mock.calls[0]?.[0] as RequestInit).body));
    expect(body).toStrictEqual({ email: "a@example.com", password: "hunter2hunter2" });
  });

  it("shows a field-level error for invalid credentials", async () => {
    const login = vi.fn(() => jsonResponse(401, { error: "invalid_credentials" }));
    renderAt("/login", { "/auth/login": login });
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("メールアドレス"), "a@example.com");
    await user.type(screen.getByLabelText("パスワード"), "wrong-password-x");
    await user.click(screen.getByRole("button", { name: "ログイン" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "メールアドレスまたはパスワードが違います",
    );
  });

  it("signs up and lands on the tenant chooser", async () => {
    const signup = vi.fn(() => jsonResponse(201, { userId: "u1" }));
    const tenants = vi.fn(() => jsonResponse(200, { tenants: [] }));
    renderAt("/signup", { "/auth/signup": signup, "/auth/tenants": tenants });
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("メールアドレス"), "new@example.com");
    await user.type(screen.getByLabelText("パスワード"), "hunter2hunter2");
    await user.click(screen.getByRole("button", { name: "サインアップ" }));
    expect(await screen.findByRole("heading", { name: "テナントを選択" })).toBeInTheDocument();
  });

  it("redirects unauthenticated visitors from /tenants to /login", async () => {
    const tenants = vi.fn(() => jsonResponse(401, { error: "unauthenticated" }));
    renderAt("/tenants", { "/auth/tenants": tenants });
    expect(await screen.findByRole("heading", { name: "ログイン" })).toBeInTheDocument();
  });

  it("lists tenants as links into the shell", async () => {
    const tenants = vi.fn(() =>
      jsonResponse(200, {
        tenants: [
          { id: "t1", slug: "blog", name: "Blog", role: "owner" },
          { id: "t2", slug: "shop", name: "Shop", role: "editor" },
        ],
      }),
    );
    renderAt("/tenants", { "/auth/tenants": tenants });
    const link = await screen.findByRole("link", { name: /Blog/ });
    expect(link).toHaveAttribute("href", "/t/blog/content-types");
    expect(screen.getByRole("link", { name: /Shop/ })).toHaveAttribute(
      "href",
      "/t/shop/content-types",
    );
  });

  it("creates a tenant and refreshes the list", async () => {
    const created = { id: "t9", slug: "new-blog", name: "New Blog", role: "owner" };
    let tenantRows: unknown[] = [];
    const tenants = vi.fn(() => jsonResponse(200, { tenants: tenantRows }));
    const create = vi.fn(() => {
      tenantRows = [created];
      return jsonResponse(201, { tenantId: "t9" });
    });
    renderAt("/tenants", { "/auth/tenants": tenants, "/v1/tenants": create });
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("テナント名"), "New Blog");
    await user.type(screen.getByLabelText("slug"), "new-blog");
    await user.click(screen.getByRole("button", { name: "作成" }));
    expect(await screen.findByRole("link", { name: /New Blog/ })).toBeInTheDocument();
    expect(create).toHaveBeenCalledTimes(1);
  });
});
```

`apps/admin/src/router.test.tsx` を次に更新（index はリダイレクトになる）:

```tsx
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createAppContext, getRouter } from "./router";

function stubFetch(status: number, body: unknown): typeof fetch {
  return async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
}

describe("router scaffold", () => {
  it("redirects / to /tenants (then /login when unauthenticated)", async () => {
    const router = getRouter({
      context: createAppContext(stubFetch(401, { error: "unauthenticated" })),
      history: createMemoryHistory({ initialEntries: ["/"] }),
    });
    render(<RouterProvider router={router} />);
    expect(await screen.findByRole("heading", { name: "ログイン" })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 失敗を確認**

Run: `pnpm --filter @plyrs/admin test`
Expected: FAIL（login/signup/tenants ルートが存在しない・createAppContext が fetch を受け取らない）

- [ ] **Step 3: router.tsx を完全形に置き換える**

`apps/admin/src/router.tsx` 全体:

```tsx
import { QueryClient } from "@tanstack/react-query";
import { createRouter, type RouterHistory } from "@tanstack/react-router";
import { createSlotRegistry, type SlotRegistry } from "@plyrs/ui";
import { createAdminApi, type AdminApi } from "./lib/admin-api";
import { createApiClient, type ApiClient } from "./lib/api-client";
import { createTokenManager, type TokenManager } from "./lib/token-manager";
import { routeTree } from "./routeTree.gen";

export interface RouterContext {
  queryClient: QueryClient;
  api: ApiClient;
  adminApi: AdminApi;
  tokens: TokenManager;
  slots: SlotRegistry;
}

// 既定はグローバル fetch を束縛したラッパー（ブラウザで detached fetch を呼ぶと
// Illegal invocation になるため、素の `fetch` を既定値にしない）。テストはスタブを渡す。
export function createAppContext(
  fetchImpl: typeof fetch = (...args) => fetch(...args),
): RouterContext {
  const api = createApiClient(fetchImpl);
  const tokens = createTokenManager({ issueToken: api.issueToken });
  const adminApi = createAdminApi(tokens, fetchImpl);
  const slots = createSlotRegistry();
  // コアのナビ項目。モジュール（Phase 9）も同じ register 経路で項目を足す（design-spec §9.9）
  slots.register("nav:item", {
    id: "core.content-types",
    label: "コンテンツタイプ",
    to: "/t/$tenantSlug/content-types",
    order: 0,
  });
  return { queryClient: new QueryClient(), api, adminApi, tokens, slots };
}

export function getRouter(options?: { context?: RouterContext; history?: RouterHistory }) {
  return createRouter({
    routeTree,
    context: options?.context ?? createAppContext(),
    defaultPreload: "intent",
    ...(options?.history ? { history: options.history } : {}),
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
```

- [ ] **Step 4: queries.ts とルートを実装する**

Create `apps/admin/src/lib/queries.ts`:

```ts
import { queryOptions } from "@tanstack/react-query";
import type { AdminApi } from "./admin-api";
import type { ApiClient } from "./api-client";

// ルート間で共有するクエリ定義。テナント一覧は /tenants と /t/$tenantSlug ガードの両方が
// 使うため、queryClient 経由でキャッシュして往復を 1 回に抑える。
export function tenantsQueryOptions(api: ApiClient) {
  return queryOptions({
    queryKey: ["tenants"],
    queryFn: () => api.listTenants(),
    staleTime: 30_000,
  });
}

export function contentTypesQueryOptions(adminApi: AdminApi, tenantId: string) {
  return queryOptions({
    queryKey: ["content-types", tenantId],
    queryFn: () => adminApi.listContentTypes(tenantId),
    staleTime: 10_000,
  });
}
```

`apps/admin/src/routes/index.tsx` 全体を置き換え:

```tsx
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  beforeLoad: () => {
    throw redirect({ to: "/tenants" });
  },
});
```

Create `apps/admin/src/routes/login.tsx`:

```tsx
import * as stylex from "@stylexjs/stylex";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Button, TextField } from "@plyrs/ui";
import { colors, spacing, typography } from "@plyrs/ui/tokens.stylex";
import { ApiError } from "../lib/api-client";

const styles = stylex.create({
  page: {
    display: "grid",
    placeItems: "center",
    minHeight: "100vh",
    fontFamily: typography.fontFamily,
    backgroundColor: colors.bg,
    color: colors.text,
  },
  card: {
    display: "flex",
    flexDirection: "column",
    gap: spacing.md,
    width: "320px",
    padding: spacing.lg,
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: colors.border,
    borderRadius: "8px",
    backgroundColor: colors.surface,
  },
  title: { fontSize: typography.sizeXl, margin: 0 },
  error: { color: colors.danger, fontSize: typography.sizeSm, margin: 0 },
  alt: { fontSize: typography.sizeSm, color: colors.textMuted },
});

export const Route = createFileRoute("/login")({ component: LoginPage });

function LoginPage() {
  const { api } = Route.useRouteContext();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await api.login(email, password);
      await navigate({ to: "/tenants" });
    } catch (cause) {
      setError(
        cause instanceof ApiError && cause.code === "invalid_credentials"
          ? "メールアドレスまたはパスワードが違います"
          : "ログインに失敗しました。時間をおいて再試行してください",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main {...stylex.props(styles.page)}>
      <form
        {...stylex.props(styles.card)}
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <h1 {...stylex.props(styles.title)}>ログイン</h1>
        <TextField
          label="メールアドレス"
          name="email"
          type="email"
          value={email}
          onChange={setEmail}
          isRequired
        />
        <TextField
          label="パスワード"
          name="password"
          type="password"
          value={password}
          onChange={setPassword}
          isRequired
        />
        {error !== null ? (
          <p {...stylex.props(styles.error)} role="alert">
            {error}
          </p>
        ) : null}
        <Button type="submit" isDisabled={busy}>
          ログイン
        </Button>
        <span {...stylex.props(styles.alt)}>
          アカウントがない場合は <Link to="/signup">サインアップ</Link>
        </span>
      </form>
    </main>
  );
}
```

Create `apps/admin/src/routes/signup.tsx`:

```tsx
import * as stylex from "@stylexjs/stylex";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Button, TextField } from "@plyrs/ui";
import { colors, spacing, typography } from "@plyrs/ui/tokens.stylex";
import { ApiError } from "../lib/api-client";

const styles = stylex.create({
  page: {
    display: "grid",
    placeItems: "center",
    minHeight: "100vh",
    fontFamily: typography.fontFamily,
    backgroundColor: colors.bg,
    color: colors.text,
  },
  card: {
    display: "flex",
    flexDirection: "column",
    gap: spacing.md,
    width: "320px",
    padding: spacing.lg,
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: colors.border,
    borderRadius: "8px",
    backgroundColor: colors.surface,
  },
  title: { fontSize: typography.sizeXl, margin: 0 },
  error: { color: colors.danger, fontSize: typography.sizeSm, margin: 0 },
  alt: { fontSize: typography.sizeSm, color: colors.textMuted },
});

export const Route = createFileRoute("/signup")({ component: SignupPage });

function messageFor(cause: unknown): string {
  if (cause instanceof ApiError && cause.code === "email_taken") {
    return "このメールアドレスは既に登録されています";
  }
  if (cause instanceof ApiError && cause.status === 400) {
    return "入力内容を確認してください（パスワードは 12 文字以上）";
  }
  return "サインアップに失敗しました。時間をおいて再試行してください";
}

function SignupPage() {
  const { api } = Route.useRouteContext();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await api.signup(email, password);
      await navigate({ to: "/tenants" });
    } catch (cause) {
      setError(messageFor(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main {...stylex.props(styles.page)}>
      <form
        {...stylex.props(styles.card)}
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <h1 {...stylex.props(styles.title)}>サインアップ</h1>
        <TextField
          label="メールアドレス"
          name="email"
          type="email"
          value={email}
          onChange={setEmail}
          isRequired
        />
        <TextField
          label="パスワード"
          name="password"
          type="password"
          value={password}
          onChange={setPassword}
          isRequired
          minLength={12}
        />
        {error !== null ? (
          <p {...stylex.props(styles.error)} role="alert">
            {error}
          </p>
        ) : null}
        <Button type="submit" isDisabled={busy}>
          サインアップ
        </Button>
        <span {...stylex.props(styles.alt)}>
          アカウントがある場合は <Link to="/login">ログイン</Link>
        </span>
      </form>
    </main>
  );
}
```

Create `apps/admin/src/routes/tenants.tsx`:

```tsx
import * as stylex from "@stylexjs/stylex";
import { createFileRoute, Link, redirect, useRouter } from "@tanstack/react-router";
import { useState, type ComponentType, type ReactNode } from "react";
import { Button, TextField } from "@plyrs/ui";
import { colors, spacing, typography } from "@plyrs/ui/tokens.stylex";
import { ApiError } from "../lib/api-client";
import { tenantsQueryOptions } from "../lib/queries";

// Task 12 時点では /t/$tenantSlug/content-types ルートが未作成（Task 13 で追加）のため、
// typed Link の to union にまだ載らない。ここだけ untyped に落とし、**Task 13 で typed Link に
// 戻す**（Task 13 Step 3 に置換内容を明記済み）。
const TenantLink = Link as unknown as ComponentType<{
  to: string;
  params: Record<string, string>;
  className?: string;
  children: ReactNode;
}>;

const styles = stylex.create({
  page: {
    maxWidth: "480px",
    margin: "0 auto",
    padding: spacing.xl,
    display: "flex",
    flexDirection: "column",
    gap: spacing.lg,
    fontFamily: typography.fontFamily,
    color: colors.text,
  },
  title: { fontSize: typography.sizeXl, margin: 0 },
  list: { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: spacing.sm },
  item: {
    display: "block",
    padding: spacing.md,
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: colors.border,
    borderRadius: "8px",
    backgroundColor: colors.surface,
    color: colors.text,
    textDecoration: "none",
  },
  role: { color: colors.textMuted, fontSize: typography.sizeSm, marginLeft: spacing.sm },
  form: { display: "flex", flexDirection: "column", gap: spacing.sm },
  subtitle: { fontSize: typography.sizeLg, marginBottom: 0 },
  error: { color: colors.danger, fontSize: typography.sizeSm, margin: 0 },
  muted: { color: colors.textMuted, fontSize: typography.sizeMd },
  footer: { display: "flex", justifyContent: "flex-end" },
});

export const Route = createFileRoute("/tenants")({
  loader: async ({ context }) => {
    try {
      return await context.queryClient.ensureQueryData(tenantsQueryOptions(context.api));
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        throw redirect({ to: "/login" });
      }
      throw cause;
    }
  },
  component: TenantsPage,
});

function TenantsPage() {
  const { api, queryClient, tokens } = Route.useRouteContext();
  const tenants = Route.useLoaderData();
  const router = useRouter();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function createTenant() {
    setBusy(true);
    setError(null);
    try {
      await api.createTenant(name, slug);
      setName("");
      setSlug("");
      await queryClient.invalidateQueries({ queryKey: ["tenants"] });
      await router.invalidate();
    } catch (cause) {
      setError(
        cause instanceof ApiError && cause.code === "slug_taken"
          ? "この slug は既に使われています"
          : "テナントを作成できませんでした（slug は小文字英数字とハイフン）",
      );
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    await api.logout();
    tokens.clear();
    queryClient.clear();
    await router.navigate({ to: "/login" });
  }

  return (
    <main {...stylex.props(styles.page)}>
      <h1 {...stylex.props(styles.title)}>テナントを選択</h1>
      {tenants.length === 0 ? (
        <p {...stylex.props(styles.muted)}>所属テナントがありません。下のフォームから作成できます。</p>
      ) : (
        <ul {...stylex.props(styles.list)}>
          {tenants.map((tenant) => (
            <li key={tenant.id}>
              <TenantLink
                to="/t/$tenantSlug/content-types"
                params={{ tenantSlug: tenant.slug }}
                className={stylex.props(styles.item).className ?? ""}
              >
                {tenant.name}
                <span {...stylex.props(styles.role)}>
                  {tenant.slug} / {tenant.role}
                </span>
              </TenantLink>
            </li>
          ))}
        </ul>
      )}
      <section>
        <h2 {...stylex.props(styles.subtitle)}>新しいテナント</h2>
        <form
          {...stylex.props(styles.form)}
          onSubmit={(event) => {
            event.preventDefault();
            void createTenant();
          }}
        >
          <TextField label="テナント名" value={name} onChange={setName} isRequired />
          <TextField label="slug" value={slug} onChange={setSlug} isRequired />
          {error !== null ? (
            <p {...stylex.props(styles.error)} role="alert">
              {error}
            </p>
          ) : null}
          <Button type="submit" isDisabled={busy}>
            作成
          </Button>
        </form>
      </section>
      <div {...stylex.props(styles.footer)}>
        <Button variant="secondary" onPress={() => void logout()}>
          ログアウト
        </Button>
      </div>
    </main>
  );
}
```

- [ ] **Step 5: routeTree を再生成してテストを通す**

Run: `pnpm --filter @plyrs/admin build`
Expected: 成功（routeTree.gen.ts に /login・/signup・/tenants が追加される）

Run: `pnpm --filter @plyrs/admin test`
Expected: PASS（auth-flow 6 tests + router 1 test + lib のテスト）

Run: `pnpm --filter @plyrs/admin typecheck`
Expected: エラーなし（tenants.tsx のテナントリンクは一時的な `TenantLink`（untyped cast）なので、/t 系ルートが未生成でも型は通る。Task 13 Step 3 で typed Link に戻す）

- [ ] **Step 6: Commit**

```bash
git add apps/admin/src
git commit -m "feat: add login, signup and tenant chooser"
```

---

### Task 13: 認証済みシェル（/t/$tenantSlug レイアウト + content_type 一覧）

**Files:**
- Create: `apps/admin/src/routes/t/$tenantSlug/route.tsx`・`apps/admin/src/routes/t/$tenantSlug/index.tsx`・`apps/admin/src/routes/t/$tenantSlug/content-types.tsx`
- Modify: `apps/admin/src/routes/tenants.tsx`（一時的な `TenantLink` を typed Link に戻す）
- Test: `apps/admin/src/shell.test.tsx`（**src/routes/ 配下に置かない** — Task 12 と同じ理由）

**Interfaces:**
- Consumes: Task 12 の `RouterContext` / `tenantsQueryOptions` / `contentTypesQueryOptions`、Task 9 の `slots.get("nav:item")`、Task 11 の `ApiError` / `TenantSummary`
- Produces: `/t/$tenantSlug` のルートコンテキストに `tenant: TenantSummary` が加わる（beforeLoad の戻り値マージ。Phase 6b の record ルートがこれを引き継ぐ）

- [ ] **Step 1: 失敗するテストを書く**

Create `apps/admin/src/shell.test.tsx`:

```tsx
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, type Mock } from "vitest";
import { createAppContext, getRouter } from "./router";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

type Handler = Mock<(init?: RequestInit) => Response>;

function stubFetch(routes: Record<string, Handler>): typeof fetch {
  return async (input, init) => {
    const path =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.pathname
          : new URL(input.url).pathname;
    const handler = routes[path];
    if (handler === undefined) {
      throw new Error(`unexpected fetch: ${path}`);
    }
    return handler(init ?? undefined);
  };
}

function renderAt(path: string, routes: Record<string, Handler>) {
  const router = getRouter({
    context: createAppContext(stubFetch(routes)),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  render(<RouterProvider router={router} />);
  return router;
}

const blogTenant = { id: "t1", slug: "blog", name: "Blog", role: "owner" };

function authedRoutes(overrides: Record<string, Handler> = {}): Record<string, Handler> {
  return {
    "/auth/tenants": vi.fn(() => jsonResponse(200, { tenants: [blogTenant] })),
    "/auth/token": vi.fn(() => jsonResponse(200, { token: "jwt-abc", expiresIn: 900 })),
    "/v1/t/t1/content-types": vi.fn(() =>
      jsonResponse(200, {
        contentTypes: [
          {
            id: "c1",
            key: "article",
            name: "記事",
            fields: [
              { key: "title", type: "text", required: true },
              { key: "slug", type: "text", config: { unique: true } },
            ],
            source: "user",
            pluginId: null,
            createdAt: "2026-07-16T00:00:00Z",
            updatedAt: "2026-07-16T00:00:00Z",
            version: 1,
          },
        ],
      }),
    ),
    ...overrides,
  };
}

describe("認証済みシェル (/t/$tenantSlug)", () => {
  it("renders nav from the slot registry, the tenant header, and the content type list", async () => {
    const routes = authedRoutes();
    renderAt("/t/blog/content-types", routes);
    expect(await screen.findByRole("link", { name: "コンテンツタイプ" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Blog/ })).toHaveAttribute("href", "/tenants");
    expect(await screen.findByRole("cell", { name: "article" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "記事" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "2" })).toBeInTheDocument(); // フィールド数
    // Bearer トークンが付与されている（token-manager 経由）
    const listCall = routes["/v1/t/t1/content-types"]?.mock.calls[0]?.[0] as RequestInit;
    expect(new Headers(listCall.headers).get("authorization")).toBe("Bearer jwt-abc");
  });

  it("shows the empty state for a tenant without content types", async () => {
    const routes = authedRoutes({
      "/v1/t/t1/content-types": vi.fn(() => jsonResponse(200, { contentTypes: [] })),
    });
    renderAt("/t/blog/content-types", routes);
    expect(await screen.findByText(/コンテンツタイプはまだありません/)).toBeInTheDocument();
  });

  it("redirects to /tenants for a slug the user does not belong to", async () => {
    renderAt("/t/ghost/content-types", authedRoutes());
    expect(await screen.findByRole("heading", { name: "テナントを選択" })).toBeInTheDocument();
  });

  it("redirects to /login when unauthenticated", async () => {
    renderAt(
      "/t/blog/content-types",
      authedRoutes({
        "/auth/tenants": vi.fn(() => jsonResponse(401, { error: "unauthenticated" })),
      }),
    );
    expect(await screen.findByRole("heading", { name: "ログイン" })).toBeInTheDocument();
  });

  it("redirects /t/$tenantSlug to the content type list", async () => {
    renderAt("/t/blog", authedRoutes());
    expect(await screen.findByRole("cell", { name: "article" })).toBeInTheDocument();
  });

  it("logs out from the shell header", async () => {
    const logout = vi.fn(() => jsonResponse(200, { ok: true }));
    renderAt("/t/blog/content-types", authedRoutes({ "/auth/logout": logout }));
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "ログアウト" }));
    expect(await screen.findByRole("heading", { name: "ログイン" })).toBeInTheDocument();
    expect(logout).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: 失敗を確認**

Run: `pnpm --filter @plyrs/admin test -- shell.test.tsx`
Expected: FAIL（/t/$tenantSlug ルートが存在せず 404 相当）

- [ ] **Step 3: シェルレイアウトと配下ルートを実装する**

Create `apps/admin/src/routes/t/$tenantSlug/route.tsx`:

```tsx
import * as stylex from "@stylexjs/stylex";
import {
  createFileRoute,
  Link,
  Outlet,
  redirect,
  useNavigate,
} from "@tanstack/react-router";
import type { ComponentType, ReactNode } from "react";
import { Button } from "@plyrs/ui";
import { colors, spacing, typography } from "@plyrs/ui/tokens.stylex";
import { ApiError } from "../../../lib/api-client";
import { tenantsQueryOptions } from "../../../lib/queries";

const styles = stylex.create({
  shell: {
    display: "grid",
    gridTemplateColumns: "220px 1fr",
    minHeight: "100vh",
    fontFamily: typography.fontFamily,
    backgroundColor: colors.bg,
    color: colors.text,
  },
  sidebar: {
    borderRightWidth: "1px",
    borderRightStyle: "solid",
    borderRightColor: colors.border,
    padding: spacing.md,
    display: "flex",
    flexDirection: "column",
    gap: spacing.sm,
    backgroundColor: colors.surface,
  },
  brand: { fontSize: typography.sizeLg, fontWeight: 600, marginBottom: spacing.md },
  navLink: {
    color: colors.text,
    textDecoration: "none",
    padding: spacing.xs,
    borderRadius: "4px",
  },
  main: { display: "flex", flexDirection: "column" },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: spacing.md,
    borderBottomWidth: "1px",
    borderBottomStyle: "solid",
    borderBottomColor: colors.border,
  },
  tenantLink: { color: colors.textMuted, textDecoration: "none", fontSize: typography.sizeSm },
  content: { padding: spacing.lg },
});

export const Route = createFileRoute("/t/$tenantSlug")({
  // 認証ガード（2026-07-16 裁定 #3）: テナント一覧から slug を解決する。未認証は /login、
  // 非所属 slug は /tenants へ（存在有無は応答から区別できない — 一覧に無い、が全て）。
  beforeLoad: async ({ context, params }) => {
    let tenantList;
    try {
      tenantList = await context.queryClient.ensureQueryData(tenantsQueryOptions(context.api));
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        throw redirect({ to: "/login" });
      }
      throw cause;
    }
    const tenant = tenantList.find((candidate) => candidate.slug === params.tenantSlug);
    if (tenant === undefined) {
      throw redirect({ to: "/tenants" });
    }
    return { tenant };
  },
  component: ShellLayout,
});

// スロット貢献の to は実行時文字列（モジュールが動的に登録する）のため typed routing の
// 静的 union に載らない。untyped へ落とすのはこの 1 箇所だけ（rpc-unwrap と同じ境界 cast 方針）。
const UntypedLink = Link as unknown as ComponentType<{
  to: string;
  params: Record<string, string>;
  className?: string;
  children: ReactNode;
}>;

function ShellLayout() {
  const { tenant, slots, api, tokens, queryClient } = Route.useRouteContext();
  const { tenantSlug } = Route.useParams();
  const navigate = useNavigate();

  async function logout() {
    await api.logout();
    tokens.clear();
    queryClient.clear();
    await navigate({ to: "/login" });
  }

  return (
    <div {...stylex.props(styles.shell)}>
      <nav {...stylex.props(styles.sidebar)} aria-label="メインナビゲーション">
        <span {...stylex.props(styles.brand)}>plyrs</span>
        {slots.get("nav:item").map((item) => (
          <UntypedLink
            key={item.id}
            to={item.to}
            params={{ tenantSlug }}
            className={stylex.props(styles.navLink).className ?? ""}
          >
            {item.label}
          </UntypedLink>
        ))}
      </nav>
      <div {...stylex.props(styles.main)}>
        <header {...stylex.props(styles.header)}>
          <Link to="/tenants" {...stylex.props(styles.tenantLink)}>
            {tenant.name}（テナント切替）
          </Link>
          <Button variant="secondary" onPress={() => void logout()}>
            ログアウト
          </Button>
        </header>
        <main {...stylex.props(styles.content)}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
```

あわせて `apps/admin/src/routes/tenants.tsx` の一時的な untyped cast を typed Link に戻す:

1. import から `type ComponentType, type ReactNode` を外し（`import { useState } from "react";` に戻す）、`const TenantLink = ...` の定義とコメントを削除する。
2. リスト内の `<TenantLink ...>` を次に置き換える（ルートが生成済みになったため typed で通る）:

```tsx
              <Link
                to="/t/$tenantSlug/content-types"
                params={{ tenantSlug: tenant.slug }}
                {...stylex.props(styles.item)}
              >
                {tenant.name}
                <span {...stylex.props(styles.role)}>
                  {tenant.slug} / {tenant.role}
                </span>
              </Link>
```

Create `apps/admin/src/routes/t/$tenantSlug/index.tsx`:

```tsx
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/t/$tenantSlug/")({
  beforeLoad: ({ params }) => {
    throw redirect({ to: "/t/$tenantSlug/content-types", params });
  },
});
```

Create `apps/admin/src/routes/t/$tenantSlug/content-types.tsx`:

```tsx
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import * as stylex from "@stylexjs/stylex";
import { colors, spacing, typography } from "@plyrs/ui/tokens.stylex";
import { contentTypesQueryOptions } from "../../../lib/queries";

const styles = stylex.create({
  title: { fontSize: typography.sizeXl, marginTop: 0 },
  table: { borderCollapse: "collapse", width: "100%", fontSize: typography.sizeMd },
  cell: {
    textAlign: "left",
    padding: spacing.sm,
    borderBottomWidth: "1px",
    borderBottomStyle: "solid",
    borderBottomColor: colors.border,
  },
  muted: { color: colors.textMuted },
});

export const Route = createFileRoute("/t/$tenantSlug/content-types")({
  // 読み取り表示のみ（編集・作成は Phase 6b の content_type ビルダー）
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(
      contentTypesQueryOptions(context.adminApi, context.tenant.id),
    ),
  component: ContentTypesPage,
});

function ContentTypesPage() {
  const { adminApi, tenant } = Route.useRouteContext();
  const { data: contentTypes } = useSuspenseQuery(contentTypesQueryOptions(adminApi, tenant.id));

  return (
    <>
      <h1 {...stylex.props(styles.title)}>コンテンツタイプ</h1>
      {contentTypes.length === 0 ? (
        <p {...stylex.props(styles.muted)}>
          コンテンツタイプはまだありません（作成は Phase 6b のビルダーで対応します）
        </p>
      ) : (
        <table {...stylex.props(styles.table)}>
          <thead>
            <tr>
              <th {...stylex.props(styles.cell)}>key</th>
              <th {...stylex.props(styles.cell)}>名前</th>
              <th {...stylex.props(styles.cell)}>フィールド数</th>
              <th {...stylex.props(styles.cell)}>source</th>
              <th {...stylex.props(styles.cell)}>version</th>
            </tr>
          </thead>
          <tbody>
            {contentTypes.map((contentType) => (
              <tr key={contentType.id}>
                <td {...stylex.props(styles.cell)}>{contentType.key}</td>
                <td {...stylex.props(styles.cell)}>{contentType.name}</td>
                <td {...stylex.props(styles.cell)}>{contentType.fields.length}</td>
                <td {...stylex.props(styles.cell)}>{contentType.source}</td>
                <td {...stylex.props(styles.cell)}>{contentType.version}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
```

- [ ] **Step 4: routeTree を再生成してテストを通す**

Run: `pnpm --filter @plyrs/admin build`
Expected: 成功（routeTree.gen.ts に /t/$tenantSlug 系 3 ルートが追加される）

Run: `pnpm --filter @plyrs/admin test`
Expected: PASS（shell 6 tests を含む全件）

Run: `pnpm --filter @plyrs/admin typecheck`
Expected: エラーなし（tenants.tsx を typed Link に戻した上で全体が通ること）

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src
git commit -m "feat: add tenant shell with content type list"
```

---

### Task 14: housekeeping 消化のロードマップ記録 + 全ゲート実測

**Files:**
- Modify: `docs/superpowers/plans/2026-07-12-implementation-roadmap.md`（§10 末尾に消化記録を追記）

**Interfaces:**
- Consumes: Task 1〜6 の実施結果
- Produces: ロードマップ上の記録（Phase 6a 完了時の申し送り本体はマージ工程でコントローラが追記する — このタスクの範囲外）

- [ ] **Step 1: ロードマップ §10 の末尾に消化記録を追記する**

`docs/superpowers/plans/2026-07-12-implementation-roadmap.md` の §10 の最後（「Phase 10 へ: tenant-resolver /
キャッシュ put 失敗の可観測性…」の段落の後）に追加:

```markdown
**Phase 5c housekeeping の消化（2026-07-16、Phase 6a の Task 1〜4 で実施）:**

- `Array#sort` → `toSorted`: src 3 箇所（cache.ts / query.ts）+ テスト 11 箇所を置換（lint warning 0 件）。
- `chunk<T>` の重複解消: `public/sql.ts` の `chunk` / `D1_BIND_CHUNK_SIZE` へ共有化（placeholders 隣）。
- include 経路の二重読み解消: include の対象 ID を `loadFieldRelationIdsForRecords` の結果から導出する
  `collectIncludeTargetIds` を新設し、`expandIncludes` は対象 ID を直接受け取る形へ変更（include.ts に集約）。
- `cache.match` の前段化: 一覧・単体ともクエリ検証（カタログ読込含む）を withEdgeCache の produce 内へ移動。
  キャッシュキーが全クエリパラメータを含む = ヒットは「同一パラメータで過去に 200」の証明、が安全性の根拠。
  ウォームヒット時に投影 D1 を一切読まないことを poisoned binding の回帰テストで固定
  （test/public-cache-order.test.ts）。
- loadCatalog の未知 kind: `isCatalogKind`（projection/payload.ts の `CATALOG_KINDS` 導出）で skip。
  無検査 cast も同時に除去。
- date フィルタ値の書式検証: 書き込み側（metamodel の `z.iso.datetime()` = UTC 'Z' のみ）と同じ書式のみ
  受理し、それ以外は 400（等値比較で決してヒットしない値を D1 まで運ばない）。
- **`unknown_tenant` / `not_found` は統一しない（2026-07-16 裁定）**: slug の打ち間違いと record 不在の
  区別はヘッドレス利用者のデバッグ価値が高く、テナント slug は公開 URL に載る公開情報のため列挙耐性を
  得る利益が薄い。現状の応答を維持して close。
```

- [ ] **Step 2: 全ゲートを実測する**

Run（リポジトリルートで順に。**4 つすべての実出力をレポートに貼ること**）:

```bash
pnpm -r test
pnpm typecheck
pnpm lint
pnpm format:check
```

Expected:
- `pnpm -r test`: 全パッケージ green（api 397+新規 / metamodel 46 / db 13 / sync-protocol 15 / sync-client 62 / ui 新規 / admin 新規）
- `pnpm typecheck`: エラーなし（admin は tsconfig.json + tsconfig.worker.json の 2 本）
- `pnpm lint`: エラー・警告 0 件
- `pnpm format:check`: 差分なし

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/plans/2026-07-12-implementation-roadmap.md
git commit -m "docs: record phase 5c housekeeping outcomes"
```

---

## 手動確認項目（最終報告で列挙する — 自動テストで担保できない面）

1. `pnpm --filter @plyrs/admin dev` で admin + api（auxiliary worker）が起動し、
   signup → テナント作成 → content_type 一覧までブラウザで通ること（`.dev.vars` の
   JWT_SECRET が apps/api に必要）。
2. 画面の見た目（ライト/ダークテーマ、フォーカスリング、レイアウト崩れ）。
3. トークンの先回りリフレッシュ（15 分待つか devtools で確認 — 自動テストは疑似時計で担保済み）。
4. `wrangler deploy` の実機経路（plyrs-api → plyrs-admin の順にデプロイ。service binding の
   解決は本番でのみ実証可能）。6a ではデプロイ自体はスコープ外（gate に含めない）。

## 実行メモ（コントローラ向け）

- ワークツリー作成直後に `git reset --hard main` → `CI=true pnpm install --frozen-lockfile`。
  ただし Task 7 / Task 10 は catalog・workspace 変更で lockfile が変わるため、その時点では
  `CI=true pnpm install`（frozen なし）を使い、更新された pnpm-lock.yaml をコミットに含める。
- Task 10 の生成物 2 点（routeTree.gen.ts / worker-configuration.d.ts）はコミット対象。
  再生成コマンドはそれぞれ `pnpm --filter @plyrs/admin build` / `pnpm --filter @plyrs/admin cf-typegen`。
- 停止条件（コントローラへ即報告）: Task 7 の StyleX カナリア失敗、Task 10 の build 失敗
  （Start SPA + cloudflare plugin + StyleX unplugin の組み合わせ問題）、
  Task 12/13 の routeTree 生成不整合。RC 品目の回避策はサブエージェントが自作しない。
- Phase 6a 完了時の申し送り（ロードマップへの追記）はマージ工程でコントローラが書く。
  最低限含めること: 裁定 6 点の結果、admin の生成物運用（コミット + 再生成コマンド）、
  トークン管理の既知の簡略化（401 時の強制リフレッシュ再試行なし・マージンのみ）、
  Phase 6b への配線契約（RouterContext / スロット語彙 / `/t/$tenantSlug` の tenant コンテキスト、
  ロードマップ §8 の sync-client 配線 5 点は 6b で消化）。

## Self-Review（計画作成時に実施済み）

1. **Spec coverage**: セッション指示のスコープ 5 点 — Task 1=housekeeping（Task 1〜4 + 5/6 は
   admin 前提の API 追加）、apps/admin 新設=Task 10、packages/ui 新設=Task 7〜9、
   ログインフロー=Task 11〜12、認証済みシェル + content_type 一覧=Task 13。スコープ外
   （record 編集・同期接続・publish 操作）はどのタスクにも含めていない。
2. **Placeholder scan**: 「TBD / 後で実装 / 適宜」なし。RC 品目の不確実性は「停止して報告」
   という明示の停止条件として記述（実装の穴埋めではない）。
3. **Type consistency**: `chunk`/`D1_BIND_CHUNK_SIZE`（Task 1→2）、`collectIncludeTargetIds`/
   `expandIncludes(db, tenantId, targetIds)`（Task 2→3）、`GET /auth/tenants` の応答形
   （Task 5→11→12）、`ContentTypeRow` = `ContentTypeSummary` の形（Task 6→11→13）、
   `RouterContext`（Task 10 骨格→12 完全形→13 消費）、`stylexRenderProps`（Task 7→8）、
   `SlotContributions["nav:item"]`（Task 9→12 登録→13 描画）を突き合わせ済み。
