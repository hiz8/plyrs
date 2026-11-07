# M5c 提案(change set)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** エージェントの変更を record へ直接書かず「提案」として保存し、管理画面で人が差分を見て採用・却下できるようにする(design-spec 16.8 の提案(change set、論点 B4))。`record:propose` だけを持つトークンの変更は提案になり、確認(elicitation)できないクライアントの publish と、再適用の打ち切り(16.6)の受け皿になる。

**Architecture:** 提案は DO 内の新しい表 `proposals` に置く(record と同じテナント境界)。エージェントは専用の操作 `proposal_create` で提案を作り、`proposal_list` / `proposal_get` で状態を読む。採用・却下は管理画面(REST)だけの操作 `proposal_accept` / `proposal_reject` で、採用は **採用した人の権限と actor** で既存の書き込みハンドラ(`record_update` など `WRITE_HANDLERS`)を DO の同じトランザクションの中で呼ぶ(提案専用の書き込み経路を作らない。validate-on-write・一意性・モジュールフック・履歴・公開用 DB への反映は既存のまま通る)。提案の中身は作成時に Markdown / ブロック操作を解決した**具体値**で持ち、差分は常に「現在 → 提案」で見せる(提案の後に record が進んでいれば `stale` を立てて人に知らせる)。履歴の版には `proposal_id` を刻む。

**Tech Stack:** Drizzle(DO-SQLite のマイグレーション 1 本)、Hono、`@modelcontextprotocol/server` 2.4.0、TanStack Start / Router / Query、react-aria-components + StyleX、`@cloudflare/vitest-plugin`、Playwright。

**Spec:**
- `docs/design-spec.md` 16.3(スコープ)、16.5(履歴)、16.6(再適用の打ち切り)、16.7(冪等性・エラーの層)、16.8(publish の方針と確認、提案)、第 7 章(公開軸とワークフロー軸)、決定 50・55・56
- `docs/glossary.md`「提案(change set)」「スコープ」「経路(via)」
- `docs/superpowers/plans/2026-11-01-mcp-roadmap.md` 2 章 M5、3 章(M5 の提案は M2-3a・M4-2 に依存)、11 章(決定 50 の「提案に回す案」)、12 章(M5a の申し送り: 履歴の `client_id` は提案の actor 表示と一緒に決める)
- `/mnt/project-files/m5/m5a-report.md`「見送り・残り」

## 範囲

本書は M5 の 3 つ目の計画 **M5c** で、拡張の最初の項目「提案(change set)」を実装する。M5 の他の項目(ブロック単位の競合判定、モジュールの MCP ツール、公開側 MCP、型ごとのツール、意味検索、サービスアカウント、型単位のスコープ)は含めない。

含めるもの:

- スコープ `record:propose`(PAT と OAuth の同意画面。owner と editor のロールに持たせる。viewer には持たせない)
- 提案の 5 種(`create` / `update` / `delete` / `publish` / `unpublish`)の作成・一覧・取得(MCP と REST)、採用・却下(REST のみ)
- 管理画面: サイドバーの「提案」(未処理の件数)、一覧、詳細(差分・採用・却下)、編集画面の「未処理の提案があります」の案内、履歴の「提案を採用」の表示
- 確認できないクライアントの publish(`confirmation_unavailable`)と PAT のスコープ不足(`insufficient_scope`)の message に、提案への導線を足す(決定 50 の「提案に回す案」。**自動では提案にしない**: ツールの出力の形を変えず、エージェントが `proposal_create` を選ぶ)
- 履歴の `proposal_id`(採用で生まれた版が、どの提案から来たかを持つ)
- M5a の申し送り「履歴の `client_id`」の決着: **埋めない**(`McpAuth` に OAuth の client_id は無く、提案の actor 表示は利用者と接続トークンの名前で足りる。列は残す)

含めないもの(理由):

- 提案の取り下げ(エージェント側の `proposal_withdraw`): 人が却下すれば済む。要望が出たら足す
- 提案に対するコメントのやり取り、修正の往復: 却下の理由(`reason`)を 1 回残すだけにする
- ホームの「確認待ち」カードへの提案の件数: サイドバーの件数で足りる
- 提案の作成を管理画面から(人が人に提案する): 経路は MCP / REST のまま。管理画面は採用・却下だけ
- 既存の書き込みツール(`record_update` など)の出力に「提案になった」形を足すこと: outputSchema が 3 形になりエージェントが混乱する。専用ツールにする(決定 57)

## Global Constraints

- **書き込みは既存の経路を通す**: 採用は `WRITE_HANDLERS`(`ops/write.ts`)の各ハンドラを呼ぶ。`writeRecordCore` / `publishRecordCore` / `deleteRecordCore` を提案から直接呼ばない(ハンドラのモジュール型のガード・冪等判定・tenantSlug の要求を再実装しない)
- **採用の actor は採用した人**(`ctx.auth.userId`、via は `rest`)。提案者(エージェント)は `proposals.actor` と履歴の `proposal_id` から辿る
- **提案は record の `version` も `fieldVersions` も進めない**。同期(sync)にも流れない(管理画面は REST で読む)。公開状態・ワークフロー状態の 2 軸に加わる 3 本目の軸で、採用のときだけ record が変わる
- **スコープは権限を絞るだけで増やさない**(16.3)。`record:propose` を持つトークンの提案も、採用には採用する人のロール(`record:write` / `record:delete` / `record:publish`)が要る
- **OAuth のスコープ不足は従来どおり HTTP 403 の step-up**。導線を足すのは PAT の業務エラー `insufficient_scope` と `confirmation_unavailable` の message だけ
- DO の RPC 戻り値は `rpc-unwrap.ts` の `asXxx()` で戻す。`@ts-expect-error` は禁止。マイグレーションは `pnpm --filter @plyrs/db generate` で生成し手書きしない(生成後に `pnpm format`)
- 用語: 日本語の文言は「提案」「採用」「却下」「提案者」。コードとツール名は `proposal`(`proposals` 表、`proposal_create` など)。用語集に「コードでは proposal」と書く。「効く / 効かない」は使わない
- コメント・ドキュメント・コミットメッセージ・ツール説明は日本語。コミットは各タスクの最後に 1 つ
- 決定ログは 57 から。決定 57(提案の実装形)を本書で足す
- ブランチは `claude/project-thread-pg3b5i` の 1 本、PR は 1 つ(計画のコミットを先頭に置く)。各タスクの前に `pnpm lint` `pnpm format:check` `pnpm typecheck` と触ったパッケージの vitest を通す

## Review Focus

1. **提案の後に record が進んだ**(人が管理画面でタイトルを直した、別の提案が採用された、削除された)状態での採用: `update` は現在の `fieldVersions` を base にして提案のフィールドだけを上書きし、`stale: true` を一覧と詳細に出す。削除済みなら `record_deleted` で提案は open のまま(Task 2)
2. **`create` の提案と同じ `recordId` の record が先にできている**: 採用は `already_exists`(ハンドラの冪等判定)で止まり、提案は open のまま。詳細は `currentVersion` が null でなくなるので `stale: true`(Task 2)
3. **権限の無い人の採用**: `record:publish` の無い editor は `publish` の提案を採用できず(`forbidden`)、viewer は何も採用・却下できない。`record:propose` だけの PAT は `record_update` を呼べず(`insufficient_scope`、message に `proposal_create` の案内)、`proposal_accept` は MCP の `tools/list` に出ない(Task 2・3)
4. **同じ proposalId の再送**: 同じ内容なら既存の提案を返し(採用済みでも同じ行を返す)、違う内容なら `already_exists`。Markdown で再送しても解決後の値で比べる(Task 2)
5. **履歴の畳み込み**: 採用した人が 15 分以内に 2 つの提案を採用しても、別々の版になり、それぞれの `proposalId` が付く。採用の直後に同じ人が管理画面で編集しても、採用の版には畳み込まれない(Task 1)

---

## ファイル構成

| ファイル | 責務 |
| --- | --- |
| `packages/db/src/schema.ts`、`packages/db/drizzle/0012_*.sql` | 変更。`proposals` 表と `record_history.proposal_id` |
| `apps/api/src/auth/permissions.ts`、`apps/api/src/auth/pat.ts`、`apps/api/src/oauth/consent-page.ts` | 変更。Operation / スコープ `record:propose` |
| `apps/api/src/do/history.ts`、`apps/api/src/ops/history.ts`、`apps/api/src/ops/read.ts` | 変更。履歴の `proposalId`(記録・畳み込みの規則・出力)。`OpContext.proposalId` |
| `apps/api/src/do/proposals.ts` | 新規。`proposals` 表の読み書き(行の形、INSERT、状態の更新、一覧、古い行の掃除) |
| `apps/api/src/ops/proposals.ts` | 新規。5 操作の宣言とハンドラ(`proposal_create` / `proposal_list` / `proposal_get` / `proposal_accept` / `proposal_reject`) |
| `apps/api/src/ops/catalog.ts`、`apps/api/src/ops/invoke.ts`、`apps/api/src/routes/tenant.ts` | 変更。カタログとハンドラの登録、`proposal_not_open` の HTTP 状態 |
| `apps/api/src/mcp/server.ts`、`apps/api/src/mcp/route.ts`、`apps/api/src/mcp/confirm.ts`、`apps/api/src/ops/write.ts` | 変更。本文の要約、instructions、スコープ不足と確認不能の導線、ツール説明 |
| `apps/admin/src/lib/permissions.ts`、`apps/admin/src/lib/tokens.ts`、`apps/admin/src/lib/labels.ts`、`apps/admin/src/lib/error-messages.ts` | 変更。スコープ・文言・エラー文 |
| `apps/admin/src/lib/proposals.ts`、`apps/admin/src/lib/admin-api.ts`、`apps/admin/src/lib/queries.ts`、`apps/admin/src/lib/history.ts` | 新規・変更。提案の型と純関数、API、クエリ、履歴の表示 |
| `apps/admin/src/components/proposals/proposal-list.tsx`、`proposal-diff.tsx`、`resolve-dialogs.tsx` | 新規。一覧・差分・採用 / 却下のダイアログ |
| `apps/admin/src/routes/t/$tenantSlug/proposals/index.tsx`、`proposals/$proposalId.tsx` | 新規。一覧と詳細の画面 |
| `apps/admin/src/components/shell/sidebar.tsx`、`apps/admin/src/routes/t/$tenantSlug/route.tsx`、`apps/admin/src/components/record-editor.tsx` | 変更。サイドバーの「提案」と件数、編集画面の案内 |
| `apps/e2e/tests/proposals.spec.ts`、`apps/e2e/playwright.config.ts` | 新規・変更。提案の一巡の E2E |
| `docs/design-spec.md`(16.3・16.5・16.8・決定 57)、`docs/glossary.md`、`docs/deploy.md`(3.7)、ロードマップ(2 章 M5c・4 章・6 章・14 章)、`/mnt/project-files/m5/m5c-report.md` | 変更・新規 |

---

## Task 1: スキーマ・スコープ・履歴の土台

`proposals` 表と `record_history.proposal_id` を足し、スコープ `record:propose` を api と admin の両方に通す。履歴は `proposalId` を記録し、提案から来た版を畳み込まない。

**Files:** Modify `packages/db/src/schema.ts`、`apps/api/src/auth/permissions.ts`、`apps/api/src/auth/pat.ts`、`apps/api/src/oauth/consent-page.ts`、`apps/api/src/do/history.ts`、`apps/api/src/ops/history.ts`、`apps/api/src/ops/read.ts`、`apps/admin/src/lib/permissions.ts`、`apps/admin/src/lib/tokens.ts`、`apps/admin/src/lib/labels.ts`(`TOKEN_LABELS.scopes` / `scopeDescriptions`)、`apps/admin/src/lib/history.ts`。Create `packages/db/drizzle/0012_*.sql`(生成)。Test: `apps/api/test/history.test.ts`、`apps/api/src/auth/permissions.test.ts`、`apps/api/test/pat-routes.test.ts`、`apps/admin/src/lib/permissions.test.ts`、`apps/admin/src/lib/tokens.test.ts`

**Interfaces:**
- Produces(`packages/db/src/schema.ts`):
  ```ts
  export const proposals = sqliteTable("proposals", {
    id: text("id").primaryKey(),                 // クライアント生成の UUIDv7(16.7 の冪等性)
    recordId: text("record_id").notNull(),
    type: text("type").notNull(),
    kind: text("kind").notNull(),                // 'create' | 'update' | 'delete' | 'publish' | 'unpublish'
    state: text("state").notNull().default("open"), // 'open' | 'accepted' | 'rejected'
    input: text("input"),                        // JSON: create / update の提案値(解決済みの具体値。変えるフィールドだけ)
    changedFields: text("changed_fields").notNull().default("[]"),
    status: text("status"),                      // 提案するワークフロー状態(無ければ NULL)
    baseVersion: integer("base_version").notNull(), // 提案時の records.version(create は 0)
    note: text("note"),                          // 提案者の説明
    actor: text("actor").notNull(), via: text("via").notNull(),
    tokenId: text("token_id"), clientId: text("client_id"),
    createdAt: text("created_at").notNull(),
    resolvedAt: text("resolved_at"), resolvedBy: text("resolved_by"), resolutionNote: text("resolution_note"),
    resultHistorySeq: integer("result_history_seq"), // 採用で生まれた版の history_seq
  }, (t) => [index("idx_proposals_state").on(t.state, t.createdAt), index("idx_proposals_record").on(t.recordId, t.state)]);
  // recordHistory に proposalId: text("proposal_id") を足す
  ```
- Produces(`auth/permissions.ts`): `Operation` に `"record:propose"`。`ROLE_PERMISSIONS.owner` と `editor` に足す(viewer には足さない)。admin の `lib/permissions.ts` も同じ(`permissions.test.ts` が一致を見る)
- Produces(`auth/pat.ts`): `PAT_SCOPES = ["record:read", "record:propose", "record:write", "record:delete", "record:publish", "type:manage"]`。`allowedScopes("editor")` は `["record:read", "record:propose", "record:write", "record:delete"]`。`isReadOnly` は変えない(`record:propose` は書き込み扱いで期限は 90 日)。admin の `lib/tokens.ts` の `PAT_SCOPES` も同じ順
- Produces(`do/history.ts`): `HistoryActor.proposalId?: string`、`HistoryEntry.proposalId: string | null`、`COLUMNS` と `rowToEntry` に `proposal_id`。`shouldFold` は `entry.proposalId !== undefined || latest.proposal_id !== null` なら false(提案の版は畳み込まない・畳み込ませない)
- Produces(`ops/read.ts`): `OpContext.proposalId?: string`。`historyActorOf(ctx)` が `proposalId: ctx.proposalId` を含める
- Produces(`ops/history.ts`): `historyEntrySchema` に `proposalId: z.string().nullable()`。admin の `lib/history.ts` の `HistoryEntry` にも `proposalId: string | null`
- 文言(`TOKEN_LABELS`): `scopes["record:propose"]: "提案(record:propose)"`、`scopeDescriptions["record:propose"]: \`${TERMS.content}の作成・編集・削除・公開を提案します。提案は管理画面で人が採用・却下します\``。`consent-page.ts` の `SCOPE_LABELS` も同じ文

- [ ] **Step 1: 失敗するテストを書く**
  - `apps/api/test/history.test.ts`: `recordHistory` を同じ actor・via・status で 15 分以内に 2 回呼び、1 回目に `proposalId: uuid(11)`、2 回目に `proposalId: uuid(12)` を付けると版が 2 つになり、`loadHistory` の各行の `proposalId` が一致する(Review Focus 5)/ 1 回目が提案で 2 回目が提案でなくても版が 2 つになる / どちらも提案でなければ従来どおり 1 版に畳み込む
  - `apps/api/src/auth/permissions.test.ts`: `can("editor", "record:propose")` が true、`can("viewer", "record:propose")` が false
  - `apps/api/test/pat-routes.test.ts`: editor が `["record:read", "record:propose"]` の PAT を発行できる(201)/ viewer は `scope_not_allowed`
  - `apps/admin/src/lib/tokens.test.ts`: `scopeOptionsFor("editor")` に `record:propose` が含まれ、`isReadOnlyScopes(["record:read", "record:propose"])` が false
- [ ] **Step 2: FAIL を確かめる** `pnpm --filter @plyrs/api exec vitest run --no-isolate --max-workers=1 test/history.test.ts test/pat-routes.test.ts src/auth/permissions.test.ts`、`pnpm --filter @plyrs/admin exec vitest run src/lib/tokens.test.ts src/lib/permissions.test.ts`
- [ ] **Step 3: スキーマを変えてマイグレーションを生成する** `pnpm --filter @plyrs/db generate && pnpm format`。生成物が `CREATE TABLE proposals` と `ALTER TABLE record_history ADD proposal_id` の 2 文であることを目で確かめる
- [ ] **Step 4: 実装**(Interfaces のとおり。`consent-page.ts` の `SCOPE_LABELS` は `Record<PatScope, …>` なので足さないと型エラーになる)
- [ ] **Step 5: PASS を確かめる。** Step 2 のコマンドに加えて `pnpm typecheck`、`pnpm --filter @plyrs/api exec vitest run --no-isolate --max-workers=1 test/oauth-consent.test.ts test/mcp-tools.test.ts`(スコープの並びを見るテストがあれば直す)
- [ ] **Step 6: Commit** `feat(db,api,admin): 提案の表と record:propose スコープ、履歴の proposal_id を足す`

## Task 2: DO の提案操作(作成・一覧・取得・採用・却下)

**Files:** Create `apps/api/src/do/proposals.ts`、`apps/api/src/ops/proposals.ts`。Modify `apps/api/src/ops/catalog.ts`、`apps/api/src/ops/invoke.ts`(`InvokeErrorCode` に `proposal_not_open`、`HANDLERS`)、`apps/api/src/routes/tenant.ts`(`ERROR_STATUS.proposal_not_open = 409`)。Test: `apps/api/test/ops-proposals.test.ts`(新規)、`apps/api/test/ops-catalog.test.ts`(カタログの件数を見ていれば直す)

**Interfaces:**
- Produces(`do/proposals.ts`):
  ```ts
  export type ProposalKind = "create" | "update" | "delete" | "publish" | "unpublish";
  export type ProposalState = "open" | "accepted" | "rejected";
  export interface ProposalRow {
    id: string; recordId: string; type: string; kind: ProposalKind; state: ProposalState;
    input: Record<string, unknown> | null; changedFields: string[]; status: WorkflowStatus | null;
    baseVersion: number; note: string | null;
    actor: string; via: Via; tokenId: string | null; clientId: string | null;
    createdAt: string; resolvedAt: string | null; resolvedBy: string | null;
    resolutionNote: string | null; resultHistorySeq: number | null;
  }
  export function loadProposal(sql: SqlStorage, id: string): ProposalRow | null;
  export function insertProposal(sql: SqlStorage, row: Omit<ProposalRow, "state" | "resolvedAt" | "resolvedBy" | "resolutionNote" | "resultHistorySeq">): void;
  export function resolveProposal(sql: SqlStorage, id: string, patch: { state: Exclude<ProposalState, "open">; resolvedAt: string; resolvedBy: string; resolutionNote?: string; resultHistorySeq?: number }): void;
  // 新しい順(id は UUIDv7 なので id の降順)。cursor は最後の id。recordId / state で絞る
  export function listProposals(sql: SqlStorage, query: { state?: ProposalState; recordId?: string; limit: number; cursor?: string }): { items: ProposalRow[]; nextCursor: string | null };
  export function countOpenProposals(sql: SqlStorage, recordId?: string): number;
  export const PROPOSAL_RETENTION_DAYS = 90; export const PROPOSAL_SWEEP_LIMIT = 50;
  // 採用・却下から PROPOSAL_RETENTION_DAYS を過ぎた行を PROPOSAL_SWEEP_LIMIT 件まで消す(proposal_create のついで)
  export function sweepResolvedProposals(sql: SqlStorage, now: string): number;
  ```
- Produces(`ops/proposals.ts`。宣言は `defineOperation`、Zod は `uuidSchema` / `WORKFLOW_STATUSES` / `VIAS` を使う):
  ```ts
  export const proposalKindSchema = z.enum(["create", "update", "delete", "publish", "unpublish"]);
  export const proposalStateSchema = z.enum(["open", "accepted", "rejected"]);
  export const proposalSummarySchema = z.object({
    id, recordId, type, kind, state, changedFields: z.array(z.string()), status: statusSchema.nullable(),
    baseVersion: z.number().int(),
    currentVersion: z.number().int().nullable(), // record が無ければ null(削除済みは version を返す)
    stale: z.boolean(), // create: record がある / それ以外: currentVersion !== baseVersion か record が無い・削除済み
    note: z.string().nullable(), actor: z.string(), via: z.enum(VIAS), tokenId: z.string().nullable(),
    createdAt, resolvedAt: nullable, resolvedBy: nullable, resolutionNote: nullable, resultHistorySeq: nullable,
  });
  export const proposalDetailSchema = proposalSummarySchema.extend({
    input: z.record(z.string(), z.unknown()).nullable(),
    // 現在 → 提案の差分(compareVersions)。create は {} → input、delete / publish / unpublish は []
    fields: z.array(z.object({ key: z.string(), before: z.unknown(), after: z.unknown() })),
  });
  // proposal_create: requires "record:propose", via ["mcp", "rest"], hints { readOnly: false, destructive: false, idempotent: true, openWorld: false }
  input: z.object({
    proposalId: uuidSchema, kind: proposalKindSchema, recordId: uuidSchema,
    type: z.string().min(1).optional(),            // create で必須
    input: z.record(z.string(), z.unknown()).optional(), // create / update で必須
    changedFields: z.array(z.string().min(1)).optional(), // update: 省略で input のキー
    status: statusSchema.optional(),               // create / update
    note: z.string().max(2000).optional(),
  }); output: proposalDetailSchema
  // proposal_list: requires "record:read", via ["mcp", "rest"], readOnly。input { state?: proposalStateSchema, recordId?: uuidSchema, limit: 1..100 default 20, cursor?: string }、output { items: proposalSummarySchema[], nextCursor }
  // proposal_get: requires "record:read", via ["mcp", "rest"], readOnly。input { proposalId }、output proposalDetailSchema
  // proposal_accept: requires "record:write", via ["rest"], needsTenantSlug: true, hints { readOnly: false, destructive: false, idempotent: false }。input { proposalId }、output { proposal: proposalDetailSchema, record: recordSnapshotSchema.nullable() }
  // proposal_reject: requires "record:write", via ["rest"]。input { proposalId, reason: z.string().max(500).optional() }、output { proposal: proposalDetailSchema }
  export const PROPOSAL_OPERATIONS: readonly OpSpec[]; export const PROPOSAL_HANDLERS;
  ```
- `proposal_create` のハンドラの順序: (1) kind ごとの必須の検査(`create` に `type` と `input`、`update` に `input`。欠けは `invalid_input`)。(2) 型を引く(`create` は `input.type`、他は record の `type`。無ければ `unknown_type`)、`moduleWriteDenial(sql, typeRow, ctx.auth.role)`(モジュール型のガードは提案にも同じに当てる)。(3) record の存在: `create` は無いこと(あれば `already_exists`)、他はあって削除済みでないこと(`not_found` / `record_deleted`)。`unpublish` は公開中であること(`not_published`)。(4) `create` / `update` は `resolveRichTextInputs(definition, input, currentInput | null)` で Markdown とブロック操作を具体値にし、`buildRecordInputSchema(definition).safeParse(merged)`(`create` は input そのまま、`update` は `{ ...loadRecordInput(sql, record), ...resolved }`)で `validation_failed` を返す(採用の段で人の手間にしない)。(5) 同じ `proposalId` の行があれば、`canonicalJson` で `{ kind, recordId, type, input(解決済み), changedFields, status ?? null, note ?? null }` を比べ、同じなら既存の行を返し、違えば `already_exists`(Review Focus 4)。(6) `insertProposal`(`baseVersion` は record の version、`create` は 0。actor / via / tokenId は `historyActorOf(ctx)`)。(7) `sweepResolvedProposals`。返り値は `proposal_get` と同じ detail
- `proposal_accept` のハンドラ: 行が無ければ `not_found`、`state !== "open"` なら `proposal_not_open`。kind ごとの権限を `requireOperation(ctx.auth, …)` で見る(`delete` → `record:delete`、`publish` / `unpublish` → `record:publish`。足りなければ `forbidden`。Review Focus 3)。`const inner: OpContext = { ...ctx, proposalId: row.id }` を作り、kind ごとに `WRITE_HANDLERS` を呼ぶ: `create` → `record_create(inner, { type, recordId, input, status })`、`update` → `record_update(inner, { recordId, input, changedFields, baseFieldVersions: current.fieldVersions, status: status ?? undefined, attempt: 1 })`(現在の `fieldVersions` を渡すので strict 判定は通る。Review Focus 1)、`delete` → `record_delete(inner, { recordId })`、`publish` → `record_publish(inner, { recordId })`(`ctx.tenantSlug` は REST の入口が `needsTenantSlug` で渡す)、`unpublish` → `record_unpublish(inner, { recordId })`。ハンドラが失敗なら**そのまま返す**(提案は open のまま。`already_exists` / `record_deleted` / `conflict` / `validation_failed` など。Review Focus 2)。成功なら `resolveProposal(… state: "accepted", resolvedBy: ctx.auth.userId, resultHistorySeq: latestHistorySeq(sql, recordId))`。`record` は `loadRecord(sql, recordId)`(delete は削除済みの snapshot、publish は変わらない snapshot)
- `proposal_reject`: `not_found` / `proposal_not_open` の後、`resolveProposal(… state: "rejected", resolutionNote: reason)`
- `invoke.ts`: `HANDLERS` に `...PROPOSAL_HANDLERS`。`catalog.ts` の `OPERATIONS` は `…WRITE_OPERATIONS, ...PROPOSAL_OPERATIONS, ...ASSET_OPERATIONS` の順(tools/list の順序が決定的なので、提案は書き込みの後・アセットの前)
- `tenant-do.ts` の `invoke` は変えない(`proposal_accept` は readOnly でないので transactionSync に包まれ、`effects.changedRecordIds` の broadcast と outbox の drain は既存のまま動く)

- [ ] **Step 1: 失敗するテストを書く**(`test/ops-proposals.test.ts`。`ops-write.test.ts` と同じく `freshStub()` と `mcpAuth({ scopes: ["record:read", "record:propose"] })`、採用は `{ ...auth("editor", "editor"), tenantId }` の AuthContext で `stub.invoke("proposal_accept", …, who, { tenantSlug: "s" })`)
  - `update`: Markdown の本文とタイトルの提案を作ると `state: "open"`、`stale: false`、`fields` が title と body の 2 件(before が現在、after が解決後の値)。record の `version` は変わらない。採用すると record が更新され、`resultHistorySeq` が `loadHistory` の先頭の `historySeq` に一致し、その版の `actor` は採用した人・`via` は `"rest"`・`proposalId` は提案の id
  - 採用の前に人が `stub.writeRecord` でタイトルを直す → `proposal_get` が `stale: true`。採用は通り、提案のフィールドだけが上書きされる(Review Focus 1)
  - `create`: 採用で record ができる。先に同じ `recordId` の record を作ってから採用すると `already_exists` で提案は open のまま、`stale: true`(Review Focus 2)
  - `delete`: editor の採用で削除される。`publish`: `record:publish` を持たない role(viewer は `record:write` も無いので、`requireOperation` の順に `forbidden`)/ owner の採用で公開される(`loadPublicationState` で確認)。`unpublish`: 未公開の record への提案は `not_published`
  - 同じ `proposalId` の再送: 同じ内容(Markdown で再送)は同じ行、違う内容は `already_exists`(Review Focus 4)。`note` が違っても `already_exists`
  - `proposal_accept` / `proposal_reject` を 2 回: 2 回目は `proposal_not_open`。却下の `reason` が `resolutionNote` に入る
  - `proposal_list`: `state: "open"` で絞り、`recordId` で絞り、`limit: 1` の `nextCursor` で続きが取れる。新しい順
  - スコープ: `["record:read"]` だけの `McpAuth` の `proposal_create` は `insufficient_scope`。`["record:read", "record:propose"]` の `proposal_accept` は `insufficient_scope`(スコープに `record:write` が無い。via は rest 限定だが DO の判定も揃える)
  - モジュール型: booking の型(`BOOKING_RESERVATION_KEY`)への editor の `update` 提案は `booking:*` の拒否(`moduleWriteDenial`)
  - 掃除: `resolvedAt` を 91 日前に書いた accepted の行が、次の `proposal_create` で消える。open の行は消えない
- [ ] **Step 2: FAIL を確かめる** `pnpm --filter @plyrs/api exec vitest run --no-isolate --max-workers=1 test/ops-proposals.test.ts`
- [ ] **Step 3: 実装**(`do/proposals.ts` → `ops/proposals.ts` → 登録)
- [ ] **Step 4: PASS を確かめる。** `test/ops-proposals.test.ts` と、カタログの件数・順序を見る `test/ops-catalog.test.ts` `test/mcp-tools.test.ts` `test/ops-rest.test.ts`(REST の `/ops/proposal_accept` に `needsTenantSlug` の slug 照会が付くことを `ops-rest.test.ts` に 1 件足す)
- [ ] **Step 5: Commit** `feat(api): 提案の操作(proposal_create / list / get / accept / reject)を操作カタログに足す`

## Task 3: MCP の導線(ツール説明・要約・スコープ不足と確認不能の案内)

**Files:** Modify `apps/api/src/mcp/server.ts`(`summarize`、`instructions`)、`apps/api/src/mcp/route.ts`(`patScopeFailure`)、`apps/api/src/mcp/confirm.ts`(`confirmation_unavailable` の message)、`apps/api/src/ops/write.ts`(`record_update` / `record_publish` / `record_unpublish` の description)。Test: `apps/api/test/mcp-proposals.test.ts`(新規)、`apps/api/test/mcp-confirm.test.ts`、`apps/api/test/mcp-gate.test.ts`、`apps/e2e/tests/mcp-write.spec.ts`(文言を見ていれば直す)

**Interfaces:**
- `route.ts`: `patScopeFailure(id, missing, canPropose: boolean)`。`canPropose = auth.scopes.includes("record:propose") && ["record:write", "record:delete", "record:publish"].includes(missing)`。true なら message の末尾に「このトークンは提案(proposal_create)なら送れます。変更を提案にして、人に採用を依頼してください」を足し、`details.alternative: "proposal_create"` を付ける
- `confirm.ts`: `confirmOperation` の引数に `canPropose: boolean` を足す。`confirmation_unavailable` の message を「…公開・取り下げはできません。status を ready にして管理画面で人が公開するか、proposal_create(kind: publish)で公開を提案してください」にし、`canPropose` が true のときだけ後半を付ける。`structuredContent.error.details = { alternative: "proposal_create" }`(true のとき)
- `server.ts`: `callConfirmed` が `canPropose: deps.auth.scopes.includes("record:propose")` を渡す。`summarize` に `proposal_create`(「提案 <id> を作った(<kind>、record <recordId>)。採用・却下は人が管理画面で行う。状態は proposal_get で読める」)、`proposal_get`(「提案 <id>: <state>、<kind>、record <recordId>。差分は structuredContent.fields」)、`proposal_list`(「N 件。続きは…」)。`instructions` に「直接書けないトークン(record:propose)では proposal_create で変更を提案し、人が管理画面で採用する。conflict が attempt 3 でも続くときも提案に回す」を足す。`UNTRUSTED_PREFACE` は `proposal_get` / `proposal_list` の本文の先頭にも付ける(提案の `note` と `input` はエージェントや利用者が書いた内容)
- `write.ts` の description: `record_update` の「attempt 3 で conflict なら、それ以上は試さずに人に確認を依頼する」を「…試さず、proposal_create で変更を提案する(人が管理画面で採用する)」に。`record_publish` / `record_unpublish` の「status を ready にして人に公開を依頼する」に「または proposal_create(kind: publish / unpublish)で提案する」を足す

- [ ] **Step 1: 失敗するテストを書く**(`test/mcp-proposals.test.ts`。`mcp-tools.test.ts` の `rpc` / `call` と同じ組み立て。PAT は `["record:read", "record:propose"]` と `["record:read", "record:write"]` の 2 本)
  - `tools/list` に `proposal_create` / `proposal_list` / `proposal_get` が `record_unpublish` の後・`asset_upload` の前に並び、`proposal_accept` / `proposal_reject` は出ない(Review Focus 3)
  - 提案用 PAT の `record_update` は HTTP 200 の `isError` で `code: "insufficient_scope"`、`details.required: "record:write"`、`details.alternative: "proposal_create"`、message に `proposal_create` を含む。`["record:read"]` だけの PAT では `alternative` が付かない
  - 提案用 PAT の `proposal_create`(update、Markdown の本文)が通り、`structuredContent.fields` が 1 件、本文は `UNTRUSTED_PREFACE` で始まる。`proposal_get` / `proposal_list` も通る。書き込み用 PAT(`record:propose` 無し)の `proposal_create` は `insufficient_scope`
  - `mcp-confirm.test.ts` に足す: `record:publish` と `record:propose` を持つ PAT で elicitation を宣言しない `record_publish` は `confirmation_unavailable` で、`details.alternative` が `proposal_create`。`record:propose` の無い PAT では `details` が無い
- [ ] **Step 2: FAIL を確かめる** `pnpm --filter @plyrs/api exec vitest run --no-isolate --max-workers=1 test/mcp-proposals.test.ts test/mcp-confirm.test.ts`
- [ ] **Step 3: 実装**
- [ ] **Step 4: PASS を確かめる。** 上記と `test/mcp-tools.test.ts` `test/mcp-gate.test.ts` `test/mcp-route.test.ts`。`pnpm lint` `pnpm format:check` `pnpm typecheck`
- [ ] **Step 5: Commit** `feat(api): MCP に提案のツールを出し、スコープ不足と確認不能の応答に提案への導線を足す`

## Task 4: 管理画面(サイドバー・一覧・詳細・採用 / 却下・編集画面の案内・履歴の表示)

**Files:** Create `apps/admin/src/lib/proposals.ts`、`apps/admin/src/lib/proposals.test.ts`、`apps/admin/src/components/proposals/proposal-list.tsx`、`proposal-diff.tsx`、`resolve-dialogs.tsx`、`proposal-list.test.tsx`、`apps/admin/src/routes/t/$tenantSlug/proposals/index.tsx`、`proposals/$proposalId.tsx`。Modify `apps/admin/src/lib/admin-api.ts`、`apps/admin/src/lib/queries.ts`、`apps/admin/src/lib/labels.ts`(`NAV_LABELS.proposals`、`PROPOSAL_LABELS`、`HISTORY_LABELS.summary`)、`apps/admin/src/lib/error-messages.ts`、`apps/admin/src/lib/history.ts`(`summarizeEntry`)、`apps/admin/src/components/shell/sidebar.tsx`、`apps/admin/src/components/shell/sidebar.test.tsx`、`apps/admin/src/routes/t/$tenantSlug/route.tsx`、`apps/admin/src/components/record-editor.tsx`、`apps/admin/src/lib/history.test.ts`。`routeTree.gen.ts` は `pnpm --filter @plyrs/admin build` で再生成する

**Interfaces:**
- `lib/proposals.ts`(純関数。router と React に依存しない):
  ```ts
  export type ProposalKind = "create" | "update" | "delete" | "publish" | "unpublish";
  export type ProposalState = "open" | "accepted" | "rejected";
  export interface ProposalSummary { /* api の proposalSummarySchema と同じ形(HTTP 契約) */ }
  export interface ProposalDetail extends ProposalSummary { input: Record<string, unknown> | null; fields: FieldChange[] }
  export function kindLabel(kind: ProposalKind): string;   // PROPOSAL_LABELS.kind
  export function stateLabel(state: ProposalState): string;
  // 一覧の見出し: create は input[titleField] ?? input.title ?? input.name ?? recordId の先頭 8 桁、他は同期の record のタイトル(titleOf)
  export function proposalTitle(p: Pick<ProposalSummary, "kind" | "recordId" | "type"> & { input?: Record<string, unknown> | null }, definition: ContentTypeDefinition | undefined, recordTitle: string | undefined): string;
  // 「○○ が MCP から 3 フィールドの更新を提案」のような 1 行
  export function summarizeProposal(p: ProposalSummary, members?: readonly MemberName[], tokenName?: string): string;
  export function openProposalsFor(items: readonly ProposalSummary[], recordId: string): ProposalSummary[];
  // 採用に要る操作(画面の出し分け。守りは API)
  export function acceptOperationFor(kind: ProposalKind): "record:write" | "record:delete" | "record:publish";
  ```
- `admin-api.ts`: `listProposals(tenantId, query: { state?: ProposalState; recordId?: string; cursor?: string }): Promise<{ items: ProposalSummary[]; nextCursor: string | null }>`、`getProposal(tenantId, proposalId): Promise<ProposalDetail>`、`acceptProposal(tenantId, proposalId): Promise<{ proposal: ProposalDetail; record: unknown }>`、`rejectProposal(tenantId, proposalId, reason?: string): Promise<{ proposal: ProposalDetail }>`(すべて `invokeOperation`)
- `queries.ts`: `openProposalsQueryOptions(adminApi, tenantId)`(`queryKey: ["proposals", tenantId, "open"]`、`staleTime: 10_000`、`refetchInterval: 30_000`、`retry: 1`)、`proposalQueryOptions(adminApi, tenantId, proposalId)`(`staleTime: 0`)
- 文言(`labels.ts`): `NAV_LABELS.proposals: "提案"`。`PROPOSAL_LABELS = { title: "提案", crumb: "提案", kind: { create: "作成", update: "更新", delete: "削除", publish: "公開", unpublish: "公開の取り下げ" }, state: { open: "未処理", accepted: "採用", rejected: "却下" }, tabs: { open: "未処理", resolved: "処理済み" }, summary: (who, via, kind, count) => …, stale: "提案の後に内容が変わっています", staleHelp: "差分は現在の内容との比較です。採用すると提案のフィールドだけが上書きされます", note: "提案者の説明", noNote: "(説明なし)", diffTitle: "現在との差分", before: "現在", after: "提案", noChanges: "現在と同じ内容です", accept: "採用する", reject: "却下する", acceptDialog: { title: (kind) => …, body: (summary) => …, confirm: "採用する" }, rejectDialog: { title: "却下しますか？", reason: "理由(任意)", confirm: "却下する" }, accepted: "採用しました", rejected: "却下しました", acceptFailed: "採用できませんでした", rejectFailed: "却下できませんでした", loadFailed: "提案を読み込めませんでした", empty: "未処理の提案はありません", emptyResolved: "処理済みの提案はありません", openRecord: "コンテンツを開く", editorBanner: (n) => \`この${TERMS.content}には未処理の提案が ${n} 件あります\`, editorBannerLink: "提案を見る", resolvedBy: (who, at) => … , notFound: "見つかりませんでした" }`。`HISTORY_LABELS.summary.write` は `proposalId` があれば「${who} が提案を採用して ${count} フィールドを変更」、`publish` / `unpublish` / `delete` も「提案を採用して」を挟む(`summarizeEntry` が `entry.proposalId !== null` で分岐)
- `error-messages.ts`: `proposal_not_open: "この提案は既に処理されています。画面を再読み込みしてください"`、`insufficient_scope` は既存のまま
- `sidebar.tsx`: props に `openProposalCount: number | null`(null は未取得)。「メディア」の下に `NavLink`(label `NAV_LABELS.proposals`、icon `Inbox`、href `${base}/proposals`、`entries` に `{ key: "proposals", href }`)。件数が 1 以上なら label の右に `Badge`(tone `accent`)で数を出す。`route.tsx` が `useQuery(openProposalsQueryOptions(…))` の `items.length` を渡す
- `proposals/index.tsx`: `validateSearch` で `tab: "open" | "resolved"`(既定 open)と `recordId?: string`。`Tabs` で切り替え、open は `openProposalsQueryOptions`、resolved は `adminApi.listProposals(tenantId, { state: undefined })` を自前の `useQuery` で読んで `state !== "open"` を表示(`cursor` で「さらに表示」。`history.tsx` の `upsertPage` と同じ積み方)。`recordId` があればその record だけ。行(`ProposalList`): 見出し(`proposalTitle`)、種別の `Badge`、`summarizeProposal`、`RelativeTime`、stale の `Badge`(warning)。行は詳細へのリンク
- `proposals/$proposalId.tsx`: `proposalQueryOptions` で詳細。見出しは `proposalTitle`、`PageBody` に: 概要(種別・状態・提案者・経路・作成日時・`note`)、stale の `Banner tone="warning"`、`ProposalDiff`(`formatFieldDiff` を再利用。`fields` が空で kind が update / create なら `noChanges`、delete / publish / unpublish なら種別の説明文)、ボタン「採用する」(`useCan(acceptOperationFor(kind))` のときだけ)「却下する」(`useCan("record:write")`)、「コンテンツを開く」(create 以外。`/t/$tenantSlug/content/$type/$recordId`)。採用・却下は `ConfirmDialog`(却下は `TextArea` で reason)。成功で `toaster.success`、`["proposals", tenantId]` と `publicationQueryOptions` と `["history", …]` を invalidate し、一覧へ戻る。失敗は `errorMessage(cause, PROPOSAL_LABELS.acceptFailed)` を `toaster.error`(`conflict` / `already_exists` / `record_deleted` などは既存の文)
- `record-editor.tsx`: `record !== null` のとき `useQuery(openProposalsQueryOptions)` を読み、`openProposalsFor(items, record.id).length > 0` なら `PublishBox` の上に `Banner tone="warning"` で `editorBanner(n)` と `/proposals?recordId=` へのリンク

- [ ] **Step 1: 失敗するテストを書く**
  - `lib/proposals.test.ts`: `proposalTitle` が create で `input.title` を使い、無ければ recordId の先頭 8 桁 / update で同期の record のタイトル / `summarizeProposal` が members のメールと「MCP」を含む / `openProposalsFor` が recordId で絞る / `acceptOperationFor("publish") === "record:publish"`
  - `lib/history.test.ts`: `summarizeEntry` が `proposalId` 付きの write で「提案を採用して」を含む
  - `components/proposals/proposal-list.test.tsx`(jsdom + Testing Library): 2 件の提案を描いて見出し・種別・stale のバッジが出る、空なら `empty` の文
  - `components/shell/sidebar.test.tsx`: `openProposalCount: 3` で「提案」のリンクと「3」が出る、0 なら数は出ない
- [ ] **Step 2: FAIL を確かめる** `pnpm --filter @plyrs/admin exec vitest run src/lib/proposals.test.ts src/lib/history.test.ts src/components/proposals src/components/shell/sidebar.test.tsx`
- [ ] **Step 3: 実装**(`lib` → `admin-api` / `queries` → components → routes → sidebar / route.tsx / record-editor)。`pnpm --filter @plyrs/admin build` で `routeTree.gen.ts` を更新する
- [ ] **Step 4: PASS を確かめる。** admin の vitest 全件 `pnpm --filter @plyrs/admin exec vitest run`、`pnpm lint` `pnpm format:check` `pnpm typecheck`
- [ ] **Step 5: Commit** `feat(admin): 提案の一覧・詳細・採用・却下の画面と、サイドバー・編集画面・履歴の表示を足す`

## Task 5: E2E・文書・報告

**Files:** Create `apps/e2e/tests/proposals.spec.ts`、`/mnt/project-files/m5/m5c-report.md`。Modify `apps/e2e/playwright.config.ts`、`docs/design-spec.md`(16.3・16.5・16.8・決定 57)、`docs/glossary.md`、`docs/deploy.md`(3.7)、`docs/superpowers/plans/2026-11-01-mcp-roadmap.md`(2 章 M5c、4 章、6 章、14 章「M5c 完了時の申し送り」)

**Interfaces:**
- `proposals.spec.ts`(project `proposals`、`dependencies: ["core-journey"]`。テナントは自前 `props`。`mcp-write.spec.ts` の `tool` / `uuidv7` / PAT 発行の手順を写す): (1) owner が API で型 `article`(title, body)と record を作る。(2) `["record:read", "record:propose"]` の PAT で `record_update` → `insufficient_scope` と `details.alternative: "proposal_create"`。(3) 同じ PAT で `proposal_create`(update、Markdown の本文と title)→ `state: "open"`。(4) 管理画面のサイドバーの「提案」に件数 1 が出る → 開く → 行に見出しと「更新」→ 詳細で「現在との差分」に title の行(前が元のタイトル、後が提案)→「採用する」→ 確認 → トースト「採用しました」→ 一覧が空。(5) `record_get` で title が提案の値、`record_history` の先頭の `via` が `rest` で `proposalId` が提案の id。(6) もう 1 つ提案(publish)を作り、詳細で「却下する」→ 理由を入れる → 「却下しました」。`proposal_get` が `rejected` と `resolutionNote`
- design-spec 16.8 の「提案(change set、論点 B4)」の段落を実装の形に書き換える: 専用ツール、採用は人の権限と actor、具体値で保存、stale、履歴の `proposal_id`、採用・却下は管理画面のみ、`confirmation_unavailable` と PAT の `insufficient_scope` の導線、保持 90 日。16.3 のスコープの列挙に `record:propose`(owner / editor)。16.5 の記録する属性に `proposal_id`(畳み込まない)と「`client_id` は埋めない(決定 57)」。決定 57: **提案は専用ツール `proposal_create` で作り、採用・却下は管理画面だけ、採用は採用した人の権限・actor で既存の書き込みハンドラを通す**(M5c、2026-11-07)。根拠: 既存ツールの出力に提案の形を混ぜると outputSchema が 3 形になりエージェントが混乱する。採用を人の操作に限ることで「別の人の承認」(16.8)が成り立つ。既存ハンドラを通すので検証・一意性・モジュールフック・履歴・公開用 DB の反映が提案のためだけに分岐しない。`client_id` は `McpAuth` に無く、提案者の表示は利用者と接続トークンで足りる
- glossary の「提案(change set)」行に「コードとツール名では proposal(`proposals` 表、`proposal_create` など)。採用・却下は管理画面の操作」を足す
- deploy.md 3.7「提案(M5c、design-spec 16.8)」: ツールの表(`proposal_create` / `proposal_list` / `proposal_get`、スコープ)、PAT の発行で `record:propose` を選ぶ案内、管理画面の「提案」での採用、所有者の確認手順(preview): (1) `record:read record:propose` の PAT を発行し、Claude Code で記事の更新を頼む → エージェントが `proposal_create` を選ぶ(`record_update` の `insufficient_scope` の案内に従う)。(2) 管理画面の「提案」で差分を見て採用。(3) 公開を頼む → 確認が出るクライアントでは従来どおり、`record:publish` の無い PAT では `insufficient_scope` の案内から publish の提案になる
- ロードマップ: 2 章に `#### M5c 提案(change set)— 詳細計画 2026-11-07-m5c-change-set.md` の表(PR 1 本)、4 章の未決事項に「提案の実装形」→ 決定 57、6 章の表の M5 行に M5c、14 章「M5c 完了時の申し送り」(残り: 取り下げ・コメントの往復・ホームの件数は見送り。次の M5 の項目の候補)
- 報告 `m5c-report.md`: M5a / M5b の報告と同じ構成(PR、検証、見送り・残り、所有者にお願いすること)

- [ ] **Step 1: `proposals.spec.ts` を書き、`playwright.config.ts` に project を足す**
- [ ] **Step 2: E2E を流す** `pnpm --filter @plyrs/e2e test`(全 9 spec。`.wrangler` が消えるので手元のローカルデータは失われる)。通らなければ直す
- [ ] **Step 3: 文書を更新する**(design-spec・glossary・deploy・ロードマップ)
- [ ] **Step 4: 全体の確認** `pnpm lint && pnpm format:check && pnpm typecheck && pnpm test`、`pnpm --filter @plyrs/api check:deploy`
- [ ] **Step 5: Commit** `docs: 提案(change set)の決定 57、接続ガイド 3.7、M5c の申し送り`
- [ ] **Step 6: PR を作り、報告を `/mnt/project-files/m5/m5c-report.md` に書く**
