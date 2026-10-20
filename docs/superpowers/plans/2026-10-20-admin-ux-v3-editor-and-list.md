# 管理画面 UX 再構築 V3: 編集と一覧(案 C・案 D) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** コンテンツの編集・作成画面を案 C の公開ボックス(保存・公開・ステータス・公開状態・削除を右側に集約。「公開」は未保存の変更を保存してから公開)に作り直し、一覧画面を案 D の形(公開状態のタブと列、絞り込み・検索・並べ替え・ページ送りを URL に保持、一括操作)にする。結果の通知はトースト、確認は `ConfirmDialog`、未保存の離脱は確認ダイアログで止める。

**Architecture:** 画面の判断は純関数に寄せ、部品は描くだけにする(V2 と同じ方針)。公開ボックスの状態→ボタン・注記の決定は `lib/publish-box.ts`、一覧の絞り込み・並べ替え・ページ送りは T12 の `lib/content-list.ts`、保存→確定待ち→公開は T11 の `useSaveAndPublish`、離脱防止は `useLeaveGuard`。作成画面と編集画面は同じ `RecordEditor` 部品を使い、ルートは薄くする。`RecordForm` は送信ボタンを持たず、`validate()` / `save()` のハンドルと `onDirtyChange` を外に出す。コアの `record-editor:toolbar` / `record-editor:panel` 登録(`core.publish` / `core.status` / `core.publication`)は廃止し、スロットはモジュール用に残す。一覧の一括操作は `runBulk`(逐次実行・中止・集計)の上に `useBulkAction`(進捗・失敗の再試行)を置き、表・一括バー・ページ送りは admin の部品に分ける。見た目はセマンティックトークンと `@plyrs/ui` の部品だけで組む。

**Tech Stack:** StyleX 0.19.1、react-aria-components 1.21.1(`Table` / `Tabs` / `Menu` / `ModalOverlay` / `UNSTABLE_Toast` を ui の部品経由で)、TanStack Router 1.170.18(`validateSearch` / `useBlocker` / `navigate({ replace, ignoreBlocker })`)、TanStack Query 5、TanStack Form 1.33、lucide-react、Vitest + jsdom + Testing Library、Playwright

**Spec:**
- `docs/admin-ux/c-publish-box.md`(2〜11 章が真実源。12 章の未決事項は範囲外)
- `docs/admin-ux/d-content-list.md`(2〜9 章が真実源。10 章の未決事項は本計画の裁定で扱う)
- `docs/admin-ux/h-common-surface.md`(3 章 部品、4 章 文言、5 章 日時、6 章 状態、7 章 権限、8 章 確認の使い分け、10 章 画面幅、11 章 アクセシビリティ、12 章 アイコン)
- `docs/admin-ux/h-design-tokens.md`(3 章 セマンティックトークン)
- `docs/admin-ux/e-content-type-design.md` 2 章(フィールドの `label` / `description`、`titleField`。本計画は読むだけ)
- `docs/superpowers/plans/2026-10-17-admin-ux-rebuild-roadmap.md` 5 章 V3
- `docs/superpowers/plans/2026-10-19-admin-ux-v2-shell-navigation.md`(V2 で作った部品の契約。Global Constraints と各タスクの Interfaces)
- キャンバス https://claude.ai/artifact/K57TVUfpefMuiPxhZXyAnU のページ「D2 骨格と主要 3 画面」の E1〜E9(編集・作成)と L1〜L8(一覧)。設計書と食い違うときは設計書を優先する(食い違いは「裁定台帳」に記し、Task 1 で設計書に書き戻し、最後に報告する)

## Global Constraints

- 画面と部品が参照するのはセマンティックトークン(`@plyrs/ui/semantic.stylex`)だけ。本計画で触る admin のファイルからは旧 `@plyrs/ui/tokens.stylex`(`colors` / `spacing` / `typography`)の参照を無くす(対応表は V2 計画の Global Constraints と同じ: `colors.bg`→`bg.canvas`、`surface`→`bg.surface`、`border`→`border.default`、`text`→`text.default`、`textMuted`→`text.muted`、`accent`→`accent.default`、`accentText`→`text.onAccent`、`danger`→`status.danger`、`focusRing`→`focus.ring`、`spacing.*`→`space.*`、`typography.fontFamily`→`font.family`、`sizeSm`→`font.caption`、`sizeMd`→`font.body`、`sizeLg`→`font.label`、`sizeXl`→`font.sectionTitle`。直書きの `"1px"`→`stroke.default`、`"4px"/"6px"` の角丸→`radius.control`、`"8px"` の角丸→`radius.container`)。対象: `components/record-form.tsx`、`conflict-dialog.tsx`、`asset-picker.tsx`、`asset-thumb.tsx`(record-form が使う)。`publish-toolbar.tsx` / `status-control.tsx` / `publication-panel.tsx` は削除する。本計画の最後に `grep -rln "tokens.stylex" apps/admin/src/components apps/admin/src/routes/t` が `content-type-form.tsx` と `error-screen.tsx` だけになる(この 2 つと `routes/login.tsx` / `signup.tsx` / `super/**` は V4 以降の範囲で、触らない)
- キャンバスの寸法は尺度に寄せる(V1・V2 の裁定と同じ): 文字 13px→14px(`font.body`)、12px→`font.caption`、11px→12px、16px→`font.label`、18px→16px、20px→`font.sectionTitle`、22px→24px(`font.pageTitle`)。余白 10px→12px(`space.inset`)、6px→8px(`space.sm`)、4px→`space.xs`、2px→`space.xxs`、20px→24px(`space.lg`)、32px→`space.xl`。部品固有の寸法は数値で書き、コメントで根拠(c-publish-box.md 2 章 / d-content-list.md 5 章 / D2)を添える: 右列の幅 300px、フォームとの間隔 32px(`space.xl`)、公開ボックスのラベル列 64px、ステータスのセレクト 28px(`size.controlSm`)、下部固定バーの本文側の余白 88px、ステータスの絞り込みの幅 180px、検索欄 280px、公開列 200px(狭い画面 150px)、ステータス列 120px、更新列 110px、ページ送りのボタン 28px、確認ダイアログの幅 440px(ui の `ModalDialog` の既定のまま)、競合ダイアログの幅 760px、トーストの幅 400px(ui の既定。キャンバスの 420px は採らない)
- 幅 960px 未満の切り替えは CSS のメディアクエリ `"@media (max-width: 959px)"` だけで行う(各ファイルに `const NARROW` で書く。JS の `matchMedia` は使わない)。狭い画面でも広い画面と同じ要素を描き、CSS で出し分ける。jsdom では CSS が当たらず両方が見えるため、テストは `within(...)` で公開ボックス(`role="region"`、名前「公開」)と下部固定バー(`role="region"`、名前「公開の操作」)を区別する
- 画面は `@plyrs/ui` の部品(`Button` / `IconButton` / `Badge` / `Tabs` / `Table` 系 / `Menu` 系 / `SearchField` / `Select` / `ConfirmDialog` / `ModalDialog` / `EmptyState` / `Skeleton` / `ProgressBar` / `Spinner` / `RelativeTime` / `Tooltip` / `Banner` / `PageHeader`)で組む。react-aria-components を admin から直接 import してよいのは `components/shell/` だけ(V2 の裁定)。例外として一覧の表の中のリンク(タイトル・行の操作)は RAC の `Link` を `@plyrs/ui` 経由ではなく直接使ってよい(`Breadcrumbs` / `NavLink` と同じく `RouterProvider` で画面内遷移になる)。これも本計画の裁定として台帳に記す
- 画面上の呼称と文言は `lib/labels.ts` の対応表に従い、本計画で足す文言もすべて `labels.ts` に置く(画面・部品に日本語を直書きしない。例外: テストの断言)。「レコード」は使わず型名で呼ぶ(棚卸し 6.1)。文体は「です・ます」、ボタンは操作名(H 4.2)
- 日時は `lib/datetime.ts` の `formatDateTime` と ui の `RelativeTime` で出す。ISO 文字列・`version` を画面に出さない(H 5 章)
- エラーは `lib/error-messages.ts` の `errorMessage(cause, fallback)` で利用者向けの文にする。例外の `message` をそのまま出さない(`record-form.tsx` の `syncErrorMessage` は廃止する)
- 見出しは 1 画面に `h1` が 1 つ(`PageHeader`)。公開ボックス・モジュールのパネルの題は `h2`
- アイコンは `lucide-react`、ボタン・バッジ・注記の中は `ICON_SIZE.inline`(16px)、空状態は ui の `EmptyState` に任せる。装飾は `aria-hidden`。使うアイコン(H 12 章): globe(公開)/ pencil(未保存の注記)/ trash-2 / rotate-cw(再試行)/ triangle-alert / circle-alert(失敗の印)/ lock(閲覧のみ)/ inbox(0 件の空状態)/ search(検索 0 件)/ chevron-left / chevron-right(ページ送り)/ plus
- 権限の出し分けは `useCan()` / `can()` だけ(ロールの直書き禁止)。閲覧者(`record:write` 無し)には「新規追加」・公開ボックスのボタン・チェックボックス・一括操作・行の「編集」「削除」を出さず、「表示」と読み取り専用のフォームだけを出す(H 7 章「隠す」)。状況で使えない操作(切断中の公開)は `Button` の `disabledReason` で理由を添える(「無効にして理由を添える」)
- 確認の使い分け(H 8 章): 削除・公開の取り下げ・公開したままのアーカイブ・一括の削除と取り下げは `ConfirmDialog`(`tone="danger"`、初期フォーカスはキャンセル、実行ボタンは操作名)。保存・公開・ステータスの変更は確認なしで結果をトースト(成功は `toaster.success`、失敗は `toaster.error`)
- RTL テストの方針(V2 で分かった罠): router 経由で描くテスト(`renderAt`)では RAC の `Menu` を user-event で開けず、同じファイルで RAC の Modal を 2 回開くとハングする。したがって (1) ダイアログ・メニューの挙動は部品単位のテスト(`components/*.test.tsx` の直接描画、`packages/ui/src/*.test.tsx`)で担保する、(2) router 経由でモーダルを開くテストは **1 ファイル 1 本**にし、ファイル名を `record-<場面>.test.tsx` / `content-list-<場面>.test.tsx` にする、(3) 一括操作のメニューを使う router テストは `vi.mock("../components/bulk-bar")` で素のボタンに差し替える(V2 の `account-menu` の mock と同じ手口)、(4) モーダルを開く操作は `fireEvent.click`、それ以外は `userEvent`。共通の下地は `src/test-utils/records-harness.tsx` に出す(Task 8)
- `getByRole("status")` はサイドバーの同期状態と重なるため、名前か `within` で絞る。トーストは `within(screen.getByRole("region", { name: "通知" }))` で探す
- `@ts-expect-error` は使わない。素の `git stash` は使わない。コメント・ドキュメント・コミットメッセージは日本語。コミットは各タスクの最後に 1 つ(`/commit` スキルの規約。帰属行は付けない)
- サンドボックスの道具: `pnpm` は `corepack pnpm`。ルートの `pnpm typecheck` / `pnpm test` は使わず `corepack pnpm -r typecheck`、`corepack pnpm -r --filter "!@plyrs/e2e" test`。`pnpm install`、admin の `build`、`dev` サーバー、E2E、design-sync の再同期はサンドボックスの外で実行する(実行できない手順は「ユーザーに依頼」と書く)。並列実行で ui の RAC のテストが 5 秒でタイムアウトしたら、そのファイルを単独で再実行して判断する
- `docs/` と `.design-sync/` は oxfmt の対象外。それ以外は各タスクの最後に `corepack pnpm format` をかける
- ロードマップ 5 章の注記どおり、V3 は preview 環境で実機確認する(Task 14)。push はユーザーに確認してから
- サブエージェントへのディスパッチ文には、作業ツリーのパスを `cd` 付きで強制すること、`git log --oneline -2` の実出力を貼らせること、テストの実出力を貼らせること、`@ts-expect-error` 禁止と素の `git stash` 禁止を含める

## 裁定台帳(2026-10-20)

計画を書く時点で決めたこと。Task 1 で設計書に書き戻し、最終報告で一覧にする。番号は本文から参照する。

| #   | 項目                                                                 | 裁定                                                                                                                                                                                                                                                                                                                                      | 書き戻し先           |
| --- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| R1  | 見出しの右の「最終更新 10 分前 ・ editor@example.com」(C 2 章)       | V3 は「最終更新 10 分前」(相対表記 + ツールチップ)だけ。`updatedBy` はユーザー ID で、メールへの解決は案 G のメンバー情報の取得方法が決まってから(D 10 章の「最終更新者の列」と同じ扱い)。閲覧者は錠アイコン +「閲覧のみ ・ 最終更新 10 分前」(D2 E7)。ユーザー裁定                                                                        | c 2 章・12 章        |
| R2  | 閲覧者の読み取り専用のフォーム(C 9 章「下線だけ」)                   | `@plyrs/ui` の入力部品に `isReadOnly` を足して D2 どおりにする(枠線なし・下罫線だけ、`RichTextEditor` はツールバー無し)。ユーザー裁定                                                                                                                                                                                                      | h 3 章               |
| R3  | 行の操作「複製」(D 5 章・10 章)                                      | V3 には入れない(API に複製が無い)。行の操作は「編集」「削除」、閲覧者は「表示」。ユーザー裁定                                                                                                                                                                                                                                              | d 5 章・10 章        |
| R4  | 狭い画面での行の操作(D 10 章)                                        | ホバーが無いため幅 960px 未満では常時表示する(「…」メニューにしない)。ユーザー裁定                                                                                                                                                                                                                                                         | d 5 章・10 章        |
| R5  | フォームのフィールドのラベル                                         | T6 の `label` / `description` をフォームで使う(`label ?? key`、`description` は入力欄の下)。ユーザー裁定                                                                                                                                                                                                                                  | e 4 章(実装状況)     |
| R6  | ステータスの操作(C 5 章「下書き [変更]」と 2 章「28px のセレクト」)  | 2 章を採る: 「変更」リンクは置かず、28px の `Select`(ラベルは部品の標準どおり上に「ステータス」)がそのまま切り替え。5 章の記述を 2 章に揃える                                                                                                                                                                                              | c 5 章               |
| R7  | 新規作成(未保存)での「未保存の変更があります」(C 7 章)               | 出さない(D2 E1)。状態の「まだ保存されていません」で足りる。7 章に「新規作成を除く」を足す                                                                                                                                                                                                                                                  | c 7 章               |
| R8  | 閲覧者の公開ボックス(C 9 章「公開状態とステータスの表示だけ」)       | 公開日時と「未反映の変更があります」も公開状態の一部として出す(D2 E7)。ステータスは文字だけ                                                                                                                                                                                                                                                | c 9 章               |
| R9  | 切断中の注記(C 4 章)                                                 | 補助ボタンの名前を文に埋め込む: 未公開・新規は「「下書き保存」は…」、公開中は「「公開せずに保存」は…」、補助ボタンが無いときは「接続が回復すると公開できます」だけ(D2 E6 の変種)                                                                                                                                                           | c 4 章               |
| R10 | 競合ダイアログ(C 4 章)                                               | `ModalDialog` で作り直す。題「本文が他の人の編集と重なりました」、相手のメールは出せないため「ほかの人が {相対時刻} に同じ本文を保存しました」。D2 のラジオ(どちらを残すか)の代わりにボタンを 3 つ: 「あなたの編集を残す」(主)、「ほかの人の編集を取り込む」(枠線。現行の「サーバー版を採用」)、「あとで決める」(枠線)。差分の強調(`<mark>`)は入れず抜粋を並べる | c 4 章               |
| R11 | 離脱確認のボタン(C 7 章「補助は危険色の文字」)                       | `ConfirmDialog` ではなく `ModalDialog` + フッターで組む: 「破棄して移動」は `Button variant="dangerLink"`、「編集を続ける」は主ボタンで初期フォーカス(危険でない確認は実行ボタンにフォーカス、H 8 章)                                                                                                                                       | c 7 章               |
| R12 | 編集画面の h1                                                        | 設計書どおり `{型名}を編集`(D2 E2 のタイトル表示は採らない)。閲覧者は `{型名}を表示`、パンくずは「表示」。メディア(asset 型)の編集はパンくず ホーム › メディア › 編集                                                                                                                                                                        | c 2 章・9 章・10 章  |
| R13 | 一括操作の「ステータスを変更」(D 6 章、D2 L2 のサブメニュー)         | ui の `Menu` にサブメニューが無いため、`MenuSection`「ステータスを変更」の下に 4 つのステータスを並べる                                                                                                                                                                                                                                   | d 6 章               |
| R14 | 一部失敗のトースト(D 6 章)                                           | 設計書どおり 1 文(「8 件を公開しました。2 件は公開できませんでした」)。D2 L4 の 2 行目は採らない(トーストは題と操作だけ)。失敗したものは選択に残し、公開列に「失敗」の印、バーに「公開をもう一度試す」                                                                                                                                       | d 6 章               |
| R15 | 検索・絞り込みで 0 件のときの導線(D 3.2)                             | 設計書どおり「絞り込みを解除」だけ(タブ・ステータス・検索語をすべて既定に戻す)。D2 L6 の「「すべて」で検索」は採らない                                                                                                                                                                                                                      | d 3.2                |
| R16 | ステータス列の見た目                                                 | バッジ: 下書き neutral / レビュー中 accent / 公開準備完了 success / アーカイブ neutral + 取り消し線(D2 L1。設計書は列の存在のみ)                                                                                                                                                                                                             | d 5 章               |
| R17 | 一括操作のバーの枠                                                   | `accent.surface` に `stroke.default` の `accent.default` の枠と `radius.control`(D2 L2。設計書は地の色のみ)                                                                                                                                                                                                                                | d 6 章               |
| R18 | 一覧の URL クエリが変わったときの選択                                | タブ・ステータス・検索語・並べ替え・ページのどれが変わっても選択を解除する(別のページの行を選んだまま一括操作できないように)。`perPage` の変更も同じ                                                                                                                                                                                       | d 6 章・8 章         |
| R19 | 行の操作のホバー表示の実装                                           | StyleX は子孫セレクタを書けないため、RAC の `Row` が付ける `data-hovered` を使う小さな CSS を admin の `styles.css` に置く(`[data-row-actions]` の opacity。`:focus-within` と幅 960px 未満では常時表示)                                                                                                                                      | d 5 章               |
| R20 | 公開状態の一括取得に失敗したとき                                     | 一覧の本文に `role="alert"` の文(`errorMessage`)と「再試行」ボタンを出し、表は出さない(取得前は本文をスケルトンにする)                                                                                                                                                                                                                     | d 9 章               |
| R21 | 「更新」が無効のとき(公開中・未反映なし・未編集)                     | 理由のツールチップは付けず `isDisabled`(設計書 3 章の表に理由が無い。切断中だけ `disabledReason`)                                                                                                                                                                                                                                           | c 3 章               |
| R22 | 作成画面の「公開」の順序                                             | 作成(insert の ack 待ち)→ 公開 → トースト → 編集画面の URL へ置き換え(`replace: true, ignoreBlocker: true`)。公開に失敗しても URL は置き換え、エラーのトーストの「公開を再試行」は保存済みの ID に対して公開 API を呼ぶ閉包にする(フックの `retryPublish` はルートをまたぐと使えない)                                                              | c 6 章               |
| R23 | 表の中のリンク                                                       | 一覧のタイトルと行の操作「編集」「表示」は RAC の `Link`(`href`)を admin から直接使う(Global Constraints の例外)                                                                                                                                                                                                                             | h 3 章               |
| R24 | `PageLoading` の二重読み上げ(V2 持ち越し 8)                          | h1 の `VisuallyHidden`「読み込み中」を残し、本文のスケルトンから `role="status"` を外して `aria-hidden` にする。テストは `findByRole("heading", { level: 1, name: "読み込み中" })` に                                                                                                                                                         | (コード)             |

## Review Focus

1. **未保存の編集がある公開中のコンテンツで「更新」**: 保存の ack が返る前に公開 API が呼ばれてはならない(古い版が公開される)。→ Task 8 の publish-box-flow.test「未保存の編集がある状態の更新は、push の ack の後に publish を呼ぶ」
2. **作成画面で「公開」**: insert → ack → publish → URL の置き換え、の順で、離脱確認に止められず、置き換え後の編集画面が公開中を示すこと。→ Task 8 の records-flow.test「作成画面の公開は作成の確定後に公開し、編集画面の URL に置き換える」
3. **一括公開の一部失敗**: 失敗した行だけが選択に残り、公開列に「失敗」の印が付き、「公開をもう一度試す」が失敗分だけを再実行すること。→ Task 12 の content-list-bulk.test「一部が失敗すると失敗分だけを選択に残し、再試行は失敗分だけを呼ぶ」
4. **公開状態の一括取得が失敗する**: 一覧が落ちず、エラーの文と再試行が出て、再試行で表が出ること。→ Task 11 の content-list-flow.test「公開状態の取得に失敗したら再試行を出す」
5. **URL のクエリに範囲外の値**(`?page=99`、`?tab=xxx`): ページは最後のページに寄せ、未知のタブは「すべて」に戻り、画面が落ちないこと。→ Task 11 の content-list-flow.test「範囲外の page は最後のページに寄せ、未知の tab は既定に戻す」

---

## ファイル構成

`packages/ui/src/`:

| ファイル                                                         | 責務                                                                                                      |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `text-field.tsx` / `text-area.tsx` / `select.tsx` / `checkbox.tsx` / `checkbox-group.tsx` / `rich-text-editor.tsx` | 変更。`isReadOnly`(R2)。`select.tsx` は `size="sm"`(28px)も足す                                           |
| `page-header.tsx`                                                | 変更。見出しの右の補足 `meta`(最終更新・閲覧のみ)                                                           |
| `tabs.tsx`                                                       | 変更。タブの並びを横スクロール(狭い画面)                                                                    |
| `index.ts`                                                       | 変更なし(export は既存)                                                                                    |

`apps/admin/src/`:

| ファイル                                           | 責務                                                                                                                       |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `lib/labels.ts`                                    | 変更。公開ボックス・トースト・ダイアログ・一覧・一括操作の文言                                                               |
| `lib/publish-box.ts`                               | 新規。公開ボックスの状態→ボタン・注記の決定(純関数)                                                                          |
| `lib/content-list.ts`                              | 変更。`runBulk` の中止(`signal`)と `skipped`、ページ送りの番号 `pageWindow`、絞り込みの説明文 `describeFilters`              |
| `lib/use-bulk-action.ts`                           | 新規。一括操作の進捗・中止・失敗の再試行を持つフック                                                                         |
| `lib/record-form-values.ts`                        | 変更。`isDraftDirty`                                                                                                       |
| `lib/navigation.ts`                                | 変更。`NavEntry.exact`(V2 持ち越し 3)                                                                                      |
| `components/record-form.tsx`                       | 書き換え。送信ボタン無し、`RecordFormHandle`、`onDirtyChange`、`isReadOnly`、`label` / `description`、新しい競合ダイアログ |
| `components/conflict-dialog.tsx`                   | 書き換え。`ModalDialog` 版(R10)                                                                                            |
| `components/asset-picker.tsx` / `asset-thumb.tsx`  | 変更。`AssetSelectDialog` を `ModalDialog` に、旧トークンの置き換え、`isReadOnly`                                            |
| `components/publication-badge.tsx`                 | 新規。公開状態のバッジ(一覧と公開ボックスで共用)とステータスのバッジ                                                         |
| `components/publish-box.tsx`                       | 新規。公開ボックス(描くだけ)と狭い画面の下部固定バー                                                                        |
| `components/record-editor.tsx`                     | 新規。作成・編集画面の合成(フォーム + ボックス + ダイアログ + トースト + スロット)                                             |
| `components/content-table.tsx`                     | 新規。一覧の表(選択・並べ替え・行の操作・失敗の印)                                                                           |
| `components/list-filters.tsx`                      | 新規。ステータスの絞り込みと検索欄                                                                                           |
| `components/list-pagination.tsx`                   | 新規。1 ページの件数・範囲・ページ送り                                                                                       |
| `components/bulk-bar.tsx`                          | 新規。選択時のバー、メニュー、進捗、一部失敗                                                                                 |
| `components/publish-toolbar.tsx` / `status-control.tsx` / `publication-panel.tsx` | 削除                                                                                                      |
| `components/tenant-page-header.tsx`                | 変更。`PageLoading` の読み上げ(R24)、文言の `labels.ts` 化                                                                   |
| `components/shell/sidebar.tsx` / `top-bar.tsx`     | 変更(V2 持ち越し 2・4)                                                                                                     |
| `routes/t/$tenantSlug/content/$typeKey/index.tsx`  | 書き換え。一覧(URL クエリ、タブ、絞り込み、表、一括操作、空状態)                                                              |
| `routes/t/$tenantSlug/content/$typeKey/new.tsx`    | 書き換え。`RecordEditor record={null}`、作成後の URL 置き換え                                                               |
| `routes/t/$tenantSlug/content/$typeKey/$recordId.tsx` | 書き換え。`RecordEditor record={record}`                                                                                  |
| `routes/t/$tenantSlug/route.tsx` / `routes/tenants.tsx` | 変更(V2 持ち越し 5・6)                                                                                                    |
| `router.tsx`                                       | 変更。コアのスロット登録を削除                                                                                               |
| `styles.css`                                       | 変更。行の操作のホバー表示(R19)                                                                                             |
| `test-utils/records-harness.tsx`                   | 新規。record 系 router テストの共通の下地                                                                                    |

`apps/e2e/helpers/setup.ts` と 2 spec: 新しい導線に合わせる。`docs/admin-ux/{c,d,h,e}-*.md`: 裁定の書き戻し。`.design-sync/NOTES.md`: 部品の変更の記録。

## タスクの依存

Task 1(設計書)→ Task 2(V2 持ち越し)→ Task 3(ui の部品)→ Task 4(文言と公開ボックスの純関数)・Task 5(一覧の純関数とフック)→ Task 6(RecordForm)→ Task 7(PublishBox 部品)→ Task 8(RecordEditor とルート)→ Task 9(編集画面のダイアログ)→ Task 10(一覧の部品)→ Task 11(一覧のルート)→ Task 12(一括操作)→ Task 13(E2E)→ Task 14(検証・同期・preview)。Task 4 と 5 は互いに独立。Task 10 は Task 5 の後なら Task 6〜9 と並行できる。

---

### Task 1: 設計書へ V3 の裁定を書き戻す

**Files:**
- Modify: `docs/admin-ux/c-publish-box.md`(2・3・4・5・6・7・9・10・13 章)
- Modify: `docs/admin-ux/d-content-list.md`(3.2・5・6・8・9・10・11 章)
- Modify: `docs/admin-ux/h-common-surface.md`(3 章、14 章)
- Modify: `docs/admin-ux/e-content-type-design.md`(4 章の実装状況に 1 行)

- [ ] **Step 1: c-publish-box.md に裁定台帳の R1・R6〜R12・R21・R22 を書く**

各章に「(2026-10-20、V3)」付きで 1〜2 文ずつ足し、既存の文は消さない。5 章の「下書き [変更]」は 2 章の 28px のセレクトに揃える(R6)。4 章の失敗表の「既存の競合ダイアログ」は「競合ダイアログ(本章後段)」に改める。13 章 決定ログに 1 行: 「2026-10-20: V3 の計画で R1・R6〜R12・R21・R22(台帳は `docs/superpowers/plans/2026-10-20-admin-ux-v3-editor-and-list.md`)を確定。D2 との食い違いは設計書を優先した: 確認ダイアログの初期フォーカスはキャンセル、トーストの幅は 400px、ステータスの「変更」リンクは置かない」

- [ ] **Step 2: d-content-list.md に R3・R4・R13〜R20・R23 を書く**

10 章の未決事項から「複製」と「狭い画面での行の操作」を消し、5 章に結論を書く。11 章 決定ログに 1 行: 「2026-10-20: V3 の計画で R3・R4・R13〜R20・R23 を確定。D2 との食い違いは設計書を優先した: 一部失敗のトーストは 1 文、検索 0 件の導線は「絞り込みを解除」だけ、0 件のタブは件数バッジの地と枠を消す」

- [ ] **Step 3: h-common-surface.md と e-content-type-design.md を直す**

h 3 章の部品表の下に「V3(2026-10-20): 入力部品に `isReadOnly`(閲覧者の読み取り専用表示)、`Select` に `size="sm"`、`PageHeader` に `meta`(見出しの右の補足)を足した。表の中のリンクは RAC の `Link` を admin から直接使う(R23)」。14 章 決定ログに 1 行。e 4 章の実装状況の表(あれば)に「作成・編集画面(案 C): V3 でフィールドの `label` / `description` を使う」。

- [ ] **Step 4: コミット**

```bash
git add docs/admin-ux
git commit -m "docs: V3(編集と一覧)の裁定を案 C・案 D・案 H・案 E の設計書に書き戻す"
```

---

### Task 2: V2 からの持ち越し(軽微な修正 8 点)

**Files:**
- Modify: `apps/admin/src/shell.test.tsx:279,298`(1)
- Modify: `apps/admin/src/components/shell/sidebar.tsx:175-230`、`apps/admin/src/components/shell/nav-link.tsx`(2)
- Modify: `apps/admin/src/lib/navigation.ts:53-72`、`apps/admin/src/lib/navigation.test.ts`、`sidebar.tsx`(3)
- Modify: `apps/admin/src/components/shell/top-bar.tsx`(4)
- Modify: `apps/admin/src/lib/labels.ts`、`routes/t/$tenantSlug/route.tsx:173`、`routes/tenants.tsx:154`、`components/tenant-page-header.tsx`(5・8)
- Modify: `apps/admin/src/routes/tenants.tsx:167`(6)
- Modify: `packages/ui/src/drawer.test.tsx:28`(7)
- Test: `apps/admin/src/lib/navigation.test.ts`、`apps/admin/src/components/shell/sidebar.test.tsx`、`apps/admin/src/shell.test.tsx`

**Interfaces:**
- Produces: `NavEntry.exact?: boolean`(`activeNavKey` は `exact` の項目を `pathname === href` のときだけ当てる)。`NavLink` / `NavChildLink` の `isCurrent` は `boolean | "ancestor"` になり、`"ancestor"` は `aria-current="true"`。`NAV_LABELS.menu = "メニュー"`、`SITE_SELECT.descriptionWithoutEmail(count)`、`LOADING_LABEL = "読み込み中"`。`PageLoading` は R24 の形

- [ ] **Step 1: 失敗するテストを書く**

`navigation.test.ts`:

```ts
it("exact の項目は前方一致しない(同期前にホームが現在地にならない)", () => {
  const entries = [
    { key: "home", href: "/t/blog", exact: true },
    { key: "type:article", href: "/t/blog/content/article" },
  ];
  expect(activeNavKey(entries, "/t/blog/content/article")).toBe("type:article");
  expect(activeNavKey(entries, "/t/blog/media")).toBeNull();
  expect(activeNavKey(entries, "/t/blog")).toBe("home");
});
```

`sidebar.test.tsx`:

```ts
it("一覧が現在地のとき親の型は aria-current=true、子の一覧は page", () => {
  // 既存の描画ヘルパーで pathname を /t/blog/content/article にして描く
  expect(screen.getByRole("link", { name: "記事" })).toHaveAttribute("aria-current", "true");
  expect(screen.getByRole("link", { name: "一覧" })).toHaveAttribute("aria-current", "page");
});
```

`shell.test.tsx` 279・298 行: `document.body.style.overflow` → `document.documentElement.style.overflow`。

- [ ] **Step 2: テストが失敗することを確かめる**

Run: `corepack pnpm --filter @plyrs/admin exec vitest run src/lib/navigation.test.ts src/components/shell/sidebar.test.tsx`
Expected: FAIL(exact が無視される、aria-current が両方 page)

- [ ] **Step 3: 実装する**

- `navigation.ts`: `NavEntry` に `exact?: boolean`、`activeNavKey` で `exact === true` なら `pathname === entry.href` のみ。`sidebar.tsx` のホームの項目に `exact: true`
- `sidebar.tsx`: 型の親リンクは `isCurrent={isActive ? (pathname === entry.href ? true : "ancestor") : false}`。`nav-link.tsx` は `isCurrent === "ancestor"` のとき `aria-current="true"`、塗りは `true` のときだけ
- `top-bar.tsx`: `position: "sticky", top: 0, zIndex: layer.dropdown`
- `labels.ts` に `NAV_LABELS.menu`、`SITE_SELECT.descriptionWithoutEmail`、`LOADING_LABEL` を足し、直書きを置き換える
- `tenants.tsx`: バッジの色は `can(tenant.role, "member:manage") ? "accent" : "neutral"`(`isRole` で絞ってから)
- `drawer.test.tsx` 28 行: `dialog.parentElement?.parentElement` の代わりに、RAC の `Overlay` が `body` に足すポータル(`[data-overlay-container]`)の直下の要素が `ModalOverlay`(暗幕)なので、`document.querySelector("[data-overlay-container] > [data-rac]")` で取り、無ければ throw する(`className` を渡すと RAC の既定クラス `react-aria-ModalOverlay` は付かないため、クラス名では探さない)。これで通らなければ現状のまま残し、報告に「未対応」と書く
- `tenant-page-header.tsx`: R24

- [ ] **Step 4: テストが通ることを確かめる**

Run: `corepack pnpm --filter @plyrs/admin exec vitest run src/lib/navigation.test.ts src/components/shell src/shell.test.tsx src/shell-drawer-same-url.test.tsx src/shell-drawer-resize.test.tsx src/records-flow.test.tsx && corepack pnpm --filter @plyrs/ui exec vitest run src/drawer.test.tsx`
Expected: PASS(`records-flow.test.tsx` の「読み込み中」の断言は R24 に合わせて `findByRole("heading", { level: 1, name: "読み込み中" })` に直す)

- [ ] **Step 5: コミット**

```bash
git add apps/admin/src packages/ui/src/drawer.test.tsx
git commit -m "fix(admin): V2 の最終レビューで持ち越した軽微な指摘を直す"
```

---

### Task 3: ui の入力部品に isReadOnly、Select に size、PageHeader に meta、Tabs の横スクロール

**Files:**
- Modify: `packages/ui/src/text-field.tsx`、`text-area.tsx`、`select.tsx`、`checkbox.tsx`、`checkbox-group.tsx`、`rich-text-editor.tsx`、`page-header.tsx`、`tabs.tsx`
- Test: `packages/ui/src/text-field.test.tsx`、`text-area.test.tsx`、`select.test.tsx`、`checkbox.test.tsx`、`rich-text-editor.test.tsx`、`page-header.test.tsx`

**Interfaces:**
- Produces:
  - `TextFieldProps.isReadOnly?: boolean`(RAC の `isReadOnly` をそのまま。見た目: 枠線を消し下罫線 `border.default` だけ、地は透明、`padding-inline: 0`)。`TextAreaProps.isReadOnly`、`CheckboxProps.isReadOnly`、`CheckboxGroupProps.isReadOnly`(RAC の `isReadOnly`。チェックの箱はそのまま、カーソルは default)
  - `SelectProps.isReadOnly?: boolean`: RAC の `Select` に `isReadOnly` が無いため、`isReadOnly` のときはトリガーの代わりに選択中の文字(無ければ `placeholder`)を `<span>` で下罫線付きに描き、`<input hidden>` も出さない。`SelectProps.size?: "md" | "sm"`(`sm` は高さ `size.controlSm`、文字 `font.caption`、`padding-inline: space.sm`)
  - `RichTextEditorProps.isReadOnly?: boolean`: Tiptap の `editable: false`、ツールバーを描かず、枠線を外して下罫線だけ。`onRequestAssetImage` は無視
  - `PageHeaderProps.meta?: ReactNode`: 見出しの右(`actions` の左)に `font.caption` / `text.muted` で描く。`hasActions` の判定に含める
  - `Tabs`: `TabList` に `overflowX: "auto"`、各 `Tab` に `flexShrink: 0`

- [ ] **Step 1: 失敗するテストを書く**

```ts
// text-field.test.tsx
it("isReadOnly は入力を受け付けず readonly 属性を持つ", async () => {
  render(<TextField label="タイトル" value="初期値" onChange={() => {}} isReadOnly />);
  const input = screen.getByRole("textbox", { name: "タイトル" });
  expect(input).toHaveAttribute("readonly");
  await userEvent.setup().type(input, "x");
  expect(input).toHaveValue("初期値");
});
// select.test.tsx
it("isReadOnly は選択中の文字だけを出し、ボタンを出さない", () => {
  render(<Select label="ステータス" items={[{ value: "draft", label: "下書き" }]} selectedValue="draft" onChange={() => {}} isReadOnly />);
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
  expect(screen.getByText("下書き")).toBeInTheDocument();
});
// rich-text-editor.test.tsx
it("isReadOnly はツールバーを出さず編集できない", async () => {
  let editor: Editor | undefined;
  render(<RichTextEditor label="本文" value={undefined} onChange={() => {}} isReadOnly onEditorReady={(e) => { editor = e; }} />);
  await vi.waitFor(() => expect(editor).toBeDefined());
  expect(screen.queryByRole("toolbar")).not.toBeInTheDocument();
  expect(editor?.isEditable).toBe(false);
});
// page-header.test.tsx
it("meta を見出しの右に出す", () => {
  render(<PageHeader title="お知らせを編集" meta={<span>最終更新 10 分前</span>} />);
  expect(screen.getByText("最終更新 10 分前")).toBeInTheDocument();
});
```

`TextArea` / `Checkbox` / `CheckboxGroup` も `readonly` 属性(Checkbox は `aria-readonly`)の断言を 1 本ずつ。

- [ ] **Step 2: テストが失敗することを確かめる**

Run: `corepack pnpm --filter @plyrs/ui exec vitest run src/text-field.test.tsx src/select.test.tsx src/rich-text-editor.test.tsx src/page-header.test.tsx src/text-area.test.tsx src/checkbox.test.tsx`
Expected: FAIL

- [ ] **Step 3: 実装する**

既存のツールバーの `role="toolbar"` が無ければ足す(`aria-label="書式"`)。

- [ ] **Step 4: テストが通ることを確かめる**

Run: `corepack pnpm --filter @plyrs/ui exec vitest run && corepack pnpm -r typecheck`
Expected: PASS

- [ ] **Step 5: `.design-sync/NOTES.md` の「V3 で変えた部品」に列挙してコミット**

```bash
git add packages/ui .design-sync/NOTES.md
git commit -m "feat(ui): 入力部品に isReadOnly、Select に size、PageHeader に meta を足す"
```

---

### Task 4: 文言と公開ボックスの純関数

**Files:**
- Modify: `apps/admin/src/lib/labels.ts`、`apps/admin/src/lib/labels.test.ts`
- Create: `apps/admin/src/lib/publish-box.ts`
- Test: `apps/admin/src/lib/publish-box.test.ts`

**Interfaces:**
- Produces(`labels.ts`。値は H 4 章・C 各章・D2 の原文):

```ts
export const PUBLISH_BOX = {
  title: "公開", state: "状態", status: "ステータス", actionsRegion: "公開の操作",
  notSaved: "まだ保存されていません", loading: "公開状態を確認しています…",
  publishedAt: (absolute: string) => `${absolute} に公開`,
  changed: "未反映の変更があります", unsaved: "未保存の変更があります",
  publish: "公開", update: "更新", saveDraft: "下書き保存", saveWithoutPublish: "公開せずに保存", save: "保存",
  unpublish: "公開を取り下げ", delete: "削除",
  offlineReason: "接続が切れているため公開できません",
  offlineNote: (secondary: string | null) =>
    secondary === null ? "接続が回復すると公開できます" : `接続が回復すると公開できます。「${secondary}」はこの端末に保存され、再接続後に送信されます`,
  readOnly: "閲覧のみ", lastUpdated: (text: string) => `最終更新 ${text}`,
} as const;
export const EDITOR_LABELS = {
  editTitle: (type: string) => `${type}を編集`, viewTitle: (type: string) => `${type}を表示`, addTitle: (type: string) => `${type}を追加`,
  crumbEdit: "編集", crumbView: "表示", crumbNew: "新規追加",
  unknownType: (key: string) => `${TERMS.contentType}が見つかりません: ${key}`,
  notFound: "見つかりませんでした。削除された可能性があります",
} as const;
export const TOASTS = {
  saved: "保存しました", published: "公開しました", updated: "更新しました",
  unpublished: "公開を取り下げました", deleted: "削除しました", statusChanged: "ステータスを変更しました",
  saveFailed: "保存できませんでした。接続を確認して、もう一度お試しください",
  publishFailed: "保存しましたが、公開できませんでした。接続を確認して、もう一度お試しください",
  retryPublish: "公開を再試行",
  unpublishFailed: "公開を取り下げられませんでした。接続を確認して、もう一度お試しください",
  deleteFailed: "削除できませんでした。接続を確認して、もう一度お試しください",
  statusFailed: "ステータスを変更できませんでした。接続を確認して、もう一度お試しください",
} as const;
export const DIALOGS = {
  delete: { title: (type: string) => `${type}を削除しますか？`, body: (title: string) => `「${title}」を削除します。元に戻せません。`,
    publishedWarning: (type: string) => `この${type}は公開中です。削除するとサイトからも消え、公開ページは表示できなくなります`, confirm: "削除する" },
  unpublish: { title: "公開を取り下げますか？", body: (title: string) => `「${title}」がサイトから見えなくなります。内容は下書きとして残り、あとから再び公開できます。`, confirm: "公開を取り下げる" },
  archivePublished: { title: "公開したままアーカイブしますか？", body: (type: string) => `この${type}はまだ公開中です。アーカイブしても公開は維持されます。先に「公開を取り下げ」を行うことをおすすめします。`, confirm: "公開したままアーカイブする" },
  leave: { title: "保存していない変更があります", body: "このまま移動すると、本文とタイトルの変更は失われます。", stay: "編集を続ける", discard: "破棄して移動" },
  conflict: { title: "本文が他の人の編集と重なりました",
    body: (savedAgo: string) => `ほかの人が ${savedAgo} に同じ本文を保存しました。どちらを残すか選んでください。他のフィールドは自動で統合済みです。公開はまだ行っていません。`,
    mine: "あなたの編集(この端末)", mineNote: "未保存", theirs: "ほかの人の編集", theirsNote: (savedAgo: string) => `${savedAgo} に保存`,
    keepMine: "あなたの編集を残す", adoptTheirs: "ほかの人の編集を取り込む", later: "あとで決める" },
  cancel: "キャンセル",
} as const;
export const LIST_LABELS = {
  tabs: { all: "すべて", published: "公開中", "unpublished-changes": "未反映の変更あり", unpublished: "未公開", archived: "アーカイブ" } satisfies Record<ListTab, string>,
  tabsName: "公開状態", statusFilter: "ステータス", statusAll: "すべて", search: "タイトルで検索",
  columns: { title: "タイトル", publication: "公開", status: "ステータス", updated: "更新" },
  changedShort: "公開中・未反映", changedLong: "公開中・未反映の変更あり",
  rowActions: { edit: "編集", view: "表示", delete: "削除" }, failed: "失敗",
  empty: { title: (type: string) => `${type}はまだありません`, description: (type: string) => `追加した${type}はここに一覧で表示され、公開するとサイトに載ります` },
  noResults: { title: (q: string, type: string) => (q === "" ? `条件に一致する${type}はありません` : `「${q}」に一致する${type}はありません`),
    description: (filters: string) => `${filters}で絞り込んでいます。別の言葉で検索するか、絞り込みを解除してください`, clear: "絞り込みを解除" },
  perPage: (n: number) => `1 ページ ${n} 件`, perPageLabel: "1 ページの件数",
  range: (total: number, from: number, to: number) => `${total} 件中 ${from}〜${to} 件`,
  pager: "ページ送り", prev: "前のページ", next: "次のページ", page: (n: number) => `${n} ページ目`,
  readOnly: "閲覧のみ", publicationsFailed: "公開状態を取得できませんでした", retry: "再試行",
} as const;
export const BULK_LABELS = {
  region: "一括操作", menu: "一括操作", selected: (n: number) => `${n} 件を選択中`, failedNote: "(失敗したもの)",
  selectPage: (n: number) => `このページの ${n} 件を選択`, clear: "選択を解除",
  actions: { publish: "公開", unpublish: "公開を取り下げ", status: "ステータスを変更", delete: "削除" },
  running: { publish: "公開しています…", unpublish: "公開を取り下げています…", status: "ステータスを変更しています…", delete: "削除しています…" },
  progress: (done: number, total: number) => `${done} / ${total} 件`, cancel: "残りを中止",
  retry: { publish: "公開をもう一度試す", unpublish: "取り下げをもう一度試す", status: "変更をもう一度試す", delete: "削除をもう一度試す" },
  done: { publish: "公開しました", unpublish: "公開を取り下げました", status: "ステータスを変更しました", delete: "削除しました" },
  failed: { publish: "公開できませんでした", unpublish: "公開を取り下げられませんでした", status: "ステータスを変更できませんでした", delete: "削除できませんでした" },
  confirmDelete: { title: (n: number, type: string) => `${n} 件の${type}を削除しますか？`, body: "元に戻せません。公開中のものはサイトからも消え、公開ページは表示できなくなります。" },
  confirmUnpublish: { title: (n: number) => `${n} 件の公開を取り下げますか？`, body: "サイトから見えなくなります。内容は下書きとして残り、あとから再び公開できます。" },
} as const;
```

- Produces(`publish-box.ts`):

```ts
export interface PublishBoxInput {
  isNew: boolean;
  isAsset: boolean;
  /** undefined = 取得前(新規・asset では常に undefined) */
  publication: PublicationState | undefined;
  recordVersion: number;
  dirty: boolean;
  connected: boolean;
  canWrite: boolean;
  canPublish: boolean;
  canDelete: boolean;
  phase: SaveAndPublishPhase | "deleting";
}
export type PublishBoxButtonKind = "publish" | "update" | "save-draft" | "save-without-publish" | "save";
export interface PublishBoxButton { kind: PublishBoxButtonKind; label: string; isDisabled: boolean; disabledReason: string | undefined }
export type PublishBoxState =
  | { kind: "new" } | { kind: "loading" } | { kind: "unpublished" } | { kind: "asset" }
  | { kind: "published"; publishedAt: string; changed: boolean };
export interface PublishBoxView {
  readOnly: boolean;            // canWrite が false
  state: PublishBoxState;
  notes: { changed: boolean; unsaved: boolean };
  primary: PublishBoxButton | null;
  secondary: PublishBoxButton | null;
  showStatus: boolean;          // asset では false
  showUnpublish: boolean;
  showDelete: boolean;
  offlineNote: string | null;
}
export function publishBoxView(input: PublishBoxInput): PublishBoxView;
```

決定の規則(C 3 章の表 + R7・R8・R9・R21): `changed = publication?.published === true && recordVersion > publication.sourceVersion`。`notes.changed = changed`(閲覧者も)。`notes.unsaved = dirty && !isNew`(R7)。`readOnly` なら primary / secondary は null、`showUnpublish` / `showDelete` は false、`showStatus = !isAsset`。asset: primary = `save`(`isDisabled: !dirty || phase !== "idle"`)、secondary null、`showStatus` false、`state.kind = "asset"`、`showDelete = canDelete && !isNew`。new / unpublished: primary = `publish`、secondary = `save-draft`。loading: unpublished と同じで primary は `isDisabled`。published: primary = `update`(`isDisabled: !(changed || dirty)`、R21)、secondary = `(changed || dirty) ? save-without-publish : null`、`showUnpublish = canPublish`。`canPublish` が false なら primary は null。`!connected` なら primary は `isDisabled` + `disabledReason = offlineReason`、`offlineNote = offlineNote(secondary?.label ?? null)`(asset は影響なし)。`phase !== "idle"` なら両方 `isDisabled`。`showDelete = canDelete && !isNew`

- [ ] **Step 1: 失敗するテストを書く**

`publish-box.test.ts` に C 3 章の表の 4 行 + 新規 + 切断中 + 閲覧者 + asset + loading の 9 本(`it.each` でよい)。例:

```ts
it("公開中・未反映なし・未編集は更新が無効で補助ボタンが無い", () => {
  const view = publishBoxView({ ...base, publication: { published: true, publishedAt: "2026-10-17T01:00:00Z", publishedBy: "u1", sourceVersion: 3 }, recordVersion: 3, dirty: false });
  expect(view.primary).toMatchObject({ kind: "update", label: "更新", isDisabled: true, disabledReason: undefined });
  expect(view.secondary).toBeNull();
  expect(view.showUnpublish).toBe(true);
  expect(view.showDelete).toBe(true);
});
it("切断中は公開が無効で理由と注記が付き、下書き保存は押せる", () => {
  const view = publishBoxView({ ...base, publication: { published: false }, connected: false });
  expect(view.primary).toMatchObject({ isDisabled: true, disabledReason: "接続が切れているため公開できません" });
  expect(view.secondary).toMatchObject({ kind: "save-draft", isDisabled: false });
  expect(view.offlineNote).toBe("接続が回復すると公開できます。「下書き保存」はこの端末に保存され、再接続後に送信されます");
});
```

`labels.test.ts`: `LIST_LABELS.tabs` が `LIST_TABS` を網羅する(`Object.keys` の一致)、`BULK_LABELS.running` / `retry` / `done` / `failed` のキーが一致する。

- [ ] **Step 2: テストが失敗することを確かめる**

Run: `corepack pnpm --filter @plyrs/admin exec vitest run src/lib/publish-box.test.ts src/lib/labels.test.ts`
Expected: FAIL(モジュールが無い)

- [ ] **Step 3: 実装する**

- [ ] **Step 4: テストが通ることを確かめる**

Run: `corepack pnpm --filter @plyrs/admin exec vitest run src/lib/publish-box.test.ts src/lib/labels.test.ts`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add apps/admin/src/lib/labels.ts apps/admin/src/lib/labels.test.ts apps/admin/src/lib/publish-box.ts apps/admin/src/lib/publish-box.test.ts
git commit -m "feat(admin): 公開ボックスの状態判定と V3 の文言を足す"
```

---

### Task 5: 一覧の純関数の拡張と一括操作のフック

**Files:**
- Modify: `apps/admin/src/lib/content-list.ts`、`apps/admin/src/lib/content-list.test.ts`
- Create: `apps/admin/src/lib/use-bulk-action.ts`
- Test: `apps/admin/src/lib/use-bulk-action.test.tsx`

**Interfaces:**
- Produces(`content-list.ts`):

```ts
export interface BulkResult { succeeded: string[]; failed: { id: string; cause: unknown }[]; skipped: string[] }
export interface RunBulkOptions { onProgress?: (done: number, total: number) => void; signal?: AbortSignal }
export function runBulk(ids: readonly string[], action: (id: string) => Promise<void>, options?: RunBulkOptions): Promise<BulkResult>;
// 中止: 実行中の 1 件は待ち、残りを skipped にする(処理済みは戻さない。D2 L3)
export type PageItem = number | "gap";
// 7 枠に収める: pageCount <= 7 なら全部。それ以外は 1、末尾、現在 ±1 を出し、間は "gap"(隣接なら数字)
export function pageWindow(page: number, pageCount: number): PageItem[];
// 検索 0 件の説明文の「{タブ}・ステータス「{値}」」の部分。タブが all でステータス未指定なら ""
export function describeFilters(query: Pick<ListQuery, "tab" | "status">, labels: { tabs: Record<ListTab, string>; statuses: Record<ListStatus, string>; statusLabel: string }): string;
```

- Produces(`use-bulk-action.ts`):

```ts
export type BulkKind = "publish" | "unpublish" | "status" | "delete";
export interface BulkProgress { kind: BulkKind; done: number; total: number }
export interface BulkFailure { kind: BulkKind; ids: string[] }
export interface BulkActionState {
  progress: BulkProgress | null;         // 実行中
  failure: BulkFailure | null;           // 直近の一部失敗(次の実行で消える)
  run: (kind: BulkKind, ids: readonly string[], action: (id: string) => Promise<void>) => Promise<BulkResult>;
  cancel: () => void;                    // 残りを中止
  retry: () => Promise<BulkResult> | null; // failure の ids で同じ action を再実行
}
export function useBulkAction(): BulkActionState;
export function bulkResultMessage(kind: BulkKind, result: BulkResult): { tone: "success" | "danger"; title: string };
// 例: 全成功 → success「8 件を公開しました」、一部失敗 → danger「8 件を公開しました。2 件は公開できませんでした」、全失敗 → danger「2 件は公開できませんでした」。skipped は数えない
```

実行中に `run` が呼ばれたら実行中の Promise を返す(二重実行しない)。

- [ ] **Step 1: 失敗するテストを書く**

```ts
// content-list.test.ts
it("runBulk は signal の中止で残りを skipped にし、処理済みは戻さない", async () => {
  const controller = new AbortController();
  const calls: string[] = [];
  const result = await runBulk(["a", "b", "c"], async (id) => { calls.push(id); if (id === "a") controller.abort(); }, { signal: controller.signal });
  expect(calls).toEqual(["a"]);
  expect(result).toEqual({ succeeded: ["a"], failed: [], skipped: ["b", "c"] });
});
it.each([
  [1, 1, [1]], [3, 7, [1, 2, 3, 4, 5, 6, 7]], [1, 10, [1, 2, "gap", 10]], [5, 10, [1, "gap", 4, 5, 6, "gap", 10]], [10, 10, [1, "gap", 9, 10]],
])("pageWindow(%i, %i)", (page, pageCount, expected) => { expect(pageWindow(page, pageCount)).toEqual(expected); });
// use-bulk-action.test.tsx(renderHook)
it("一部失敗を failure に残し、retry は失敗分だけを呼ぶ", async () => {
  const { result } = renderHook(() => useBulkAction());
  const action = vi.fn(async (id: string) => { if (id === "b") throw new Error("x"); });
  await act(() => result.current.run("publish", ["a", "b"], action));
  expect(result.current.failure).toEqual({ kind: "publish", ids: ["b"] });
  action.mockClear();
  await act(async () => { await result.current.retry(); });
  expect(action.mock.calls.map(([id]) => id)).toEqual(["b"]);
});
```

- [ ] **Step 2: テストが失敗することを確かめる**

Run: `corepack pnpm --filter @plyrs/admin exec vitest run src/lib/content-list.test.ts src/lib/use-bulk-action.test.tsx`
Expected: FAIL

- [ ] **Step 3: 実装する**

`runBulk` の既存の呼び出し(テストのみ)を新しいシグネチャに直す。

- [ ] **Step 4: テストが通ることを確かめる**

Run: `corepack pnpm --filter @plyrs/admin exec vitest run src/lib/content-list.test.ts src/lib/use-bulk-action.test.tsx`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add apps/admin/src/lib/content-list.ts apps/admin/src/lib/content-list.test.ts apps/admin/src/lib/use-bulk-action.ts apps/admin/src/lib/use-bulk-action.test.tsx
git commit -m "feat(admin): 一括操作の中止と再試行、ページ送りの番号の純関数を足す"
```

---

### Task 6: RecordForm を公開ボックスから駆動できる形にする

**Files:**
- Modify: `apps/admin/src/components/record-form.tsx`、`apps/admin/src/components/record-form.test.tsx`
- Modify: `apps/admin/src/components/conflict-dialog.tsx`
- Modify: `apps/admin/src/components/asset-picker.tsx`、`apps/admin/src/components/asset-thumb.tsx`
- Modify: `apps/admin/src/lib/record-form-values.ts`、`apps/admin/src/lib/record-form-values.test.ts`
- Modify: `apps/admin/src/richtext-flow.test.tsx`、`apps/admin/src/asset-flow.test.tsx`(送信ボタンの変更に追従。Task 8 で最終的に通す)

**Interfaces:**
- Consumes: Task 3 の `isReadOnly`、Task 4 の `DIALOGS.conflict`、`formatDateTime`
- Produces:

```ts
// record-form-values.ts
export function isDraftDirty(initial: DraftValues, current: DraftValues): boolean; // 両方のキーの和集合で draftValueEquals
// record-form.tsx
export class SaveDeferredError extends Error {} // 競合で「あとで決める」「取り込む」を選んだ(保存は完了していない。呼び出し側は通知しない)
export interface RecordFormHandle {
  /** 変換と検証。エラーがあればフィールドに表示し、最初のエラーへスクロールして false */
  validate(): boolean;
  /** 検証 → onSubmit → dirty の基準を進める。競合は本文のダイアログで解決し、「残す」なら再送して成功、それ以外は SaveDeferredError を投げる。他の失敗は cause をそのまま投げる */
  save(): Promise<void>;
}
export interface RecordFormProps {
  contentType; types; registry; record: SyncRecord | null; assets?: AssetServices | undefined;
  onSubmit: (input: Record<string, unknown>) => Promise<void>;
  onDirtyChange: (dirty: boolean) => void;
  isReadOnly?: boolean;
  /** 画面側のフォームの id。下部固定バーのボタンはこの form を送信しない(ハンドル経由) */
  ref: Ref<RecordFormHandle>;
}
```

`submitLabel` と送信ボタンは無くす(`<form>` は残し、Enter の送信は `preventDefault` だけ)。`syncErrorMessage` / `syncConflictFields` の export は無くし、`syncConflictFields` はファイル内に残す。フィールドのラベルは `field.label ?? field.key`、`description` は `TextField` / `TextArea` の `description` に渡し、それ以外の型は `FieldLabel` 下の `<p>`(`font.caption` / `text.muted`)で出す(R5)。`ConflictDialog` の新しい props: `{ isOpen: boolean; conflicts: ConflictChoice[]; theirsSavedAt: string; onKeepMine; onAdoptTheirs; onDecideLater }`(R10。`ModalDialog` の `role="dialog"`、`isDismissable={false}`、`showCloseButton={false}`、幅 760px はこの部品固有の値)。`AssetSelectDialog` は `ModalDialog`(題「メディアを選択」、`isOpen` 固定 true、`onOpenChange(false)` で `onClose`)。

- [ ] **Step 1: 失敗するテストを書く**

`record-form.test.tsx` の既存テストは送信ボタンの代わりに `ref` の `save()` を `act` で呼ぶ形に直し、次を足す:

```ts
it("onDirtyChange は入力で true、save の後に false になる", async () => { /* title を打つ → true、ref.save() → false */ });
it("validate は必須の空欄にエラーを出して false を返し、保存しない", async () => { /* onSubmit が呼ばれない */ });
it("競合で「あとで決める」を選ぶと save は SaveDeferredError を投げ、下書きは残る", async () => { /* onSubmit が conflict を reject → dialog(name: 本文が他の人の編集と重なりました)→ 「あとで決める」 → rejects.toThrow(SaveDeferredError) */ });
it("競合で「あなたの編集を残す」を選ぶと再送して save が成功する", async () => {});
it("isReadOnly は入力欄を readonly にし本文のツールバーを出さない", () => {});
it("フィールドの label と description を出す", () => { /* fields: [{ key: "title", type: "text", label: "タイトル", description: "一覧に使います" }] → textbox 名「タイトル」、文「一覧に使います」 */ });
```

- [ ] **Step 2: テストが失敗することを確かめる**

Run: `corepack pnpm --filter @plyrs/admin exec vitest run src/components/record-form.test.tsx src/lib/record-form-values.test.ts`
Expected: FAIL

- [ ] **Step 3: 実装する**

`save()` の流れ: `validate()` → `onSubmit(converted)` → 成功なら `setInitialDraft(value)`。競合(`code === "conflict"`)は `conflict` state に積み、`new Promise<"kept" | "deferred">` の resolver を ref に持ってダイアログのボタンで解決する。`kept` なら再送(`onSubmit`)して戻る。dirty の通知は `form.useStore((s) => s.values)` と `initialDraft` の `isDraftDirty` を `useEffect` で `onDirtyChange` に流す。最初のエラーへのスクロールは `form` 要素内の `[aria-invalid="true"]` の最初の要素に `scrollIntoView({ block: "center" })` と `focus()`(jsdom では `scrollIntoView` が無いので存在を確かめてから呼ぶ)。

- [ ] **Step 4: テストが通ることを確かめる**

Run: `corepack pnpm --filter @plyrs/admin exec vitest run src/components/record-form.test.tsx src/lib/record-form-values.test.ts && corepack pnpm -r typecheck`
Expected: record-form のテストは PASS。typecheck はルート(`new.tsx` / `$recordId.tsx`)が旧 props を渡しているため失敗してよいが、その 2 ファイル以外のエラーは無いこと(Task 8 で解消)

- [ ] **Step 5: コミット**

```bash
git add apps/admin/src/components/record-form.tsx apps/admin/src/components/record-form.test.tsx apps/admin/src/components/conflict-dialog.tsx apps/admin/src/components/asset-picker.tsx apps/admin/src/components/asset-thumb.tsx apps/admin/src/lib/record-form-values.ts apps/admin/src/lib/record-form-values.test.ts
git commit -m "feat(admin): RecordForm を外から保存できるハンドル付きにし、競合ダイアログをモーダルに作り直す"
```

---

### Task 7: 公開ボックスの部品

**Files:**
- Create: `apps/admin/src/components/publication-badge.tsx`
- Create: `apps/admin/src/components/publish-box.tsx`
- Test: `apps/admin/src/components/publish-box.test.tsx`、`apps/admin/src/components/publication-badge.test.tsx`

**Interfaces:**
- Consumes: Task 4 の `PublishBoxView` / `PUBLISH_BOX` / `WORKFLOW_STATUS_LABELS` / `PUBLICATION_STATE_LABELS`、Task 3 の `Select size="sm"`、ui の `Badge` / `Button` / `Skeleton`
- Produces:

```ts
// publication-badge.tsx
export function PublicationBadge({ state, short }: { state: ListPublicationState; short?: boolean }): JSX.Element;
// published → tone success dot「公開中」/ changed → warning dot「公開中・未反映の変更あり」(short なら「公開中・未反映」。short を省くと広い画面は長い文、NARROW では短い文を CSS で切り替える 2 つの span)/ unpublished → neutral dot「未公開」
export function WorkflowStatusBadge({ status }: { status: WorkflowStatus }): JSX.Element; // R16
// publish-box.tsx
export interface PublishBoxProps {
  view: PublishBoxView;
  status: WorkflowStatus;
  onPrimary: () => void; onSecondary: () => void;
  onStatusChange: (next: WorkflowStatus) => void;
  onUnpublish: () => void; onDelete: () => void;
}
export function PublishBox(props: PublishBoxProps): JSX.Element;   // <section aria-labelledby> 題「公開」(h2)
export function PublishBar(props: Pick<PublishBoxProps, "view" | "onPrimary" | "onSecondary">): JSX.Element; // 狭い画面の下部固定バー。<div role="region" aria-label="公開の操作">。NARROW 以外は display none
```

見た目(C 2 章、D2): カード `bg.surface` / `stroke.default` `border.default` / `radius.container` / `padding: space.md` / 縦 gap `space.inset`。ラベル列 64px。状態: `state.kind` が new → 「まだ保存されていません」(`text.muted`)、loading → `Skeleton`、unpublished / published → `PublicationBadge`、published は下に `publishedAt(formatAbsolute)` を `font.caption` / `text.muted`。注記: changed は `status.warning` の点 + 文、unsaved は `Pencil` + `text.default`、両方なら上下。ステータス: `showStatus` のとき `Select size="sm"`(`readOnly` のときは `isReadOnly`)。ボタン行は右寄せ(補助が左、主が右)。`view.primary.disabledReason` は `Button` の `disabledReason`。切断中の注記 `offlineNote` はボタンの下に `Info` + `font.caption` / `text.muted`。「公開を取り下げ」は `Button variant="dangerLink" size="sm"` を右寄せ、「削除」は上罫線で区切って左寄せ。`PublishBar`: `position: fixed`、`insetInline: 0`、`insetBlockEnd: 0`、`bg.raised`、上罫線、`elevation.menu`、`padding: space.inset space.md`、左に注記(両方あれば上下、R 台帳どおり設計書 2 章)、右にボタン。`zIndex: layer.dropdown`。ボタンの `kind` が同じでも DOM が 2 組あるため、テストは `within(region)` で探す。

- [ ] **Step 1: 失敗するテストを書く**

```ts
// publish-box.test.tsx(直接描画。view は publishBoxView() で作る)
it("公開中・未反映ありは「更新」と「公開せずに保存」を出し、押すと onPrimary / onSecondary", async () => {});
it("切断中の「公開」はフォーカスでき aria-disabled で、ツールチップに理由が出る", async () => { /* user.hover → tooltip「接続が切れているため公開できません」 */ });
it("閲覧者はボタン・リンク無しで状態とステータスの文字だけ", () => { /* queryByRole("button") が null、text「下書き」 */ });
it("ステータスの選択は onStatusChange に値を渡す", async () => { /* Select を開いて「レビュー中」 → "in_review" */ });
it("asset は「保存」と「削除」だけで公開状態とステータスを出さない", () => {});
// publication-badge.test.tsx
it.each([["published", "公開中"], ["changed", "公開中・未反映の変更あり"], ["unpublished", "未公開"]])("%s", (state, text) => {});
```

- [ ] **Step 2: テストが失敗することを確かめる**

Run: `corepack pnpm --filter @plyrs/admin exec vitest run src/components/publish-box.test.tsx src/components/publication-badge.test.tsx`
Expected: FAIL

- [ ] **Step 3: 実装する**

- [ ] **Step 4: テストが通ることを確かめる**

Run: `corepack pnpm --filter @plyrs/admin exec vitest run src/components/publish-box.test.tsx src/components/publication-badge.test.tsx`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add apps/admin/src/components/publish-box.tsx apps/admin/src/components/publish-box.test.tsx apps/admin/src/components/publication-badge.tsx apps/admin/src/components/publication-badge.test.tsx
git commit -m "feat(admin): 公開ボックスと公開状態のバッジの部品を足す"
```

---

### Task 8: RecordEditor の合成と作成・編集のルート

**Files:**
- Create: `apps/admin/src/components/record-editor.tsx`
- Create: `apps/admin/src/test-utils/records-harness.tsx`
- Modify: `apps/admin/src/routes/t/$tenantSlug/content/$typeKey/new.tsx`、`$recordId.tsx`
- Modify: `apps/admin/src/router.tsx`(コアのスロット登録を削除)
- Delete: `apps/admin/src/components/publish-toolbar.tsx`、`status-control.tsx`、`publication-panel.tsx`
- Modify: `apps/admin/src/records-flow.test.tsx`、`apps/admin/src/richtext-flow.test.tsx`、`apps/admin/src/asset-flow.test.tsx`
- Delete: `apps/admin/src/publish-slots.test.tsx` → Create: `apps/admin/src/publish-box-flow.test.tsx`

**Interfaces:**
- Consumes: Task 6 の `RecordForm` / `RecordFormHandle` / `SaveDeferredError`、Task 7 の `PublishBox` / `PublishBar`、Task 4 の `publishBoxView` / `EDITOR_LABELS` / `TOASTS`、T11 の `useSaveAndPublish` / `useLeaveGuard`、`publicationQueryOptions` / `publicationsQueryKey`、`errorMessage`、`toaster`、`useCan`、`useSyncStatus`
- Produces:

```ts
export interface RecordEditorProps {
  tenantSlug: string;
  contentType: ContentTypeDefinition;
  types: ContentTypeDefinition[];
  collection: Collection<SyncRecord, string>;
  /** null = 作成画面 */
  record: SyncRecord | null;
  assets: AssetServices;
}
export function RecordEditor(props: RecordEditorProps): JSX.Element; // TenantPageHeader を含む(h1・パンくず・meta)
```

- ルート context は `getRouteApi("/t/$tenantSlug").useRouteContext()`(`tenant` / `adminApi` / `queryClient` / `slots`)。`connected = useSyncStatus(sync) === "ready"`
- h1 / パンくず(R12): 作成 → `addTitle` / home › type › 「新規追加」。編集 → `canWrite ? editTitle : viewTitle` / home › type › 「編集」or「表示」。asset 型 → home › `mediaCrumb` › 「編集」。`meta`: 編集で `record.updatedAt` の `RelativeTime`(`lastUpdated`)、閲覧者は `Lock` + 「閲覧のみ ・ 最終更新 …」(R1)
- 本文: `slots.get("record-editor:toolbar")` が 1 つ以上あればフォームの上に並べる。グリッド `minmax(0, 1fr) 300px` / gap `space.xl`、NARROW では 1 列で `PublishBox` がフォームの後ろ、本文の下余白 88px、`PublishBar` を描く。右列は `PublishBox` → `slots.get("record-editor:panel")` のカード(`h2` の題)の順
- 操作:
  - `onPrimary`: asset なら `save()`。それ以外は `saveAndPublish.run({ connected, validate: () => form.validate(), save: (isNew || dirty) ? () => saveViaForm() : undefined, publish: () => adminApi.publishRecord(tenant.id, currentId()), wasPublished })`。`saveViaForm` は `formRef.current.save()`。作成画面の `onSubmit` は `uuidv7()` で `collection.insert` → `tx.isPersisted.promise` を待ち、ID を `createdId` ref に持つ(R22)。結果: ok → `toaster.success(published / updated)`、`invalidate(publication, publications)`、作成なら `navigate({ to: $recordId, params, replace: true, ignoreBlocker: true })`。`stage: "save"` → `cause instanceof SaveDeferredError` なら何もしない、それ以外は `toaster.error(errorMessage(cause, TOASTS.saveFailed))`。`stage: "publish"` → `toaster.error(TOASTS.publishFailed, { label: TOASTS.retryPublish, icon: RotateCw, onAction: () => retryPublish(id) })`(`retryPublish` は `adminApi.publishRecord` → invalidate → 成功トースト / 失敗で同じエラートーストの閉包)、作成ならその後 URL を置き換える。`stage: "validate"` / `"offline"` → 何もしない(フィールドのエラー / 無効化で伝わっている)
  - `onSecondary`: `saveViaForm()` → `toaster.success(TOASTS.saved)`、作成なら URL を置き換える。失敗は save と同じ扱い
  - `onStatusChange(next)`: `next === "archived"` かつ公開中なら Task 9 のダイアログ。それ以外は `collection.update(id, d => { d.status = next })` → `isPersisted` → `toaster.success(statusChanged)` / `toaster.error(errorMessage(cause, statusFailed))`
  - `onUnpublish` / `onDelete`: Task 9
  - `useLeaveGuard(dirty)`: Task 9 で離脱ダイアログを描く(本タスクではフックだけ呼ぶ)
- `records-harness.tsx`: `records-flow.test.tsx` の `jsonResponse` / `stubFetch` / `authedRoutes` / `articleType` / `article()` / `socketHarness` / `bootstrapped` / `renderAt` を移し、`authedRoutes` には `/v1/t/t1/publications`(`{ publications: [], nextCursor: null }`)と `/v1/t/t1/records/:id/publication` の既定(未公開)を含める。`records-flow.test.tsx` / `publish-box-flow.test.tsx` / Task 9・11・12 のファイルがここから import する
- `router.tsx`: `slots.register(...)` の 3 行と import を消す(`createSlotRegistry` は残す)

- [ ] **Step 1: 失敗するテストを書く**

`records-flow.test.tsx`(既存を新しい導線に直す):

```ts
it("作成画面の下書き保存は insert を push し、ack の後に編集画面の URL へ置き換える", async () => { /* 「下書き保存」→ push → ack → router.state.location.pathname が /t/blog/content/article/<id>、toast「保存しました」、h1「記事を編集」 */ });
it("作成画面の公開は作成の確定後に公開し、編集画面の URL に置き換える", async () => { /* Review Focus 2: publish の fetch が ack の後に呼ばれる(vi.fn の呼び順)、URL 置き換え、toast「公開しました」 */ });
it("編集画面の「下書き保存」は変更したフィールドだけを push する", async () => { /* 既存「edits an existing record」を改名 */ });
it("閲覧者には読み取り専用のフォームと「表示」のパンくずが出て、ボタンが無い", async () => { /* role: "viewer" → textbox readonly、region「公開」内に button 無し、breadcrumb「表示」、h1「記事を表示」 */ });
it("未保存の入力は切断をまたいで残る(§12 必須①)", ...); // 既存を維持
it("存在しない id は見つからない旨を出す", ...); it("未知の型 …", ...); // 既存を維持(文言は EDITOR_LABELS)
```

`publish-box-flow.test.tsx`(`publish-slots.test.tsx` の置き換え。モーダルを開かない):

```ts
it("未公開の「公開」は publish API を呼び、公開中のバッジと「更新」に変わる", async () => {});
it("未保存の編集がある状態の更新は、push の ack の後に publish を呼ぶ", async () => { /* Review Focus 1: title を変更 → 「更新」→ publish が未呼び出し → ack → publish が呼ばれる */ });
it("公開に失敗すると保存は残り、エラーのトーストの「公開を再試行」で公開だけをやり直す", async () => { /* publish 1 回目 500 → toast role=alert、push は 1 回。再試行 → publish 2 回目 200 → 「公開しました」 */ });
it("公開後に編集されていると「未反映の変更があります」と「公開せずに保存」が出る", async () => {});
it("切断中は「更新」が aria-disabled で「公開せずに保存」は押せる", async () => { /* socket.close(1006) 後 */ });
it("ステータスの変更は status だけを push しトーストを出す", async () => {});
it("モジュールの panel スロットは公開ボックスの下に描かれ、コアの登録は無い", async () => { /* context.slots.register(panel) → h2、slots.get("record-editor:toolbar") が [] */ });
```

- [ ] **Step 2: テストが失敗することを確かめる**

Run: `corepack pnpm --filter @plyrs/admin exec vitest run src/records-flow.test.tsx src/publish-box-flow.test.tsx`
Expected: FAIL

- [ ] **Step 3: 実装する**

`new.tsx` / `$recordId.tsx` は同期待ち・未知の型・見つからない、の分岐だけを持ち、`RecordEditor` を描く。

- [ ] **Step 4: テストが通ることを確かめる**

Run: `corepack pnpm --filter @plyrs/admin exec vitest run && corepack pnpm -r typecheck && corepack pnpm format`
Expected: PASS(`richtext-flow` / `asset-flow` は「保存」→「下書き保存」、ダイアログの role 変更に追従)。`grep -rn "core.publish\|PublishToolbar\|StatusControl\|PublicationPanel" apps/admin/src` が 0 件

- [ ] **Step 5: コミット**

```bash
git add -A apps/admin/src
git commit -m "feat(admin): 作成・編集画面を公開ボックス付きの RecordEditor に作り直す"
```

---

### Task 9: 編集画面の確認ダイアログ(削除・取り下げ・公開中のアーカイブ・離脱)

**Files:**
- Modify: `apps/admin/src/components/record-editor.tsx`
- Create: `apps/admin/src/record-delete.test.tsx`、`apps/admin/src/record-unpublish.test.tsx`、`apps/admin/src/record-archive.test.tsx`、`apps/admin/src/record-leave.test.tsx`(1 ファイル 1 本)

**Interfaces:**
- Consumes: ui の `ConfirmDialog` / `ModalDialog` / `Banner`、Task 4 の `DIALOGS`、`useLeaveGuard` の `status` / `proceed` / `reset`
- Produces: `RecordEditor` 内の 4 つのダイアログ。
  - 削除: `ConfirmDialog tone="danger"` 題 `DIALOGS.delete.title(型名)`、本文 `body(labelForRecord)` + 公開中なら `Banner tone="warning"` で `publishedWarning(型名)`、実行「削除する」。実行: `collection.delete(id)` → `isPersisted` → invalidate(publication / publications)→ `toaster.success(deleted)` → `navigate({ to: 一覧, ignoreBlocker: true })`。失敗: `toaster.error(errorMessage(cause, deleteFailed))`、ダイアログは閉じる
  - 取り下げ: `ConfirmDialog tone="danger"` 題 `unpublish.title`、本文 `unpublish.body(title)`、実行「公開を取り下げる」→ `adminApi.unpublishRecord` → invalidate → `toaster.success(unpublished)` / error
  - 公開中のアーカイブ: `ConfirmDialog tone="danger"` 題 `archivePublished.title`、本文 `archivePublished.body(型名)`、実行「公開したままアーカイブする」→ status の更新
  - 離脱: `blocker.status === "blocked"` のとき `ModalDialog role="alertdialog" isDismissable={false} showCloseButton={false}` 題 `leave.title`、本文 `leave.body`、フッター `[dangerLink 破棄して移動 → proceed()] [primary autoFocus 編集を続ける → reset()]`(R11)
  - 実行中は `ConfirmDialog` の `isPending`

- [ ] **Step 1: 失敗するテストを書く(各ファイル 1 本、開く操作は `fireEvent.click`)**

```ts
// record-delete.test.tsx
it("公開中のコンテンツの削除は警告付きの確認を経て一覧へ戻る", async () => { /* publication: published → 「削除」→ alertdialog「記事を削除しますか？」、警告文、初期フォーカスが「キャンセル」→ 「削除する」→ delete の push → ack → pathname が一覧、toast「削除しました」 */ });
// record-unpublish.test.tsx
it("公開の取り下げは確認を経て unpublish API を呼ぶ", async () => {});
// record-archive.test.tsx
it("公開中にアーカイブを選ぶと確認を経て status を push する", async () => {});
// record-leave.test.tsx
it("未保存の編集があるときの遷移は確認で止まり、「破棄して移動」で進む", async () => { /* title を打つ → router.history.push("/t/blog/media") → alertdialog「保存していない変更があります」→ 「破棄して移動」→ pathname /t/blog/media */ });
```

- [ ] **Step 2: テストが失敗することを確かめる**

Run: `corepack pnpm --filter @plyrs/admin exec vitest run src/record-delete.test.tsx src/record-unpublish.test.tsx src/record-archive.test.tsx src/record-leave.test.tsx`
Expected: FAIL

- [ ] **Step 3: 実装する**

- [ ] **Step 4: テストが通ることを確かめる**

Run: `corepack pnpm --filter @plyrs/admin exec vitest run src/record-delete.test.tsx src/record-unpublish.test.tsx src/record-archive.test.tsx src/record-leave.test.tsx src/records-flow.test.tsx src/publish-box-flow.test.tsx`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add apps/admin/src/components/record-editor.tsx apps/admin/src/record-*.test.tsx
git commit -m "feat(admin): 編集画面の削除・取り下げ・アーカイブ・離脱の確認ダイアログを揃える"
```

---

### Task 10: 一覧の部品(表・絞り込み・ページ送り・一括バー)

**Files:**
- Create: `apps/admin/src/components/content-table.tsx`、`list-filters.tsx`、`list-pagination.tsx`、`bulk-bar.tsx`
- Modify: `apps/admin/src/styles.css`(R19)
- Test: `apps/admin/src/components/content-table.test.tsx`、`list-pagination.test.tsx`、`bulk-bar.test.tsx`

**Interfaces:**
- Consumes: T12 の `ListRow` / `ListSort` / `SortOrder` / `ListStatus` / `PER_PAGE_OPTIONS`、Task 5 の `pageWindow` / `BulkKind`、Task 7 の `PublicationBadge` / `WorkflowStatusBadge`、Task 4 の `LIST_LABELS` / `BULK_LABELS`、ui の `Table` 系 / `Select` / `SearchField` / `Menu` 系 / `ProgressBar` / `Spinner` / `IconButton` / `Button` / `RelativeTime`
- Produces:

```ts
// content-table.tsx
export interface ContentTableProps {
  tenantSlug: string; typeKey: string;
  rows: readonly ListRow[];
  sort: { column: ListSort; order: SortOrder };
  onSortChange: (column: ListSort, order: SortOrder) => void;
  /** undefined = 選択列なし(閲覧者) */
  selection: { selectedKeys: ReadonlySet<string>; onSelectionChange: (keys: Set<string>) => void; isDisabled: boolean } | undefined;
  failedIds: ReadonlySet<string>;
  canWrite: boolean;
  onDelete: (row: ListRow) => void;
  now?: Date;
}
export function ContentTable(props: ContentTableProps): JSX.Element;
// RAC Table: aria-label は型名の一覧、selectionMode は selection の有無で "multiple" / "none"、選択中の全選択("all")は表示中の行の id の Set に正規化する。
// 列: title(isRowHeader, allowsSorting)/ publication / status(hideOnNarrow)/ updated(allowsSorting, hideOnNarrow)。
// タイトルのセル: RAC Link(href=編集画面)+ <div data-row-actions>(「編集」Link / 閲覧者は「表示」Link、「削除」Button dangerLink sm)。
// 公開のセル: PublicationBadge + failedIds にあれば CircleAlert +「失敗」(status.danger)。isDisabled のときは disabledKeys に全行
// list-filters.tsx
export function ListFilters({ status, q, onStatusChange, onSearchChange }: { status: ListStatus | undefined; q: string; onStatusChange: (s: ListStatus | undefined) => void; onSearchChange: (q: string) => void }): JSX.Element;
// list-pagination.tsx
export function ListPagination({ page, pageCount, total, perPage, onPageChange, onPerPageChange }: { page: number; pageCount: number; total: number; perPage: PerPage; onPageChange: (page: number) => void; onPerPageChange: (perPage: PerPage) => void }): JSX.Element;
// <nav aria-label="ページ送り">。範囲 range(total, from, to)、IconButton(ChevronLeft/Right, label prev/next, isDisabled)、pageWindow の数字は Button size="sm" variant="secondary"(現在は aria-current="page" で accent.surface)、"gap" は「…」。total 0 のときは描かない
// bulk-bar.tsx
export type BulkMenuAction = { kind: "publish" } | { kind: "unpublish" } | { kind: "status"; status: WorkflowStatus } | { kind: "delete" };
export interface BulkBarProps {
  selectedCount: number;
  pageCount: number;                 // 表示中のページの件数(「このページの N 件を選択」)
  onSelectPage: () => void; onClear: () => void;
  onAction: (action: BulkMenuAction) => void;
  progress: { kind: BulkKind; done: number; total: number; onCancel: () => void } | null;
  failure: { kind: BulkKind; onRetry: () => void } | null;
}
export function BulkBar(props: BulkBarProps): JSX.Element; // <div role="region" aria-label="一括操作">、実行中は aria-busy
```

見た目(D 6 章、D2 L2〜L4、R13・R17): `accent.surface`、`stroke.default` の `accent.default` の枠、`radius.control`、`padding: space.sm space.inset`、gap `space.inset`。「N 件を選択中」は `font.weightBold` / `accent.default`。`Menu` の trigger は `Button size="sm" variant="secondary"`「一括操作」、項目: publish(Globe)/ unpublish / `MenuSection`「ステータスを変更」に 4 状態(id `status:draft` など)/ `MenuSeparator` / delete(`tone="danger"`, Trash2)。右寄せに `Button variant="link" size="sm"` の「このページの N 件を選択」「選択を解除」。実行中: `Spinner`(`running[kind]`)+ `ProgressBar`(`label: running[kind]`、`valueLabel: progress(done, total)`、`maxWidth: 320px`)+ 「残りを中止」。一部失敗: 「N 件を選択中」+ `failedNote` + メニュー + 「{retry[kind]}」(RotateCw)+ 「選択を解除」。`styles.css`:

```css
/* R19: 行の操作はホバー / フォーカス時に出す(StyleX は子孫セレクタを書けない) */
[data-row-actions] { opacity: 0; }
tr[data-hovered] [data-row-actions], tr:focus-within [data-row-actions] { opacity: 1; }
@media (max-width: 959px) { [data-row-actions] { opacity: 1; } }
```

- [ ] **Step 1: 失敗するテストを書く(直接描画)**

```ts
// content-table.test.tsx
it("行にタイトルのリンク・公開バッジ・ステータスバッジ・相対時刻を出す", () => { /* link href が /t/blog/content/article/<id>、「公開中・未反映の変更あり」、「レビュー中」、time 要素 */ });
it("見出しのチェックで表示中の行を全選択し、Set で通知する", async () => {});
it("更新の見出しを押すと onSortChange(updated, asc)", async () => {});
it("failedIds の行の公開列に「失敗」を添える", () => {});
it("閲覧者は選択列が無く、行の操作は「表示」だけ", () => {});
// list-pagination.test.tsx
it("24 件 / 20 件で 2 ページの番号と範囲を出し、次のページで onPageChange(2)", async () => {});
it("1 ページの件数の変更は onPerPageChange(50)", async () => {});
// bulk-bar.test.tsx
it("メニューの「公開」で onAction({ kind: 'publish' })、「ステータスを変更」の「下書き」で status", async () => { /* userEvent で Menu を開く(直接描画なので開ける) */ });
it("実行中は進捗バーと「残りを中止」を出し aria-busy", () => {});
it("一部失敗は「公開をもう一度試す」を出す", async () => {});
```

- [ ] **Step 2: テストが失敗することを確かめる**

Run: `corepack pnpm --filter @plyrs/admin exec vitest run src/components/content-table.test.tsx src/components/list-pagination.test.tsx src/components/bulk-bar.test.tsx`
Expected: FAIL

- [ ] **Step 3: 実装する**

- [ ] **Step 4: テストが通ることを確かめる**

Run: `corepack pnpm --filter @plyrs/admin exec vitest run src/components && corepack pnpm -r typecheck`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add apps/admin/src/components apps/admin/src/styles.css
git commit -m "feat(admin): 一覧の表・絞り込み・ページ送り・一括操作バーの部品を足す"
```

---

### Task 11: 一覧のルート(URL クエリ、タブ、絞り込み、空状態、閲覧者)

**Files:**
- Modify: `apps/admin/src/routes/t/$tenantSlug/content/$typeKey/index.tsx`
- Modify: `apps/admin/src/records-flow.test.tsx`(一覧の既存 2 本を `content-list-flow.test.tsx` へ移す)
- Create: `apps/admin/src/content-list-flow.test.tsx`

**Interfaces:**
- Consumes: T12 の `parseListQuery` / `toListSearch` / `buildListRows` / `applyListQuery` / `DEFAULT_LIST_QUERY`、Task 5 の `describeFilters`、T5 の `publicationsQueryOptions`、Task 10 の部品、ui の `Tabs` / `EmptyState` / `Skeleton`、`labelForRecord`
- Produces: `Route` に `validateSearch: (search: Record<string, unknown>) => parseListQuery(search)`。`updateQuery(patch: Partial<ListQuery>, options?: { replace?: boolean })` は `navigate({ search: toListSearch({ ...query, ...patch }), replace })`。タブ・ステータス・検索語・並べ替え・件数の変更は `page: 1` を伴い、検索語の入力は `replace: true`。クエリが変わったら選択を解除(R18。`useEffect` で `location.search` の文字列を比較)
  - 本文の順序(D 2 章): `Tabs`(`label: LIST_LABELS.tabsName`、`items` は `LIST_TABS` に `counts`)→ `children(id)` の中に `ListFilters` → `BulkBar`(選択があるとき。Task 12)→ `ContentTable` → `ListPagination`
  - 公開状態: `useQuery(publicationsQueryOptions(adminApi, tenant.id, typeKey))`。`isPending` なら本文に `role="status"` `aria-label="読み込み中"` の `Skeleton` 3 本(見出しは通常)。`isError` なら `role="alert"` に `errorMessage(error, publicationsFailed)` と `Button`「再試行」(`refetch`)(R20)。`Map(recordId → { sourceVersion })` を `useMemo` で作り `buildListRows(rows, map, record => labelForRecord(types, record))`
  - 空状態: `rows.length === 0`(削除済みを除く全件が 0)→ タブ・絞り込み・表を出さず `EmptyState`(icon Inbox、`empty.title(型名)`、`empty.description(型名)`、`canWrite` なら `Button icon={Plus}`「{型名}を追加」)。絞り込みの結果が 0 件 → タブ・絞り込みは残し、表の代わりに `role="status"` の `EmptyState size="compact"`(icon Search、`noResults.title(q, 型名)`、`describeFilters` が空でなければ `noResults.description`、`Button variant="link"`「絞り込みを解除」→ `updateQuery(DEFAULT_LIST_QUERY)`)(R15)
  - 閲覧者: `primaryAction` 無し、`meta` に `Lock` +「閲覧のみ」、`ContentTable` の `selection` は undefined
  - `now` は描画ごとの `new Date()`(相対時刻は再描画で更新される。タイマーは置かない)

- [ ] **Step 1: 失敗するテストを書く**

```ts
// content-list-flow.test.tsx(records-harness。publications は overrides で返す)
it("タブに件数が付き、公開中タブで公開中だけを出す", async () => { /* 3 件(公開中 1・未反映 1・未公開 1)→ tab「すべて 3」「公開中 2」… → 「公開中」を押す → URL ?tab=published、行 2 */ });
it("検索語は URL の q に入り、タイトルの部分一致で絞る", async () => {});
it("ステータスの絞り込みとタブは組み合わさる", async () => {});
it("タイトルの見出しで五十音順に並べ替え、URL に sort が入る", async () => {});
it("21 件で 2 ページに分かれ、次のページで URL に page=2 が入る", async () => {});
it("範囲外の page は最後のページに寄せ、未知の tab は既定に戻す", async () => { /* Review Focus 5: /t/blog/content/article?page=99&tab=xxx → 1 ページ目相当の 20 件、tab「すべて」が選択 */ });
it("0 件は空状態だけを出し、絞り込みで 0 件はタブを残して「絞り込みを解除」を出す", async () => {});
it("公開状態の取得に失敗したら再試行を出す", async () => { /* Review Focus 4: publications 500 → alert + 「再試行」→ 200 → 表 */ });
it("閲覧者には追加ボタン・選択列が無く「閲覧のみ」が出る", async () => {});
it("更新日時は相対表記で ISO 文字列を出さない", async () => {});
```

- [ ] **Step 2: テストが失敗することを確かめる**

Run: `corepack pnpm --filter @plyrs/admin exec vitest run src/content-list-flow.test.tsx`
Expected: FAIL

- [ ] **Step 3: 実装する**

- [ ] **Step 4: テストが通ることを確かめる**

Run: `corepack pnpm --filter @plyrs/admin exec vitest run src/content-list-flow.test.tsx src/records-flow.test.tsx src/shell.test.tsx && corepack pnpm -r typecheck`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add apps/admin/src/routes apps/admin/src/content-list-flow.test.tsx apps/admin/src/records-flow.test.tsx
git commit -m "feat(admin): 一覧にタブ・絞り込み・検索・並べ替え・ページ送りを入れ URL に保持する"
```

---

### Task 12: 一括操作の配線と行の削除

**Files:**
- Modify: `apps/admin/src/routes/t/$tenantSlug/content/$typeKey/index.tsx`
- Create: `apps/admin/src/content-list-bulk.test.tsx`(`bulk-bar` を mock。モーダル無し)、`apps/admin/src/content-list-bulk-delete.test.tsx`(1 本)、`apps/admin/src/content-list-row-delete.test.tsx`(1 本)

**Interfaces:**
- Consumes: Task 5 の `useBulkAction` / `bulkResultMessage`、Task 10 の `BulkBar` / `BulkMenuAction`、ui の `ConfirmDialog`、`toaster`
- Produces(ルート内):
  - 選択 `selected: Set<string>`、`failedIds: Set<string>`(次の実行で空にする)
  - `onAction`: publish → `run("publish", ids, id => adminApi.publishRecord(tenant.id, id))`。unpublish / delete → `ConfirmDialog tone="danger"`(`BULK_LABELS.confirmUnpublish` / `confirmDelete`、実行ボタンは `DIALOGS.unpublish.confirm` / `DIALOGS.delete.confirm`)の後に `run`。status → `run("status", ids, id => collection.update(id, d => { d.status = status }).isPersisted.promise)`。delete の action は `collection.delete(id).isPersisted.promise`
  - 実行後: `invalidateQueries(publicationsQueryKey)`、`toaster[tone](title)`(`bulkResultMessage`)。`failed` があれば `selected = failed の id`、`failedIds = 同じ`。無ければ `selected` を空に。`BulkBar.failure.onRetry` は `bulk.retry()`
  - 実行中は `ContentTable.selection.isDisabled` と `BulkBar.progress`。「残りを中止」は `bulk.cancel()`
  - 行の「削除」: `ConfirmDialog`(Task 9 と同じ文言・警告)→ `collection.delete` → invalidate → `toaster.success(deleted)`

- [ ] **Step 1: 失敗するテストを書く**

```ts
// content-list-bulk.test.tsx: vi.mock("./components/bulk-bar", …) で onAction を呼ぶ素のボタン「一括公開」「一括ステータス下書き」「再試行」「解除」に差し替える
it("選んだ行を順に公開し、トーストで件数を知らせて選択を解除する", async () => { /* 2 行選択(チェックボックス)→ 「一括公開」→ publish fetch が id 順に 2 回 → toast「2 件を公開しました」→ 選択 0 */ });
it("一部が失敗すると失敗分だけを選択に残し、再試行は失敗分だけを呼ぶ", async () => { /* Review Focus 3: 2 件目 500 → toast(alert)「1 件を公開しました。1 件は公開できませんでした」、失敗行に「失敗」、selected 1 → 「再試行」→ publish が失敗 id だけに 1 回 */ });
it("ステータスの一括変更は status だけを push する", async () => {});
it("URL のクエリが変わると選択を解除する", async () => {});
// content-list-bulk-delete.test.tsx
it("一括の削除は確認を経て順に delete を push する", async () => { /* fireEvent で開く、alertdialog「2 件の記事を削除しますか？」→「削除する」 */ });
// content-list-row-delete.test.tsx
it("行の「削除」は確認を経て delete を push しトーストを出す", async () => {});
```

- [ ] **Step 2: テストが失敗することを確かめる**

Run: `corepack pnpm --filter @plyrs/admin exec vitest run src/content-list-bulk.test.tsx src/content-list-bulk-delete.test.tsx src/content-list-row-delete.test.tsx`
Expected: FAIL

- [ ] **Step 3: 実装する**

- [ ] **Step 4: テストが通ることを確かめる**

Run: `corepack pnpm --filter @plyrs/admin exec vitest run && corepack pnpm -r typecheck && corepack pnpm format`
Expected: PASS。`grep -rn "tokens.stylex" apps/admin/src` が 0 件

- [ ] **Step 5: コミット**

```bash
git add apps/admin/src
git commit -m "feat(admin): 一覧の一括操作(公開・取り下げ・ステータス・削除)と行の削除を入れる"
```

---

### Task 13: E2E のヘルパーと spec を新しい導線に合わせる

**Files:**
- Modify: `apps/e2e/helpers/setup.ts`
- Modify: `apps/e2e/tests/core-journey.spec.ts`、`apps/e2e/tests/two-tab-sync.spec.ts`

**Interfaces:**
- Produces:
  - `createArticleRecord(page, title)`: 「記事を追加」→ textbox「title」→ `button「下書き保存」` → `page.waitForURL(/\/content\/article\/[0-9a-f-]{36}$/)` → サイドバーの `getByRole("complementary").getByRole("link", { name: "一覧", exact: true })` で一覧へ戻り、`cell` のタイトルを待つ(以降の spec は一覧にいる前提を保つ)
  - `openRecordEditor(page, title)`: タイトルのリンクを押し、`getByRole("region", { name: "公開" })` を待つ
  - `publishRecord(page)`: `getByRole("region", { name: "公開" }).getByRole("button", { name: "公開", exact: true })` → 同じ region に「公開中」が見える
  - `two-tab-sync.spec.ts`: 「保存」→「下書き保存」(2 か所)。A が保存した後の `page.goto(listUrl)` はそのまま

- [ ] **Step 1: ヘルパーと spec を直す**

- [ ] **Step 2: E2E を回す(ユーザーに依頼。サンドボックスの外。`apps/api/.wrangler` / `apps/admin/.wrangler` が消える)**

Run: `pnpm --filter @plyrs/e2e test`
Expected: 3 spec が PASS

- [ ] **Step 3: コミット**

```bash
git add apps/e2e
git commit -m "test(e2e): 公開ボックスと作成後に編集画面へ留まる導線に合わせる"
```

---

### Task 14: 全体の検証、デザインシステムへの同期、preview での実機確認

**Files:**
- Modify: `.design-sync/NOTES.md`
- 変更なし(問題が見つかったときだけ該当ファイルを直す)

- [ ] **Step 1: 静的検査とテスト**

Run: `corepack pnpm lint && corepack pnpm format:check && corepack pnpm -r typecheck && corepack pnpm -r --filter "!@plyrs/e2e" test`
Expected: すべて成功(ui の RAC のテストがタイムアウトしたら単独で再実行)

- [ ] **Step 2: ビルド(ユーザーに依頼)**

Run: `pnpm --filter @plyrs/admin build`
Expected: 成功

- [ ] **Step 3: dev での見た目の確認(ユーザーに依頼。`run` スキルを使ってよい)**

owner と viewer で次を見る:

- 作成: 「公開」で作成 → 公開 → 編集画面に留まり h1「{型名}を編集」、トースト「公開しました」。「下書き保存」でも URL が置き換わる。必須の空欄で「公開」→ フィールドのエラーへスクロール
- 編集: C 3 章の 4 状態でボタンが切り替わる。未保存の編集で「更新」→ 保存してから公開される(公開 API の後に公開版が新しい)。api を止めて「更新」→ ツールチップの理由と注記、「公開せずに保存」は押せて再接続後に送信される。公開に失敗(api を止めてから戻す等)→ エラーのトーストと「公開を再試行」
- 競合: 2 タブで同じ本文を編集 → 競合ダイアログ → 3 つのボタン
- ステータス: 公開中にアーカイブ → 確認。削除 → 警告付きの確認 → 一覧へ。取り下げ → 確認
- 離脱: 未保存でサイドバーの項目を押す → 確認。タブを閉じる → ブラウザの確認
- 閲覧者: 下線だけの読み取り専用、パンくず「表示」、h1「{型名}を表示」、ボックスにボタン無し、一覧に追加ボタン・選択列が無く「閲覧のみ」
- メディア(asset 型)の編集: 「保存」と「削除」だけ、パンくず ホーム › メディア › 編集
- 一覧: タブの件数、絞り込み・検索・並べ替え・ページ送りが URL に入り戻るで戻る、行のホバーで「編集 / 削除」、一括操作(公開 → 進捗 → トースト、取り下げ・削除は確認)、一部失敗の印と再試行、0 件と検索 0 件の空状態
- 狭い画面(959px 以下): ボックスがフォームの下、下部固定バーに主・補助ボタンと注記、一覧はステータス・更新列が隠れ、公開バッジが「公開中・未反映」、行の操作が常時表示、タブが横スクロール
- ダーク: 公開ボックス・バッジ・一括バー・トースト・ダイアログの配色

- [ ] **Step 4: ブランチの仕上げ**

superpowers:finishing-a-development-branch に従い、統合方法(ローカルマージ / push して PR / 残す)をユーザーに提示して選んでもらう。push はユーザーに確認してから(`git -c credential.helper='!gh auth git-credential' push https://github.com/hiz8/plyrs.git <branch>`、PR は `gh pr create --repo hiz8/plyrs`)。

- [ ] **Step 5: preview での実機確認(ロードマップ 5 章の注記。ユーザーに依頼)**

main への反映で preview に自動デプロイされる。Step 3 のうち SPA シェルに関わるものを確かめる: 一覧の URL をクエリ付き(`/t/<slug>/content/<type>?tab=published&page=2`)で直接開いて描画されること、作成後に置き換わった編集画面の URL を再読み込みしても描画されること、トースト・ダイアログの重なり順(サイドバー・上部バーより上)、狭い画面の下部固定バーがモバイルのブラウザで隠れないこと。食い違いがあれば報告する(直すか V4 に回すかはユーザーが決める)。

- [ ] **Step 6: キャンバスのデザインシステムへ同期(`.design-sync/NOTES.md` の再同期の手順。サンドボックスの外。V2 分と合わせて 1 回)**

Task 3 で変えた部品(`TextField` / `TextArea` / `Select` / `Checkbox` / `CheckboxGroup` / `RichTextEditor` の `isReadOnly`、`Select` の `size`、`PageHeader` の `meta`、`Tabs` の横スクロール)と V2 の `Avatar` / `Drawer` / `PageHeader` / `MenuItem` / `Table` を再同期する。`NOTES.md` の「V3 で変えた部品」と「部品側の気づき」を更新する。

- [ ] **Step 7: 報告**

ユーザーに次をまとめて報告する: 裁定台帳(R1〜R24)と設計書への書き戻し、D2 にあって V3 に入れなかったもの(複製、「すべて」で検索、一部失敗トーストの 2 行目、競合ダイアログの差分強調とラジオ、1280px 未満での下部固定バー案、相手のメールアドレス)、Task 2 の持ち越しのうち未対応のもの(drawer.test の暗幕の扱いなど)、E2E・preview で見つかった食い違い、design-sync の結果。

---

## セルフレビュー(2026-10-20)

- 仕様の網羅: C 2 章(配置・ボックスの見た目・右列 300px・見出しの右の補足)→ Task 7・8。3 章(ボタンと状態・注記)→ Task 4・7。4 章(保存→公開の順・失敗の扱い・切断中・トースト・競合ダイアログ)→ Task 6・8。5 章(ステータス)→ Task 7・8・9。6 章(作成画面)→ Task 8。7 章(トースト・離脱)→ Task 8・9。8 章(削除・取り下げ)→ Task 9。9 章(閲覧者)→ Task 3・6・8。10 章(メディア)→ Task 4・8。11 章(スロット)→ Task 8。D 2 章(構成)→ Task 11。3 章(公開状態・タブ・空状態・アーカイブ)→ Task 7・11。4 章(絞り込み・検索)→ Task 10・11。5 章(列・並べ替え・行の操作・寸法・狭い画面)→ Task 10・11。6 章(一括操作)→ Task 5・10・12。7 章(ページ送り)→ Task 5・10・11。8 章(URL)→ Task 11。9 章(公開状態の取得)→ Task 11。H 3 章(部品)→ Task 3。4 章(文言)→ Task 4。5 章(日時)→ Task 7・10。6 章(状態の表示)→ Task 11。7 章(権限)→ Task 7・8・10・11。8 章(確認)→ Task 9・12。10 章(画面幅)→ Task 3・7・8・10。11 章(a11y)→ Task 7・9・10。E 2 章(label / description)→ Task 6。V2 持ち越し 8 点 → Task 2
- 型の整合: `PublishBoxView`(Task 4)を Task 7 の `PublishBoxProps.view` と Task 8 の `publishBoxView()` の呼び出しで使う。`ListPublicationState`(T12)を `PublicationBadge` と `publishBoxView` の `changed` 判定で共用(ボックスは `PublicationState` から、一覧は `ListRow.publication` から)。`BulkKind`(Task 5)を `BulkBar`(Task 10)とルート(Task 12)で共用。`RecordFormHandle`(Task 6)を `RecordEditor`(Task 8)が `useRef` で持つ。`runBulk` の第 3 引数はオプション object に変わる(T12 のテストを直す)
- Review Focus: 5 項目すべてに Task 8・11・12 のテスト名を結んだ
- 入れなかったもの(範囲外として報告): 予約投稿・プレビュー・ゴミ箱(C 12 章)、型ごとの列(`listColumns`。案 E・V4)、最終更新者の列(D 10 章)、数千件の表示性能(D 10 章)、`ConfirmDialog` の処理中の `Spinner`(NOTES.md の気づき。`isPending` のまま)
