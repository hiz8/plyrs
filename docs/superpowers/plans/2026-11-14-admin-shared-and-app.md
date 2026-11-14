# 管理画面の残りを shared と app へ移す(ADR 0001 手順 5)実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `apps/admin/src` の `lib/` と `components/` に残るファイルを `shared/`(`api/`・`lib/`・`ui/`)と `app/` へ移して 2 つのディレクトリを削除し、ADR 0001 の移行を完了する。

**Architecture:** 依存の向きに沿って `shared/api` → `shared/lib` → `shared/ui` → `app/` の順に移す。各段階で、移した区画は shared だけに依存する状態になり、手順 2 で有効にした shared の依存ルールがそのまま通る。lint のルールは変えない。最後に、`labels.ts` に残る 1 機能だけの文言を使う側へ移し、文書とコメントのパスを直す。挙動は変えない。

**Tech Stack:** TypeScript 7、Vite 8(エイリアス `~/`)、vitest 4、oxlint 1.86(`no-restricted-imports`)、TanStack Start(エントリ `router.tsx`・`start.ts`・`server.ts`)

**Spec:** `docs/adr/0001-admin-directory-structure.md`(「置き場所の規則」の 3 と 4、「移行の手順」の手順 5)。手順 4 の計画 `docs/superpowers/plans/2026-11-14-admin-features.md` の末尾の引き継ぎ事項も対象に含む。

## Global Constraints

- 挙動を変えない。行うのは、ファイルの移動、import の書き換え、文言の定数の置き場所の変更、コメントと文書の更新だけ。関数の中身、文言の値、テストの期待値は変えない。
- フレームワークのエントリ(`router.tsx`・`start.ts`・`server.ts`)と `routeTree.gen.ts` は `src/` 直下から動かさない。ルートのファイルも動かさない。
- `oxlint.config.ts` のルールと `vite.config.ts` は変えない。lint の抑止コメントと `@ts-expect-error` は足さない。
- import の書き方:
  - shared の同じ区画(`shared/api/` など)の中: 相対 import(`./x`)。
  - shared の別の区画、features、routes、test-utils から shared へ: `~/shared/<区画>/x`。
  - `app/` の中どうしと、`src/` 直下のエントリから `app/` へ: 相対 import(`./api-paths`、`./app/error-screen`)。
  - `src/` 直下のエントリと `app/` から shared へ: `~/shared/<区画>/x`。ただし次の例外がある。
  - **`server.ts` と、そこから読み込む `app/server-routing.ts`・`app/api-paths.ts` は `~/` を使わない。** `server.ts` は `tsconfig.worker.json` で型チェックしており、そこには `paths` がない。この 3 ファイルは shared を import しない(いまも import していない)。
- shared は shared だけに依存する(テストは `~/test-utils/` も可)。shared から features・routes・app 層を import しない。
- 文書・コメント・コミットメッセージは日本語で、`docs/glossary.md` の語を使う。
- コミットは 1 タスク 1 つ。タイトルは種別とスコープ込みで 50 文字以内、種別は feat / fix / docs / refactor / test / chore のいずれか(commit スキルの規約)。本文に「ADR 0001 の移行手順 5」と書く。
- コマンドは `pnpm` と書く。サンドボックスでは `corepack pnpm` に読み替える。admin の `build` と e2e はサンドボックス外で実行する。admin の vitest は、タスクに書いたパスを指定して回す。git は 1 回の呼び出しで 1 コマンドにする。

## この計画で決めたこと

ADR が決めていない点を、次のように決めた。タスク 7 で ADR に追記する。

1. **shared の区画の分け方。** `api/` は API クライアント・契約の型・トークンとセッション・クエリの定義・API のエラーの文言。`ui/` は 2 つ以上の機能かルートで使う部品とそのスタイル。`lib/` はそれ以外の純関数・フック・文言・同期の Context。
2. **`components/settings/dialog-note.tsx` は `shared/ui/dialog-note.tsx` に置く**(`settings/` の階層は残さない)。
3. **`lib/mention-contract.test.ts` は `shared/lib/` に置く。** パッケージ間の契約のテストで、admin のファイルを import していない。このテストのパスを書いているコメント(`packages/ui`・`packages/metamodel`・`design-spec.md`)も直す。
4. **`src/` 直下のテスト 5 本。** `super-ops`・`super-tenants` は `routes/super/-tests/` へ、`super-login` は `/super-login` と `/super/*` の両方を開くので `routes/-tests/` へ移す。`stylex-tokens.test.ts` は、対象の fixture の隣(`test-utils/stylex-tokens/`)へ移す。`router.test.tsx` は、対象の `router.tsx`・`start.ts` の隣なので `src/` 直下に残す。
5. **`labels.ts` に残る、1 つの機能・画面だけが使う文言は、使う側へ移す**(タスク 6)。`labels.ts` の先頭のコメントが定める規則に合わせる。`DIALOGS` は `delete`・`leave`・`cancel` だけを残す(`delete` は record とメディアの両方が使う)。このタスクは移動ではなく定数の分割なので、不要なら丸ごと外せるように最後に置いた。

## 移行後の構成

```
apps/admin/src/
  router.tsx, start.ts, server.ts, routeTree.gen.ts, router.test.tsx, vite-env.d.ts
  app/       api-paths, server-routing, error-screen
  routes/    (-tests/ に super-login、super/-tests/ に super-ops・super-tenants が加わる)
  features/  records/, media/, content-types/
  shared/
    api/     admin-api, api-client, api-contracts, client-session, error-messages, network-error,
             public-api, queries, super-api, token-manager
    lib/     breadcrumbs, bulk, clipboard, datetime, field-kind, labels, navigation, permissions,
             record-label, router-context, search, sync, sync-context, sync-indicator, theme,
             use-bulk-action, use-can, use-collection, use-leave-guard, mention-contract.test.ts
    ui/      bulk-bar-styles, connection-banner, dialog-note, leave-guard-dialog, tenant-page-header
             (page-body.test.tsx を含む)
    styles/  styles.css
  test-utils/ (stylex-tokens/ に stylex-tokens.test.ts が加わる)
```

## 移動の共通手順

タスク 1〜5 は、次の手順で進める。

1. 表のファイルを移す(単体テストも同じ対応で移す)。
2. 移したファイルの import を、Global Constraints の書き方に直す。
3. 移したファイルを外から import している箇所を直す。`vi.mock(…)` と動的な `import(…)` の文字列も直す。`test-utils/` の相対 import(`../lib/x`)は `~/shared/<区画>/x` にする(`../router` はそのまま)。
4. `pnpm format` を実行する。
5. タスクの検証コマンドを実行する。

`vi.mock` の対象が実在することは、手順 4 の計画(`2026-11-14-admin-features.md`)の「移動の共通手順」にある確認コマンドで確かめる。出力が空なら合格。以下では「mock の確認」と書く。

## Review Focus

テストが通っていても壊れうる点。確認は、括弧のタスクに入れてある。

1. **`server.ts` の経路**: Worker のエントリが読み込む `app/server-routing.ts`・`app/api-paths.ts` の import を誤ると、dev と E2E が通っても実環境で壊れうる(`CLAUDE.md` の SPA シェル配信の注意)。`tsconfig.worker.json` の型チェックと、ビルドの prerender が `/` を 200 で返すことを確かめる(タスク 4)。マージ後に preview で確認する。
2. **チャンクの構成**: ファイルを移すだけなので、ビルド結果のチャンクは名前とサイズが前後でほぼ同じになるはずである。エントリが読み込む範囲が変われば、ここに差が出る(タスク 1 で基準を取り、タスク 7 で比べる)。
3. **`vi.mock` の対象の書き換え漏れ**: 差し替えが外れても、テストは通ることがある(各タスクの mock の確認)。
4. **テストの取りこぼし**: 着手前はテストのファイルが 157、`it`/`test` の数が 805。完了時も同じ(タスク 7)。
5. **文言の値**: タスク 6 で移す文言の値が 1 文字も変わっていないこと(タスク 6 の差分の確認)。

---

### Task 1: API まわりを `shared/api/` へ移す

**Files:**

| 移動元(`apps/admin/src/lib/`) | 移動先 |
| --- | --- |
| `admin-api`・`api-client`・`api-contracts`・`client-session`・`error-messages`・`network-error`・`public-api`・`queries`・`super-api`・`token-manager`(10 ファイル)と各 `*.test.ts`(`api-contracts`・`super-api` 以外の 8 本) | `shared/api/` |

- Modify: これらを import しているファイル(`router.tsx`、routes、features、`lib/` の残り、`components/` の残り、`test-utils/`)

**Interfaces:**

- Produces: `~/shared/api/<名前>`。export する名前は変わらない。

- [ ] **Step 1: 着手前の基準を記録する**

```bash
find apps/admin/src -name '*.test.ts' -o -name '*.test.tsx' | wc -l          # 157
grep -rE "^\s*(it|test)(\.each\([^)]*\))?\(" --include='*.test.ts' --include='*.test.tsx' apps/admin/src | wc -l   # 805
pnpm --filter @plyrs/admin build                                              # サンドボックス外
mkdir -p .superpowers
find apps/admin/dist/client -name '*.js' -printf '%s %f\n' | sed -E 's/-[A-Za-z0-9_-]{8}\.js$//' | sort -k2 > .superpowers/chunks-before.txt
```

Expected: 157 と 805。ビルドが通る。`.superpowers/` は git の管理外なので、基準のファイルはコミットされない。

- [ ] **Step 2: 表のファイルを移し、import を直す(「移動の共通手順」1〜4)**

`shared/api/` の中どうしは `./x`。`router.tsx` からは `~/shared/api/x`。

- [ ] **Step 3: 検証する**

```bash
pnpm lint
pnpm --filter @plyrs/admin typecheck
grep -rnE '"[^"]*lib/(admin-api|api-client|api-contracts|client-session|error-messages|network-error|public-api|queries|super-api|token-manager)"' apps/admin/src
pnpm --filter @plyrs/admin exec vitest run src/shared/api
pnpm format:check
```

mock の確認も実行する。

Expected: lint・typecheck・format:check はエラーなし。grep と mock の確認は出力なし。vitest は 8 ファイルとも PASS。

- [ ] **Step 4: コミットする**

`refactor(admin): API まわりを shared/api へ移す`

---

### Task 2: `lib/` の残りを `shared/lib/` へ移す

**Files:**

| 移動元(`apps/admin/src/lib/`) | 移動先 |
| --- | --- |
| `breadcrumbs`・`bulk`・`clipboard`・`datetime`・`field-kind`・`labels`・`navigation`・`permissions`・`record-label`・`router-context`・`search`・`sync`・`sync-context.tsx`・`sync-indicator`・`theme`・`use-bulk-action`・`use-can`・`use-collection`・`use-leave-guard`(19 ファイル)と各テスト(15 本) | `shared/lib/` |
| `mention-contract.test.ts` | `shared/lib/` |

`api-paths` と `server-routing` は移さない(タスク 4 で `app/` へ移す)。

- Modify: これらを import しているファイル。`labels` は 60 ファイル以上から使われている。

**Interfaces:**

- Consumes: タスク 1 の `~/shared/api/x`(`labels`・`navigation`・`permissions`・`router-context` が使う)。
- Produces: `~/shared/lib/<名前>`。

- [ ] **Step 1: 表のファイルを移し、import を直す**

`vi.mock("~/lib/clipboard", …)` と `vi.mock("~/lib/use-leave-guard", …)` は、`~/shared/lib/…` にする。`shared/lib/labels.ts` の中のコメントにある `lib/use-bulk-action.ts` も、新しいパスに直す。

- [ ] **Step 2: 検証する**

```bash
pnpm lint
pnpm --filter @plyrs/admin typecheck
ls apps/admin/src/lib
grep -rnE '"(~/|(\.\./)+|\./)lib/[a-z-]+"' apps/admin/src | grep -vE 'lib/(api-paths|server-routing)"|features/[a-z-]+/|shared/'
pnpm --filter @plyrs/admin exec vitest run src/shared
pnpm format:check
```

mock の確認も実行する。

Expected: `ls` に残るのは `api-paths`・`server-routing` とそのテストの 4 ファイルだけ。grep と mock の確認は出力なし。vitest は `shared/api` の 8 本と `shared/lib` の 16 本が PASS。

- [ ] **Step 3: コミットする**

`refactor(admin): lib の残りを shared/lib へ移す`

---

### Task 3: 共通の部品を `shared/ui/` へ移す

**Files:**

| 移動元(`apps/admin/src/components/`) | 移動先 |
| --- | --- |
| `bulk-bar-styles.ts`・`connection-banner.tsx`・`leave-guard-dialog.tsx`・`tenant-page-header.tsx` | `shared/ui/` |
| `settings/dialog-note.tsx` | `shared/ui/dialog-note.tsx` |
| `leave-guard-dialog.test.tsx`・`tenant-page-header.test.tsx`・`page-body.test.tsx`・`settings/dialog-note.test.tsx` | `shared/ui/` |

`error-screen.tsx` は移さない(タスク 4 で `app/` へ移す)。

- Modify: これらを import しているファイル(features の部品、routes)

**Interfaces:**

- Consumes: タスク 2 の `~/shared/lib/labels`・`sync-context`・`sync-indicator`・`use-leave-guard`。
- Produces: `~/shared/ui/<名前>`。

- [ ] **Step 1: 表のファイルを移し、import を直す**

`shared/ui/` の中どうしは `./x`(`tenant-page-header` → `./connection-banner`)。

- [ ] **Step 2: 検証する**

```bash
pnpm lint
pnpm --filter @plyrs/admin typecheck
find apps/admin/src/components -type f
grep -rnE '"(~/|(\.\./)+|\./)components/' apps/admin/src | grep -vE 'components/error-screen"|features/[a-z-]+/'
pnpm --filter @plyrs/admin exec vitest run src/shared/ui src/features
pnpm format:check
```

Expected: `find` に残るのは `components/error-screen.tsx` だけ。grep は出力なし。vitest は `shared/ui` の 4 本と features の 40 本が PASS。

- [ ] **Step 3: コミットする**

`refactor(admin): 共通の部品を shared/ui へ移す`

---

### Task 4: app 層のファイルを `app/` へ移し、`lib/` と `components/` を削除する

**Files:**

| 移動元(`apps/admin/src/`) | 移動先 |
| --- | --- |
| `lib/api-paths.ts`・`lib/server-routing.ts` と各 `*.test.ts` | `app/` |
| `components/error-screen.tsx` | `app/` |

- Modify: `apps/admin/src/server.ts`(`./lib/server-routing` → `./app/server-routing`)
- Modify: `apps/admin/src/router.tsx`(`./components/error-screen` → `./app/error-screen`)
- Delete: 空になった `apps/admin/src/lib/` と `apps/admin/src/components/`

**Interfaces:**

- Consumes: `error-screen.tsx` が `~/shared/api/api-client`・`super-api`・`error-messages` と `~/shared/lib/labels` を使う。
- Produces: `src/` 直下のエントリから `./app/<名前>`。

- [ ] **Step 1: 表のファイルを移し、import を直す**

`app/server-routing.ts` → `./api-paths`。この 2 ファイルと `server.ts` には `~/` を書かない(Global Constraints)。

- [ ] **Step 2: 検証する**

```bash
ls apps/admin/src
grep -n '~/' apps/admin/src/server.ts apps/admin/src/app/server-routing.ts apps/admin/src/app/api-paths.ts
pnpm lint
pnpm --filter @plyrs/admin typecheck          # tsconfig.json と tsconfig.worker.json の両方
pnpm --filter @plyrs/admin exec vitest run src/app src/router.test.tsx
pnpm --filter @plyrs/admin build              # サンドボックス外
git status --short apps/admin/src/routeTree.gen.ts
pnpm format:check
```

Expected: `ls` に `lib` と `components` がない。grep は出力なし。typecheck は 2 つの設定とも通る。vitest は 3 ファイル PASS。ビルドの最後に `[prerender] Crawling: /` と `GET / 200 OK` が出る。`routeTree.gen.ts` に差分がない。

- [ ] **Step 3: コミットする**

`refactor(admin): app 層のファイルを app/ へ移す`

---

### Task 5: `src/` 直下のテストを対象の隣へ移す

**Files:**

| 移動元(`apps/admin/src/`) | 移動先 |
| --- | --- |
| `super-ops.test.tsx`・`super-tenants.test.tsx` | `routes/super/-tests/` |
| `super-login.test.tsx` | `routes/-tests/` |
| `stylex-tokens.test.ts` | `test-utils/stylex-tokens/` |

`router.test.tsx` は移さない。

- [ ] **Step 1: 表のファイルを移し、import を直す**

3 本の `super-*` は `./router` を `~/router` にする(routes のテストは `~/router` を import してよい)。`stylex-tokens.test.ts` は fixture のパスを `process.cwd()` から組み立てているので、中身は変えない。

- [ ] **Step 2: 検証する**

```bash
ls apps/admin/src/*.test.ts apps/admin/src/*.test.tsx
pnpm lint
pnpm --filter @plyrs/admin typecheck
pnpm --filter @plyrs/admin exec vitest run src/routes/super src/routes/-tests src/test-utils
pnpm format:check
```

Expected: `ls` に残るのは `router.test.tsx` だけ。vitest は 5 ファイル(`super-*` の 3 本、`auth-flow`、`stylex-tokens`)が PASS。

- [ ] **Step 3: コミットする**

`test(admin): src 直下のテストを対象の隣へ移す`

---

### Task 6: `labels.ts` に残る、1 機能だけの文言を使う側へ移す

**Files:**

- Modify: `apps/admin/src/shared/lib/labels.ts`
- Modify: `apps/admin/src/features/records/lib/record-labels.ts`、`apps/admin/src/features/records/index.ts`
- Modify: `apps/admin/src/features/content-types/lib/content-type-labels.ts`
- Modify: `apps/admin/src/routes/t/$tenantSlug/settings/-lib/settings-labels.ts`
- Modify: `apps/admin/src/routes/tenants.tsx`、`apps/admin/src/app/error-screen.tsx`
- Modify(参照の書き換え): 下の表の「使う側」

| `labels.ts` の文言 | 移動先 | 新しい名前 | 使う側 |
| --- | --- | --- | --- |
| `DIALOGS.unpublish`・`DIALOGS.archivePublished`・`DIALOGS.conflict` | `record-labels.ts` | `RECORD_DIALOGS.unpublish`・`.archivePublished`・`.conflict` | `record-editor.tsx`、`conflict-dialog.tsx`、`content/$typeKey/index.tsx`、`-tests/richtext-flow.test.tsx` |
| `DIALOGS.leaveType.body` | `content-type-labels.ts` の `CONTENT_TYPE_LABELS` | `CONTENT_TYPE_LABELS.leaveBody` | `type-editor.tsx`、`type-editor.test.tsx`、`-tests/content-types-leave.test.tsx` |
| `ROLE_DESCRIPTIONS` | `settings-labels.ts` | 同じ | `settings/-components/` の `add-member-dialog`・`role-cards` とそのテスト |
| `SITE_SELECT` | `routes/tenants.tsx` の中の、export しない定数 | 同じ | `routes/tenants.tsx` |
| `ERROR_SCREEN` | `app/error-screen.tsx` の中の、export しない定数 | 同じ | `app/error-screen.tsx` |
| `SYNC_STATUS_LABELS` | 削除する(どこからも使われていない) | — | — |

**Interfaces:**

- Produces: `~/features/records` が `RECORD_DIALOGS` を export する。`DIALOGS` に残るのは `delete`・`leave`・`cancel`。

- [ ] **Step 1: 文言を、表のとおりに移す**

値とコメントはそのまま写す。`DIALOGS.leaveType` の上のコメント(「型設計の離脱ガード(E26)。title / stay / discard は leave と共通」)は `leaveBody` の上へ移す。`SYNC_STATUS_LABELS` を消して使わなくなった `SyncStatus` の import も消す。`ROLE_DESCRIPTIONS` が使う `Role` の型は `~/shared/api/api-contracts` から import する。

- [ ] **Step 2: `features/records/index.ts` の文言の export に `RECORD_DIALOGS` を足す**

```ts
export {
  EDITOR_LABELS,
  HISTORY_LABELS,
  PROPOSAL_LABELS,
  RECORD_DIALOGS,
} from "./lib/record-labels";
```

- [ ] **Step 3: 使う側の参照を直す**

records の中は `../lib/record-labels`、ルートとそのテストは `~/features/records`。`DIALOGS` のほかのキー(`delete`・`leave`・`cancel`)を同じファイルで使っている場合は、`DIALOGS` の import を残す。

- [ ] **Step 4: 検証する**

```bash
pnpm format
pnpm lint
pnpm --filter @plyrs/admin typecheck
grep -rnE "DIALOGS\.(unpublish|archivePublished|conflict|leaveType)|SYNC_STATUS_LABELS" apps/admin/src | grep -v "RECORD_DIALOGS"
grep -nE "ROLE_DESCRIPTIONS|SITE_SELECT|ERROR_SCREEN|SYNC_STATUS_LABELS|leaveType|archivePublished" apps/admin/src/shared/lib/labels.ts
git diff HEAD --stat -- apps/admin/src
pnpm --filter @plyrs/admin exec vitest run src/shared/lib/labels.test.ts src/features/records src/features/content-types src/app
pnpm --filter @plyrs/admin exec vitest run 'src/routes/t/$tenantSlug/content/' 'src/routes/t/$tenantSlug/settings/' src/routes/-tests
```

Expected: 2 つの grep は出力なし。`git diff --stat` で、`labels.ts` から消えた行数が、移動先に足された行数の合計より `SYNC_STATUS_LABELS` の分(8 行前後)だけ多い。lint・typecheck はエラーなし。vitest はすべて PASS。

- [ ] **Step 5: コミットする**

`refactor(admin): 1 機能だけの文言を labels から移す`

---

### Task 7: 文書とコメントのパスを直し、ADR に移行の完了を記録して、全体を検証する

**Files:**

- Modify: `CLAUDE.md`
- Modify: `docs/adr/0001-admin-directory-structure.md`
- Modify: `docs/design-spec.md`、`docs/admin-ux/{current-structure,d-content-list,e-content-type-design,f-media-library,h-common-surface}.md`
- Modify(コメントだけ): `packages/ui/src/{asset-image,record-mention,relative-time,rich-text-editor,semantic.stylex}.ts(x)`、`packages/metamodel/src/{block-ids,body-relations}.ts`、`apps/admin/src/routes/t/$tenantSlug/index.tsx`、`apps/admin/src/routes/t/$tenantSlug/-tests/home-flow.test.tsx`

- [ ] **Step 1: 旧パスを新しいパスに直す**

| 旧 | 新 | 場所 |
| --- | --- | --- |
| `src/lib/sync.test.ts` | `src/shared/lib/sync.test.ts` | `CLAUDE.md` の単体実行の例 |
| `src/lib/server-routing.ts` | `src/app/server-routing.ts` | `CLAUDE.md` の `apps/admin` の説明 |
| `apps/admin/src/lib/mention-contract.test.ts` | `apps/admin/src/shared/lib/mention-contract.test.ts` | `design-spec.md`、`packages/ui` の 3 ファイル、`packages/metamodel` の 2 ファイル |
| `lib/record-label.ts`・`lib/permissions.ts`・`lib/use-can.ts`・`lib/clipboard.ts`・`lib/labels.ts`・`lib/datetime.ts`・`lib/theme.ts` | `shared/lib/<名前>` | `docs/admin-ux/` の 4 ファイル、`packages/ui/src/relative-time.tsx`・`semantic.stylex.ts` |
| `lib/legacy-redirect.ts` | `routes/t/$tenantSlug/-shell/legacy-redirect.ts` | `docs/admin-ux/f-media-library.md`(手順 3 の残り) |
| `components/home` | `-home/` | `routes/t/$tenantSlug/index.tsx` と `-tests/home-flow.test.tsx` のコメント(手順 3 の残り) |

`CLAUDE.md` の `apps/admin` の項目の末尾に、次の 1 文を足す。

```markdown
`src/` の中は `routes/`(ルートと、その隣の `-` 付きディレクトリ)・`features/`・`shared/`・`app/` に分かれる。置き場所と依存の向きは `docs/adr/0001-admin-directory-structure.md` に従い、oxlint が強制する
```

- [ ] **Step 2: ADR に追記する**

「置き場所の規則」の 3 の下に、次を足す。

```markdown
   - `shared/` の中は、次の区画に分ける(手順 5 で決めた)。区画をまたぐ import は `~/shared/<区画>/x` と書く。
     - `api/`: API クライアント、API の契約の型、トークンとセッション、クエリの定義、API のエラーの文言。
     - `ui/`: 2 つ以上の機能かルートで使う部品と、そのスタイル。
     - `lib/`: それ以外の純関数・フック・文言(`labels.ts`)・同期の Context。
     - `styles/`: 全体の CSS。
   - `labels.ts` には、2 つ以上の機能かルートで使う文言だけを置く。
```

「置き場所の規則」の 4 の下に、次を足す。

```markdown
   - `app/` のうち、`server.ts` から読み込むファイル(`server-routing.ts`・`api-paths.ts`)は、`~/` を使わず相対 import だけで書く。`server.ts` は `tsconfig.worker.json` で型チェックしており、そこには `paths` がない。
   - `src/` 直下に置くテストは、エントリのテスト(`router.test.tsx`)だけにする。
```

「移行の手順」の表の下に、次を足す。

```markdown
手順 1〜5 は完了した(手順 1 は #112、手順 2 は #113、手順 3 は #114、手順 4 は #115)。`components/` と `lib/` は無くなった。
```

あわせて、手順 4 のレビューで見つかった既存のずれを直す。

- 置き場所の規則 2 の「2 つ以上の feature から使うものは…`shared/` に置く(…手順 5 で移すまでは `lib/` にある)」から、「。手順 5 で移すまでは `lib/` にある」を削る。
- 「`oxlint.config.ts` の骨子」のコードの前に、「方式を示すための骨子で、定数の名前と値は実装と異なる(`MAX_DEPTH` は 6)。正は `oxlint.config.ts`。」と書く。
- 「検証中に分かった oxlint の挙動」の「同じルールのほかのパターンにも効く」を、「同じルールのほかのパターンにも作用する」に直す。

- [ ] **Step 3: 旧パスが残っていないことを確かめる**

```bash
grep -rnE "(src/)?(lib|components)/[a-z-]+(\.test)?\.tsx?" CLAUDE.md docs/design-spec.md docs/admin-ux docs/adr packages apps/api/src apps/e2e apps/admin/src --include='*.md' --include='*.ts' --include='*.tsx' | grep -vE "node_modules|features/[a-z-]+/(lib|components)/|shared/(lib|api|ui)/|-lib/|packages/[a-z-]+/src/lib/"
```

Expected: 残るのは、ADR の「背景と課題」「移行の手順」など、移行前の状態を説明している箇所と、`docs/admin-ux` のうち当時の構成を記録している箇所(「現 `components/asset-picker.tsx`」のような記述)だけ。新しいパスに直すべきものが残っていないことを、1 行ずつ見て確かめる。

- [ ] **Step 4: リポジトリ全体を検証する**

```bash
pnpm lint
pnpm format:check
pnpm typecheck
pnpm --filter @plyrs/lint-rules test
pnpm --filter @plyrs/admin exec vitest run src/shared src/app
pnpm --filter @plyrs/admin exec vitest run src/features
pnpm --filter @plyrs/admin exec vitest run src/routes
pnpm --filter @plyrs/admin exec vitest run src/router.test.tsx src/test-utils
pnpm -r --filter '!@plyrs/e2e' --filter '!@plyrs/admin' test
find apps/admin/src -name '*.test.ts' -o -name '*.test.tsx' | wc -l
grep -rE "^\s*(it|test)(\.each\([^)]*\))?\(" --include='*.test.ts' --include='*.test.tsx' apps/admin/src | wc -l
```

Expected: すべてエラーなし・PASS。テストのファイルは 157、`it`/`test` は 805。

- [ ] **Step 5: 本番ビルドのチャンクを、着手前と比べる(サンドボックス外)**

```bash
pnpm --filter @plyrs/admin build
find apps/admin/dist/client -name '*.js' -printf '%s %f\n' | sed -E 's/-[A-Za-z0-9_-]{8}\.js$//' | sort -k2 > .superpowers/chunks-after.txt
diff .superpowers/chunks-before.txt .superpowers/chunks-after.txt
```

Expected: 差分は、サイズの数十バイト以内のずれと、タスク 6 による `labels`・`record-labels` などの増減だけ。チャンクが増減した、または 1 KB を超えて変わったチャンクがある場合は、直そうとせずに止めて、差分を付けて報告する。

- [ ] **Step 6: E2E を実行する(サンドボックス外)**

```bash
pnpm --filter @plyrs/e2e test
```

Expected: 9 件とも PASS。

- [ ] **Step 7: コミットする**

`docs: ADR 0001 の移行の完了を記録する`

---

## マージ後の確認

- preview で、ログイン、ホーム、一覧、編集、メディア、型の編集、設定、`/super` が表示できることを確かめる。`server.ts` が読み込むファイルを動かしているので、API パスの転送(`/auth`・`/v1`)と SPA のシェル配信(`/_shell`)が動いていることも、ログインと画面の再読み込みで確かめる。

## この計画に含めないこと

- エントリのサイズ、`index.ts` が再 export だけであること、`vi.mock` の対象の実在を CI で見張る検査(手順 4 のレビューの提案)。別の作業として扱う。
- hiz8/plyrs#110(api の循環 import の解消)。
