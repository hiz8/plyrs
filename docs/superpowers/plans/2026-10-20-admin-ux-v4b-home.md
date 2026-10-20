# 管理画面 UX 再構築 V4-B: ホーム(案 B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** テナントの着地点 `/t/:slug/` を、V2 の暫定(先頭の型へ転送)から案 B のホーム(新規追加の行、自分の下書き、確認待ち、最近の更新、モジュールのウィジェット、型 0 件のときの「はじめに」)に置き換える。あわせて V3 の最終レビューで持ち越した軽微な修正のうち、V4 全体に関わるものを先に片付ける。

**Architecture:** 画面の判断は純関数に寄せ、部品は描くだけにする(V2・V3 と同じ)。ホームが出す対象の型の決定(サイドバーと同じ順)、自分の下書き・確認待ちの集計・最近の更新の抽出・一覧へのリンクの組み立ては `lib/home.ts` の純関数。型をまたいだレコードの購読は `useRecordsOfTypes`(現 `useRelationCandidates` の一般化)。公開状態は V3 で入った全型の `publicationsQueryOptions` を使い、「未反映の変更あり」の件数を数える。ホームの枠(カード)・行・枠内の 0 件表示は `components/home/` の小さな部品に分け、ルート `routes/t/$tenantSlug/index.tsx` は配線だけにする。`home:widget` スロットは `size`(half / full)と `moduleId`(有効なモジュールのときだけ描く)を持つ。見た目はセマンティックトークンと `@plyrs/ui` の部品だけで組む。

**Tech Stack:** StyleX 0.19.1、react-aria-components 1.21.1(`Link` のみ直接。他は ui の部品経由)、TanStack Router 1.170.18、TanStack Query 5、lucide-react、Vitest + jsdom + Testing Library、Playwright

**Spec:**
- `docs/admin-ux/b-home.md`(2〜5 章が真実源。6 章の未決事項のうち「ウィジェットの表示順」は本計画の裁定 B5 で扱い、「最終更新者の名前」は案 G 以降)
- `docs/admin-ux/h-common-surface.md`(2 章 骨格、3 章 部品、4 章 文言、5 章 日時、6 章 状態、7 章 権限、10 章 画面幅、11 章 アクセシビリティ、12 章 アイコン)
- `docs/admin-ux/h-design-tokens.md`(3 章 セマンティックトークン)
- `docs/admin-ux/a-navigation.md` 9 章(V2 の暫定ホームの記述。本計画で置き換える)
- `docs/superpowers/plans/2026-10-17-admin-ux-rebuild-roadmap.md` 5 章 V4
- `docs/superpowers/plans/2026-10-20-admin-ux-v3-editor-and-list.md`(V3 で作った部品の契約と持ち越し。Global Constraints・各タスクの Interfaces・Task 14 Step 7)
- `docs/admin-ux/design-briefs/03-remaining-screens.md` 3 章「確認する状態」の「ホーム」の行(管理者 / 閲覧者、読み込み中、自分の下書き 0 件、確認待ち 0 件、型 0 件)
- キャンバス https://claude.ai/artifact/K57TVUfpefMuiPxhZXyAnU のページ「D3 残りの画面」の H1〜H6(ホーム)と C1(ダーク)。フレームは `project/D3-Home*.dc.html`。設計書と食い違うときは設計書を優先する(食い違いは「裁定台帳」に記し、Task 1 で設計書に書き戻し、最後に報告する)

## Global Constraints

- 画面と部品が参照するのはセマンティックトークン(`@plyrs/ui/semantic.stylex`)だけ。本計画で触る admin のファイルからは旧 `@plyrs/ui/tokens.stylex` の参照を無くす(対応表は V3 計画の Global Constraints と同じ)。対象: `components/error-screen.tsx`。本計画の最後に `grep -rln "tokens.stylex" apps/admin/src/components apps/admin/src/routes/t` が `content-type-form.tsx` だけになる(これは V4-E の範囲。`routes/login.tsx` / `signup.tsx` / `super/**` は範囲外のまま)
- キャンバスの寸法は尺度に寄せる(V1〜V3 の裁定と同じ): 文字 13px→14px(`font.body`)、12px→`font.caption`、15px→16px(`font.label`)、18px→16px、20px→`font.sectionTitle`、24px→`font.pageTitle`。余白 10px→12px(`space.inset`)、6px→8px(`space.sm`)、4px→`space.xs`、16px→`space.md`、20px→24px(`space.lg`)、28px→24px(`space.lg`)、32px→`space.xl`。部品固有の寸法は数値で書き、コメントで根拠(b-home.md 2 章 / D3 H1〜H6)を添える: 枠の行の高さ 40px、件数の角丸 24px、「はじめに」の枠の最大幅 760px、手順の番号の円 32px、新規追加の行の区切り線 24px、枠内の 0 件表示のアイコン 20px(`ICON_SIZE.nav`。キャンバスの 24px は尺度に無い、裁定 B8)、ダッシュボードの 2 列グリッドの間隔 `space.lg`
- 幅 960px 未満の切り替えは CSS のメディアクエリ `"@media (max-width: 959px)"` だけで行う(各ファイルに `const NARROW`。JS の `matchMedia` は使わない)。2 列のグリッド(下書き / 確認待ち、ウィジェット)は NARROW で 1 列にする
- 画面は `@plyrs/ui` の部品(`Button` / `Badge` / `Skeleton` / `RelativeTime` / `EmptyState` / `Tooltip` / `PageHeader`)で組む。react-aria-components を admin から直接 import してよいのは `components/shell/` と、V3 の R23 で認めた表の中のリンクに加え、本計画ではホームの枠の中の行・フッターのリンク(`Link` の `href`)も認める(裁定 B10)
- 画面上の呼称と文言は `lib/labels.ts` に置く(画面・部品に日本語を直書きしない。例外: テストの断言)。「レコード」は使わず型名で呼ぶ。文体は「です・ます」、ボタンは操作名(H 4.2)
- 日時は `lib/datetime.ts` の `formatDateTime` と ui の `RelativeTime` で出す(H 5 章)。ユーザー ID・ISO 文字列・`version` を画面に出さない
- エラーは `lib/error-messages.ts` の `errorMessage(cause, fallback)` で利用者向けの文にする
- 見出しは 1 画面に `h1` が 1 つ(`PageHeader`)。各枠(カード)とウィジェットの題は `h2`、「はじめに」の手順の題は `h3`
- アイコンは `lucide-react`、ボタン・バッジの中は `ICON_SIZE.inline`、装飾は `aria-hidden`。使うアイコン(H 12 章): plus(新規追加)/ chevron-right(行の先)/ pencil(下書き 0 件)/ circle-check(確認待ち 0 件)/ inbox(最近の更新 0 件)/ lock(閲覧のみ)/ layout-grid(型 0 件の案内)/ rotate-cw(再試行)
- 権限の出し分けは `useCan()` だけ(ロールの直書き禁止)。閲覧者(`record:write` 無し)には「新規追加」の行と「自分の下書き」を出さない(B 5 章)。「はじめに」は `type:manage` のときだけ
- RTL テストの方針(V2・V3 で分かった罠): router 経由で描くテスト(`renderAt`)では RAC の Popover(`Menu` / `Select`)を user-event で開けず、同じファイルで RAC の Modal を 2 回開くとハングする。したがって (1) ダイアログ・メニューの挙動は部品単位のテスト(`components/*.test.tsx` の直接描画)で担保する、(2) router 経由でモーダルを開くテストは **1 ファイル 1 本**にする、(3) メニューを使う router テストは `vi.mock` で素のボタンに差し替える、(4) モーダルを開く操作は `fireEvent.click`、それ以外は `userEvent`。ホームにはモーダルもメニューも無いので、ホームの router テストは `home-flow.test.tsx` の 1 ファイルにまとめてよい。`Select` の絞り込みが要る場面は URL(`?status=draft`)を初期パスにして検証する
- `getByRole("status")` は複数一致する(サイドバーの同期状態、PageLoading、一覧の読み込み)ため、名前か `within` で絞る。トーストは `within(screen.getByRole("region", { name: "通知" }))`
- 一覧ルートの `validateSearch` は `Partial<ListQuery>` を返し `search.middlewares` で `toListSearch` に通す。ホームから一覧へのリンクは `toListSearch` で作った既定値抜きのクエリを `href` 文字列に載せる(`lib/home.ts` の `listHref`)
- StyleX は子孫セレクタを書けない。行のホバーで色を変えるだけなら RAC `Link` の render props(`isHovered`)で足りるので、本計画では `styles.css` に足さない
- `@ts-expect-error` は使わない。素の `git stash` は使わない。コメント・ドキュメント・コミットメッセージは日本語。コミットは各タスクの最後に 1 つ(`/commit` スキルの規約。帰属行は付けない)。git は 1 回の呼び出しに 1 コマンド(`git add … && git commit …` の複合は使わない)
- サンドボックスの道具: `pnpm` は `corepack pnpm`。ルートの `pnpm typecheck` / `pnpm test` は使わず `corepack pnpm -r typecheck`、`corepack pnpm -r --filter "!@plyrs/e2e" test`。`corepack pnpm format:check` の「No config found, using defaults」は正常な警告(exit 1 のときだけ整形漏れ)。`pnpm install`、admin の `build`、`dev` サーバー、E2E、design-sync はサンドボックスの外で実行する(「ユーザーに依頼」と書く)。並列実行で ui の RAC のテストが 5 秒でタイムアウトしたら、そのファイルを単独で再実行して判断する
- `docs/` と `.design-sync/` は oxfmt の対象外。それ以外は各タスクの最後に `corepack pnpm format` をかけ、コントローラがタスクごとに `corepack pnpm format:check` を確かめる(実装者の「format 済み」報告だけで済ませない)
- ロードマップ 5 章の注記どおり preview で実機確認する(Task 7)。push とコミットはユーザーに確認してから
- design-sync の再同期(V2・V3 分)は V4 の最後(V4-F の計画の末尾)に 1 回まとめて行う。本計画で ui を変えた分(`ProgressBar` の `isLabelHidden`、`Toaster.clear`、`HomeWidgetContribution` の `size` / `moduleId`)は `.design-sync/NOTES.md` の「V4 で変えた部品」に記録だけする
- サブエージェントへのディスパッチ文には、作業ツリーのパスを `cd` 付きで強制すること、`git log --oneline -2` の実出力を貼らせること、テストの実出力を貼らせること、`@ts-expect-error` 禁止と素の `git stash` 禁止、git は 1 回 1 コマンド、を含める

## 裁定台帳(2026-10-20)

計画を書く時点で決めたこと。B1〜B3 はユーザー裁定。Task 1 で設計書に書き戻し、最終報告で一覧にする。番号は本文から参照する。

| #   | 項目                                                                         | 裁定                                                                                                                                                                                                                                                                                                 | 書き戻し先       |
| --- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| B1  | 型をまたいだ件数から型ごとの一覧へのリンク(B 2.2・2.3)                       | 行はキャンバスどおり(バッジ + 説明 + 合計の件数 + chevron)。件数がある型が 1 つなら行全体がその型の絞り込み済み一覧へのリンク。複数なら行はリンクにせず、行の下に「お知らせ 2 ・ ブログ 1」の型ごとのリンクを並べる。「下書きをすべて見る」も同じ規則。ユーザー裁定                                     | b 2.2・2.3       |
| B2  | 「未反映の変更あり」の行(B 4 章「入れなかった要素」、D3 H1 の 3 行目)         | 入れる。V3 で入った全型の公開状態の一括取得(`publicationsQueryOptions(adminApi, tenantId)`)で、公開中かつ `sourceVersion < version` のものを数える。リンク先は一覧のタブ `unpublished-changes`。取得に失敗したときはこの行だけにエラー文と再試行を出す(他の 2 行は同期データなので影響しない)。ユーザー裁定 | b 2.3・4 章      |
| B3  | 型 0 件のときの編集者・閲覧者への案内に添える「管理者のメールアドレス」(B 2.6) | 出さない(メンバー一覧 API は `member:manage` のみで、編集者・閲覧者は取れない)。文は「サイトの管理者に、コンテンツタイプの作成を依頼してください。作成されると、ここに新規追加の入口と最近の更新が表示されます」。ユーザー裁定                                                                        | b 2.6            |
| B4  | 「はじめに」の手順 3「メンバーを招待する」(B 2.6「案 G の実装後に表示」)      | V4-B では手順 1(コンテンツタイプを作成)と 2(メディアをアップロード)だけ。説明文に手順の数を書かず、V4-G の計画で手順 3 を足す                                                                                                                                                                          | b 2.6            |
| B5  | ウィジェットの表示順と有効なモジュールの判定(B 2.5・6 章)                     | 表示順はスロットの契約どおり `order` 昇順・同順は `id`(「有効化順」はモジュール API に有効化日時が無いため採らない)。`HomeWidgetContribution` に `size?: "half" \| "full"`(既定 half)と `moduleId?: string` を足し、`moduleId` があるものはそのモジュールが有効なときだけ描く                              | b 2.5・6 章      |
| B6  | 見出しの右の補足(B 2 章「メールアドレスと役割」、D3 H1・H2)                   | 管理者・編集者は「{email} ・ {役割}」。閲覧者は錠アイコン +「閲覧のみ ・ {email}」(一覧・編集画面の `meta` と揃える)。`me` が未取得なら役割だけ(閲覧者は「閲覧のみ」だけ)                                                                                                                             | b 2 章           |
| B7  | 自分の情報(`me`)の取得に失敗したとき(B 3 章)                                  | 「自分の下書き」の枠だけにエラー文(`errorMessage`)と「再試行」を出し、他の枠は描く(一覧の R20 と同じ形)。見出しの右の補足は役割だけになる                                                                                                                                                              | b 3 章           |
| B8  | 枠の中の 0 件表示(B 2 章、D3 H4)                                              | ui の `EmptyState`(破線の枠)は使わず、枠内の小さな表示(アイコン 20px 線幅 1.75 + 1 行の文 + 任意の 1 行の案内)にする。破線の二重枠を避けるため。画面全体の空状態(型 0 件の編集者・閲覧者)は `EmptyState`                                                                                                 | b 2 章、h 3 章   |
| B9  | 「最近の更新」が 0 件のとき(設計書に無い)                                     | 他の枠と同じ形で「まだ更新はありません」(inbox)。アーカイブも更新として数える(D3 H4 にアーカイブの行がある)。削除済み(`deletedAt`)は除く                                                                                                                                                              | b 2.4            |
| B10 | 枠の中のリンクの実装                                                         | 行・フッター・型ごとの内訳リンクは RAC の `Link`(`href`)を admin から直接使う(V3 の R23 の拡張。`RouterProvider` で画面内遷移になる)                                                                                                                                                                  | h 3 章           |
| B11 | 「下書きをすべて見る」の行き先(B 2.2「絞り込み済み一覧へ」)                   | 一覧に「自分が編集した」の絞り込みが無いため、その型の下書きの一覧(`?status=draft`、全員分)へ。型は自分の下書きがある型(B1 の規則)                                                                                                                                                                      | b 2.2            |
| B12 | 読み込み中の見出し(B 2 章・3 章、D3 H3)                                       | h1 は「ホーム」のまま出し(V2 の `PageLoading` のスケルトン h1 は使わない)、各枠の見出しを残して中身だけスケルトンにする。本文の入れ物に `aria-busy`                                                                                                                                                      | b 3 章           |
| B13 | 型 0 件の判定のタイミング(B 2.6)                                              | 初回同期の完了に加え、モジュール一覧の取得完了(失敗も完了扱い)を待ってから判定する(モジュールの型だけがあるサイトで「はじめに」が一瞬出ないように)。モジュール一覧の取得に失敗したら利用者の型だけでホームを描き、`moduleId` 付きのウィジェットは出さない                                                  | b 3 章           |
| B14 | ホームが扱う型(B 2.1・2.4「サイドバーに出している型」)                        | `sidebarContentTypes(types)`(利用者の型、`menuOrder` 順)に続けて `moduleNavGroups(modules, types)` の型。メディア(`asset`)とモジュールの内部用の型は含まれない。新規追加の行では両群の間に区切り線(D3 H1)                                                                                                | b 2.1            |
| B15 | `ErrorScreen` の「ホームへ戻る」(H 6 章)                                      | router 全体の `defaultErrorComponent` でサイトの slug が分からないため見送り、「再読み込み」だけ。文言を `labels.ts` に移し、`Error.message` の直出しは `errorMessage` に置き換える(`ApiError` の `status: code` は残す)                                                                                 | h 6 章           |
| B16 | 編集画面で公開状態の取得に失敗したとき(V3 持ち越し 4)                         | 公開ボックスの「状態」にエラー文「公開状態を取得できませんでした」と「再試行」を出し、公開の主ボタンは読み込み中と同じく無効。ステータスの変更と削除はできる                                                                                                                                             | c 4 章           |
| B17 | `Spinner` と `ProgressBar` の二重読み上げ(V3 持ち越し 5)                      | `ProgressBar` に `isLabelHidden`(`aria-label` は残し、見た目の題だけ出さない)を足し、一括バーは `Spinner` を `aria-hidden` の `span` で包む。読み上げは `progressbar` の 1 回                                                                                                                             | (コード)         |
| B18 | E2E の `loginAsUser` の URL 待ち                                             | 管理者が型 0 件でもホームに留まる(転送しない)ため、`/\/t\/[^/]+\//` を `/\/t\/[^/]+(\/\|$)/` にする。型作成の導線はサイドバーの「設定」のまま                                                                                                                                                             | (コード)         |
| B19 | V3 持ち越しの振り分け                                                        | 本計画(Task 2): 3 の `error-screen.tsx`、4、5、6、7、8(試みて駄目なら未対応のまま報告)。V4-E: 3 の `content-type-form.tsx`。V4-G: 2(`settings/modules` と `super/*` の「読み込み中…」)。V4-F: 1(design-sync)と 9(asset 型の編集画面)                                                                       | (計画)           |
| B20 | 「新規追加」の行の見た目(D3 H1)                                               | 枠線のボタン(`Button variant="secondary" icon={Plus}`、押すと作成画面へ `navigate`)。行の先頭の「新規追加」は `font.body` 太字 `text.muted` の見出しではなくラベル(`span`)                                                                                                                                | b 2.1            |

## Review Focus

1. **自分の情報(`/auth/me`)の取得に失敗する**: ホーム全体は描かれ、「自分の下書き」の枠だけにエラー文と再試行が出て、再試行で下書きが描かれること。→ Task 5 の home-flow.test「自分の情報の取得に失敗すると下書きの枠だけにエラーと再試行が出る」
2. **公開状態の一括取得に失敗する**: 「確認待ち」のレビュー中・公開準備完了の行はそのまま出て、「未反映の変更あり」の行だけがエラー文と再試行になること。→ Task 5 の home-flow.test「公開状態の取得に失敗すると未反映の行だけがエラーと再試行になる」
3. **型が後から届く**: 型 0 件で「はじめに」を出した後、同期の `content-types` で型が届くと再読み込みなしで普段の表示に変わること(設計書 2.6「1 つ目が終わると普段の表示に変わる」)。→ Task 5 の home-flow.test「型 0 件の管理者には「はじめに」が出て、型が届くと普段の表示に変わる」
4. **サイドバーに出ない型のレコード**(メディア、無効なモジュールの型、削除済みのレコード): 最近の更新・下書き・確認待ちに出ないこと。→ Task 3 の home.test「homeRecords はサイドバーに出ない型と削除済みを除き、更新日時の新しい順に並べる」と Task 5 の home-flow.test「メディアと無効なモジュールの型のレコードは最近の更新に出ない」
5. **モジュール一覧の取得に失敗する**: ホームは利用者の型だけで描かれ、型 0 件の判定も進み、`moduleId` 付きのウィジェットだけが出ないこと。→ Task 5 の home-flow.test「モジュール一覧の取得に失敗してもホームは描かれる」

---

## ファイル構成

`packages/ui/src/`:

| ファイル              | 責務                                                                                           |
| --------------------- | ---------------------------------------------------------------------------------------------- |
| `slots.ts`            | 変更。`HomeWidgetContribution` に `size?: "half" \| "full"` と `moduleId?: string`(B5)          |
| `progress.tsx`        | 変更。`ProgressBarProps.isLabelHidden`(B17)                                                     |
| `toast.tsx`           | 変更。`Toaster.clear()`(V3 持ち越し 7)                                                          |
| `drawer.test.tsx`     | 変更。暗幕クリックのテスト(V3 持ち越し 8)                                                       |

`apps/admin/src/`:

| ファイル                                      | 責務                                                                                                                     |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `lib/labels.ts`                               | 変更。`HOME_LABELS`、`ERROR_SCREEN`、`PUBLISH_BOX.loadFailed` / `retry`。`HOME_PLACEHOLDER` は削除                          |
| `lib/home.ts`                                 | 新規。ホームの型の決定・レコードの抽出・集計・リンクの組み立て(純関数)                                                   |
| `lib/use-collection.ts`                       | 変更。`useRelationCandidates` → `useRecordsOfTypes`(名前と並び順の一般化)                                                |
| `lib/publish-box.ts`                          | 変更。状態 `{ kind: "error" }`(B16)                                                                                       |
| `components/error-screen.tsx`                 | 変更。セマンティックトークン・`labels.ts`・`errorMessage`(B15)                                                             |
| `components/bulk-bar.tsx`                     | 変更。`Spinner` の `aria-hidden`、`ProgressBar` の `isLabelHidden`(B17)                                                   |
| `components/publish-box.tsx`                  | 変更。エラー状態の行(B16)                                                                                                 |
| `components/record-editor.tsx`                | 変更。`publication.isError` を `publishBoxView` に渡し、再試行で `refetch`(B16)                                            |
| `components/home/home-card.tsx`               | 新規。枠(`HomeCard`)・行(`CardRow`)・枠内の 0 件表示(`CardEmpty`)・型ごとの内訳リンク(`TypeLinks`)                        |
| `components/home/quick-add-row.tsx`           | 新規。「新規追加」の行(型ごとのボタン、群の区切り、読み込み中)                                                            |
| `components/home/drafts-card.tsx`             | 新規。「自分の下書き」の枠(読み込み中 / エラー / 0 件 / 一覧 + フッター)                                                  |
| `components/home/review-card.tsx`             | 新規。「確認待ち」の枠(3 行、0 件、未反映の行のエラー)                                                                    |
| `components/home/recent-card.tsx`             | 新規。「最近の更新」の枠                                                                                                   |
| `components/home/widget-grid.tsx`             | 新規。`home:widget` の 2 列グリッド                                                                                        |
| `components/home/getting-started.tsx`         | 新規。型 0 件の「はじめに」(管理者)と依頼の案内(編集者・閲覧者)                                                            |
| `routes/t/$tenantSlug/index.tsx`              | 書き換え。ホームの配線(転送しない)                                                                                        |
| `test-utils/api-stubs.ts`                     | 新規。`jsonResponse` / `stubFetch` / `Handler` / `blogTenantOf` / `baseAuthedRoutes`(2 つのハーネスの重複を寄せる)          |
| `test-utils/records-harness.tsx` / `shell-harness.tsx` | 変更。`api-stubs.ts` から import し直す。`bootstrapped` に型の引数                                                  |
| `home-flow.test.tsx`                          | 新規。ホームの router テスト                                                                                               |
| `shell.test.tsx`                              | 変更。「ホームの暫定」の describe を削除                                                                                    |
| `vitest.setup.ts`                             | 変更。`toaster.clear()`                                                                                                     |

`apps/e2e/helpers/setup.ts`(B18)。`docs/admin-ux/{b,h,a,c}-*.md`: 裁定の書き戻し。`.design-sync/NOTES.md`: 部品の変更の記録。

## タスクの依存

Task 1(設計書)→ Task 2(V3 持ち越し)→ Task 3(スロットの型・文言・純関数・購読フック)→ Task 4(ホームの部品)→ Task 5(ルートと router テスト)→ Task 6(E2E)→ Task 7(検証・preview・報告)。Task 2 は Task 3 以降と独立だが、ハーネスの統合(持ち越し 6)を Task 5 が使うため先に置く。

---

### Task 1: 設計書へ V4-B の裁定を書き戻す

**Files:**
- Modify: `docs/admin-ux/b-home.md`(2・2.1・2.2・2.3・2.4・2.5・2.6・3・4・6・7 章)
- Modify: `docs/admin-ux/h-common-surface.md`(3 章、6 章、14 章)
- Modify: `docs/admin-ux/a-navigation.md`(9 章)
- Modify: `docs/admin-ux/c-publish-box.md`(4 章、13 章)

- [ ] **Step 1: b-home.md に B1〜B14・B20 を書く**

各章に「(2026-10-20、V4-B)」付きで 1〜2 文ずつ足し、既存の文は消さない。2.3 の「件数が 0 のとき」の後に B2 の 3 行目(未反映の変更あり)を足し、4 章の「未反映の変更があるもの」は「V4-B で 2.3 に加えた」に改める。2.6 の editor / viewer の文を B3 の文に置き換え、owner の手順は B4(手順 3 は案 G の後)。6 章の未決事項から「`home:widget` の表示順」を消し(B5 で確定。「利用者がウィジェットを非表示にできるか」は残す)。7 章 決定ログに 1 行: 「2026-10-20: V4-B の計画で B1〜B14・B20(台帳は `docs/superpowers/plans/2026-10-20-admin-ux-v4b-home.md`)を確定。D3 との食い違いは設計書を優先した: 枠内の 0 件表示のアイコンは 20px、「はじめに」の手順は 2 つ(メンバーは案 G の後)、管理者のメールアドレスは出さない、未反映の変更ありの行は入れる」

- [ ] **Step 2: h-common-surface.md・a-navigation.md・c-publish-box.md を直す**

h 3 章の V3 の行の下に「V4-B(2026-10-20): ホームの枠の中のリンクも RAC の `Link` を admin から直接使う(B10)。枠内の 0 件表示は `EmptyState` を使わない(B8)。`ProgressBar` に `isLabelHidden`、`Toaster` に `clear()` を足した」。h 6 章の「画面全体のエラー」の行に「(「ホームへ戻る」は V4-B で見送り、B15)」。h 14 章 決定ログに 1 行。a 9 章の「V2 の暫定」の段落の末尾に「V4-B(2026-10-20)で案 B のホームに置き換えた。転送はしない」。c 4 章の失敗表に「公開状態の取得に失敗: 公開ボックスの状態にエラー文と再試行、主ボタンは無効(B16)」、c 13 章 決定ログに 1 行。

- [ ] **Step 3: コミット**

```bash
git add docs/admin-ux
```

```bash
git commit -m "docs: V4-B(ホーム)の裁定を案 B・案 H・案 A・案 C の設計書に書き戻す"
```

---

### Task 2: V3 からの持ち越し(error-screen のトークン、公開状態の取得失敗、二重読み上げ、ハーネスの統合、Toaster.clear、drawer のテスト)

**Files:**
- Modify: `apps/admin/src/components/error-screen.tsx`、`apps/admin/src/lib/labels.ts`(B15)
- Modify: `apps/admin/src/lib/publish-box.ts`、`apps/admin/src/lib/publish-box.test.ts`、`apps/admin/src/components/publish-box.tsx`、`apps/admin/src/components/record-editor.tsx`、`apps/admin/src/publish-box-flow.test.tsx`(B16)
- Modify: `packages/ui/src/progress.tsx`、`packages/ui/src/progress.test.tsx`、`apps/admin/src/components/bulk-bar.tsx`、`apps/admin/src/components/bulk-bar.test.tsx`(B17)
- Create: `apps/admin/src/test-utils/api-stubs.ts`
- Modify: `apps/admin/src/test-utils/records-harness.tsx`、`apps/admin/src/test-utils/shell-harness.tsx`(持ち越し 6)
- Modify: `packages/ui/src/toast.tsx`、`packages/ui/src/toast.test.tsx`、`apps/admin/vitest.setup.ts`(持ち越し 7)
- Modify: `packages/ui/src/drawer.test.tsx:19-31`(持ち越し 8)
- Modify: `.design-sync/NOTES.md`

**Interfaces:**
- Produces:
  - `ERROR_SCREEN = { title: "エラーが発生しました", fallback: "ページを表示できませんでした。再読み込みしても直らない場合は、時間をおいてお試しください", reload: "再読み込み" }`(`labels.ts`)
  - `PUBLISH_BOX.loadFailed = "公開状態を取得できませんでした"`、`PUBLISH_BOX.retry = "再試行"`
  - `publish-box.ts`: `PublishBoxState` に `{ kind: "error" }` を足す。`publishBoxView` の入力に `publicationError?: boolean` を足し、`!isNew && !isAsset && publicationError` なら `state = { kind: "error" }`。主ボタンの無効化は `"loading"` と同じ条件に `"error"` を加える
  - `PublishBoxProps.onRetryPublication?: () => void`(`StateRow` は `kind === "error"` で `<span role="alert">{PUBLISH_BOX.loadFailed}</span>` と `Button variant="link" size="sm" icon={RotateCw}`「再試行」を描く)
  - `ProgressBarProps.isLabelHidden?: boolean`(`aria-label` はそのまま。見た目の題の `span` を描かず、値の文字だけ右寄せで残す)
  - `Toaster.clear(): void`(`queue.clear()` を呼ぶ。`queue` は `@internal` のまま残す)
  - `test-utils/api-stubs.ts`:

```ts
export function jsonResponse(status: number, body: unknown): Response;
export type Handler = Mock<(init?: RequestInit) => Response | Promise<Response>>;
export function stubFetch(routes: Record<string, Handler>): typeof fetch; // クエリ文字列を落として照合する(records-harness の版)
export function blogTenantOf(role = "owner"): { id: "t1"; slug: "blog"; name: "Blog"; role: string };
// 2 つのハーネスに共通の既定: turnstile-config / tenants / me / token / modules(空)/ publications(空)
export function baseAuthedRoutes(overrides?: Record<string, Handler>, role?: string): Record<string, Handler>;
```

  - `records-harness.tsx` の `authedRoutes(overrides, role)` は `baseAuthedRoutes` に `content-types`(空)と `RECORD_1` の `publication` を重ねる。`shell-harness.tsx` の `authedRoutes(overrides)` は `baseAuthedRoutes` に `content-types`(記事 1 件の行)を重ねる。`shell-harness.tsx` の `blogTenant` は `export const blogTenant = blogTenantOf()` のまま残す(既存テストが spread で使う)。両ハーネスの `jsonResponse` / `stubFetch` / `Handler` は `api-stubs.ts` から re-export する(import 元を変えないため)。`renderAt` は両方とも現状の署名のまま
  - `records-harness.tsx` の `bootstrapped(socket, records, types = [articleType])`

- [ ] **Step 1: 失敗するテストを書く**

```ts
// packages/ui/src/progress.test.tsx
it("isLabelHidden は aria-label を残して見た目の題を出さない", () => {
  render(<ProgressBar label="公開しています…" value={2} maxValue={8} valueLabel="2 / 8 件" isLabelHidden />);
  expect(screen.getByRole("progressbar", { name: "公開しています…" })).toBeInTheDocument();
  expect(screen.queryByText("公開しています…")).not.toBeInTheDocument();
  expect(screen.getByText("2 / 8 件")).toBeInTheDocument();
});
// apps/admin/src/components/bulk-bar.test.tsx
it("実行中の文言は progressbar の名前として 1 回だけ読み上げる", () => {
  // progress={{ kind: "publish", done: 2, total: 8, onCancel }} で描く
  expect(screen.getByRole("progressbar", { name: "公開しています…" })).toBeInTheDocument();
  expect(screen.getAllByText("公開しています…")).toHaveLength(1); // Spinner の見た目の文字だけ(aria-hidden)
});
// packages/ui/src/toast.test.tsx
it("clear は溜まった通知を消す", () => {
  const t = createToaster();
  t.success("保存しました");
  t.clear();
  expect(t.queue.visibleToasts).toHaveLength(0);
});
// apps/admin/src/lib/publish-box.test.ts
it("公開状態の取得に失敗すると error 状態になり主ボタンは無効", () => {
  const view = publishBoxView({ ...base, publication: undefined, publicationError: true });
  expect(view.state).toStrictEqual({ kind: "error" });
  expect(view.primary?.isDisabled).toBe(true);
});
// apps/admin/src/publish-box-flow.test.tsx
it("公開状態の取得に失敗するとエラー文と再試行が出て、再試行で公開ボックスが描かれる", async () => {
  // /v1/t/t1/records/RECORD_1/publication を 1 回目 500、2 回目 200({ published: false })
  // publishBox() に role="alert" の「公開状態を取得できませんでした」→ 「再試行」を押す → 「未公開」のバッジ
});
// packages/ui/src/drawer.test.tsx 「暗幕を押すと閉じる」
//   overlay を親の親でたどる代わりに `await userEvent.setup().click(document.body)`(RAC の isDismissable は
//   モーダルの外の pointerdown で閉じる)。これで通らなければ現状のまま残し、報告に「未対応」と書く
```

`error-screen` のテストは無い(router の `defaultErrorComponent`)。`shell.test.tsx` などハーネス統合の影響は既存テストが担保する。

- [ ] **Step 2: テストが失敗することを確かめる**

Run: `corepack pnpm --filter @plyrs/ui exec vitest run src/progress.test.tsx src/toast.test.tsx src/drawer.test.tsx && corepack pnpm --filter @plyrs/admin exec vitest run src/components/bulk-bar.test.tsx src/lib/publish-box.test.ts src/publish-box-flow.test.tsx`
Expected: FAIL(新しい prop・`clear`・`kind: "error"` が無い)

- [ ] **Step 3: 実装する**

- `error-screen.tsx`: `colors` / `spacing` / `typography` を `text.default` / `text.muted` / `space.md`(gap)/ `space.xl`(padding)/ `font.family` / `font.pageTitle` に置き換え、文言は `ERROR_SCREEN`、detail は `error instanceof ApiError ? `${error.status}: ${error.code}` : errorMessage(error, ERROR_SCREEN.fallback)`
- `record-editor.tsx`: `publishBoxView({ ..., publicationError: publication.isError })`、`PublishBox` に `onRetryPublication={() => void publication.refetch()}`
- `bulk-bar.tsx`: `<span aria-hidden="true"><Spinner label={…} /></span>`、`ProgressBar` に `isLabelHidden`
- `vitest.setup.ts`: `toaster.queue.clear()` → `toaster.clear()`
- `api-stubs.ts` を作り、2 つのハーネスの重複を移す

- [ ] **Step 4: テストが通ることを確かめる**

Run: `corepack pnpm --filter @plyrs/ui exec vitest run && corepack pnpm --filter @plyrs/admin exec vitest run && corepack pnpm -r typecheck && corepack pnpm format && corepack pnpm lint`
Expected: PASS。`grep -rn "tokens.stylex" apps/admin/src/components` が `content-type-form.tsx` の 1 件だけ。`grep -rn "queue.clear" apps/admin` が 0 件

- [ ] **Step 5: `.design-sync/NOTES.md` に「V4 で変えた部品」(`ProgressBar` の `isLabelHidden`、`Toaster.clear`)を足してコミット**

```bash
git add apps/admin/src apps/admin/vitest.setup.ts packages/ui/src .design-sync/NOTES.md
```

```bash
git commit -m "fix(admin): V3 の最終レビューで持ち越した指摘を直す"
```

---

### Task 3: スロットの型、ホームの文言、純関数、型をまたいだ購読

**Files:**
- Modify: `packages/ui/src/slots.ts`、`packages/ui/src/slots.test.ts`
- Modify: `apps/admin/src/lib/labels.ts`
- Create: `apps/admin/src/lib/home.ts`
- Test: `apps/admin/src/lib/home.test.ts`
- Modify: `apps/admin/src/lib/use-collection.ts`、`apps/admin/src/components/record-form.tsx`(呼び出し側の改名)

**Interfaces:**
- Consumes: `sidebarContentTypes` / `moduleNavGroups`(`lib/navigation.ts`)、`toListSearch` / `publicationStateOf` / `ListQuery`(`lib/content-list.ts`)、`ModuleSummary`
- Produces:

```ts
// packages/ui/src/slots.ts(B5)
export interface HomeWidgetContribution extends SlotContributionBase {
  title: string;
  render: ComponentType;
  /** 2 列のグリッドでの幅。既定 half(1 列) */
  size?: "half" | "full";
  /** 指定があれば、そのモジュールが有効なテナントでだけ描く */
  moduleId?: string;
}

// apps/admin/src/lib/labels.ts(HOME_PLACEHOLDER は削除し、使っていた index.tsx は Task 5 で書き換える)
export const HOME_LABELS = {
  meta: (email: string, role: string) => `${email} ・ ${role}`,
  readOnly: "閲覧のみ",
  readOnlyMeta: (email: string) => `閲覧のみ ・ ${email}`,
  quickAdd: "新規追加",
  drafts: {
    title: "自分の下書き", note: "最後に自分が編集した 5 件",
    empty: "下書きはありません", emptyHint: "上の「新規追加」から書き始められます",
    seeAll: "下書きをすべて見る", failed: "下書きを表示できませんでした",
  },
  review: {
    title: "確認待ち", note: "型をまたいで集計", empty: "確認待ちのコンテンツはありません",
    description: {
      in_review: "公開前に確認が必要なもの", ready: "確認済みで、公開を待っているもの",
      changed: "公開後に編集されたもの",
    },
    changedFailed: "未反映の変更を確認できませんでした",
  },
  recent: { title: "最近の更新", note: "更新日時の新しい順に 10 件", empty: "まだ更新はありません" },
  count: (n: number) => `${n} 件`,
  typeCount: (name: string, n: number) => `${name} ${n}`,
  retry: "再試行",
  widgets: "モジュールのウィジェット", // グリッドの aria-label
  gettingStarted: {
    title: "はじめに",
    description: (site: string) => `「${site}」を使い始めるための手順です。1 つ目が終わると、ホームは普段の表示に変わります。`,
    createType: { title: "コンテンツタイプを作成する", body: "「お知らせ」「ブログ」のような、サイトに載せる内容の種類を決めます。タイトルや本文などのフィールドを持たせます。", action: "コンテンツタイプを作成" },
    uploadMedia: { title: "メディアをアップロードする", body: "画像や PDF を先に入れておくと、記事を書くときに選ぶだけで済みます。", action: "メディアを開く" },
  },
  noTypes: {
    title: "コンテンツの種類がまだありません",
    description: "サイトの管理者に、コンテンツタイプの作成を依頼してください。作成されると、ここに新規追加の入口と最近の更新が表示されます",
  },
} as const;

// apps/admin/src/lib/home.ts
export interface HomeType { key: string; name: string; group: "content" | "module" }
/** サイドバーと同じ順(B14)。同じ key が両群に出たら最初だけ */
export function homeTypes(
  types: readonly ContentTypeDefinition[],
  modules: readonly Pick<ModuleSummary, "moduleId" | "name" | "enabled" | "navTypes">[] | undefined,
): HomeType[];
export interface HomeRecord { record: SyncRecord; title: string; type: HomeType }
/** deletedAt が null で type が homeTypes にあるものだけ。updatedAt 降順、同時刻は id 降順 */
export function homeRecords(records: readonly SyncRecord[], types: readonly HomeType[], titleOf: (record: SyncRecord) => string): HomeRecord[];
export function myDrafts(rows: readonly HomeRecord[], userId: string, limit?: number): HomeRecord[]; // status === "draft" && updatedBy === userId、既定 5
export function recentUpdates(rows: readonly HomeRecord[], limit?: number): HomeRecord[]; // 既定 10
export interface TypeCount { type: HomeType; count: number }
export interface StatusSummary { total: number; byType: TypeCount[] } // byType は homeTypes の順、count > 0 だけ
export function countByStatus(rows: readonly HomeRecord[], status: WorkflowStatus): StatusSummary;
export function countMyDrafts(rows: readonly HomeRecord[], userId: string): StatusSummary;
export function countChanged(rows: readonly HomeRecord[], publications: ReadonlyMap<string, { sourceVersion: number }>): StatusSummary; // publicationStateOf(record, publication) === "changed"
export function listHref(slug: string, typeKey: string, query: Partial<ListQuery>): string; // `/t/${slug}/content/${typeKey}` + toListSearch を URLSearchParams にした `?…`(空なら付けない)
export function recordHref(slug: string, typeKey: string, recordId: string): string;
export function newRecordHref(slug: string, typeKey: string): string;

// apps/admin/src/lib/use-collection.ts
/** typeKeys のコレクションを束ねて購読する(現 useRelationCandidates の一般化。並びは呼び出し側が決める) */
export function useRecordsOfTypes(registry: CollectionRegistry, typeKeys: readonly string[]): SyncRecord[];
```

`useRelationCandidates` は削除し、`record-form.tsx` の呼び出しを `useRecordsOfTypes` に替える(候補の `id` 順の並べ替えは呼び出し側に移す)。

- [ ] **Step 1: 失敗するテストを書く**

```ts
// packages/ui/src/slots.test.ts
it("home:widget は size と moduleId を持てる", () => {
  registry.register("home:widget", { id: "booking.today", title: "今日の予約", order: 0, render: Widget, size: "full", moduleId: "booking" });
  expect(registry.get("home:widget")[0]?.size).toBe("full");
});
// apps/admin/src/lib/home.test.ts
it("homeTypes は利用者の型を menuOrder 順、続けて有効なモジュールの navTypes の順に並べる", () => {});
it("homeTypes は modules が未取得なら利用者の型だけを返す", () => {});
it("homeRecords はサイドバーに出ない型と削除済みを除き、更新日時の新しい順に並べる", () => { /* asset、無効モジュールの型、deletedAt あり */ });
it("myDrafts は自分が最後に編集した下書きだけを 5 件まで返す", () => { /* 他人の下書き・自分のレビュー中は除く、6 件目は切る */ });
it("countByStatus は型をまたいで数え、byType は homeTypes の順で 0 件の型を含まない", () => {});
it("countChanged は公開中かつ sourceVersion が古いものだけを数える", () => {});
it("listHref は既定値を省いたクエリを付け、空なら ? を付けない", () => {
  expect(listHref("blog", "article", { status: "in_review" })).toBe("/t/blog/content/article?status=in_review");
  expect(listHref("blog", "article", { tab: "unpublished-changes" })).toBe("/t/blog/content/article?tab=unpublished-changes");
  expect(listHref("blog", "article", {})).toBe("/t/blog/content/article");
});
```

- [ ] **Step 2: テストが失敗することを確かめる**

Run: `corepack pnpm --filter @plyrs/ui exec vitest run src/slots.test.ts && corepack pnpm --filter @plyrs/admin exec vitest run src/lib/home.test.ts`
Expected: FAIL(`lib/home.ts` が無い)

- [ ] **Step 3: 実装する**

`homeRecords` の並べ替えは `updatedAt` の文字列比較(ISO 8601 なので辞書順でよい)、同値は `id` 降順(UUIDv7 なので新しい順)。

- [ ] **Step 4: テストが通ることを確かめる**

Run: `corepack pnpm --filter @plyrs/ui exec vitest run && corepack pnpm --filter @plyrs/admin exec vitest run && corepack pnpm -r typecheck && corepack pnpm format`
Expected: PASS(`record-form.test.tsx` の relation picker のテストもそのまま通る)

- [ ] **Step 5: コミット**

```bash
git add packages/ui/src apps/admin/src
```

```bash
git commit -m "feat(admin): ホームの文言・集計の純関数と home:widget の size / moduleId を足す"
```

---

### Task 4: ホームの部品(枠・行・新規追加・下書き・確認待ち・最近の更新・ウィジェット・はじめに)

**Files:**
- Create: `apps/admin/src/components/home/home-card.tsx`、`quick-add-row.tsx`、`drafts-card.tsx`、`review-card.tsx`、`recent-card.tsx`、`widget-grid.tsx`、`getting-started.tsx`
- Test: `apps/admin/src/components/home/home-card.test.tsx`、`quick-add-row.test.tsx`、`drafts-card.test.tsx`、`review-card.test.tsx`、`recent-card.test.tsx`、`widget-grid.test.tsx`、`getting-started.test.tsx`

**Interfaces:**
- Consumes: Task 3 の `HOME_LABELS` / `HomeType` / `HomeRecord` / `StatusSummary` / `TypeCount` / `listHref` / `recordHref`、`WorkflowStatusBadge` / `PublicationBadge`(`components/publication-badge.tsx`)、`formatDateTime` / `RelativeTime`、`Button` / `Skeleton` / `EmptyState` / `ICON_SIZE` / `ICON_STROKE`、`HomeWidgetContribution`
- Produces:

```ts
// home-card.tsx
export function HomeCard(props: { title: string; note?: string; children: ReactNode }): JSX.Element;
// <section aria-labelledby={h2 の id}>。地 bg.surface、枠 stroke.default border.default、角 radius.container、
// padding space.md / space.lg、題 h2(font.body・font.weightBold)、note は題の右(font.caption・text.muted)
export function CardRow(props: { href?: string; children: ReactNode; "aria-label"?: string }): JSX.Element;
// 行 40px(b-home.md 2 章)、上罫線 border.default、gap space.inset。href があれば RAC Link(B10。hover で bg.hover)
export function CardEmpty(props: { icon: LucideIcon; text: string; hint?: string }): JSX.Element;
// B8: 上罫線の下に中央寄せ。アイコン ICON_SIZE.nav / ICON_STROKE.large、text は font.body text.muted、hint は font.caption
export function CardFooter(props: { children: ReactNode }): JSX.Element; // 上罫線 + paddingTop space.sm
export function CardLoadingRows(props: { count: number }): JSX.Element; // aria-hidden の Skeleton 行
export function TypeLinks(props: { items: TypeCount[]; hrefOf: (type: HomeType) => string }): JSX.Element;
// B1: 「お知らせ 2 ・ ブログ 1」。各項目は Link(font.caption)、区切りは「 ・ 」
export function SummaryLink(props: { summary: StatusSummary; hrefOf: (type: HomeType) => string; label: string }): JSX.Element;
// B1 の規則をまとめる: byType が 1 件なら label 1 つの Link、複数なら label(文字)+ TypeLinks

// quick-add-row.tsx
export function QuickAddRow(props: { types: readonly HomeType[]; onAdd: (typeKey: string) => void; isLoading?: boolean }): JSX.Element;
// 先頭に「新規追加」のラベル(span、text.muted、太字)。型ごとに Button variant="secondary" icon={Plus}。
// group が content → module に変わる境目に 1px × 24px の区切り線(aria-hidden)。isLoading は 3 つの丸いスケルトン(aria-hidden)。flex-wrap

// drafts-card.tsx
export type DraftsState =
  | { kind: "loading" }
  | { kind: "error"; message: string; onRetry: () => void }
  | { kind: "ready"; drafts: HomeRecord[]; summary: StatusSummary };
export function DraftsCard(props: { slug: string; state: DraftsState }): JSX.Element;
// ready: 行 = タイトル(Link → recordHref、省略記号)・型名(font.caption)・RelativeTime(formatDateTime(updatedAt))。
//   0 件 → CardEmpty(Pencil、empty、emptyHint)。summary.total > 0 なら CardFooter に SummaryLink(seeAll、listHref(status: "draft"))(B11)
// error: role="alert" の message と Button variant="link" icon={RotateCw}「再試行」

// review-card.tsx
export type ChangedState = { kind: "loading" } | { kind: "error"; onRetry: () => void } | { kind: "ready"; summary: StatusSummary };
export function ReviewCard(props: { slug: string; isLoading?: boolean; inReview: StatusSummary; ready: StatusSummary; changed: ChangedState }): JSX.Element;
// 行の順: レビュー中(WorkflowStatusBadge in_review)→ 公開準備完了(ready)→ 未反映の変更あり(PublicationBadge state="changed")。
// 各行 = バッジ + 説明(font.caption text.muted、flex: 1)+ 件数(24px の角丸、accent.surface / accent.default、太字)+ ChevronRight(text.muted)。
// total が 0 の行は出さない。3 行とも 0(changed が ready で 0)→ CardEmpty(CircleCheck、empty)。
// 行のリンクは B1: byType 1 件なら CardRow href、複数なら CardRow(href なし)の下に TypeLinks。
// changed が error → その行の位置に role="alert" の changedFailed と「再試行」。loading → その行だけ Skeleton
// 件数は VisuallyHidden で「件」を補い、行の名前が「レビュー中 公開前に確認が必要なもの 2 件」になるようにする

// recent-card.tsx
export function RecentCard(props: { slug: string; isLoading?: boolean; rows: readonly HomeRecord[] }): JSX.Element;
// 行 = タイトル(Link → recordHref)・型名(幅 80px、font.caption)・WorkflowStatusBadge(幅 96px 中央、archived は isStruck)・RelativeTime(幅 110px 右寄せ)。
// NARROW では型名とバッジを隠す(H 10 章「優先度の低い列」)。0 件 → CardEmpty(Inbox、empty)

// widget-grid.tsx
export function WidgetGrid(props: { widgets: readonly HomeWidgetContribution[] }): JSX.Element | null;
// 0 件なら null。<div role="region" aria-label={HOME_LABELS.widgets}> の 2 列グリッド(NARROW は 1 列)。
// 各ウィジェットは HomeCard(title)の中に <contribution.render />。size === "full" は gridColumn "1 / -1"

// getting-started.tsx
export function GettingStarted(props: { siteName: string; onCreateType: () => void; onOpenMedia: () => void }): JSX.Element;
// 幅 760px までの HomeCard 風の枠(padding space.lg)。h2「はじめに」(font.sectionTitle)+ description。
// 手順は <ol>: 番号の円 32px(accent.surface / accent.default)+ h3(font.label)+ 本文(font.body text.muted)+ ボタン。
// 1 は Button(primary)「コンテンツタイプを作成」、2 は Button variant="secondary"「メディアを開く」(B4)
export function NoTypesNotice(): JSX.Element; // EmptyState(icon LayoutGrid、noTypes.title / description)。最大幅 760px
```

- [ ] **Step 1: 失敗するテストを書く**

部品単位(直接描画。`Link` の `href` は `RouterProvider` 無しでも `<a href>` として描かれる)。

```ts
// home-card.test.tsx
it("CardRow は href があればリンクになり、無ければ div", () => {});
it("SummaryLink は型が 1 つならリンク 1 つ、複数なら型ごとのリンクを並べる", () => {
  // byType 1 件: getByRole("link", { name: "下書きをすべて見る" }) の href が /t/blog/content/article?status=draft
  // byType 2 件: getByText("下書きをすべて見る") はリンクでなく、link「お知らせ 2」「ブログ 1」が並ぶ
});
// quick-add-row.test.tsx
it("型ごとのボタンをサイドバーの順に並べ、押すと onAdd に key を渡す", async () => {});
it("利用者の型とモジュールの型の間に区切りを置き、読み込み中はスケルトンだけを出す", () => {});
// drafts-card.test.tsx
it("自分の下書きを行に出し、フッターの「下書きをすべて見る」はその型の下書き一覧へ", () => {});
it("0 件なら「下書きはありません」と案内を出す", () => {});
it("error なら alert と再試行を出し、再試行で onRetry を呼ぶ", async () => {});
// review-card.test.tsx
it("レビュー中・公開準備完了・未反映の行を件数付きで出し、1 つの型なら行が一覧へのリンク", () => {
  // link { name: /レビュー中/ } の href が /t/blog/content/article?status=in_review、
  // link { name: /未反映の変更あり/ } の href が …?tab=unpublished-changes
});
it("複数の型にまたがる行はリンクにせず、型ごとの内訳リンクを添える", () => {});
it("すべて 0 件なら「確認待ちのコンテンツはありません」", () => {});
it("未反映の取得に失敗した行だけが alert と再試行になる", () => {});
// recent-card.test.tsx
it("更新日時の新しい順に型名・ステータス・相対時刻を出し、アーカイブは取り消し線", () => {});
it("0 件なら「まだ更新はありません」", () => {});
// widget-grid.test.tsx
it("ウィジェットを h2 の題付きで描き、full は 2 列分", () => { /* style に grid-column: 1 / -1 */ });
it("0 件なら何も描かない", () => {});
// getting-started.test.tsx
it("2 つの手順と行き先のボタンを出し、押すとコールバックを呼ぶ", async () => {});
it("NoTypesNotice は依頼の案内を出し、メールアドレスを含まない", () => {});
```

- [ ] **Step 2: テストが失敗することを確かめる**

Run: `corepack pnpm --filter @plyrs/admin exec vitest run src/components/home`
Expected: FAIL(部品が無い)

- [ ] **Step 3: 実装する**

- [ ] **Step 4: テストが通ることを確かめる**

Run: `corepack pnpm --filter @plyrs/admin exec vitest run src/components/home && corepack pnpm -r typecheck && corepack pnpm format`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add apps/admin/src/components/home
```

```bash
git commit -m "feat(admin): ホームの枠・行・新規追加・下書き・確認待ち・最近の更新・はじめにの部品を作る"
```

---

### Task 5: ホームのルート(配線、読み込み中、権限、型 0 件、ウィジェット)

**Files:**
- Modify: `apps/admin/src/routes/t/$tenantSlug/index.tsx`(書き換え)
- Create: `apps/admin/src/home-flow.test.tsx`
- Modify: `apps/admin/src/shell.test.tsx`(「ホームの暫定」の describe を削除)
- Modify: `apps/admin/src/lib/labels.ts`(`HOME_PLACEHOLDER` の削除。参照が消えるのはこのタスク)

**Interfaces:**
- Consumes: Task 3 の純関数と `useRecordsOfTypes`、Task 4 の部品、`meQueryOptions(api)` / `modulesQueryOptions` / `publicationsQueryOptions(adminApi, tenant.id)`、`useTenantSync` / `useSyncTypes` / `useSyncHasSynced`、`useCan`、`labelForRecord`、`roleLabel`、`TenantPageHeader` / `PageBody`、`currentCrumb`
- Produces: `/t/$tenantSlug/` は転送しない。`component: HomePage`。`beforeLoad` は無し

`HomePage` の配線:

- `const { tenant, api, adminApi, slots } = Route.useRouteContext()`、`sync = useTenantSync()`、`types = useSyncTypes(sync)`、`hasSynced = useSyncHasSynced(sync)`、`me = useQuery(meQueryOptions(api))`、`modules = useQuery(modulesQueryOptions(adminApi, tenant.id))`、`publications = useQuery({ ...publicationsQueryOptions(adminApi, tenant.id), enabled: hasSynced })`、`canWrite = useCan("record:write")`、`canManageTypes = useCan("type:manage")`
- `homeTypeList = useMemo(() => homeTypes(types, modules.data), …)`、`records = useRecordsOfTypes(sync.registry, homeTypeList.map((t) => t.key))`、`rows = useMemo(() => homeRecords(records, homeTypeList, (r) => labelForRecord(types, r)), …)`
- 判定の段階(B12・B13): `typesSettled = hasSynced && !modules.isPending`。`!typesSettled` → 読み込み中の表示(h1「ホーム」、新規追加の行は `isLoading`、3 つの枠は `isLoading` / `kind: "loading"`、本文の入れ物に `aria-busy="true"`)。`typesSettled && homeTypeList.length === 0` → `canManageTypes ? <GettingStarted siteName={tenant.name} …/> : <NoTypesNotice />`。それ以外 → 普段の表示
- `meta`(B6): `canWrite ? (me.data ? HOME_LABELS.meta(me.data.email, roleLabel(tenant.role)) : roleLabel(tenant.role)) : <Lock /> + (me.data ? readOnlyMeta(me.data.email) : readOnly)`
- 下書きの枠の状態(B7): `me.isPending` → loading、`me.isError` → `{ kind: "error", message: errorMessage(me.error, HOME_LABELS.drafts.failed), onRetry: () => void me.refetch() }`、それ以外 → `{ kind: "ready", drafts: myDrafts(rows, me.data.userId), summary: countMyDrafts(rows, me.data.userId) }`
- 確認待ち: `inReview = countByStatus(rows, "in_review")`、`ready = countByStatus(rows, "ready")`、`changed`: `publications.isPending` → loading、`isError` → `{ kind: "error", onRetry: refetch }`、それ以外 → `countChanged(rows, Map(recordId → { sourceVersion }))`
- 新規追加(B20): `onAdd = (typeKey) => navigate({ to: "/t/$tenantSlug/content/$typeKey/new", params })`。`canWrite` のときだけ `QuickAddRow` と `DraftsCard` を描き、閲覧者は「確認待ち」と「最近の更新」を全幅で並べる(D3 H2)
- ウィジェット(B5・B13): `slots.get("home:widget").filter((w) => w.moduleId === undefined || modules.data?.some((m) => m.moduleId === w.moduleId && m.enabled) === true)`
- 配置: 本文は `display: flex; flex-direction: column; gap: space.lg`。「下書き / 確認待ち」とウィジェットは 2 列グリッド(`repeat(2, minmax(0, 1fr))`、NARROW で 1 列)
- パンくずは `[currentCrumb(NAV_LABELS.home)]`(ホームは最上位)

- [ ] **Step 1: 失敗するテストを書く**

`home-flow.test.tsx`(records-harness の `renderAt("/t/blog", harness, routes)` と `bootstrapped(socket, records, types)`。モーダルを開かないので 1 ファイルでよい)。型は `articleType`(記事、`menuOrder: 2`)と `noticeType`(お知らせ、key `notice`、`menuOrder: 1`)、必要なテストで `bookingType`(`booking.slot`、`source: "plugin"`、`pluginId: "booking"`)と `assetType`(`source: "system"`)。`/v1/t/t1/modules` は必要なテストで `{ moduleId: "booking", name: "予約", enabled: true, navTypes: ["booking.slot"], … }` を返す。

```ts
it("同期前は見出しを残して中身だけスケルトンにし、同期後に消える", async () => {
  // h1「ホーム」が最初から見える。本文の aria-busy=true。bootstrapped の後に aria-busy が消え、heading level 2「自分の下書き」など 3 つ
});
it("新規追加はサイドバーの順(お知らせ → 記事 → 予約枠)で並び、押すと作成画面へ移る", async () => {
  // button { name: "お知らせ" } … → click「記事」→ pathname が /t/blog/content/article/new
});
it("自分の下書きは最後に自分が編集した下書きだけを新しい順に 5 件出し、フッターは型の下書き一覧へ", async () => {
  // me は u1。u1 の下書き 6 件(記事 4・お知らせ 2)+ u2 の下書き 1 + u1 のレビュー中 1。枠内の link は 5 件、u2 と in_review は無い。
  // フッター: 型が 2 つなので「お知らせ 2 ・ 記事 4」の link。href = /t/blog/content/notice?status=draft
});
it("確認待ちは型をまたいで数え、複数の型なら内訳リンク、未反映は公開状態から数える", async () => {
  // in_review: 記事 2(1 型 → 行がリンク、href ?status=in_review)。ready: 記事 1 + お知らせ 1(内訳リンク 2 つ)。
  // publications: 記事 1 件 published sourceVersion 1 で record.version 2 → 「未反映の変更あり」1 件、href ?tab=unpublished-changes
});
it("最近の更新は型をまたいで新しい順に 10 件、行は編集画面へ", async () => {
  // 12 件 → 枠内の link が 10。先頭が最新。href = /t/blog/content/<type>/<id>。バッジと相対時刻(role time)がある
});
it("自分の情報の取得に失敗すると下書きの枠だけにエラーと再試行が出る", async () => {
  // /auth/me 1 回目 500 → within(自分の下書き) に role alert、「確認待ち」「最近の更新」は普通に描かれる。
  // 2 回目 200 → 「再試行」→ 下書きの行が出る(Review Focus 1)
});
it("公開状態の取得に失敗すると未反映の行だけがエラーと再試行になる", async () => {
  // /v1/t/t1/publications 1 回目 500 → 「レビュー中」の行はある、within(確認待ち) に alert「未反映の変更を確認できませんでした」。2 回目 200 → 再試行 → 行が出る(Review Focus 2)
});
it("閲覧者には新規追加と下書きが無く、見出しの右に「閲覧のみ」が出る", async () => {
  // role viewer: queryByText("新規追加") が無い、heading「自分の下書き」が無い、見出しの右に「閲覧のみ ・ owner@example.com」。最近の更新の行の href は同じ編集 URL
});
it("型 0 件の管理者には「はじめに」が出て、型が届くと普段の表示に変わる", async () => {
  // welcome の contentTypes: [] → heading「はじめに」、button「コンテンツタイプを作成」→ click で /t/blog/settings/content-types/new。
  // 戻って socket.deliver({ type: "content-types", contentTypes: [articleType] }) → 「はじめに」が消え「新規追加」が出る(Review Focus 3)
});
it("型 0 件の編集者には依頼の案内だけを出す", async () => {
  // role editor: 「コンテンツの種類がまだありません」、「はじめに」は無い、本文に "@" を含む文字が無い(B3)
});
it("home:widget は 2 列に並び、full は 2 列分、moduleId 付きは有効なモジュールのときだけ描く", async () => {
  // createAppContext の slots に 3 つ register(a: half、b: full、c: moduleId "other" 無効)。region「モジュールのウィジェット」内の heading が a・b の 2 つ、b の section の style が grid-column: 1 / -1
});
it("メディアと無効なモジュールの型のレコードは最近の更新に出ない", async () => {
  // asset のレコードと booking.slot(modules で enabled: false)のレコードを混ぜる → 最近の更新に出ない(Review Focus 4)
});
it("モジュール一覧の取得に失敗してもホームは描かれる", async () => {
  // /v1/t/t1/modules 500 → 新規追加に利用者の型だけ、moduleId 付きウィジェットは無し、aria-busy は消える(Review Focus 5)
});
```

`shell.test.tsx` の describe「ホームの暫定(案 A 9 章、2026-10-19 裁定)」(3 本)を削除する。

- [ ] **Step 2: テストが失敗することを確かめる**

Run: `corepack pnpm --filter @plyrs/admin exec vitest run src/home-flow.test.tsx`
Expected: FAIL(転送されて h1「ホーム」が出ない)

- [ ] **Step 3: 実装する**

`index.tsx` を書き換える。`contentTypesQueryOptions` / `redirect` / `sidebarContentTypes` / `can` の import は消える。

- [ ] **Step 4: テストが通ることを確かめる**

Run: `corepack pnpm --filter @plyrs/admin exec vitest run && corepack pnpm -r typecheck && corepack pnpm format && corepack pnpm lint`
Expected: PASS。`grep -rn "HOME_PLACEHOLDER" apps/admin/src` が 0 件

- [ ] **Step 5: コミット**

```bash
git add apps/admin/src
```

```bash
git commit -m "feat(admin): ホームを案 B の形(新規追加・下書き・確認待ち・最近の更新・ウィジェット)にする"
```

---

### Task 6: E2E のヘルパーを新しい着地点に合わせる

**Files:**
- Modify: `apps/e2e/helpers/setup.ts:101-110`(`loginAsUser`)

**Interfaces:**
- Produces: `loginAsUser` は `page.waitForURL(/\/t\/[^/]+(\/|$)/)` で待つ(B18)。`createArticleType` 以降は変更なし(サイドバーの「設定」から入る導線はそのまま)

- [ ] **Step 1: ヘルパーを直す**

`loginAsUser` の正規表現を B18 のとおりにし、コメントを「所属 1 件ならサイト選択を飛ばしてホームに着地する(型の有無で転送しない)」に改める。

- [ ] **Step 2: E2E を回す(ユーザーに依頼。サンドボックスの外。`apps/api/.wrangler` / `apps/admin/.wrangler` が消える)**

Run: `pnpm --filter @plyrs/e2e test`
Expected: 3 spec が PASS

- [ ] **Step 3: コミット**

```bash
git add apps/e2e
```

```bash
git commit -m "test(e2e): ログイン後にホームへ着地する導線に合わせる"
```

---

### Task 7: 全体の検証、preview での実機確認、報告

**Files:**
- 変更なし(問題が見つかったときだけ該当ファイルを直す)

- [ ] **Step 1: 静的検査とテスト**

Run: `corepack pnpm lint && corepack pnpm format:check && corepack pnpm -r typecheck && corepack pnpm -r --filter "!@plyrs/e2e" test`
Expected: すべて成功(ui の RAC のテストがタイムアウトしたら単独で再実行)。`grep -rln "tokens.stylex" apps/admin/src/components apps/admin/src/routes/t` が `content-type-form.tsx` だけ

- [ ] **Step 2: ビルド(ユーザーに依頼)**

Run: `pnpm --filter @plyrs/admin build`
Expected: 成功

- [ ] **Step 3: dev での見た目の確認(ユーザーに依頼。`run` スキルを使ってよい)**

依頼書 3 章「確認する状態」のホームの行に沿って、owner / editor / viewer で見る:

- 読み込み中: h1「ホーム」のまま、各枠の見出しが残って中身がスケルトン。「同期中…」の 1 行表示が出ない
- 管理者: 新規追加のボタンがサイドバーと同じ順(モジュールの型の前に区切り)、自分の下書きが 5 件まで・他人の下書きが出ない、確認待ちの 3 行と件数、1 つの型なら行がリンク・複数なら内訳リンク、最近の更新が 10 件で相対時刻のホバーに日時、ウィジェット(モジュールが登録していれば)
- 自分の下書き 0 件・確認待ち 0 件: 見出しが残って枠内に 1 行の文
- 型 0 件: owner は「はじめに」の 2 手順と行き先、editor / viewer は依頼の案内(メールアドレス無し)。型を作って戻ると普段の表示
- 閲覧者: 新規追加と下書きが無く、確認待ちと最近の更新が全幅、見出しの右に「閲覧のみ ・ email」
- 編集画面: api を止めて開く → 公開ボックスの状態に「公開状態を取得できませんでした」と再試行、戻してから再試行で状態が出る(B16)
- 一覧の一括操作: 実行中の文言が 1 か所(B17)
- 狭い画面(959px 以下): 2 列が 1 列、最近の更新で型名とバッジが隠れる。ダーク: 枠・件数・バッジ・区切り線の配色(D3 C1)

- [ ] **Step 4: ブランチの仕上げ**

superpowers:finishing-a-development-branch に従い、統合方法(ローカルマージ / push して PR / 残す)をユーザーに提示して選んでもらう。push はユーザーに確認してから(`git -c credential.helper='!gh auth git-credential' push https://github.com/hiz8/plyrs.git <branch>`、PR は `gh pr create --repo hiz8/plyrs`)。ワークツリー隔離のセッションでは main 側の git 操作が拒否されるため、ローカルマージは ExitWorktree(keep) で main に戻ってから行う。

- [ ] **Step 5: preview での実機確認(ロードマップ 5 章の注記。ユーザーに依頼)**

main への反映で preview に自動デプロイされる。`/t/<slug>` を直接開いて描画されること(SPA シェルの転送)、ホームから一覧へのリンク(`?status=in_review`、`?tab=unpublished-changes`)が絞り込み済みで開くこと、ブラウザの戻るでホームに戻ること、ウィジェット(あれば)の配置を確かめる。食い違いがあれば報告する(直すか後続に回すかはユーザーが決める)。

- [ ] **Step 6: 報告**

ユーザーに次をまとめて報告する: 裁定台帳(B1〜B20)と設計書への書き戻し、D3 にあって V4-B に入れなかったもの(「はじめに」の手順 3、管理者のメールアドレス、ウィジェットの有効化順)、V3 持ち越しの処理結果(Task 2 の 6 点。drawer.test が通らなければ「未対応」)、後続の計画へ送ったもの(B19)、E2E・preview で見つかった食い違い、`.design-sync/NOTES.md` に記録した ui の変更(再同期は V4-F の最後)。

---

## セルフレビュー(2026-10-20)

- 仕様の網羅: B 2 章(枠の配置・カード・読み込み中・0 件)→ Task 4・5。2.1(新規追加・順序・viewer 非表示)→ Task 3(`homeTypes`)・4・5。2.2(自分の下書き 5 件・`updatedBy`・すべて見る・viewer 非表示)→ Task 3・4・5。2.3(確認待ちの集計・行のリンク・0 件、B2 の未反映)→ Task 3・4・5。2.4(最近の更新 10 件・列・相対表記・対象の型)→ Task 3・4・5。2.5(`home:widget`・size・順序)→ Task 3・4・5。2.6(はじめに・依頼の案内)→ Task 4・5。3 章(同期データから計算・`me`・スケルトン)→ Task 5。5 章(権限)→ Task 5。H 2 章(骨格)→ Task 5。H 6 章(状態)→ Task 2(ErrorScreen)・4・5。H 7 章(権限)→ Task 5。H 10 章(画面幅)→ Task 4・5。H 11 章(a11y: h2 の題、aria-busy、alert)→ Task 4・5。a 9 章(暫定の置き換え)→ Task 1・5。V3 持ち越し → Task 2(B19)
- 型の整合: `HomeType` / `HomeRecord` / `StatusSummary` / `TypeCount`(Task 3)を Task 4 の部品の props と Task 5 の配線で使う。`DraftsState` / `ChangedState`(Task 4)を Task 5 が組み立てる。`HomeWidgetContribution.size` / `moduleId`(Task 3)を Task 4 の `WidgetGrid` と Task 5 の絞り込みで使う。`publishBoxView` の `publicationError` と `PublishBoxProps.onRetryPublication`(Task 2)は `record-editor.tsx` の 1 か所で結ぶ。`baseAuthedRoutes` / `blogTenantOf`(Task 2)を両ハーネスが使い、Task 5 のテストは records-harness の `renderAt` / `bootstrapped(…, types)` を使う
- Review Focus: 5 項目すべてに Task 3・5 のテスト名を結んだ
- ステップの粒度: 各タスクのコード本体は署名と pinned な値(文言・寸法・順序の規則)だけで、アルゴリズムを決める必要がある箇所(`homeRecords` の並べ替え、B1 のリンクの規則、B13 の判定の段階)だけ 1 行で書いた
- 入れなかったもの(範囲外として報告): 最終更新者の名前(B 6 章、案 G 以降)、ウィジェットの非表示設定(B 6 章)、アクセス解析・お知らせ(B 4 章)、「ホームへ戻る」ボタン(B15)
