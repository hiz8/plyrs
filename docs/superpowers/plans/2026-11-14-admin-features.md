# 管理画面の features の作成(ADR 0001 手順 4)実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `apps/admin/src` の `features/media`・`features/content-types`・`features/records` を作り、各 feature の `index.ts` で公開 API を固め、feature の依存ルールを oxlint で有効にする。

**Architecture:** `components/` と `lib/` にある 3 機能のファイルを `features/<機能>/components/`・`features/<機能>/lib/` へ `git mv` で移し、外から使うものだけを `index.ts` から export する。画面の流れを確かめるテスト(`src/` 直下)は、対象のルートの `-tests/` へ移す。feature を 1 つ移すごとに `oxlint.config.ts` の `FEATURES` に足し、その feature のルールを有効にする。挙動は変えない。

**Tech Stack:** TypeScript 7、Vite 8(`resolve.tsconfigPaths` のエイリアス `~/`)、vitest 4(jsdom)、oxlint 1.86(`no-restricted-imports`)、TanStack Router(`-` 付きディレクトリ)

**Spec:** `docs/adr/0001-admin-directory-structure.md`(「置き場所の規則」「import の書き方の規則」「移行の手順」の手順 4)

## Global Constraints

- 挙動を変えない。行うのは、ファイルの移動、import の書き換え、定数(文言・`runBulk`)の置き場所の変更だけ。関数の中身、文言の値、テストの期待値は変えない。
- ファイルは `git mv` で移す(履歴を追えるようにする)。移動と同じコミットで中身を書き換えるのは import の行だけにする。
- ルートのファイル(`routes/**` のうち `-` 付きディレクトリの外にあるもの)は動かさない。`routeTree.gen.ts` は変わらない。
- フレームワークのエントリ(`router.tsx`・`start.ts`・`server.ts`)は動かさない。
- feature の中の構成は `components/`(部品)・`lib/`(純関数・フック・文言)・`index.ts`(公開 API)の 3 つ。単体テストは対象のファイルの隣に置く。
- `index.ts` から export するのは、この計画の各タスクに書いたものだけ。足す必要が出たら、足した理由を報告に書く。
- import の書き方:
  - 同じ feature の中: 相対 import(`./x`、`../lib/x`)。feature の中から自分の `index.ts`(`~/features/<自分>`)を import しない(循環 import になる)。
  - 他の feature、ルート、テストから feature へ: `~/features/<機能>`(`index.ts` 経由)だけ。
  - feature から、まだ移していない `lib/`・`components/` へ: `~/lib/x`、`~/components/x`。
  - テストから `test-utils/` へ: `~/test-utils/x`。
  - `test-utils/` から feature へ: `~/features/<機能>/lib/x` のように深いパスで書く(`test-utils/` は層のルールの対象外。`index.ts` 経由にすると、単体テストが feature 全体を読み込んで遅くなる)。
- `lib/` と `components/` に残すファイル(手順 5 で `shared/` へ移すもの)から、`features/` を import しない。lint はこれを検出しないので、タスク 4 とタスク 6 の grep で確かめる。
- feature 間の依存は、records → media の 1 本だけ。media と content-types は、他の feature を import しない(テストも同じ)。
- `@ts-expect-error` による抑止は禁止。lint の抑止コメント(`oxlint-disable`)も足さない。
- 文書・コメント・コミットメッセージは日本語で、`docs/glossary.md` の語を使う。
- コマンドは `pnpm` と書く。サンドボックスでは `corepack pnpm` に読み替える。admin の `build` と e2e はサンドボックス外で実行する。admin の vitest は、全体を 1 回で回さず、タスクに書いたパスを指定して回す。
- git は 1 回の呼び出しで 1 コマンドにする(`&&` でつながない)。コミットは 1 タスク 1 つ。コミットメッセージは `refactor(admin): …` で始め、本文の 1 行目に「ADR 0001 の移行手順 4。」と書く。

## この計画で決めたこと

ADR が決めていない点を、次のように決めた。タスク 6 で ADR に追記する。

1. **3 機能の部品は、使うルートが 1 つのサブツリーだけでも feature に置く。** 置き場所の規則 1(1 つのサブツリーだけで使うものはルートの隣)をそのまま当てると、型定義の部品はすべて `settings/content-types/` の隣になり、`features/content-types` は空になる。ADR は手順 4 で 3 つの feature を作ると決めており、records → media の許可も record-form が feature にある前提なので、`FEATURES` に載せた機能は規則 2 を優先する。
2. **画面の流れを確かめるテストは、feature ではなくルートの `-tests/` に置く。** ルーターを組み立ててよいのは routes のテストだけだからである。部品の差し替えは `vi.mock("~/features/<機能>/components/x", …)` と書く(`vi.mock` の文字列は lint の対象外で、エイリアスで書いても同じモジュールに当たることを確認済み)。
3. **次のものは feature に入れず、`lib/`・`components/` に残す(手順 5 で `shared/` へ移す)。** 2 つ以上の feature かルートから使うためである。
   - `lib/record-label.ts`(media の「使用箇所」と、ホーム・提案のルートも使う)
   - `lib/use-bulk-action.ts` と `components/bulk-bar-styles.ts`(records と media の一括操作が使う)
   - `lib/field-kind.ts`・`lib/search.ts`(手順 1 で切り出した共通の関数)
   - `components/leave-guard-dialog.tsx`・`lib/use-leave-guard.ts`・`components/tenant-page-header.tsx`・`components/settings/dialog-note.tsx`
   - `labels.ts` の `TERMS`・`WORKFLOW_STATUS_LABELS`・`TOASTS`・`DIALOGS`・`BULK_LABELS`・`COMMON_LABELS`(`DIALOGS` を機能ごとに分けることはしない)
4. **`runBulk` は `lib/content-list.ts` から `lib/bulk.ts` へ切り出す。** `use-bulk-action.ts`(残す側)が `content-list.ts`(records へ移す側)を import しており、そのままでは共通側から feature への逆向きの依存になる。
5. **`lib/asset-services.ts` は media に、`lib/history.ts` は records に置く。** `history.ts` は履歴と提案のルートから使われ、`HISTORY_LABELS` に依存する。
6. **`labels.ts` にある records だけの文言は、`features/records/lib/record-labels.ts` の 1 ファイルにまとめる。** 対象は `PUBLICATION_STATE_LABELS`(と `PublicationStateKey`)・`PUBLISH_BOX`・`EDITOR_LABELS`・`RECORD_FORM_LABELS`・`HISTORY_LABELS`・`PROPOSAL_LABELS`。
7. **media のテストにある、records の部品(`AssetRelationPicker`)を描画する 1 本は、records 側のテストへ移す。** media → records の依存をなくすためである。

## 移行後の構成

```
apps/admin/src/
  features/
    media/
      index.ts
      components/   delete-media-dialog, media-bulk-bar, media-detail-panel, media-filter-select, media-grid,
                    media-library-data.ts, media-library, media-picker-dialog, media-table, media-thumb,
                    media-toolbar, upload-progress-bar(と各テスト)
      lib/          asset-services, media, media-kind, media-labels, media-list, use-file-drop-guard, use-uploads
    content-types/
      index.ts
      components/   add-field-dialog, delete-field-dialog, delete-type-dialog, field-list, field-panel,
                    list-columns-picker, list-columns-select, plugin-type-groups, type-editor, type-table
      lib/          content-type-form, content-type-labels, content-types
    records/
      index.ts
      components/   asset-picker, bulk-bar, conflict-dialog, content-list-body, content-table, list-filters,
                    list-pagination, publication-badge, publish-box, record-editor, record-form
      lib/          content-list, content-list-labels, history, list-cells, list-tab, publish-box,
                    record-form-values, record-labels(新規), save-and-publish
  routes/t/$tenantSlug/
    -tests/                               + media-redirect.test.tsx
    media/-tests/                         media-{bulk-delete,delete,detail,list,upload}.test.tsx
    settings/content-types/-tests/        content-types-{delete,edit,field-delete,leave,list,new,reorder}.test.tsx
    content/$typeKey/-tests/              content-list-*.test.tsx(4), record-*.test.tsx(4), records-flow,
                                          richtext-flow, publish-box-flow, media-picker-{body,field}
  lib/         残り(手順 5 で shared/ と app/ へ)。bulk.ts を足す
  components/  残り(手順 5 で shared/ と app/ へ)
```

## 移動の共通手順

タスク 2〜4 は、次の手順で進める。

1. 移動先のディレクトリを作り、表のファイルを `git mv` で移す(テストも同じ対応で移す)。
2. 移したファイルの import を、Global Constraints の書き方に直す。`vi.mock(…)` と動的な `import(…)` の文字列も直す。
3. `index.ts` を、タスクに書いた内容で作る。
4. 移したファイルを外から import している箇所を、`~/features/<機能>` に直す。同じファイルから複数のシンボルを使っている場合は、1 つの import 文にまとめる。
5. `oxlint.config.ts` の `FEATURES` を、タスクに書いた値にする。
6. `pnpm format` を実行する。
7. タスクの検証コマンドを実行する。

書き換え漏れは、次の 3 つで見つける(各タスクの検証に含めている)。

- `pnpm --filter @plyrs/admin typecheck`: import 先が無いものはここで落ちる。
- `pnpm lint`: 深い import と、feature の外へ出る相対 import はここで落ちる。
- mock の対象が実在することの確認: `vi.mock` の文字列は型チェックも lint も通ってしまい、パスが古いままでもテストが通ることがある(差し替えが外れて実物が描画されるだけ)。次のコマンドで、`vi.mock` の対象がすべて実在のファイルを指すことを確かめる。出力が空なら合格。

```bash
cd apps/admin && grep -rnoE 'vi\.mock\(\s*"(\.{1,2}|~)/[^"]+"' src --include='*.test.ts' --include='*.test.tsx' \
  | while IFS=: read -r file _ match; do
      spec=$(printf '%s' "$match" | sed -E 's/.*"([^"]+)"/\1/')
      case "$spec" in "~/"*) base="src/${spec#\~/}" ;; *) base="$(dirname "$file")/$spec" ;; esac
      ls "$base".ts "$base".tsx "$base"/index.ts 2>/dev/null | grep -q . || echo "対象なし: $file → $spec"
    done
```

## Review Focus

テストが通っていても壊れうる点。それぞれの確認は、括弧のタスクに入れてある。

1. **本番ビルドのチャンク分割**: ホームのルートが `~/features/records` の `index.ts` から `PublicationBadge` だけを使うとき、`index.ts` が再 export する `RecordEditor`(Tiptap を含む)まで初期表示のチャンクに入ると、初回の読み込みが重くなる。dev とテストでは分からない(タスク 1 で基準を取り、タスク 6 で比べる)。
2. **`vi.mock` の対象のパスの書き換え漏れ**: 差し替えが外れても、テストは通ることがある(「移動の共通手順」の確認コマンド。タスク 2〜4)。
3. **循環 import**: feature の中から自分の `index.ts` を import する、または media が records を import すると、モジュールの初期化の順序によって定数や StyleX のスタイルが `undefined` になる。lint は、自分の `index.ts` の import を止めない(タスク 2〜4 の grep)。
4. **残したファイルから feature への逆向きの依存**: `lib/`・`components/` に残したファイルが `features/` を import していても、いまの lint は検出しない。手順 5 で `shared/` へ移すときに初めて違反になる(タスク 4 とタスク 6 の grep)。
5. **テストの取りこぼし**: 移動の途中でテストを消したり、まとめたりしていないこと。着手前はテストのファイルが 155、`it`/`test` の数が 805。完了時はファイルが 157(`bulk.test.ts` と `asset-picker.test.tsx` が増える)、`it`/`test` の数は 805 のまま(タスク 6)。

---

### Task 1: 一括操作の実行(`runBulk`)を `lib/bulk.ts` へ切り出す

**Files:**

- Create: `apps/admin/src/lib/bulk.ts`
- Create: `apps/admin/src/lib/bulk.test.ts`
- Modify: `apps/admin/src/lib/content-list.ts`(`BulkResult`・`RunBulkOptions`・`runBulk` を削る)
- Modify: `apps/admin/src/lib/content-list.test.ts`(`describe("runBulk")` と `describe("runBulk の中止")` を削る)
- Modify: `apps/admin/src/lib/use-bulk-action.ts`(import 元を `./bulk` に)
- Modify: `apps/admin/src/routes/t/$tenantSlug/content/$typeKey/index.tsx`(`type BulkResult` の import 元を `~/lib/bulk` に)

**Interfaces:**

- Produces: `~/lib/bulk` が `BulkResult`・`RunBulkOptions`・`runBulk(ids, action, options?)` を export する(シグネチャは今の `content-list.ts` と同じ)。`content-list.ts` はこの 3 つを export しなくなる。

- [ ] **Step 1: 着手前の基準を記録する**

```bash
find apps/admin/src -name '*.test.ts' -o -name '*.test.tsx' | wc -l          # 155
grep -rE "^\s*(it|test)(\.each\([^)]*\))?\(" --include='*.test.ts' --include='*.test.tsx' apps/admin/src | wc -l   # 805
pnpm --filter @plyrs/admin build                                              # サンドボックス外
find apps/admin/dist/client -name '*.js' -printf '%s %f\n' | sort -n > "$TMPDIR/chunks-before.txt"
grep -il prosemirror apps/admin/dist/client/assets/*.js | xargs -n1 basename > "$TMPDIR/tiptap-chunks-before.txt"
```

Expected: 155 と 805。ビルドが通る。`chunks-before.txt` と `tiptap-chunks-before.txt` を、タスク 6 まで残す(ファイル名のハッシュは変わるので、比べるのは合計のサイズと、`prosemirror` を含むチャンクの数とサイズ)。

- [ ] **Step 2: `lib/bulk.ts` を作り、`content-list.ts` の「案 D 6 章: 一括操作は…」のコメントから `runBulk` の終わりまでを、コメントごと移す**

`content-list.ts` に残った import のうち、使わなくなったものがあれば削る。

- [ ] **Step 3: `lib/bulk.test.ts` を作り、`content-list.test.ts` の `describe("runBulk", …)` と `describe("runBulk の中止", …)` を移す**

`content-list.test.ts` の import から `runBulk` を削る。2 つの `describe` が使っている補助の関数や定数があれば、一緒に移す。

- [ ] **Step 4: `use-bulk-action.ts` と `content/$typeKey/index.tsx` の import を直す**

- [ ] **Step 5: 検証する**

```bash
grep -rn "runBulk\|BulkResult\|RunBulkOptions" apps/admin/src/lib/content-list.ts apps/admin/src/lib/content-list.test.ts
pnpm --filter @plyrs/admin exec vitest run src/lib/bulk.test.ts src/lib/content-list.test.ts src/lib/use-bulk-action.test.tsx
pnpm --filter @plyrs/admin typecheck
pnpm lint
pnpm format:check
```

Expected: grep は出力なし。vitest は 3 ファイルとも PASS。typecheck・lint・format:check はエラーなし。

- [ ] **Step 6: コミットする**

`refactor(admin): 一括操作の実行(runBulk)を content-list から lib/bulk.ts へ切り出す`

---

### Task 2: `features/media` を作る

**Files:**

| 移動元(`apps/admin/src/`) | 移動先 |
| --- | --- |
| `components/media/*`(12 ファイルとテスト 9 本) | `features/media/components/` |
| `lib/{asset-services,media,media-kind,media-labels,media-list,use-file-drop-guard,use-uploads}.ts` と各 `*.test.ts(x)`(6 本) | `features/media/lib/` |
| `media-{bulk-delete,delete,detail,list,upload}.test.tsx` | `routes/t/$tenantSlug/media/-tests/` |
| `media-redirect.test.tsx`(content・media・旧 URL の 3 つのサブツリーを開く) | `routes/t/$tenantSlug/-tests/` |

- Create: `apps/admin/src/features/media/index.ts`
- Create: `apps/admin/src/components/asset-picker.test.tsx`(タスク 4 で records へ移る)
- Modify(外からの import): `components/asset-picker.tsx`・`components/record-form.tsx`・`components/record-form.test.tsx`・`components/record-editor.tsx`、`routes/t/$tenantSlug/media/route.tsx`、`routes/t/$tenantSlug/content/$typeKey/$recordId.tsx`・`new.tsx`、`test-utils/media-rows.ts`、`src/media-picker-body.test.tsx`・`src/media-picker-field.test.tsx`(`vi.mock` の対象だけ)
- Modify: `oxlint.config.ts`

**Interfaces:**

- Produces: `~/features/media` の公開 API(下の `index.ts`)。タスク 4 の records がこれを使う。

- [ ] **Step 1: 表のファイルを `git mv` で移し、import を直す(「移動の共通手順」1〜2)**

media の中から残したファイルへの import は、`~/lib/labels`・`~/lib/record-label`・`~/lib/use-bulk-action`・`~/components/bulk-bar-styles`・`~/components/settings/dialog-note`・`~/components/tenant-page-header` などになる。テストの `vi.mock("../../lib/clipboard", …)` は `vi.mock("~/lib/clipboard", …)` にする。

- [ ] **Step 2: `features/media/index.ts` を作る**

```ts
// media の公開 API。feature の外(ルート、records、テスト)からは、ここを通して使う
export { MediaLibrary } from "./components/media-library";
export { MediaPickerDialog, type PickedMedia } from "./components/media-picker-dialog";
export { MediaThumb } from "./components/media-thumb";
export { createAssetServices, type AssetServices } from "./lib/asset-services";
export { MEDIA_LABELS, MEDIA_PICKER_LABELS } from "./lib/media-labels";
export { buildMediaRows, parseMediaQuery, toMediaSearch, type MediaQuery } from "./lib/media-list";
// 画面の流れを確かめるテスト(routes/t/$tenantSlug/media/-tests/)が、アップロードの状態を初期化するために使う
export { DONE_HOLD_MS, resetUploadStores } from "./lib/use-uploads";
```

- [ ] **Step 3: `AssetRelationPicker` を描画するテストを、media から `components/asset-picker.test.tsx` へ移す**

`features/media/components/media-picker-dialog.test.tsx` の `it("既存の選択を外して挿入すると、フィールドの値から消える", …)` を削り、`AssetRelationPicker` と `relationDraftKey` の import も削る。新しい `components/asset-picker.test.tsx` には、この `it` と、それが使う `DANGLING`・`NEW_ID`・`buildRegistry()` を写す(`buildRegistry` は元のテストにも残す)。フィルターの差し替えは次のように書く。

```ts
vi.mock("~/features/media/components/media-filter-select", async () => {
  const mock = await import("~/test-utils/media-filter-select-mock");
  return { MediaFilterSelect: mock.MediaFilterSelectMock };
});
```

テストの名前、操作、期待値は変えない。

- [ ] **Step 4: 外からの import を `~/features/media` に直す(「移動の共通手順」4)**

`test-utils/media-rows.ts` だけは `~/features/media/lib/media-list` にする。`src/` 直下に残る画面のテスト(`media-picker-body`・`media-picker-field`)は、`vi.mock` の対象を `~/features/media/components/media-filter-select` にする。移した 6 本の画面のテストは、`./test-utils/x` を `~/test-utils/x` に、`./lib/use-uploads` を `~/features/media` にする。

- [ ] **Step 5: `oxlint.config.ts` の `FEATURES` を変える**

```ts
const FEATURES: FeatureOptions = { features: ["media"], allowCross: {} };
```

- [ ] **Step 6: 検証する**

```bash
pnpm format
pnpm lint
pnpm --filter @plyrs/admin typecheck
grep -rnE '"[^"]*(lib/(asset-services|media|media-kind|media-labels|media-list|use-file-drop-guard|use-uploads)|components/media/[a-z-]+)"' apps/admin/src | grep -v "features/media"
grep -rn '"~/features/media"' apps/admin/src/features/media
grep -rnE '"~/(features/(records|content-types)|components/(asset-picker|record-))' apps/admin/src/features/media
pnpm --filter @plyrs/admin exec vitest run src/features/media
pnpm --filter @plyrs/admin exec vitest run 'src/routes/t/$tenantSlug/media/' 'src/routes/t/$tenantSlug/-tests/media-redirect.test.tsx'
pnpm --filter @plyrs/admin exec vitest run src/components/asset-picker.test.tsx src/components/record-form.test.tsx src/media-picker-body.test.tsx src/media-picker-field.test.tsx
```

「移動の共通手順」の mock の確認コマンドも実行する。

Expected: lint・typecheck はエラーなし。3 つの grep と mock の確認は出力なし(1 つ目は旧パスの残り、2 つ目は自分の `index.ts` の import、3 つ目は media から records への依存)。vitest はすべて PASS。

- [ ] **Step 7: コミットする**

`refactor(admin): メディアの部品と関数を features/media へ移し、公開 API を index.ts にまとめる`

---

### Task 3: `features/content-types` を作る

**Files:**

| 移動元(`apps/admin/src/`) | 移動先 |
| --- | --- |
| `components/content-types/*`(10 ファイルとテスト 9 本) | `features/content-types/components/` |
| `lib/{content-type-form,content-type-labels,content-types}.ts`、`lib/content-type-form.test.ts`、`lib/content-types.test.ts` | `features/content-types/lib/` |
| `content-types-{delete,edit,field-delete,leave,list,new,reorder}.test.tsx` | `routes/t/$tenantSlug/settings/content-types/-tests/` |

- Create: `apps/admin/src/features/content-types/index.ts`
- Modify(外からの import): `routes/t/$tenantSlug/settings/content-types/{index,new,$typeKey.edit}.tsx`、`test-utils/type-rows.ts`
- Modify: `oxlint.config.ts`

**Interfaces:**

- Produces: `~/features/content-types` の公開 API(下の `index.ts`)。使うのは `settings/content-types/` のルートとそのテストだけ。

- [ ] **Step 1: 表のファイルを `git mv` で移し、import を直す**

残したファイルへの import は、`~/lib/admin-api`・`~/lib/breadcrumbs`・`~/lib/field-kind`・`~/lib/labels`・`~/lib/navigation`・`~/lib/use-leave-guard`・`~/components/leave-guard-dialog`・`~/components/tenant-page-header`・`~/components/settings/dialog-note` になる。`type-editor.test.tsx` の `vi.mock("../../lib/use-leave-guard", …)` は `vi.mock("~/lib/use-leave-guard", …)` にする。

- [ ] **Step 2: `features/content-types/index.ts` を作る**

```ts
// コンテンツタイプの公開 API。feature の外(ルート、テスト)からは、ここを通して使う
export { DeleteTypeDialog } from "./components/delete-type-dialog";
export { PluginTypeGroups } from "./components/plugin-type-groups";
export { TypeEditor } from "./components/type-editor";
export { TypeTable } from "./components/type-table";
export {
  buildDefinition,
  emptyTypeDraft,
  toTypeDraft,
  type TypeDraft,
} from "./lib/content-type-form";
export { CONTENT_TYPE_LABELS } from "./lib/content-type-labels";
export {
  menuOrderUpdates,
  pluginTypeGroups,
  userTypeRows,
  type TypeRow,
} from "./lib/content-types";
```

- [ ] **Step 3: 外からの import を `~/features/content-types` に直す**

`test-utils/type-rows.ts` だけは `~/features/content-types/lib/content-types` にする。移した 7 本の画面のテストは、`./test-utils/x` を `~/test-utils/x` に、`./lib/x` を `~/lib/x` に、`./lib/content-type-labels` を `~/features/content-types` に、`vi.mock` の対象を `~/features/content-types/components/list-columns-select` にする。

- [ ] **Step 4: `oxlint.config.ts` の `FEATURES` を変える**

```ts
const FEATURES: FeatureOptions = { features: ["media", "content-types"], allowCross: {} };
```

- [ ] **Step 5: 検証する**

```bash
pnpm format
pnpm lint
pnpm --filter @plyrs/admin typecheck
grep -rnE '"[^"]*(lib/(content-type-form|content-type-labels|content-types)|components/content-types/[a-z-]+)"' apps/admin/src | grep -v "features/content-types"
grep -rn '"~/features/' apps/admin/src/features/content-types
pnpm --filter @plyrs/admin exec vitest run src/features/content-types
pnpm --filter @plyrs/admin exec vitest run 'src/routes/t/$tenantSlug/settings/content-types/'
```

「移動の共通手順」の mock の確認コマンドも実行する。

Expected: lint・typecheck はエラーなし。2 つの grep と mock の確認は出力なし(content-types は、自分の `index.ts` も他の feature も import しない)。vitest はすべて PASS。

- [ ] **Step 6: コミットする**

`refactor(admin): コンテンツタイプの部品と関数を features/content-types へ移し、公開 API を index.ts にまとめる`

---

### Task 4: `features/records` を作る

**Files:**

| 移動元(`apps/admin/src/`) | 移動先 |
| --- | --- |
| `components/{asset-picker,bulk-bar,conflict-dialog,content-list-body,content-table,list-filters,list-pagination,publication-badge,publish-box,record-editor,record-form}.tsx` と各 `*.test.tsx`(`asset-picker`・`bulk-bar`・`content-table`・`list-pagination`・`publication-badge`・`publish-box`・`record-form` の 7 本) | `features/records/components/` |
| `lib/{content-list,content-list-labels,history,list-cells,list-tab,publish-box,record-form-values,save-and-publish}.ts` と各 `*.test.ts`(`list-tab` 以外の 7 本) | `features/records/lib/` |
| `content-list-{bulk-delete,bulk,flow,row-delete}.test.tsx`、`record-{archive,delete,leave,unpublish}.test.tsx`、`records-flow.test.tsx`、`richtext-flow.test.tsx`、`publish-box-flow.test.tsx`、`media-picker-{body,field}.test.tsx` | `routes/t/$tenantSlug/content/$typeKey/-tests/` |

`components/bulk-bar-styles.ts` は移さない(media も使う)。`lib/mention-contract.test.ts` も移さない(パッケージ間の契約のテストで、records のファイルを import していない)。

- Create: `apps/admin/src/features/records/index.ts`
- Modify(外からの import): `routes/t/$tenantSlug/content/$typeKey/{index,new,$recordId}.tsx`、`routes/t/$tenantSlug/content/$typeKey/$recordId_/history.tsx` と `-components/{history-diff,history-list}.tsx`、`routes/t/$tenantSlug/-home/{home.ts,recent-card.tsx,review-card.tsx}`、`routes/t/$tenantSlug/proposals/$proposalId.tsx`・`-components/{proposal-diff,proposal-list}.tsx`・`-lib/proposals.ts`
- Modify: `oxlint.config.ts`

**Interfaces:**

- Consumes: `~/features/media` の `MediaPickerDialog`・`PickedMedia`・`MediaThumb`・`AssetServices`・`MEDIA_LABELS`・`MEDIA_PICKER_LABELS`・`buildMediaRows`(タスク 2)。`~/lib/bulk` の `BulkResult`(タスク 1)。
- Produces: `~/features/records` の公開 API(下の `index.ts`)。タスク 5 で文言の export を足す。

- [ ] **Step 1: 表のファイルを `git mv` で移し、import を直す**

records の中から media への import は、タスク 2 で `~/features/media` になっているので変えない。残したファイルへの import は `~/lib/x`・`~/components/x` にする(`~/components/bulk-bar-styles`・`~/components/leave-guard-dialog`・`~/components/tenant-page-header`・`~/lib/labels`・`~/lib/record-label`・`~/lib/field-kind`・`~/lib/use-bulk-action` など)。`asset-picker.test.tsx` の import は `./asset-picker` と `../lib/record-form-values` になる。

- [ ] **Step 2: `features/records/index.ts` を作る**

```ts
// record の公開 API。feature の外(ルート、テスト)からは、ここを通して使う
export { BulkBar, type BulkBarProps, type BulkMenuAction } from "./components/bulk-bar";
export { ContentListBody } from "./components/content-list-body";
export { PublicationBadge, WorkflowStatusBadge } from "./components/publication-badge";
export { RecordEditor } from "./components/record-editor";
export {
  applyListQuery,
  buildListRows,
  parseListQuery,
  publicationStateOf,
  toListSearch,
  type ListQuery,
  type ListRow,
} from "./lib/content-list";
export { LIST_LABELS } from "./lib/content-list-labels";
export {
  actorLabel,
  formatFieldDiff,
  kindLabel,
  summarizeEntry,
  viaLabel,
  type HistorySelection,
  type MemberName,
} from "./lib/history";
```

- [ ] **Step 3: 外からの import を `~/features/records` に直す**

移した 13 本の画面のテストは、`./test-utils/x` を `~/test-utils/x` に、`./router` を `~/router` に、`./lib/labels` を `~/lib/labels` に、`import type { BulkBarProps } from "./components/bulk-bar"` を `~/features/records` に直す。`vi.mock` の対象は `~/features/records/components/bulk-bar` と `~/features/media/components/media-filter-select` にする。

- [ ] **Step 4: `oxlint.config.ts` の `FEATURES` を変える**

```ts
const FEATURES: FeatureOptions = {
  features: ["media", "content-types", "records"],
  allowCross: { records: ["media"] },
};
```

- [ ] **Step 5: 検証する**

```bash
pnpm format
pnpm lint
pnpm --filter @plyrs/admin typecheck
grep -rnE '"[^"]*(lib/(content-list|content-list-labels|history|list-cells|list-tab|publish-box|record-form-values|save-and-publish)|components/(asset-picker|bulk-bar|conflict-dialog|content-list-body|content-table|list-filters|list-pagination|publication-badge|publish-box|record-editor|record-form))"' apps/admin/src | grep -v "features/records"
grep -rn '"~/features/records"' apps/admin/src/features/records
grep -rn '"~/features/content-types' apps/admin/src/features/records
grep -rlE '(from|import\(|vi\.mock\()\s*"[^"]*features/' apps/admin/src/lib apps/admin/src/components
ls apps/admin/src/*.test.ts apps/admin/src/*.test.tsx
pnpm --filter @plyrs/admin exec vitest run src/features/records
pnpm --filter @plyrs/admin exec vitest run 'src/routes/t/$tenantSlug/content/'
pnpm --filter @plyrs/admin exec vitest run 'src/routes/t/$tenantSlug/-home/' 'src/routes/t/$tenantSlug/-tests/' 'src/routes/t/$tenantSlug/proposals/'
```

「移動の共通手順」の mock の確認コマンドも実行する。

Expected: lint・typecheck はエラーなし。4 つの grep と mock の確認は出力なし(4 つ目は、残したファイルから feature への逆向きの依存)。`ls` に残るのは `router.test.tsx`・`stylex-tokens.test.ts`・`super-{login,ops,tenants}.test.tsx` の 5 本だけ。vitest はすべて PASS(並列の負荷で 15 秒の timeout が出た場合は、そのファイルだけ単独で回し直す)。

- [ ] **Step 6: コミットする**

`refactor(admin): record の一覧と編集の部品・関数を features/records へ移し、公開 API を index.ts にまとめる`

---

### Task 5: record だけの文言を `labels.ts` から `features/records` へ移す

**Files:**

- Create: `apps/admin/src/features/records/lib/record-labels.ts`
- Modify: `apps/admin/src/lib/labels.ts`
- Modify: `apps/admin/src/features/records/index.ts`
- Modify(import 元の変更): `features/records/components/{publication-badge,publish-box,record-editor,record-form}.tsx`、`features/records/lib/{publish-box,history}.ts`、`routes/t/$tenantSlug/content/$typeKey/{index,new,$recordId}.tsx`、`$recordId_/history.tsx` と `-components/{history-diff,history-list}.tsx`、`routes/t/$tenantSlug/proposals/{index,$proposalId}.tsx`・`-components/{proposal-diff,proposal-list,resolve-dialogs}.tsx`・`-lib/proposals.ts`、`content/$typeKey/-tests/{records-flow,record-delete}.test.tsx`

**Interfaces:**

- Consumes: タスク 4 の `features/records/index.ts`。
- Produces: `features/records/lib/record-labels.ts` が `PublicationStateKey`・`PUBLICATION_STATE_LABELS`・`PUBLISH_BOX`・`EDITOR_LABELS`・`RECORD_FORM_LABELS`・`HISTORY_LABELS`・`PROPOSAL_LABELS` を export する。`~/features/records` は、そのうち `EDITOR_LABELS`・`HISTORY_LABELS`・`PROPOSAL_LABELS` を外へ出す。`~/lib/labels` は、この 7 つを export しなくなる。

- [ ] **Step 1: `record-labels.ts` を作り、7 つの定数と型を `labels.ts` からコメントごと移す**

値と並び順は変えない。`TERMS` は `~/lib/labels` から import する。型(`HistoryKind` など)が要る場合は `~/lib/api-contracts` から import する。ファイルの先頭に次のコメントを置く。

```ts
// record の一覧・編集・履歴・提案の文言。record の feature だけが使うものと、履歴・提案のルートが
// index.ts 経由で使うものを置く。複数の機能で使う文言(TERMS・TOASTS・DIALOGS など)は ~/lib/labels にある
```

- [ ] **Step 2: `labels.ts` の先頭のコメントを直す**

「HISTORY_LABELS・PROPOSAL_LABELS は、…ここに残している。ADR 0001 の移行手順 4 で、records の feature と一緒に移す。」の文を削り、「1 つの機能でしか使わない文言は、その機能の文言のファイル(`features/records/lib/record-labels.ts` など)に置く」に直す。使わなくなった import があれば削る。

- [ ] **Step 3: `features/records/index.ts` に 1 行足す**

```ts
export { EDITOR_LABELS, HISTORY_LABELS, PROPOSAL_LABELS } from "./lib/record-labels";
```

- [ ] **Step 4: import 元を直す**

records の中は相対 import(`../lib/record-labels`、`./record-labels`)、ルートとテストは `~/features/records` にする。同じファイルで `~/lib/labels` のほかの文言(`TERMS`・`TOASTS`・`DIALOGS` など)も使っている場合は、`~/lib/labels` の import を残したまま、移した名前だけを外す。

- [ ] **Step 5: 検証する**

```bash
pnpm format
pnpm lint
pnpm --filter @plyrs/admin typecheck
grep -nE "PublicationStateKey|PUBLICATION_STATE_LABELS|PUBLISH_BOX|EDITOR_LABELS|RECORD_FORM_LABELS|HISTORY_LABELS|PROPOSAL_LABELS" apps/admin/src/lib/labels.ts
git diff HEAD --stat -- apps/admin/src/lib/labels.ts apps/admin/src/features/records/lib/record-labels.ts
pnpm --filter @plyrs/admin exec vitest run src/features/records src/lib/labels.test.ts
pnpm --filter @plyrs/admin exec vitest run 'src/routes/t/$tenantSlug/content/' 'src/routes/t/$tenantSlug/proposals/'
```

Expected: grep は出力なし。`git diff --stat` で、`labels.ts` から消えた行数と `record-labels.ts` に足された行数がほぼ同じ(差は先頭のコメントと import の分だけ)。lint・typecheck はエラーなし。vitest はすべて PASS。

- [ ] **Step 6: コミットする**

`refactor(admin): record だけの文言を labels.ts から features/records へ移す`

---

### Task 6: ADR への追記と、全体の検証

**Files:**

- Modify: `docs/adr/0001-admin-directory-structure.md`
- Modify: `oxlint.config.ts`(コメントだけ)

- [ ] **Step 1: ADR の「置き場所の規則」の 2 に、手順 4 で決めたことを追記する**

「2. **ルートのサブツリーをまたいで使い、特定の機能に属するもの**: …」の項目の下に、次の箇条書きを足す。

```markdown
   - feature の中は、`components/`(部品)・`lib/`(純関数・フック・文言)・`index.ts`(公開 API)に分ける(手順 4 で決めた)。feature の中から自分の `index.ts` は import しない。
   - `oxlint.config.ts` の `FEATURES` に載せた機能(records・media・content-types)の部品は、使うルートが 1 つのサブツリーだけでも feature に置く。機能の関数・文言・部品を 1 か所にまとめ、ルートのファイルは公開 API を組み立てるだけにする。それ以外の画面(ホーム・アカウント・設定・提案・履歴)は 1 に従う。
   - 画面の流れを確かめるテストは、feature ではなくルートの `-tests/` に置く(ルーターを組み立ててよいのは routes のテストだけ)。部品を差し替えるときは、`vi.mock("~/features/<機能>/components/x", …)` と書く。`vi.mock` の文字列は lint の対象外である。
   - 2 つ以上の feature から使うものは feature に入れず、`shared/` に置く(`record-label.ts`、一括操作の `bulk.ts`・`use-bulk-action.ts` など)。feature 間の許可を増やすより先に、こちらを検討する。
   - `test-utils/` から feature を import するときは、`index.ts` を通さず深いパスで書く(単体テストが feature 全体を読み込まないようにする)。
```

「移行の手順」の表の手順 4 の行は変えない。「未確認の事項」の「依存ルールを、実際のコードベースへ導入した場合の lint 時間」は、Step 3 で測った値を書いて「lint の方式の比較」の下へ移す(例: 「手順 4 の完了時点で、リポジトリ全体の lint 時間は約 N 秒」)。

- [ ] **Step 2: `oxlint.config.ts` の `FeatureOptions` の上のコメントを直す**

「手順 4 で feature を追加するときは、下の FEATURES と ALLOW_CROSS を変える」を、「feature を追加するときと、feature 間の依存を許可するときは、下の FEATURES を変える(許可の追加はレビューで判断する)」に直す。

- [ ] **Step 3: リポジトリ全体を検証する**

```bash
pnpm lint                      # エラー 0。実行時間(Finished in …)を記録する
pnpm format:check
pnpm typecheck
pnpm --filter @plyrs/lint-rules test
pnpm --filter @plyrs/admin exec vitest run src/features
pnpm --filter @plyrs/admin exec vitest run src/lib src/components
pnpm --filter @plyrs/admin exec vitest run src/routes
pnpm --filter @plyrs/admin exec vitest run src/router.test.tsx src/stylex-tokens.test.ts src/super-login.test.tsx src/super-ops.test.tsx src/super-tenants.test.tsx
pnpm --filter @plyrs/ui test
find apps/admin/src -name '*.test.ts' -o -name '*.test.tsx' | wc -l
grep -rE "^\s*(it|test)(\.each\([^)]*\))?\(" --include='*.test.ts' --include='*.test.tsx' apps/admin/src | wc -l
grep -rlE '(from|import\(|vi\.mock\()\s*"[^"]*features/' apps/admin/src/lib apps/admin/src/components
```

Expected: すべてエラーなし・PASS。テストのファイルは 157、`it`/`test` は 805。最後の grep は出力なし。

- [ ] **Step 4: 本番ビルドのチャンクを、着手前と比べる(サンドボックス外)**

```bash
pnpm --filter @plyrs/admin build
git status --short apps/admin/src/routeTree.gen.ts
find apps/admin/dist/client -name '*.js' -printf '%s %f\n' | sort -n > "$TMPDIR/chunks-after.txt"
grep -il prosemirror apps/admin/dist/client/assets/*.js | xargs -n1 basename > "$TMPDIR/tiptap-chunks-after.txt"
awk '{s+=$1} END {print s}' "$TMPDIR/chunks-before.txt"
awk '{s+=$1} END {print s}' "$TMPDIR/chunks-after.txt"
wc -l "$TMPDIR/tiptap-chunks-before.txt" "$TMPDIR/tiptap-chunks-after.txt"
tail -5 "$TMPDIR/chunks-before.txt"
tail -5 "$TMPDIR/chunks-after.txt"
```

Expected: ビルドが通り、`routeTree.gen.ts` に差分がない。JS の合計の増加が 2% 以内で、`prosemirror` を含むチャンクの数が増えておらず、最大のチャンクのサイズがほぼ同じ。

どれかが外れた場合は、直そうとせずに止めて、2 つのファイルの差分を付けて報告する(`index.ts` の分け方を変えるかどうかは、ADR に関わる判断になる)。

- [ ] **Step 5: E2E を実行する(サンドボックス外)**

```bash
pnpm --filter @plyrs/e2e test
```

Expected: 3 spec とも PASS。

- [ ] **Step 6: コミットする**

`docs: ADR 0001 に、feature の中の構成と、手順 4 で決めた置き場所の判断を追記する`

---

## 手順 5 への申し送り

- `lib/` と `components/` に残ったものを `shared/` と `app/` へ移す。手順 4 で残すと決めたものは「この計画で決めたこと」の 3 にある。`lib/bulk.ts` もここに含まれる。
- `src/` 直下に残る `super-{login,ops,tenants}.test.tsx` は、`routes/super/-tests/` へ移せる。`router.test.tsx` と `stylex-tokens.test.ts` の置き場所は手順 5 で決める。
- `DIALOGS` は、record だけの項目(`delete`・`unpublish`・`archivePublished`・`conflict`)と、型定義だけの項目(`leaveType`)を含んだまま `labels.ts` に残した。分けるかどうかは手順 5 で判断する。
- `CLAUDE.md`、`docs/admin-ux/h-common-surface.md`、`docs/design-spec.md`、`packages/ui`・`packages/metamodel` のコメントに、`src/lib/…` のパス(`sync.test.ts`・`server-routing.ts`・`permissions.ts`・`use-can.ts`・`datetime.ts`・`mention-contract.test.ts`)が書かれている。手順 4 では動かないが、手順 5 で動かすときに一緒に直す。
- main へのマージ後、preview で主要な画面(ホーム、一覧、編集、メディア、型の編集)が表示できることを確かめる(ADR の「確認方法」)。
