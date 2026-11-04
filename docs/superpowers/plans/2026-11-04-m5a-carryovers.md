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

- 一意性検査の比較が生成カラムの affinity に従う件: 実害の報告が無い。記録だけ(ロードマップ 11 章)
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
3. **既存テナントの indexed でない unique**: デプロイ前から unique だけを付けていたフィールドに、DO の起動時に引き当て用カラムが足され、その後に管理画面で indexed を付けても外しても、型の保存が「duplicate column」や「no such column」で失敗しないこと(Task 2)
4. **アップロードトークンの発行後の失効と降格**: 発行に使った PAT を失効する、OAuth の付与を失効する、ロールを viewer に下げる、会員から外す、のいずれの後でも、受け取りが 403 で R2 に何も残らないこと(Task 4)
5. **PAT のスコープ不足が DO を起こさない**: `record:publish` の無い PAT の `tools/call record_publish` が、HTTP 200 の `isError` で返り、DO の `invoke` が呼ばれず、Rate Limiting の枠も消費しないこと(Task 5)

---

## ファイル構成

| ファイル | 責務 |
| --- | --- |
| `apps/api/src/do/history.ts` | 変更。逆差分にブロック単位の形 `blocks` を足す(作成・適用・検証) |
| `apps/api/src/do/index-ddl.ts`、`apps/api/src/do/unique-check.ts`、`apps/api/src/tenant-do.ts` | 変更。引き当て用カラム(`lookupColumns`)と起動時の追加 |
| `packages/db/src/schema.ts`、`packages/db/drizzle/` | 変更。`asset_upload_tokens.token_kind` |
| `apps/api/src/tenant-do.ts`(`createAssetRecord`)、`apps/api/src/assets/store.ts`、`apps/api/src/mcp/worker-ops.ts`、`apps/api/src/mcp/uploads.ts`、`apps/api/src/do/asset-uploads.ts` | 変更。アセットの via と tokenId |
| `apps/api/src/mcp/issuing-token.ts` | 新規。発行に使ったトークンが今も有効かと、今のロールを引く |
| `apps/api/src/oauth/grants.ts` | 変更。`hasTenantGrant` を export |
| `apps/api/src/mcp/route.ts`、`apps/api/src/mcp/server.ts` | 変更。PAT のスコープ不足を業務エラーに |
| `apps/api/src/assets/fetch-url.ts`、`apps/api/src/mcp/confirm.ts`、`apps/api/src/ops/richtext-input.ts` | 変更。G4 の小さな不具合 |
| `apps/e2e/tests/mcp-write.spec.ts` | 変更。PAT のスコープ不足の期待値 |
| `docs/design-spec.md`(16.3・16.5・16.11・§5・決定ログ 53〜55)、`docs/deploy.md`(3.6)、ロードマップ、`/mnt/project-files/m5/m5a-report.md` | 変更・新規 |

---

## Task 1(M5a-1): リッチテキストの逆差分をブロック単位にする(決定 53)

M4-6 の実測では、本文を 1 段落直しただけでも逆差分に本文全体が入り、差分 1 版が約 11.7 KB(全文 1 版の約 12.8 KB とほぼ同じ)だった。最上位ブロックには安定 ID がある(決定 44・46)ので、古い版の本文を「新しい版のブロックの参照」と「変わったブロックの実体」の列で持つ。

**Files:** Modify `apps/api/src/do/history.ts`。Test: `apps/api/src/do/history.test.ts`(無ければ `apps/api/test/history.test.ts` に足す)、`apps/api/test/history-retention.test.ts`

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

- [ ] **Step 1: 失敗するテストを書く**(`history.test.ts`): 10 段落の本文の 3 段落目だけを変えた 2 版で、`blockPatchOf` の `content` が ref 9 個 + node 1 個になり、`applyBlockPatch` が古い版に戻る / 段落の挿入・削除・並べ替えでも戻る / 重複 ID・ID の無いブロック・エンベロープでない値・`null` で `blockPatchOf` が null(Review Focus 1)/ `recordHistory` で 12 版書いてから `loadVersion` で全版を読むと、書いた `data` と正規化 JSON で一致する(本文の変更・タイトルだけの変更・本文の削除を混ぜる)/ `diff` 列に `{ set, unset }` だけの行(M4 の形)を直接 INSERT した鎖でも `loadVersion` が読める(Review Focus 2)
- [ ] **Step 2: FAIL を確かめる** `pnpm --filter @plyrs/api exec vitest run --no-isolate --max-workers=1 test/history.test.ts`
- [ ] **Step 3: 実装**
- [ ] **Step 4: PASS を確かめ、`history-retention.test.ts` を流して数字を取る。** 基準は「逆差分の合計が M4 の 976 KB から 250 KB 未満」。テストの期待値にこの上限を足し、出力した数字(版の数・全文の合計・逆差分の合計・DO の増分)を Task 6 の報告に写す。既存の `ops-history.test.ts` `history-publish.test.ts` `mcp-tools.test.ts`(record_compare / record_restore)も PASS
- [ ] **Step 5: design-spec 16.5 の保持の段落に「逆差分は、リッチテキストの値が最上位ブロックの参照で表せればブロック単位(`blocks`)、表せなければ値全体(`set`)」と書き、決定 53 を足す**
- [ ] **Step 6: Commit** `feat(api): 履歴の逆差分をリッチテキストの最上位ブロック単位にする`

## Task 2(M5a-2): unique のフィールドに引き当て用カラムを持たせる(決定 54)

所有者の判断(2026-11-04、判断カード「unique なフィールドの重複検査を、どう全件走査から外しますか」)で「unique なら索引を自動で作る」に決まった。管理画面の操作は変えず、公開 API の絞り込みも従来どおり indexed のときだけ。

**Files:** Modify `apps/api/src/do/index-ddl.ts`、`apps/api/src/do/unique-check.ts`、`apps/api/src/tenant-do.ts`(起動時)、`apps/admin/src/components/content-types/field-panel.tsx` の `uniqueHelp` の文言。Test: `apps/api/test/unique.test.ts`、`apps/api/src/do/index-ddl.test.ts`(無ければ新規)、`apps/api/test/ops-meter.test.ts`

**Interfaces:**
- Produces(`index-ddl.ts`):
  ```ts
  // DO 内に生成カラム + 部分インデックスを持つフィールド = indexedColumns ∪ unique(text / number / datetime)。
  // 絞り込みの可否は従来どおり indexedColumns が決める
  export function lookupColumns(fields: FieldDefinition[]): IndexedColumn[];
  export const LOOKUP_COLUMNS_FLAG = "lookup_columns_v1"; // do_config のキー
  export function ensureLookupColumns(sql: SqlStorage): number; // 足したカラムの数。flag が '1' なら 0 で何もしない
  ```
- `computeIndexDdlDiff` / `applyIndexDdl` は `indexedColumns` の代わりに `lookupColumns` で差を取る(unique だけ → indexed も付ける、の変更では差が出ない)
- `ensureLookupColumns` は `PRAGMA table_xinfo(records)` で既にある `g_` カラムを集め、全型の `lookupColumns` のうち無いものだけ `ALTER TABLE ... ADD COLUMN` と `CREATE INDEX` を行い、最後に `do_config` に flag を立てる。`tenant-do.ts` の `blockConcurrencyWhile` で `ensureSearchIndex` の前に呼ぶ
- `unique-check.ts` は常に生成カラムで引く(`json_extract` の分岐を消す)
- 管理画面の `uniqueHelp`: 「同じ型の record で値が重ならないようにします。重複の検査には専用の索引を自動で作ります」(用語集の「索引」の語に合わせて調整する)

- [ ] **Step 1: 失敗するテストを書く**: `lookupColumns` が unique だけの text を含み、`indexedColumns` は含まない / unique だけ → unique + indexed の型の保存で `computeIndexDdlDiff` が空 / unique + indexed → indexed だけ(unique を外す)でも空、両方外すと drop / unique だけのフィールドを持つ型を M4 の形で作った DO(カラム無し)で `ensureLookupColumns` が 1 を返し、2 回目は 0、その後に型を保存し直しても失敗しない(Review Focus 3)/ `unique.test.ts` の既存の重複検出が unique だけのフィールドでも PASS / `ops-meter.test.ts` に unique だけの text を持つ型を足し、10 件と 300 件で `record_create` / `record_update` の rows read が一致する / 公開 API と `record_list` で unique だけのフィールドの絞り込みは従来どおり拒否される
- [ ] **Step 2: FAIL を確かめる** `pnpm --filter @plyrs/api exec vitest run --no-isolate --max-workers=1 test/unique.test.ts test/ops-meter.test.ts src/do/index-ddl.test.ts`
- [ ] **Step 3: 実装して PASS を確かめる。** admin の `field-panel.test.tsx` も PASS
- [ ] **Step 4: design-spec §5 の unique の段落と決定 33 の後ろに「unique のフィールドは DO 内に引き当て用の生成カラムを持つ(絞り込みには使わない)」と書き、決定 54 を足す。ロードマップ 11 章の「indexed でない unique は全件走査」に解消を追記する**
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

**Files:** Create `apps/api/src/mcp/issuing-token.ts`。Modify `apps/api/src/oauth/grants.ts`(既存の `userGrants` を使う `hasTenantGrant` を export)、`apps/api/src/mcp/uploads.ts`。Test: `apps/api/test/mcp-uploads.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // grants.ts: その利用者のこのテナントの付与に grantId があるか(OAuth が未構成なら false)
  export async function hasTenantGrant(env: Env, tenantId: string, userId: string, grantId: string): Promise<boolean>;
  // issuing-token.ts: 発行に使ったトークンが今も有効なら、今の memberships のロールを返す。無効・会員でなければ null
  export async function currentRoleOfIssuer(
    env: Env,
    tenantId: string,
    issuer: { userId: string; tokenId: string; tokenKind: "pat" | "oauth" },
    now: Date,
  ): Promise<Role | null>;
  ```
- PAT は D1 の 1 照会(`personal_access_tokens` の `id = tokenId AND tenant_id AND user_id AND revoked_at IS NULL AND expires_at > now` を `memberships` と join。`verifyPat` と同じ条件をハッシュではなく行 ID で引く)。OAuth は `hasTenantGrant` が真で、`memberships` の行があること
- `uploads.ts` の順序: claim(使い切りの印)→ BLOCKLIST の 2 キー → `currentRoleOfIssuer`(null なら 403 `{ error: "token_revoked" }`)→ 本文を読む → `storeAsset`(role は引き直した値。viewer なら `createAssetRecord` の `requireOperation` が拒否し 403)。印は先に立つので、403 のトークンも再利用できない
- 応答の 403 は R2 に何も書かない(本文を読む前に返す)

- [ ] **Step 1: 失敗するテストを書く**(`mcp-uploads.test.ts`、Review Focus 4): 発行後に PAT を `revokePat` すると 403 `token_revoked` で R2 の一覧が増えない / 発行後に PAT の `expires_at` を過去にすると 403 / 発行後にロールを viewer に下げると 403 / 発行後に会員から外すと 403 / OAuth で発行(`McpAuth` を `tokenKind: "oauth"` で組む)した後に `revokeTenantGrant` すると 403 / どれも 2 回目の POST は 410
- [ ] **Step 2: FAIL → 実装 → PASS**(コマンドは Task 3 と同じ)
- [ ] **Step 3: design-spec 16.11 の受け取りの順序に「発行に使ったトークンの有効性と今のロール(無効なら 403)」を足す。ロードマップ 11 章の「アップロードトークンの残る隙」に解消を追記する**
- [ ] **Step 4: Commit** `fix(api): アップロードの受け取りで発行に使ったトークンの失効とロールの降格を見る`

## Task 5(M5a-5): PAT のスコープ不足をツールの業務エラーで返す(決定 55)

G4 で、Claude Code は HTTP 403 の `insufficient_scope` を「Insufficient scope: required "record:publish"」とだけ表示し、対処の方法(所有者が PAT を発行し直す)がエージェントにも利用者にも届かなかった。PAT は再認可できないので step-up の 403 は役に立たない。PAT のときだけ、`tools/call` の結果の業務エラーで対処を返す。

**Files:** Modify `apps/api/src/mcp/route.ts`(`requiredScopeOf` の 403 を `auth.tokenKind === "oauth"` のときだけにする)、`apps/api/src/mcp/server.ts`(ツールのハンドラの先頭で、`auth.scopes` に `spec.requires` が無ければ invoke せずに業務エラー)、`apps/e2e/tests/mcp-write.spec.ts`。Test: `apps/api/test/mcp-route.test.ts`、`apps/api/test/mcp-tools.test.ts`

**Interfaces:**
- 業務エラー: `code: "insufficient_scope"`、`message`: `この接続トークンには <scope> がありません。所有者に、管理画面の 設定 › 接続中のアプリ で <scope> を含むトークンを発行してもらい、接続を設定し直してください`、`details: { required: <scope>, tokenKind: "pat" }`。文は `insufficientScopeFor` の日本語の description と 1 か所で共有する(定数 `patScopeRemedy(scope: Operation): string` を `route.ts` に置き、両方から使う)
- ツール単位の Rate Limiting はスコープの判定の後なので、PAT のスコープ不足は HTTP 403 のときと同じく枠を消費しない(`route.ts` で PAT のときは Rate Limiting の前に `requiredScopeOf` を見て、足りなければ制限をかけずに SDK へ渡す)。ハンドラの判定は Worker 層なので DO を起こさない
- `runWorkerOperation` の既存のスコープ判定(`worker-ops.ts`)は同じ形のエラーを返すようにそろえる

- [ ] **Step 1: 失敗するテストを書く**: `record:read` だけの PAT の `tools/call record_update` が HTTP 200 で `isError: true`、`structuredContent.error.code === "insufficient_scope"`、`details.required === "record:write"` / そのとき DO の `invoke` の spy が呼ばれず、`MCP_LIMITER.limit` も呼ばれない(Review Focus 5)/ OAuth の token の同じ呼び出しは従来どおり 403 で `WWW-Authenticate` に `insufficient_scope` / `asset_import_url` のスコープ不足も同じ業務エラー
- [ ] **Step 2: FAIL → 実装 → PASS** `pnpm --filter @plyrs/api exec vitest run --no-isolate --max-workers=1 test/mcp-route.test.ts test/mcp-tools.test.ts`
- [ ] **Step 3: E2E の `mcp-write.spec.ts` の「`record_publish` が 403 `insufficient_scope`」を業務エラーの期待に直し、`pnpm --filter @plyrs/e2e test` で全 spec が PASS**
- [ ] **Step 4: design-spec 16.3 のスコープ不足の段落に「PAT は再認可できないので、tools/call のスコープ不足は業務エラーで対処を返す。OAuth は 403 の step-up」と書き、決定 55 を足す。`docs/deploy.md` 3.6 の G4 の確認手順 3 の期待値を直す**
- [ ] **Step 5: Commit** `feat(api): PAT のスコープ不足をツールの業務エラーにして対処を示す`

## Task 6(M5a-6): G4 で見つかった小さな不具合と仕上げ

**Files:** Modify `apps/api/src/assets/fetch-url.ts`、`apps/api/src/mcp/worker-ops.ts`、`apps/api/src/mcp/confirm.ts`、`apps/api/src/ops/richtext-input.ts`、`docs/design-spec.md`、`docs/deploy.md`、ロードマップ。Create `/mnt/project-files/m5/m5a-report.md`。Test: `apps/api/test/asset-fetch-url.test.ts`、`apps/api/test/mcp-confirm.test.ts`、`apps/api/test/ops-richtext-input.test.ts`

**Interfaces:**
- `fetchPublicImage(url: string, options: { userAgent: string; fetcher?: typeof fetch })`: 各ホップの要求に `user-agent` を付ける。値は `plyrs-asset-import/1 (+<API_ORIGIN>)`、`API_ORIGIN` が無ければ `plyrs-asset-import/1`(`worker-ops.ts` が組む)。Wikimedia の 403 は User-Agent が無いためとみている(未確認)ので、preview で確かめる(所有者にお願いすること)
- `confirmSchema` の `confirm` を `z.boolean().default(true)` にする。`requestedSchema.properties.confirm.default === true` になり、フォームの欄を切り替えなくても Accept だけで確認になる。`acceptedContent` で `confirm` が欠けた応答は true として扱い、`false` を明示した Accept は従来どおり `declined`。SDK が `default` を `requestedSchema` に出すかを型(`node_modules/@modelcontextprotocol/server/dist/index.d.mts`)で確かめ、出なければ `requestedSchema` を手で組む
- `resolveRichTextInputs` は、ProseMirror のエンベロープで渡された richtext の値にも `checkRichText` を当て、通らなければ `invalid_input`(`details: { field, kind: "invalid_structure", message }`)。語彙に無いノードの `attrs` に入れた URL がリンク検査を素通りする隙を閉じる(ロードマップ 11 章「リンク検査の残り」)

- [ ] **Step 1: 失敗するテストを書く**: fetch の spy が受けた要求の `user-agent` が `plyrs-asset-import/1` で始まる(リダイレクト先のホップでも)/ elicitation の `requestedSchema.properties.confirm.default === true`、`content: {}` の Accept で公開される、`content: { confirm: false }` の Accept は `declined` / エンベロープに `{ type: "iframe", attrs: { src: "javascript:alert(1)" } }` を入れた `record_update` が `invalid_input` で書かれない、エディタが作る通常のエンベロープは通る
- [ ] **Step 2: FAIL → 実装 → PASS** `pnpm --filter @plyrs/api exec vitest run --no-isolate --max-workers=1 test/asset-fetch-url.test.ts test/mcp-confirm.test.ts test/ops-richtext-input.test.ts`
- [ ] **Step 3: `/security-review` を走らせ、指摘を直す**(直さないものは理由を報告に)
- [ ] **Step 4: ブランチ全体を別の視点でレビューし、Important 以上を直す**(M2〜M4 と同じ)
- [ ] **Step 5: 文書。** design-spec 16.8 に `confirm` の既定値、16.10 にエンベロープ入力の検査、16.11 に User-Agent。`docs/deploy.md` 3.6 に preview での確認手順(下の「所有者にお願いすること」)。ロードマップの 2 章 M5 に M5a の表と PR 番号、6 章、「12. M5a 完了時の申し送り」。報告 `/mnt/project-files/m5/m5a-report.md`(PR の表、Task 1 の履歴の実測の前後比較、Task 2 の計測、見送り)
- [ ] **Step 6: Commit** `fix(api): G4 で見つかった取り込み・確認・本文の検査の不具合を直す`

## 所有者にお願いすること(preview、マージ・デプロイ後)

1. `asset_import_url` で upload.wikimedia.org の画像を取り込めること(Task 6 の User-Agent)
2. Claude Code で publish の確認が出たとき、欄を触らずに Accept するだけで公開されること(Task 6 の `default: true`)
3. `record:publish` の無い PAT で公開を頼むと、エージェントが「所有者に PAT を発行してもらう」旨を伝えること(Task 5)
4. M1 から残っている Cursor / VS Code(と、あれば MCP Inspector)からの PAT 接続。手順は `docs/deploy.md` 3.5、M1 の申し送りの手順は `/mnt/project-files/m3/m1-carryover-steps.md`
