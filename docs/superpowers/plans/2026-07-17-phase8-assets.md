# Phase 8: アセット Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** asset を独立コンテンツ型(システム型)として全テナントへ導入し、Worker 経由アップロード → R2 格納 → 公開ゲート付きバイナリ配信 → snapshotEmbed "value" の凍結埋め込み → メディア関係フィールド UI・本文画像ノード・orphan 検出までを一気通貫で完成させる。

**Architecture:** asset のメタデータは通常の record(型 `asset`、source='system'、DO 初期化時に自動登録)であり、バイナリだけが R2 に住む(design-spec §5 論点E)。アップロードは認証済み Worker 経由 PUT(tenantGate → R2 put → DO の system 書き込み RPC)。公開配信は `/public/v1/:tenantSlug/assets/:assetId` が投影 D1 の存在チェック(= publish 済みゲート)→ R2 → Cache API で返し、DO を起こさない(§8/§12)。record の publish 時に (a) 参照中の未公開 asset を同一トランザクションでカスケード publish し、(b) `snapshotEmbed: "value"` の関係行へ url/alt/寸法等を凍結埋め込みして snapshot → 投影 → 公開 API まで運ぶ(§7 L1+L2、§12.5)。本文画像は mention と同じ attrs 契約のブロックノード(admin/ui の語彙デプロイと同期投入 — ロードマップ §13 の語彙進化制約)。orphan 検出は relations 逆引きの DO RPC + 管理 UI のアセット一覧ルート。

**Tech Stack:** Cloudflare R2(バインディング `ASSETS`)+ miniflare(pool-workers でローカル R2)、Hono、Drizzle(投影 D1 の migration 1 本)、Tiptap v3 カスタム Node、react-aria-components + StyleX、TanStack Form/Query、Vitest + RTL + FakeSocket。

## 裁定事項(2026-07-17 確定・全タスクの前提)

1. **アップロード経路 = Worker 経由 PUT**(tech-selection §4 の保留を確定)。`POST /v1/t/:tenantId/assets?filename=...`(raw body)。tenantGate → サイズ/filename 検証 → R2 put → DO `createAssetRecord`(失敗時は R2 を best-effort 削除)。presigned 直 PUT は不採用(S3 API トークン運用が複雑で miniflare 再現不能)。
2. **asset 型 = システム型 + 改変防御**。`source: 'system'`・固定 ID で DO 初期化時に自動登録(冪等)。`filename / content_type / size / r2_key / width / height` はシステム管理 — クライアント経由の新規作成・変更は DO の beforeWrite フックが拒否。`alt / caption` のみユーザー編集可(alt/caption はアセット内在 — 論点E)。
3. **公開アセット配信 = 作る・公開ゲート付き**。`GET /public/v1/:tenantSlug/assets/:assetId` は投影 D1 に asset record の投影行が存在するときだけ R2 から配信(Cache API 前段・DO 非経由)。管理画面プレビュー用に認証付き `GET /v1/t/:tenantId/assets/:assetId/file` を併設。
4. **snapshotEmbed "value" = asset 限定の固定語彙**。`allowedTypes` がちょうど `["asset"]` の関係でのみ宣言可(それ以外は metamodel の検証エラー)。publish 時に `{url, filename, contentType, alt, width, height}` を snapshot.relations の行へ凍結し、投影 `projected_relations.embed` 列 → 公開 API の fields へインライン(§12.5)。
5. **本文中の画像ノード = Phase 8 で入れる**。ui に `assetImage` ノード(attrs は mention と同型 `{recordType, recordId, label}`、renderHTML は `img[data-type]` + `data-record-*` のコピペ往復契約)。metamodel は語彙非依存で素通し、`extractBodyRelations` が mention と同じ経路で origin='body' へ投影。§13 推奨の「ui 産 doc → extractBodyRelations の attrs キー契約テスト」も同時に消化。
6. **orphan 検出 = UI フィルタ + 使用箇所表示**。管理画面にアセット一覧ルートを新設し「未参照のみ」フィルタ(DO RPC が relations 逆引きで判定)。削除前に参照元 record 一覧を表示(§6 の安全な削除)。
7. **参照 asset の自動 publish(カスケード)**。record の publish 時、参照中(field + body、target_type='asset')の未公開 asset を同一トランザクションで一緒に publish する。unpublish はカスケードしない(他の公開 record が参照中かもしれないため asset は公開のまま残る)。

**スコープ外(再確認):** アセット変換パイプライン(リサイズ・variants — §13 非目標)/ i18n / モジュールシステム / presigned PUT / R2 オブジェクトの GC(孤児バイナリは Phase 10)/ 手動確認バックログの代行。

## Global Constraints

- コミット件名は **50 字以内**(フックには実体が無いためコントローラが手動検査する)。
- `@ts-expect-error` / `any` **禁止**。やむを得ない境界 cast は具体型 + 理由コメント(rpc-unwrap 様式)。
- bare `git stash` / `git stash pop` 禁止。`git add` は**明示パスのみ**(`git add -A` / `git add .` 禁止)。
- コミット前に **`pnpm format` をルートで実行**する(計画スニペットは oxfmt 整形済みとは限らない)。
- node_modules へのシンボリックリンク作成禁止。sandbox 制限に当たったら回避せず停止して報告。
- リンターは oxlint、フォーマッターは oxfmt。`pnpm lint` / `pnpm format:check`(ルート)で警告 0 を維持。
- apps/api は `"lib": ["ES2023"]`(DOM 型混入禁止)。admin は tsconfig 2 本。
- **route のテストファイルを `apps/admin/src/routes/` に置かない**(ルート生成器がルートとして解釈する)。
- **Task 12 は新規ルートを足す** → `apps/admin/src/routeTree.gen.ts` の再生成が必要。`pnpm --filter @plyrs/admin build` は sandbox の EROFS で落ちるため、実装者はルートファイル作成後に **STATUS: NEEDS_CONTEXT で停止**し、コントローラが sandbox 無効で build → 実装者が再開してコミットする(二段方式)。
- 本フェーズは **依存追加なし**(Tiptap は導入済み。lockfile は変わらない)。
- `pnpm --filter X test -- <pattern>` はフィルタにならない。絞り込みは `pnpm --filter X exec vitest run <pattern>`。
- テスト実行はワークスペースルートから。**実出力をレポートに貼る**(要約・改変は重大違反)。
- vitest 末尾の「something prevents Vite server from exiting」は既知ノイズ(exit 0 なら無視)。
- packages/sync-client のテストは Node 環境(本フェーズでは触らない)。
- **AST 契約**: mention ノードは type `"recordMention"`、attrs `{recordType, recordId, label}`。**画像ノードは type `"assetImage"` で attrs は mention と同型**。renderHTML は `data-type` + `data-record-*` 必須(コピペ往復の契約)。
- relation draft キーは `type + "" + id` — **生の制御文字をソースに埋めない**(エスケープ表記)。
- UI 文言は日本語。
- 公開 API のクエリ語彙は本フェーズで**広げない**(`filter[]`/`sort` 不変 → バインド予算 100/クエリの回帰テスト `apps/api/src/public/query.test.ts` は更新不要。アセット配信はパスパラメータのみの新ルート)。

## File Structure(このフェーズで触るファイルの全体像)

```
packages/metamodel/
  src/asset-type.ts                                # 新規: ASSET_TYPE_KEY/ID/DEFINITION/システム管理キー (Task 1)
  src/asset-type.test.ts                           # 新規 (Task 1)
  src/field-types.ts                               # snapshotEmbed "value" の asset 限定検証 (Task 1)
  src/field-types.test.ts                          # 追記 (Task 1)
  src/body-relations.ts                            # ASSET_IMAGE_NODE_TYPE + 抽出対象へ追加 (Task 1)
  src/body-relations.test.ts                       # 追記 (Task 1)
  src/index.ts                                     # export 追加 (Task 1)
apps/api/
  src/do/ensure-asset-type.ts                      # 新規: システム asset 型の自動登録 (Task 2)
  src/do/content-types.ts                          # registerContentTypeCore の system ガード (Task 2)
  src/tenant-do.ts                                 # ensure 呼び出し / createAssetRecord / publish 署名変更 /
                                                   # orphan・usage RPC (Task 2, 3, 6, 9)
  src/do/hooks.ts                                  # BeforeWriteContext.systemWrite (Task 3)
  src/do/asset-guard.ts                            # 新規: assetGuardHook (Task 3)
  src/do/write-record.ts                           # フック追加 + WriteOptions (Task 3)
  src/assets/image-size.ts                         # 新規: 画像寸法スニファ純関数 (Task 4)
  src/assets/image-size.test.ts                    # 新規 (Task 4)
  wrangler.jsonc                                   # r2_buckets: ASSETS (Task 5)
  env.d.ts                                         # ASSETS: R2Bucket (Task 5)
  vitest.config.ts                                 # miniflare r2Buckets (Task 5)
  src/routes/tenant.ts                             # upload / preview / orphans / usage ルート +
                                                   # DELETE の R2 掃除 + publish の slug 解決 (Task 5, 6, 9)
  src/do/publish.ts                                # カスケード publish + embed 凍結 (Task 6)
  src/projection/payload.ts                        # AssetEmbed 型 + ProjectionRelationRow.embed (Task 6)
  src/do/asset-usage.ts                            # 新規: orphan/usage クエリ (Task 9)
  src/rpc-unwrap.ts                                # asOrphanIds / asAssetUsage (Task 9)
  src/projection/consumer.ts                       # projected_relations へ embed を書く (Task 7)
  src/public/include.ts                            # embed 込みの関係値を fields へ (Task 7)
  src/routes/public.ts                             # 公開アセット配信ルート (Task 8)
  test/asset-type.test.ts                          # 新規: 自動登録 + system ガード (Task 2)
  test/asset-guard.test.ts                         # 新規: 改変防御 + createAssetRecord (Task 3)
  test/asset-upload.test.ts                        # 新規: upload/preview/R2 掃除 e2e (Task 5)
  test/publish.test.ts                             # 追記: カスケード + embed 凍結(+ 署名更新) (Task 6)
  test/asset-projection.test.ts                    # 新規: embed の投影・公開 API e2e (Task 7)
  test/asset-public.test.ts                        # 新規: 公開配信ゲート (Task 8)
  test/asset-usage.test.ts                         # 新規: orphan / usage (Task 9)
packages/db/
  src/projection.ts                                # projected_relations.embed 列 (Task 7)
  src/projection.test.ts                           # 追記 (Task 7)
  drizzle-projection/0004_*.sql                    # 生成 migration (Task 7)
packages/ui/
  src/asset-image.ts                               # 新規: assetImage ノード (Task 10)
  src/asset-image.test.ts                          # 新規 (Task 10)
  src/rich-text-editor.tsx                         # 画像ボタン + resolver + ノード登録 (Task 10)
  src/rich-text-editor.test.tsx                    # 追記 (Task 10)
  src/index.ts                                     # export 追加 (Task 10)
apps/admin/
  src/lib/admin-api.ts                             # uploadAsset / fetchAssetBlob / orphan / usage / delete (Task 11)
  src/lib/admin-api.test.ts                        # 追記 (Task 11)
  src/lib/asset-services.ts                        # 新規: upload + objectURL キャッシュ (Task 11)
  src/lib/asset-services.test.ts                   # 新規 (Task 11)
  src/lib/queries.ts                               # orphan / usage queryOptions (Task 11)
  src/components/asset-thumb.tsx                   # 新規: サムネイル (Task 12)
  src/routes/t/$tenantSlug/assets/index.tsx        # 新規ルート: アセット一覧 (Task 12)
  src/routeTree.gen.ts                             # 再生成(コントローラ二段方式) (Task 12)
  src/router.tsx                                   # nav:item「アセット」 (Task 12)
  src/components/asset-picker.tsx                  # 新規: 選択ダイアログ + メディア関係フィールド (Task 13)
  src/components/record-form.tsx                   # AssetRelationPicker 分岐 / readonly / 画像挿入配線 (Task 13)
  src/components/record-form.test.tsx              # 追記 (Task 13)
  src/lib/content-type-form.ts                     # FieldDraft.embedValue (Task 13)
  src/lib/content-type-form.test.ts                # 追記 (Task 13)
  src/components/content-type-form.tsx             # snapshotEmbed チェックボックス (Task 13)
  src/routes/t/$tenantSlug/records/$typeKey/new.tsx        # assets prop 配線 (Task 13)
  src/routes/t/$tenantSlug/records/$typeKey/$recordId.tsx  # assets prop 配線 (Task 13)
  src/lib/mention-contract.test.ts                 # 画像ノード名 + attrs キー契約 (Task 14)
  src/asset-flow.test.tsx                          # 新規: FakeSocket ワイヤレベル一式 (Task 14)
docs/superpowers/plans/2026-07-12-implementation-roadmap.md  # §3 行更新(計画コミット時)・申し送り(マージ後)
```

**タスク依存関係:** Task 1 → 2 → 3(metamodel → DO 基盤)。Task 4 は独立。Task 5 は 3, 4 に依存。Task 6 は 2 に依存(1 の snapshotEmbed 検証も前提)。Task 7 は 6。Task 8 は 7(投影に embed 列が要る訳ではないが e2e の前提を共有)・5(R2)。Task 9 は 2。Task 10 は 1(ノード名契約)。Task 11 は 5(HTTP 契約)。Task 12 は 11。Task 13 は 10, 11, 12。Task 14 は 10, 13。Task 15 は最後。並列レーン: (1→2→3→5) と 4 と (10) は同時進行可。6→7→8 は直列。

---

### Task 1: metamodel — asset 型定数・snapshotEmbed "value" の asset 限定検証・assetImage 抽出

**Files:**
- Create: `packages/metamodel/src/asset-type.ts`
- Create: `packages/metamodel/src/asset-type.test.ts`
- Modify: `packages/metamodel/src/field-types.ts`
- Modify: `packages/metamodel/src/body-relations.ts`
- Modify: `packages/metamodel/src/index.ts`
- Test: `packages/metamodel/src/field-types.test.ts`(追記)、`packages/metamodel/src/body-relations.test.ts`(追記)

**Interfaces:**
- Consumes: 既存の `contentTypeDefinitionSchema` / `ContentTypeDefinition`(content-type.ts)、`RECORD_MENTION_NODE_TYPE` / `extractBodyRelations`(body-relations.ts)、`uuidSchema`(ids.ts)。
- Produces: `ASSET_TYPE_KEY = "asset"`、`ASSET_TYPE_ID`(固定 UUID)、`ASSET_TYPE_DEFINITION: ContentTypeDefinition`、`ASSET_SYSTEM_MANAGED_FIELD_KEYS: readonly string[]`、`ASSET_IMAGE_NODE_TYPE = "assetImage"`。relationFieldSchema は `snapshotEmbed: "value"` を `allowedTypes === ["asset"]` に限定する。`extractBodyRelations` は assetImage ノードからも参照を抽出する。Task 2/3/6(api)・Task 10(ui)・Task 13/14(admin)がこれらを使う。

- [ ] **Step 1: 失敗するテストを書く(asset-type)**

`packages/metamodel/src/asset-type.test.ts` を新規作成:

```ts
import { describe, expect, it } from "vitest";
import { contentTypeDefinitionSchema } from "./content-type";
import {
  ASSET_SYSTEM_MANAGED_FIELD_KEYS,
  ASSET_TYPE_DEFINITION,
  ASSET_TYPE_ID,
  ASSET_TYPE_KEY,
} from "./asset-type";

describe("ASSET_TYPE_DEFINITION (Phase 8 裁定 2)", () => {
  it("is a valid system content type definition", () => {
    const parsed = contentTypeDefinitionSchema.safeParse(ASSET_TYPE_DEFINITION);
    expect(parsed.success).toBe(true);
    expect(ASSET_TYPE_DEFINITION.key).toBe(ASSET_TYPE_KEY);
    expect(ASSET_TYPE_DEFINITION.id).toBe(ASSET_TYPE_ID);
    expect(ASSET_TYPE_DEFINITION.source).toBe("system");
  });

  it("declares every system-managed key as a field", () => {
    const fieldKeys = ASSET_TYPE_DEFINITION.fields.map((field) => field.key);
    for (const key of ASSET_SYSTEM_MANAGED_FIELD_KEYS) {
      expect(fieldKeys).toContain(key);
    }
    // alt / caption はユーザー編集可のためシステム管理キーに含めない(論点E)
    expect(ASSET_SYSTEM_MANAGED_FIELD_KEYS).not.toContain("alt");
    expect(ASSET_SYSTEM_MANAGED_FIELD_KEYS).not.toContain("caption");
  });

  it("requires the storage-critical fields", () => {
    const required = ASSET_TYPE_DEFINITION.fields
      .filter((field) => field.required === true)
      .map((field) => field.key);
    expect(required.toSorted()).toEqual(["content_type", "filename", "r2_key", "size"]);
  });
});
```

- [ ] **Step 2: 失敗を確認**

Run: `pnpm --filter @plyrs/metamodel exec vitest run asset-type`
Expected: FAIL(`./asset-type` が存在しない)

- [ ] **Step 3: asset-type.ts を実装**

`packages/metamodel/src/asset-type.ts` を新規作成:

```ts
import type { ContentTypeDefinition } from "./content-type";

// design-spec §5 論点E: アセットは独立コンテンツ型。実体は R2 オブジェクト + このメタデータ
// record であり、alt / caption はアセット内在(文脈依存にしない)。
export const ASSET_TYPE_KEY = "asset";

// 全テナント共通の固定 ID(DO 初期化時の自動登録が使う)。乱数由来ではない予約値だが、
// uuidSchema(小文字 UUID 形式)を満たす(version nibble 7 / variant nibble 8)。
export const ASSET_TYPE_ID = "00000000-0000-7000-8000-00000000a55e";

// システム管理フィールド: アップロード API(DO の system 書き込み)だけが書ける。
// クライアント経由(同期 push / HTTP writeRecord)の新規作成・変更は assetGuardHook が拒否する。
export const ASSET_SYSTEM_MANAGED_FIELD_KEYS = [
  "filename",
  "content_type",
  "size",
  "r2_key",
  "width",
  "height",
] as const;

export const ASSET_TYPE_DEFINITION: ContentTypeDefinition = {
  id: ASSET_TYPE_ID,
  key: ASSET_TYPE_KEY,
  name: "アセット",
  source: "system",
  // version はサーバー管理(registerContentTypeCore が採番)。スキーマが positive int を
  // 要求するため 1 を運ぶだけ。
  version: 1,
  fields: [
    { key: "filename", type: "text", required: true, config: { maxLength: 256 } },
    { key: "content_type", type: "text", required: true, config: { maxLength: 256 } },
    { key: "size", type: "number", required: true, config: { integer: true } },
    { key: "r2_key", type: "text", required: true, config: { maxLength: 512 } },
    { key: "width", type: "number", config: { integer: true } },
    { key: "height", type: "number", config: { integer: true } },
    { key: "alt", type: "text", config: { maxLength: 1024 } },
    { key: "caption", type: "text", config: { maxLength: 2048 } },
  ],
};
```

- [ ] **Step 4: asset-type テストが通ることを確認**

Run: `pnpm --filter @plyrs/metamodel exec vitest run asset-type`
Expected: PASS(3 tests)

- [ ] **Step 5: 失敗するテストを書く(snapshotEmbed の asset 限定)**

`packages/metamodel/src/field-types.test.ts` の末尾に追記:

```ts
describe('relation snapshotEmbed "value" (Phase 8 裁定 4: asset 限定の固定語彙)', () => {
  const relation = (config: Record<string, unknown>) => ({
    key: "media",
    type: "relation",
    config,
  });

  it('accepts "value" when allowedTypes is exactly ["asset"]', () => {
    const parsed = fieldDefinitionSchema.safeParse(
      relation({ allowedTypes: ["asset"], cardinality: "many", snapshotEmbed: "value" }),
    );
    expect(parsed.success).toBe(true);
  });

  it('rejects "value" for non-asset or mixed allowedTypes (L1 規律を型レベルで保証)', () => {
    expect(
      fieldDefinitionSchema.safeParse(
        relation({ allowedTypes: ["author"], cardinality: "one", snapshotEmbed: "value" }),
      ).success,
    ).toBe(false);
    expect(
      fieldDefinitionSchema.safeParse(
        relation({ allowedTypes: ["asset", "author"], cardinality: "many", snapshotEmbed: "value" }),
      ).success,
    ).toBe(false);
  });

  it('still accepts "id" for any allowedTypes', () => {
    const parsed = fieldDefinitionSchema.safeParse(
      relation({ allowedTypes: ["author"], cardinality: "one", snapshotEmbed: "id" }),
    );
    expect(parsed.success).toBe(true);
  });
});
```

- [ ] **Step 6: 失敗を確認**

Run: `pnpm --filter @plyrs/metamodel exec vitest run field-types`
Expected: FAIL(`rejects "value" for non-asset ...` が false を期待して true)

- [ ] **Step 7: relationFieldSchema に superRefine を追加**

`packages/metamodel/src/field-types.ts` — import に追加:

```ts
import { ASSET_TYPE_KEY } from "./asset-type";
```

`relationFieldSchema` を次で置き換え:

```ts
export const relationFieldSchema = z
  .strictObject({
    ...baseFieldShape,
    type: z.literal("relation"),
    config: z.strictObject({
      allowedTypes: z.array(z.string().min(1)).min(1),
      cardinality: z.enum(["one", "many"]),
      ordered: z.boolean().optional(),
      snapshotEmbed: z.enum(["id", "value"]).optional(),
    }),
  })
  .superRefine((field, ctx) => {
    // Phase 8 裁定 4: "value" は asset 限定の固定語彙。埋め込むのは実質不変値のみという
    // L1 規律(design-spec §7)を、宣言の時点で型レベルに固定する。
    if (
      field.config.snapshotEmbed === "value" &&
      !(field.config.allowedTypes.length === 1 && field.config.allowedTypes[0] === ASSET_TYPE_KEY)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["config", "snapshotEmbed"],
        message: 'snapshotEmbed "value" is only allowed when allowedTypes is exactly ["asset"]',
      });
    }
  });
```

> 循環 import の注意: asset-type.ts は content-type.ts から **type-only import** しかしない
> (`import type { ContentTypeDefinition }`)ため、field-types → asset-type → content-type →
> field-types の実行時循環は発生しない。`import type` を通常 import に変えないこと。

- [ ] **Step 8: 成功を確認**

Run: `pnpm --filter @plyrs/metamodel exec vitest run field-types`
Expected: PASS

- [ ] **Step 9: 失敗するテストを書く(assetImage 抽出)**

`packages/metamodel/src/body-relations.test.ts` の末尾に追記(既存テストの import に `ASSET_IMAGE_NODE_TYPE` を足す。既存の contentType フィクスチャに richtext フィールド `body` がある前提 — 無ければ同ファイル既存の様式に合わせて作る):

```ts
describe("assetImage ノードの抽出 (Phase 8 裁定 5)", () => {
  const contentTypeWithBody: ContentTypeDefinition = {
    id: "018f2b6a-7a0a-7000-8000-0000000000aa",
    key: "article",
    name: "記事",
    source: "user",
    version: 1,
    fields: [{ key: "body", type: "richtext" }],
  };
  const assetId = "018f2b6a-7a0a-7000-8000-0000000000ab";
  const mentionId = "018f2b6a-7a0a-7000-8000-0000000000ac";

  it("extracts asset references from assetImage nodes (mention と同じ attrs 契約)", () => {
    const data = {
      body: {
        schemaVersion: 1,
        doc: {
          type: "doc",
          content: [
            {
              type: ASSET_IMAGE_NODE_TYPE,
              attrs: { recordType: "asset", recordId: assetId, label: "hero.png" },
            },
            {
              type: "paragraph",
              content: [
                {
                  type: RECORD_MENTION_NODE_TYPE,
                  attrs: { recordType: "author", recordId: mentionId, label: "山田" },
                },
              ],
            },
          ],
        },
      },
    };
    expect(extractBodyRelations(contentTypeWithBody, data)).toEqual([
      {
        fieldKey: "body",
        refs: [
          { type: "asset", id: assetId },
          { type: "author", id: mentionId },
        ],
      },
    ]);
  });

  it("dedupes the same asset referenced by image and mention", () => {
    const data = {
      body: {
        schemaVersion: 1,
        doc: {
          type: "doc",
          content: [
            {
              type: ASSET_IMAGE_NODE_TYPE,
              attrs: { recordType: "asset", recordId: assetId, label: "hero.png" },
            },
            {
              type: "paragraph",
              content: [
                {
                  type: RECORD_MENTION_NODE_TYPE,
                  attrs: { recordType: "asset", recordId: assetId, label: "hero.png" },
                },
              ],
            },
          ],
        },
      },
    };
    const writes = extractBodyRelations(contentTypeWithBody, data);
    expect(writes[0]?.refs).toEqual([{ type: "asset", id: assetId }]);
  });

  it("skips assetImage nodes with malformed attrs (防御的読み)", () => {
    const data = {
      body: {
        schemaVersion: 1,
        doc: {
          type: "doc",
          content: [{ type: ASSET_IMAGE_NODE_TYPE, attrs: { recordId: "not-a-uuid" } }],
        },
      },
    };
    expect(extractBodyRelations(contentTypeWithBody, data)).toEqual([]);
  });
});
```

- [ ] **Step 10: 失敗を確認**

Run: `pnpm --filter @plyrs/metamodel exec vitest run body-relations`
Expected: FAIL(`ASSET_IMAGE_NODE_TYPE` が未定義)

- [ ] **Step 11: body-relations.ts を拡張**

`packages/metamodel/src/body-relations.ts` — `RECORD_MENTION_NODE_TYPE` 定義の直後に追加し、`collectMentionRefs` の判定を差し替える:

```ts
// 本文中の画像埋め込みノードの型名。packages/ui の ASSET_IMAGE_NODE_NAME と一致すること
// (apps/admin/src/lib/mention-contract.test.ts が両者の一致を固定する)。attrs は mention と
// 同型 {recordType, recordId, label} — 抽出経路を 1 本に保つための Phase 8 裁定 5。
export const ASSET_IMAGE_NODE_TYPE = "assetImage";

const BODY_REFERENCE_NODE_TYPES: readonly string[] = [
  RECORD_MENTION_NODE_TYPE,
  ASSET_IMAGE_NODE_TYPE,
];
```

`collectMentionRefs` 内の判定 `if (node.type === RECORD_MENTION_NODE_TYPE) {` を:

```ts
  if (BODY_REFERENCE_NODE_TYPES.includes(node.type)) {
```

に変更する(関数名・その他は不変。`mentionAttrsSchema` は両ノード共通の契約なのでそのまま使う)。

- [ ] **Step 12: index.ts に export を追加**

`packages/metamodel/src/index.ts` — body-relations の export 節に `ASSET_IMAGE_NODE_TYPE` を足し、末尾に asset-type の export を追加:

```ts
export {
  ASSET_IMAGE_NODE_TYPE,
  RECORD_MENTION_NODE_TYPE,
  extractBodyRelations,
  type BodyRelationWrite,
} from "./body-relations";
export {
  ASSET_SYSTEM_MANAGED_FIELD_KEYS,
  ASSET_TYPE_DEFINITION,
  ASSET_TYPE_ID,
  ASSET_TYPE_KEY,
} from "./asset-type";
```

- [ ] **Step 13: metamodel 全テストが通ることを確認**

Run: `pnpm --filter @plyrs/metamodel test`
Expected: PASS(既存 56 + 追加分。全 green)

- [ ] **Step 14: format + commit**

```bash
pnpm format
git add packages/metamodel/src/asset-type.ts packages/metamodel/src/asset-type.test.ts packages/metamodel/src/field-types.ts packages/metamodel/src/field-types.test.ts packages/metamodel/src/body-relations.ts packages/metamodel/src/body-relations.test.ts packages/metamodel/src/index.ts
git commit -m "feat: add asset type model to metamodel"
```

---

### Task 2: api DO — システム asset 型の自動登録と registerContentType の system ガード

**Files:**
- Create: `apps/api/src/do/ensure-asset-type.ts`
- Modify: `apps/api/src/do/content-types.ts`
- Modify: `apps/api/src/tenant-do.ts`
- Test: `apps/api/test/asset-type.test.ts`(新規)

**Interfaces:**
- Consumes: `ASSET_TYPE_DEFINITION` / `ASSET_TYPE_ID`(@plyrs/metamodel、Task 1)、`loadContentTypeByKey` / `registerContentTypeCore`(do/content-types.ts)、`loadAllContentTypes`(sync/records.ts)。
- Produces: `ensureAssetContentType(sql: SqlStorage, now: string): boolean`(変更があったとき true)。`registerContentTypeCore(sql, input, now, options?: { allowSystem?: boolean })` — options 無しの呼び出しでは `source: 'system'` の登録・既存 system 行の変更を `forbidden` で拒否。TenantDO は構築時に ensure を呼び、変更時は content-types を broadcast する。

- [ ] **Step 1: 失敗するテストを書く**

`apps/api/test/asset-type.test.ts` を新規作成(既存の `apps/api/test/` のテストと同じ様式で書く — `import { env } from "cloudflare:test"` と DO スタブ取得、`asContentTypeRow` / `asRegisterResult` を使う。既存テストファイル(例: `apps/api/test/publish.test.ts` 冒頭)を開いてスタブ取得ヘルパーの形を合わせること):

```ts
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { ASSET_TYPE_DEFINITION, ASSET_TYPE_ID, ASSET_TYPE_KEY } from "@plyrs/metamodel";
import { asContentTypeRow, asRegisterResult } from "../src/rpc-unwrap";
import type { AuthContext } from "../src/do/authorize";

const OWNER: AuthContext = { userId: "u-owner", role: "owner" };

function stub(name: string) {
  return env.TENANT_DO.get(env.TENANT_DO.idFromName(name));
}

describe("システム asset 型の自動登録 (Phase 8 裁定 2)", () => {
  it("registers the asset type on DO construction", async () => {
    const tenant = stub("asset-type-auto");
    const row = asContentTypeRow(await tenant.getContentType(ASSET_TYPE_KEY));
    expect(row).not.toBeNull();
    expect(row?.id).toBe(ASSET_TYPE_ID);
    expect(row?.source).toBe("system");
    expect(row?.fields).toEqual(ASSET_TYPE_DEFINITION.fields);
    expect(row?.version).toBe(1);
  });

  it("is idempotent: a second wake does not bump the version", async () => {
    const tenant = stub("asset-type-idempotent");
    const first = asContentTypeRow(await tenant.getContentType(ASSET_TYPE_KEY));
    // ping で RPC を往復させても(同一インスタンス内)version が動かないことを確認する。
    // 完全な再構築の冪等性は ensureAssetContentType 自体の分岐(定義一致なら no-op)が担う。
    await tenant.ping();
    const second = asContentTypeRow(await tenant.getContentType(ASSET_TYPE_KEY));
    expect(second?.version).toBe(first?.version);
  });
});

describe("registerContentType の system ガード (Phase 8 改変防御の第一層)", () => {
  it("rejects registering a type with source 'system' via the RPC", async () => {
    const tenant = stub("asset-type-guard-1");
    const result = asRegisterResult(
      await tenant.registerContentType(
        { ...ASSET_TYPE_DEFINITION, key: "fake_system", id: "00000000-0000-7000-8000-00000000a55f" },
        OWNER,
      ),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("forbidden");
    }
  });

  it("rejects overwriting the existing system asset type via the RPC", async () => {
    const tenant = stub("asset-type-guard-2");
    const result = asRegisterResult(
      await tenant.registerContentType(
        { ...ASSET_TYPE_DEFINITION, source: "user", name: "乗っ取り" },
        OWNER,
      ),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("forbidden");
    }
  });
});
```

- [ ] **Step 2: 失敗を確認**

Run: `pnpm --filter @plyrs/api exec vitest run test/asset-type`
Expected: FAIL(asset 型が未登録で `row` が null / forbidden ではなく ok が返る)

- [ ] **Step 3: ensure-asset-type.ts を実装**

`apps/api/src/do/ensure-asset-type.ts` を新規作成:

```ts
import { ASSET_TYPE_DEFINITION, ASSET_TYPE_ID } from "@plyrs/metamodel";
import { loadContentTypeByKey, registerContentTypeCore } from "./content-types";

// Phase 8 裁定 2: asset はシステム型として全テナントへ自動登録する。DO の構築ごと
// (blockConcurrencyWhile 内)に呼ばれるため冪等が必須 — 定義が一致していれば何もしない。
// 定義を進化させるときは ASSET_TYPE_DEFINITION を変えるだけでよい(次に DO が起きた時に
// registerContentTypeCore が version をサーバー管理で進める)。
export function ensureAssetContentType(sql: SqlStorage, now: string): boolean {
  const existing = loadContentTypeByKey(sql, ASSET_TYPE_DEFINITION.key);
  if (existing !== null && existing.id !== ASSET_TYPE_ID) {
    // Phase 8 以前にユーザーが key='asset' の型を作っていたテナント。throw すると DO が
    // 永久に起動不能(テナント全損)になるため、自動登録を断念して既存機能を守る。
    // このテナントではアセット機能が使えない — 申し送りに記録済み(手動移行が必要)。
    console.error("content type key 'asset' is taken by a non-system type; skip registration");
    return false;
  }
  if (
    existing !== null &&
    existing.name === ASSET_TYPE_DEFINITION.name &&
    JSON.stringify(existing.fields) === JSON.stringify(ASSET_TYPE_DEFINITION.fields)
  ) {
    return false;
  }
  const result = registerContentTypeCore(sql, ASSET_TYPE_DEFINITION, now, { allowSystem: true });
  if (!result.ok) {
    // 固定定義はスキーマ検証を常に通る。落ちるのは実装バグだけなので隠さない。
    throw new Error(`asset content type registration failed: ${result.message}`);
  }
  return true;
}
```

- [ ] **Step 4: registerContentTypeCore に system ガードを追加**

`apps/api/src/do/content-types.ts` — `registerContentTypeCore` のシグネチャと冒頭を変更:

```ts
export function registerContentTypeCore(
  sql: SqlStorage,
  input: unknown,
  now: string,
  options: { allowSystem?: boolean } = {},
): RegisterContentTypeResult {
  const parsed = contentTypeDefinitionSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: "validation_failed", message: issuesToMessage(parsed.error.issues) };
  }
  const def = parsed.data;
  const prev = loadContentTypeByKey(sql, def.key);
  // Phase 8: システム型はコード配布(ensureAssetContentType)だけが書ける。クライアント経由の
  // 登録・変更を許すと、r2_key 等のシステム管理フィールド定義を挿げ替えて配信を壊せてしまう
  // (フィールド値の防御 = assetGuardHook とは別レイヤーの、型定義そのものの防御)。
  if (options.allowSystem !== true && (def.source === "system" || prev?.source === "system")) {
    return {
      ok: false,
      code: "forbidden",
      message: "system content types are managed by the platform",
    };
  }
  if (prev !== null && prev.id !== def.id) {
```

(以降は既存のまま。`if (prev !== null && prev.id !== def.id)` 以下は変更しない。)

- [ ] **Step 5: TenantDO の構築時に ensure を呼ぶ**

`apps/api/src/tenant-do.ts` — import に追加:

```ts
import { ensureAssetContentType } from "./do/ensure-asset-type";
```

constructor の `blockConcurrencyWhile` 内、`await migrate(this.db, migrations);` の直後に挿入:

```ts
      // Phase 8 裁定 2: システム asset 型を自動登録(冪等)。Phase 8 デプロイ以前から存在する
      // テナントも、次に DO が起きた時点でここを通って型を得る。変更があった時だけ、
      // hibernation 復帰で生きているソケットへ型カタログを配り直す(registerContentType RPC の
      // broadcast と同じ契約 — G1: content_types は seq を消費しない別チャネル)。
      const assetTypeChanged = ensureAssetContentType(
        ctx.storage.sql,
        new Date().toISOString(),
      );
      if (assetTypeChanged) {
        this.broadcastAll({
          type: "content-types",
          contentTypes: loadAllContentTypes(ctx.storage.sql),
        });
      }
```

- [ ] **Step 6: テストが通ることを確認**

Run: `pnpm --filter @plyrs/api exec vitest run test/asset-type`
Expected: PASS(4 tests)

- [ ] **Step 7: 既存テストへの影響を確認**

Run: `pnpm --filter @plyrs/api test`
Expected: PASS。**注意**: 既存テストに「content_types が空である」ことや `listContentTypes()` の件数を前提にしたものがあれば、asset 型が常に 1 件先に存在するようになったことで落ちる。落ちたテストは「既存・無関係」と報告せず原因を特定し、期待値を asset 型込みに更新する(例: 件数 +1、`contentTypes[0]` が `asset` になる等)。sync 系(welcome の contentTypes)も同様。

- [ ] **Step 8: format + commit**

```bash
pnpm format
git add apps/api/src/do/ensure-asset-type.ts apps/api/src/do/content-types.ts apps/api/src/tenant-do.ts apps/api/test/asset-type.test.ts
git commit -m "feat: auto-register system asset content type"
```

(Step 7 で既存テストの期待値を更新した場合は、そのファイルも明示パスで add する。)

---

### Task 3: api DO — assetGuardHook(改変防御)と createAssetRecord RPC

**Files:**
- Create: `apps/api/src/do/asset-guard.ts`
- Modify: `apps/api/src/do/hooks.ts`
- Modify: `apps/api/src/do/write-record.ts`
- Modify: `apps/api/src/tenant-do.ts`
- Test: `apps/api/test/asset-guard.test.ts`(新規)。既存の `apps/api/src/do/hooks.test.ts` / unique-check 系テストの `BeforeWriteContext` 構築箇所に `systemWrite: false` を追加。

**Interfaces:**
- Consumes: `ASSET_TYPE_KEY` / `ASSET_SYSTEM_MANAGED_FIELD_KEYS`(@plyrs/metamodel)、`BeforeWriteHook` / `HookRejection`(do/hooks.ts)、`writeRecordCore`(do/write-record.ts)。
- Produces: `assetGuardHook: BeforeWriteHook`。`BeforeWriteContext` に `systemWrite: boolean` 追加。`HookRejection.code` は `Extract<WriteErrorCode, "unique_violation" | "forbidden">` に拡張。`writeRecordCore(deps, contentType, params, options?: { systemWrite?: boolean })`。TenantDO に `createAssetRecord(params: WriteRecordInput, auth: AuthContext): WriteRecordResult`(system 書き込み経路。Task 5 のアップロード API が呼ぶ)。

- [ ] **Step 1: 失敗するテストを書く**

`apps/api/test/asset-guard.test.ts` を新規作成:

```ts
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { v7 as uuidv7 } from "uuid";
import { ASSET_TYPE_KEY } from "@plyrs/metamodel";
import { asWriteResult } from "../src/rpc-unwrap";
import type { AuthContext } from "../src/do/authorize";

const OWNER: AuthContext = { userId: "u-owner", role: "owner" };

function stub(name: string) {
  return env.TENANT_DO.get(env.TENANT_DO.idFromName(name));
}

function assetInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    filename: "hero.png",
    content_type: "image/png",
    size: 1234,
    r2_key: "t1/asset-1",
    width: 800,
    height: 600,
    ...overrides,
  };
}

describe("asset の改変防御 (Phase 8 裁定 2: assetGuardHook)", () => {
  it("createAssetRecord (system write) creates an asset record", async () => {
    const tenant = stub("asset-guard-create");
    const id = uuidv7();
    const result = asWriteResult(
      await tenant.createAssetRecord({ recordId: id, input: assetInput() }, OWNER),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.record.type).toBe(ASSET_TYPE_KEY);
      expect(result.record.data["r2_key"]).toBe("t1/asset-1");
    }
  });

  it("rejects creating an asset record via the client write path", async () => {
    const tenant = stub("asset-guard-client-create");
    const result = asWriteResult(
      await tenant.writeRecord(ASSET_TYPE_KEY, { recordId: uuidv7(), input: assetInput() }, OWNER),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("forbidden");
    }
  });

  it("rejects client edits to system-managed fields but allows alt/caption", async () => {
    const tenant = stub("asset-guard-edit");
    const id = uuidv7();
    const created = asWriteResult(
      await tenant.createAssetRecord({ recordId: id, input: assetInput() }, OWNER),
    );
    expect(created.ok).toBe(true);

    // alt / caption の編集は許可(ユーザー編集可 — 論点E)
    const altEdit = asWriteResult(
      await tenant.writeRecord(
        ASSET_TYPE_KEY,
        { recordId: id, input: assetInput({ alt: "ヒーロー画像", caption: "見出し" }) },
        OWNER,
      ),
    );
    expect(altEdit.ok).toBe(true);

    // r2_key の挿げ替えは拒否
    const hijack = asWriteResult(
      await tenant.writeRecord(
        ASSET_TYPE_KEY,
        {
          recordId: id,
          input: assetInput({ alt: "ヒーロー画像", caption: "見出し", r2_key: "t1/other" }),
        },
        OWNER,
      ),
    );
    expect(hijack.ok).toBe(false);
    if (!hijack.ok) {
      expect(hijack.code).toBe("forbidden");
      expect(hijack.message).toContain("r2_key");
    }
  });

  it("rejects dropping a system-managed optional field (width) via the client path", async () => {
    const tenant = stub("asset-guard-drop");
    const id = uuidv7();
    asWriteResult(await tenant.createAssetRecord({ recordId: id, input: assetInput() }, OWNER));
    const { width: _width, ...withoutWidth } = assetInput();
    const result = asWriteResult(
      await tenant.writeRecord(ASSET_TYPE_KEY, { recordId: id, input: withoutWidth }, OWNER),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("forbidden");
    }
  });

  it("status-only changes on assets pass the guard (LWW 経路を塞がない)", async () => {
    const tenant = stub("asset-guard-status");
    const id = uuidv7();
    asWriteResult(await tenant.createAssetRecord({ recordId: id, input: assetInput() }, OWNER));
    const result = asWriteResult(
      await tenant.writeRecord(
        ASSET_TYPE_KEY,
        { recordId: id, input: assetInput(), status: "ready" },
        OWNER,
      ),
    );
    expect(result.ok).toBe(true);
  });
});
```

- [ ] **Step 2: 失敗を確認**

Run: `pnpm --filter @plyrs/api exec vitest run test/asset-guard`
Expected: FAIL(`createAssetRecord` が存在しない)

- [ ] **Step 3: hooks.ts に systemWrite を追加**

`apps/api/src/do/hooks.ts`:

```ts
export interface BeforeWriteContext {
  contentType: ContentTypeRow;
  recordId: string;
  data: Record<string, unknown>;
  prev: RecordSnapshot | null;
  sql: SqlStorage;
  // Phase 8: サーバー内部の書き込み(アップロード API 経由の createAssetRecord)は true。
  // クライアント由来(同期 push / HTTP writeRecord)は false — assetGuardHook が参照する。
  systemWrite: boolean;
}

export type HookRejection = {
  code: Extract<WriteErrorCode, "unique_violation" | "forbidden">;
  message: string;
};
```

(`runBeforeWriteHooks` は変更なし。既存の hooks.test.ts / unique-check テストで `BeforeWriteContext` を構築している箇所に `systemWrite: false` を追加して型を合わせる。)

- [ ] **Step 4: asset-guard.ts を実装**

`apps/api/src/do/asset-guard.ts` を新規作成:

```ts
import { ASSET_SYSTEM_MANAGED_FIELD_KEYS, ASSET_TYPE_KEY } from "@plyrs/metamodel";
import type { BeforeWriteHook } from "./hooks";

// Phase 8 裁定 2: asset のシステム管理フィールドはアップロード API(systemWrite)だけが書ける。
// クライアント書き込みは (a) 新規作成そのもの、(b) システム管理フィールドの変更、を拒否する。
// alt / caption / status はここを素通りする(ユーザー編集可・ワークフロー軸)。
// 値の比較は JSON 文字列(draft 層と同じ手法): 対象は text/number のスカラーなので十分。
export const assetGuardHook: BeforeWriteHook = (ctx) => {
  if (ctx.contentType.key !== ASSET_TYPE_KEY || ctx.contentType.source !== "system") {
    return null;
  }
  if (ctx.systemWrite) {
    return null;
  }
  if (ctx.prev === null) {
    return {
      code: "forbidden",
      message: "asset records can only be created via the upload API",
    };
  }
  for (const key of ASSET_SYSTEM_MANAGED_FIELD_KEYS) {
    if (JSON.stringify(ctx.data[key]) !== JSON.stringify(ctx.prev.data[key])) {
      return { code: "forbidden", message: `asset field '${key}' is system-managed` };
    }
  }
  return null;
};
```

- [ ] **Step 5: write-record.ts にフックと options を配線**

`apps/api/src/do/write-record.ts` — import に `assetGuardHook` を追加し:

```ts
import { assetGuardHook } from "./asset-guard";
```

フック配列を差し替え(ガードを先に走らせる — 認可系の拒否を unique 検証より前に):

```ts
const systemBeforeWriteHooks: readonly BeforeWriteHook[] = [assetGuardHook, uniqueCheckHook];
```

`writeRecordCore` のシグネチャに options を追加:

```ts
export interface WriteOptions {
  systemWrite?: boolean;
}

export function writeRecordCore(
  deps: WriteDeps,
  contentType: ContentTypeRow,
  params: WriteRecordParams,
  options: WriteOptions = {},
): WriteRecordResult {
```

`runBeforeWriteHooks` 呼び出しの ctx に追加:

```ts
  const rejection = runBeforeWriteHooks(systemBeforeWriteHooks, {
    contentType,
    recordId: params.recordId,
    data: change.data,
    prev,
    sql: deps.sql,
    systemWrite: options.systemWrite === true,
  });
```

- [ ] **Step 6: TenantDO に createAssetRecord を追加**

`apps/api/src/tenant-do.ts` — import に `ASSET_TYPE_KEY`(@plyrs/metamodel)を追加し、`writeRecord` メソッドの直後に:

```ts
  // Phase 8 裁定 1: asset record の作成・システム管理フィールドの書き込みはアップロード API
  // 専用の経路。writeRecord と同じコアを systemWrite で通す(assetGuardHook だけが免除される —
  // unique 検証や validate-on-write は同じに掛かる)。
  createAssetRecord(params: WriteRecordInput, auth: AuthContext): WriteRecordResult {
    const denial = requireOperation(auth, "record:write");
    if (denial !== null) {
      return denial;
    }
    const contentType = loadContentTypeByKey(this.ctx.storage.sql, ASSET_TYPE_KEY);
    if (contentType === null) {
      return { ok: false, code: "unknown_type", message: "asset type is not registered" };
    }
    const result = this.ctx.storage.transactionSync(() =>
      writeRecordCore(
        {
          sql: this.ctx.storage.sql,
          nextSeq: () => ++this.seq,
          now: () => new Date().toISOString(),
          newRelationId: () => uuidv7(),
        },
        contentType,
        { ...params, actor: auth.userId },
        { systemWrite: true },
      ),
    );
    if (result.ok && result.applied) {
      const stored = loadSyncRecord(this.ctx.storage.sql, params.recordId);
      if (stored !== null) {
        this.broadcastAll({ type: "change", record: stored });
      }
    }
    return result;
  }
```

- [ ] **Step 7: テストが通ることを確認**

Run: `pnpm --filter @plyrs/api exec vitest run test/asset-guard`
Expected: PASS(5 tests)

Run: `pnpm --filter @plyrs/api test`
Expected: PASS(hooks.test.ts 等の `systemWrite: false` 追加漏れがあれば typecheck/実行で露見する — 直す)。

**複数フック短絡の回帰(Phase 2 申し送りの消化):** `apps/api/src/do/hooks.test.ts` に「先頭フックが拒否したら後続フックが呼ばれない」テストが無ければ追記する:

```ts
it("stops at the first rejecting hook (短絡)", () => {
  const calls: string[] = [];
  const reject: BeforeWriteHook = () => {
    calls.push("first");
    return { code: "forbidden", message: "no" };
  };
  const never: BeforeWriteHook = () => {
    calls.push("second");
    return null;
  };
  const rejection = runBeforeWriteHooks([reject, never], baseContext());
  expect(rejection?.code).toBe("forbidden");
  expect(calls).toEqual(["first"]);
});
```

(`baseContext()` は同ファイル既存のコンテキスト生成に合わせる。無ければ最小の `BeforeWriteContext` リテラルを組む。)

- [ ] **Step 8: format + commit**

```bash
pnpm format
git add apps/api/src/do/asset-guard.ts apps/api/src/do/hooks.ts apps/api/src/do/write-record.ts apps/api/src/tenant-do.ts apps/api/test/asset-guard.test.ts apps/api/src/do/hooks.test.ts
git commit -m "feat: guard asset system fields in DO write path"
```

---

### Task 4: api — 画像寸法スニファ(純関数)

**Files:**
- Create: `apps/api/src/assets/image-size.ts`
- Test: `apps/api/src/assets/image-size.test.ts`(新規)

**Interfaces:**
- Consumes: なし(依存ゼロの純関数)。
- Produces: `sniffImageSize(bytes: Uint8Array): { width: number; height: number } | null`。マジックバイトで PNG / JPEG / GIF / WebP(VP8 / VP8L / VP8X)を判定し、非対応形式・壊れたバイト列は null。Task 5 のアップロード API が width/height の導出に使う(クライアント申告値は信用しない — システム管理フィールドの防御と整合)。

- [ ] **Step 1: 失敗するテストを書く**

`apps/api/src/assets/image-size.test.ts` を新規作成(pool-workers 上でも純関数テストはそのまま走る):

```ts
import { describe, expect, it } from "vitest";
import { sniffImageSize } from "./image-size";

// フィクスチャは実画像ではなく、各形式の寸法ヘッダ部分だけを手組みする(スニファは
// 先頭バイトしか読まないため十分)。
function bytes(...parts: (number[] | Uint8Array)[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part instanceof Uint8Array ? part : Uint8Array.from(part), offset);
    offset += part.length;
  }
  return out;
}

const ascii = (text: string) => [...text].map((ch) => ch.charCodeAt(0));

describe("sniffImageSize", () => {
  it("reads PNG IHDR dimensions (big endian)", () => {
    const png = bytes(
      [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], // signature
      [0x00, 0x00, 0x00, 0x0d], // IHDR length
      ascii("IHDR"),
      [0x00, 0x00, 0x03, 0x20], // width 800
      [0x00, 0x00, 0x02, 0x58], // height 600
      [0x08, 0x06, 0x00, 0x00, 0x00], // bit depth ほか(読まない)
    );
    expect(sniffImageSize(png)).toEqual({ width: 800, height: 600 });
  });

  it("reads JPEG SOF0 dimensions, skipping APP segments", () => {
    const jpeg = bytes(
      [0xff, 0xd8], // SOI
      [0xff, 0xe0, 0x00, 0x04, 0x00, 0x00], // APP0(length 4 = 中身 2 バイト)
      [0xff, 0xc0, 0x00, 0x0b], // SOF0, length 11
      [0x08], // precision
      [0x02, 0x58], // height 600
      [0x03, 0x20], // width 800
      [0x03, 0x01, 0x22, 0x00], // components(読まない)
    );
    expect(sniffImageSize(jpeg)).toEqual({ width: 800, height: 600 });
  });

  it("does not mistake DHT (0xC4) for a SOF marker", () => {
    const jpeg = bytes(
      [0xff, 0xd8],
      [0xff, 0xc4, 0x00, 0x04, 0x00, 0x00], // DHT(スキップされるべき)
      [0xff, 0xc2, 0x00, 0x0b, 0x08], // SOF2(progressive)
      [0x00, 0x64], // height 100
      [0x00, 0xc8], // width 200
      [0x03, 0x01, 0x22, 0x00],
    );
    expect(sniffImageSize(jpeg)).toEqual({ width: 200, height: 100 });
  });

  it("reads GIF logical screen dimensions (little endian)", () => {
    const gif = bytes(ascii("GIF89a"), [0x20, 0x03], [0x58, 0x02], [0x00, 0x00, 0x00]);
    expect(sniffImageSize(gif)).toEqual({ width: 800, height: 600 });
  });

  it("reads WebP VP8X canvas dimensions", () => {
    const webp = bytes(
      ascii("RIFF"),
      [0x20, 0x00, 0x00, 0x00],
      ascii("WEBP"),
      ascii("VP8X"),
      [0x0a, 0x00, 0x00, 0x00], // chunk size 10
      [0x00, 0x00, 0x00, 0x00], // flags + reserved
      [0x1f, 0x03, 0x00], // width-1 = 799
      [0x57, 0x02, 0x00], // height-1 = 599
    );
    expect(sniffImageSize(webp)).toEqual({ width: 800, height: 600 });
  });

  it("reads WebP lossy (VP8) frame dimensions", () => {
    const webp = bytes(
      ascii("RIFF"),
      [0x20, 0x00, 0x00, 0x00],
      ascii("WEBP"),
      ascii("VP8 "),
      [0x10, 0x00, 0x00, 0x00], // chunk size
      [0x00, 0x00, 0x00], // frame tag(読まない)
      [0x9d, 0x01, 0x2a], // start code
      [0x20, 0x03], // width 800 (14bit LE)
      [0x58, 0x02], // height 600
    );
    expect(sniffImageSize(webp)).toEqual({ width: 800, height: 600 });
  });

  it("reads WebP lossless (VP8L) dimensions", () => {
    // width-1=799 (14bit), height-1=599 (14bit) を LSB からパックした 32bit 値:
    // v = 799 | (599 << 14) = 0x0095c31f → bytes LE: 1f c3 95 00
    const webp = bytes(
      ascii("RIFF"),
      [0x20, 0x00, 0x00, 0x00],
      ascii("WEBP"),
      ascii("VP8L"),
      [0x10, 0x00, 0x00, 0x00],
      [0x2f], // signature
      [0x1f, 0xc3, 0x95, 0x00],
    );
    expect(sniffImageSize(webp)).toEqual({ width: 800, height: 600 });
  });

  it("returns null for unknown or truncated input", () => {
    expect(sniffImageSize(Uint8Array.from(ascii("plain text")))).toBeNull();
    expect(sniffImageSize(new Uint8Array(0))).toBeNull();
    expect(sniffImageSize(Uint8Array.from([0x89, 0x50]))).toBeNull(); // PNG 先頭だけ
    expect(sniffImageSize(Uint8Array.from([0xff, 0xd8, 0xff]))).toBeNull(); // JPEG 断片
  });
});
```

- [ ] **Step 2: 失敗を確認**

Run: `pnpm --filter @plyrs/api exec vitest run image-size`
Expected: FAIL(`./image-size` が存在しない)

- [ ] **Step 3: image-size.ts を実装**

`apps/api/src/assets/image-size.ts` を新規作成:

```ts
// アップロード時に画像の寸法をサーバー側で導出する(クライアント申告値は信用しない —
// width/height は asset のシステム管理フィールド)。マジックバイト判定なので Content-Type
// ヘッダにも依存しない。対応: PNG / JPEG / GIF / WebP。非対応・壊れた入力は null
// (寸法なしの asset として保存される — 画像以外のファイルの正常系)。
export interface ImageSize {
  width: number;
  height: number;
}

function u16be(bytes: Uint8Array, offset: number): number {
  // 呼び出し元が境界チェック済み。noUncheckedIndexedAccess のため ?? 0 で畳む
  return ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0);
}

function u16le(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8);
}

function u32be(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] ?? 0) << 24) |
    ((bytes[offset + 1] ?? 0) << 16) |
    ((bytes[offset + 2] ?? 0) << 8) |
    (bytes[offset + 3] ?? 0)
  );
}

function u24le(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8) | ((bytes[offset + 2] ?? 0) << 16);
}

function matches(bytes: Uint8Array, offset: number, expected: string): boolean {
  if (bytes.length < offset + expected.length) {
    return false;
  }
  for (let i = 0; i < expected.length; i += 1) {
    if (bytes[offset + i] !== expected.charCodeAt(i)) {
      return false;
    }
  }
  return true;
}

function sniffPng(bytes: Uint8Array): ImageSize | null {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 24 || signature.some((byte, i) => bytes[i] !== byte)) {
    return null;
  }
  if (!matches(bytes, 12, "IHDR")) {
    return null;
  }
  return { width: u32be(bytes, 16), height: u32be(bytes, 20) };
}

function sniffJpeg(bytes: Uint8Array): ImageSize | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return null;
  }
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      return null; // マーカー境界が壊れている
    }
    const marker = bytes[offset + 1] ?? 0;
    if (marker === 0xff) {
      offset += 1; // パディング
      continue;
    }
    // SOF0-15(C0-CF)のうち DHT(C4)/JPG(C8)/DAC(CC) はフレームヘッダではない
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { width: u16be(bytes, offset + 7), height: u16be(bytes, offset + 5) };
    }
    if (marker === 0xda || marker === 0xd9) {
      return null; // SOS/EOI まで来たら SOF は現れない
    }
    offset += 2 + u16be(bytes, offset + 2);
  }
  return null;
}

function sniffGif(bytes: Uint8Array): ImageSize | null {
  if (!(matches(bytes, 0, "GIF87a") || matches(bytes, 0, "GIF89a")) || bytes.length < 10) {
    return null;
  }
  return { width: u16le(bytes, 6), height: u16le(bytes, 8) };
}

function sniffWebp(bytes: Uint8Array): ImageSize | null {
  // 長さの下限は形式ごとに異なるため、読み出しは ?? 0 畳み(u16le/u24le)と matches の
  // 境界チェックに任せ、ここではコンテナ判定のみ行う。
  if (!matches(bytes, 0, "RIFF") || !matches(bytes, 8, "WEBP")) {
    return null;
  }
  // 最初のチャンク(offset 12)だけを見る。VP8X が無い単純形式は VP8 / VP8L が先頭に来る。
  const data = 20; // チャンク FourCC(12..16) + サイズ(16..20) の直後
  if (matches(bytes, 12, "VP8X")) {
    if (bytes.length < data + 10) {
      return null;
    }
    return {
      width: u24le(bytes, data + 4) + 1,
      height: u24le(bytes, data + 7) + 1,
    };
  }
  if (matches(bytes, 12, "VP8 ")) {
    // 3 バイトのフレームタグの後に start code 9D 01 2A、続いて 14bit LE の寸法
    if (bytes[data + 3] !== 0x9d || bytes[data + 4] !== 0x01 || bytes[data + 5] !== 0x2a) {
      return null;
    }
    return {
      width: u16le(bytes, data + 6) & 0x3fff,
      height: u16le(bytes, data + 8) & 0x3fff,
    };
  }
  if (matches(bytes, 12, "VP8L")) {
    if (bytes[data] !== 0x2f || bytes.length < data + 5) {
      return null;
    }
    // 寸法は signature 直後の 32bit LE 値に LSB からパックされている
    const packed =
      (bytes[data + 1] ?? 0) |
      ((bytes[data + 2] ?? 0) << 8) |
      ((bytes[data + 3] ?? 0) << 16) |
      ((bytes[data + 4] ?? 0) << 24);
    return {
      width: (packed & 0x3fff) + 1,
      height: ((packed >>> 14) & 0x3fff) + 1,
    };
  }
  return null;
}

export function sniffImageSize(bytes: Uint8Array): ImageSize | null {
  return sniffPng(bytes) ?? sniffJpeg(bytes) ?? sniffGif(bytes) ?? sniffWebp(bytes);
}
```

- [ ] **Step 4: 成功を確認**

Run: `pnpm --filter @plyrs/api exec vitest run image-size`
Expected: PASS(8 tests)

- [ ] **Step 5: format + commit**

```bash
pnpm format
git add apps/api/src/assets/image-size.ts apps/api/src/assets/image-size.test.ts
git commit -m "feat: add image dimension sniffer"
```

---

### Task 5: api — R2 バインディング・アップロード API・管理プレビュー配信・削除時の R2 掃除

**Files:**
- Modify: `apps/api/wrangler.jsonc`
- Modify: `apps/api/env.d.ts`
- Modify: `apps/api/vitest.config.ts`
- Modify: `apps/api/src/routes/tenant.ts`
- Test: `apps/api/test/asset-upload.test.ts`(新規)

**Interfaces:**
- Consumes: `sniffImageSize`(Task 4)、`createAssetRecord` RPC(Task 3)、`ASSET_TYPE_KEY`(@plyrs/metamodel)、既存の `tenantGate` / `stubFor` / `asWriteResult` / `asDeleteResult`(routes/tenant.ts)。
- Produces: バインディング `ASSETS: R2Bucket`。HTTP 契約(admin の service binding プロキシ `/v1` に乗る):
  - `POST /v1/t/:tenantId/assets?filename=<name>`(raw body、Content-Type ヘッダ = MIME)→ 201 `{ok: true, record, changedFields, applied}`(WriteRecordResult)。エラー: 400 `invalid_filename` / `empty_body`、413 `too_large`。
  - `GET /v1/t/:tenantId/assets/:assetId/file` → 200 バイナリ(認証付きプレビュー)/ 404。
  - `DELETE /v1/t/:tenantId/records/:recordId` は asset のとき R2 オブジェクトを best-effort 削除(応答形は不変)。
  - R2 キー規約: `${tenantId}/${assetId}`。**バイナリは不変**(差し替え無し — 置き換えたいときは新しい asset を作る。凍結 URL・キャッシュの安全性の根拠)。

- [ ] **Step 1: バインディングを追加**

`apps/api/wrangler.jsonc` — `kv_namespaces` の後に追加:

```jsonc
  "r2_buckets": [
    // Phase 8 裁定 1: アセットのバイナリ。キーは `${tenantId}/${assetId}`(バイナリは不変 —
    // 差し替えは新しい asset として作る。凍結 URL / キャッシュ安全性の根拠)。
    { "binding": "ASSETS", "bucket_name": "plyrs-assets" },
  ],
```

`apps/api/env.d.ts` — `EnvBindings` に追加:

```ts
  // Phase 8: アセットのバイナリ(R2)。メタデータは各テナント DO の asset record
  ASSETS: R2Bucket;
```

`apps/api/vitest.config.ts` — miniflare 設定に追加(pool-workers は wrangler configPath からも拾うが、既存の明示 bindings と同じ場所に揃えて宣言しておく):

```ts
        miniflare: {
          r2Buckets: ["ASSETS"],
          bindings: {
            TEST_MIGRATIONS: migrations,
            TEST_PROJECTION_MIGRATIONS: projectionMigrations,
            JWT_SECRET: "test-secret-do-not-use-in-prod",
          },
        },
```

- [ ] **Step 2: 失敗するテストを書く**

`apps/api/test/asset-upload.test.ts` を新規作成。**認証まわりの様式は既存の HTTP e2e テスト(`apps/api/test/` の tenantGate を通しているファイル、例えば publication や records の HTTP テスト)を開いて合わせること**(JWT の発行ヘルパーがあるはず)。以下はハンドラ呼び出しの本体(`app.request` + 有効な Bearer トークン取得済みの前提で書く):

```ts
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { ASSET_TYPE_KEY } from "@plyrs/metamodel";
import { app } from "../src/index";
// トークン発行ヘルパーは既存テストの様式に合わせる(このファイル内で signup/login を
// HTTP で行うか、既存の共有ヘルパーを import する)。以下では authHeaders(tenantId) が
// { authorization: "Bearer <有効な JWT>" } を返すものとする。

const PNG_HEADER = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x03, 0x20, 0x00, 0x00, 0x02, 0x58, 0x08, 0x06, 0x00, 0x00, 0x00,
]);

describe("アセットのアップロードとプレビュー (Phase 8 裁定 1, 3)", () => {
  it("uploads a binary, creates the asset record, and stores the R2 object", async () => {
    const { tenantId, headers } = await setupTenant();
    const response = await app.request(
      `/v1/t/${tenantId}/assets?filename=hero.png`,
      { method: "POST", headers: { ...headers, "content-type": "image/png" }, body: PNG_HEADER },
      env,
    );
    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      ok: true;
      record: { id: string; type: string; data: Record<string, unknown> };
    };
    expect(body.record.type).toBe(ASSET_TYPE_KEY);
    expect(body.record.data["filename"]).toBe("hero.png");
    expect(body.record.data["content_type"]).toBe("image/png");
    expect(body.record.data["size"]).toBe(PNG_HEADER.byteLength);
    expect(body.record.data["width"]).toBe(800);
    expect(body.record.data["height"]).toBe(600);
    expect(body.record.data["r2_key"]).toBe(`${tenantId}/${body.record.id}`);

    const stored = await env.ASSETS.get(`${tenantId}/${body.record.id}`);
    expect(stored).not.toBeNull();
  });

  it("rejects a missing filename and an empty body", async () => {
    const { tenantId, headers } = await setupTenant();
    const noName = await app.request(
      `/v1/t/${tenantId}/assets`,
      { method: "POST", headers, body: PNG_HEADER },
      env,
    );
    expect(noName.status).toBe(400);
    const empty = await app.request(
      `/v1/t/${tenantId}/assets?filename=a.bin`,
      { method: "POST", headers, body: new Uint8Array(0) },
      env,
    );
    expect(empty.status).toBe(400);
  });

  it("rejects a body over the size limit with 413", async () => {
    const { tenantId, headers } = await setupTenant();
    const huge = new Uint8Array(20 * 1024 * 1024 + 1);
    const response = await app.request(
      `/v1/t/${tenantId}/assets?filename=big.bin`,
      { method: "POST", headers, body: huge },
      env,
    );
    expect(response.status).toBe(413);
  });

  it("serves the authenticated preview and 404s for unknown assets", async () => {
    const { tenantId, headers } = await setupTenant();
    const upload = await app.request(
      `/v1/t/${tenantId}/assets?filename=hero.png`,
      { method: "POST", headers: { ...headers, "content-type": "image/png" }, body: PNG_HEADER },
      env,
    );
    const { record } = (await upload.json()) as { record: { id: string } };

    const preview = await app.request(
      `/v1/t/${tenantId}/assets/${record.id}/file`,
      { headers },
      env,
    );
    expect(preview.status).toBe(200);
    expect(preview.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await preview.arrayBuffer())).toEqual(PNG_HEADER);

    const missing = await app.request(
      `/v1/t/${tenantId}/assets/018f2b6a-7a0a-7000-8000-00000000dead/file`,
      { headers },
      env,
    );
    expect(missing.status).toBe(404);
  });

  it("deletes the R2 object when the asset record is deleted over HTTP", async () => {
    const { tenantId, headers } = await setupTenant();
    const upload = await app.request(
      `/v1/t/${tenantId}/assets?filename=hero.png`,
      { method: "POST", headers: { ...headers, "content-type": "image/png" }, body: PNG_HEADER },
      env,
    );
    const { record } = (await upload.json()) as { record: { id: string } };

    const del = await app.request(
      `/v1/t/${tenantId}/records/${record.id}`,
      { method: "DELETE", headers },
      env,
    );
    expect(del.status).toBe(200);
    expect(await env.ASSETS.get(`${tenantId}/${record.id}`)).toBeNull();
  });
});
```

(`setupTenant()` は「signup → tenant 作成 → token 取得」を行い `{ tenantId, headers }` を返すローカルヘルパー。既存 HTTP テストのボイラープレートを再利用して書く。既存に共有ヘルパーがあればそれを使う。)

- [ ] **Step 3: 失敗を確認**

Run: `pnpm --filter @plyrs/api exec vitest run test/asset-upload`
Expected: FAIL(404 — ルート未実装)

- [ ] **Step 4: ルートを実装**

`apps/api/src/routes/tenant.ts` — import を追加:

```ts
import { ASSET_TYPE_KEY } from "@plyrs/metamodel";
import { v7 as uuidv7 } from "uuid";
import { sniffImageSize } from "../assets/image-size";
```

定数をファイル上部(`writeBodySchema` の近く)に追加:

```ts
// Phase 8 裁定 1: Worker 経由 PUT。CMS の画像用途に十分な上限(動画等の大容量は非目標)。
const MAX_ASSET_SIZE_BYTES = 20 * 1024 * 1024;
const MAX_ASSET_FILENAME_LENGTH = 256;
```

`tenantRoutes` のチェーンに、`.put("/:tenantId/records/...")` の**前**(tenantGate の `use` より後)へ 2 ルートを追加:

```ts
  .post("/:tenantId/assets", async (c) => {
    const filename = c.req.query("filename") ?? "";
    if (filename.length === 0 || filename.length > MAX_ASSET_FILENAME_LENGTH) {
      return c.json({ error: "invalid_filename" }, 400);
    }
    // Content-Length を先に見て巨大 body の読み込み自体を避ける(fail fast)。
    const declared = Number(c.req.header("content-length") ?? "");
    if (Number.isFinite(declared) && declared > MAX_ASSET_SIZE_BYTES) {
      return c.json({ error: "too_large" }, 413);
    }
    const body = await c.req.arrayBuffer();
    if (body.byteLength === 0) {
      return c.json({ error: "empty_body" }, 400);
    }
    if (body.byteLength > MAX_ASSET_SIZE_BYTES) {
      return c.json({ error: "too_large" }, 413);
    }
    const contentType = c.req.header("content-type") ?? "application/octet-stream";
    const tenantId = c.req.param("tenantId");
    // ID はサーバー生成(uuidv7)。r2_key は `${tenantId}/${assetId}` 規約 — バイナリは不変
    // (差し替えは新しい asset)。寸法はサーバー側スニファで導出(クライアント申告を信用しない)。
    const assetId = uuidv7();
    const r2Key = `${tenantId}/${assetId}`;
    const size = sniffImageSize(new Uint8Array(body));
    await c.env.ASSETS.put(r2Key, body);
    const result = asWriteResult(
      await stubFor(c).createAssetRecord(
        {
          recordId: assetId,
          input: {
            filename,
            content_type: contentType.slice(0, MAX_ASSET_FILENAME_LENGTH),
            size: body.byteLength,
            r2_key: r2Key,
            ...(size === null ? {} : { width: size.width, height: size.height }),
          },
        },
        c.get("auth"),
      ),
    );
    if (!result.ok) {
      // メタデータ作成に失敗したバイナリは孤児になるため片付ける(best-effort —
      // 失敗した孤児は Phase 10 の R2 GC 候補)。
      try {
        await c.env.ASSETS.delete(r2Key);
      } catch {
        console.error("orphan R2 object left behind", r2Key);
      }
      return c.json(result, statusFor(result.code));
    }
    return c.json(result, 201);
  })
  // 管理画面のプレビュー配信(認証付き)。未 publish の asset を表示するための経路で、
  // 公開配信(/public/v1/.../assets/:assetId — Task 8)とはゲートが違う。
  .get("/:tenantId/assets/:assetId/file", async (c) => {
    const record = asRecordSnapshot(await stubFor(c).getRecord(c.req.param("assetId")));
    if (record === null || record.deletedAt !== null || record.type !== ASSET_TYPE_KEY) {
      return c.json({ error: "not_found" }, 404);
    }
    const r2Key = record.data["r2_key"];
    if (typeof r2Key !== "string") {
      return c.json({ error: "not_found" }, 404);
    }
    const object = await c.env.ASSETS.get(r2Key);
    if (object === null) {
      return c.json({ error: "not_found" }, 404);
    }
    const contentType = record.data["content_type"];
    return new Response(object.body, {
      headers: {
        "content-type": typeof contentType === "string" ? contentType : "application/octet-stream",
        "cache-control": "private, no-store",
        // ユーザー投稿バイナリを同一オリジンで inline 表示するための封じ込め(SVG 内スクリプト等)
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'; sandbox",
      },
    });
  })
```

既存の DELETE ルートを差し替え(asset の R2 掃除):

```ts
  .delete("/:tenantId/records/:recordId", async (c) => {
    const result = asDeleteResult(
      await stubFor(c).deleteRecord(c.req.param("recordId"), c.get("auth")),
    );
    // Phase 8: asset の削除はバイナリも片付ける(best-effort — 失敗した孤児は Phase 10 の
    // GC 候補。同期 push 経由の削除はここを通らないため孤児が残る — 申し送りに記録済み)。
    if (result.ok && result.record.type === ASSET_TYPE_KEY) {
      const r2Key = result.record.data["r2_key"];
      if (typeof r2Key === "string") {
        try {
          await c.env.ASSETS.delete(r2Key);
        } catch {
          console.error("failed to delete R2 object for asset", result.record.id);
        }
      }
    }
    return result.ok ? c.json(result) : c.json(result, statusFor(result.code));
  })
```

**ルート登録順の注意**: `GET /:tenantId/assets/:assetId/file` は Task 9 の `GET /:tenantId/assets/orphans` より**後方一致が狭い**が、Hono は登録順で解決するため、Task 9 実装時に `orphans` を `:assetId` 系より**先に**登録すること(このタスクの時点では衝突しない)。

- [ ] **Step 5: 成功を確認**

Run: `pnpm --filter @plyrs/api exec vitest run test/asset-upload`
Expected: PASS(5 tests)

Run: `pnpm --filter @plyrs/api test`
Expected: PASS(全体 green — wrangler.jsonc の変更で miniflare が R2 を持つようになったことによる既存テストへの影響はない)

- [ ] **Step 6: format + commit**

```bash
pnpm format
git add apps/api/wrangler.jsonc apps/api/env.d.ts apps/api/vitest.config.ts apps/api/src/routes/tenant.ts apps/api/test/asset-upload.test.ts
git commit -m "feat: asset upload and preview over R2"
```

---

### Task 6: api DO — publish のカスケードと snapshotEmbed "value" の凍結埋め込み

**Files:**
- Modify: `apps/api/src/projection/payload.ts`
- Modify: `apps/api/src/do/publish.ts`
- Modify: `apps/api/src/tenant-do.ts`
- Modify: `apps/api/src/routes/tenant.ts`
- Test: `apps/api/test/publish.test.ts`(追記 + 既存呼び出しの署名更新)。他ファイルの `publishRecord(` 呼び出しも一括更新。

**Interfaces:**
- Consumes: `ASSET_TYPE_KEY`(@plyrs/metamodel)、`loadRecord`(do/write-record.ts)、`loadContentTypeByKey`(do/content-types.ts)、既存の `enqueueOutbox` / `loadRelationRows`。
- Produces:
  - `AssetEmbed { url; filename; contentType; alt; width; height }`(projection/payload.ts)
  - `ProjectionRelationRow.embed?: AssetEmbed | null`(optional — 旧 snapshot の JSON には無い)
  - `publishRecordCore(deps, recordId, actor, tenantSlug: string)`(カスケード + 凍結)
  - RPC 署名変更: `TenantDO.publishRecord(tenantId, tenantSlug, recordId, auth)`
  - publish HTTP ルートはコントロールプレーン D1 から slug を解決して渡す。
  - 凍結 URL の形: `/public/v1/${tenantSlug}/assets/${assetId}`(Task 8 の公開ルートと一致)。**テナント slug は実質不変**という前提に立つ(rename API は存在しない。導入時はこの凍結 URL の再訪が必要 — 申し送り)。

- [ ] **Step 1: 失敗するテストを書く**

`apps/api/test/publish.test.ts` の末尾に追記(同ファイル既存のスタブ取得・auth・型登録ヘルパーの様式に合わせる。以下では `stub(name)` / `OWNER` / 型登録に使う `registerContentType` 呼び出しは既存様式を再利用する):

```ts
describe("publish のアセット統合 (Phase 8 裁定 4, 7)", () => {
  const mediaArticleType = {
    id: "018f2b6a-7a0a-7000-8000-00000000c001",
    key: "media_article",
    name: "メディア記事",
    source: "user",
    version: 1,
    fields: [
      { key: "title", type: "text", required: true },
      {
        key: "hero",
        type: "relation",
        config: { allowedTypes: ["asset"], cardinality: "one", snapshotEmbed: "value" },
      },
      { key: "body", type: "richtext" },
    ],
  };

  async function setupArticleWithAsset(name: string) {
    const tenant = stub(name);
    const registered = asRegisterResult(await tenant.registerContentType(mediaArticleType, OWNER));
    expect(registered.ok).toBe(true);
    const assetId = uuidv7();
    const created = asWriteResult(
      await tenant.createAssetRecord(
        {
          recordId: assetId,
          input: {
            filename: "hero.png",
            content_type: "image/png",
            size: 100,
            r2_key: `${name}/${assetId}`,
            width: 800,
            height: 600,
            alt: "ヒーロー",
          },
        },
        OWNER,
      ),
    );
    expect(created.ok).toBe(true);
    const articleId = uuidv7();
    const written = asWriteResult(
      await tenant.writeRecord(
        "media_article",
        {
          recordId: articleId,
          input: { title: "記事", hero: { type: "asset", id: assetId } },
        },
        OWNER,
      ),
    );
    expect(written.ok).toBe(true);
    return { tenant, assetId, articleId };
  }

  it("cascades publish to referenced unpublished assets in the same transaction", async () => {
    const { tenant, assetId, articleId } = await setupArticleWithAsset("publish-cascade");
    const result = asPublishResult(
      await tenant.publishRecord("publish-cascade", "blog", articleId, OWNER),
    );
    expect(result.ok).toBe(true);
    const assetPublication = asPublicationState(await tenant.getPublication(assetId));
    expect(assetPublication.published).toBe(true);
    // outbox には記事と asset の 2 ジョブが積まれている(排出済みなら pendingOutbox は 0 でも
    // よい — 投影ペイロードが両方取れることを確認する)
    expect(await tenant.getProjectionPayload(assetId)).not.toBeNull();
    expect(await tenant.getProjectionPayload(articleId)).not.toBeNull();
  });

  it("freezes the asset embed on snapshotEmbed value relations", async () => {
    const { tenant, assetId, articleId } = await setupArticleWithAsset("publish-embed");
    const result = asPublishResult(
      await tenant.publishRecord("publish-embed", "blog", articleId, OWNER),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const heroRow = result.snapshot.relations.find((row) => row.sourceField === "hero");
    expect(heroRow?.embed).toEqual({
      url: `/public/v1/blog/assets/${assetId}`,
      filename: "hero.png",
      contentType: "image/png",
      alt: "ヒーロー",
      width: 800,
      height: 600,
    });
  });

  it("does not republish an already-published asset (publish_seq が進まない)", async () => {
    const { tenant, assetId, articleId } = await setupArticleWithAsset("publish-no-repub");
    asPublishResult(await tenant.publishRecord("publish-no-repub", "blog", assetId, OWNER));
    const before = await tenant.getProjectionPayload(assetId);
    asPublishResult(await tenant.publishRecord("publish-no-repub", "blog", articleId, OWNER));
    const after = await tenant.getProjectionPayload(assetId);
    expect(after?.publishSeq).toBe(before?.publishSeq);
  });

  it("dangling asset references freeze embed: null (ソフト参照)", async () => {
    const tenant = stub("publish-dangling");
    asRegisterResult(await tenant.registerContentType(mediaArticleType, OWNER));
    const articleId = uuidv7();
    asWriteResult(
      await tenant.writeRecord(
        "media_article",
        {
          recordId: articleId,
          input: {
            title: "記事",
            hero: { type: "asset", id: "018f2b6a-7a0a-7000-8000-00000000dead" },
          },
        },
        OWNER,
      ),
    );
    const result = asPublishResult(
      await tenant.publishRecord("publish-dangling", "blog", articleId, OWNER),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const heroRow = result.snapshot.relations.find((row) => row.sourceField === "hero");
    expect(heroRow?.embed).toBeNull();
  });
});
```

- [ ] **Step 2: 失敗を確認**

Run: `pnpm --filter @plyrs/api exec vitest run test/publish`
Expected: FAIL(publishRecord の引数個数不一致で typecheck 段階から落ちる — それで良い)

- [ ] **Step 3: payload.ts に AssetEmbed を追加**

`apps/api/src/projection/payload.ts` — `ProjectionRelationRow` の直前に追加し、行型に embed を足す:

```ts
// Phase 8 裁定 4: snapshotEmbed "value" の凍結埋め込み(asset 限定の固定語彙)。
// publish 時点の asset record から凍結し、以後 asset 側の変更には追従しない
// (L1: 埋め込むのは実質不変値のみ / L2: 古くなったら記事を再 publish — design-spec §7)。
export interface AssetEmbed {
  url: string;
  filename: string;
  contentType: string;
  alt: string | null;
  width: number | null;
  height: number | null;
}

export interface ProjectionRelationRow {
  sourceField: string;
  targetType: string;
  targetId: string;
  ordinal: number;
  origin: string; // 'field' | 'body'
  // Phase 8 より前の snapshot の JSON には存在しないため optional。null = 凍結対象だったが
  // 参照先が dangling(素の ID 参照として投影される)。
  embed?: AssetEmbed | null;
}
```

- [ ] **Step 4: publish.ts を再構成**

`apps/api/src/do/publish.ts` — import を追加:

```ts
import { ASSET_TYPE_KEY } from "@plyrs/metamodel";
import type { RecordSnapshot } from "./types";
import type { AssetEmbed } from "../projection/payload";
```

`publishRecordCore` を次で置き換え(既存の snapshot INSERT + enqueueOutbox 部分は `writeSnapshot` ヘルパーへ抽出):

```ts
// snapshot の作成 + outbox 投入(publish の物理部分)。カスケードでも記事本体でも同じ経路。
function writeSnapshot(
  deps: PublishDeps,
  record: RecordSnapshot,
  relations: ProjectionRelationRow[],
  actor: string,
): PublishedSnapshot {
  const now = deps.now();
  const publishSeq = deps.nextPublishSeq();
  const snapshot: PublishedSnapshot = {
    recordId: record.id,
    type: record.type,
    data: record.data,
    relations,
    publishedAt: now,
    publishedBy: actor,
    sourceVersion: record.version,
    publishSeq,
  };
  deps.sql.exec(
    "INSERT OR REPLACE INTO published_snapshots (record_id, type, data, relations, published_at, published_by, source_version, publish_seq) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    snapshot.recordId,
    snapshot.type,
    JSON.stringify(snapshot.data),
    JSON.stringify(snapshot.relations),
    snapshot.publishedAt,
    snapshot.publishedBy,
    snapshot.sourceVersion,
    snapshot.publishSeq,
  );
  enqueueOutbox(
    deps.sql,
    deps.newId(),
    "upsert",
    record.id,
    snapshot.sourceVersion,
    snapshot.publishSeq,
    now,
  );
  return snapshot;
}

// Phase 8 裁定 4: 凍結埋め込みは publish 時点の asset record(編集の真実源)から読む。
// dangling(不在・削除済み・型違い)は null — 素の ID 参照として投影される(ソフト参照)。
function buildAssetEmbed(sql: SqlStorage, tenantSlug: string, assetId: string): AssetEmbed | null {
  const asset = loadRecord(sql, assetId);
  if (asset === null || asset.deletedAt !== null || asset.type !== ASSET_TYPE_KEY) {
    return null;
  }
  const data = asset.data;
  const str = (key: string): string | null => {
    const value = data[key];
    return typeof value === "string" ? value : null;
  };
  const num = (key: string): number | null => {
    const value = data[key];
    return typeof value === "number" ? value : null;
  };
  return {
    url: `/public/v1/${tenantSlug}/assets/${assetId}`,
    filename: str("filename") ?? "",
    contentType: str("content_type") ?? "application/octet-stream",
    alt: str("alt"),
    width: num("width"),
    height: num("height"),
  };
}

export function publishRecordCore(
  deps: PublishDeps,
  recordId: string,
  actor: string,
  tenantSlug: string,
): PublishResult {
  const record = loadRecord(deps.sql, recordId);
  if (record === null) {
    return { ok: false, code: "not_found", message: `record not found: ${recordId}` };
  }
  if (record.deletedAt !== null) {
    return { ok: false, code: "record_deleted", message: `record is deleted: ${recordId}` };
  }
  const relations = loadRelationRows(deps.sql, recordId);

  // Phase 8 裁定 7: 参照中(field + body)の未公開 asset を同一トランザクションで一緒に
  // publish する(公開ゲート付き配信の帰結 — 凍結 URL が publish 直後から機能するため)。
  // asset 自身は relation / richtext フィールドを持たないため再帰は起きない。
  // unpublish はカスケードしない(他の公開 record が参照中かもしれない)。
  const assetIds = [
    ...new Set(
      relations
        .filter((row) => row.targetType === ASSET_TYPE_KEY)
        .map((row) => row.targetId),
    ),
  ];
  for (const assetId of assetIds) {
    if (assetId === recordId) {
      continue; // 自己参照の保険
    }
    const published = deps.sql
      .exec<{ record_id: string }>(
        "SELECT record_id FROM published_snapshots WHERE record_id = ?",
        assetId,
      )
      .toArray()[0];
    if (published !== undefined) {
      continue;
    }
    const asset = loadRecord(deps.sql, assetId);
    if (asset === null || asset.deletedAt !== null || asset.type !== ASSET_TYPE_KEY) {
      continue; // dangling は正常系(ソフト参照)
    }
    writeSnapshot(deps, asset, loadRelationRows(deps.sql, assetId), actor);
  }

  // 裁定 4: snapshotEmbed "value" のフィールド由来行へ凍結値を埋め込む。body 由来の asset
  // 参照には埋め込まない(フィールド設定を持たない — 公開側は URL 規約
  // /public/v1/:slug/assets/:id で解決する)。
  const contentType = loadContentTypeByKey(deps.sql, record.type);
  const embedFields = new Set<string>();
  for (const field of contentType?.fields ?? []) {
    if (field.type === "relation" && field.config.snapshotEmbed === "value") {
      embedFields.add(field.key);
    }
  }
  const frozen = relations.map((row) =>
    row.origin === "field" && embedFields.has(row.sourceField)
      ? { ...row, embed: buildAssetEmbed(deps.sql, tenantSlug, row.targetId) }
      : row,
  );
  return { ok: true, snapshot: writeSnapshot(deps, record, frozen, actor) };
}
```

(`unpublishRecordCore` / `cascadeUnpublish` / `loadProjectionPayload` / `loadPublishedPage` / `loadPublicationState` は変更しない。既存の import に `loadContentTypeByKey` があることを確認 — 無ければ追加。)

- [ ] **Step 5: TenantDO と HTTP ルートの署名を更新**

`apps/api/src/tenant-do.ts` — `publishRecord` を:

```ts
  async publishRecord(
    tenantId: string,
    tenantSlug: string,
    recordId: string,
    auth: AuthContext,
  ): Promise<PublishResult> {
```

に変更し、内部の `publishRecordCore(...)` 呼び出しへ `tenantSlug` を渡す:

```ts
      const inner = publishRecordCore(
        {
          sql: this.ctx.storage.sql,
          now: () => new Date().toISOString(),
          newId: () => uuidv7(),
          nextPublishSeq: () => this.nextPublishSeq(),
        },
        recordId,
        auth.userId,
        tenantSlug,
      );
```

`apps/api/src/routes/tenant.ts` — publish ルートを差し替え:

```ts
  .post("/:tenantId/records/:recordId/publish", async (c) => {
    // Phase 8 裁定 4: 凍結 embed URL は公開パス(/public/v1/:tenantSlug/...)を指す。
    // slug の真実源はコントロールプレーン D1(publish は低頻度なので 1 クエリを許容)。
    const tenantId = c.req.param("tenantId");
    const slugRow = await c.env.DB.prepare("SELECT slug FROM tenants WHERE id = ?")
      .bind(tenantId)
      .first<{ slug: string }>();
    if (slugRow === null) {
      return c.json({ error: "unknown_tenant" }, 404);
    }
    const result = asPublishResult(
      await stubFor(c).publishRecord(tenantId, slugRow.slug, c.req.param("recordId"), c.get("auth")),
    );
    return result.ok ? c.json(result) : c.json(result, statusFor(result.code));
  })
```

- [ ] **Step 6: 既存の publishRecord 呼び出しを一括更新**

```bash
grep -rn "publishRecord(" apps/api --include=*.ts | grep -v "publishRecordCore"
```

ヒットした**すべてのテスト呼び出し**を新署名 `publishRecord(<tenantId>, "<slug>", <recordId>, <auth>)` に更新する(第 2 引数に任意の slug 文字列を挿入。テストの意味は変えない — 例: `publishRecord("tenant-a", "tenant-a", recordId, OWNER)`)。`projection-e2e.test.ts` / `publish.test.ts` / sync 系が対象になるはず。**機械的な引数挿入だけを行い、期待値は変えない。**

- [ ] **Step 7: 成功を確認**

Run: `pnpm --filter @plyrs/api exec vitest run test/publish`
Expected: PASS(既存 + 追加 4 tests)

Run: `pnpm --filter @plyrs/api test`
Expected: PASS(全体 green — 署名更新漏れは typecheck で露見する)

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 8: format + commit**

```bash
pnpm format
git add apps/api/src/projection/payload.ts apps/api/src/do/publish.ts apps/api/src/tenant-do.ts apps/api/src/routes/tenant.ts apps/api/test/publish.test.ts
git commit -m "feat: cascade asset publish and freeze embeds"
```

(Step 6 で更新した既存テストファイルも明示パスで add する。)

---

### Task 7: 投影 — projected_relations.embed 列と公開 read の embed 返却

**Files:**
- Modify: `packages/db/src/projection.ts`
- Create: `packages/db/drizzle-projection/0004_*.sql`(drizzle-kit 生成)
- Modify: `packages/db/src/projection.test.ts`(追記)
- Modify: `apps/api/src/projection/consumer.ts`
- Modify: `apps/api/src/public/include.ts`
- Test: `apps/api/test/asset-projection.test.ts`(新規)

**Interfaces:**
- Consumes: `AssetEmbed` / `ProjectionRelationRow.embed`(Task 6)、`handleProjectionJob`(projection/consumer.ts)、公開 read ルート(routes/public.ts — 変更不要。include.ts の戻り値の形だけ変わる)。
- Produces: 投影 D1 `projected_relations.embed TEXT`(JSON、null = 素の ID 参照)。`loadFieldRelationIdsForRecords` の値型は `Array<string | PublicAssetEmbed>`(`PublicAssetEmbed = { id: string } & AssetEmbed` 相当のフラットオブジェクト)。`collectIncludeTargetIds` は両形式から ID を取る。公開 API の fields は embed フィールドで `[{id, url, filename, contentType, alt, width, height}]` を返す。

- [ ] **Step 1: 失敗するテストを書く(db スキーマ)**

`packages/db/src/projection.test.ts` の末尾に追記(既存テストの様式 — スキーマオブジェクトの列存在検証 — に合わせる):

```ts
it("projected_relations has the embed column (Phase 8)", () => {
  expect(projectedRelations.embed).toBeDefined();
  expect(projectedRelations.embed.columnType).toBe("SQLiteText");
});
```

- [ ] **Step 2: 失敗を確認**

Run: `pnpm --filter @plyrs/db test`
Expected: FAIL(`embed` が存在しない)

- [ ] **Step 3: スキーマに列を足して migration を生成**

`packages/db/src/projection.ts` — `projectedRelations` の `origin` 列の直後に追加:

```ts
    // Phase 8 裁定 4: snapshotEmbed "value" の凍結埋め込み(AssetEmbed の JSON)。
    // null = 素の ID 参照。公開 read はこの値をそのまま fields へインラインする(§12.5)。
    embed: text("embed"),
```

migration を生成:

```bash
pnpm --filter @plyrs/db generate:projection
```

生成された `packages/db/drizzle-projection/0004_*.sql` を開き、中身が `ALTER TABLE \`projected_relations\` ADD \`embed\` text;` 相当(**テーブル再作成ではない**)ことを確認する。テーブル再作成(CREATE + INSERT SELECT + DROP)が生成された場合は停止してコントローラへ報告(STATUS: NEEDS_CONTEXT)。

Run: `pnpm --filter @plyrs/db test`
Expected: PASS

- [ ] **Step 4: consumer が embed を書くようにする**

`apps/api/src/projection/consumer.ts` — `upsertStatements` 内の projected_relations INSERT を差し替え(embed を 8 番目のバインドに追加し、EXISTS ガードの publish_seq を ?9 へ):

```ts
  for (const relation of payload.relations) {
    statements.push(
      db
        .prepare(
          `INSERT INTO projected_relations
             (tenant_id, source_id, source_field, target_type, target_id, ordinal, origin, embed)
           SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8
           WHERE EXISTS (SELECT 1 FROM projected_records
                         WHERE tenant_id = ?1 AND record_id = ?2 AND publish_seq = ?9)`,
        )
        .bind(
          tenantId,
          payload.recordId,
          relation.sourceField,
          relation.targetType,
          relation.targetId,
          relation.ordinal,
          relation.origin,
          relation.embed === undefined || relation.embed === null
            ? null
            : JSON.stringify(relation.embed),
          payload.publishSeq,
        ),
    );
  }
```

- [ ] **Step 5: include.ts が embed を返すようにする**

`apps/api/src/public/include.ts` — `loadFieldRelationIdsForRecords` を差し替え(import に `AssetEmbed` を追加):

```ts
import type { AssetEmbed } from "../projection/payload";
```

```ts
// Phase 8 裁定 4: snapshotEmbed "value" の関係は凍結埋め込みオブジェクトとして fields に
// 現れる(素の ID 文字列と排他 — 同じフィールドの同じ publish 世代内では形が揃う)。
export interface PublicAssetEmbed extends AssetEmbed {
  id: string;
}

export type PublicRelationValue = string | PublicAssetEmbed;

export async function loadFieldRelationIdsForRecords(
  db: D1Database,
  tenantId: string,
  recordIds: string[],
): Promise<Map<string, Record<string, PublicRelationValue[]>>> {
  const byRecord = new Map<string, Record<string, PublicRelationValue[]>>();
  for (const idChunk of chunk(recordIds, D1_BIND_CHUNK_SIZE)) {
    const { results } = await db
      .prepare(
        "SELECT source_id, source_field, target_id, embed FROM projected_relations" +
          " WHERE tenant_id = ? AND origin = 'field'" +
          ` AND source_id IN (${placeholders(idChunk.length)})` +
          " ORDER BY source_field, ordinal",
      )
      .bind(tenantId, ...idChunk)
      .all<{ source_id: string; source_field: string; target_id: string; embed: string | null }>();
    for (const row of results) {
      const byField = byRecord.get(row.source_id) ?? {};
      const list = byField[row.source_field] ?? [];
      if (row.embed === null) {
        list.push(row.target_id);
      } else {
        // embed 列は buildAssetEmbed(do/publish.ts)が書いた AssetEmbed の JSON(境界 cast)
        list.push({ id: row.target_id, ...(JSON.parse(row.embed) as AssetEmbed) });
      }
      byField[row.source_field] = list;
      byRecord.set(row.source_id, byField);
    }
  }
  return byRecord;
}
```

`collectIncludeTargetIds` を両形式対応に差し替え:

```ts
export function collectIncludeTargetIds(
  relationIds: Map<string, Record<string, PublicRelationValue[]>>,
  includeFields: string[],
): string[] {
  const targetIds = new Set<string>();
  for (const byField of relationIds.values()) {
    for (const field of includeFields) {
      for (const entry of byField[field] ?? []) {
        targetIds.add(typeof entry === "string" ? entry : entry.id);
      }
    }
  }
  return [...targetIds];
}
```

(routes/public.ts は値をそのまま fields にスプレッドしているため変更不要。typecheck が通ることを確認する。)

- [ ] **Step 6: 失敗する e2e テストを書く**

`apps/api/test/asset-projection.test.ts` を新規作成(Task 5 と同じ `setupTenant()` ボイラープレートで実テナントを HTTP 作成 — 公開 API のテナント解決が KV/D1 を引くため実 slug が必要。consumer は `handleProjectionJob` 直呼びで駆動する — 既存の `projection-consumer.test.ts` の様式):

```ts
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { app } from "../src/index";
import { handleProjectionJob } from "../src/projection/consumer";
import { asProjectionPayload, asPublishResult, asWriteResult } from "../src/rpc-unwrap";

// setupTenant() で { tenantId, tenantSlug, headers } を得る(既存様式)。
// mediaArticleType の登録・asset 作成・記事作成は Task 6 のテストと同じ形を HTTP/RPC で行う。

describe("embed の投影と公開 API (Phase 8 裁定 4)", () => {
  it("projects the frozen embed and serves it inline on the public API", async () => {
    const { tenantId, tenantSlug, headers } = await setupTenant();
    // 1. 型登録(hero: snapshotEmbed "value") + アップロード + 記事作成(HTTP 経由)
    // 2. publish(HTTP 経由 — カスケードで asset も publish される)
    // 3. DO から publishSeq を取り、記事 + asset の upsert ジョブを handleProjectionJob で処理
    // 4. GET /public/v1/:slug/records/media_article/:id の fields.hero が
    //    [{ id, url, filename, contentType, alt, width, height }] であること
    // 5. include=hero でも fields の形が変わらないこと(included に asset record が現れる)
    // …(1)(2) は Task 5 / Task 6 のテストと同じ呼び出し列。(3) は:
    const stub = env.TENANT_DO.get(env.TENANT_DO.idFromName(tenantId));
    for (const recordId of [assetId, articleId]) {
      const payload = asProjectionPayload(await stub.getProjectionPayload(recordId));
      if (payload === null) throw new Error("expected a projection payload");
      await handleProjectionJob(
        env,
        {
          jobType: "upsert",
          tenantId,
          recordId,
          sourceVersion: payload.sourceVersion,
          publishSeq: payload.publishSeq,
        },
        Date.now(),
      );
    }
    const single = await app.request(
      `/public/v1/${tenantSlug}/records/media_article/${articleId}`,
      {},
      env,
    );
    expect(single.status).toBe(200);
    const body = (await single.json()) as { fields: Record<string, unknown> };
    expect(body.fields["hero"]).toEqual([
      {
        id: assetId,
        url: `/public/v1/${tenantSlug}/assets/${assetId}`,
        filename: "hero.png",
        contentType: "image/png",
        alt: "ヒーロー",
        width: 800,
        height: 600,
      },
    ]);
  });

  it("keeps plain id arrays for relations without snapshotEmbed value", async () => {
    // snapshotEmbed 未宣言の関係フィールドを持つ型で同じ流れを回し、
    // fields の値が従来どおり ["<id>"] であることを確認する(後方互換の回帰)
  });
});
```

(コメント疑似部分はすべて実コードに展開して書くこと — Task 5/6 のテストで確立した具体的な呼び出し列をこのファイル内に再掲してよい。プレースホルダーを残さない。)

- [ ] **Step 7: 成功を確認**

Run: `pnpm --filter @plyrs/api exec vitest run test/asset-projection`
Expected: PASS(2 tests)

Run: `pnpm --filter @plyrs/api test` / `pnpm --filter @plyrs/db test`
Expected: PASS(consumer 系・public 系の既存テストが embed 列追加後も green)

- [ ] **Step 8: format + commit**

```bash
pnpm format
git add packages/db/src/projection.ts packages/db/src/projection.test.ts packages/db/drizzle-projection apps/api/src/projection/consumer.ts apps/api/src/public/include.ts apps/api/test/asset-projection.test.ts
git commit -m "feat: project and serve frozen asset embeds"
```

---

### Task 8: api — 公開アセット配信ルート(投影ゲート → R2 → Cache API)

**Files:**
- Modify: `apps/api/src/routes/public.ts`
- Test: `apps/api/test/asset-public.test.ts`(新規)

**Interfaces:**
- Consumes: `resolveTenantId` / `canonicalCacheUrl` / `withEdgeCache`(public/)、`uuidSchema`(@plyrs/metamodel)、投影 D1 `projected_records`(type='asset' の行 = 公開ゲート)、R2 `ASSETS`。
- Produces: `GET /public/v1/:tenantSlug/assets/:assetId` — 200(バイナリ、content-type / etag / nosniff / CSP sandbox 付き。Cache API 短 TTL に乗る)/ 404(未公開・不在・unknown tenant)。**DO 非経由**(§8/§12.7)。凍結 embed URL(Task 6)と URL 規約が一致する。

- [ ] **Step 1: 失敗するテストを書く**

`apps/api/test/asset-public.test.ts` を新規作成(Task 7 と同じ setupTenant + handleProjectionJob 駆動):

```ts
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { app } from "../src/index";
import { handleProjectionJob } from "../src/projection/consumer";
import { asProjectionPayload } from "../src/rpc-unwrap";

// setupTenant / アップロード / publish / 投影ジョブ処理のボイラープレートは Task 7 と同じ。
// uploadAsset(tenantId, headers, filename) → { assetId } のローカルヘルパーを作ってよい。

describe("公開アセット配信 (Phase 8 裁定 3: DO 非経由・公開ゲート付き)", () => {
  it("serves the binary for a published asset with hardening headers", async () => {
    const { tenantId, tenantSlug, headers } = await setupTenant();
    const { assetId } = await uploadAsset(tenantId, headers, "hero.png");
    // asset を直接 publish → 投影ジョブを処理
    await publishAndProject(tenantId, tenantSlug, headers, assetId);

    const response = await app.request(`/public/v1/${tenantSlug}/assets/${assetId}`, {}, env);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
    expect(response.headers.get("etag")).not.toBeNull();
    expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(0);
  });

  it("404s for an uploaded but unpublished asset (公開ゲート)", async () => {
    const { tenantId, tenantSlug, headers } = await setupTenant();
    const { assetId } = await uploadAsset(tenantId, headers, "hero.png");
    const response = await app.request(`/public/v1/${tenantSlug}/assets/${assetId}`, {}, env);
    expect(response.status).toBe(404);
  });

  it("404s for unknown tenants and malformed asset ids (D1/R2 を引く前に弾く)", async () => {
    const unknownTenant = await app.request(
      "/public/v1/no-such-tenant/assets/018f2b6a-7a0a-7000-8000-00000000dead",
      {},
      env,
    );
    expect(unknownTenant.status).toBe(404);
    const { tenantSlug } = await setupTenant();
    const badId = await app.request(`/public/v1/${tenantSlug}/assets/not-a-uuid`, {}, env);
    expect(badId.status).toBe(404);
  });
});
```

(`publishAndProject` は「HTTP publish → DO から payload を取得 → handleProjectionJob で upsert 処理」のローカルヘルパー。Task 7 のコードを流用して完全に書く。)

- [ ] **Step 2: 失敗を確認**

Run: `pnpm --filter @plyrs/api exec vitest run test/asset-public`
Expected: FAIL(404 — ルート未実装のため 1 本目が落ちる)

- [ ] **Step 3: 公開配信ルートを実装**

`apps/api/src/routes/public.ts` — import に追加:

```ts
import { uuidSchema } from "@plyrs/metamodel";
```

`publicRoutes` のチェーン、一覧ルート(`/:tenantSlug/records/:type`)の**前**に追加:

```ts
  // Phase 8 裁定 3: 公開アセット配信。公開ゲート = projected_records に asset の投影行が
  // あること(publish 済みの真実源の公開側投影)。DO を起こさない(§8/§12.7)。バイナリは
  // 不変(アップロード後の差し替え無し)なので Cache API の短 TTL はゲートの陳腐化だけを
  // 有界化する(unpublish 後も最大 TTL 秒は配信されうる — §12.6 の既存トレードオフと同じ)。
  .get("/:tenantSlug/assets/:assetId", async (c) => {
    const assetId = c.req.param("assetId") ?? "";
    if (!uuidSchema.safeParse(assetId).success) {
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
    const cacheUrl = canonicalCacheUrl(tenantId, `assets/${assetId}`, {});
    return withEdgeCache(edgeCacheContextFor(c), cacheUrl, async () => {
      const row = await c.env.PROJECTION_DB.prepare(
        "SELECT data FROM projected_records WHERE tenant_id = ?1 AND record_id = ?2 AND type = 'asset'",
      )
        .bind(tenantId, assetId)
        .first<{ data: string }>();
      if (row === null) {
        return c.json({ error: "not_found" }, 404);
      }
      const data = JSON.parse(row.data) as Record<string, unknown>;
      const r2Key = data["r2_key"];
      if (typeof r2Key !== "string") {
        return c.json({ error: "not_found" }, 404);
      }
      const object = await c.env.ASSETS.get(r2Key);
      if (object === null) {
        // 投影はあるがバイナリが無い(削除競合の窓)。ソフト参照と同じく不在として扱う
        return c.json({ error: "not_found" }, 404);
      }
      const contentType = data["content_type"];
      return new Response(object.body, {
        headers: {
          "content-type":
            typeof contentType === "string" ? contentType : "application/octet-stream",
          // ユーザー投稿バイナリを API オリジンで inline 配信するための封じ込め
          // (SVG/HTML 内スクリプトの実行面を潰す。ロードマップ §13 の href サニタイズ責務と同系)
          "x-content-type-options": "nosniff",
          "content-security-policy": "default-src 'none'; sandbox",
          etag: object.httpEtag,
        },
      });
    });
  })
```

- [ ] **Step 4: 成功を確認**

Run: `pnpm --filter @plyrs/api exec vitest run test/asset-public`
Expected: PASS(3 tests)

Run: `pnpm --filter @plyrs/api test`
Expected: PASS(public 系の既存テストが green — 新ルートは既存パスと交差しない)

- [ ] **Step 5: format + commit**

```bash
pnpm format
git add apps/api/src/routes/public.ts apps/api/test/asset-public.test.ts
git commit -m "feat: public asset delivery via R2 and cache"
```

---

### Task 9: api DO — orphan 検出・使用箇所 RPC と HTTP ルート

**Files:**
- Create: `apps/api/src/do/asset-usage.ts`
- Modify: `apps/api/src/tenant-do.ts`
- Modify: `apps/api/src/rpc-unwrap.ts`
- Modify: `apps/api/src/routes/tenant.ts`
- Test: `apps/api/test/asset-usage.test.ts`(新規)

**Interfaces:**
- Consumes: `ASSET_TYPE_KEY`(@plyrs/metamodel)、relations テーブル(`idx_relations_target` 索引)、records テーブル。
- Produces:
  - `listAssetOrphanIds(sql): string[]`(削除済みでない asset のうち、どこからも参照されない ID。field / body 両 origin を数える)
  - `listAssetUsage(sql, assetId): AssetUsageRow[]` — `{ sourceId, sourceType: string | null, sourceField, origin }`
  - DO RPC `listAssetOrphanIds()` / `listAssetUsage(assetId)`(読み取り系 = role 不問。getRecord と同じ既存規律)
  - HTTP: `GET /v1/t/:tenantId/assets/orphans` → `{ orphanIds: string[] }`、`GET /v1/t/:tenantId/assets/:assetId/usage` → `{ usage: AssetUsageRow[] }`
  - rpc-unwrap: `asOrphanIds` / `asAssetUsage`

- [ ] **Step 1: 失敗するテストを書く**

`apps/api/test/asset-usage.test.ts` を新規作成(Task 3 の `assetInput` ヘルパーと同形を使う):

```ts
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { v7 as uuidv7 } from "uuid";
import { asAssetUsage, asOrphanIds, asRegisterResult, asWriteResult } from "../src/rpc-unwrap";
import type { AuthContext } from "../src/do/authorize";

const OWNER: AuthContext = { userId: "u-owner", role: "owner" };

function stub(name: string) {
  return env.TENANT_DO.get(env.TENANT_DO.idFromName(name));
}

const galleryType = {
  id: "018f2b6a-7a0a-7000-8000-00000000d001",
  key: "gallery",
  name: "ギャラリー",
  source: "user",
  version: 1,
  fields: [
    { key: "title", type: "text", required: true },
    {
      key: "images",
      type: "relation",
      config: { allowedTypes: ["asset"], cardinality: "many" },
    },
    { key: "body", type: "richtext" },
  ],
};

function assetInput(r2Key: string): Record<string, unknown> {
  return { filename: "a.png", content_type: "image/png", size: 10, r2_key: r2Key };
}

async function createAsset(tenant: ReturnType<typeof stub>): Promise<string> {
  const id = uuidv7();
  const result = asWriteResult(
    await tenant.createAssetRecord({ recordId: id, input: assetInput(`t/${id}`) }, OWNER),
  );
  expect(result.ok).toBe(true);
  return id;
}

describe("orphan 検出と使用箇所 (Phase 8 裁定 6 / design-spec §6)", () => {
  it("lists only assets with no inbound relations as orphans", async () => {
    const tenant = stub("asset-usage-orphans");
    asRegisterResult(await tenant.registerContentType(galleryType, OWNER));
    const used = await createAsset(tenant);
    const orphan = await createAsset(tenant);
    const galleryId = uuidv7();
    asWriteResult(
      await tenant.writeRecord(
        "gallery",
        { recordId: galleryId, input: { title: "G", images: [{ type: "asset", id: used }] } },
        OWNER,
      ),
    );
    const orphanIds = asOrphanIds(await tenant.listAssetOrphanIds());
    expect(orphanIds).toContain(orphan);
    expect(orphanIds).not.toContain(used);
  });

  it("counts body-origin references (画像ノード / mention) as usage", async () => {
    const tenant = stub("asset-usage-body");
    asRegisterResult(await tenant.registerContentType(galleryType, OWNER));
    const inBody = await createAsset(tenant);
    const galleryId = uuidv7();
    asWriteResult(
      await tenant.writeRecord(
        "gallery",
        {
          recordId: galleryId,
          input: {
            title: "G",
            body: {
              schemaVersion: 1,
              doc: {
                type: "doc",
                content: [
                  {
                    type: "assetImage",
                    attrs: { recordType: "asset", recordId: inBody, label: "a.png" },
                  },
                ],
              },
            },
          },
        },
        OWNER,
      ),
    );
    expect(asOrphanIds(await tenant.listAssetOrphanIds())).not.toContain(inBody);
    const usage = asAssetUsage(await tenant.listAssetUsage(inBody));
    expect(usage).toEqual([
      { sourceId: galleryId, sourceType: "gallery", sourceField: "body", origin: "body" },
    ]);
  });

  it("excludes deleted assets from the orphan list", async () => {
    const tenant = stub("asset-usage-deleted");
    const deleted = await createAsset(tenant);
    asWriteResult(await tenant.deleteRecord(deleted, OWNER));
    expect(asOrphanIds(await tenant.listAssetOrphanIds())).not.toContain(deleted);
  });

  it("serves orphan and usage over HTTP", async () => {
    // setupTenant()(Task 5 と同じ様式)で実テナント + トークンを作り、
    // GET /v1/t/:tenantId/assets/orphans → { orphanIds: [...] }
    // GET /v1/t/:tenantId/assets/:assetId/usage → { usage: [...] }
    // をアサートする(アップロード → gallery 型登録 → 参照 record 作成の列は上の RPC テストと同形)。
  });
});
```

(4 本目の HTTP テストはコメントを実コードへ展開して書くこと。)

- [ ] **Step 2: 失敗を確認**

Run: `pnpm --filter @plyrs/api exec vitest run test/asset-usage`
Expected: FAIL(`listAssetOrphanIds` が存在しない)

- [ ] **Step 3: asset-usage.ts を実装**

`apps/api/src/do/asset-usage.ts` を新規作成:

```ts
import { ASSET_TYPE_KEY } from "@plyrs/metamodel";

// design-spec §6: relations は参照インデックスを兼ねる。orphan 検出(どこからも参照されない
// アセット)と安全な削除前の使用箇所表示は、この逆引き(idx_relations_target)で解く。
// origin は field / body の両方を数える(本文中の画像・mention も「使用」)。
export interface AssetUsageRow {
  sourceId: string;
  sourceType: string | null; // 参照元 record が消えた dangling 行では null(ソフト参照)
  sourceField: string;
  origin: string;
}

export function listAssetOrphanIds(sql: SqlStorage): string[] {
  return sql
    .exec<{ id: string }>(
      "SELECT id FROM records WHERE type = ? AND deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM relations WHERE target_type = ? AND target_id = records.id) ORDER BY id",
      ASSET_TYPE_KEY,
      ASSET_TYPE_KEY,
    )
    .toArray()
    .map((row) => row.id);
}

export function listAssetUsage(sql: SqlStorage, assetId: string): AssetUsageRow[] {
  return sql
    .exec<{ source_id: string; source_field: string; origin: string; source_type: string | null }>(
      "SELECT r.source_id, r.source_field, r.origin, rec.type AS source_type FROM relations r LEFT JOIN records rec ON rec.id = r.source_id WHERE r.target_type = ? AND r.target_id = ? ORDER BY r.source_id, r.source_field, r.ordinal",
      ASSET_TYPE_KEY,
      assetId,
    )
    .toArray()
    .map((row) => ({
      sourceId: row.source_id,
      sourceType: row.source_type,
      sourceField: row.source_field,
      origin: row.origin,
    }));
}
```

- [ ] **Step 4: RPC・unwrap・HTTP ルートを配線**

`apps/api/src/tenant-do.ts` — import を追加し、`getPublication` の近くへ RPC を追加(クラスメソッド名とモジュール関数名の衝突を避けるため別名 import にする — 同名だと自己再帰になる):

```ts
import {
  listAssetOrphanIds as loadAssetOrphanIds,
  listAssetUsage as loadAssetUsage,
  type AssetUsageRow,
} from "./do/asset-usage";
```

```ts
  // Phase 8 裁定 6: 読み取り系は getRecord と同じく role 不問(authorize.ts 冒頭コメントの既存規律)
  listAssetOrphanIds(): string[] {
    return loadAssetOrphanIds(this.ctx.storage.sql);
  }

  listAssetUsage(assetId: string): AssetUsageRow[] {
    return loadAssetUsage(this.ctx.storage.sql, assetId);
  }
```

`apps/api/src/rpc-unwrap.ts` — 末尾に追加:

```ts
import type { AssetUsageRow } from "./do/asset-usage";

export function asOrphanIds(value: unknown): string[] {
  return value as string[];
}

export function asAssetUsage(value: unknown): AssetUsageRow[] {
  return value as AssetUsageRow[];
}
```

(import はファイル先頭の import 群へ。)

`apps/api/src/routes/tenant.ts` — **Task 5 で足した `GET /:tenantId/assets/:assetId/file` より前に** orphans ルートを、その後に usage ルートを追加:

```ts
  .get("/:tenantId/assets/orphans", async (c) => {
    const orphanIds = asOrphanIds(await stubFor(c).listAssetOrphanIds());
    return c.json({ orphanIds });
  })
  .get("/:tenantId/assets/:assetId/usage", async (c) => {
    const usage = asAssetUsage(await stubFor(c).listAssetUsage(c.req.param("assetId")));
    return c.json({ usage });
  })
```

- [ ] **Step 5: 成功を確認**

Run: `pnpm --filter @plyrs/api exec vitest run test/asset-usage`
Expected: PASS(4 tests)

Run: `pnpm --filter @plyrs/api test`
Expected: PASS

- [ ] **Step 6: format + commit**

```bash
pnpm format
git add apps/api/src/do/asset-usage.ts apps/api/src/tenant-do.ts apps/api/src/rpc-unwrap.ts apps/api/src/routes/tenant.ts apps/api/test/asset-usage.test.ts
git commit -m "feat: asset orphan detection and usage lookup"
```

---

### Task 10: ui — assetImage ノードと RichTextEditor の画像挿入

**Files:**
- Create: `packages/ui/src/asset-image.ts`
- Create: `packages/ui/src/asset-image.test.ts`
- Modify: `packages/ui/src/rich-text-editor.tsx`
- Modify: `packages/ui/src/index.ts`
- Test: `packages/ui/src/rich-text-editor.test.tsx`(追記)

**Interfaces:**
- Consumes: `@tiptap/core` の `Node`(導入済み依存)、既存の `RichTextEditor` の glue/ref 様式。
- Produces:
  - `ASSET_IMAGE_NODE_NAME = "assetImage"`(metamodel の `ASSET_IMAGE_NODE_TYPE` と一致 — Task 14 の契約テストで固定)
  - `AssetUrlResolver = (recordId: string) => Promise<string | null>`
  - `createAssetImage(getResolver: () => AssetUrlResolver | undefined)` — atom block ノード。attrs は mention と同型 `{recordType, recordId, label}`。renderHTML/parseHTML は `img[data-type="assetImage"]` + `data-record-*`(コピペ往復契約)。nodeView が resolver で src を非同期解決。
  - `RichTextEditorProps` 追加: `onRequestAssetImage?: (insert: (item: { id: string; label: string }) => void) => void` / `resolveAssetUrl?: AssetUrlResolver`。ツールバーに「画像」ボタン(onRequestAssetImage 提供時のみ表示)。
  - **語彙進化の制約(ロードマップ §13)**: assetImage ノードは resolver や画像ボタンの有無に関わらず**常に extensions へ登録**する(未知ノードを含む doc を Tiptap が安全に開けないため、読み手側の語彙を先に広げる)。

- [ ] **Step 1: 失敗するテストを書く(ノード単体)**

`packages/ui/src/asset-image.test.ts` を新規作成(`tiptap-jsdom.test.ts` と同じく Editor を直接組み立てる):

```ts
import { describe, expect, it, vi } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { ASSET_IMAGE_NODE_NAME, createAssetImage, type AssetUrlResolver } from "./asset-image";

const ASSET_ID = "018f2b6a-7a0a-7000-8000-0000000000ab";

function makeEditor(resolver?: AssetUrlResolver) {
  return new Editor({
    extensions: [StarterKit, createAssetImage(() => resolver)],
    content: { type: "doc", content: [{ type: "paragraph" }] },
  });
}

describe("assetImage node (Phase 8 裁定 5)", () => {
  it("inserts a block node with the mention-shaped attrs", () => {
    const editor = makeEditor();
    editor
      .chain()
      .insertContent([
        {
          type: ASSET_IMAGE_NODE_NAME,
          attrs: { recordType: "asset", recordId: ASSET_ID, label: "hero.png" },
        },
      ])
      .run();
    const doc = editor.getJSON();
    const node = doc.content?.find((child) => child.type === ASSET_IMAGE_NODE_NAME);
    expect(node?.attrs).toEqual({ recordType: "asset", recordId: ASSET_ID, label: "hero.png" });
    editor.destroy();
  });

  it("serializes data-* attributes and round-trips through HTML (コピペ往復契約)", () => {
    const editor = makeEditor();
    editor
      .chain()
      .insertContent([
        {
          type: ASSET_IMAGE_NODE_NAME,
          attrs: { recordType: "asset", recordId: ASSET_ID, label: "hero.png" },
        },
      ])
      .run();
    const html = editor.getHTML();
    expect(html).toContain(`data-type="${ASSET_IMAGE_NODE_NAME}"`);
    expect(html).toContain(`data-record-id="${ASSET_ID}"`);
    expect(html).toContain('data-record-type="asset"');
    expect(html).toContain('data-label="hero.png"');

    const restored = makeEditor();
    restored.commands.setContent(html);
    const node = restored.getJSON().content?.find((child) => child.type === ASSET_IMAGE_NODE_NAME);
    expect(node?.attrs).toEqual({ recordType: "asset", recordId: ASSET_ID, label: "hero.png" });
    editor.destroy();
    restored.destroy();
  });

  it("resolves the preview src via the resolver (nodeView)", async () => {
    const resolver = vi.fn(async () => "blob:preview-url");
    const editor = makeEditor(resolver);
    editor
      .chain()
      .insertContent([
        {
          type: ASSET_IMAGE_NODE_NAME,
          attrs: { recordType: "asset", recordId: ASSET_ID, label: "hero.png" },
        },
      ])
      .run();
    // nodeView は EditorContent へのマウントなしでも editor.view 経由で生成される(jsdom)。
    await vi.waitFor(() => {
      const img = editor.view.dom.querySelector(`img[data-type="${ASSET_IMAGE_NODE_NAME}"]`);
      expect(img?.getAttribute("src")).toBe("blob:preview-url");
    });
    expect(resolver).toHaveBeenCalledWith(ASSET_ID);
    editor.destroy();
  });
});
```

- [ ] **Step 2: 失敗を確認**

Run: `pnpm --filter @plyrs/ui exec vitest run asset-image`
Expected: FAIL(`./asset-image` が存在しない)

- [ ] **Step 3: asset-image.ts を実装**

`packages/ui/src/asset-image.ts` を新規作成:

```ts
import { Node } from "@tiptap/core";

// 本文中の画像埋め込みノード。type 名と attrs 形は @plyrs/metamodel の ASSET_IMAGE_NODE_TYPE /
// extractBodyRelations との契約(apps/admin/src/lib/mention-contract.test.ts が一致を固定)。
// attrs は mention と同型 {recordType, recordId, label} — label は挿入時点の filename
// スナップショット(エディタ表示専用。真実源は asset record — design-spec §5)。
export const ASSET_IMAGE_NODE_NAME = "assetImage";

// 管理画面のプレビュー URL は認証付き fetch → objectURL でしか得られないため非同期。
// null = 解決不能(プレースホルダー表示のまま)。
export type AssetUrlResolver = (recordId: string) => Promise<string | null>;

function attr(node: { attrs: Record<string, unknown> }, name: string): string {
  return String(node.attrs[name] ?? "");
}

export function createAssetImage(getResolver: () => AssetUrlResolver | undefined) {
  return Node.create({
    name: ASSET_IMAGE_NODE_NAME,
    group: "block",
    atom: true,
    addAttributes() {
      return {
        recordType: {
          default: "asset",
          parseHTML: (element: HTMLElement) => element.getAttribute("data-record-type") ?? "asset",
        },
        recordId: {
          default: "",
          parseHTML: (element: HTMLElement) => element.getAttribute("data-record-id") ?? "",
        },
        label: {
          default: "",
          parseHTML: (element: HTMLElement) => element.getAttribute("data-label") ?? "",
        },
      };
    },
    parseHTML() {
      return [{ tag: `img[data-type="${ASSET_IMAGE_NODE_NAME}"]` }];
    },
    // StyleX は ProseMirror が生成する DOM に届かないため inline style で逃がす
    // (tech-selection §1.3 の規約 — record-mention.ts と同じ判断)。
    renderHTML({ node }) {
      return [
        "img",
        {
          "data-type": ASSET_IMAGE_NODE_NAME,
          "data-record-type": attr(node, "recordType"),
          "data-record-id": attr(node, "recordId"),
          "data-label": attr(node, "label"),
          alt: attr(node, "label"),
          style: "max-width: 100%;",
        },
      ];
    },
    addNodeView() {
      return ({ node }) => {
        const img = document.createElement("img");
        img.setAttribute("data-type", ASSET_IMAGE_NODE_NAME);
        img.setAttribute("data-record-type", attr(node, "recordType"));
        img.setAttribute("data-record-id", attr(node, "recordId"));
        img.setAttribute("data-label", attr(node, "label"));
        img.setAttribute("alt", attr(node, "label"));
        img.setAttribute("style", "max-width: 100%; min-height: 24px; display: block;");
        const resolver = getResolver();
        if (resolver !== undefined) {
          // 解決完了時に nodeView が破棄済みでも属性セットは無害(detached DOM への書き込み)
          void resolver(attr(node, "recordId")).then((url) => {
            if (url !== null) {
              img.setAttribute("src", url);
            }
          });
        }
        return { dom: img };
      };
    },
  });
}
```

- [ ] **Step 4: ノード単体テストの成功を確認**

Run: `pnpm --filter @plyrs/ui exec vitest run asset-image`
Expected: PASS(3 tests)

- [ ] **Step 5: 失敗するテストを書く(エディタ統合)**

`packages/ui/src/rich-text-editor.test.tsx` の末尾に追記(同ファイル既存の render + `onEditorReady` 様式に合わせる):

```tsx
describe("画像挿入 (Phase 8 裁定 5)", () => {
  it("always registers the assetImage node so docs containing it open safely", async () => {
    let captured: Editor | null = null;
    render(
      <RichTextEditor
        label="本文"
        value={{
          schemaVersion: 1,
          doc: {
            type: "doc",
            content: [
              {
                type: "assetImage",
                attrs: {
                  recordType: "asset",
                  recordId: "018f2b6a-7a0a-7000-8000-0000000000ab",
                  label: "hero.png",
                },
              },
            ],
          },
        }}
        onChange={() => {}}
        onEditorReady={(editor) => {
          captured = editor;
        }}
      />,
    );
    await vi.waitFor(() => expect(captured).not.toBeNull());
    const doc = captured?.getJSON();
    expect(doc?.content?.[0]?.type).toBe("assetImage");
  });

  it("shows the 画像 toolbar button only with onRequestAssetImage and inserts via callback", async () => {
    const onChange = vi.fn();
    let insertFn: ((item: { id: string; label: string }) => void) | null = null;
    const { rerender } = render(
      <RichTextEditor label="本文" value={undefined} onChange={onChange} />,
    );
    expect(screen.queryByRole("button", { name: "画像" })).not.toBeInTheDocument();

    rerender(
      <RichTextEditor
        label="本文"
        value={undefined}
        onChange={onChange}
        onRequestAssetImage={(insert) => {
          insertFn = insert;
        }}
      />,
    );
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "画像" }));
    expect(insertFn).not.toBeNull();
    insertFn?.({ id: "018f2b6a-7a0a-7000-8000-0000000000ab", label: "hero.png" });
    await vi.waitFor(() => expect(onChange).toHaveBeenCalled());
    const last = onChange.mock.lastCall?.[0] as {
      doc: { content: Array<{ type: string; attrs?: Record<string, unknown> }> };
    };
    const node = last.doc.content.find((child) => child.type === "assetImage");
    expect(node?.attrs?.["recordId"]).toBe("018f2b6a-7a0a-7000-8000-0000000000ab");
    expect(node?.attrs?.["label"]).toBe("hero.png");
  });
});
```

(`rerender` で onRequestAssetImage を後付けするのは「useEditor deps [] でもツールバー表示は最新 props を読む」ことの検証を兼ねる。既存 import に `Editor` 型・`screen`・`userEvent` が無ければ足す。)

- [ ] **Step 6: 失敗を確認**

Run: `pnpm --filter @plyrs/ui exec vitest run rich-text-editor`
Expected: FAIL(`onRequestAssetImage` prop が存在しない / assetImage が未知ノードで落ちる)

- [ ] **Step 7: RichTextEditor へ配線**

`packages/ui/src/rich-text-editor.tsx` を変更:

import に追加:

```ts
import { ASSET_IMAGE_NODE_NAME, createAssetImage, type AssetUrlResolver } from "./asset-image";
```

`RichTextEditorProps` に追加:

```ts
  /**
   * ツールバーの「画像」ボタン。押されると insert コールバックを渡して呼ばれる —
   * 呼び出し側(admin)がアセット選択 UI を開き、確定時に insert({id, label}) を呼ぶ。
   * 省略時はボタン非表示(ノード自体は常に登録される — 語彙進化の制約)。
   */
  onRequestAssetImage?: ((insert: (item: { id: string; label: string }) => void) => void) | undefined;
  /** 本文中画像のプレビュー URL 解決(認証付き fetch → objectURL)。省略時は src なし表示 */
  resolveAssetUrl?: AssetUrlResolver | undefined;
```

コンポーネント本体(`RichTextEditor` 関数内)に ref を追加(既存の `onChangeRef` 群の隣):

```ts
  const onRequestAssetImageRef = useRef(onRequestAssetImage);
  onRequestAssetImageRef.current = onRequestAssetImage;
  const resolveAssetUrlRef = useRef(resolveAssetUrl);
  resolveAssetUrlRef.current = resolveAssetUrl;
```

`useEditor` の extensions に追加(createRecordMention の隣):

```ts
        createAssetImage(() => resolveAssetUrlRef.current),
```

`<Toolbar editor={editor} label={label} />` を:

```tsx
      <Toolbar
        editor={editor}
        label={label}
        onRequestAssetImage={
          onRequestAssetImage === undefined
            ? undefined
            : () =>
                onRequestAssetImageRef.current?.((item) => {
                  editor
                    .chain()
                    .focus()
                    .insertContent([
                      {
                        type: ASSET_IMAGE_NODE_NAME,
                        attrs: { recordType: "asset", recordId: item.id, label: item.label },
                      },
                    ])
                    .run();
                })
        }
      />
```

`Toolbar` のシグネチャと末尾(リンクボタンの後)に追加:

```tsx
function Toolbar({
  editor,
  label,
  onRequestAssetImage,
}: {
  editor: Editor;
  label: string;
  onRequestAssetImage?: (() => void) | undefined;
}) {
```

```tsx
        {onRequestAssetImage !== undefined && (
          <ToolbarToggle label="画像" isActive={false} onToggle={onRequestAssetImage}>
            🖼
          </ToolbarToggle>
        )}
```

`packages/ui/src/index.ts` に追加:

```ts
export {
  ASSET_IMAGE_NODE_NAME,
  createAssetImage,
  type AssetUrlResolver,
} from "./asset-image";
```

- [ ] **Step 8: 成功を確認**

Run: `pnpm --filter @plyrs/ui test`
Expected: PASS(既存 33 + 追加 5。全 green)

- [ ] **Step 9: format + commit**

```bash
pnpm format
git add packages/ui/src/asset-image.ts packages/ui/src/asset-image.test.ts packages/ui/src/rich-text-editor.tsx packages/ui/src/rich-text-editor.test.tsx packages/ui/src/index.ts
git commit -m "feat: assetImage node and toolbar hook in editor"
```

---

### Task 11: admin — admin-api のアセット操作と asset-services(objectURL キャッシュ)

**Files:**
- Modify: `apps/admin/src/lib/admin-api.ts`
- Modify: `apps/admin/src/lib/admin-api.test.ts`(追記)
- Create: `apps/admin/src/lib/asset-services.ts`
- Create: `apps/admin/src/lib/asset-services.test.ts`
- Modify: `apps/admin/src/lib/queries.ts`

**Interfaces:**
- Consumes: Task 5/9 の HTTP 契約(`POST /v1/t/:tenantId/assets?filename=` / `GET .../assets/:id/file` / `GET .../assets/orphans` / `GET .../assets/:id/usage` / `DELETE .../records/:id`)、既存の `authedFetch` / `requestJson` / `throwApiError` 様式。
- Produces:
  - `AdminApi` 追加メソッド: `uploadAsset(tenantId, file: File): Promise<{ id: string }>` / `fetchAssetBlob(tenantId, assetId): Promise<Blob>` / `listOrphanAssetIds(tenantId): Promise<string[]>` / `getAssetUsage(tenantId, assetId): Promise<AssetUsageEntry[]>` / `deleteRecord(tenantId, recordId): Promise<void>`
  - `AssetUsageEntry { sourceId; sourceType: string | null; sourceField; origin }`(api の AssetUsageRow と構造一致)
  - `AssetServices { upload: (file: File) => Promise<{ id: string }>; resolveUrl: (assetId: string) => Promise<string | null> }` と `createAssetServices(adminApi, tenantId, createUrl?)`(objectURL のメモ化キャッシュ。`createUrl` はテスト用 DI — 既定は `URL.createObjectURL`)
  - `orphanAssetsQueryOptions(adminApi, tenantId)` / `assetUsageQueryOptions(adminApi, tenantId, assetId)`
  - Task 12/13 のルート・コンポーネントがこれらを使う。

- [ ] **Step 1: 失敗するテストを書く(admin-api)**

`apps/admin/src/lib/admin-api.test.ts` の末尾に追記(同ファイル既存の fetch スタブ様式に合わせる — トークンマネージャのスタブと `fetchImpl` の検査):

```ts
describe("asset endpoints (Phase 8)", () => {
  it("uploadAsset posts the raw file with filename query and content-type", async () => {
    const calls: { url: string; init: RequestInit | undefined }[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      calls.push({ url: String(input), init });
      return jsonResponse(201, { ok: true, record: { id: "asset-1" } });
    };
    const api = createAdminApi(stubTokens(), fetchImpl);
    const file = new File([Uint8Array.from([1, 2, 3])], "hero 1.png", { type: "image/png" });
    const result = await api.uploadAsset("t1", file);
    expect(result).toEqual({ id: "asset-1" });
    expect(calls[0]?.url).toBe("/v1/t/t1/assets?filename=hero%201.png");
    expect(calls[0]?.init?.method).toBe("POST");
    const headers = calls[0]?.init?.headers as Record<string, string>;
    expect(headers["content-type"]).toBe("image/png");
  });

  it("fetchAssetBlob returns the binary body", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(Uint8Array.from([9, 9]), { status: 200 });
    const api = createAdminApi(stubTokens(), fetchImpl);
    const blob = await api.fetchAssetBlob("t1", "asset-1");
    expect(blob.size).toBe(2);
  });

  it("listOrphanAssetIds / getAssetUsage / deleteRecord hit the expected paths", async () => {
    const urls: string[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      urls.push(`${init?.method ?? "GET"} ${String(input)}`);
      if (String(input).endsWith("/orphans")) {
        return jsonResponse(200, { orphanIds: ["a1"] });
      }
      if (String(input).endsWith("/usage")) {
        return jsonResponse(200, {
          usage: [{ sourceId: "r1", sourceType: "article", sourceField: "hero", origin: "field" }],
        });
      }
      return jsonResponse(200, { ok: true });
    };
    const api = createAdminApi(stubTokens(), fetchImpl);
    expect(await api.listOrphanAssetIds("t1")).toEqual(["a1"]);
    expect(await api.getAssetUsage("t1", "a1")).toEqual([
      { sourceId: "r1", sourceType: "article", sourceField: "hero", origin: "field" },
    ]);
    await api.deleteRecord("t1", "r1");
    expect(urls).toEqual([
      "GET /v1/t/t1/assets/orphans",
      "GET /v1/t/t1/assets/a1/usage",
      "DELETE /v1/t/t1/records/r1",
    ]);
  });
});
```

(`jsonResponse` / `stubTokens` は同ファイル既存ヘルパー名に合わせる — 無ければ既存様式から補う。)

- [ ] **Step 2: 失敗を確認**

Run: `pnpm --filter @plyrs/admin exec vitest run admin-api`
Expected: FAIL(`uploadAsset` が存在しない)

- [ ] **Step 3: admin-api.ts を拡張**

`apps/admin/src/lib/admin-api.ts` — 型を追加:

```ts
// apps/api/src/do/asset-usage.ts の AssetUsageRow と構造一致(HTTP 契約)
export interface AssetUsageEntry {
  sourceId: string;
  sourceType: string | null;
  sourceField: string;
  origin: string;
}
```

`return { ... }` のオブジェクトへメソッドを追加:

```ts
    async uploadAsset(tenantId: string, file: File): Promise<{ id: string }> {
      const response = await authedFetch(
        tenantId,
        `/assets?filename=${encodeURIComponent(file.name)}`,
        {
          method: "POST",
          headers: { "content-type": file.type === "" ? "application/octet-stream" : file.type },
          body: file,
        },
      );
      if (!response.ok) {
        return throwApiError(response);
      }
      const result = (await response.json()) as { ok: true; record: { id: string } };
      return { id: result.record.id };
    },
    async fetchAssetBlob(tenantId: string, assetId: string): Promise<Blob> {
      const response = await authedFetch(tenantId, `/assets/${assetId}/file`, {});
      if (!response.ok) {
        return throwApiError(response);
      }
      return response.blob();
    },
    async listOrphanAssetIds(tenantId: string): Promise<string[]> {
      const { orphanIds } = await requestJson<{ orphanIds: string[] }>(tenantId, "/assets/orphans");
      return orphanIds;
    },
    async getAssetUsage(tenantId: string, assetId: string): Promise<AssetUsageEntry[]> {
      const { usage } = await requestJson<{ usage: AssetUsageEntry[] }>(
        tenantId,
        `/assets/${assetId}/usage`,
      );
      return usage;
    },
    async deleteRecord(tenantId: string, recordId: string): Promise<void> {
      await requestJson<{ ok: true }>(tenantId, `/records/${recordId}`, { method: "DELETE" });
    },
```

- [ ] **Step 4: admin-api テストの成功を確認**

Run: `pnpm --filter @plyrs/admin exec vitest run admin-api`
Expected: PASS

- [ ] **Step 5: 失敗するテストを書く(asset-services)**

`apps/admin/src/lib/asset-services.test.ts` を新規作成:

```ts
import { describe, expect, it, vi } from "vitest";
import { createAssetServices } from "./asset-services";
import type { AdminApi } from "./admin-api";

function stubAdminApi(overrides: Partial<AdminApi>): AdminApi {
  // AssetServices が触るメソッドだけ差し替える(残りは呼ばれたら落ちる guard)。
  const reject = () => Promise.reject(new Error("unexpected call"));
  return {
    uploadAsset: reject,
    fetchAssetBlob: reject,
    ...overrides,
  } as AdminApi;
}

describe("createAssetServices (Phase 8)", () => {
  it("uploads through the admin api", async () => {
    const uploadAsset = vi.fn(async () => ({ id: "a1" }));
    const services = createAssetServices(
      stubAdminApi({ uploadAsset }),
      "t1",
      () => "blob:unused",
    );
    const file = new File([Uint8Array.from([1])], "a.png", { type: "image/png" });
    expect(await services.upload(file)).toEqual({ id: "a1" });
    expect(uploadAsset).toHaveBeenCalledWith("t1", file);
  });

  it("memoizes resolveUrl per asset id and returns null on failure", async () => {
    const fetchAssetBlob = vi.fn(async () => new Blob([Uint8Array.from([1, 2])]));
    const createUrl = vi.fn(() => "blob:one");
    const services = createAssetServices(stubAdminApi({ fetchAssetBlob }), "t1", createUrl);
    expect(await services.resolveUrl("a1")).toBe("blob:one");
    expect(await services.resolveUrl("a1")).toBe("blob:one");
    expect(fetchAssetBlob).toHaveBeenCalledTimes(1);

    const failing = createAssetServices(
      stubAdminApi({ fetchAssetBlob: async () => Promise.reject(new Error("401")) }),
      "t1",
      createUrl,
    );
    expect(await failing.resolveUrl("a2")).toBeNull();
  });
});
```

- [ ] **Step 6: 失敗を確認**

Run: `pnpm --filter @plyrs/admin exec vitest run asset-services`
Expected: FAIL(`./asset-services` が存在しない)

- [ ] **Step 7: asset-services.ts と queries.ts を実装**

`apps/admin/src/lib/asset-services.ts` を新規作成:

```ts
import type { AdminApi } from "./admin-api";

// アセットのプレビューは認証付き /v1 経路でしか取れない(<img src> は Authorization ヘッダを
// 付けられない)ため、blob を fetch して objectURL に変換する。record-form / asset 一覧 /
// エディタの画像ノードが同じキャッシュを共有する。
// objectURL は revoke しない(SPA のテナントセッション寿命でのリークは有限と判断。
// テナント切替でサービスごと作り直される)。
export interface AssetServices {
  upload: (file: File) => Promise<{ id: string }>;
  resolveUrl: (assetId: string) => Promise<string | null>;
}

export function createAssetServices(
  adminApi: AdminApi,
  tenantId: string,
  // テスト用 DI: jsdom には URL.createObjectURL が無い
  createUrl: (blob: Blob) => string = (blob) => URL.createObjectURL(blob),
): AssetServices {
  const urls = new Map<string, Promise<string | null>>();
  return {
    upload: (file) => adminApi.uploadAsset(tenantId, file),
    resolveUrl: (assetId) => {
      const cached = urls.get(assetId);
      if (cached !== undefined) {
        return cached;
      }
      const promise = adminApi
        .fetchAssetBlob(tenantId, assetId)
        .then((blob) => createUrl(blob))
        .catch(() => null);
      urls.set(assetId, promise);
      return promise;
    },
  };
}
```

`apps/admin/src/lib/queries.ts` の末尾に追加:

```ts
export function orphanAssetsQueryOptions(adminApi: AdminApi, tenantId: string) {
  return queryOptions({
    queryKey: ["assets", tenantId, "orphans"],
    queryFn: () => adminApi.listOrphanAssetIds(tenantId),
    // 参照の付け外しは同期経路で頻繁に起きるため常に取り直す(フィルタ ON のたびに最新)
    staleTime: 0,
  });
}

export function assetUsageQueryOptions(adminApi: AdminApi, tenantId: string, assetId: string) {
  return queryOptions({
    queryKey: ["assets", tenantId, "usage", assetId],
    queryFn: () => adminApi.getAssetUsage(tenantId, assetId),
    staleTime: 0,
  });
}
```

- [ ] **Step 8: 成功を確認**

Run: `pnpm --filter @plyrs/admin exec vitest run asset-services admin-api`
Expected: PASS

- [ ] **Step 9: format + commit**

```bash
pnpm format
git add apps/admin/src/lib/admin-api.ts apps/admin/src/lib/admin-api.test.ts apps/admin/src/lib/asset-services.ts apps/admin/src/lib/asset-services.test.ts apps/admin/src/lib/queries.ts
git commit -m "feat: admin api asset operations and services"
```

---

### Task 12: admin — アセット一覧ルート(アップロード・未参照フィルタ・削除と使用箇所)

**Files:**
- Create: `apps/admin/src/components/asset-thumb.tsx`
- Create: `apps/admin/src/routes/t/$tenantSlug/assets/index.tsx`
- Modify: `apps/admin/src/router.tsx`(nav:item 追加)
- Modify: `apps/admin/src/routeTree.gen.ts`(**コントローラが sandbox 無効で再生成**)
- Test: ルートのワイヤテストは Task 14(asset-flow.test.tsx)に集約。本タスクは typecheck + routeTree 再生成 + 既存テスト green を完了条件とする。

**Interfaces:**
- Consumes: `AssetServices` / `createAssetServices`(Task 11)、`orphanAssetsQueryOptions` / `assetUsageQueryOptions`、sync レジストリ(`useCollectionRows(sync.registry.get("asset"))`)、`labelForRecord`(record-form.tsx)、`ASSET_TYPE_KEY`(@plyrs/metamodel)、既存の sync-context フック群。
- Produces: ルート `/t/$tenantSlug/assets`(nav ラベル「アセット」)。アップロード(file input)→ WS broadcast でコレクションに現れる。未参照フィルタ(orphan ID セットで絞る)。行ごとの削除ボタン → 使用箇所ダイアログ(usage が空なら「参照はありません」)→ 確定で HTTP DELETE。`AssetThumb`(image/* のみ objectURL でプレビュー、それ以外は拡張子表示)。編集リンクは既存の汎用 record 編集ルート `/t/$tenantSlug/records/asset/$recordId`(alt / caption の編集はそちらで行う)。

- [ ] **Step 1: AssetThumb を実装**

`apps/admin/src/components/asset-thumb.tsx` を新規作成:

```tsx
import * as stylex from "@stylexjs/stylex";
import { useEffect, useState } from "react";
import type { SyncRecord } from "@plyrs/sync-protocol";
import { colors, typography } from "@plyrs/ui/tokens.stylex";

const styles = stylex.create({
  image: {
    width: "48px",
    height: "48px",
    objectFit: "cover",
    borderRadius: "4px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: colors.border,
  },
  fallback: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "48px",
    height: "48px",
    borderRadius: "4px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: colors.border,
    color: colors.textMuted,
    fontSize: typography.sizeSm,
    textTransform: "uppercase",
  },
});

function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot === -1 ? "?" : filename.slice(dot + 1, dot + 5);
}

export function AssetThumb({
  record,
  resolveUrl,
}: {
  record: SyncRecord;
  resolveUrl: (assetId: string) => Promise<string | null>;
}) {
  const contentType =
    typeof record.input["content_type"] === "string" ? record.input["content_type"] : "";
  const filename = typeof record.input["filename"] === "string" ? record.input["filename"] : "";
  const alt = typeof record.input["alt"] === "string" ? record.input["alt"] : filename;
  const isImage = contentType.startsWith("image/");
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!isImage) {
      return;
    }
    let cancelled = false;
    void resolveUrl(record.id).then((next) => {
      if (!cancelled) {
        setUrl(next);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [record.id, isImage, resolveUrl]);

  if (!isImage || url === null) {
    return <span {...stylex.props(styles.fallback)}>{extensionOf(filename)}</span>;
  }
  return <img src={url} alt={alt} {...stylex.props(styles.image)} />;
}
```

- [ ] **Step 2: アセット一覧ルートを実装**

`apps/admin/src/routes/t/$tenantSlug/assets/index.tsx` を新規作成:

```tsx
import { createFileRoute, Link } from "@tanstack/react-router";
import * as stylex from "@stylexjs/stylex";
import { useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, Checkbox } from "@plyrs/ui";
import { colors, spacing, typography } from "@plyrs/ui/tokens.stylex";
import { ASSET_TYPE_KEY } from "@plyrs/metamodel";
import { AssetThumb } from "../../../../components/asset-thumb";
import { ConnectionBanner } from "../../../../components/connection-banner";
import { labelForRecord } from "../../../../components/record-form";
import { createAssetServices } from "../../../../lib/asset-services";
import { assetUsageQueryOptions, orphanAssetsQueryOptions } from "../../../../lib/queries";
import {
  useSyncHasSynced,
  useSyncStatus,
  useSyncTypes,
  useTenantSync,
} from "../../../../lib/sync-context";
import { useCollectionRows } from "../../../../lib/use-collection";

const styles = stylex.create({
  title: { fontSize: typography.sizeXl, marginTop: 0 },
  toolbar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.md,
    gap: spacing.md,
    flexWrap: "wrap",
  },
  muted: { color: colors.textMuted },
  table: { borderCollapse: "collapse", width: "100%", fontSize: typography.sizeMd },
  cell: {
    textAlign: "left",
    padding: spacing.sm,
    borderBottomWidth: "1px",
    borderBottomStyle: "solid",
    borderBottomColor: colors.border,
    verticalAlign: "middle",
  },
  link: { color: colors.accent },
  banner: { color: colors.danger, fontSize: typography.sizeMd },
  dialog: {
    padding: spacing.md,
    borderRadius: "6px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: colors.border,
    backgroundColor: colors.surface,
    display: "flex",
    flexDirection: "column",
    gap: spacing.sm,
    maxWidth: "480px",
  },
  dialogTitle: { fontSize: typography.sizeMd, fontWeight: 600, margin: 0 },
  usageList: { margin: 0, paddingInlineStart: spacing.lg },
  actions: { display: "flex", gap: spacing.sm },
});

export const Route = createFileRoute("/t/$tenantSlug/assets/")({
  component: AssetListPage,
});

function formatSize(size: unknown): string {
  if (typeof size !== "number") {
    return "-";
  }
  if (size < 1024) {
    return `${size} B`;
  }
  return size < 1024 * 1024
    ? `${(size / 1024).toFixed(1)} KB`
    : `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function AssetListPage() {
  const { tenant, adminApi } = Route.useRouteContext();
  const { tenantSlug } = Route.useParams();
  const sync = useTenantSync();
  const status = useSyncStatus(sync);
  const types = useSyncTypes(sync);
  const hasSynced = useSyncHasSynced(sync);
  const rows = useCollectionRows(sync.registry.get(ASSET_TYPE_KEY));
  const assets = useMemo(() => createAssetServices(adminApi, tenant.id), [adminApi, tenant.id]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [orphansOnly, setOrphansOnly] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // 未参照フィルタ(裁定 6): ON のときだけ DO RPC(relations 逆引き)を引く
  const orphans = useQuery({
    ...orphanAssetsQueryOptions(adminApi, tenant.id),
    enabled: orphansOnly,
  });
  const usage = useQuery({
    ...assetUsageQueryOptions(adminApi, tenant.id, deleteTarget ?? ""),
    enabled: deleteTarget !== null,
  });

  if (!hasSynced) {
    return <p {...stylex.props(styles.muted)}>同期中…（状態: {status}）</p>;
  }

  const orphanSet = new Set(orphans.data ?? []);
  const visible = orphansOnly ? rows.filter((row) => orphanSet.has(row.id)) : rows;
  const sorted = visible.toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  async function upload(files: FileList | null) {
    const file = files?.[0];
    if (file === undefined) {
      return;
    }
    setUploadError(null);
    try {
      await assets.upload(file);
      // 一覧への出現は WS broadcast → コレクション反映で自動(アップロード API が DO 経由で
      // change を配るため、ここで再取得は要らない)。orphan フィルタ表示中は数え直す。
      if (orphansOnly) {
        await orphans.refetch();
      }
    } catch {
      setUploadError("アップロードに失敗しました。ファイルサイズと接続を確認してください。");
    } finally {
      if (fileInputRef.current !== null) {
        fileInputRef.current.value = "";
      }
    }
  }

  async function confirmDelete() {
    if (deleteTarget === null) {
      return;
    }
    setDeleteError(null);
    try {
      await adminApi.deleteRecord(tenant.id, deleteTarget);
      // 一覧からの消滅はトゥームストーンの WS broadcast で反映される
      setDeleteTarget(null);
    } catch {
      setDeleteError("削除に失敗しました。");
    }
  }

  return (
    <>
      <ConnectionBanner status={status} />
      <h1 {...stylex.props(styles.title)}>アセット</h1>
      <div {...stylex.props(styles.toolbar)}>
        <Checkbox isSelected={orphansOnly} onChange={setOrphansOnly}>
          未参照のみ表示
        </Checkbox>
        <div>
          <input
            ref={fileInputRef}
            type="file"
            aria-label="アセットをアップロード"
            onChange={(event) => void upload(event.currentTarget.files)}
          />
        </div>
      </div>
      {uploadError !== null && (
        <p role="alert" {...stylex.props(styles.banner)}>
          {uploadError}
        </p>
      )}
      {deleteTarget !== null && (
        <div role="alertdialog" aria-label="アセットの削除" {...stylex.props(styles.dialog)}>
          <h2 {...stylex.props(styles.dialogTitle)}>このアセットを削除しますか？</h2>
          {usage.isPending ? (
            <p {...stylex.props(styles.muted)}>使用箇所を確認中…</p>
          ) : usage.isError ? (
            <p {...stylex.props(styles.banner)}>使用箇所を取得できませんでした。</p>
          ) : (usage.data?.length ?? 0) === 0 ? (
            <p {...stylex.props(styles.muted)}>参照はありません（未参照のアセットです）。</p>
          ) : (
            <>
              <p {...stylex.props(styles.muted)}>
                次の場所から参照されています。削除すると参照は不在(リンク切れ)になります:
              </p>
              <ul {...stylex.props(styles.usageList)}>
                {(usage.data ?? []).map((entry, index) => (
                  <li key={`${entry.sourceId}-${entry.sourceField}-${index}`}>
                    {entry.sourceType ?? "(不明な型)"} / {entry.sourceField}
                    {entry.origin === "body" ? "（本文中）" : ""} — {entry.sourceId.slice(0, 8)}
                  </li>
                ))}
              </ul>
            </>
          )}
          {deleteError !== null && <p {...stylex.props(styles.banner)}>{deleteError}</p>}
          <div {...stylex.props(styles.actions)}>
            <Button variant="secondary" onPress={() => void confirmDelete()}>
              削除を確定
            </Button>
            <Button variant="secondary" onPress={() => setDeleteTarget(null)}>
              キャンセル
            </Button>
          </div>
        </div>
      )}
      {sorted.length === 0 ? (
        <p {...stylex.props(styles.muted)}>
          {orphansOnly ? "未参照のアセットはありません" : "アセットはまだありません"}
        </p>
      ) : (
        <table {...stylex.props(styles.table)}>
          <thead>
            <tr>
              <th {...stylex.props(styles.cell)}>プレビュー</th>
              <th {...stylex.props(styles.cell)}>ファイル名</th>
              <th {...stylex.props(styles.cell)}>種類</th>
              <th {...stylex.props(styles.cell)}>サイズ</th>
              <th {...stylex.props(styles.cell)}>alt</th>
              <th {...stylex.props(styles.cell)}>操作</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((record) => (
              <tr key={record.id}>
                <td {...stylex.props(styles.cell)}>
                  <AssetThumb record={record} resolveUrl={assets.resolveUrl} />
                </td>
                <td {...stylex.props(styles.cell)}>{labelForRecord(types, record)}</td>
                <td {...stylex.props(styles.cell)}>
                  {typeof record.input["content_type"] === "string"
                    ? record.input["content_type"]
                    : "-"}
                </td>
                <td {...stylex.props(styles.cell)}>{formatSize(record.input["size"])}</td>
                <td {...stylex.props(styles.cell)}>
                  {typeof record.input["alt"] === "string" ? record.input["alt"] : ""}
                </td>
                <td {...stylex.props(styles.cell)}>
                  <span {...stylex.props(styles.actions)}>
                    <Link
                      to="/t/$tenantSlug/records/$typeKey/$recordId"
                      params={{ tenantSlug, typeKey: ASSET_TYPE_KEY, recordId: record.id }}
                      {...stylex.props(styles.link)}
                    >
                      編集
                    </Link>
                    <Button variant="secondary" onPress={() => setDeleteTarget(record.id)}>
                      削除
                    </Button>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
```

- [ ] **Step 3: nav:item を登録**

`apps/admin/src/router.tsx` — 既存の `slots.register("nav:item", { id: "core.content-types", ... })` の直後に追加:

```ts
  slots.register("nav:item", {
    id: "core.assets",
    label: "アセット",
    to: "/t/$tenantSlug/assets",
    order: 1,
  });
```

- [ ] **Step 4: routeTree を再生成(コントローラ二段方式)**

新規ルートファイルを追加したため `apps/admin/src/routeTree.gen.ts` の再生成が必要。**実装サブエージェントはここで STATUS: NEEDS_CONTEXT を報告して停止**し、コントローラが sandbox 無効で以下を実行する:

```bash
pnpm --filter @plyrs/admin build
```

再生成後、実装者は `git status` で `routeTree.gen.ts` の変更を確認して続行する(build の他の生成物はコミットしない)。

- [ ] **Step 5: typecheck と既存テストを確認**

Run: `pnpm typecheck`
Expected: PASS

Run: `pnpm --filter @plyrs/admin test`
Expected: PASS(既存 112 green — 新ルートのワイヤ検証は Task 14)

- [ ] **Step 6: format + commit**

```bash
pnpm format
git add apps/admin/src/components/asset-thumb.tsx "apps/admin/src/routes/t/\$tenantSlug/assets/index.tsx" apps/admin/src/router.tsx apps/admin/src/routeTree.gen.ts
git commit -m "feat: admin asset list with orphan filter"
```

---

### Task 13: admin — メディア関係フィールド UI・asset 型の readonly・ビルダーの snapshotEmbed・本文画像の配線

**Files:**
- Create: `apps/admin/src/components/asset-picker.tsx`
- Modify: `apps/admin/src/components/record-form.tsx`
- Modify: `apps/admin/src/lib/content-type-form.ts`
- Modify: `apps/admin/src/components/content-type-form.tsx`
- Modify: `apps/admin/src/routes/t/$tenantSlug/records/$typeKey/new.tsx`
- Modify: `apps/admin/src/routes/t/$tenantSlug/records/$typeKey/$recordId.tsx`
- Test: `apps/admin/src/components/record-form.test.tsx`(追記)、`apps/admin/src/lib/content-type-form.test.ts`(追記)

**Interfaces:**
- Consumes: `AssetServices`(Task 11)、`AssetThumb`(Task 12)、`useRelationCandidates`(lib/use-collection.ts)、`relationDraftKey` / `parseRelationDraftKey`(lib/record-form-values.ts)、`ASSET_TYPE_KEY` / `ASSET_SYSTEM_MANAGED_FIELD_KEYS`(@plyrs/metamodel)、RichTextEditor の `onRequestAssetImage` / `resolveAssetUrl`(Task 10)。
- Produces:
  - `AssetSelectDialog({ registry, types, assets, onSelect, onClose })` — 同期済み asset 候補のサムネイル一覧 + その場アップロード。`onSelect({ id, label })`。
  - `AssetRelationPicker` — `allowedTypes` がちょうど `["asset"]` の関係フィールドで RelationPicker を置き換える(one/many、解除ボタン付き)。
  - `RecordFormProps.assets?: AssetServices`(省略時は従来 UI へフォールバック — 既存テストの互換)。
  - asset 型を編集するとき、システム管理フィールドの入力は `isDisabled`。
  - ビルダー: `FieldDraft.embedValue: boolean` ⇄ `config.snapshotEmbed: "value"`。
  - richtext フィールド: `assets` があるときツールバー「画像」→ AssetSelectDialog → assetImage ノード挿入、プレビューは `assets.resolveUrl`。

- [ ] **Step 1: 失敗するテストを書く(ビルダーの round-trip)**

`apps/admin/src/lib/content-type-form.test.ts` の末尾に追記(既存の round-trip 様式に合わせる):

```ts
describe("relation snapshotEmbed (Phase 8 裁定 4)", () => {
  it("round-trips embedValue through draft and definition", () => {
    const field: FieldDefinition = {
      key: "hero",
      type: "relation",
      config: { allowedTypes: ["asset"], cardinality: "one", snapshotEmbed: "value" },
    };
    const draft = toFieldDraft(field);
    expect(draft.embedValue).toBe(true);
    const built = buildDefinition({
      id: "018f2b6a-7a0a-7000-8000-00000000e001",
      key: "article",
      name: "記事",
      drafts: [draft],
      version: 1,
    });
    expect(built.ok).toBe(true);
    if (built.ok) {
      const rebuilt = built.definition.fields[0];
      expect(rebuilt?.type === "relation" && rebuilt.config.snapshotEmbed).toBe("value");
    }
  });

  it("rejects embedValue for non-asset allowedTypes with a readable error", () => {
    const draft = { ...emptyFieldDraft(), key: "author", type: "relation" as const, allowedTypes: "author", embedValue: true };
    const built = buildDefinition({
      id: "018f2b6a-7a0a-7000-8000-00000000e002",
      key: "article",
      name: "記事",
      drafts: [draft],
      version: 1,
    });
    expect(built.ok).toBe(false);
    if (!built.ok) {
      expect(built.errors.join("\n")).toContain("snapshotEmbed");
    }
  });
});
```

- [ ] **Step 2: 失敗を確認**

Run: `pnpm --filter @plyrs/admin exec vitest run content-type-form`
Expected: FAIL(`embedValue` が FieldDraft に無い)

- [ ] **Step 3: content-type-form を拡張**

`apps/admin/src/lib/content-type-form.ts`:

- `FieldDraft` に `embedValue: boolean;` を追加(`ordered` の隣)。
- `emptyFieldDraft()` に `embedValue: false,` を追加。
- `toFieldDraft` の `case "relation":` に追加:

```ts
      draft.embedValue = field.config.snapshotEmbed === "value";
```

- `fromFieldDraft` の `case "relation":` の config を差し替え:

```ts
      const config = {
        allowedTypes,
        cardinality: draft.cardinality,
        ...(draft.ordered ? { ordered: true } : {}),
        ...(draft.embedValue ? { snapshotEmbed: "value" as const } : {}),
      };
```

`apps/admin/src/components/content-type-form.tsx` — `FieldDraftCard` の relation ブロック(`順序を保持` チェックボックスの直後)に追加:

```tsx
          <Checkbox
            isSelected={draft.embedValue}
            onChange={(next) => onChange({ embedValue: next })}
          >
            公開時に値を埋め込む(asset 限定)
          </Checkbox>
```

Run: `pnpm --filter @plyrs/admin exec vitest run content-type-form`
Expected: PASS

- [ ] **Step 4: 失敗するテストを書く(RecordForm のアセット UI)**

`apps/admin/src/components/record-form.test.tsx` の末尾に追記(同ファイル既存の registry / types スタブ様式に合わせて書く。`assetServicesStub()` はテスト内ローカルヘルパー):

```tsx
function assetServicesStub(overrides: Partial<AssetServices> = {}): AssetServices {
  return {
    upload: vi.fn(async () => ({ id: "018f2b6a-7a0a-7000-8000-0000000000f1" })),
    resolveUrl: vi.fn(async () => null),
    ...overrides,
  };
}

describe("アセット関係フィールド (Phase 8 裁定: メディア UI)", () => {
  // mediaType: fields = [{key: "title", type: "text", required: true},
  //   {key: "hero", type: "relation", config: {allowedTypes: ["asset"], cardinality: "one", snapshotEmbed: "value"}}]
  // assetRecord: type "asset"、input に filename/content_type/size/r2_key(既存様式の SyncRecord 生成で作る)
  // registry スタブには "asset" コレクションを登録して候補に載せる。

  it("renders the asset picker for allowedTypes=['asset'] fields and selects from the dialog", async () => {
    const user = userEvent.setup();
    render(
      <RecordForm
        contentType={mediaType}
        types={[mediaType, assetTypeDefinition]}
        registry={registryWithAsset}
        record={null}
        submitLabel="作成"
        onSubmit={onSubmit}
        assets={assetServicesStub()}
      />,
    );
    await user.click(screen.getByRole("button", { name: "アセットを選択" }));
    const dialog = await screen.findByRole("dialog", { name: "アセットを選択" });
    expect(dialog).toHaveTextContent("hero.png");
    await user.click(screen.getByRole("button", { name: /hero\.png/ }));
    // 選択結果がフィールドに表示される
    expect(screen.getByText("hero.png", { selector: "span" })).toBeInTheDocument();
  });

  it("falls back to the plain RelationPicker without the assets prop", () => {
    render(
      <RecordForm
        contentType={mediaType}
        types={[mediaType, assetTypeDefinition]}
        registry={registryWithAsset}
        record={null}
        submitLabel="作成"
        onSubmit={onSubmit}
      />,
    );
    expect(screen.queryByRole("button", { name: "アセットを選択" })).not.toBeInTheDocument();
  });

  it("disables system-managed inputs when editing an asset record", () => {
    render(
      <RecordForm
        contentType={assetTypeDefinition}
        types={[assetTypeDefinition]}
        registry={registryWithAsset}
        record={assetRecord}
        submitLabel="保存"
        onSubmit={onSubmit}
        assets={assetServicesStub()}
      />,
    );
    expect(screen.getByRole("textbox", { name: "filename" })).toBeDisabled();
    expect(screen.getByRole("textbox", { name: "r2_key" })).toBeDisabled();
    expect(screen.getByRole("textbox", { name: "alt" })).toBeEnabled();
  });
});
```

(フィクスチャ生成のコメント 2 行は同ファイル既存の SyncRecord / registry スタブ様式で実コード化する。`assetTypeDefinition` は `@plyrs/metamodel` の `ASSET_TYPE_DEFINITION` をそのまま使ってよい。)

- [ ] **Step 5: 失敗を確認**

Run: `pnpm --filter @plyrs/admin exec vitest run record-form`
Expected: FAIL(`assets` prop が存在しない)

- [ ] **Step 6: asset-picker.tsx を実装**

`apps/admin/src/components/asset-picker.tsx` を新規作成:

```tsx
import * as stylex from "@stylexjs/stylex";
import { useRef, useState } from "react";
import type { ContentTypeDefinition, FieldDefinition } from "@plyrs/metamodel";
import { ASSET_TYPE_KEY } from "@plyrs/metamodel";
import type { CollectionRegistry } from "@plyrs/sync-client/tanstack";
import { Button } from "@plyrs/ui";
import { colors, spacing, typography } from "@plyrs/ui/tokens.stylex";
import type { AssetServices } from "../lib/asset-services";
import { parseRelationDraftKey, relationDraftKey } from "../lib/record-form-values";
import { useRelationCandidates } from "../lib/use-collection";
import { AssetThumb } from "./asset-thumb";
import { labelForRecord } from "./record-form";

const styles = stylex.create({
  dialog: {
    padding: spacing.md,
    borderRadius: "6px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: colors.border,
    backgroundColor: colors.surface,
    display: "flex",
    flexDirection: "column",
    gap: spacing.sm,
    maxWidth: "480px",
  },
  dialogTitle: { fontSize: typography.sizeMd, fontWeight: 600, margin: 0 },
  grid: { display: "flex", flexDirection: "column", gap: spacing.xs, maxHeight: "280px", overflowY: "auto" },
  candidate: {
    display: "flex",
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.xs,
    borderRadius: "4px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: colors.border,
    backgroundColor: colors.bg,
    cursor: "pointer",
    textAlign: "left",
    fontFamily: typography.fontFamily,
    fontSize: typography.sizeMd,
    color: colors.text,
  },
  muted: { color: colors.textMuted, fontSize: typography.sizeSm },
  error: { color: colors.danger, fontSize: typography.sizeSm },
  fieldLabel: { fontSize: typography.sizeSm, color: colors.textMuted },
  selected: { display: "flex", flexDirection: "column", gap: spacing.xs },
  selectedRow: { display: "flex", alignItems: "center", gap: spacing.sm },
  actions: { display: "flex", gap: spacing.sm, alignItems: "center" },
});

export interface AssetSelectItem {
  id: string;
  label: string;
}

// アセット選択ダイアログ。関係フィールド(AssetRelationPicker)と本文画像挿入(RecordForm)が
// 共用する。候補は同期済み asset コレクション — アップロード直後の WS 反映前でも選択できる
// よう、アップロード成功時は filename を label にして即確定する。
export function AssetSelectDialog({
  registry,
  types,
  assets,
  onSelect,
  onClose,
}: {
  registry: CollectionRegistry;
  types: ContentTypeDefinition[];
  assets: AssetServices;
  onSelect: (item: AssetSelectItem) => void;
  onClose: () => void;
}) {
  const candidates = useRelationCandidates(registry, [ASSET_TYPE_KEY]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function upload(files: FileList | null) {
    const file = files?.[0];
    if (file === undefined) {
      return;
    }
    setError(null);
    try {
      const { id } = await assets.upload(file);
      onSelect({ id, label: file.name });
    } catch {
      setError("アップロードに失敗しました。");
    } finally {
      if (fileInputRef.current !== null) {
        fileInputRef.current.value = "";
      }
    }
  }

  return (
    <div role="dialog" aria-label="アセットを選択" {...stylex.props(styles.dialog)}>
      <h2 {...stylex.props(styles.dialogTitle)}>アセットを選択</h2>
      <input
        ref={fileInputRef}
        type="file"
        aria-label="新しいアセットをアップロード"
        onChange={(event) => void upload(event.currentTarget.files)}
      />
      {error !== null && <span {...stylex.props(styles.error)}>{error}</span>}
      {candidates.length === 0 ? (
        <p {...stylex.props(styles.muted)}>アセットがまだありません。アップロードしてください。</p>
      ) : (
        <div {...stylex.props(styles.grid)}>
          {candidates.map((candidate) => {
            const label = labelForRecord(types, candidate);
            return (
              <button
                key={candidate.id}
                type="button"
                {...stylex.props(styles.candidate)}
                onClick={() => onSelect({ id: candidate.id, label })}
              >
                <AssetThumb record={candidate} resolveUrl={assets.resolveUrl} />
                <span>{label}</span>
              </button>
            );
          })}
        </div>
      )}
      <div {...stylex.props(styles.actions)}>
        <Button variant="secondary" onPress={onClose}>
          閉じる
        </Button>
      </div>
    </div>
  );
}

// allowedTypes がちょうど ["asset"] の関係フィールド向けの置き換え UI(Phase 8 裁定:
// メディアフィールドは独立型ではなく asset への関係フィールド — design-spec §5 論点E)。
export function AssetRelationPicker({
  field,
  value,
  onChange,
  error,
  types,
  registry,
  assets,
}: {
  field: Extract<FieldDefinition, { type: "relation" }>;
  value: unknown;
  onChange: (next: unknown) => void;
  error: string | undefined;
  types: ContentTypeDefinition[];
  registry: CollectionRegistry;
  assets: AssetServices;
}) {
  const [open, setOpen] = useState(false);
  const candidates = useRelationCandidates(registry, [ASSET_TYPE_KEY]);
  const many = field.config.cardinality === "many";
  const selectedKeys: string[] = many
    ? Array.isArray(value)
      ? value.filter((entry): entry is string => typeof entry === "string")
      : []
    : typeof value === "string" && value !== ""
      ? [value]
      : [];

  function select(item: AssetSelectItem) {
    const key = relationDraftKey({ type: ASSET_TYPE_KEY, id: item.id });
    if (many) {
      if (!selectedKeys.includes(key)) {
        onChange([...selectedKeys, key]);
      }
    } else {
      onChange(key);
    }
    setOpen(false);
  }

  function remove(key: string) {
    if (many) {
      onChange(selectedKeys.filter((entry) => entry !== key));
    } else {
      onChange("");
    }
  }

  return (
    <div {...stylex.props(styles.selected)}>
      <span {...stylex.props(styles.fieldLabel)}>{field.key}</span>
      {selectedKeys.map((key) => {
        const ref = parseRelationDraftKey(key);
        const record = candidates.find((candidate) => candidate.id === ref?.id);
        return (
          <div key={key} {...stylex.props(styles.selectedRow)}>
            {record !== undefined && <AssetThumb record={record} resolveUrl={assets.resolveUrl} />}
            <span>{record === undefined ? (ref?.id.slice(0, 8) ?? key) : labelForRecord(types, record)}</span>
            <Button variant="secondary" onPress={() => remove(key)}>
              解除
            </Button>
          </div>
        );
      })}
      <div {...stylex.props(styles.actions)}>
        <Button variant="secondary" onPress={() => setOpen(true)}>
          アセットを選択
        </Button>
      </div>
      {open && (
        <AssetSelectDialog
          registry={registry}
          types={types}
          assets={assets}
          onSelect={select}
          onClose={() => setOpen(false)}
        />
      )}
      {error !== undefined && <span {...stylex.props(styles.error)}>{error}</span>}
    </div>
  );
}
```

- [ ] **Step 7: record-form.tsx へ配線**

`apps/admin/src/components/record-form.tsx` を変更:

import に追加:

```ts
import { ASSET_SYSTEM_MANAGED_FIELD_KEYS, ASSET_TYPE_KEY } from "@plyrs/metamodel";
import type { AssetServices } from "../lib/asset-services";
import { AssetRelationPicker, AssetSelectDialog, type AssetSelectItem } from "./asset-picker";
```

`RecordFormProps` に追加:

```ts
  /** アセット操作(アップロード・プレビュー)。省略時はアセット UI を出さず従来表示に落ちる */
  assets?: AssetServices | undefined;
```

`RecordForm` 関数のシグネチャに `assets` を受け、本文画像挿入の state を追加(`conflict` state の隣):

```ts
  // 本文画像挿入: ツールバーの「画像」→ ダイアログ → insert(挿入関数は state に保持)
  const [imageInsert, setImageInsert] = useState<((item: AssetSelectItem) => void) | null>(null);
```

`contentType.fields.map` の `FieldInput` へ渡す props を拡張:

```tsx
            <FieldInput
              field={field}
              value={api.state.value}
              onChange={(next) => api.handleChange(next)}
              error={fieldErrors[field.key]}
              types={types}
              registry={registry}
              mentionCandidates={mentionCandidates}
              assets={assets}
              locked={
                contentType.key === ASSET_TYPE_KEY &&
                (ASSET_SYSTEM_MANAGED_FIELD_KEYS as readonly string[]).includes(field.key)
              }
              onRequestAssetImage={
                assets === undefined
                  ? undefined
                  : (insert) => setImageInsert(() => insert)
              }
            />
```

form 要素の末尾(`actions` div の後)にダイアログを追加:

```tsx
      {imageInsert !== null && assets !== undefined && (
        <AssetSelectDialog
          registry={registry}
          types={types}
          assets={assets}
          onSelect={(item) => {
            imageInsert(item);
            setImageInsert(null);
          }}
          onClose={() => setImageInsert(null)}
        />
      )}
```

`FieldInput` のシグネチャを拡張:

```tsx
function FieldInput({
  field,
  value,
  onChange,
  error,
  types,
  registry,
  mentionCandidates,
  assets,
  locked,
  onRequestAssetImage,
}: {
  field: FieldDefinition;
  value: unknown;
  onChange: (next: unknown) => void;
  error: string | undefined;
  types: ContentTypeDefinition[];
  registry: CollectionRegistry;
  mentionCandidates: RichTextMentionItem[];
  assets: AssetServices | undefined;
  locked: boolean;
  onRequestAssetImage: ((insert: (item: AssetSelectItem) => void) => void) | undefined;
}) {
```

`case "text"` / `case "number"` / `case "datetime"` の TextField に `isDisabled={locked}` を追加(既存 props の隣)。`case "boolean"` の Checkbox と `case "json"` の TextArea にも `isDisabled={locked}` を追加(asset 型に boolean/json フィールドは無いが、システム管理の意味論をフィールド型に依存させない)。

> packages/ui の TextField / Checkbox / TextArea が `isDisabled` を RAC へ透過していない場合は、
> ui 側の Props に `isDisabled?: boolean` を足して RAC コンポーネントへそのまま渡す(1 行の
> 透過。`content-types/index.tsx` の key 入力が `isDisabled` を既に使っているため TextField は
> 透過済みのはず — Checkbox / TextArea だけ確認)。

`case "richtext"` を差し替え:

```tsx
    case "richtext":
      return (
        <RichTextEditor
          label={field.key}
          value={asRichTextValue(value)}
          onChange={onChange}
          mentionCandidates={mentionCandidates}
          errorMessage={error}
          onRequestAssetImage={onRequestAssetImage}
          resolveAssetUrl={assets?.resolveUrl}
        />
      );
```

`case "relation"` を差し替え(asset 専用フィールドの分岐):

```tsx
    case "relation":
      // Phase 8 裁定: メディアフィールド = allowedTypes ["asset"] の関係フィールド。
      // assets(アップロード経路)が配線されているときだけ専用 UI に切り替える。
      if (
        assets !== undefined &&
        field.config.allowedTypes.length === 1 &&
        field.config.allowedTypes[0] === ASSET_TYPE_KEY
      ) {
        return (
          <AssetRelationPicker
            field={field}
            value={value}
            onChange={onChange}
            error={error}
            types={types}
            registry={registry}
            assets={assets}
          />
        );
      }
      return (
        <RelationPicker
          field={field}
          value={value}
          onChange={onChange}
          error={error}
          types={types}
          registry={registry}
        />
      );
```

- [ ] **Step 8: ルートから assets を配線**

`apps/admin/src/routes/t/$tenantSlug/records/$typeKey/new.tsx` — import に追加:

```ts
import { useMemo } from "react";
import { createAssetServices } from "../../../../../lib/asset-services";
```

`NewRecordPage` 冒頭に追加(既存の hooks の後、early return の**前**):

```ts
  const { tenant, adminApi } = Route.useRouteContext();
  const assets = useMemo(() => createAssetServices(adminApi, tenant.id), [adminApi, tenant.id]);
```

`<RecordForm ... />` に `assets={assets}` を追加。

`apps/admin/src/routes/t/$tenantSlug/records/$typeKey/$recordId.tsx` — 同様に import を追加し、`RecordEditorPage` 冒頭(`const { slots } = Route.useRouteContext();` を `const { slots, tenant, adminApi } = Route.useRouteContext();` に変更)へ:

```ts
  const assets = useMemo(() => createAssetServices(adminApi, tenant.id), [adminApi, tenant.id]);
```

(`useMemo` は early return より前に置く — hooks 規則。import の `useState` の隣に `useMemo` を足す。)

`<RecordForm ... />` に `assets={assets}` を追加。

- [ ] **Step 9: 成功を確認**

Run: `pnpm --filter @plyrs/admin exec vitest run record-form content-type-form`
Expected: PASS

Run: `pnpm --filter @plyrs/admin test`
Expected: PASS(既存ワイヤテスト含め全 green — RecordForm の assets は optional のため既存テストは無変更で通る)

- [ ] **Step 10: format + commit**

```bash
pnpm format
git add apps/admin/src/components/asset-picker.tsx apps/admin/src/components/record-form.tsx apps/admin/src/components/record-form.test.tsx apps/admin/src/lib/content-type-form.ts apps/admin/src/lib/content-type-form.test.ts apps/admin/src/components/content-type-form.tsx "apps/admin/src/routes/t/\$tenantSlug/records/\$typeKey/new.tsx" "apps/admin/src/routes/t/\$tenantSlug/records/\$typeKey/\$recordId.tsx"
git commit -m "feat: media field ui and asset image wiring"
```

---

### Task 14: admin — 契約テストの attrs キー固定とアセットのワイヤレベルテスト

**Files:**
- Modify: `apps/admin/src/lib/mention-contract.test.ts`
- Create: `apps/admin/src/asset-flow.test.tsx`

**Interfaces:**
- Consumes: `RichTextEditor` / `ASSET_IMAGE_NODE_NAME`(@plyrs/ui)、`ASSET_IMAGE_NODE_TYPE` / `RECORD_MENTION_NODE_TYPE` / `extractBodyRelations` / `ASSET_TYPE_DEFINITION`(@plyrs/metamodel)、`FakeSocket`(src/test-utils/fake-socket.ts)、`createAppContext` / `getRouter`(router.tsx)。richtext-flow.test.tsx の様式(stubFetch / socketHarness / bootstrapped / pushes)を踏襲する。
- Produces: (a) ノード名の一致 + **ui 産 doc を extractBodyRelations に通す attrs キー契約**(ロードマップ §13 推奨の消化)。(b) アセット一覧・アップロード・orphan フィルタ・削除・メディアフィールド選択保存・本文画像挿入保存のワイヤレベル回帰。

- [ ] **Step 1: mention-contract.test.ts を拡張**

`apps/admin/src/lib/mention-contract.test.ts` を次の内容に置き換える:

```tsx
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import type { Editor } from "@tiptap/core";
import {
  ASSET_IMAGE_NODE_TYPE,
  RECORD_MENTION_NODE_TYPE,
  extractBodyRelations,
  type ContentTypeDefinition,
} from "@plyrs/metamodel";
import { ASSET_IMAGE_NODE_NAME, RECORD_MENTION_NODE_NAME, RichTextEditor } from "@plyrs/ui";

// エディタ(ui)が書くノードと、DO 側抽出(metamodel)が読む契約を固定する。
// どちらかを変えるときは両方を同時に変え、このテストで一致を確かめること。
describe("record mention / asset image contract", () => {
  it("ui node names match the metamodel extraction targets", () => {
    expect(RECORD_MENTION_NODE_NAME).toBe(RECORD_MENTION_NODE_TYPE);
    expect(ASSET_IMAGE_NODE_NAME).toBe(ASSET_IMAGE_NODE_TYPE);
  });

  // ロードマップ §13 推奨: ノード名だけでなく attrs キーまで(ui 産の実 doc を
  // extractBodyRelations に通して)固定するクロスパッケージ契約テスト。
  it("editor-produced docs feed extractBodyRelations with both node kinds", async () => {
    const AUTHOR_ID = "018f2b6a-7a0a-7000-8000-0000000000a1";
    const ASSET_ID = "018f2b6a-7a0a-7000-8000-0000000000a2";
    let captured: Editor | null = null;
    render(
      <RichTextEditor
        label="body"
        value={undefined}
        onChange={() => {}}
        onEditorReady={(editor) => {
          captured = editor;
        }}
      />,
    );
    await vi.waitFor(() => expect(captured).not.toBeNull());
    if (captured === null) {
      throw new Error("editor not ready");
    }
    const editor: Editor = captured;
    editor
      .chain()
      .insertContent([
        {
          type: "paragraph",
          content: [
            {
              type: RECORD_MENTION_NODE_NAME,
              attrs: { recordType: "author", recordId: AUTHOR_ID, label: "山田" },
            },
          ],
        },
        {
          type: ASSET_IMAGE_NODE_NAME,
          attrs: { recordType: "asset", recordId: ASSET_ID, label: "hero.png" },
        },
      ])
      .run();

    const contentType: ContentTypeDefinition = {
      id: "018f2b6a-7a0a-7000-8000-0000000000a3",
      key: "article",
      name: "記事",
      source: "user",
      version: 1,
      fields: [{ key: "body", type: "richtext" }],
    };
    const writes = extractBodyRelations(contentType, {
      body: { schemaVersion: 1, doc: editor.getJSON() },
    });
    expect(writes).toEqual([
      {
        fieldKey: "body",
        refs: [
          { type: "author", id: AUTHOR_ID },
          { type: "asset", id: ASSET_ID },
        ],
      },
    ]);
  });
});
```

Run: `pnpm --filter @plyrs/admin exec vitest run mention-contract`
Expected: PASS(Task 1 / Task 10 実装済みなら最初から green のはず — 落ちたら契約の実装ずれなので原因を直す)

- [ ] **Step 2: 失敗するワイヤテストを書く**

`apps/admin/src/asset-flow.test.tsx` を新規作成。**richtext-flow.test.tsx と同じヘルパー様式**(`stubFetch` / `socketHarness` / `bootstrapped` / `pushes` / `authedRoutes`)をこのファイル内に再掲して使う(コピーで良い — テストファイル間の共有はしない既存方針)。welcome の contentTypes には `ASSET_TYPE_DEFINITION`(@plyrs/metamodel)と下記 `mediaArticleType` を配る:

```tsx
const mediaArticleType: ContentTypeDefinition = {
  id: "018f2b6a-7a0a-7000-8000-000000000d01",
  key: "article",
  name: "記事",
  source: "user",
  version: 1,
  fields: [
    { key: "title", type: "text", required: true },
    {
      key: "hero",
      type: "relation",
      config: { allowedTypes: ["asset"], cardinality: "one", snapshotEmbed: "value" },
    },
    { key: "body", type: "richtext" },
  ],
};

const ASSET_1 = "018f2b6a-7a0a-7000-8000-000000000e01";
const ASSET_2 = "018f2b6a-7a0a-7000-8000-000000000e02";

function assetRecord(id: string, filename: string, overrides: Partial<SyncRecord> = {}): SyncRecord {
  return {
    id,
    type: "asset",
    input: {
      filename,
      content_type: "image/png",
      size: 3,
      r2_key: `t1/${id}`,
    },
    fieldVersions: {},
    status: "draft",
    seq: 3,
    version: 1,
    deletedAt: null,
    updatedAt: "2026-07-17T00:00:00Z",
    updatedBy: "u1",
    ...overrides,
  };
}
```

テスト本体(5 本):

```tsx
describe("アセット一覧 (/t/$tenantSlug/assets)", () => {
  it("lists synced assets, uploads a file, and shows the broadcast record", async () => {
    const routes = authedRoutes();
    routes["/v1/t/t1/assets"] = vi.fn(() =>
      jsonResponse(201, { ok: true, record: { id: ASSET_2 } }),
    );
    const harness = socketHarness();
    const router = getRouter({
      context: createAppContext(stubFetch(routes), { connect: () => harness.connect }),
      history: createMemoryHistory({ initialEntries: ["/t/blog/assets"] }),
    });
    render(<RouterProvider router={router} />);
    await vi.waitFor(() => expect(harness.sockets.length).toBe(1));
    await bootstrapped(harness.latest(), [assetRecord(ASSET_1, "one.png")]);

    expect(await screen.findByText("one.png")).toBeInTheDocument();

    const user = userEvent.setup();
    const file = new File([Uint8Array.from([1, 2, 3])], "two.png", { type: "image/png" });
    await user.upload(screen.getByLabelText("アセットをアップロード"), file);
    await vi.waitFor(() => expect(routes["/v1/t/t1/assets"]).toHaveBeenCalled());

    // アップロード API は DO 経由で change を broadcast する(Task 3)— それを模擬する
    harness.latest().deliver({ type: "change", record: assetRecord(ASSET_2, "two.png") });
    expect(await screen.findByText("two.png")).toBeInTheDocument();
  });

  it("filters to orphans only via the orphan endpoint", async () => {
    const routes = authedRoutes();
    routes["/v1/t/t1/assets/orphans"] = vi.fn(() => jsonResponse(200, { orphanIds: [ASSET_2] }));
    // render + bootstrap(asset 2 件)
    // 「未参照のみ表示」をチェック → one.png が消え two.png だけ残る
  });

  it("shows usage before delete and removes the row on the tombstone broadcast", async () => {
    const routes = authedRoutes();
    routes[`/v1/t/t1/assets/${ASSET_1}/usage`] = vi.fn(() =>
      jsonResponse(200, {
        usage: [{ sourceId: "r1", sourceType: "article", sourceField: "hero", origin: "field" }],
      }),
    );
    routes[`/v1/t/t1/records/${ASSET_1}`] = vi.fn(() => jsonResponse(200, { ok: true }));
    // render + bootstrap(asset 1 件) → 削除ボタン → alertdialog に "article / hero" →
    // 削除を確定 → DELETE が呼ばれる → tombstone change(deletedAt 付き)を deliver →
    // 行が消える
  });
});

describe("メディアフィールドと本文画像 (record 編集)", () => {
  it("selects an asset from the dialog and pushes the relation ref", async () => {
    // /t/blog/records/article/new を開き bootstrap(asset 1 件 + 型 2 種) →
    // title 入力 → 「アセットを選択」→ dialog の one.png をクリック →「作成」→
    // push の input.hero が { type: "asset", id: ASSET_1 } / changedFields に "hero"
    // (新規作成は全量 push のため title も載る — richtext-flow の様式で pushes() を検証)
  });

  it("inserts an assetImage node from the toolbar and pushes it in the body", async () => {
    // /t/blog/records/article/new を開き bootstrap → title 入力 → 「画像」ボタン →
    // dialog の one.png をクリック → 「作成」→ push の input.body.doc.content に
    // { type: "assetImage", attrs: { recordType: "asset", recordId: ASSET_1, label: "one.png" } }
    // が含まれる
  });
});
```

(コメント疑似部分はすべて実コードへ展開して書く。record 編集の 2 本は new ルートを使うことで既存 record のフィクスチャを減らす。`/v1/t/t1/records/<新規ID>/publication` の stub は new ルートでは不要 — publish スロットは recordId 確定後の編集ルートのみ。ダイアログ内の AssetThumb は resolveUrl が fetch stub 不在で reject → null に落ち、拡張子フォールバック表示になる(クラッシュしない — Task 11 の catch)。upload 済みテストで `/v1/t/t1/assets/${ASSET_1}/file` の呼び出しが起きても `stubFetch` が throw → resolveUrl の catch で吸収されるが、**"unexpected fetch" の throw は Promise reject なのでテストは落ちない**。気になる場合は routes に file ハンドラ(200 の空 Response)を足してよい。)

- [ ] **Step 3: 失敗を確認 → 実装済みなので green 化を確認**

Run: `pnpm --filter @plyrs/admin exec vitest run asset-flow`
Expected: PASS(5 tests。落ちた場合は Task 12/13 の実装との突き合わせで原因を特定する — 「既存・無関係」報告は禁止)

- [ ] **Step 4: admin 全体を確認**

Run: `pnpm --filter @plyrs/admin test`
Expected: PASS(全 green)

- [ ] **Step 5: format + commit**

```bash
pnpm format
git add apps/admin/src/lib/mention-contract.test.ts apps/admin/src/asset-flow.test.tsx
git commit -m "test: asset wire-level flows and node contract"
```

---

### Task 15: 全ゲートの実測(最終検証)

**Files:** なし(検証のみ)

- [ ] **Step 1: ワークスペース全体のテスト**

Run: `pnpm -r test`
Expected: 全パッケージ green(metamodel / db / ui / sync-protocol / sync-client / admin / api)。

- [ ] **Step 2: typecheck / lint / format**

Run: `pnpm typecheck && pnpm lint && pnpm format:check`
Expected: すべて exit 0、**lint は警告 0**(警告が出たら修正してから再実行)。

- [ ] **Step 3: 差し戻し事項の確認**

計画からの逸脱(実装中に変えた点)があれば SDD レジャーに記録されていることを確認し、コントローラへ報告する。コミットは行わない(このタスクは検証のみ)。

---

## Self-Review 済みの注意点(実装者向け)

- **publishRecord の署名変更(Task 6)は破壊的**。`grep -rn "publishRecord(" apps/api` で全呼び出しを更新してから typecheck を通すこと。
- **Task 2 で既存テストの型カタログ前提が変わる**(asset 型が常に存在)。welcome の contentTypes・listContentTypes の件数・`contentTypes[0]` を使うテストは期待値更新が必要になりうる。
- **Task 7 の drizzle migration はテーブル再作成になっていないか必ず目視**(ADD COLUMN のみが正)。
- **Task 10 の assetImage ノードは常時登録**(画像ボタンの有無と独立)— 語彙進化の制約(§13)の実装形。
- **Task 12 のルート追加は routeTree 再生成が必要**(コントローラ二段方式)。`git status` で routeTree.gen.ts の diff を確認してからコミット。
- 型の対応: api の `AssetUsageRow` ⇄ admin の `AssetUsageEntry` は構造一致(HTTP 契約)。`AssetEmbed`(api/projection/payload.ts)⇄ 公開 API の `PublicAssetEmbed = { id } & AssetEmbed`。
- フィールド key は snake_case 制約(`FIELD_KEY_PATTERN`)のため `content_type` / `r2_key`(camelCase 不可)。
