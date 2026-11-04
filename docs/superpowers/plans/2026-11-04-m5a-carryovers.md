# M5a M4 の申し送りの整理 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** M4 とゲート G4 で残した事項(履歴の容量、indexed でない unique の全件走査、アセットの監査の経路、アップロードトークンの受け取り時の確認、G4 で見つかった小さな不具合)を片付け、M5 の拡張(提案・ブロック単位の競合判定ほか)に入る前の土台を揃える。

**Architecture:** 新しい経路は作らない。履歴は `do/history.ts` の逆差分にリッチテキストのブロック単位の形を足し、作るときに当て直して元に戻ることを確かめてから使う(戻らなければ従来の全文の差分)。unique は DO 内の引き当て用の生成カラムを indexed と別に持ち、起動時に既存テナントへも足す。アセットは `createAssetRecord` が呼び出し元の認可コンテキストから via と tokenId を取り、アップロードの受け取りは発行に使ったトークンとロールを D1 / OAuth の KV で引き直す。PAT のスコープ不足は再認可できないので、HTTP 403 ではなくツールの業務エラーで対処を示す。

**Tech Stack:** Drizzle(DO-SQLite のマイグレーション 1 本)、Hono、`@modelcontextprotocol/server` 2.4.0、`@cloudflare/workers-oauth-provider`、`@plyrs/richtext`、`@cloudflare/vitest-plugin`、Playwright。

**Spec:**
- `docs/design-spec.md` 16.3(認証・スコープ不足)、16.5(履歴の保持と逆差分)、16.8(publish の確認)、16.10(リッチテキスト)、16.11(アセットの 2 経路)、§5・決定 33(unique)
- `docs/superpowers/plans/2026-11-01-mcp-roadmap.md` 2 章 M5、4 章、11 章(M4 完了時の申し送りと G4 の確認結果)
- `/mnt/project-files/m4/m4-report.md` の「履歴の保持の実測」と「見送り・残り」

## 範囲

M5 は、ロードマップ 2 章のとおり各項目が別の詳細計画になる規模の拡張(提案(change set)、ブロック単位の競合判定、モジュールの MCP ツール、公開側 MCP、型ごとのツール、意味検索、サービスアカウント、型単位のスコープ)で、M4 の実利用を見て順番を決める。本書はその最初の計画 **M5a** で、拡張に入る前に M4 の申し送りを片付ける。拡張の項目は本書に含めない(M5b 以降の計画で扱う)。

含めないもの(理由):

- 一意性検査の比較が生成カラムの affinity に従う件: Task 2 で unique のフィールド全般に広がるので、厳しい側(生成カラムの比較)に揃えると決めてテストで固定する(Task 2 の Step 1)。validate-on-write が型に合わない値を新しく書かせないので、差が出るのは型を変える前の古い値だけ
- MCP のブロック操作の replace が入れ子の段落の `attrs.id` を落とす件: 契約(決定 44)の外で参照も無い
- 履歴の `client_id` を MCP の書き込みで埋める件: `McpAuth` が OAuth の clientId を持たない。提案(M5b 以降)で actor の表示を作るときに決める
- Cursor / VS Code / MCP Inspector からの接続確認: 所有者の手元の作業(下の「所有者にお願いすること」)

## Global Constraints

- **既存経路を通す**: 書き込みは `writeRecordCore`、アセットは `storeAsset` → `createAssetRecord` RPC。MCP 専用の書き込み処理を DO に作らない
- **履歴の保持の数値(100 版 / 365 日 / 全文 10)は変えない**(M4-6 の実測で据え置き)。変えるのは逆差分の形だけ
- **旧い履歴の行を書き換えない**。M4 までの `{ set, unset }` の逆差分は読めるまま残し、新しく差分にする行だけが新しい形を使う
- **公開 API と DO の一覧の絞り込みの意味は変えない**。絞り込めるのは従来どおり `indexed` のフィールドだけ(unique の引き当て用カラムは絞り込みに使わない)
- **OAuth のスコープ不足は従来どおり HTTP 403 `insufficient_scope`(step-up)**。PAT だけを業務エラーに変える
- DO の RPC 戻り値は `rpc-unwrap.ts` の `asXxx()` で戻す。`@ts-expect-error` は禁止。マイグレーションは `pnpm --filter @plyrs/db generate` で生成し手書きしない(生成後に `pnpm format`)
- コメント・ドキュメント・コミットメッセージ・ツール説明は日本語、用語は `docs/glossary.md` に従う。コミットは各タスクの最後に 1 つ
- 決定ログは 53 から。決定 53(ブロック単位の逆差分)、54(unique の引き当て用カラム)、55(PAT のスコープ不足は業務エラー)を本書で足す
- PR は M4 と同じスタック。計画 PR は `claude/project-thread-rzeg1o`、各タスクは `claude/project-thread-rzeg1o-m5a-<番号>`(前のタスクを base にする)
- 各 PR の前に `pnpm lint` `pnpm format:check` `pnpm typecheck` と、触ったパッケージの vitest を通す

## Review Focus

1. **ブロックの差分が元に戻らない文書**: 新しい側の本文に同じ ID のブロックが 2 つある、ID の無いブロックがある、本文がエンベロープでない(旧い値・壊れた値)とき、`loadVersion` で読んだ古い版が書いたときの値と正規化 JSON で一致すること(差分は従来の全文に落ちる。Task 1)
2. **デプロイ前の逆差分の行**: M4 までに作られた `{ set, unset }` だけの行を含む鎖でも、`loadVersion` / `record_compare` / `record_restore` が従来どおり動くこと(Task 1)
3. **既存テナントの indexed でない unique**: デプロイ前から unique だけを付けていたフィールド(モジュールの型 `booking.notification.reservation_id` を含む)に引き当て用カラムがまだ無い間に、管理画面での型の保存や起動時のモジュールの型の更新が unique / indexed を付け外ししても、「duplicate column」や「no such column」で失敗しないこと。カラムを足し終えるまでの重複検査は従来の走査で正しく働くこと(Task 2)
4. **アップロードトークンの発行後の失効と降格**: 発行に使った PAT を失効する、OAuth の付与を失効する、ロールを viewer に下げる、会員から外す、のいずれの後でも、受け取りが 403 で R2 に何も残らないこと(Task 4)
5. **PAT のスコープ不足が DO を起こさない**: `record:publish` の無い PAT の `tools/call record_publish` が、HTTP 200 の `isError` で返り、DO の `invoke` が呼ばれず、Rate Limiting の枠も消費しないこと(Task 5)

---

## ファイル構成

| ファイル | 責務 |
| --- | --- |
| `apps/api/src/do/history.ts` | 変更。逆差分にブロック単位の形 `blocks` を足す(作成・適用・検証) |
| `apps/api/src/do/index-ddl.ts`、`apps/api/src/do/unique-check.ts`、`apps/api/src/do/hooks.ts`、`apps/api/src/do/alarms.ts`、`apps/api/src/tenant-do.ts` | 変更。引き当て用カラム(`lookupColumns`)、実在するカラムを見る DDL、alarm での段階的な追加 |
| `packages/db/src/schema.ts`、`packages/db/drizzle/` | 変更。`asset_upload_tokens.token_kind` |
| `apps/api/src/tenant-do.ts`(`createAssetRecord`)、`apps/api/src/assets/store.ts`、`apps/api/src/mcp/worker-ops.ts`、`apps/api/src/mcp/uploads.ts`、`apps/api/src/do/asset-uploads.ts` | 変更。アセットの via と tokenId |
| `apps/api/src/mcp/issuing-token.ts` | 新規。発行に使ったトークンが今も有効かと、今のロールを引く |
| `apps/api/src/oauth/grants.ts` | 変更。`hasGrant` を export |
| `apps/api/src/mcp/route.ts`、`apps/api/src/ops/invoke.ts`、`apps/api/src/mcp/worker-ops.ts` | 変更。PAT のスコープ不足を業務エラーに、スコープ判定のヘルパー |
| `apps/api/src/assets/fetch-url.ts`、`apps/api/src/mcp/confirm.ts`、`apps/api/src/do/write-record.ts` | 変更。G4 の小さな不具合 |
| `apps/e2e/tests/mcp-write.spec.ts` | 変更。PAT のスコープ不足の期待値 |
| `docs/design-spec.md`(16.3・16.5・16.11・§5・決定ログ 53〜55)、`docs/deploy.md`(3.6)、ロードマップ、`/mnt/project-files/m5/m5a-report.md` | 変更・新規 |

---

## Task 1(M5a-1): リッチテキストの逆差分をブロック単位にする(決定 53)

M4-6 の実測では、本文を 1 段落直しただけでも逆差分に本文全体が入り、差分 1 版が約 11.7 KB(全文 1 版の約 12.8 KB とほぼ同じ)だった。最上位ブロックには安定 ID がある(決定 44・46)ので、古い版の本文を「新しい版のブロックの参照」と「変わったブロックの実体」の列で持つ。

**Files:** Modify `apps/api/src/do/history.ts`。Test: `apps/api/test/history.test.ts`、`apps/api/test/history-retention.test.ts`

**Interfaces:**
- Produces(`history.ts`、export はテストのため):
  ```ts
  // 古い版の本文 = エンベロープの doc.content 以外は base、content は ref(新しい版の同じ ID の最上位ブロック)か実体
  export interface BlockPatch {
    base: Record<string, unknown>; // 古い版の値から doc.content を除いたもの({ schemaVersion, doc: { type, attrs? } })
    content: Array<{ ref: string } | { node: unknown }>;
  }
  interface ReverseDiff {
    set: Record<string, unknown>;
    unset: string[];
    blocks?: Record<string, BlockPatch>; // M5a 以降の行だけが持つ。キーは set と重ならない
  }
  export function blockPatchOf(older: unknown, newer: unknown): BlockPatch | null;
  export function applyBlockPatch(newer: unknown, patch: BlockPatch): unknown | null;
  ```
- `blockPatchOf` が null を返す条件: どちらかがエンベロープの形(`doc.content` が配列)でない / 新しい側の最上位ブロックに ID の無いものか重複した ID がある / 作ったパッチを `applyBlockPatch(newer, patch)` に当てた結果が `canonicalJson(older)` と一致しない / パッチの JSON が `older` の JSON より短くならない
- `reverseDiff` は、`older[key]` と `newer[key]` が違うキーについて `blockPatchOf` を試し、null でなければ `blocks[key]`、null なら従来どおり `set[key]`。richtext かどうかは型定義を引かずに値の形で判定する(履歴は型定義の変更をまたぐ)
- `applyReverseDiff` は `blocks` があれば各キーに `applyBlockPatch` を当てる。`applyBlockPatch` が null(参照先のブロックが無い。鎖が正しければ起きない)なら `loadVersion` は null を返す(壊れた版を復元に使わない)

- [ ] **Step 1: 失敗するテストを書く**(`test/history.test.ts`): 10 段落の本文の 3 段落目だけを変えた 2 版で、`blockPatchOf` の `content` が ref 9 個 + node 1 個になり、`applyBlockPatch` が古い版に戻る / 段落の挿入・削除・並べ替えでも戻る / 重複 ID・ID の無いブロック・エンベロープでない値・`null` で `blockPatchOf` が null(Review Focus 1)/ `recordHistory` で 12 版書いてから `loadVersion` で全版を読むと、書いた `data` と正規化 JSON で一致する(本文の変更・タイトルだけの変更・本文の削除を混ぜる)/ `diff` 列に `{ set, unset }` だけの行(M4 の形)を直接 INSERT した鎖でも `loadVersion` が読める(Review Focus 2)
- [ ] **Step 2: FAIL を確かめる** `pnpm --filter @plyrs/api exec vitest run --no-isolate --max-workers=1 test/history.test.ts`
- [ ] **Step 3: 実装**
- [ ] **Step 4: PASS を確かめ、`history-retention.test.ts` を流して数字を取る。** 基準は「逆差分の合計が M4 の 976 KB から 250 KB 未満」。テストの期待値にこの上限を足し、出力した数字(版の数・全文の合計・逆差分の合計・DO の増分)を Task 6 の報告に写す。既存の `ops-history.test.ts` `history-publish.test.ts` `mcp-tools.test.ts`(record_compare / record_restore)も PASS
- [ ] **Step 5: design-spec 16.5 の保持の段落に「逆差分は、リッチテキストの値が最上位ブロックの参照で表せればブロック単位(`blocks`)、表せなければ値全体(`set`)」と書き、決定 53 を足す**
- [ ] **Step 6: Commit** `feat(api): 履歴の逆差分をリッチテキストの最上位ブロック単位にする`

## Task 2(M5a-2): unique のフィールドに引き当て用カラムを持たせる(決定 54)

所有者の判断(2026-11-04、判断カード「unique なフィールドの重複検査を、どう全件走査から外しますか」)で「unique なら索引を自動で作る」に決まった。管理画面の操作は変えず、公開 API の絞り込みも従来どおり indexed のときだけ。

**Files:** Modify `apps/api/src/do/index-ddl.ts`、`apps/api/src/do/unique-check.ts`、`apps/api/src/do/hooks.ts`(フックの ctx)、`apps/api/src/do/alarms.ts`、`apps/api/src/tenant-do.ts`(起動時と alarm)、`apps/admin/src/lib/labels.ts` の `uniqueHelp` の文言。Test: `apps/api/test/unique.test.ts`、`apps/api/test/index-ddl.test.ts`(既存のファイルに足す)、`apps/api/test/ops-meter.test.ts`

**Interfaces:**
- Produces(`index-ddl.ts`):
  ```ts
  // DO 内に生成カラム + 部分インデックスを持つフィールド = indexedColumns ∪ unique(text / number / datetime)。
  // 絞り込みの可否は従来どおり indexedColumns が決める
  export function lookupColumns(fields: FieldDefinition[]): IndexedColumn[];
  export const LOOKUP_COLUMNS_FLAG = "lookup_columns_v1"; // do_config のキー。'1' = 足し終えた
  export const LOOKUP_COLUMNS_ALARM = "lookup_columns"; // alarms.ts の種別
  export function existingGeneratedColumns(sql: SqlStorage): Set<string>; // PRAGMA table_xinfo(records) の g_ カラム名
  export function missingLookupColumns(sql: SqlStorage): { typeKey: string; column: IndexedColumn }[];
  // 1 歩 = 足りないカラムを 1 つだけ足す(ADD COLUMN + CREATE INDEX)。残りが無くなったら flag を立てて done
  export function addLookupColumnStep(sql: SqlStorage): { added: number; done: boolean };
  ```
- `computeIndexDdlDiff` は `indexedColumns` の代わりに `lookupColumns` で差を取る(unique だけ → indexed も付ける、の変更では差が出ない)
- **`applyIndexDdl` は実在するカラムを見て DDL を出す**: drop は `existingGeneratedColumns` にあるものだけ `DROP COLUMN`(インデックスは従来どおり `IF EXISTS`)、add は無いものだけ `ADD COLUMN`。起動時の追加が終わる前に、`ensureAssetContentType` / `ensureEnabledModuleTypes`(`registerContentTypeCore` → `applyIndexDdl`)や管理画面の型の保存が unique を外したり型を変えたりしても、無いカラムの drop や二重の add で失敗しない(Review Focus 3。`ensureEnabledModuleTypes` は失敗を握りつぶすので、失敗するとモジュールの型の更新が黙って止まる)
- **起動時に DDL を流さない**: 部分インデックスの構築は records を走査するので、`blockConcurrencyWhile` の中でまとめて足すと、record の多いテナントで起動の上限を超え、起動のたびに同じ DDL で失敗しうる。`ensureSearchIndex` と同じく、起動時は `migrate()` の直後(`ensureAssetContentType` より前)に flag を読むだけにし、'1' でなく `missingLookupColumns` が空でなければ alarm `LOOKUP_COLUMNS_ALARM` を登録する。alarm は `addLookupColumnStep` を 1 回行い、done でなければ次の alarm を登録する。空なら起動時にそのまま flag を立てる
- **足し終えるまでの重複検査**: DO は起動時と alarm の後に flag をメモリに持ち、`writeRecordCore` がフックの ctx に `lookupReady: boolean` を渡す。`unique-check.ts` は、そのフィールドが indexed であるか `lookupReady` が真なら生成カラムで引き、そうでなければ従来の `json_extract` で走査する(足し終える前は M4 と同じ動き)
- affinity: 生成カラムの比較(列の型 TEXT / NUMERIC の affinity)に揃える。たとえば unique の number に型を変える前の文字列 `"10"` が残っていると、数値 `10` の書き込みは `unique_violation` になる(厳しい側)。design-spec §5 に書く
- 管理画面の `uniqueHelp`(`labels.ts`、今は「他のコンテンツと同じ値は保存できません」)は意味が変わらないので文言を変えない

- [ ] **Step 1: 失敗するテストを書く**: `lookupColumns` が unique だけの text を含み、`indexedColumns` は含まない / unique だけ → unique + indexed の型の保存で `computeIndexDdlDiff` が空 / unique + indexed → indexed だけ(unique を外す)でも空、両方外すと drop / unique だけのフィールドを持つ型を M4 の形で作った DO(カラム無し)で、(a) 起動しても DDL が流れず alarm が登録される、(b) alarm の前に重複を書くと `json_extract` の走査で `unique_violation`、(c) alarm の前にその型の unique を外して保存しても、unique を付けたまま indexed を付けて保存しても失敗しない、(d) alarm を 2 歩(unique のフィールド 2 つ)回すと flag が立ち、その後は生成カラムで引く(Review Focus 3)/ unique の number に文字列 `"10"` を直接書いた行がある DO で数値 `10` の create が `unique_violation`(affinity を固定)/ `unique.test.ts` の既存の重複検出が unique だけのフィールドでも PASS / `ops-meter.test.ts` に unique だけの text を持つ型を足し、10 件と 300 件で `record_create` / `record_update` の rows read が一致する / 公開 API と `record_list` で unique だけのフィールドの絞り込みは従来どおり拒否される
- [ ] **Step 2: FAIL を確かめる** `pnpm --filter @plyrs/api exec vitest run --no-isolate --max-workers=1 test/unique.test.ts test/ops-meter.test.ts test/index-ddl.test.ts test/module-enablement.test.ts src/do/alarms.test.ts`
- [ ] **Step 3: 実装して PASS を確かめる。** `test/module-enablement.test.ts` も PASS
- [ ] **Step 4: design-spec §5 の unique の段落と決定 33 の後ろに「unique のフィールドは DO 内に引き当て用の生成カラムを持つ(絞り込みには使わない。既存テナントには alarm で足し、足し終えるまでは走査。比較は生成カラムの affinity に従う)」と書き、決定 54 を足す。ロードマップ 11 章の「indexed でない unique は全件走査」に解消を追記する**
- [ ] **Step 5: Commit** `feat(api): unique のフィールドに重複検査用の索引を自動で作る`

## Task 3(M5a-3): アセットの履歴に経路と tokenId を残す(監査の整理)

今は `createAssetRecord` が via を `rest` に固定しており、MCP のアップロードと URL 取り込みで作った asset の履歴が管理画面のアップロードと区別できない。受け取りの側は発行に使ったトークンの種別を知らないので、表に持たせる(Task 4 も使う)。

**Files:** Modify `packages/db/src/schema.ts`(`asset_upload_tokens` に `tokenKind: text("token_kind").notNull().default("pat")`)、生成されたマイグレーション、`apps/api/src/do/asset-uploads.ts`(`AssetUploadRow` と `ClaimAssetUploadResult` に `tokenKind`)、`apps/api/src/mcp/worker-ops.ts`(発行時に `auth.tokenKind` を渡す)、`apps/api/src/tenant-do.ts`(`createAssetRecord`)、`apps/api/src/assets/store.ts`、`apps/api/src/mcp/uploads.ts`。Test: `apps/api/test/mcp-uploads.test.ts`、`apps/api/test/mcp-tools.test.ts`、`apps/api/test/asset-upload.test.ts`

**Interfaces:**
- `createAssetRecord(params: WriteRecordInput, auth: AuthContext | McpAuth)`: `hasScopes(auth)`(`ops/invoke.ts`)が真なら履歴の `via: "mcp"` と `tokenId: auth.tokenId`、偽なら従来どおり `via: "rest"`。`storeAsset` の `auth` の型も `AuthContext | McpAuth` に広げる
- `uploads.ts` は claim の結果から `McpAuth` を組んで `storeAsset` に渡す: `{ userId, role, tenantId, scopes: ["record:write"], tokenId, tokenKind, exp: <claim 時刻の秒> }`(role は Task 4 で引き直した値に替わる)
- デプロイ時に残っている発行済みの行(最長 10 分)は `token_kind` が既定の `pat` になる。OAuth で発行した行は Task 4 の確認で PAT として引かれて 403 になる(安全側。申し送りに書く)

- [ ] **Step 1: 失敗するテストを書く**: `asset_upload` → POST で作った asset の `record_history` の先頭の版が `via === "mcp"` で `tokenId` が PAT の行 ID / `asset_import_url` で作った asset も同じ / 管理画面の `POST /assets` で作った asset は `via === "rest"` で `tokenId === null`
- [ ] **Step 2: FAIL → マイグレーション生成(`pnpm --filter @plyrs/db generate`、`pnpm format`)→ 実装 → PASS** `pnpm --filter @plyrs/api exec vitest run --no-isolate --max-workers=1 test/mcp-uploads.test.ts test/mcp-tools.test.ts test/asset-upload.test.ts`
- [ ] **Step 3: design-spec 16.11 の「asset の record は `createAssetRecord` を通るので経路(via)は `rest` のまま記録される」を「MCP の 2 経路は via `mcp` と tokenId を記録する」に直す**
- [ ] **Step 4: Commit** `fix(api): MCP で作ったアセットの履歴に経路と tokenId を残す`

## Task 4(M5a-4): アップロードの受け取りで発行に使ったトークンとロールを引き直す

今は受け取りで BLOCKLIST の 2 キーだけを見ており、発行に使ったトークンの失効とロールの降格は見ていない(最長 10 分・1 回・画像だけの隙)。claim の後、本文を読む前に引き直す。

**Files:** Create `apps/api/src/mcp/issuing-token.ts`。Modify `apps/api/src/oauth/grants.ts`(`hasGrant` を export)、`apps/api/src/mcp/uploads.ts`。Test: `apps/api/test/mcp-uploads.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // grants.ts: 付与が今もあるか。OAUTH_KV の `grant:${userId}:${grantId}` を 1 回 get する(isPending と同じ方式。
  // 一覧の list はしない)。テナントとの結び付きは発行時に検証済み(tokenId は検証した token から取った)
  export async function hasGrant(env: Env, userId: string, grantId: string): Promise<boolean>;
  // issuing-token.ts: 発行に使ったトークンが今も有効なら、今の memberships のロールを返す。無効・会員でなければ null
  export async function currentRoleOfIssuer(
    env: Env,
    tenantId: string,
    issuer: { userId: string; tokenId: string; tokenKind: "pat" | "oauth" },
    now: Date,
  ): Promise<Role | null>;
  ```
- PAT は D1 の 1 照会(`personal_access_tokens` の `id = tokenId AND tenant_id AND user_id AND revoked_at IS NULL AND expires_at > now` を `memberships` と join。`verifyPat` と同じ条件をハッシュではなく行 ID で引く)。OAuth は `hasGrant` が真で、`memberships` の行があること(D1 の 1 照会)。`mcp-gate.ts` は token から grantId を取り出せないとき `tokenId` に `clientId` を入れるが、そのトークンで発行した受け取りは KV に `grant:${userId}:${clientId}` が無いので 403 `token_revoked` になる(安全側。意図した動きとしてテストと申し送りに書く)
- `uploads.ts` の順序: claim(使い切りの印)→ BLOCKLIST の 2 キー → `currentRoleOfIssuer`(null なら 403 `{ error: "token_revoked" }`)→ `can(role, "record:write")`(偽なら 403 `{ error: "forbidden" }`。viewer に下げられた場合)→ 本文を読む → `storeAsset`(role は引き直した値)。ロールの判定を本文を読む前に置くので、降格された利用者の本文は読まず R2 にも書かない(`createAssetRecord` の `requireOperation` は二重の防御として残る)。印は先に立つので、403 のトークンも再利用できない
- 応答の 403 は R2 に何も書かない(本文を読む前に返す)

- [ ] **Step 1: 失敗するテストを書く**(`mcp-uploads.test.ts`、Review Focus 4): 発行後に PAT を `revokePat` すると 403 `token_revoked` で R2 の一覧が増えない / 発行後に PAT の `expires_at` を過去にすると 403 / 発行後にロールを viewer に下げると 403 `forbidden` で、本文を読まず(`ASSETS.put` の spy が呼ばれない)/ 発行後に会員から外すと 403 / OAuth で発行(`McpAuth` を `tokenKind: "oauth"` で組む)した後に `revokeTenantGrant` すると 403 で、`hasGrant` は KV の get を 1 回だけ呼ぶ(list は呼ばない)/ `tokenId` が clientId(grantId を取り出せなかった形)の OAuth で発行した受け取りは 403 `token_revoked` / どれも 2 回目の POST は 410
- [ ] **Step 2: FAIL → 実装 → PASS**(コマンドは Task 3 と同じ)
- [ ] **Step 3: design-spec 16.11 の受け取りの順序に「発行に使ったトークンの有効性と今のロール(無効なら 403)」を足す。ロードマップ 11 章の「アップロードトークンの残る隙」に解消を追記する**
- [ ] **Step 4: Commit** `fix(api): アップロードの受け取りで発行に使ったトークンの失効とロールの降格を見る`

## Task 5(M5a-5): PAT のスコープ不足をツールの業務エラーで返す(決定 55)

G4 で、Claude Code は HTTP 403 の `insufficient_scope` を「Insufficient scope: required "record:publish"」とだけ表示し、対処の方法(所有者が PAT を発行し直す)がエージェントにも利用者にも届かなかった。PAT は再認可できないので step-up の 403 は役に立たない。PAT のときだけ、`tools/call` の結果の業務エラーで対処を返す。

**Files:** Modify `apps/api/src/mcp/route.ts`(スコープ不足のとき、OAuth は従来の 403、PAT は SDK を通さずに JSON-RPC の結果を直接返す)、`apps/api/src/ops/invoke.ts`(スコープ判定のヘルパー)、`apps/api/src/mcp/worker-ops.ts`、`apps/e2e/tests/mcp-write.spec.ts`。Test: `apps/api/test/mcp-route.test.ts`、`apps/api/test/mcp-tools.test.ts`

**Interfaces:**
- Produces(`ops/invoke.ts`): `missingScope(auth: AuthContext | McpAuth, spec: OpSpec): Operation | null`(MCP の認可コンテキストでスコープが足りなければ要するスコープ)。`route.ts` の判定、`worker-ops.ts` の `runWorkerOperation`、`invoke.ts` の `runOperation` の 3 か所の `scopes.includes(spec.requires)` をこれに置き換える
- Produces(`route.ts`): `patScopeRemedy(scope: Operation): string` = `この接続トークンには <scope> がありません。所有者に、管理画面の 設定 › 接続中のアプリ で <scope> を含むトークンを発行してもらい、接続を設定し直してください`
- 業務エラー: `code: "insufficient_scope"`、`message: patScopeRemedy(scope)`、`details: { required: <scope>, tokenKind: "pat" }`。`route.ts` が SDK の手前で JSON-RPC の応答 `{ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: message }], structuredContent: { error }, isError: true } }` を HTTP 200(`content-type: application/json`)で組んで返す。従来の 403 と同じ位置(Rate Limiting の前)で止めるので、`buildMcpServer` も DO も起こさず、ツール単位の枠も消費しない
- `insufficientScopeFor` は OAuth にしか呼ばれなくなるので、PAT の分岐(英文のヘッダと日本語の description)を消す
- [ ] **Step 1: 失敗するテストを書く**: `record:read` だけの PAT の `tools/call record_update` が HTTP 200 で `isError: true`、`structuredContent.error.code === "insufficient_scope"`、`details.required === "record:write"`、応答の `id` が要求の `id` と一致 / そのとき DO の `invoke` の spy、`MCP_LIMITER.limit`、`buildMcpServer` のいずれも呼ばれない(Review Focus 5)/ OAuth の token の同じ呼び出しは従来どおり 403 で `WWW-Authenticate` に `insufficient_scope` / `asset_import_url` のスコープ不足も同じ業務エラー / `missingScope` の単体テスト(`AuthContext` は常に null)
- [ ] **Step 2: FAIL → 実装 → PASS** `pnpm --filter @plyrs/api exec vitest run --no-isolate --max-workers=1 test/mcp-route.test.ts test/mcp-tools.test.ts`
- [ ] **Step 3: E2E の `mcp-write.spec.ts` の「`record_publish` が 403 `insufficient_scope`」を業務エラーの期待に直し、`pnpm --filter @plyrs/e2e test` で全 spec が PASS**
- [ ] **Step 4: design-spec 16.3 のスコープ不足の段落に「PAT は再認可できないので、tools/call のスコープ不足は業務エラーで対処を返す。OAuth は 403 の step-up」と書き、決定 55 を足す。`docs/deploy.md` 3.6 の G4 の確認手順 3 の期待値を直す**
- [ ] **Step 5: Commit** `feat(api): PAT のスコープ不足をツールの業務エラーにして対処を示す`

## Task 6(M5a-6): G4 で見つかった小さな不具合と仕上げ

**Files:** Modify `apps/api/src/assets/fetch-url.ts`、`apps/api/src/mcp/worker-ops.ts`、`apps/api/src/mcp/confirm.ts`、`apps/api/src/do/write-record.ts`、`docs/design-spec.md`、`docs/deploy.md`、ロードマップ。Create `/mnt/project-files/m5/m5a-report.md`。Test: `apps/api/test/asset-fetch-url.test.ts`、`apps/api/test/mcp-confirm.test.ts`、`apps/api/test/write-record.test.ts`、`packages/richtext` の既存のテスト

**Interfaces:**
- `fetchPublicImage(url: string, options: { userAgent: string; fetcher?: typeof fetch })`: 各ホップの要求に `user-agent` を付ける。値は `plyrs-asset-import/1 (+<API_ORIGIN>)`、`API_ORIGIN` が無ければ `plyrs-asset-import/1`(`worker-ops.ts` が組む)。Wikimedia の 403 は User-Agent が無いためとみている(未確認)ので、preview で確かめる(所有者にお願いすること)
- `requestedSchema` の `confirm` に `default: true` を付ける(フォームが初期値を true にして描くので、欄を切り替えなくても Accept で `confirm: true` が送られる)。**照合は変えない**: `confirm: true` を明示した Accept だけを確認とし、`confirm` が欠けた Accept(フォームを描かずに自動で返すクライアント)と `false` は従来どおり `declined`(16.8 の人の確認を弱めない)。照合用の `confirmSchema` は `z.boolean()` のまま、`requestedSchema` 用に default 付きの別のスキーマを持つ。SDK が `default` を `requestedSchema` に出すかを型(`node_modules/@modelcontextprotocol/server/dist/index.d.mts`)で確かめ、出なければ `requestedSchema` を手で組む
- **構造の検査は全経路に置く**: 語彙に無いノードの `attrs` に URL を入れる隙は validate-on-write の問題なので、MCP の入力変換(`resolveRichTextInputs`)ではなく、同期・REST・MCP が通る `write-record.ts` の `newUnsafeLinks` の隣で `checkRichText`(`@plyrs/richtext`)を当てる。対象は前の値から変わった richtext のフィールドだけ(リンク検査と同じく、本文以外を直す保存を既存の値で失敗させない)。通らなければ `validation_failed`(message に `<fieldKey>: invalid rich text structure: <理由>`)。**未知の属性も拒否する**: ProseMirror の `Node.fromJSON` は `computeAttrs` でスキーマに定義された属性だけを取り出し、未知の属性は `check()` に届く前に捨てる(prosemirror-model 1.25.12)。保存されるのは入力の JSON なので、`checkRichText` に入力の JSON を走査して各ノード・マークの `attrs` のキーが `type.spec.attrs` に含まれるかを見る処理を足す(含まれなければ理由に `unknown attribute <node or mark>.<key>`)。ロードマップ 11 章「リンク検査の残り」を閉じる
- 管理画面のエディタが作る本文を拒否しないこと: `@plyrs/richtext` のスキーマのノード・マークの集合が、`packages/ui` のエディタの拡張の集合を含むことをテストで固定する(足りなければスキーマに足す。M2-2 で揃えた集合が以後ずれていないかの確認)

- [ ] **Step 1: 失敗するテストを書く**: fetch の spy が受けた要求の `user-agent` が `plyrs-asset-import/1` で始まる(リダイレクト先のホップでも)/ elicitation の `requestedSchema.properties.confirm.default === true`、`content: { confirm: false }` の Accept は `declined` / `content: {}` の Accept は `declined`、`content: { confirm: true }` の Accept で公開される / `{ type: "iframe", attrs: { src: "javascript:alert(1)" } }` を含む本文と、既知のノードに余分な属性を付けた本文(`{ type: "paragraph", attrs: { src: "javascript:..." } }`、`assetImage` に `onerror`、link マークに `onclick`)が、同期の push・REST の `PUT`・MCP の `record_update` のどれでも `validation_failed` で書かれない / 既存の不正な本文を持つ record のタイトルだけを直す保存は通る / エディタの拡張の集合がスキーマに含まれる
- [ ] **Step 2: FAIL → 実装 → PASS** `pnpm --filter @plyrs/api exec vitest run --no-isolate --max-workers=1 test/asset-fetch-url.test.ts test/mcp-confirm.test.ts test/write-record.test.ts` と `pnpm --filter @plyrs/richtext test`
- [ ] **Step 3: `/security-review` を走らせ、指摘を直す**(直さないものは理由を報告に)
- [ ] **Step 4: ブランチ全体を別の視点でレビューし、Important 以上を直す**(M2〜M4 と同じ)
- [ ] **Step 5: 文書。** design-spec 16.8 に `confirm` の既定値(照合は明示の true のみ)、16.10 に書き込み時の構造の検査、16.11 に User-Agent。`docs/deploy.md` 3.6 に preview での確認手順(下の「所有者にお願いすること」)。ロードマップの 2 章 M5 に M5a の表と PR 番号、6 章、「12. M5a 完了時の申し送り」。報告 `/mnt/project-files/m5/m5a-report.md`(PR の表、Task 1 の履歴の実測の前後比較、Task 2 の計測、見送り)
- [ ] **Step 6: Commit** `fix(api): G4 で見つかった取り込み・確認・本文の検査の不具合を直す`

## 所有者にお願いすること(preview、マージ・デプロイ後)

1. `asset_import_url` で upload.wikimedia.org の画像を取り込めること(Task 6 の User-Agent)
2. Claude Code で publish の確認が出たとき、欄が初期値で true になっていて、欄を触らずに Accept するだけで公開されること(Task 6 の `default: true`。Claude Code が初期値を使わずに `confirm` を欠いて送る場合は `declined` になるので、その結果を教えてほしい)
3. `record:publish` の無い PAT で公開を頼むと、エージェントが「所有者に PAT を発行してもらう」旨を伝えること(Task 5)
4. M1 から残っている Cursor / VS Code(と、あれば MCP Inspector)からの PAT 接続。手順は `docs/deploy.md` 3.5、M1 の申し送りの手順は `/mnt/project-files/m3/m1-carryover-steps.md`
