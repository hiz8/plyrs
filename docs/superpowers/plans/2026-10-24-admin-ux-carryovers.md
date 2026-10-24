# 管理画面 UX 再構築 持ち越しの消化(design-sync を除く) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** V2〜V4-F の最終報告で「後続」に送った項目のうち design-sync の再同期を除く全部を、小さいものから順に 1 本のブランチで片付ける: V4-G・V4-E・V4-F の小さな修正と deferred minor、ui の a11y 追補(`Checkbox.description` / `SegmentedControl.isReadOnly`)、型設計の離脱ガード(E26)、読む側の `listColumns` と型の `description`(E21)、アップロードのファイルごとの進捗(F9、XHR 化)。シェルの「empty href」警告は再現せず見送り(K8)。

**Architecture:** 既存の方針(判断は純関数へ、部品は描くだけ、文言は `labels.ts`、見た目はセマンティックトークンと `@plyrs/ui`)を保ち、新しい概念は 3 つだけ足す。(1) 一覧の追加列は `lib/list-cells.ts` の純関数 `cellText(field, value)` がフィールドの種類ごとに文字列へ整え、`ContentTable` は `contentType.listColumns` から列を組む。(2) 型設計の離脱ガードは `record-editor.tsx` と同じ `useLeaveGuard` + `ModalDialog(alertdialog)` を `TypeEditor` に移植する(文言だけ型向け)。(3) アップロードの進捗は `admin-api.ts` の `uploadAsset` を XHR(`createXhr` を注入できる)にし、`UploadItem` の `uploading` に `progress` を足して `UploadTile` が `ProgressBar` と % を描く。全体の進捗(件数)は変えない。

**Tech Stack:** StyleX 0.19.1、react-aria-components 1.21.1(ui の中だけ)、TanStack Router 1.170.18(`useBlocker`)、TanStack Query 5、`XMLHttpRequest`(アップロードの進捗)、Vitest + jsdom + Testing Library、Playwright(既存 4 spec は変えない)

**Spec:**
- `docs/admin-ux/e-content-type-design.md` 2.2(型の項目: `description` / `listColumns`)、6 章(読む側の表)、実装状況の注記(2026-10-20 の E21)
- `docs/admin-ux/d-content-list.md` 5 章(列と並べ替え)、10 章(未決: 型ごとの列)
- `docs/admin-ux/c-publish-box.md` 7 章「フィードバックと離脱防止」(離脱の確認。`useLeaveGuard` の出所)
- `docs/admin-ux/f-media-library.md` 3.3(アップロード中の表示。D3 M6 の「64%」とバイト数)、10 章の F9
- `docs/admin-ux/h-common-surface.md` 11 章(アクセシビリティ)
- 前計画の最終報告の「後続」: `docs/superpowers/plans/2026-10-20-admin-ux-v4e-content-types.md`(E21・E26、a11y 追補)、`2026-10-20-admin-ux-v4g-settings.md`(password-form、StrictMode)、`2026-10-21-admin-ux-v4f-media.md`(F9、deferred minor は 2026-10-24 の最終報告に一覧)
- キャンバス https://claude.ai/artifact/K57TVUfpefMuiPxhZXyAnU の D3 M6(アップロード中のタイル: 進捗バー + 「64% ・ 1.2 / 1.9 MB」)。設計書と食い違うときは設計書を優先する

## Global Constraints

- 画面と部品が参照するのはセマンティックトークン(`@plyrs/ui/semantic.stylex`)だけ。`grep -rln "tokens.stylex" apps/admin/src/components apps/admin/src/routes/t` は 0 件のまま
- 文言は `lib/labels.ts`(画面・部品に日本語を直書きしない。例外: テストの断言)。「です・ます」、ボタンは操作名、確認ダイアログのボタンは「OK」にしない
- 幅 960px 未満の切り替えは `const NARROW = "@media (max-width: 959px)"` の CSS だけ
- RAC を admin から直接使うのは `Link` と `components/shell/` だけ。ui の部品の変更は `.design-sync/NOTES.md` の「V4 で変えた部品」の下に「持ち越し(2026-10-24)で変えた部品」の節を足して記録する(再同期は後回しのまま)
- `@ts-expect-error` は使わない。`any` を避ける。strict + noUncheckedIndexedAccess。コメント・ドキュメント・コミットメッセージは日本語、帰属行なし、タイトル 50 文字以内。git は 1 回の呼び出しに 1 コマンド、素の `git stash` は使わない
- サンドボックスの道具: `pnpm` は `corepack pnpm`。ルートの `pnpm typecheck` / `pnpm test` は使わず `corepack pnpm -r typecheck`、パッケージごとの vitest(admin は `src/lib src/components` / トップレベル前半 / 後半 の 3 組)。`corepack pnpm format:check` は **exit 0 を確かめる**(`format` の出力だけで判断しない)。`docs/` と `.design-sync/` は oxfmt の対象外
- テストの割り振り(V4 の注意): モーダルを開く router テストは 1 ファイル 1 本、開く操作は `fireEvent.click`、Select を使う router テストは `vi.mock` で素の `<select>`、トーストは `within(screen.getByRole("region", { name: "通知" }))`、RAC の Modal を開いた後に同じファイルで `autoFocus` 付きの画面を描かない。`useRecordsOfTypes` の key は `useSyncTypes` に届いた型に絞る
- 既存の E2E(4 spec)は変えない。仕上げでユーザーが build と E2E を実行し、preview で目視する(Task 9)
- サブエージェントへのディスパッチ文は `.superpowers/sdd/<計画名>/dispatch-rules.md`(V4-F のものを複製して作業ツリーのパスだけ変える)を毎回参照させる

## 裁定台帳(2026-10-24)

計画を書く時点で決めたこと。K1 はユーザー裁定。Task 1 で設計書に書き戻し、最終報告で一覧にする。

| #   | 項目                                           | 裁定                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| K1  | 型の `description` の表示場所(E21)             | 設定の型一覧(既存)に加えて、**コンテンツの一覧の空状態**(案 D。その型が 0 件のとき)の説明文に出す。未設定なら今の文(`LIST_LABELS.empty.description`)のまま。案 E 2.2 の「ホームの「はじめに」」は型が 0 件のカードで型の説明を出す場所が無いため、「一覧の空状態」に改める。ユーザー裁定                                                                                                                                                              |
| K2  | 追加の列(E21、`listColumns`)                   | `ContentTable` がタイトル列の右・公開列の左に、`contentType.listColumns`(最大 `LIST_COLUMNS_MAX` = 3、型に無い key は無視)の順で列を足す。見出しは `field.label ?? field.key`、並べ替え無し、`hideOnNarrow`(狭い画面では追加列をすべて隠す。案 D 5 章の「ステータス → 更新」より先に隠す)。値は `tolerantReadData(contentType, record.input).values[key]` を `cellText` で整える。不在・不適合は「—」                                                      |
| K3  | セルの整形(`lib/list-cells.ts`)                | `cellText(field, value): string`: text / slug → 文字列(slug は等幅)、number → `toLocaleString("ja-JP")`、boolean → 「はい」/「いいえ」、datetime → `formatDateTime(new Date(value)).absolute`、select → 選ばれた `options[].label` を「、」で結ぶ(multiple 対応。未知の value はそのまま)、relation → 参照の件数「{n} 件」(0 は「—」)、richtext / json → 「—」(一覧では表さない)。セルは 1 行省略、`title` 属性に全文。文言は `LIST_LABELS.cell` に置く |
| K4  | 型設計の離脱ガード(E26)                        | `TypeEditor` に `useLeaveGuard(dirty)` を足す。`dirty` = `isNewType ? !isTypeDraftEmpty(draft) : isTypeDraftDirty(draft, initial)`(`view` モードは常に false)。ダイアログは `record-editor.tsx` と同じ `ModalDialog role="alertdialog"`(`isDismissable false`、閉じるボタン無し、「編集を続ける」/「破棄して移動」)で、本文だけ `DIALOGS.leaveType.body`「このまま移動すると、コンテンツタイプの変更は失われます。」。保存成功後と削除後の `navigate` は `ignoreBlocker: true` |
| K5  | ui の a11y 追補                                | `Checkbox` に `description?: string`(箱の下に `font.caption` `text.muted` の文。`aria-describedby` で結ぶ)、`SegmentedControl` に `isReadOnly?: boolean`(RAC `RadioGroup isReadOnly`。選択は変えられないが読み上げと焦点はそのまま)。`field-panel.tsx` の `Setting help` 包みの `Checkbox` 3 つ(indexed / unique / titleField)は `description` に置き換え、cardinality の `isDisabled={isReadOnly}` は `isReadOnly`。`TextField.isLabelHidden` は消費者が無いので見送り(最終報告に明記) |
| K6  | アップロードのファイルごとの進捗(F9)           | `createAdminApi(tokens, baseFetch?, options?: { createXhr?: () => XMLHttpRequest })`。`uploadAsset(tenantId, file, { onProgress?, signal? })` は XHR で送り、`upload.onprogress` の `loaded / total` を `onProgress` に流す。401 の再発行(1 回)と `ApiError` への写しは fetch 版と同じ。`UploadItem` の `uploading` に `progress?: { loaded: number; total: number }`、`uploadFiles` の `upload` の型を `(file, { onProgress, signal }) => Promise<{ id }>` に広げる。`UploadTileState.uploading` に `progress?: number`(0〜1)と `detail?: string`(「1.2 / 1.9 MB」)、`UploadTile` は進捗があれば `ProgressBar isLabelHidden` + 「64% ・ 1.2 / 1.9 MB」、無ければ従来の Spinner。全体の進捗(「2 / 5 件が完了」)は件数のまま |
| K7  | テストでの XHR                                 | `test-utils/fake-xhr.ts` の `createFakeXhr(routes)`: `stubFetch` と同じ routes(パス → Handler)を使い、`send(body)` で handler を呼んで `status` / `responseText` を写し、`upload` に `progress`(50% と 100%)→ `load` を発火する。`deferred` な Handler なら resolve まで `load` を待つ。router テストは `createAppContext` に `createXhr` を渡す(`test-utils/records-harness.tsx` の `renderAt` を拡張) |
| K8  | 「empty href」警告(V4-E 以前から)              | **見送り(再現せず)**。jsdom のテスト(shell / ルート群)でも、2026-10-24 にユーザーが dev で `media` テナントの owner としてホーム・一覧・編集・設定・メディアを一通り開いても出なかった。V4 の画面の差し替え(V2〜V4-F)で出所が消えたと判断する。最終報告に「再現せず」と書く                                                                                                                                                             |
| K9  | `password-form.tsx` の 1 列表示の空セル(V4-G) | 2 列目を空ける `<div aria-hidden="true" />` を NARROW では `display: none` にする(`styles.spacer`)                                                                                                                                                                                                                                                                                                                                                                      |
| K10 | StrictMode の回帰テスト(V4-G)                  | `settings-frame.test.tsx` に `<StrictMode>` で描くテストを 1 本足し、タブを切り替えた後に選択中のタブへフォーカスが移り、`pendingTabFocus` が消費されること(2 回目の effect で取りこぼさない)を断言する                                                                                                                                                                                                                                                             |
| K11 | V4-F の deferred minor の振り分け              | 直す: `media-list.test.ts` のコメントの取り違え、`media-table.tsx` の `COLUMNS.narrow` と `Cell hideOnNarrow` の二重管理、`media-thumb` の import 2 行、`searchText` / `normalizeForSearch` を `content-list.ts` から export して `media-list.ts` が使う、id 降順の `localeCompare` を単純比較に、`config` クエリに `enabled: assetId !== null`、`media-picker-dialog.tsx` の `extensionOf` を `MediaRow.extension` の規則(`media-list.ts` に `extensionOf` を export)に揃える、alt 保存失敗のトーストを 1 件にまとめる(`MEDIA_PICKER_LABELS.altSaveFailed(n)`)、テストの追補(Task 3)。見送り: `uploadStoreFor` の初回 `upload` 保持、`remove` が total から除かない、2 回ドロップの並行送信、詳細パネルの保存の ack 待ち、画像の取り直し、img alt の二重読み、`resetUploadStores`、`shouldAdvanceTime`、`page-body.test` の弱い断言、一括削除のトゥームストーン先着、アップロード直後の URL の notFound |
| K12 | E27・案 F 9 章の未決・design-sync              | 範囲外のまま(ユーザー裁定で design-sync は後回し)                                                                                                                                                                                                                                                                                                                                                                                                                 |

## Review Focus

1. **追加列の値が型の変更に取り残される**: 型から外されたフィールドが `listColumns` に残る、select の選択肢が消える、datetime が壊れた文字列 → 列は無視・値は「—」で一覧が落ちないこと。→ Task 6 の list-cells.test「型に無い key は列にせず、不適合な値は — にする」
2. **離脱ガードが保存・削除の遷移を止める**: 保存成功後の一覧への navigate と削除後の navigate がダイアログを出さずに通ること。→ Task 5 の content-types-leave.test「保存後の遷移はガードを通る」
3. **XHR 化で 401 の再発行と中止が壊れる**: 期限切れトークンで 1 回だけ再送、`AbortController` で `onabort` が `AbortError` 相当の失敗になり `uploadFiles` が次へ進むこと。→ Task 7 の admin-api.test「uploadAsset は 401 で 1 回再発行し、abort で中止する」
4. **進捗が 100% で止まったまま完了に切り替わらない**: `load` の後に `done` へ遷移し、仮タイルが 3 秒で消えること。→ Task 7 の media-upload.test「進捗が % で進み、完了で消える」
5. **`Checkbox.description` が読み上げに乗らない**: `aria-describedby` が箱の `input` に付くこと。→ Task 4 の checkbox.test「description は aria-describedby で結ばれる」

---

## ファイル構成

`packages/ui/src/`:

| ファイル                                     | 責務                                                       |
| -------------------------------------------- | ---------------------------------------------------------- |
| `checkbox.tsx`、`checkbox.test.tsx`          | 変更。`description`(K5)                                    |
| `segmented-control.tsx`、`.test.tsx`         | 変更。`isReadOnly`(K5)                                     |
| `upload-tile.tsx`、`upload-tile.test.tsx`    | 変更。`uploading` の `progress` / `detail`(K6)             |

`apps/admin/src/`:

| ファイル                                                              | 責務                                                                 |
| --------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `components/account/password-form.tsx`                                | 変更。NARROW でスペーサーを隠す(K9)                                  |
| `components/settings/settings-frame.test.tsx`                         | 変更。StrictMode の回帰テスト(K10)                                   |
| `lib/content-list.ts`、`lib/media-list.ts`、`components/media/*.tsx`  | 変更。K11 の整理                                                     |
| `components/media/*.test.tsx`、`media-*.test.tsx`                     | 変更。K11 のテスト追補(Task 3)                                       |
| `components/content-types/field-panel.tsx`                            | 変更。`Checkbox description` と `SegmentedControl isReadOnly`(K5)    |
| `components/content-types/type-editor.tsx`、`lib/content-type-form.ts` | 変更。離脱ガード(K4)、`isTypeDraftEmpty`                            |
| `routes/t/$tenantSlug/settings/content-types/{new,$typeKey.edit}.tsx` | 変更。`ignoreBlocker`(K4)                                            |
| `content-types-leave.test.tsx`                                        | 新規。離脱ガードの router テスト(モーダル 1 本)                      |
| `lib/list-cells.ts`、`list-cells.test.ts`                             | 新規。追加列の整形(K2・K3)                                           |
| `components/content-table.tsx`、`content-table.test.tsx`              | 変更。追加列(K2)                                                     |
| `components/content-list-body.tsx`                                    | 変更。空状態に型の説明(K1)                                           |
| `routes/t/$tenantSlug/content/$typeKey/index.tsx`                     | 変更。`contentType` を表と空状態へ渡す                               |
| `records-list.test.tsx`(既存の一覧の router テスト。名前は実物に合わせる) | 変更。追加列と空状態の説明の断言                                  |
| `lib/admin-api.ts`、`admin-api.test.ts`                               | 変更。XHR の `uploadAsset`(K6)                                       |
| `lib/media.ts`、`media.test.ts`、`lib/use-uploads.ts`、`.test.tsx`    | 変更。`progress`(K6)                                                 |
| `lib/asset-services.ts`                                               | 変更。`upload` の引数を広げる                                        |
| `components/media/media-grid.tsx`、`media-picker-dialog.tsx`          | 変更。`uploadTileState` に進捗                                       |
| `test-utils/fake-xhr.ts`、`test-utils/records-harness.tsx`、`router.ts` | 新規 / 変更。XHR の注入(K7)                                        |
| `lib/labels.ts`、`labels.test.ts`                                     | 変更。`LIST_LABELS.cell`、`DIALOGS.leaveType`、`MEDIA_PICKER_LABELS.altSaveFailed`、`MEDIA_LABELS.upload.progressDetail` |

`docs/admin-ux/e-content-type-design.md`、`d-content-list.md`、`f-media-library.md`、`h-common-surface.md`: 裁定の書き戻し。`.design-sync/NOTES.md`: ui の変更の記録。

## タスクの依存

Task 1(設計書)→ Task 2(小さな修正の束)→ Task 3(V4-F のテスト追補)→ Task 4(ui a11y 追補 + field-panel)→ Task 5(離脱ガード)→ Task 6(E21: 空状態の説明と追加列)→ Task 7(F9: XHR 進捗)→ Task 8(empty href)→ Task 9(検証・preview・報告)。Task 2〜7 は互いに独立(順序は小さいものから)。Task 8 は見送り(K8。再現せず)なので Task 7 の後は Task 9 へ。

---

### Task 1: 設計書へ裁定を書き戻す

**Files:**
- Modify: `docs/admin-ux/e-content-type-design.md`(2.2 の `description` の行と 6 章の表の「ホーム(案 B)」の行、実装状況の注記(E21)の下に 2026-10-24 の行、離脱ガード(K4)の注記)
- Modify: `docs/admin-ux/d-content-list.md`(5 章に追加列の規則 K2・K3、10 章の「型ごとに一覧の列を指定できるようにするか」を決定ログへ移す)
- Modify: `docs/admin-ux/f-media-library.md`(3.3 と 10 章に F9 の XHR 化 K6。「ファイルごとの % とバイト数」を D3 M6 どおりに出す)
- Modify: `docs/admin-ux/h-common-surface.md`(3 章の部品の表に `Checkbox.description` / `SegmentedControl.isReadOnly`、決定ログに 2026-10-24)
- Add: `docs/superpowers/plans/2026-10-24-admin-ux-carryovers.md`(本計画。main 側に未追跡で残っている複製はマージ時に消す)

- [ ] **Step 1: 各設計書に裁定を書き戻す**

K1〜K6・K9・K10 を、該当の章に「(2026-10-24、持ち越し)」の接頭で 1 行ずつ足す。既存の行の様式(V4-F の 2026-10-21 / 2026-10-24 の行)に合わせる。

- [ ] **Step 2: コミット**

```bash
git add docs/admin-ux docs/superpowers/plans/2026-10-24-admin-ux-carryovers.md
```

```bash
git commit -m "docs: UX 再構築の持ち越しの計画と裁定を設計書に書き戻す"
```

---

### Task 2: 小さな修正の束(password-form、StrictMode、V4-F の整理)

**Files:**
- Modify: `apps/admin/src/components/account/password-form.tsx`(K9)
- Modify: `apps/admin/src/components/settings/settings-frame.test.tsx`(K10)
- Modify: `apps/admin/src/lib/content-list.ts`(`searchText` / `normalizeForSearch` を export)、`apps/admin/src/lib/media-list.ts`(複製を消して import。`extensionOf` を export。id 降順を `a.id < b.id ? 1 : a.id > b.id ? -1 : 0` に)、`media-list.test.ts`(219 行付近のコメント「ID_C(大文字)」→「ID_B(B.png)」)
- Modify: `apps/admin/src/components/media/media-table.tsx`(`COLUMNS` の `narrow` だけを真実にし、`Cell hideOnNarrow={column.narrow}` にする)、`media-thumb.tsx`(import を 1 行に)、`media-library-data.ts`(`config` の `useQuery` に `enabled`)、`media-picker-dialog.tsx`(`extensionOf` を `media-list.ts` のものに、alt 保存失敗のトーストを `Promise.allSettled` でまとめて 1 件: `MEDIA_PICKER_LABELS.altSaveFailed(n)`)
- Modify: `apps/admin/src/lib/labels.ts`(`MEDIA_PICKER_LABELS.altSaveFailed: (n: number) => \`${n} 件の代替テキストを保存できませんでした\``)

**Interfaces:**
- Produces: `content-list.ts` の `export function searchText(value: string): string`(既存の非公開関数をそのまま export)、`media-list.ts` の `export function extensionOf(filename: string): string`(最大 4 文字、無ければ "?"。`buildMediaRows` も使う)

- [ ] **Step 1: 失敗するテストを書く**

```ts
// password-form.test.tsx に足す
it("1 列表示では 2 列目のスペーサーを描かない", () => { /* NARROW のクラスが spacer に付く(stylex のクラス差で断言。page-body.test と同じ様式) */ });
// settings-frame.test.tsx に足す
it("StrictMode でもタブを切り替えた後に選択中のタブへフォーカスが移る", async () => { /* render(<StrictMode>…</StrictMode>)、タブを切り替え → document.activeElement が aria-selected=true の tab */ });
// media-list.test.ts に足す
it("extensionOf は最大 4 文字を大文字にし、無ければ ? を返す", () => {});
// media-picker-dialog.test.tsx の「alt の保存が失敗してもトーストが出て挿入は進む」を 2 件失敗 → トースト 1 件「2 件の代替テキストを保存できませんでした」に広げる
```

- [ ] **Step 2: テストが失敗することを確かめる**

Run: `corepack pnpm --filter @plyrs/admin exec vitest run src/components/account src/components/settings/settings-frame.test.tsx src/lib/media-list.test.ts src/components/media/media-picker-dialog.test.tsx`
Expected: 新しい断言が FAIL

- [ ] **Step 3: 実装する**

- [ ] **Step 4: テストが通ることを確かめる**

Run: `corepack pnpm --filter @plyrs/admin exec vitest run src/lib src/components && corepack pnpm -r typecheck && corepack pnpm format && corepack pnpm format:check && corepack pnpm lint`
Expected: PASS、format:check exit 0

- [ ] **Step 5: コミット**

```bash
git add apps/admin/src
```

```bash
git commit -m "fix(admin): V4-G・V4-F から持ち越した小さな指摘を直す"
```

---

### Task 3: V4-F のテスト追補

**Files:**
- Modify: `apps/admin/src/media-upload.test.tsx`、`media-detail.test.tsx`、`media-list.test.tsx`、`components/media/media-toolbar.test.tsx`、`media-grid.test.tsx`、`media-table.test.tsx`、`delete-media-dialog.test.tsx`、`media-detail-panel.test.tsx`、`media-picker-dialog.test.tsx`、`media-bulk-delete.test.tsx`

- [ ] **Step 1: 足すテスト(それぞれ既存ファイルに 1 本ずつ。モーダルを開くファイルは 1 本の規則を守るため、既存の it の中に断言を足す)**

```ts
// media-upload.test.tsx: 2 件目が 500 のとき通知が error tone(region「通知」内の要素の role / クラスで断言)で、再試行の後に b.png が実タイルになる
// media-toolbar.test.tsx: sort が "name" の query で「絞り込みを解除」→ onQueryChange の sort が "name" のまま
// media-grid.test.tsx / media-table.test.tsx: selection.isDisabled true で全 row が aria-disabled
// media-thumb.test.tsx: isIntersecting false のコールバックでは resolveUrl を呼ばない
// media-detail-panel.test.tsx: 閲覧者で「コピー」と使用箇所のリンクが使える(F24)。「保存中」のテストは pending.resolve() 後に findBy で状態の更新を待つ
// media-detail.test.tsx: Esc でパネルが閉じて /media に戻る
// delete-media-dialog.test.tsx: consequence の文「削除すると、そのコンテンツからこのファイルが表示されなくなります」
// media-bulk-delete.test.tsx(既存の 1 本の中): DELETE の呼び出し順が選択順、再試行で失敗した id だけが再送される
// media-picker-dialog.test.tsx: resolve しない promise でも onSelect が呼ばれる
```

- [ ] **Step 2: 実行して通ることを確かめる(落ちたら実装の不備として報告。直すのは別タスク)**

Run: `corepack pnpm --filter @plyrs/admin exec vitest run src/components/media src/media-upload.test.tsx src/media-detail.test.tsx src/media-list.test.tsx src/media-bulk-delete.test.tsx && corepack pnpm format && corepack pnpm format:check && corepack pnpm lint`
Expected: PASS

- [ ] **Step 3: コミット**

```bash
git add apps/admin/src
```

```bash
git commit -m "test(admin): メディア画面の持ち越した断言を足す"
```

---

### Task 4: ui の a11y 追補(`Checkbox.description`、`SegmentedControl.isReadOnly`)と field-panel の置き換え

**Files:**
- Modify: `packages/ui/src/checkbox.tsx`、`checkbox.test.tsx`、`segmented-control.tsx`、`segmented-control.test.tsx`、`.design-sync/NOTES.md`、`.design-sync/docs/Checkbox.md` / `SegmentedControl.md`(あれば props の追記)
- Modify: `apps/admin/src/components/content-types/field-panel.tsx`、`field-panel.test.tsx`

**Interfaces:**
- Produces:

```ts
// checkbox.tsx(K5)
export interface CheckboxProps { …既存…; description?: string }   // 箱の右の文の下に font.caption text.muted。RAC Checkbox の入力に aria-describedby(useId)。children と同じ Label の中には入れない(クリックで切り替わってよい)
// segmented-control.tsx(K5)
export interface SegmentedControlProps { …既存…; isReadOnly?: boolean }   // RAC RadioGroup の isReadOnly。見た目は isDisabled と区別(文字色は text.default のまま、cursor default)
```

- [ ] **Step 1: 失敗するテストを書く**

```ts
// checkbox.test.tsx
it("description は aria-describedby で結ばれる", () => { /* getByRole("checkbox") の aria-describedby が description の要素 id */ });
// segmented-control.test.tsx
it("isReadOnly は選択を変えず、aria-readonly を付ける", async () => { /* radiogroup に aria-readonly="true"、別の radio を click しても onChange が呼ばれない、radio は disabled ではない */ });
// field-panel.test.tsx
it("索引・一意・タイトルの補足は Checkbox の description で読まれる", () => {});
it("読み取り専用の 1 件 / 複数は disabled ではなく readonly", () => {});
```

- [ ] **Step 2: テストが失敗することを確かめる**

Run: `corepack pnpm --filter @plyrs/ui exec vitest run src/checkbox.test.tsx src/segmented-control.test.tsx && corepack pnpm --filter @plyrs/admin exec vitest run src/components/content-types/field-panel.test.tsx`
Expected: FAIL

- [ ] **Step 3: 実装する**(RAC の `Checkbox` は `Text slot="description"` を持たないので、`useId` の `span` と `aria-describedby` で結ぶ。`RadioGroup` は `isReadOnly` を素通し)

- [ ] **Step 4: テストが通ることを確かめる**

Run: `corepack pnpm --filter @plyrs/ui exec vitest run && corepack pnpm --filter @plyrs/admin exec vitest run src/components/content-types && corepack pnpm -r typecheck && corepack pnpm format && corepack pnpm format:check && corepack pnpm lint`
Expected: PASS

- [ ] **Step 5: NOTES.md に記録してコミット**

```bash
git add packages/ui/src apps/admin/src .design-sync
```

```bash
git commit -m "feat(ui): Checkbox の補足と SegmentedControl の読み取り専用"
```

---

### Task 5: 型設計の離脱ガード(E26)

**Files:**
- Modify: `apps/admin/src/lib/content-type-form.ts`(`isTypeDraftEmpty`)、`content-type-form.test.ts`
- Modify: `apps/admin/src/components/content-types/type-editor.tsx`、`type-editor.test.tsx`
- Modify: `apps/admin/src/routes/t/$tenantSlug/settings/content-types/new.tsx`、`$typeKey.edit.tsx`(保存成功後・削除後の `navigate` に `ignoreBlocker: true`)
- Modify: `apps/admin/src/lib/labels.ts`(`DIALOGS.leaveType = { body: "このまま移動すると、コンテンツタイプの変更は失われます。" }`。title / stay / discard は `DIALOGS.leave` を使う)
- Create: `apps/admin/src/content-types-leave.test.tsx`(router テスト。モーダルを開くのは 1 本)

**Interfaces:**
- Consumes: `lib/use-leave-guard.ts` の `useLeaveGuard(dirty)`(`useBlocker` の `status` / `proceed` / `reset`)、`record-editor.tsx:485-500` のダイアログの様式、`isTypeDraftDirty(draft, initial)`
- Produces: `content-type-form.ts` の `export function isTypeDraftEmpty(draft: TypeDraft): boolean`(`emptyTypeDraft()` と等しい)。`TypeEditor` の props は変えない(`mode === "view"` では dirty を常に false)

- [ ] **Step 1: 失敗するテストを書く**

```ts
// content-type-form.test.ts
it("isTypeDraftEmpty は空の下書きだけ true", () => {});
// type-editor.test.tsx(部品単位。モーダルは 1 回)
it("変更があるときに離脱しようとすると確認が出て、編集を続けるで閉じる", async () => { /* useBlocker を vi.mock で status "blocked" に */ });
// content-types-leave.test.tsx(renderAt("/t/blog/settings/content-types/article/edit"))
it("表示名を変えてサイドバーの一覧へ移ろうとすると確認が出て、破棄して移動で一覧に戻る。保存後の遷移はガードを通る", async () => {
  // 表示名を変更 → complementary の link「コンテンツ」(または設定タブ)を fireEvent.click → alertdialog「保存していない変更があります」+ 本文「…コンテンツタイプの変更は失われます。」→「破棄して移動」→ pathname が変わる。
  // 別の it にはしない: 同じファイルで 2 回目のモーダルを開かない。Review Focus 2(保存後の遷移)は type-editor.test の単体で `ignoreBlocker` の有無を navigate の引数で断言する
});
```

- [ ] **Step 2: テストが失敗することを確かめる**

Run: `corepack pnpm --filter @plyrs/admin exec vitest run src/lib/content-type-form.test.ts src/components/content-types/type-editor.test.tsx src/content-types-leave.test.tsx`
Expected: FAIL

- [ ] **Step 3: 実装する**

- [ ] **Step 4: テストが通ることを確かめる**

Run: `corepack pnpm --filter @plyrs/admin exec vitest run src/lib src/components/content-types src/content-types-*.test.tsx && corepack pnpm -r typecheck && corepack pnpm format && corepack pnpm format:check && corepack pnpm lint`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add apps/admin/src
```

```bash
git commit -m "feat(admin): 型設計に未保存の変更の離脱ガードを足す"
```

---

### Task 6: 読む側の E21(一覧の空状態に型の説明、`listColumns` の追加列)

**Files:**
- Create: `apps/admin/src/lib/list-cells.ts`、`list-cells.test.ts`
- Modify: `apps/admin/src/components/content-table.tsx`、`content-table.test.tsx`
- Modify: `apps/admin/src/components/content-list-body.tsx`(`typeDescription?: string` prop。空状態の `description` に使う)
- Modify: `apps/admin/src/routes/t/$tenantSlug/content/$typeKey/index.tsx`(`contentType` を `ContentTable` と `ContentListBody` へ渡す)
- Modify: 一覧の router テスト(`src/records-list*.test.tsx` か `src/list-*.test.tsx`。実物の名前に合わせる)
- Modify: `apps/admin/src/lib/labels.ts`(`LIST_LABELS.cell = { empty: "—", yes: "はい", no: "いいえ", count: (n: number) => \`${n} 件\` }`)

**Interfaces:**
- Consumes: `tolerantReadData(contentType, raw)`(`@plyrs/metamodel`)、`LIST_COLUMNS_MAX`、`formatDateTime`、`FieldDefinition`
- Produces:

```ts
// lib/list-cells.ts(K2・K3)
export interface ListColumn { key: string; label: string; mono: boolean }   // mono は slug
export function listColumnsOf(contentType: ContentTypeDefinition): ListColumn[];   // listColumns の順、型に無い key は落とす、最大 LIST_COLUMNS_MAX
export function cellText(field: FieldDefinition, value: unknown): string;          // K3。不在・不適合は LIST_LABELS.cell.empty
export function rowCells(contentType: ContentTypeDefinition, record: SyncRecord, columns: readonly ListColumn[]): string[];   // tolerantReadData → cellText
// content-table.tsx: props に contentType: ContentTypeDefinition を足す。COLUMNS を [title, ...listColumnsOf(contentType).map(c => ({ id: `field:${c.key}`, sortable: false, narrow: true, label: c.label })), publication, status, updated] に組み直す。field 列の Cell は rowCells の文字列(1 行省略、title 属性)。見出しの並べ替えは出さない
// content-list-body.tsx: typeDescription が空でなければ EmptyState の description に使う
```

- [ ] **Step 1: 失敗するテストを書く**

```ts
// list-cells.test.ts
it("listColumnsOf は listColumns の順で label を付け、型に無い key を落とし、4 件目以降を切る", () => {});
it("cellText は種類ごとに整える(text / slug / number / boolean / datetime / select 単一・複数 / relation 件数 / richtext・json は —)", () => {});
it("型に無い key は列にせず、不適合な値は — にする", () => { /* Review Focus 1。datetime に "abc"、select に無い value、number に文字列 */ });
// content-table.test.tsx
it("listColumns の列がタイトルの右に並び、見出しは表示名、狭い画面で隠れる", () => {});
// 一覧の router テスト
it("型に listColumns があると追加の列が出て、0 件のときは型の説明が空状態に出る", async () => {});
```

- [ ] **Step 2: テストが失敗することを確かめる**

Run: `corepack pnpm --filter @plyrs/admin exec vitest run src/lib/list-cells.test.ts src/components/content-table.test.tsx`
Expected: FAIL

- [ ] **Step 3: 実装する**

- [ ] **Step 4: テストが通ることを確かめる**

Run: `corepack pnpm --filter @plyrs/admin exec vitest run src/lib src/components src/records-flow.test.tsx <一覧の router テスト> && corepack pnpm -r typecheck && corepack pnpm format && corepack pnpm format:check && corepack pnpm lint`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add apps/admin/src
```

```bash
git commit -m "feat(admin): 一覧に型の追加列と空状態の説明を出す"
```

---

### Task 7: アップロードのファイルごとの進捗(F9、XHR 化)

**Files:**
- Modify: `apps/admin/src/lib/admin-api.ts`、`admin-api.test.ts`(K6)
- Modify: `apps/admin/src/lib/media.ts`、`media.test.ts`(`UploadItem.uploading.progress`、`uploadFiles` の `upload` の型)
- Modify: `apps/admin/src/lib/use-uploads.ts`、`use-uploads.test.tsx`(progress の emit)
- Modify: `apps/admin/src/lib/asset-services.ts`(`upload: (file, options?) => …`)
- Modify: `packages/ui/src/upload-tile.tsx`、`upload-tile.test.tsx`、`.design-sync/NOTES.md`
- Modify: `apps/admin/src/components/media/media-grid.tsx`(`uploadTileState` に progress / detail)、`media-picker-dialog.tsx`(同じ関数を使う)
- Modify: `apps/admin/src/lib/labels.ts`(`MEDIA_LABELS.upload.progressDetail: (percent: number, loaded: string, total: string) => \`${percent}% ・ ${loaded} / ${total}\``)
- Create: `apps/admin/src/test-utils/fake-xhr.ts`(K7)。Modify: `test-utils/records-harness.tsx`、`router.ts`(`createAppContext` に `createXhr` を渡せる)、`media-upload.test.tsx`、`media-picker-*.test.tsx`、`records-flow.test.tsx` / `richtext-flow.test.tsx`(アップロードを含むなら)

**Interfaces:**
- Produces:

```ts
// admin-api.ts(K6)
export interface UploadProgress { loaded: number; total: number }
export interface UploadOptions { onProgress?: (progress: UploadProgress) => void; signal?: AbortSignal }
export function createAdminApi(tokens: TokenManager, baseFetch?: typeof fetch, options?: { createXhr?: () => XMLHttpRequest }): AdminApi;
// AdminApi.uploadAsset(tenantId: string, file: File, options?: UploadOptions): Promise<{ id: string }>
//   XHR: open("POST", `/v1/t/${tenantId}/assets?filename=…`)、setRequestHeader(authorization, content-type)、upload.onprogress → onProgress({ loaded, total })、
//   load → status 2xx なら JSON を返す、401 なら forceRefresh で 1 回だけ再送、それ以外は ApiError(throwApiError と同じ写し: 本文の error コードを読む)、
//   error → NetworkError(withNetworkErrors と同じ型)、abort(signal) → AbortError(name "AbortError" の DOMException)
// media.ts
export type UploadItem = { file: File } & ( | { status: "queued" } | { status: "uploading"; progress?: UploadProgress } | { status: "done"; assetId: string } | { status: "failed"; reason: UploadRejection | "error"; cause?: unknown } );
export async function uploadFiles(files, upload: (file: File, options: UploadOptions) => Promise<{ id: string }>, options?): Promise<UploadSummary>;   // upload に onProgress を渡し、進捗を uploading の item に写して onChange
// upload-tile.tsx
export type UploadTileState = … | { kind: "uploading"; progress?: number; detail?: string } | …;   // progress 0〜1。あれば ProgressBar(isLabelHidden、value = progress * 100)+ font.caption の detail。無ければ Spinner(従来)
// media-grid.tsx
export function uploadTileState(entry, handlers): UploadTileState;   // uploading に progress があれば { progress: loaded / total, detail: MEDIA_LABELS.upload.progressDetail(Math.round(progress * 100), formatBytes(loaded), formatBytes(total)) }
// test-utils/fake-xhr.ts(K7)
export function createFakeXhr(routes: Record<string, Handler>): () => XMLHttpRequest;   // send(body) → handler(init) → status / responseText を写し、upload の progress(50%, 100%)→ load。abort() は onabort
```

- [ ] **Step 1: 失敗するテストを書く**

```ts
// admin-api.test.ts
it("uploadAsset は XHR で送り、進捗を onProgress に流す", async () => {});
it("uploadAsset は 401 で 1 回再発行し、abort で中止する", async () => { /* Review Focus 3 */ });
it("uploadAsset は 413 を ApiError(too_large) にする", async () => {});
// media.test.ts: uploadFiles が uploading の item に progress を写す
// use-uploads.test.tsx: progress の変化で snapshot が更新される
// upload-tile.test.tsx: progress があれば progressbar と「64% ・ 1.2 / 1.9 MB」、無ければ従来の Spinner
// media-upload.test.tsx(既存の it の中): 進捗が % で進み、完了で消える(Review Focus 4)
```

- [ ] **Step 2: テストが失敗することを確かめる**

Run: `corepack pnpm --filter @plyrs/admin exec vitest run src/lib/admin-api.test.ts src/lib/media.test.ts src/lib/use-uploads.test.tsx && corepack pnpm --filter @plyrs/ui exec vitest run src/upload-tile.test.tsx`
Expected: FAIL

- [ ] **Step 3: 実装する**(fetch 版の `uploadAsset` は消す。アップロードを含む既存テストは `createFakeXhr(routes)` を `createAppContext` に渡す形に直す)

- [ ] **Step 4: テストが通ることを確かめる**

Run: `corepack pnpm --filter @plyrs/ui exec vitest run && corepack pnpm --filter @plyrs/admin exec vitest run src/lib src/components && corepack pnpm --filter @plyrs/admin exec vitest run src/media-*.test.tsx src/records-flow.test.tsx src/richtext-flow.test.tsx src/asset-*.test.tsx && corepack pnpm -r typecheck && corepack pnpm format && corepack pnpm format:check && corepack pnpm lint`
Expected: PASS

- [ ] **Step 5: NOTES.md に記録してコミット**

```bash
git add apps/admin/src packages/ui/src .design-sync
```

```bash
git commit -m "feat(admin): アップロードの進捗をファイルごとに % で出す"
```

---

### Task 8: 「empty href」警告(K8。見送り)

2026-10-24 に jsdom と dev の両方で再現しなかったため、このタスクは実装しない。最終報告(Task 9 Step 5)に「再現せず。V4 の差し替えで消えたと判断」と書く。今後 dev のコンソールで再び出たら、警告本文と React のコンポーネントスタックを添えて別途直す。

---

### Task 9: 検証、preview、報告

- [ ] **Step 1: 静的検査とテスト**

Run: `corepack pnpm lint && corepack pnpm format:check && corepack pnpm -r typecheck`、admin は 3 組に分けて vitest、ui / api / 他は `corepack pnpm --filter <pkg> exec vitest run`
Expected: すべて成功

- [ ] **Step 2: ビルドと E2E(ユーザーに依頼。サンドボックス外)**

Run: `pnpm --filter @plyrs/admin build && pnpm --filter @plyrs/e2e test`
Expected: build 成功、4 spec が PASS(E2E は変えていない)

- [ ] **Step 3: preview での目視(ユーザーに依頼)**

- 一覧: `listColumns` を持つ型で追加列が出る(text / 日時 / 選択肢 / はい・いいえ)、狭い画面で隠れる、0 件の型の空状態に型の説明
- 型設計: 表示名を変えてサイドバーで移ろうとすると確認、保存後は確認なしで一覧へ、新規の空の下書きでは確認なし
- フィールドの設定: 索引・一意・タイトルの補足が読み上げに乗る(VoiceOver / NVDA)、モジュールの型の「1 件 / 複数」が読み取り専用
- メディア: 大きめのファイル(数 MB)で仮タイルに % とバイト数、複数で順に進む、「残りを中止」、20 MB 超えは従来どおり送る前に弾く。選択ダイアログでも同じ
- アカウント: 狭い画面でパスワードの欄の間に空行が無い

- [ ] **Step 4: ブランチの仕上げ**(superpowers:finishing-a-development-branch。統合方法はユーザーに提示)

- [ ] **Step 5: 報告**: 裁定台帳(K1〜K12)と設計書への書き戻し、実行中の裁定(SDD の台帳の Ruling)、見送ったもの(K5 の `TextField.isLabelHidden`、K11 の見送り、K8 の empty href は再現せず)、design-sync の再同期が残っていること

---

## セルフレビュー(2026-10-24)

- 仕様の網羅: E21(E 6 章の読む側: `listColumns` → Task 6 K2・K3、`description` → Task 6 K1)、E26(C 7 章の離脱 → Task 5 K4)、F9(F 3.3 / M6 の % とバイト数 → Task 7 K6)、V4-E の a11y 追補(→ Task 4 K5。`TextField.isLabelHidden` は見送り)、V4-G の 2 件(→ Task 2 K9・K10)、V4-F の deferred(→ Task 2 K11 の「直す」と Task 3 の追補)、empty href(→ K8 で見送り。再現せず)。design-sync は K12 で範囲外
- 型の整合: `cellText` / `listColumnsOf` / `rowCells`(Task 6)、`UploadOptions` / `UploadProgress`(Task 7 の admin-api.ts と media.ts で同じ名前)、`UploadTileState.uploading.progress` は 0〜1 の number(ui)と `UploadProgress`(admin)を `uploadTileState` が変換。`isTypeDraftEmpty`(Task 5)は `content-type-form.ts` の `emptyTypeDraft()` と同じ形
- Review Focus 5 件はそれぞれ Task 6・5・7・7・4 のテストに結んだ
- 手順の粒度: 各タスクは失敗するテスト → 実装 → 通す → コミットの 1 周。Task 3 だけはテスト追補で、コミットは成果があるときだけ。Task 8 は見送り
