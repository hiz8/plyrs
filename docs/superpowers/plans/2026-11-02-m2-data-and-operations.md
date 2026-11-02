# M2 データと操作の土台 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 書き込み MCP(M4)が載る土台を作る。リッチテキストの最上位ブロックに安定 ID を付け、Markdown ⇄ AST を双方向に変換し、record の変更履歴を DO 内に記録して管理画面から復元でき、全書き込み操作(create / update / delete / publish / unpublish / restore)が操作カタログ経由で strict な競合判定を通り、型の執筆ガイドと下書きを含む全文検索がある状態にする(ゲート G2)。

**Architecture:** リッチテキストの語彙(ノード名・属性・Markdown 文法)は React 非依存の新パッケージ `@plyrs/richtext` に置き、ui のエディタ・api の Worker・DO の 3 か所から同じ定義を引く。ブロック ID の導出は純関数として `@plyrs/metamodel` に置き、DO の書き込み(永続化)・DO の読み取り(`record_get`)・管理画面(エディタへ渡す前)の 3 点で必ず通す。変更履歴は DO 内の `record_history` 表(record ごとの連番がキー)に `writeRecordCore` / publish / unpublish / delete の 4 点で記録し、区切り規則・差分圧縮・保持上限で有界化する。書き込み操作はカタログに宣言し、DO の `invoke` RPC が transactionSync・ブロードキャスト・outbox 送出を一手に担う。経路(`via`)の列挙と判定モード(strict / merge)は `@plyrs/sync-protocol` に置き、履歴の記録・判定モードの選択・カタログの提供先で共通に使う。

**Tech Stack:** `@tiptap/markdown` 3.31.4(`MarkdownManager`、Editor 無し)、`@tiptap/extension-unique-id` 3.31.4(ui のみ)、`@tiptap/core` の `getSchema` + ProseMirror `Node.fromJSON(...).check()`、Drizzle(DO-SQLite。FTS5 の仮想テーブルだけ `drizzle-kit generate --custom` の空マイグレーションに DDL を書く)、Zod v4、`@cloudflare/vitest-plugin`、jsdom + Testing Library、Playwright。

**Spec:**
- `docs/design-spec.md` 16.4〜16.11、決定 36〜46(特に 41・42・43・44・46)
- `docs/superpowers/plans/2026-11-01-m0-2-richtext-spike-result.md`(ID 導出・UniqueID の挙動・Markdown 忠実度・スキーマ外 Markdown の扱い。試作コードは `origin/spike/mcp-richtext` の `packages/richtext-spike/src/`)
- `docs/superpowers/plans/2026-11-01-mcp-roadmap.md` 2 章 M2、3 章(依存)、4 章(未決事項)
- `docs/superpowers/plans/2026-11-01-m1-readonly-mcp.md`(カタログ・`invoke`・MCP の入口の形。M2 はこの上に足す)
- `/mnt/project-files/m1/m1-report.md` に相当する M1 の判断(ロードマップ 7 章)

## Global Constraints

- **既存経路を通す。** 書き込みは `writeRecordCore`、公開は `publishRecordCore` / `unpublishRecordCore`、削除は `deleteRecordCore`。カタログの操作はこれらを呼ぶ薄い層で、MCP 専用のビジネスロジックを作らない(決定 36)
- **同期(WebSocket push)は `handlePush` → `writeRecordCore` のまま。** カタログの `invoke` に載せ替えない(ack / broadcast の規約が別)。履歴の記録は `writeRecordCore` の中にあるので同期経路でも残る(G2)
- **経路(via)の列挙は 1 か所**: `@plyrs/sync-protocol` の `VIAS = ["sync", "mcp", "rest"]`。`apps/api/src/ops/spec.ts` の `Via` はこれを再 export する。判定モードは `conflictModeFor(via)`: sync → `"merge"`、mcp / rest → `"strict"`(決定 42)
- **ブロック ID の契約は最上位ブロックだけ。** 入れ子のノードに ID があっても害は無いが、DO も Worker も最上位以外の ID を保証しない(M0-2 結果 2 節)。読むときの導出は決定的(位置 + 内容の正規化 JSON の FNV-1a 64bit × 2)で、永続化後は保存された ID を優先する(決定 44)
- **Markdown → AST は必ずスキーマ検証を通す。** `getSchema(extensions)` から作った ProseMirror スキーマで `Node.fromJSON(schema, json).check()`。通らなければ業務エラー `unsupported_markdown`(16.10)。見出し 4〜6 は 3 に丸める、空文字は空段落 1 つに正規化する(M0-2 結果 4 節の仮置きを採用)
- **独自ノードの Markdown 文法を確定する(M0-2 の仮置きを正式採用)**: record 参照 `[@ recordType="author" recordId="<uuid>" label="山田"]`、本文中画像 `![label](plyrs://asset/<uuid>)`。外部 URL の画像は `unsupported_markdown`(アセット取り込みは M4-5)
- **履歴の規則(決定 41、仮置き)**: 区切りは (1) actor または via が前の版と違う、(2) 前の版を開いてから 15 分以上、(3) status が変わる、(4) publish / unpublish / delete / restore。保持は record ごとに最新 100 版かつ 365 日。直近 10 版は全文、それより古い版は **1 つ新しい版からの逆差分**(新しい側から辿るので古い版を消しても鎖が切れない)。publish / unpublish の版は常に全文で、record がある間は消さない
- **冪等性(16.7)**: `record_create` は同じ ID で同じ内容なら既存の結果、内容が違えば `already_exists`。`record_delete` / `record_publish` / `record_unpublish` は既にその状態なら成功を返す
- **エラーは 3 層(16.7)**: 操作の失敗は `InvokeResult` の `ok: false`(`code` + `message` + 任意の `details`)。競合は `code: "conflict"` に現在値・現在の `fieldVersions`・競合フィールドを `details` で付ける
- **マイグレーションは drizzle-kit で生成する。** 例外は FTS5 の仮想テーブル(drizzle のスキーマで表せない)で、`drizzle-kit generate --custom --name=records_fts` で空ファイルを作り DDL を書く。生成後は `pnpm format`
- DO の RPC 戻り値は `src/rpc-unwrap.ts` の `asXxx()` で実型へ戻す。`@ts-expect-error` は使わない
- 新しい依存は `pnpm-workspace.yaml` の `catalog:` に置く。tiptap 系は **3.31.4 に完全一致で固定**(`@tiptap/markdown` と `@tiptap/extension-unique-id` が peer を完全一致で要求する)
- コメント・ドキュメント・コミットメッセージ・画面の文言は日本語、用語は `docs/glossary.md` に従う(「履歴」「経路(via)」「判定モード(strict)」「執筆ガイド」)。コミットは各タスクの最後に 1 つ
- PR は M1 と同じスタック(各タスクが前のタスクを base にする)。ブランチは `claude/project-thread-7znh73-m2-<番号>`

## Review Focus

1. **ID 付与だけの差分が push を起こさないこと**(Task 1): v1 の record を管理画面で開いただけで同期 push・履歴・版の更新が発生すると、未更新の record の `fieldVersions` が動いてエージェントの `baseFieldVersions` が外れる。jsdom のテストで「v2 の文書(入れ子リスト込み)を開いて onChange が呼ばれない」を固定し、admin の `richtext-flow.test.tsx` 相当でも push が無いことを見る
2. **履歴の鎖が切れないこと**(Task 3): 差分圧縮・保持上限・publish 版の永続保持の組み合わせで、残っている全版が復元できること。「120 版書いて publish を 2 回挟み、全版の `loadVersion` が全文を返す」をテストする
3. **strict 判定が `baseFieldVersions` の欠けを競合と見ること**(Task 7・8): エージェントが `baseFieldVersions` を省いたフィールドは version 0 と見なされ、現在値が 1 以上なら conflict。省略で判定を抜けられないこと
4. **`invoke` 経由の書き込みがコミット後に同期へ届くこと**(Task 5・8): `record_update` / `record_restore` の後、WebSocket で接続中の管理画面に `change` が届き、公開中の record の delete / unpublish が outbox に積まれて送出されること(トランザクション外でのブロードキャストと drain)
5. **FTS5 の索引が record の削除・型外れに追従すること**(Task 11): 削除済み record が検索に出ない、型定義から外れたフィールドの文字列は再索引で落ちる、トークン 2 文字以下の問い合わせが LIKE に倒れて結果を返す

---

## ファイル構成

| ファイル | 責務 |
| --- | --- |
| `packages/metamodel/src/block-ids.ts` | 新規。`RICH_TEXT_SCHEMA_VERSION = 2`、`BLOCK_ID_ATTR`、`canonicalJson`、`ensureTopLevelBlockIds`、`ensureRecordBlockIds(definition, data)` |
| `packages/richtext/` | 新規パッケージ `@plyrs/richtext`。語彙(`HEADING_LEVELS`、ノードの属性)・Worker 用拡張集合・`MarkdownManager` の包み(`richTextToMarkdown` / `markdownToRichText`)・スキーマ検証・`richTextPlainText` |
| `packages/ui/src/rich-text-editor.tsx` | 変更。`RICH_TEXT_SCHEMA_VERSION` を metamodel から import、`UniqueID` を追加、ID 付与だけの更新を onChange に流さない |
| `apps/admin/src/components/record-form.tsx` | 変更。エディタへ渡す前に `ensureRecordBlockIds` を通す |
| `apps/admin/src/lib/richtext-text.ts` | 削除(`@plyrs/richtext` の `richTextPlainText` へ移す) |
| `apps/api/src/mcp/richtext-markdown.ts` | 削除(`@plyrs/richtext` へ移す) |
| `packages/sync-protocol/src/via.ts` | 新規。`VIAS` / `Via` / `ConflictMode` / `conflictModeFor` |
| `packages/sync-protocol/src/resolve.ts` | 変更。`resolveSyncWrite(..., mode)` |
| `packages/db/src/schema.ts` + `drizzle/` | 変更。`recordHistory`、`contentTypes.writingGuide`、FTS5 の custom migration |
| `apps/api/src/do/history.ts` | 新規。履歴の記録(区切り・畳み込み・差分圧縮・保持)、`loadHistory` / `loadVersion` / `compareVersions` |
| `apps/api/src/do/restore-record.ts` | 新規。`restoreRecordCore`(削除の取り消しを含む) |
| `apps/api/src/do/write-record.ts` | 変更。`via` / `tokenId` / `clientId` / `restoredFrom` を受け、ブロック ID の永続化・履歴・FTS5 を書く |
| `apps/api/src/do/publish.ts` / `delete-record.ts` | 変更。履歴の記録点、`via` |
| `apps/api/src/do/search.ts` | 新規。FTS5 の索引更新・検索・再索引 |
| `apps/api/src/ops/write.ts` | 新規。`record_create` / `record_update` / `record_delete` / `record_publish` / `record_unpublish` |
| `apps/api/src/ops/history.ts` | 新規。`record_history` / `record_compare` / `record_restore` |
| `apps/api/src/ops/search.ts` | 新規。`record_search` |
| `apps/api/src/ops/read.ts` | 変更。`OpContext` の拡張(書き込み seam・via・tenantSlug)、`record_get` の ID 導出 |
| `apps/api/src/ops/invoke.ts` | 変更。`InvokeResult` に `conflict` / `already_exists` / `unsupported_markdown` と `details` |
| `apps/api/src/tenant-do.ts` | 変更。`invoke` を async にし transactionSync・ブロードキャスト・drain を担う。`reindexSearch` RPC。`writeRecord` 等の既存 RPC に `via` |
| `apps/api/src/routes/tenant.ts` | 変更。`POST /:tenantId/ops/:op`(カタログの REST 面)、`PUT /records/...` を `invoke` へ |
| `apps/api/src/routes/super.ts` | 変更。`POST /tenants/:tenantId/search-reindex` |
| `apps/api/src/mcp/server.ts` | 変更。`record_get` の Markdown を `@plyrs/richtext` で、`plyrs://types/{key}/schema` resource、`writing_guide` prompt |
| `apps/admin/src/routes/t/$tenantSlug/content/$typeKey/$recordId_/history.tsx` | 新規。履歴画面 |
| `apps/admin/src/lib/history.ts` | 新規。履歴の表示用純関数(経路のラベル、版の要約、差分の整形) |
| `apps/admin/src/lib/admin-api.ts` | 変更。`invokeOperation(tenantId, op, input)` と履歴 3 本、`putRecord` の `baseFieldVersions` |
| `apps/admin/src/lib/content-type-form.ts` + `components/content-types/type-editor.tsx` | 変更。執筆ガイド欄 |
| `apps/e2e/tests/` | 変更。履歴の復元(管理画面)と `record_search` のスモーク |

---

## Task 1(M2-1): 最上位ブロックへの安定 ID 付与

**Files:** `packages/metamodel/src/block-ids.ts`(+ `.test.ts`)、`packages/metamodel/src/index.ts`、`packages/ui/src/rich-text-editor.tsx`、`packages/ui/package.json`、`pnpm-workspace.yaml`、`apps/admin/src/components/record-form.tsx`、`apps/admin/src/lib/record-form-values.ts`(あれば `schemaVersion` の定数化)、`apps/api/src/do/write-record.ts`、`apps/api/src/ops/read.ts`、`apps/api/test/block-ids.test.ts`、`packages/ui/src/rich-text-editor.test.tsx`

**Interfaces:**
- Produces(metamodel): `RICH_TEXT_SCHEMA_VERSION = 2`、`BLOCK_ID_ATTR = "id"`、`canonicalJson(value: unknown): string`、`ensureTopLevelBlockIds(envelope: RichTextEnvelope): { envelope: RichTextEnvelope; changed: boolean }`(保存 ID を優先、無い・空・重複は導出。`schemaVersion < 2` なら 2 に上げる。全ブロックに ID があり版が 2 なら `changed: false` で同じ参照を返す)、`ensureRecordBlockIds(definition: ContentTypeDefinition, data: Record<string, unknown>): { data; changed }`(richtext フィールドだけに適用。エンベロープとして解釈できない値は触らない)
- 導出 ID の形式は試作どおり `v1-` + 24 桁 hex(位置 `index` と ID を除いた正規化 JSON の FNV-1a 64bit × 2 系統)

- [ ] `block-ids.ts` を試作(`origin/spike/mcp-richtext:packages/richtext-spike/src/block-ids.ts`)から移植する。`derived` の数ではなく `changed: boolean` を返す(呼び出し側は「書き直すか」だけを知りたい)。`RICH_TEXT_SCHEMA_VERSION` をここに置き、`index.ts` から export
- [ ] テスト(`block-ids.test.ts`): 同じ入力で同じ ID / attrs のキー順が違っても同じ ID / 内容が変わると ID が変わる / 前にブロックを挿入すると後続の導出 ID も変わる / 保存 ID を優先 / 重複 ID は 2 つ目以降を導出で置き換える / 版 2 で全ブロックに ID があれば `changed: false` / `ensureRecordBlockIds` は richtext 以外と壊れた値を触らない
- [ ] catalog に `"@tiptap/extension-unique-id": 3.31.4` を足し、ui の dependencies に追加。`pnpm install`
- [ ] ui: `RICH_TEXT_SCHEMA_VERSION` を metamodel から再 export(既存 import を壊さない)。`UniqueID.configure({ attributeName: BLOCK_ID_ATTR, types: ["paragraph", "heading", "bulletList", "orderedList", "blockquote", "codeBlock", "horizontalRule", ASSET_IMAGE_NODE_NAME] })` を extensions に足す。`onUpdate` では `transaction.getMeta("addToHistory") === false` の更新(UniqueID の `onCreate` の付与)を onChange に流さない。**実装前に** `node_modules/@tiptap/extension-unique-id` の `onCreate` が dispatch する transaction の meta を読み、同じ判定を使えるか確かめる(別の meta なら、その meta で判定する。判定に使った meta 名をコメントに書く)
- [ ] ui テスト: v2 の文書(箇条書きの中に段落あり、最上位は ID 付き・入れ子は ID 無し)で `RichTextEditor` を描画して onChange が呼ばれない / 利用者が改行して新しい段落を作ると onChange の doc の新ブロックに `attrs.id` がある(既存 `rich-text-editor.test.tsx` の作法に従う)
- [ ] admin: `record-form.tsx` の `asRichTextValue`(richtext の値をエディタに渡す所)で `ensureTopLevelBlockIds` を通す。`EMPTY_RICH_TEXT_DRAFT` の `schemaVersion` は定数に。`richtext-flow.test.tsx` に「v1 の record を開いただけでは push(outbox)が増えない」を足す
- [ ] api: `writeRecordCore` で validate 後・`computeChangeSet` の前に `ensureRecordBlockIds(definition, parsed.data)` を通し、永続化する data にする。`ops/read.ts` の `record_get` は `ensureRecordBlockIds` を通した data を返す(DO は書かない)
- [ ] api テスト(`test/block-ids.test.ts`): v1 の body を `writeRecord` すると保存される data は版 2 で全最上位ブロックに `attrs.id` / 同じ v1 を 2 回書くと 2 回目は `applied: false` / 直接 SQL で v1 を保存した record を `invoke("record_get")` すると出力に導出 ID があり、保存行は変わらない / 重複 ID を含む入力は 2 つ目が振り直される
- [ ] `pnpm typecheck && pnpm lint && pnpm format && pnpm test`。コミット `feat(richtext): 最上位ブロックに安定 ID を付ける(schemaVersion 2)`

## Task 2(M2-2): Markdown ⇄ AST の双方向変換(`@plyrs/richtext`)

**Files:** `packages/richtext/package.json`、`packages/richtext/tsconfig.json`、`packages/richtext/vitest.config.ts`、`packages/richtext/src/{index,vocabulary,extensions,markdown,plain-text}.ts`(+ tests)、`pnpm-workspace.yaml`(catalog は不要、workspace の包含のみ)、`apps/api/package.json`、`apps/api/src/mcp/server.ts`、`apps/api/src/mcp/richtext-markdown.ts`(削除)、`apps/api/src/mcp/richtext-markdown.test.ts`(削除、内容は新パッケージのテストへ)、`apps/api/test/richtext-workerd.test.ts`、`apps/admin/src/lib/richtext-text.ts`(削除)+ 参照元、`packages/ui/src/{record-mention,asset-image}.ts`(属性の既定値を vocabulary から)、`apps/admin/src/lib/mention-contract.test.ts`、`docs/design-spec.md` 16.10(文法の確定を 1 行)

**Interfaces:**
- Produces: `HEADING_LEVELS = [1, 2, 3]`、`REF_ATTRIBUTES`(recordType / recordId / label の既定値)、`ASSET_IMAGE_HREF_PREFIX = "plyrs://asset/"`、`richTextToMarkdown(envelope: RichTextEnvelope): string`、`markdownToRichText(markdown: string): { ok: true; envelope: RichTextEnvelope } | { ok: false; code: "unsupported_markdown"; message: string; unsupported: string[] }`(返す envelope は `ensureTopLevelBlockIds` 済み・版 2)、`richTextPlainText(envelope, limit?)`(admin の既存関数と同じ挙動。`limit` 省略時は切らない)、`workerExtensions(): AnyExtension[]`
- Consumes: Task 1 の `ensureTopLevelBlockIds`、metamodel の `RECORD_MENTION_NODE_TYPE` / `ASSET_IMAGE_NODE_TYPE`

- [ ] **最初に workerd での動作確認**: `apps/api/test/richtext-workerd.test.ts` に `markdownToRichText("# 見出し\n\n本文")` が `ok: true` を返すテストを書く(`@plyrs/richtext` を api の dependencies に足した直後)。`marked` と `@tiptap/pm` が workerd で動くことの確認(M0-2 結果の引き継ぎ 2)。動かなければここで止まり、ロードマップ 5 章のリスクに従って報告する
- [ ] パッケージの骨格: `name: "@plyrs/richtext"`、dependencies は `@plyrs/metamodel`、`@tiptap/core`、`@tiptap/markdown`、`@tiptap/pm`、`@tiptap/starter-kit`、`@tiptap/extension-mention`(いずれも `catalog:`)。vitest は node 環境(DOM を使わないことの保証)
- [ ] `vocabulary.ts`: 上の定数。`extensions.ts`: 試作 `extensions.ts` の `RecordMention`(Mention.extend + `createInlineMarkdownSpec`)と `AssetImage`(`markdownTokenName: "image"`、`parseMarkdown` は `plyrs://asset/` 以外の href を **例外** `UnsupportedMarkdownError("external_image")` にする。試作の `return []` だと黙って落ちる)。StarterKit は `heading: { levels: HEADING_LEVELS }`、`link: { openOnClick: false }`
- [ ] `markdown.ts`: `MarkdownManager` を遅延生成。`markdownToRichText`: (1) 空文字・空白のみ → 空段落 1 つ、(2) `manager.parse`、(3) heading の `level > 3` を 3 に丸める(再帰)、(4) `getSchema(workerExtensions())` で `Node.fromJSON(schema, json).check()`、失敗は `unsupported_markdown`(message に ProseMirror のメッセージ、`unsupported` に検出した構文: 表 `table`、タスクリスト `task_list`、外部画像 `external_image`、その他 `invalid_structure`。表とタスクリストは parse 前に正規表現で検出する: 行頭 `|` が 2 行以上連続 / `- [ ]` `- [x]`)、(5) `ensureTopLevelBlockIds`
- [ ] 忠実度テスト: 試作の `fixtures.ts`(19 件)と `normalize.ts` を移植し、AST → Markdown → AST が `normalize` 後に一致することを全件で固定。`markdown-input.test.ts` の 7 件(h4 → 3、表 → `unsupported_markdown` with `table`、タスクリスト、外部画像、生 HTML は段落、空文字 → 空段落、入れ子引用と start=3)
- [ ] `plain-text.ts`: admin の `richtext-text.ts` を移し、admin の参照(`record-form.tsx`、`list-cells.ts` 等 `grep richTextPlainText`)を `@plyrs/richtext` に向ける。admin の `richtext-text.test.ts` は新パッケージへ
- [ ] api: `mcp/server.ts` の `richTextToMarkdown` を `@plyrs/richtext` から import、`mcp/richtext-markdown.ts` を削除。ui: `record-mention.ts` / `asset-image.ts` の属性定義を `REF_ATTRIBUTES` ベースに(表示部分は変えない)。`mention-contract.test.ts` に「ui の見出しレベルと `HEADING_LEVELS` が一致」を足す
- [ ] `docs/design-spec.md` 16.10 の「独自ノードの Markdown 文法は M2-2 で確定する」を確定した文法に書き換える。ロードマップ 7 章の該当行も更新
- [ ] `pnpm typecheck && pnpm lint && pnpm format && pnpm test`。コミット `feat(richtext): Markdown と AST の双方向変換を @plyrs/richtext に置く`

## Task 3(M2-3a): 変更履歴の表と `writeRecord` での記録

**Files:** `packages/sync-protocol/src/via.ts`(+ index.ts)、`apps/api/src/ops/spec.ts`(`Via` の再 export)、`packages/db/src/schema.ts`、`packages/db/drizzle/<生成>`、`apps/api/src/do/history.ts`(+ `history.test.ts` は workerd テスト `apps/api/test/history.test.ts`)、`apps/api/src/do/types.ts`、`apps/api/src/do/write-record.ts`、`apps/api/src/tenant-do.ts`(`writeRecord` / `createAssetRecord` / `moduleWrite` / `modulePublicWrite` / alarm の書き込みに `via`)、`apps/api/src/sync/handlers.ts`(`via: "sync"`)、`apps/api/src/routes/tenant.ts`(`via: "rest"`)、`docs/design-spec.md` 16.5(逆差分と publish 版全文の 2 点を追記)

**Interfaces:**
- Produces(sync-protocol): `VIAS = ["sync", "mcp", "rest"] as const`、`type Via`、`type ConflictMode = "merge" | "strict"`、`conflictModeFor(via: Via): ConflictMode`
- Produces(db): 表 `record_history`: `record_id text`、`history_seq integer`(record ごとの連番、1 から)、`kind text`(`write` | `publish` | `unpublish` | `delete` | `restore`)、`version integer`(`records.version`)、`source_version integer`(publish / unpublish のときだけ)、`status text`、`data text`(全文 JSON。差分化されたら NULL)、`diff text`(1 つ新しい版からの逆差分 JSON `{ set: Record<string, unknown>; unset: string[] }`。全文のときは NULL)、`field_versions text`、`actor text`、`via text`、`token_id text`、`client_id text`、`restored_from integer`、`created_at text`(版を開いた時刻)、`updated_at text`(最後に畳み込んだ時刻)。PK `(record_id, history_seq)`、index `(record_id, kind)`
- Produces(api): `HISTORY_FOLD_WINDOW_MS = 15 * 60_000`、`HISTORY_FULL_VERSIONS = 10`、`HISTORY_MAX_VERSIONS = 100`、`HISTORY_MAX_AGE_MS = 365 日`、`interface HistoryActor { actor: string; via: Via; tokenId?: string; clientId?: string }`、`recordHistory(sql, now: string, entry: { recordId; kind; version; sourceVersion?; status; data; fieldVersions; restoredFrom? } & HistoryActor): number`(返り値は history_seq。`kind: "write"` で区切り条件に当たらなければ最新版を更新して同じ seq を返す。挿入後に差分圧縮と保持を適用)、`loadHistory(sql, recordId, { limit, cursor }): { items: HistoryEntry[]; nextCursor }`(新しい順、`data` は含めず `changedFields` を付ける)、`loadVersion(sql, recordId, historySeq): HistoryVersion | null`(差分を辿って全文を復元)、`compareVersions(before: Record<string, unknown>, after: Record<string, unknown>): { key: string; before: unknown; after: unknown }[]`
- `WriteRecordParams` に `via: Via`、`tokenId?`、`clientId?`、`restoredFrom?: number` を足す(`actor` と同じくサーバー側で合成。`WriteRecordInput` は `Omit<..., "actor" | "via" | "tokenId" | "clientId" | "restoredFrom">`)

- [ ] sync-protocol に `via.ts` を足し、テスト: `conflictModeFor("sync") === "merge"`、mcp / rest は strict。api の `ops/spec.ts` は `Via` を再 export
- [ ] `schema.ts` に `recordHistory` を足し、`pnpm --filter @plyrs/db generate` → `pnpm format`。生成 SQL を目で確かめる
- [ ] `history.ts` のテスト(workerd、`env.TENANT_DO` の SQL を直接使うのではなく `writeRecord` 経由で観察する既存テストの作法と、`history.ts` を純関数寄りに直接呼ぶ単体の両方): 同じ actor / via の連続書き込みは 1 版に畳まれる / actor が変わると新しい版 / via が変わると新しい版 / 15 分以上空くと新しい版(`now` を注入) / status 変更で新しい版 / 11 版目で最古が差分になり `loadVersion` が全文を返す / 101 版目で最古が消える / **120 版書いて途中に `kind: "publish"` を 2 回挟み、残る全版の `loadVersion` が全文を返し、publish 版は 100 版を超えても残る**(Review Focus 2)/ 365 日より古い版は消える / `changedFields` は前の版との差分キー
- [ ] `history.ts` を実装。逆差分の作り方: 版 k を差分化するとき `set` = k にあって k+1 と値が違うキー(k の値)、`unset` = k に無く k+1 にあるキー。復元は最新の全文版から順に `set` / `unset` を適用して下る。差分化の対象は「最新から 11 番目で全文かつ kind が publish / unpublish 以外」(挿入 1 回につき最大 1 版)。保持は最古側から、`history_seq` 順で 100 を超える分と `updated_at` が 365 日より古いもののうち publish / unpublish 以外を消す
- [ ] `writeRecordCore` の `UPDATE/INSERT` の後に `recordHistory(... kind: params.restoredFrom === undefined ? "write" : "restore", ...)` を呼ぶ。`applied: false` のときは記録しない
- [ ] 呼び出し元に `via` を通す: `handlePush` は `"sync"`、`writeRecord` RPC は引数 `via: Via` を足して REST は `"rest"`、`createAssetRecord` / `moduleWrite` / `modulePublicWrite` / alarm 内の書き込みは `"rest"`(モジュールと公開 write は HTTP 経路。コメントに理由を書く)
- [ ] design-spec 16.5 に「古い版は 1 つ新しい版からの逆差分」「publish / unpublish の版は全文」を追記(決定 41 の仮置きの具体化。決定ログは変えない)
- [ ] `pnpm typecheck && pnpm lint && pnpm format && pnpm test`。コミット `feat(api): record の変更履歴を DO 内に記録する`

## Task 4(M2-3b): publish と delete の履歴の記録点

**Files:** `apps/api/src/do/publish.ts`、`apps/api/src/do/delete-record.ts`、`apps/api/src/tenant-do.ts`、`apps/api/src/sync/handlers.ts`、`apps/api/src/routes/tenant.ts`、`apps/api/test/history-publish.test.ts`

**Interfaces:**
- `PublishDeps` に `history: HistoryActor` を足す(`writeSnapshot` が記録する)。`publishRecordCore(deps, recordId, actor, tenantSlug)` の `actor` は `deps.history.actor` に統合(引数を減らす)。`unpublishRecordCore(deps, recordId)` も `deps.history` で記録。`cascadeUnpublish` は delete の記録点と重複するので履歴を書かない(`deps.history` を省けるよう `history?: HistoryActor` にし、無ければ記録しない)
- `DeleteDeps` に `history: HistoryActor`。`deleteRecordCore` は tombstone の後に `kind: "delete"`、`data: prev.data` で記録

- [ ] テスト: publish すると `kind: "publish"` の版が `source_version = records.version` で入る / カスケードで publish された asset にも版が入る / unpublish で `kind: "unpublish"` / delete で `kind: "delete"` に削除前の data が残る / publish 直後の書き込みは畳まれず新しい `write` 版になる / 公開済み record の delete は `delete` 版 1 つだけ(カスケード unpublish は記録しない)
- [ ] 実装。`tenant-do.ts` の `publishRecord` / `unpublishRecord` / `deleteRecord` RPC と `handlePush` の delete に `via` を渡す(REST は `"rest"`、push は `"sync"`)
- [ ] `pnpm test`(api)。コミット `feat(api): publish・unpublish・delete の履歴を記録する`

## Task 5(M2-4): 履歴の操作をカタログへ(`invoke` の書き込み対応)

**Files:** `apps/api/src/ops/read.ts`(`OpContext`)、`apps/api/src/ops/invoke.ts`、`apps/api/src/ops/history.ts`、`apps/api/src/ops/catalog.ts`、`apps/api/src/do/restore-record.ts`、`apps/api/src/tenant-do.ts`、`apps/api/src/rpc-unwrap.ts`、`apps/api/src/routes/tenant.ts`、`apps/api/test/ops-history.test.ts`、`apps/api/test/ops-rest.test.ts`

**Interfaces:**
- `OpContext` を拡張: `{ sql; tenantId; tenantSlug: string | null; via: Via; auth: AuthContext | McpAuth; deps: { nextSeq; now; newId; nextPublishSeq; newEventId; scheduleModuleAlarm }; effects: { changedRecordIds: Set<string> } }`。ハンドラは書いた record の id を `effects.changedRecordIds` に足す
- `InvokeResult` の失敗 `code` に `"conflict" | "already_exists" | "unsupported_markdown" | "validation_failed" | "record_deleted" | "unique_violation" | "invalid_status" | "unknown_type" | "not_published" | string`(モジュール拒否 `${moduleId}:${reason}` を通すため `string` を含む。既存の `WriteErrorCode` と同じ扱い)、`details?: unknown`
- `TenantDO.invoke(op, input, auth, options?: { tenantSlug?: string }): Promise<InvokeResult>`(async に変わる。読み取り専用の操作でも transactionSync で包む: 読み取りだけなら空のトランザクションでコストは無視できる。`hints.readOnly` が true の操作は transactionSync を使わず従来どおり同期で実行してよい)。コミット後: `effects.changedRecordIds` の各 id を `loadSyncRecord` して `broadcastAll({type: "change"})`、`countUnsent > 0` なら `armSweep` + `drainOutbox`、module events も同様(`writeRecord` RPC と同じ形)
- `via` の決定: `auth` が `McpAuth`(`scopes` あり)なら `"mcp"`、それ以外は `"rest"`(`invoke` は同期経路から呼ばれない)
- 操作: `record_history`(input `{ recordId: uuid; limit?: 1..100 = 20; cursor?: string }`、output `{ items: HistoryEntry[]; nextCursor }`、requires `record:read`、via `["mcp", "rest"]`、readOnly)/ `record_compare`(input `{ recordId; from: number | "published"; to?: number | "current" }`(`from` に `"published"` は `published_snapshots` の `data`、`to` 省略は現在の record)、output `{ from: VersionRef; to: VersionRef; fields: { key; before; after }[] }`、requires `record:read`)/ `record_restore`(input `{ recordId; historySeq: number }`、output `RecordSnapshot`、requires `record:write`、hints `destructive: false, idempotent: true`。削除済み record は `deleted_at` を NULL に戻してから `writeRecordCore` を `restoredFrom: historySeq` で通す。型定義が変わっていれば `validation_failed`)
- REST の生成面: `POST /v1/t/:tenantId/ops/:op` body = 操作の input。`via` に `"rest"` を含む操作だけ受け、含まなければ 404。`InvokeResult` の `ok: false` は `statusFor(code)` で HTTP に写す(`conflict` → 409、`already_exists` → 409、`insufficient_scope` → 403、`unknown_operation` → 404、`invalid_input` / `unsupported_markdown` → 400)。`record_publish` のように `tenantSlug` が要る操作のために、`OpSpec` に `needsTenantSlug?: true` を足し、ルートはそのときだけ D1 から slug を引く(現在の publish ルートと同じ 1 照会)

- [ ] `restore-record.ts` のテスト: 版 2 を restore すると data / status がその版になり `restored_from = 2` の `restore` 版が増える / 削除済み record の restore で `deleted_at` が NULL に戻り同期の `change` が届く(`countSockets` を使う既存の WS テストの作法)/ 型定義から外れた値は `validation_failed`
- [ ] `ops-history.test.ts`: `record_history` の新しい順と cursor / `record_compare` の `published` と現在の差分、版 1 と版 3 の差分 / `record_restore` が `record:read` だけのスコープで `insufficient_scope` / viewer のロールで `forbidden`
- [ ] `tenant-do.ts` の `invoke` を async にし、上の形に。`rpc-unwrap.ts` の `asInvokeResult` は型だけ更新。`mcp/server.ts` の `invoke` 呼び出しは `await` 済みなので変更なし(戻りが Promise になるだけ)
- [ ] `routes/tenant.ts` に `/:tenantId/ops/:op` を足し、`ops-rest.test.ts`: `record_history` を JWT で呼べる / `type_list`(via が mcp のみ)は 404 / 不正な input は 400 と `issues`
- [ ] `pnpm typecheck && pnpm lint && pnpm format && pnpm test`。コミット `feat(api): 履歴の操作(history / compare / restore)をカタログに足す`

## Task 6(M2-5): 管理画面の履歴画面

**Files:** `apps/admin/src/lib/history.ts`(+ test)、`apps/admin/src/lib/admin-api.ts`、`apps/admin/src/lib/labels.ts`、`apps/admin/src/lib/api-paths.ts`(必要なら)、`apps/admin/src/routes/t/$tenantSlug/content/$typeKey/$recordId_/history.tsx`、`apps/admin/src/components/record-editor.tsx`(ヘッダに「履歴」リンク)、`apps/admin/src/components/history/*.tsx`(一覧・差分・復元ダイアログ)、テスト、`apps/e2e/tests/history.spec.ts`

**Interfaces:**
- Consumes: Task 5 の REST `POST /v1/t/:tenantId/ops/record_history` / `record_compare` / `record_restore`
- Produces(admin-api): `invokeOperation<T>(tenantId, op, input): Promise<T>`、`listHistory(tenantId, recordId, cursor?)`、`compareVersions(tenantId, recordId, from, to?)`、`restoreVersion(tenantId, recordId, historySeq)`
- `lib/history.ts`(純関数): `viaLabel(via)`(sync → 「管理画面」、mcp → 「MCP」、rest → 「API」)、`kindLabel(kind)`、`summarizeEntry(entry, members)`(「○○ が MCP から 3 フィールドを変更」)、`formatFieldDiff(field, before, after, definition)`(richtext は `richTextPlainText` で抜粋、relation は参照 ID、その他は JSON 文字列)

- [ ] `lib/history.ts` のテスト → 実装
- [ ] 画面: パンくず「コンテンツ › 型 › record › 履歴」。左に版の一覧(時刻・actor(メンバー名、無ければ ID 先頭 8 桁)・経路のバッジ・kind・変更フィールド数)、選んだ版の右に「現在との差分」(フィールドごとに前後)。「この版に戻す」ボタンは確認ダイアログを経て `record_restore` を呼び、成功したら record の編集画面へ戻る。`useCan("record:write")` が無ければボタンを出さない。公開版がある record には一覧の先頭に「公開版」の疑似行(`record_compare` の `from: "published"`)
- [ ] `record-editor.tsx` のヘッダに履歴へのリンク(既存の `TenantPageHeader` の actions に足す)
- [ ] テスト(jsdom): 一覧の表示(MCP バッジ)、差分の表示、復元の確認 → API 呼び出し、viewer では復元ボタンが無い
- [ ] E2E `history.spec.ts`(`core-journey` に依存): record を 2 回編集 → 履歴画面に 2 版以上 → 最初の版に戻す → 編集画面の値が戻っている
- [ ] `pnpm --filter @plyrs/admin test && pnpm typecheck && pnpm lint && pnpm format`。E2E は Task 11 の後にまとめて 1 回走らせる(`.wrangler` を消すため)。コミット `feat(admin): record の履歴画面を追加する`

## Task 7(M2-6): 競合判定のモード

**Files:** `packages/sync-protocol/src/resolve.ts`(+ `resolve.test.ts`)、`apps/api/src/sync/handlers.ts`

**Interfaces:**
- `resolveSyncWrite(contentType, change, current, mode: ConflictMode = "merge"): SyncResolution`。strict: `changedFields` のどれか 1 つでも `baseFieldVersions[key] ?? 0 !== current.fieldVersions[key] ?? 0` なら型を問わず conflict。`current === null` は apply(新規)。merge は現行どおり
- `FieldConflict` は変えない。strict の conflict に現在値を添えるのは呼び出し側(Task 8 の `record_update`)

- [ ] テスト: strict でスカラーの version 不一致が conflict / strict で `baseFieldVersions` にキーが無く current が 1 以上なら conflict(Review Focus 3)/ merge は従来のテストが全部通る / strict で全フィールド一致なら apply と merge 結果
- [ ] 実装。`handlePush` は `conflictModeFor("sync")` を明示して渡す
- [ ] コミット `feat(sync-protocol): 競合判定に strict モードを足す`

## Task 8(M2-7a): 書き込み操作のカタログ移設

**Files:** `apps/api/src/ops/write.ts`、`apps/api/src/ops/catalog.ts`、`apps/api/src/ops/invoke.ts`、`apps/api/src/tenant-do.ts`、`apps/api/test/ops-write.test.ts`

**Interfaces:**
- `record_create`: input `{ type: string; recordId: uuid; input: Record<string, unknown>; status?: WorkflowStatus }`、output `RecordSnapshot`、requires `record:write`、hints `{ readOnly: false, destructive: false, idempotent: true }`、via `["mcp", "rest"]`。既存 record があれば: 型が同じで `loadSyncRecord(id).input` と `input` の正規化 JSON(`canonicalJson`)が一致し status も一致 → 既存を `ok` で返す。違えば `already_exists`(message に「別の ID を使う」)。無ければ `writeRecordCore`
- `record_update`: input `{ recordId; input; changedFields?: string[]; baseFieldVersions: Record<string, number>; status? }`(`changedFields` 省略時は `Object.keys(input)`)、output `RecordSnapshot`、hints `{ idempotent: false, destructive: false }`。`resolveSyncWrite(definition, change, current, conflictModeFor(ctx.via))` で判定し、conflict は `{ ok: false, code: "conflict", details: { conflicts, current: RecordSnapshot } }`。record が無ければ `not_found`、削除済みは `record_deleted`
- `record_delete`: input `{ recordId }`、output `{ recordId; deletedAt }`、requires `record:delete`、hints `destructive: true, idempotent: true`。既に削除済みなら `ok`(16.7)
- `record_publish`: input `{ recordId }`、output `{ recordId; sourceVersion; publishedAt }`、requires `record:publish`、`needsTenantSlug: true`、idempotent(`published_snapshots.source_version === records.version` なら何も書かずに `ok`)。`record_unpublish`: 未公開なら `ok`
- ロードマップの `tools/list` への影響: この 5 操作は `via` に `"mcp"` を含めるので `tools/list` に現れる。**M4-1 までは MCP の `tools/list` から外す**(`via: ["rest"]` のまま M4-1 で `"mcp"` を足す)。理由: ツール説明・outputSchema の oneOf・`attempt` は M4-1 の仕事で、中途半端な書き込みツールを限定公開に出さない
- モジュール型の書き込みガード(`moduleWriteDenial`)は `writeRecord` RPC と同じ位置(型を引いた直後、no-op 判定の前)で判定する

- [ ] `ops-write.test.ts`(workerd): create → 同じ内容で再 create は同じ snapshot / 内容が違えば `already_exists` / update の strict conflict に `details.current` と `conflicts` / `baseFieldVersions` の欠けは conflict / update 成功で `fieldVersions` が上がり履歴に `via: "mcp"`(McpAuth)/ delete の冪等 / publish の冪等と outbox への投入(`pendingOutbox`)/ unpublish 未公開は ok / `record:write` だけのスコープで publish は `insufficient_scope` / WS 接続中のソケットに `change` が届く(Review Focus 4)/ モジュール型を editor が書くと `booking:...` 相当の拒否
- [ ] 実装。`tenant-do.ts` の既存 RPC `writeRecord` / `deleteRecord` / `publishRecord` / `unpublishRecord` は残す(同期・asset・モジュール経路が使う)。REST の切り替えは Task 9
- [ ] `pnpm typecheck && pnpm lint && pnpm format && pnpm test`。コミット `feat(api): 書き込み操作をカタログに移す`

## Task 9(M2-7b): REST の `PUT /records/...` を `baseFieldVersions` 必須にする

**Files:** `apps/api/src/routes/tenant.ts`、`apps/api/test/rest-records.test.ts`(既存の PUT テストがあればそこ)、`apps/admin/src/lib/admin-api.ts`、`apps/admin/src/lib/*.test.ts`(モック)

**Interfaces:**
- `PUT /v1/t/:tenantId/records/:typeKey/:recordId` body `{ input; changedFields?; baseFieldVersions: Record<string, number>; status? }`。record が無ければ `invoke("record_create", { type: typeKey, recordId, input, status })`、あれば `invoke("record_update", ...)`。`baseFieldVersions` が無い body は 400。`DELETE /records/:recordId` は `invoke("record_delete")`(R2 の後始末は現状どおり)、`POST .../publish` / `.../unpublish` は `invoke("record_publish" / "record_unpublish")`(slug の照会は現状どおり)
- 旧 RPC `writeRecord` / `deleteRecord` / `publishRecord` / `unpublishRecord` は REST からは呼ばれなくなる。同期・asset・モジュールは引き続き使う

- [ ] テスト: `baseFieldVersions` 無しは 400 / 競合は 409 と `details.current` / 新規は 200 / delete・publish・unpublish の HTTP ステータスが従来のテストと同じ(`record_deleted` 410 など `statusFor` の表に `conflict` / `already_exists` を足す)
- [ ] 実装。admin の `admin-api.ts` に PUT があればシグネチャを合わせ、単体テストのモックを直す(ロードマップ: 実行時コードと E2E に呼び出しは無い)
- [ ] コミット `feat(api): REST の record 書き込みを baseFieldVersions 必須にしてカタログへ流す`

## Task 10(M2-8): 型とフィールドの description、型単位の執筆ガイド

**Files:** `packages/metamodel/src/content-type.ts`(+ test)、`packages/metamodel/src/record-schema.ts`、`packages/db/src/schema.ts` + `drizzle/<生成>`、`apps/api/src/do/content-types.ts`、`apps/api/src/mcp/server.ts`、`apps/api/test/mcp-tools.test.ts`、`apps/admin/src/lib/content-type-form.ts`(+ test)、`apps/admin/src/components/content-types/type-editor.tsx`、`apps/admin/src/lib/labels.ts`、`docs/design-spec.md` 16.11

**Interfaces:**
- metamodel: `CONTENT_TYPE_WRITING_GUIDE_MAX_LENGTH = 4000`、`contentTypeDefinitionSchema` に `writingGuide: z.string().trim().min(1).max(4000).optional()`。`buildFieldValueSchema` は `field.description` があれば `.describe(description)` を付け、`buildRecordInputSchema` は `recordInputJsonSchema(definition): JsonSchema`(`z.toJSONSchema`、`title` に型名、`description` に型の description)を新設
- db: `content_types.writing_guide text`。`ContentTypeRow` / `rowToDefinition` / `displayColumns` に追従(`description` と同じ作法)
- mcp: resource `plyrs://types/{key}/schema`(record の input の JSON Schema)、prompt `writing_guide`(引数 `type`。本文は型の description、執筆ガイド、フィールドごとの label / description / 必須)。`type_get` / `type_list` の出力は定義そのものなので `writingGuide` が自然に載る(スキーマが `typeSummarySchema` を `contentTypeDefinitionSchema.extend` で作っているため追従する)。server の `instructions` に「型の執筆ガイドは prompt writing_guide か type_get の writingGuide で読む」を足す

- [ ] metamodel のテスト: `writingGuide` の長さ上限 / `recordInputJsonSchema` に field の description と required が出る
- [ ] db の generate → format。DO の行変換を更新(`content-types.test.ts` に `writingGuide` の往復)
- [ ] mcp のテスト: `resources/read plyrs://types/article/schema` が JSON Schema を返す / `prompts/list` に `writing_guide` / `prompts/get` の本文に執筆ガイドが入る
- [ ] admin: 型の編集画面に「執筆ガイド」の複数行欄(description の下)。`content-type-form.ts` の draft / validate / toDefinition に追従、テスト
- [ ] design-spec 16.11 の該当文を「M2-8 で実装」に更新
- [ ] `pnpm typecheck && pnpm lint && pnpm format && pnpm test`。コミット `feat: 型の執筆ガイドを足し、型スキーマと prompt で配る`

## Task 11(M2-9): 下書きを含む全文検索(FTS5)と `record_search`

**Files:** `packages/db/drizzle/<custom>`(FTS5 DDL)、`apps/api/src/do/search.ts`、`apps/api/src/do/write-record.ts`、`apps/api/src/do/delete-record.ts`、`apps/api/src/do/restore-record.ts`、`apps/api/src/tenant-do.ts`、`apps/api/src/ops/search.ts`、`apps/api/src/ops/catalog.ts`、`apps/api/src/routes/super.ts`、`apps/api/test/search.test.ts`、`apps/e2e/tests/mcp-smoke.spec.ts`(`record_search` を 1 回呼ぶ)、`docs/design-spec.md` 16.9、`CLAUDE.md`(マイグレーションの例外を 1 行)

**Interfaces:**
- DDL: `CREATE VIRTUAL TABLE records_fts USING fts5(record_id UNINDEXED, type UNINDEXED, text, tokenize = 'trigram')`。`drizzle-kit generate --custom --name=records_fts` で空ファイルを作って書く(唯一の手書き)
- `do/search.ts`: `searchText(definition, data): string`(text フィールドの値と richtext の `richTextPlainText` を空白で連結。json / relation / 数値は含めない)、`indexRecord(sql, recordId, type, text)`(DELETE → INSERT)、`removeFromIndex(sql, recordId)`、`reindexAll(sql): number`(全 records(削除済みを除く)を型定義で再抽出。型が無い record は索引から外す)、`searchRecords(sql, { query, type?, limit }): { items: (RecordSummary & { snippet: string })[] }`。問い合わせが 3 文字以上なら `MATCH`(語をダブルクォートで囲んで AND)、2 文字以下なら `text LIKE '%q%'`(Review Focus 5)。`snippet(records_fts, 2, '[', ']', '…', 12)`
- `writeRecordCore` は `applied` のとき `indexRecord`、`deleteRecordCore` は `removeFromIndex`、`restoreRecordCore` の undelete は `writeRecordCore` 経由なので自動
- 起動時の一回限りの再索引: `TenantDO` の constructor(`blockConcurrencyWhile` 内)で `do_config.search_indexed` が無ければ `reindexAll` して `'1'` を書く(既存テナントの既存 record を索引に入れる。マイグレーションでは SQL だけなので型定義の解釈ができない)
- RPC `reindexSearch(): { indexed: number }`、super ルート `POST /super/v1/tenants/:tenantId/search-reindex`(`reproject` と同じ監査 `tenant.search_reindex`。`AuditAction` に追加)
- `record_search`: input `{ query: string(1..200); type?: string; limit?: 1..50 = 20 }`、output `{ items: (RecordSummary & { snippet })[] }`、requires `record:read`、via `["mcp", "rest"]`、cache `{ ttlMs: 0, cacheScope: "private" }`。ツール説明に「下書きを含む。削除済みは含まない。タイトルと本文のプレーンテキストが対象。3 文字以上は全文索引、2 文字以下は部分一致」

- [ ] テスト(workerd): 書き込んだ record の本文の語で見つかる(日本語 3 文字)/ 2 文字の問い合わせでも LIKE で見つかる / 削除すると出ない / restore すると出る / 型で絞れる / `reindexAll` が型定義から外れたフィールドの文字列を落とす / `search_indexed` 未設定の DO が起動時に既存 record を索引に入れる(`wipeTenant` 相当で SQL を直接仕込んでから DO を起こす既存テストの作法)/ MCP の `tools/call record_search` に snippet
- [ ] 実装。DDL の手書きの理由を migration ファイルのコメント(`-- `)と `CLAUDE.md` に 1 行
- [ ] design-spec 16.9 に「tokenizer は trigram、2 文字以下は LIKE」を追記
- [ ] E2E: `mcp-smoke.spec.ts` に `record_search` を 1 回足す。ここで `pnpm --filter @plyrs/e2e test` を走らせる(Task 6 の `history.spec.ts` も含む)
- [ ] `pnpm typecheck && pnpm lint && pnpm format && pnpm test`。コミット `feat(api): DO-SQLite の FTS5 で下書きを含む全文検索を足す`

## Task 12: 仕上げ(ロードマップ・申し送り・PR スタック)

- [ ] `2026-11-01-mcp-roadmap.md` の M2 の表に完了日と PR 番号、6 章の表に本計画ファイル、7 章の次に「9. M2 完了時の申し送り」(判断・保留・未決事項の更新。4 章の「変更履歴の保持本数…」を「M2-3a で実装、M4-6 で実測」に)
- [ ] ブランチ全体のレビュー(別の視点)と Important 以上の修正。結果を `/mnt/project-files/m2/m2-report.md` に M1 と同じ形で書く
- [ ] PR をスタックで作る(M2-1 → … → M2-9 → 仕上げ)。各 PR の本文にマージ順と依存を書く

---

## 完了条件(ゲート G2)

- 全書き込み操作(create / update / delete / publish / unpublish / restore)がカタログ経由で呼べ、REST の `PUT` は `baseFieldVersions` 必須
- 同期・REST・publish・delete のいずれでも履歴が記録され、管理画面から復元できる(E2E `history.spec.ts`)
- v1 のリッチテキストは読むときに決定的な ID を得、次の書き込みで版 2 として永続化される。管理画面で開くだけでは push が起きない
- Markdown ⇄ AST の 19 件の往復テストと、スキーマ外 Markdown の業務エラーが固定されている
- `record_search` が下書きを含む全文検索を返す
- `pnpm lint` / `format:check` / `typecheck` / `test` と E2E が通る
