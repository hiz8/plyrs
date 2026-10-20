# 管理画面 UX 再構築 V4-E: 型設計(案 E) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 設定 › コンテンツタイプのタブの中身(型の一覧・並べ替え・削除)と、型の作成・編集画面(表示名 / API 名 / 説明、48px のフィールド行、右パネルの詳細設定、2 段階のフィールド追加ダイアログ、変更時のインライン注意)を案 E 3〜5 章と D3 T1〜T5 のとおりに作り直し、旧 `content-type-form.tsx`(素の `<table>`、常時展開、旧トークンの最後の参照)を消す。あわせて V4-G の後回し(設定のタブを Enter で選ぶとフォーカスが body へ落ちる)を直す。

**Architecture:** 画面の判断は純関数に寄せ、部品は描くだけにする(V2〜V4-G と同じ)。型定義の下書き(`TypeDraft` / `FieldDraft`)と、利用者向けの「種類」(`FieldKind`、10 種)と内部の型 + 設定の対応、API 名の提案 / 検証、変更の検出と件数は `lib/content-type-form.ts`(作り直し)。一覧のグループ分け・件数・`menuOrder` の更新は `lib/content-types.ts`(新規)。ui に `SortableList`(RAC `GridList` + `useDragAndDrop`、E1)と `SidePanel`(非モーダルの RAC `Dialog`、E2)を足し、`ModalDialog` に `size="lg"`(E23)を足す。型の一覧は `SettingsFrame tab="content-types"` の中身、作成 / 編集は `TypeEditor`(見出し + 本文 + パネル + ダイアログ)をルートが薄く包む。型定義は HTTP(`contentTypesQueryOptions` / `putContentType` / `deleteContentType`)で読み書きし、コンテンツの件数と変更の注意の件数だけ同期データ(`useRecordsOfTypes`)から数える(同期前は出さない)。確認は `ConfirmDialog`、結果は `toaster`、見た目はセマンティックトークンと `@plyrs/ui` の部品だけ。

**Tech Stack:** StyleX 0.19.1、react-aria-components 1.21.1(`GridList` / `useDragAndDrop` / `DropIndicator` / `Dialog`。`Link` と `components/shell/` 以外は ui の部品経由)、TanStack Router 1.170.18、TanStack Query 5、lucide-react、Vitest + jsdom + Testing Library、Playwright

**Spec:**
- `docs/admin-ux/e-content-type-design.md`(3 章 種類の選び方、4 章 言い換え、5 章 画面の構成(5.1〜5.4)、6 章 読む側(本計画は書く側だけ)、8 章 決定ログ。2 章はメタモデル(T6 で実装済み)、7 章 未決は範囲外)
- `docs/admin-ux/h-common-surface.md`(2 章 骨格、3 章 部品、4 章 文言、6 章 状態、7 章 権限、8 章 確認の使い分け、10 章 画面幅、11 章 アクセシビリティ、12 章 アイコン)
- `docs/admin-ux/h-design-tokens.md`(3 章 セマンティックトークン)
- `docs/superpowers/plans/2026-10-17-admin-ux-rebuild-roadmap.md` 5 章 V4
- `docs/superpowers/plans/2026-10-20-admin-ux-v4g-settings.md`(`SettingsFrame` / `DialogNote` / `CardLoading` の契約、裁定 G4・G5・G23・G25)
- `docs/admin-ux/design-briefs/03-remaining-screens.md` 3 章「確認する状態」の「型設計」(新規作成、フィールド 0 件、ドラッグで並べ替え中、フィールドを削除するときの注意、API 名の入力エラー)と「共通」(ダーク、狭い画面)
- キャンバス https://claude.ai/artifact/K57TVUfpefMuiPxhZXyAnU のページ「D3 残りの画面」の T1〜T5。フレームは `project/D3-Types.dc.html`(T1 一覧)、`D3-Type-Edit.dc.html`(T2 編集 + 右パネル)、`D3-Type-New.dc.html`(T3 新規・フィールド 0 件)、`D3-Type-Picker.dc.html`(T4 種類を選ぶ → 表示名)、`D3-Type-Warnings.dc.html`(T5 並べ替え中・削除の注意・API 名のエラー)。設計書と食い違うときは設計書を優先する(食い違いは「裁定台帳」に記し、Task 1 で設計書に書き戻し、最後に報告する)

## Global Constraints

- 画面と部品が参照するのはセマンティックトークン(`@plyrs/ui/semantic.stylex`)だけ。本計画の最後に `grep -rln "tokens.stylex" apps/admin/src/components apps/admin/src/routes/t` が 0 件になる(`content-type-form.tsx` の削除で消える。`routes/super/**`・`login.tsx`・`signup.tsx` は V4 の範囲外)
- キャンバスの寸法は尺度に寄せる(V1〜V4-G と同じ対応表): 文字 13px→14px(`font.body`)、12px→`font.caption`、11px→`font.caption`、15px→16px(`font.label`)、16px→`font.label`、20px→`font.sectionTitle`、24px→`font.pageTitle`。余白 10px→12px(`space.inset`)、6px→8px(`space.sm`)、4px→`space.xs`、16px→`space.md`、18px→`space.md`、20px→24px(`space.lg`)、32px→`space.xl`。部品固有の寸法は数値で書き、コメントで根拠(e-content-type-design.md の章 / D3 T1〜T5)を添える: 本文の最大幅 880px(`SETTINGS_MAX_WIDTH`、一覧も作成・編集も)、フィールドの行 48px(E 5.2。`SortableList rowHeight="tall"`)、型の一覧の行 44px(`size.row`、E6)、右パネル 420px(E 5.2)、種類のカードの 3 列グリッド間隔 `space.sm`、`ModalDialog size="lg"` 640px(E23)、つまみ・タグ内のアイコン `ICON_SIZE.inline`、空状態のアイコン 32px
- 幅 960px 未満の切り替えは CSS のメディアクエリ `"@media (max-width: 959px)"` だけで行う(各ファイルに `const NARROW`。JS の `matchMedia` は使わない)。一覧は「フィールド」の列を隠す、作成 / 編集の 2 列グリッド(表示名 / API 名)は 1 列、種類のカードは 1 列、フィールドの行は種類とタグを折り返す、右パネルは全面のシート(`insetInline: 0`)、パネルを開いている間の本文の右余白 420px は 0(E29・E30)
- 画面上の呼称と文言は `lib/labels.ts` に置く(画面・部品に日本語を直書きしない。例外: テストの断言)。内部の型名(`text` `relation` `indexed` `cardinality` `snapshotEmbed` `version` `source`)を画面に出さない。API 名(key)は等幅(`font.familyMono` / `TextField isMonospace`)。文体は「です・ます」、ボタンは操作名(H 4.2)。確認ダイアログのボタンは「OK」にしない
- エラーは `lib/error-messages.ts` の `errorMessage(cause, fallback)` で利用者向けの文にする(`type_not_empty` / `id_mismatch` / `key_mismatch` は既にある)。入力の問題はフィールドの下(API 名は例つき、E15)、操作の失敗はトースト(エラー色)、取得の失敗は `SettingsFrame` の `error`(`isLoadingError`)
- 見出しは 1 画面に `h1` が 1 つ(一覧は「設定」、作成は「コンテンツタイプを作成」、編集は型名)。右パネルの題と種類の選択ダイアログの題は RAC の `Heading slot="title"`
- アイコンは `lucide-react`、ボタン・バッジの中は `ICON_SIZE.inline`、装飾は `aria-hidden`。使うアイコン(H 12 章): grip-vertical(つまみ)/ plus(追加・列を追加)/ x(閉じる・列を外す)/ triangle-alert(変更の注意)/ layout-grid(空状態)/ chevron-left(種類を選び直す)。種類のカードのアイコン: type(テキスト)/ pilcrow(リッチテキスト)/ hash(数値)/ calendar(日時)/ square-check(チェックボックス)/ list(選択肢)/ image(画像・ファイル)/ link(他のコンテンツへの参照)/ at-sign(URL スラッグ)/ braces(JSON)
- 権限の出し分けは `useCan("type:manage")` だけ(ロールの直書き禁止)。設定は `settings/route.tsx` の guard で owner だけ(G5)。`type:manage` が無ければ一覧はつまみ・「削除」・「編集」を出さず「フィールドを見る」だけ、作成 / 編集ルートは `mode="view"`
- 確認は `ConfirmDialog`。型の削除と保存済みフィールドの削除は `tone="danger"`(初期フォーカスはキャンセル、H 8 章)。保存・適用・並べ替えは確認なし
- RAC の部品を admin から直接使う例外は `Link`(表・一覧の中のリンク。R23・B10・G28)と `components/shell/` だけ。右パネルの `Dialog` / `Heading`、`GridList` 系は ui の中に閉じる
- `@ts-expect-error` は使わない。素の `git stash` は使わない。コメント・ドキュメント・コミットメッセージは日本語。コミットは各タスクの最後に 1 つ(`/commit` スキルの規約。帰属行は付けない。タイトルは 50 文字以内)。git は 1 回の呼び出しに 1 コマンド(`git add … && git commit …` の複合は使わない)
- サンドボックスの道具: `pnpm` は `corepack pnpm`。ルートの `pnpm typecheck` / `pnpm test` は使わず `corepack pnpm -r typecheck`、`corepack pnpm -r --filter "!@plyrs/e2e" test`(この 1 コマンドだけバックグラウンド可。リダイレクトやループと組み合わせない)。`corepack pnpm format:check` の「No config found, using defaults」は正常な警告。`routeTree.gen.ts` の再生成は `corepack pnpm --filter @plyrs/admin build`(prerender がネットワークで失敗しても gen は更新される)。本計画で新しいルートは足さない(既存の 3 ルートを書き換えるだけ)ので、再生成が要るのはファイルを消したり足したりしたときだけ
- `docs/` と `.design-sync/` は oxfmt の対象外。それ以外は各タスクの最後に `corepack pnpm format` をかけ、コントローラがタスクごとに `corepack pnpm format:check` を確かめる(実装者の「format 済み」報告だけで済ませない)
- ロードマップ 5 章の注記どおり preview で実機確認する(Task 10)。push とコミットはユーザーに確認してから
- design-sync の再同期(V2・V3・V4-B・V4-G・本計画分)は V4-F の計画の末尾に 1 回まとめて行う。本計画で ui を変えた分(`SortableList`・`SidePanel` の新設、`ModalDialog.size`)は `.design-sync/NOTES.md` の「V4 で変えた部品」に記録だけする
- テストの割り振り(V4-G の注意): ダイアログ・パネル・Select は部品単位(`components/content-types/*.test.tsx` の直接描画。1 つの `it` でモーダルを 2 回開かない)。router 経由でモーダル(種類の選択ダイアログ、削除の確認)を開くテストは **1 ファイル 1 本**(`content-types-new.test.tsx`、`content-types-delete.test.tsx`、`content-types-field-delete.test.tsx`)。モーダルを開く操作は `fireEvent.click`。Select を使う router テストは `vi.mock` で素の `<select>` に(`role-select-mock.tsx` の様式。本計画では `list-columns-select.tsx` を 1 ファイルに分けて差し替える)。トーストは `within(screen.getByRole("region", { name: "通知" }))`。`SidePanel` は非モーダルなので router テストで何度開いてもよい
- ドラッグの並べ替えのテスト(E31): ui の `SortableList` はキーボード操作(つまみにフォーカス → Enter → ArrowDown → Enter)で `onReorder` を断言する。admin 側は `onReorder` に渡る並びから先(`menuOrderUpdates`・PUT の順)を純関数と router テストで断言し、ドラッグそのものは再現しない。jsdom で RAC のキーボード DnD が動かなければ実装者は報告し、コントローラが Ruling(つまみの存在と `reorderIds` の単体テストに切り替え、実機で確認)を台帳に書く
- サブエージェントへのディスパッチ文には、作業ツリーのパスを `cd` 付きで強制すること、`git log --oneline -2` の実出力を貼らせること、テストの実出力を貼らせること、`@ts-expect-error` 禁止と素の `git stash` 禁止、git は 1 回 1 コマンド、サブエージェントを spawn しないこと、報告ファイルを必ず書くこと、サンドボックスの placeholder のドットファイル(`.bashrc` `.zshrc` `.gitconfig` `.mcp.json` `.claude/*` など 0 バイト)を add / 削除しないことを含める

## 裁定台帳(2026-10-20)

計画を書く時点で決めたこと。E1〜E4 はユーザー裁定。Task 1 で設計書に書き戻し、最終報告で一覧にする。番号は本文から参照する。

| #   | 項目                                                       | 裁定                                                                                                                                                                                                                                                                                                                                                                                      |
| --- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E1  | ドラッグの並べ替えの部品(E 5.1・5.2、T5)                   | ui に `SortableList`(RAC `GridList` + `useDragAndDrop` + `DropIndicator`)を新設。マウス・タッチ・キーボード(つまみにフォーカス → Enter / Space でつかむ → ↑↓ → Enter / Space で置く)。つかんだ行は `bg.raised` + `elevation.menu` で浮き、落とす位置は `accent.default` の点線。ユーザー裁定                                                                                                |
| E2  | 右パネル(E 5.2「狭い画面ではモーダル」)                    | ui に非モーダルの `SidePanel`(RAC `Dialog` を右に固定、420px)を新設。開くとパネルへ、閉じると開いた「編集」へフォーカスを戻し、Esc で閉じる。狭い画面は CSS だけで全面のシートにする(フォーカスの閉じ込めは無い = 厳密なモーダルではない)。一覧を見ながら別の行の「編集」や並べ替えができることを優先した。ユーザー裁定                                                                   |
| E3  | V4-G の後回し(タブを Enter で選ぶとフォーカスが body へ)   | V4-E で直す。`SettingsFrame` がタブの選択で遷移したことをモジュール変数に覚え、次に描かれた枠が選択中のタブへフォーカスを戻す。ユーザー裁定                                                                                                                                                                                                                                                 |
| E4  | 「保存」の有効条件(E 5.2)                                  | 編集は「変更があり、かつ入力が有効なとき」だけ(V4-G の G20 と同じ)。新規は T3 どおり「表示名・API 名・フィールド 1 件以上がそろい、API 名に誤りが無いまで無効」。パネルを開いている間はどちらも無効にし、理由「フィールドの設定を適用するか、キャンセルしてください」をツールチップで出す(E24)。ユーザー裁定                                                                                |
| E5  | 「追加」と「作成」の文言(T1・T3、現行は「追加」)           | 一覧の主操作「コンテンツタイプを作成」、新規の h1「コンテンツタイプを作成」、パンくず「作成」、主操作「作成」(キャンバスに合わせる。サイドバーの「最初のコンテンツタイプを作成」・ホームの「コンテンツタイプを作成」とも揃う)。編集の主操作は「保存」。どちらも補助操作「キャンセル」(一覧へ戻る。確認なし、E26・E32)                                                                     |
| E6  | 型の一覧の行(T1 は `<table>` 52px)                          | `Table` ではなく `SortableList`(行 44px = `size.row`。52px は尺度に無い)で描き、列は CSS グリッド `1fr 110px 120px 180px`(NARROW は「フィールド」を隠す)。列見出しは一覧の上の 1 行(`font.caption` / `text.muted` / 高さ `size.rowCompact`)。行の名前のリンクは編集へ(RAC `Link`)                                                                                                       |
| E7  | コンテンツの件数の出所(E 5.1)                              | 同期データ(`useRecordsOfTypes(sync.registry, 全型の key)`、`deletedAt === null` だけ)。`useSyncHasSynced` が false の間は件数の列を `Skeleton` にし、「削除」を出さない(0 件と未取得を区別できないため)                                                                                                                                                                                      |
| E8  | モジュールの型のグループ(E 5.1)                            | `pluginId` で分け、見出しは `modulesQueryOptions` の `name`(取れなければ `pluginId`)+ `Badge`「モジュール」+ 注記。グループの順は modules の順、型の順は `navTypes` の順(残りは名前順)。無効化済みのモジュールの型も DO に残るので出す。システム型(`source: "system"`、`asset`)は出さない。つまみ無し・「フィールドを見る」(`/settings/content-types/$typeKey/edit`)                      |
| E9  | 「フィールドを見る」(読み取り専用)                         | 同じ編集ルートを `mode="view"` で描く。h1 は型名、`meta`「モジュールの型(編集できません)」、保存・キャンセル・追加・つまみ・一覧に表示する列の変更は無し、行の「詳細」でパネルを読み取り専用(入力は `isReadOnly`、下部は「閉じる」だけ)で開く。`type:manage` の無い人と、URL で直接開いた system 型も同じ                                                                                  |
| E10 | `menuOrder` の保存(E 5.1)                                  | ドロップ後の並びの index(0〜)を `menuOrder` にし、値が変わる型だけ上から順に `putContentType`(`summaryToDefinition(row)` + `menuOrder`。version はサーバーが上げる)。処理中は `SortableList` を `isDisabled`。成功のトーストは出さない(頻繁な操作)。失敗はトースト「並び順を保存できませんでした」+ 一覧の取り直し。新規作成の型は `menuOrder` 未設定(サイドバーの末尾)のまま          |
| E11 | 型の削除(E 5.4)                                            | `ConfirmDialog tone="danger"`: 題「「{型名}」を削除しますか？」、本文「コンテンツが 0 件のため削除できます。削除後は同じ API 名で作り直せます。」、注記(warning)「オフラインの端末にこの型の下書きが残っている場合、再接続時にその下書きは失われます」、実行「削除する」。成功は `content-types` の invalidate + トースト。409 `type_not_empty` はトースト(`ERROR_MESSAGES`)+ invalidate。`CollectionRegistry` のエントリは破棄しない(型一覧から消えれば参照されず、次の全再同期で消える) |
| E12 | 種類の対応(E 3 章、`kindOf`)                               | `slug` = `text` かつ key `slug` かつ `unique: true`。`asset` = `relation` かつ `allowedTypes` がちょうど `["asset"]`(`snapshotEmbed: "value"` を常に付ける)。`reference` = それ以外の `relation`。他は 1:1。読む側(record-form)の判定と同じ                                                                                                                                               |
| E13 | 種類の変更(E 5.3「種類の変更」の入口)                      | パネルの「種類」`Select`。変えると種類ごとの設定は新しい種類の既定に戻り、表示名・API 名・説明・必須は保つ。「URL スラッグ」は API 名が `slug` のときだけ選べる。種類の選択ダイアログでは、型に既に URL スラッグがあればカードを無効にして理由「この型には既に URL スラッグがあります」(`disabledReason`)                                                                                      |
| E14 | API 名の自動生成(E 5.2)                                    | `suggestKey(label)`: 英字を含むときだけ、小文字化 → `[a-z0-9]` 以外の連続を `_` → 先頭の英字より前と末尾の `_` を落とす(「Sub-Title」→ `sub_title`、「2nd Title」→ `nd_title`)。日本語だけなら空。`autoFill(prevLabel, prevValue, nextLabel)`: 値が前回の提案と同じ(または空)間だけ追従し、手で変えたら止める。型の API 名、フィールドの API 名、選択肢の「API で使う値」に同じ規則 |
| E15 | API 名の検証と文言(E 5.3、T5)                              | 空「API で使う名前を入力してください」/ 使えない文字「英小文字・数字・_ だけが使えます。例: {suggestKey(入力) または title}」/ 重複「「{key}」は「{表示名}」で既に使われています」/ 予約語(`SYSTEM_FIELD_KEYS`)「「{key}」はシステムが使う名前のため使えません」。型の API 名は既存の型(システム型・モジュールの型を含む)と重複不可、パターンは `FIELD_KEY_PATTERN`。入力があれば即時に出す |
| E16 | 保存済みフィールドの API 名                                | 変更不可(E 5.2)。パネルでは `isDisabled` + 補足「保存したあとは変更できません」。本セッションで追加した未保存のフィールド(`isNew`)だけ変えられる                                                                                                                                                                                                                                            |
| E17 | フィールドの削除(E 5.3、T5)                                | 保存済みは `ConfirmDialog tone="danger"`、未保存(`isNew`)は確認なしで一覧から消す。投影を確認した結果: 公開は record の data をそのまま写し(`do/publish.ts`)、公開 API は `data` を `fields` としてそのまま返す(`public/serialize.ts`)ため、消したフィールドの値は公開応答に残り続け、`projection_fields` から消えて絞り込み・並べ替えに使えなくなるだけ。注記はその事実を書く(E 5.3 の保留の決着) |
| E18 | 変更の注意の件数(E 5.3)                                    | 「必須に変更」= 削除済みを除くコンテンツのうち値が空(`undefined` / `null` / `""` / `[]`)のもの、「種類を変更」= 値があるもの。`useSyncHasSynced` が false なら件数なしの文                                                                                                                                                                                                                 |
| E19 | 「タイトルに使う」(E 5.2)                                  | パネルの `Checkbox`(テキスト(1 行)だけ)。付けると他の指定は外れる(1 つだけ)。行のタグ「タイトルに使う」は実効のタイトル(`titleFieldKey` = 指定、無ければ最初のテキスト)に出す。指定したフィールドの種類を変えたり消したりしたら指定を落とす(現行の `pickDisplay` と同じ)                                                                                                             |
| E20 | 「一覧に表示する列」(E 5.2、T2)                            | 選択中はチップ(`Badge tone="accent"` + `IconButton`「{表示名}を外す」)、追加は `Select`(ラベル非表示「列を追加」、候補は未選択のフィールド全部)。3 件で `Select` を無効。`LIST_COLUMNS_MAX` を使う                                                                                                                                                                                         |
| E21 | 読む側の未対応(E 6 章)                                     | V3 の一覧は `listColumns` を読んでいない(`content-table.tsx` に参照なし)、ホームの「はじめに」は型の `description` を読んでいない。本計画は書く側だけで、読む側は変えない。最終報告で後続へ送る                                                                                                                                                                                             |
| E22 | 「参照できる型」(E 3 章)                                   | `CheckboxGroup`。候補は利用者の型とモジュールの型(`source !== "system"`)から自分自身(編集中の型の key)を除いたもの、表示は型名。新規作成(key 未定)では全部。1 件以上必須                                                                                                                                                                                                                 |
| E23 | 種類の選択ダイアログの幅(T4)                               | `ModalDialog` に `size?: "md" \| "lg"`(md 440px = 現行、lg 640px)を足す。ダイアログの題は `Heading slot="title"`、段階は題の下の `font.caption`                                                                                                                                                                                                                                           |
| E24 | パネルを開いたまま保存                                     | 保存 / 作成を無効にし理由を出す(E4)。パネルは「適用」で編集中の下書きに写し、「キャンセル」「閉じる」「Esc」は捨てる(トランザクション)                                                                                                                                                                                                                                                     |
| E25 | 保存の結果(H 6・8 章)                                      | 成功はトースト「作成しました」/「保存しました」+ `content-types` の invalidate + 一覧へ。失敗はトースト(`errorMessage(cause, "保存できませんでした")`)で画面に留まる。旧の `role="alert"` バナーはやめる                                                                                                                                                                                      |
| E26 | 離脱ガード(`useLeaveGuard`)                                | 付けない(`DIALOGS.leave` の文はコンテンツ向け)。後続の候補として報告                                                                                                                                                                                                                                                                                                                       |
| E27 | 7 章の未決(複数行テキスト、日付のみ)                       | 範囲外。種類の一覧に出さない                                                                                                                                                                                                                                                                                                                                                               |
| E28 | E2E の `createArticleType` / `createArticleRecord`         | 設定 → タブ → 「コンテンツタイプを作成」→ 表示名「記事」→ API 名「article」(日本語なので手入力)→ 「フィールドを追加」→ カード「テキスト(1 行)」→ 「次へ」→ 表示名「title」(API 名は自動で `title`)→ 「追加」→ パネルの「適用」→ 「作成」。コンテンツの作成はサイドバーのリンク「記事」から一覧へ(旧の行の「レコード」リンクは無くなる)                                                   |
| E29 | パネルと本文の重なり(T2 は重ねて描いている)                | パネルを開いている間、本文の入れ物に右 420px の余白を取り(NARROW は 0)、行の「編集」がパネルに隠れないようにする                                                                                                                                                                                                                                                                           |
| E30 | 狭い画面(依頼書「共通」)                                   | Global Constraints の NARROW の行のとおり。パネルは全面のシート(上部に題と閉じる)                                                                                                                                                                                                                                                                                                           |
| E31 | DnD のテスト                                               | Global Constraints の「ドラッグの並べ替えのテスト」のとおり                                                                                                                                                                                                                                                                                                                                 |
| E32 | 「キャンセル」                                             | 一覧へ戻る(`/settings/content-types`)。パネルが開いていれば先に閉じる必要は無い(捨てる)                                                                                                                                                                                                                                                                                                    |
| E33 | 種類のカードの選び方(T4)                                   | カードは `Button`(`aria-pressed` で選択中)、「次へ」で 2 段目へ。2 段目の「種類を選び直す」で 1 段目に戻る(選択は保つ)。URL スラッグを選んだときの 2 段目は表示名の初期値「URL スラッグ」、API 名は `slug` 固定(`isDisabled`)                                                                                                                                                             |
| E34 | 選択肢の表(E 4 章)                                         | 行ごとに「表示名」「API で使う値」の `TextField`(値は等幅)+ `IconButton`「{表示名}を外す」、下に「選択肢を追加」。適用時に 1 件以上・値が空でない・値が重複しないことを検証し、表の下にエラー                                                                                                                                                                                              |
| E35 | 件数の表示(「1 件だけ / 複数」)                            | パネルでは `SegmentedControl`(ラベル「件数」、`one`「1 件だけ」/ `many`「複数」)。行のタグは「1 件だけ」/「複数」(画像・ファイルと参照だけ)                                                                                                                                                                                                                                                 |

## Review Focus

1. **日本語の表示名で API 名が空のまま**: 種類の選択ダイアログの「追加」と新規作成の「作成」が無効のままで、API 名の欄に「API で使う名前を入力してください」が出ること。英字の表示名なら自動で入って有効になること。→ Task 7 の add-field-dialog.test「日本語の表示名では API 名が空のままで追加が無効、英字なら自動で入る」、Task 9 の content-types-new.test
2. **同期前に一覧を開く**: 件数の列がスケルトンで「削除」が出ず、同期が届くと件数と 0 件の型の「削除」が出ること。→ Task 6 の content-types-list.test「同期前は件数がスケルトンで削除が出ず、同期後に 0 件の型にだけ削除が出る」
3. **既存フィールドを必須にする**: 行に「必須に変更」のタグと件数つきの注意が出て、保存の PUT に `required: true` が入り、保存後は一覧に戻ること。→ Task 9 の content-types-edit.test「既存のフィールドを必須にすると件数つきの注意が出て、保存すると PUT に入る」
4. **型の削除が他の人の操作と重なる**(409 `type_not_empty`): エラーのトーストが出て一覧が取り直され、行が残ること。→ Task 6 の content-types-delete.test「409 type_not_empty ならトーストを出して一覧を取り直す」
5. **URL スラッグが既にある型**: 種類の選択ダイアログの「URL スラッグ」が無効で理由が読め、パネルの「種類」でも選べないこと。→ Task 7 の add-field-dialog.test「URL スラッグが既にあればカードが無効で理由が読める」、Task 8 の field-panel.test「API 名が slug でなければ種類に URL スラッグが無い」

---

## ファイル構成

`packages/ui/src/`:

| ファイル                   | 責務                                                                                   |
| -------------------------- | -------------------------------------------------------------------------------------- |
| `sortable-list.tsx`        | 新規。`SortableList`(RAC GridList + useDragAndDrop)、`reorderIds`(E1)                   |
| `sortable-list.test.tsx`   | 新規                                                                                   |
| `side-panel.tsx`           | 新規。`SidePanel`(非モーダルの右パネル。E2)                                             |
| `side-panel.test.tsx`      | 新規                                                                                   |
| `dialog.tsx`、`dialog.test.tsx` | 変更。`ModalDialog.size`(E23)                                                      |
| `index.ts`                 | 変更。export                                                                           |

`apps/admin/`:

| ファイル                                                       | 責務                                                                                                     |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `src/components/settings/settings-frame.tsx`、`settings-frame.test.tsx` | 変更。タブのフォーカス復元(E3)                                                                    |
| `src/lib/labels.ts`                                            | 変更。`CONTENT_TYPE_LABELS`、`FIELD_KIND_LABELS`、`FIELD_PANEL_LABELS`、`ADD_FIELD_LABELS`                  |
| `src/lib/content-type-form.ts`、`content-type-form.test.ts`    | 作り直し。`FieldKind` / `FieldDraft` / `TypeDraft`、変換、提案・検証、変更の検出と件数                     |
| `src/lib/content-types.ts`、`content-types.test.ts`            | 新規。一覧のグループ分け・件数・`menuOrder` の更新                                                        |
| `src/components/content-types/type-table.tsx`                  | 新規。利用者の型の一覧(つまみ・削除・編集。E6)                                                           |
| `src/components/content-types/plugin-type-groups.tsx`          | 新規。モジュールの型のグループ(E8)                                                                       |
| `src/components/content-types/delete-type-dialog.tsx`          | 新規。型の削除の確認(E11)                                                                                |
| `src/components/content-types/add-field-dialog.tsx`            | 新規。2 段階の追加ダイアログ(T4、E13・E14・E33)                                                          |
| `src/components/content-types/field-panel.tsx`                 | 新規。右パネルの詳細設定(4 章、E13・E16・E19・E22・E34・E35)                                              |
| `src/components/content-types/delete-field-dialog.tsx`         | 新規。フィールドの削除の確認(E17)                                                                        |
| `src/components/content-types/field-list.tsx`                  | 新規。48px の行・タグ・インライン注意(E18)                                                               |
| `src/components/content-types/list-columns-select.tsx`         | 新規。「列を追加」の `Select`(テストで差し替えるため 1 ファイル)                                          |
| `src/components/content-types/list-columns-picker.tsx`         | 新規。チップ + 列を追加(E20)                                                                             |
| `src/components/content-types/type-editor.tsx`                 | 新規。見出し + 本文 + パネル + ダイアログの状態(E4・E24・E29)                                            |
| `src/components/content-types/*.test.tsx`                      | 新規。部品テスト                                                                                         |
| `src/components/content-type-form.tsx`                         | 削除                                                                                                     |
| `src/routes/t/$tenantSlug/settings/content-types/index.tsx`    | 書き換え。一覧(E6〜E11)                                                                                  |
| `src/routes/t/$tenantSlug/settings/content-types/new.tsx`      | 書き換え。作成                                                                                           |
| `src/routes/t/$tenantSlug/settings/content-types/$typeKey.edit.tsx` | 書き換え。編集 / 読み取り専用(E9)                                                                   |
| `src/test-utils/list-columns-select-mock.tsx`                  | 新規。`vi.mock` 用の素の `<select>`                                                                      |
| `src/content-types-list.test.tsx`、`content-types-reorder.test.tsx`、`content-types-delete.test.tsx`、`content-types-new.test.tsx`、`content-types-edit.test.tsx`、`content-types-field-delete.test.tsx` | 新規。router テスト |
| `src/content-type-builder.test.tsx`                            | 削除(上の router テストに置き換え)                                                                       |

`apps/e2e/helpers/setup.ts`(E28)。`docs/admin-ux/e-content-type-design.md`、`h-common-surface.md`: 裁定の書き戻し。`.design-sync/NOTES.md`: 部品の変更の記録。

## タスクの依存

Task 1(設計書)→ Task 2(タブのフォーカス)→ Task 3(ui `SortableList`・`ModalDialog.size`)→ Task 4(ui `SidePanel`)→ Task 5(文言・純関数)→ Task 6(一覧)→ Task 7(追加・削除のダイアログ)→ Task 8(パネル)→ Task 9(エディタとルート、旧フォームの削除)→ Task 10(E2E・検証・preview・報告)。Task 2〜4 は互いに独立。Task 6 は Task 3・5 に、Task 7 は Task 5 と Task 3 の `ModalDialog.size` に、Task 8 は Task 4・5 に、Task 9 は Task 3〜8 に依存する。

---

### Task 1: 設計書へ V4-E の裁定を書き戻す

**Files:**
- Modify: `docs/admin-ux/e-content-type-design.md`(3・4・5.1〜5.4・6・8 章)
- Modify: `docs/admin-ux/h-common-surface.md`(3 章、14 章)
- Add: `docs/superpowers/plans/2026-10-20-admin-ux-v4e-content-types.md`(本計画。実装ブランチの最初のコミットに含める)

- [ ] **Step 1: e-content-type-design.md に E1・E2・E4〜E20・E22〜E25・E28・E29・E32〜E35 を書く**

各章に「(2026-10-20、V4-E)」付きで 1〜2 文ずつ足し、既存の文は消さない。3 章: E12(種類の対応)、E13(種類の変更)、E22(参照できる型)。4 章: E34(選択肢の表)、E35(件数)。5.1: E5(文言)、E6(行の部品)、E7(件数の出所)、E8(モジュールの型)、E9(フィールドを見る)、E10(menuOrder の保存)。5.2: E2(パネルの実装)、E4(保存の条件)、E14(自動生成)、E16(API 名の不変)、E19(タイトルに使う)、E20(列)、E24(パネルと保存)、E29、E33(カード)。5.3: E15(文言)、E17(削除の注記。「公開済みの版と公開 API の応答にいつまで値が残るか」の保留に決着を書く)、E18(件数)。5.4: E11(ダイアログの文言、`CollectionRegistry` のエントリは破棄しない)。6 章: E21(読む側の未対応を注記)。8 章 決定ログ: 「2026-10-20: V4-E の計画で E1〜E35 を決めた(docs/superpowers/plans/2026-10-20-admin-ux-v4e-content-types.md)」

- [ ] **Step 2: h-common-surface.md を直す**

3 章の V4-G の行の下に「V4-E(2026-10-20): 並べ替えの `SortableList`(RAC GridList + useDragAndDrop)と非モーダルの右パネル `SidePanel` を足した(E1・E2)。`ModalDialog` に `size="lg"`(E23)。型の一覧の中のリンクも RAC の `Link` を admin から直接使う(E6)」。14 章 決定ログに同じ内容を 1 行。

- [ ] **Step 3: コミット**

```bash
git add docs/admin-ux docs/superpowers/plans/2026-10-20-admin-ux-v4e-content-types.md
```

```bash
git commit -m "docs: V4-E(型設計)の計画と裁定を案 E・案 H の設計書に書き戻す"
```

---

### Task 2: 設定のタブを選んで遷移した後、選択中のタブへフォーカスを戻す(E3)

**Files:**
- Modify: `apps/admin/src/components/settings/settings-frame.tsx`
- Modify: `apps/admin/src/components/settings/settings-frame.test.tsx`

**Interfaces:**
- Consumes: `Tabs`(`keyboardActivation="manual"`)、`SettingsTab`
- Produces: 変更なし(`SettingsFrame` の props はそのまま)。内部: モジュール変数 `let pendingTabFocus: SettingsTab | null = null`。`onSelectionChange` で選んだ id を入れてから `navigate`。各枠は mount 時の `useEffect` で `pendingTabFocus === tab` なら枠内の `[role="tab"][aria-selected="true"]` に `focus()` し、`null` に戻す(入れ物の `ref` から `querySelector`)

- [ ] **Step 1: 失敗するテストを書く**

```ts
// settings-frame.test.tsx に足す
it("タブを選んで遷移した後、次に描かれた枠は選択中のタブにフォーカスを戻す", () => {
  renderFrame({});                      // tab="members"
  fireEvent.click(screen.getByRole("tab", { name: "一般" }));   // navigate のモックが呼ばれる
  cleanup();
  render(<TenantSyncProvider sync={sync}><SettingsFrame tab="general" slug="blog"><p>本文</p></SettingsFrame></TenantSyncProvider>);
  expect(screen.getByRole("tab", { name: "一般" })).toHaveFocus();
});
it("タブを選ばずに描いた枠はフォーカスを動かさない", () => {
  renderFrame({});
  expect(screen.getByRole("tab", { name: "メンバー" })).not.toHaveFocus();
});
```

- [ ] **Step 2: テストが失敗することを確かめる**

Run: `corepack pnpm --filter @plyrs/admin exec vitest run src/components/settings/settings-frame.test.tsx`
Expected: FAIL(1 本目。フォーカスが body のまま)

- [ ] **Step 3: 実装する**

- [ ] **Step 4: テストが通ることを確かめる**

Run: `corepack pnpm --filter @plyrs/admin exec vitest run src/components/settings src/settings-general.test.tsx src/settings-members-list.test.tsx && corepack pnpm -r typecheck && corepack pnpm format && corepack pnpm lint`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add apps/admin/src/components/settings
```

```bash
git commit -m "fix(admin): 設定のタブで遷移した後に選択中のタブへフォーカスを戻す"
```

---

### Task 3: ui の `SortableList`(並べ替え)と `ModalDialog.size`

**Files:**
- Create: `packages/ui/src/sortable-list.tsx`、`packages/ui/src/sortable-list.test.tsx`
- Modify: `packages/ui/src/dialog.tsx`、`packages/ui/src/dialog.test.tsx`、`packages/ui/src/index.ts`
- Modify: `.design-sync/NOTES.md`

**Interfaces:**
- Produces:

```ts
// packages/ui/src/sortable-list.tsx(E1。D3 T2・T5)
export interface SortableItem { id: string; textValue: string }
export interface SortableListProps<T extends SortableItem> {
  label: string;                             // GridList の aria-label
  items: readonly T[];
  renderItem: (item: T) => ReactNode;        // つまみの右に描く中身(幅いっぱい)
  dragLabel: (item: T) => string;            // つまみの aria-label(「{名前}を並べ替え」)
  onReorder: (orderedIds: string[]) => void; // ドロップ後の id の並び(全件)
  isDisabled?: boolean;                      // true: DnD を無効にし、つまみを描かない(読み取り専用・保存中)
  rowHeight?: "default" | "tall";            // default = size.row(44px)、tall = 48px(フィールドの行、E 5.2)
}
export function SortableList<T extends SortableItem>(props: SortableListProps<T>): JSX.Element;
// RAC GridList(selectionMode "none"、layout "stack")+ GridListItem(textValue)。各行: flex、alignItems center、gap space.sm、
// paddingInline space.inset、minHeight rowHeight、上の罫線 stroke.default border.default(先頭は無し)、外枠は呼び出し側。
// つまみ: <Button slot="drag">(RAC)を IconButton 風に描く(GripVertical ICON_SIZE.inline、text.muted、cursor grab、幅 size.controlSm)。
// isDragging: bg.raised + elevation.menu + opacity 0.9。isDropTarget(行の上に落とす)は使わず、renderDropIndicator で
// DropIndicator(高さ space.xs、accent.default の点線 = borderTop 2px dashed)を行の間に描く(D3 T5 の点線枠を線に寄せる)。
// useDragAndDrop({ getItems: keys → [{ "text/plain": textValue }], onReorder: e → onReorder(reorderIds(ids, [...e.keys], e.target.key, e.target.dropPosition)), renderDropIndicator })
// isDisabled のときは dragAndDropHooks を渡さず、つまみも描かない。フォーカスの見た目は focus.ring(行と、つまみ)
export function reorderIds(ids: readonly string[], moving: readonly string[], targetId: string, position: "before" | "after" | "on"): string[];
// moving を抜いてから targetId の前 / 後に挿す("on" は "after" と同じ)。targetId が moving に含まれるときは元の並びを返す

// packages/ui/src/dialog.tsx(E23)
export interface ModalDialogProps { …; size?: "md" | "lg" }  // md 440px(既定)、lg 640px。ConfirmDialog は md のまま
```

- [ ] **Step 1: 失敗するテストを書く**

```ts
// sortable-list.test.tsx
it("reorderIds は動かす id を抜いてから目標の前後に挿す", () => {
  expect(reorderIds(["a", "b", "c"], ["c"], "a", "before")).toStrictEqual(["c", "a", "b"]);
  expect(reorderIds(["a", "b", "c"], ["a"], "c", "after")).toStrictEqual(["b", "c", "a"]);
  expect(reorderIds(["a", "b", "c"], ["a"], "a", "after")).toStrictEqual(["a", "b", "c"]);
});
it("行ごとにつまみ(aria-label)を描き、isDisabled ならつまみが無い", () => {
  // items 3 件、dragLabel = `${textValue}を並べ替え` → button「Aを並べ替え」がある。isDisabled で rerender → 無い
});
it("キーボードで並べ替えると onReorder に新しい並びが渡る", async () => {
  // 「Aを並べ替え」にフォーカス → keyboard("{Enter}") → "{ArrowDown}" → "{Enter}" → onReorder が ["b", "a", "c"] で 1 回
  // (RAC のキーボード DnD: Enter でつかみ、矢印で落とす位置を選び、Enter で置く。動かなければ Global Constraints の E31 のとおり報告)
});
// dialog.test.tsx に足す
it("size=lg は幅 640px の Modal を描く", () => { /* role=dialog の親(.modal)の className に 640px のスタイルが当たる。stylex の props で断言 */ });
```

- [ ] **Step 2: テストが失敗することを確かめる**

Run: `corepack pnpm --filter @plyrs/ui exec vitest run src/sortable-list.test.tsx src/dialog.test.tsx`
Expected: FAIL(部品・prop が無い)

- [ ] **Step 3: 実装する**

`react-aria-components` の `GridList` / `GridListItem` / `Button` / `DropIndicator` / `useDragAndDrop` を `sortable-list.tsx` の中だけで import する。

- [ ] **Step 4: テストが通ることを確かめる**

Run: `corepack pnpm --filter @plyrs/ui exec vitest run && corepack pnpm -r typecheck && corepack pnpm format && corepack pnpm lint`
Expected: PASS

- [ ] **Step 5: `.design-sync/NOTES.md` の「V4 で変えた部品」に `SortableList`(新規)と `ModalDialog`(`size`)を足し、`.design-sync/docs/SortableList.md` のスタブ(category: data display)を足してコミット**

```bash
git add packages/ui/src .design-sync
```

```bash
git commit -m "feat(ui): 並べ替えの SortableList を足し、ModalDialog に size=lg を足す"
```

---

### Task 4: ui の `SidePanel`(非モーダルの右パネル)

**Files:**
- Create: `packages/ui/src/side-panel.tsx`、`packages/ui/src/side-panel.test.tsx`
- Modify: `packages/ui/src/index.ts`、`.design-sync/NOTES.md`、`.design-sync/docs/SidePanel.md`(スタブ)

**Interfaces:**
- Produces:

```ts
// packages/ui/src/side-panel.tsx(E2。D3 T2 の右パネル)
export interface SidePanelProps {
  isOpen: boolean;
  onClose: () => void;                  // 閉じるボタンと Esc
  title: string;                        // Heading slot="title"(font.label、weightBold)
  subtitle?: string;                    // 題の下(font.caption、text.muted。「種類: テキスト(1 行)」)
  children: ReactNode;                  // 本文(flex 1、overflowY auto、padding space.lg、flex column gap space.md)
  footer?: ReactNode;                   // 下部(padding space.sm space.lg、上の罫線。並べ方は呼び出し側)
  returnFocusTo?: RefObject<HTMLElement | null>; // 閉じたときにフォーカスを戻す先(開いた「編集」ボタン)
}
export function SidePanel(props: SidePanelProps): JSX.Element | null;
// isOpen が false なら null。<aside> に RAC Dialog(role="dialog"、aria-labelledby は Heading に任せる)。
// 位置: position fixed、top 0、right 0、bottom 0、幅 420px、zIndex layer.dropdown、bg.raised、左の罫線 stroke.default border.default、
// elevation.modal、flex column。NARROW("@media (max-width: 959px)"): insetInline 0、幅 auto(全面のシート)。
// 上部: 題 + 副題(flex 1)+ IconButton(X、「閉じる」、size sm、variant ghost)。padding space.md space.lg、下の罫線。
// 開いたときのフォーカス: RAC の useDialog が Dialog 自身にフォーカスを置く。閉じるとき(onClose の後、isOpen が false になった effect)に
// returnFocusTo?.current?.focus()。aside の onKeyDown で Escape → onClose(入力欄の中でも閉じる)
```

- [ ] **Step 1: 失敗するテストを書く**

```ts
// side-panel.test.tsx
it("開くと dialog として題と本文を描き、閉じるボタンと Esc で onClose を呼ぶ", async () => {
  // getByRole("dialog", { name: "タイトル" })、副題「種類: テキスト(1 行)」、button「閉じる」click → onClose 1 回、keyboard("{Escape}") → 2 回
});
it("閉じると returnFocusTo の要素へフォーカスを戻す", async () => {
  // 外のボタンを ref に渡し、isOpen true → false に rerender → そのボタンが document.activeElement
});
it("isOpen が false なら何も描かない", () => {});
```

- [ ] **Step 2: テストが失敗することを確かめる**

Run: `corepack pnpm --filter @plyrs/ui exec vitest run src/side-panel.test.tsx`
Expected: FAIL(部品が無い)

- [ ] **Step 3: 実装する**

- [ ] **Step 4: テストが通ることを確かめる**

Run: `corepack pnpm --filter @plyrs/ui exec vitest run && corepack pnpm -r typecheck && corepack pnpm format && corepack pnpm lint`
Expected: PASS

- [ ] **Step 5: NOTES.md とスタブを足してコミット**

```bash
git add packages/ui/src .design-sync
```

```bash
git commit -m "feat(ui): 非モーダルの右パネル SidePanel を足す"
```

---

### Task 5: 文言と純関数(種類・下書き・API 名・変更の検出・一覧のグループ分け)

**Files:**
- Modify: `apps/admin/src/lib/labels.ts`
- Rewrite: `apps/admin/src/lib/content-type-form.ts`、`apps/admin/src/lib/content-type-form.test.ts`
- Create: `apps/admin/src/lib/content-types.ts`、`apps/admin/src/lib/content-types.test.ts`

**Interfaces:**
- Consumes: `FieldDefinition` / `ContentTypeDefinition` / `contentTypeDefinitionSchema` / `titleFieldKey` / `FIELD_KEY_PATTERN` / `SYSTEM_FIELD_KEYS` / `ASSET_TYPE_KEY` / `FIELD_LABEL_MAX_LENGTH` / `FIELD_DESCRIPTION_MAX_LENGTH` / `CONTENT_TYPE_DESCRIPTION_MAX_LENGTH` / `LIST_COLUMNS_MAX`(`@plyrs/metamodel`)、`ContentTypeSummary` / `ModuleSummary`(`admin-api.ts`)、`SyncRecord`(`@plyrs/sync-protocol`)、`sidebarContentTypes`(`navigation.ts`)
- Produces:

```ts
// labels.ts
export const FIELD_KIND_LABELS: Record<FieldKind, { name: string; description: string }> = {
  text: { name: "テキスト(1 行)", description: "タイトルや名前。最大文字数を決められます" },
  richtext: { name: "リッチテキスト", description: "見出し・太字・画像を含む本文" },
  number: { name: "数値", description: "価格や人数。整数のみにもできます" },
  datetime: { name: "日時", description: "公開日や開催日時" },
  boolean: { name: "チェックボックス", description: "はい / いいえ" },
  select: { name: "選択肢", description: "決まった候補から選ぶ。複数選択も可" },
  asset: { name: "画像・ファイル", description: "メディアから選ぶ。1 件 / 複数" },
  reference: { name: "他のコンテンツへの参照", description: "別の型のコンテンツを選ぶ" },
  slug: { name: "URL スラッグ", description: "公開 URL に使う名前。型に 1 つだけ" },
  json: { name: "JSON", description: "任意の構造のデータをそのまま保存" },
};
export const CONTENT_TYPE_LABELS = {
  description: "サイトに載せる内容の種類と、そのフィールドを設計します。並び順はサイドバーの並び順になります(つまみをドラッグ)。",
  create: "コンテンツタイプを作成", createCrumb: "作成", createTitle: "コンテンツタイプを作成",
  tableLabel: "コンテンツタイプの一覧",
  columns: { name: "表示名", fields: "フィールド", contents: "コンテンツ", actions: "操作" },
  apiName: (key: string) => `API 名: ${key}`, count: (n: number) => `${n} 件`, separator: " ・ ",
  empty: { title: "コンテンツタイプはまだありません", description: "「お知らせ」「ブログ」のような、サイトに載せる内容の種類を作ります" },
  moduleBadge: "モジュール", moduleNote: "このモジュールの型は編集できません。表示名と説明はモジュールが持っています",
  edit: "編集", viewFields: "フィールドを見る", delete: "削除", dragLabel: (name: string) => `${name}を並べ替え`,
  reorderFailed: "並び順を保存できませんでした", loadFailed: "コンテンツタイプを読み込めませんでした",
  deleteDialog: { title: (name: string) => `「${name}」を削除しますか？`, body: "コンテンツが 0 件のため削除できます。削除後は同じ API 名で作り直せます。",
    offline: "オフラインの端末にこの型の下書きが残っている場合、再接続時にその下書きは失われます", confirm: "削除する",
    deleted: (name: string) => `「${name}」を削除しました`, failed: "削除できませんでした" },
  editor: {
    name: "表示名", nameHelp: "サイドバーと一覧の見出しに使います", nameRequired: "表示名を入力してください",
    key: "API 名", keyPlaceholder: "news など、英小文字・数字・_",
    keyHelpNew: "公開 API の URL に使います。表示名が英数字なら自動で入ります。日本語の場合は入力してください。作成後は変更できません",
    keyHelpEdit: "公開 API の URL に使います。作成後は変更できません",
    descriptionLabel: "説明", descriptionPlaceholder: "この種類の内容を一言で", descriptionHelp: "設定の一覧と、はじめての利用の案内に表示します",
    descriptionTooLong: "説明は 1000 文字以内で入力してください",
    fields: "フィールド", fieldsHelp: "上から順に入力フォームに並びます",
    emptyTitle: "フィールドはまだありません", emptyDescription: "タイトル・本文・画像のような入力項目を足していきます。最初のテキスト(1 行)がタイトルとして使われます。",
    addField: "フィールドを追加", editField: "編集", editingField: "編集中", viewField: "詳細",
    listColumns: "一覧に表示する列", listColumnsMax: (n: number) => `最大 ${n} 件`, addColumn: "列を追加", removeColumn: (label: string) => `${label}を外す`,
    listColumnsHelp: "タイトル・公開・ステータス・更新に加えて、一覧に出す列です",
    save: "保存", create: "作成", cancel: "キャンセル", panelOpenReason: "フィールドの設定を適用するか、キャンセルしてください",
    created: "作成しました", saved: "保存しました", saveFailed: "保存できませんでした",
    viewMeta: "モジュールの型(編集できません)", notFound: (key: string) => `コンテンツタイプが見つかりません: ${key}`,
  },
  tags: { required: "必須", title: "タイトルに使う", one: "1 件だけ", many: "複数", indexed: "絞り込み・並べ替え", requiredChanged: "必須に変更", kindChanged: "種類を変更" },
  kindChangeArrow: " → ",
  warnings: {
    requiredAdded: (count: number | null) => count === null ? "既に作成済みで値が空のコンテンツは、次に保存するときに入力が必要になります" : `既に作成済みで値が空のコンテンツ(${count} 件)は、次に保存するときに入力が必要になります`,
    kindChanged: (count: number | null) => count === null ? "入力済みの値は自動では変換されません。値が新しい種類に合わない場合、そのコンテンツを次に保存するときに入力し直す必要があります" : `入力済みの値(${count} 件)は自動では変換されません。値が新しい種類に合わない場合、そのコンテンツを次に保存するときに入力し直す必要があります`,
  },
  keyErrors: { empty: "API で使う名前を入力してください", invalid: (example: string) => `英小文字・数字・_ だけが使えます。例: ${example}`,
    duplicate: (key: string, label: string) => `「${key}」は「${label}」で既に使われています`, reserved: (key: string) => `「${key}」はシステムが使う名前のため使えません` },
} as const;
export const ADD_FIELD_LABELS = {
  title: "フィールドを追加", step1: "1. 種類を選ぶ", step1Done: (kind: string) => `1. 種類を選ぶ: ${kind}`, step2: "2. 名前を付ける", stepArrow: " › ",
  groups: { basic: "基本", link: "他のデータとつなぐ", advanced: "上級者向け" },
  slugTaken: "この型には既に URL スラッグがあります", next: "次へ", back: "種類を選び直す", add: "追加", cancel: "キャンセル",
  label: "表示名", labelHelp: "入力フォームのラベルと一覧の列見出しに使います", labelRequired: "表示名を入力してください",
  labelTooLong: (max: number) => `表示名は ${max} 文字以内で入力してください`,
  keyPlaceholder: "subtitle など、英小文字・数字・_",
  keyHelp: "公開 API の応答でこの名前が使われます。フロントエンドの開発者が読む名前なので、意味の分かる英語にしてください。保存したあとは変更できません",
} as const;
export const FIELD_PANEL_LABELS = {
  subtitle: (kind: string) => `種類: ${kind}`, kind: "種類", close: "閉じる", apply: "適用", cancel: "キャンセル", deleteField: "このフィールドを削除",
  label: "表示名", labelHelp: "入力フォームのラベルと一覧の列見出しに使います",
  keyHelp: "公開 API の応答でこの名前が使われます。英小文字・数字・_ のみ", keyHelpSaved: "公開 API の応答でこの名前が使われます。保存したあとは変更できません",
  description: "説明文", descriptionHelp: "入力欄の下に補足として表示します", descriptionTooLong: (max: number) => `説明文は ${max} 文字以内で入力してください`,
  required: "必須", titleField: "タイトルに使う", titleFieldHelp: "一覧・ホーム・パンくずで、このフィールドの値をタイトルとして表示します",
  indexed: "公開 API で絞り込み・並べ替えに使う", indexedHelp: "公開 API の検索条件や並び順に使えるようになります",
  unique: "同じ値を許可しない", uniqueHelp: "他のコンテンツと同じ値は保存できません", uniqueSlugHelp: "他のコンテンツと同じ値は保存できません。URL スラッグでは常に有効です",
  maxLength: "最大文字数", maxLengthInvalid: "1 以上の整数で入力してください", integer: "整数のみ",
  options: "選択肢", optionLabel: "表示名", optionValue: "API で使う値", addOption: "選択肢を追加", removeOption: (label: string) => `${label || "(空)"}を外す`,
  optionsRequired: "選択肢を 1 件以上入力してください", optionValueEmpty: "API で使う値を入力してください", optionValueDuplicate: (value: string) => `「${value}」が重複しています`,
  multiple: "複数選択",
  cardinality: "件数", one: "1 件だけ", many: "複数", ordered: "並び順を保持", orderedHelp: "選んだ順番を公開 API の応答でも保ちます",
  allowedTypes: "参照できる型", allowedTypesRequired: "参照できる型を 1 つ以上選んでください",
  deleteDialog: { title: (label: string) => `フィールド「${label}」を削除しますか？`,
    body: (key: string) => `このフィールドは入力フォームから消えます。入力済みの値はデータ上に残り、同じ API 名(${key})でフィールドを作り直すと再び表示されます。`,
    publicNote: "公開 API の応答にはこの項目の値が残ったまま返りますが、絞り込み・並べ替えには使えなくなります。サイト側でこの項目を使っている場合は、先にサイト側を直してください",
    confirm: "削除する" },
} as const;

// lib/content-type-form.ts(作り直し。旧の displayOf / emptyFieldDraft() / FieldDraft.type / optionsText / allowedTypes 文字列 / embedValue は消す)
export type FieldKind = "text" | "richtext" | "number" | "datetime" | "boolean" | "select" | "asset" | "reference" | "slug" | "json";
export type KindGroup = "basic" | "link" | "advanced";
export const FIELD_KINDS: readonly { kind: FieldKind; group: KindGroup }[]; // text, richtext, number, datetime, boolean, select(basic)/ asset, reference, slug(link)/ json(advanced)。この順
export function kindOf(field: FieldDefinition): FieldKind;                 // E12
export interface SelectOptionDraft { value: string; label: string }
export interface FieldDraft {
  key: string; kind: FieldKind; label: string; description: string; required: boolean;
  isNew: boolean;                                   // 未保存(E16・E17)
  maxLength: string; integer: boolean;
  options: SelectOptionDraft[]; multiple: boolean;
  allowedTypes: string[]; cardinality: "one" | "many"; ordered: boolean;
  indexed: boolean; unique: boolean;
}
export function emptyFieldDraft(kind: FieldKind, key: string, label: string): FieldDraft; // isNew true。slug: key "slug"、unique true。asset: allowedTypes ["asset"]。他は既定(false / "" / [] / "one")
export function toFieldDraft(field: FieldDefinition): FieldDraft;        // isNew false。asset は allowedTypes ["asset"] のまま
export function changeKind(draft: FieldDraft, kind: FieldKind): FieldDraft; // E13: key / label / description / required / isNew を保ち、他は emptyFieldDraft(kind, key, label) の値
export function availableKinds(draft: FieldDraft, hasOtherSlug: boolean): FieldKind[]; // FIELD_KINDS の順。slug は draft.key === "slug" && !hasOtherSlug のときだけ
export interface TypeDraft { name: string; key: string; description: string; fields: FieldDraft[]; titleField: string | null; listColumns: string[] }
export function emptyTypeDraft(): TypeDraft;
export function toTypeDraft(row: ContentTypeSummary): TypeDraft;
export function effectiveTitleField(draft: TypeDraft): string | null;     // E19(titleFieldKey と同じ規則を FieldDraft に適用。kind "text" / "slug" ではなく text だけ)
export function hasSlugField(fields: readonly FieldDraft[], exceptKey?: string): boolean;
export function suggestKey(label: string): string;                         // E14
export function autoFill(prevLabel: string, prevValue: string, nextLabel: string): string; // E14
export type KeyError = { kind: "empty" } | { kind: "invalid"; example: string } | { kind: "duplicate"; label: string } | { kind: "reserved" };
export function validateFieldKey(key: string, others: readonly { key: string; label: string }[]): KeyError | null; // E15。others に同じ key があれば duplicate(label は others のもの)
export function validateTypeKey(key: string, existing: readonly { key: string; name: string }[]): KeyError | null; // E15。existing は全型(システム型を含む)。reserved は使わない
export function keyErrorMessage(error: KeyError): string;                  // CONTENT_TYPE_LABELS.keyErrors
export interface FieldChange { requiredAdded: boolean; kindChanged: { from: FieldKind; to: FieldKind } | null }
export function fieldChange(original: FieldDefinition | undefined, draft: FieldDraft): FieldChange; // original が無い(新規)なら両方 false / null
export function countEmpty(records: readonly SyncRecord[], key: string): number;  // E18。deletedAt === null だけ。空 = undefined / null / "" / []
export function countFilled(records: readonly SyncRecord[], key: string): number;
export function fieldTags(draft: FieldDraft, titleKey: string | null, change: FieldChange): string[]; // 順: 必須 / タイトルに使う / 1 件だけ or 複数(asset・reference)/ 絞り込み・並べ替え(indexed)/ 必須に変更 / 種類を変更
export function isTypeDraftDirty(a: TypeDraft, b: TypeDraft): boolean;    // 構造の比較(JSON.stringify)
export type BuildDefinitionResult = { ok: true; definition: ContentTypeDefinition } | { ok: false; errors: string[] };
export function buildDefinition(args: { id: string; version: number; menuOrder?: number; draft: TypeDraft }): BuildDefinitionResult;
// kind → type / config: text(maxLength・indexed・unique)、slug(type text、key slug、unique true、indexed・maxLength)、number(integer・indexed・unique)、
// boolean(indexed)、datetime(indexed・unique)、select(options・multiple・indexed)、asset(relation、allowedTypes ["asset"]、cardinality、snapshotEmbed "value")、
// reference(relation、allowedTypes、cardinality、ordered)、richtext / json(config 無し)。label / description は trim して空なら落とす。
// titleField / listColumns は現行の pickDisplay と同じ規則(無くなった参照は落とす)。描画側で検証済みの前提だが、スキーマの issue は旧と同じ形で errors に
export function summaryToDefinition(row: ContentTypeSummary): ContentTypeDefinition; // 現行のまま

// lib/content-types.ts(新規)
export interface TypeRow { row: ContentTypeSummary; count: number | null; canDelete: boolean } // count は hasSynced のときだけ。canDelete = source user && count === 0(E7)
export function userTypeRows(types: readonly ContentTypeSummary[], records: readonly SyncRecord[], hasSynced: boolean): TypeRow[]; // sidebarContentTypes の順
export interface PluginTypeGroup { pluginId: string; name: string; rows: TypeRow[] }
export function pluginTypeGroups(types: readonly ContentTypeSummary[], modules: readonly Pick<ModuleSummary, "moduleId" | "name" | "navTypes">[] | undefined, records: readonly SyncRecord[], hasSynced: boolean): PluginTypeGroup[]; // E8
export function menuOrderUpdates(ordered: readonly ContentTypeSummary[]): ContentTypeDefinition[]; // E10。index と menuOrder が違う行だけ、summaryToDefinition + menuOrder: index
export function referenceCandidates(types: readonly ContentTypeSummary[], selfKey: string | null): { key: string; name: string }[]; // E22
```

- [ ] **Step 1: 失敗するテストを書く**

```ts
// content-type-form.test.ts(書き直し)
it("kindOf は slug / asset / reference を設定から見分ける", () => {
  expect(kindOf({ key: "slug", type: "text", config: { unique: true } })).toBe("slug");
  expect(kindOf({ key: "slug", type: "text" })).toBe("text");
  expect(kindOf({ key: "eyecatch", type: "relation", config: { allowedTypes: ["asset"], cardinality: "one", snapshotEmbed: "value" } })).toBe("asset");
  expect(kindOf({ key: "authors", type: "relation", config: { allowedTypes: ["author"], cardinality: "many" } })).toBe("reference");
});
it("全種類の round-trip で定義が保たれる(旧テストの fields に slug と asset を足す)", () => { /* toTypeDraft → buildDefinition → fields が toStrictEqual */ });
it("asset は snapshotEmbed value を常に付け、slug は unique true と key slug を固定する", () => {});
it("changeKind は表示名・API 名・説明・必須を保ち、設定を既定に戻す", () => {});
it("availableKinds は key が slug のときだけ URL スラッグを含む", () => {});
it("suggestKey は英字を含むときだけ snake_case を返す", () => {
  expect(suggestKey("Title")).toBe("title"); expect(suggestKey("Sub-Title")).toBe("sub_title"); expect(suggestKey("2nd Title")).toBe("nd_title"); expect(suggestKey("タイトル")).toBe("");
});
it("autoFill は値が前回の提案と同じ間だけ追従する", () => {
  expect(autoFill("", "", "Title")).toBe("title"); expect(autoFill("Title", "title", "Titles")).toBe("titles"); expect(autoFill("Title", "my_title", "Titles")).toBe("my_title");
});
it("validateFieldKey は空・使えない文字(例つき)・重複・予約語を返す", () => {
  expect(validateFieldKey("Sub-Title", [])).toStrictEqual({ kind: "invalid", example: "sub_title" });
  expect(validateFieldKey("title", [{ key: "title", label: "タイトル" }])).toStrictEqual({ kind: "duplicate", label: "タイトル" });
  expect(validateFieldKey("id", [])).toStrictEqual({ kind: "reserved" });
  expect(validateFieldKey("", [])).toStrictEqual({ kind: "empty" });
  expect(validateFieldKey("title", [])).toBeNull();
});
it("validateTypeKey は既存の型(asset を含む)との重複を返す", () => {});
it("fieldChange は必須への変更と種類の変更を検出し、新規なら検出しない", () => {});
it("countEmpty / countFilled は削除済みを除き、空の定義どおりに数える", () => { /* "" / [] / null / undefined は空、"a" / ["x"] / 0 / false は値あり */ });
it("fieldTags の順と内容", () => { /* text required + title → ["必須", "タイトルに使う"]、asset many indexed → ["複数"]、必須に変更 + 種類を変更 → 末尾 2 つ */ });
it("effectiveTitleField は指定が text を指すときだけ指定、無ければ最初の text", () => {});
it("buildDefinition は titleField / listColumns の無くなった参照を落とし、menuOrder を運ぶ", () => {});
// content-types.test.ts
it("userTypeRows は利用者の型を menuOrder 順にし、同期前は count null で canDelete false", () => {});
it("userTypeRows は同期後に削除済みを除いて数え、0 件だけ canDelete", () => {});
it("pluginTypeGroups は pluginId で分け、modules の名前と navTypes の順を使い、システム型を出さない", () => {});
it("menuOrderUpdates は index と違う行だけ menuOrder 付きの定義にする", () => {});
it("referenceCandidates は自分自身と asset を除く", () => {});
```

- [ ] **Step 2: テストが失敗することを確かめる**

Run: `corepack pnpm --filter @plyrs/admin exec vitest run src/lib/content-type-form.test.ts src/lib/content-types.test.ts`
Expected: FAIL(関数が無い。旧 `content-type-form.tsx` は Task 9 まで旧の export を使うため、typecheck はこのタスクでは `components/content-type-form.tsx` と `content-type-builder.test.tsx` を消すまで落ちる → **このタスクで両ファイルを削除し、`routes/.../new.tsx` と `$typeKey.edit.tsx` は `ContentTypeForm` の代わりに一時的に `<p>` を描く**。Task 9 で本実装に置き換える)

- [ ] **Step 3: 実装する**

- [ ] **Step 4: テストが通ることを確かめる**

Run: `corepack pnpm --filter @plyrs/admin exec vitest run && corepack pnpm -r typecheck && corepack pnpm format && corepack pnpm lint`
Expected: PASS。`grep -rln "tokens.stylex" apps/admin/src/components apps/admin/src/routes/t` が 0 件

- [ ] **Step 5: コミット**

```bash
git add apps/admin/src
```

```bash
git commit -m "feat(admin): 型設計の文言と種類・下書き・API 名・一覧の純関数を作り直す"
```

---

### Task 6: 型の一覧(並べ替え・削除・モジュールの型)

**Files:**
- Create: `apps/admin/src/components/content-types/type-table.tsx`、`type-table.test.tsx`
- Create: `apps/admin/src/components/content-types/plugin-type-groups.tsx`、`plugin-type-groups.test.tsx`
- Create: `apps/admin/src/components/content-types/delete-type-dialog.tsx`、`delete-type-dialog.test.tsx`
- Rewrite: `apps/admin/src/routes/t/$tenantSlug/settings/content-types/index.tsx`
- Create: `apps/admin/src/content-types-list.test.tsx`、`content-types-reorder.test.tsx`、`content-types-delete.test.tsx`
- Modify: `apps/admin/src/shell.test.tsx`(「コンテンツタイプを追加」の断言があれば「作成」に)

**Interfaces:**
- Consumes: Task 3 の `SortableList`、Task 5 の `TypeRow` / `userTypeRows` / `pluginTypeGroups` / `menuOrderUpdates` / `CONTENT_TYPE_LABELS`、`SettingsFrame` / `CardLoading`、`DialogNote`、`Badge` / `Button` / `Skeleton` / `EmptyState` / `ConfirmDialog` / `toaster`、RAC `Link`、`useSyncHasSynced` / `useSyncTypes` / `useTenantSync` / `useRecordsOfTypes`、`contentTypesQueryOptions` / `modulesQueryOptions`、`deleteContentType` / `putContentType`、`useCan`
- Produces:

```ts
// type-table.tsx(E6・E7)
export interface TypeTableProps {
  rows: readonly TypeRow[];
  slug: string;
  canManage: boolean;                       // false: つまみ無し、削除・編集の代わりに「フィールドを見る」
  isReordering: boolean;                    // true: SortableList isDisabled
  onReorder: (orderedKeys: string[]) => void;
  onDelete: (row: TypeRow) => void;
}
export function TypeTable(props: TypeTableProps): JSX.Element;
// 列見出しの行 + 外枠(stroke.default border.default、radius.container、overflow hidden)の SortableList(label tableLabel、dragLabel(名前))。
// 行の中身は CSS グリッド "1fr 110px 120px 180px"(NARROW: "1fr 120px 180px" で「フィールド」を隠す)。
// 表示名: Link(編集へ。font.weightMedium、text.default)+ 下に font.caption text.muted の「{説明} ・ API 名: {key}」(説明が無ければ API 名だけ。key は font.familyMono)。
// フィールド: fields.length。コンテンツ: count === null ? <Skeleton height={14} width="40px" aria-hidden /> : count(n)(0 件は text.muted)。
// 操作(右寄せ、gap space.sm): canDelete && canManage → Button variant="dangerLink" size="sm"「削除」。canManage → Link 「編集」(Button secondary sm の見た目)、それ以外「フィールドを見る」

// plugin-type-groups.tsx(E8)
export function PluginTypeGroups(props: { groups: readonly PluginTypeGroup[]; slug: string }): JSX.Element | null;
// グループごとに見出し(h2 font.body weightBold: 名前 + Badge neutral「モジュール」+ moduleNote(font.caption text.muted))と TypeTable(canManage false、isReordering false、onReorder / onDelete は空関数)

// delete-type-dialog.tsx(E11)
export function DeleteTypeDialog(props: { target: { name: string } | null; onConfirm: () => void; onCancel: () => void; isPending: boolean }): JSX.Element;
// ConfirmDialog tone="danger"(isOpen = target !== null)。本文 body + DialogNote(warning、TriangleAlert)offline
```

`index.tsx`: `loader` は現行どおり `fetchQuery(contentTypesQueryOptions)`。`useQuery(contentTypesQueryOptions)` と `useQuery(modulesQueryOptions)`(失敗しても一覧は出す)、`useTenantSync` + `useSyncHasSynced` + `useRecordsOfTypes(sync.registry, 全型の key)`。`rows = userTypeRows(...)`、`groups = pluginTypeGroups(...)`。`canManage = useCan("type:manage")`。並べ替え: ローカル `order: string[] | null`(ドロップで設定、invalidate 後に `null`)、`reorder = useMutation(definitions → for … await putContentType)`、成功で invalidate、失敗でトースト + invalidate。削除: `remove = useMutation(key → deleteContentType)`、成功でトースト + invalidate、失敗でトースト(`errorMessage(cause, failed)`)+ invalidate、`onSettled` で target を `null`。`SettingsFrame tab="content-types" primaryAction=Button(Plus)「コンテンツタイプを作成」(canManage のときだけ)`、`isLoading={query.isPending}`、`error={isLoadingError ? … : undefined}`。中身: 説明文(`font.caption text.muted`)→ 利用者の型が 0 件なら `EmptyState`(LayoutGrid、title / description、action「コンテンツタイプを作成」)、あれば `TypeTable` → `PluginTypeGroups` → `DeleteTypeDialog`。

- [ ] **Step 1: 失敗するテストを書く**

```ts
// type-table.test.tsx
it("表示名・説明・API 名・フィールド数・件数と、0 件の型にだけ削除を出す", () => { /* link「お知らせ」の href が /t/blog/settings/content-types/news/edit、「API 名: news」、button「削除」が 1 つ */ });
it("件数が null ならスケルトンで削除が無い", () => {});
it("canManage が false ならつまみと削除が無く「フィールドを見る」のリンク", () => {});
// plugin-type-groups.test.tsx
it("グループの見出しにモジュール名・バッジ・注記を出し、行には「フィールドを見る」だけ", () => {});
// delete-type-dialog.test.tsx
it("題・本文・オフラインの注記・危険色の「削除する」を出し、初期フォーカスはキャンセル", async () => {});
// content-types-list.test.tsx(records-harness の renderAt + bootstrapped。モーダル無し)
it("利用者の型を menuOrder 順に出し、モジュールの型は見出しで分け、asset は出さない", async () => {
  // /v1/t/t1/content-types に news(menuOrder 1)・blog(menuOrder 0)・booking.slot(plugin, pluginId booking)・asset(system)、/v1/t/t1/modules に 予約
  // → grid「コンテンツタイプの一覧」の row の順が ブログ → お知らせ、heading「予約」、「アセット」が無い
});
it("同期前は件数がスケルトンで削除が出ず、同期後に 0 件の型にだけ削除が出る", async () => { /* bootstrapped 前は button「削除」が無い → bootstrapped(socket, [記事 1 件], types) 後に 0 件の型の行にだけ「削除」(Review Focus 2) */ });
it("取得に失敗すると中身だけにエラーと再試行が出る", async () => {});
it("type:manage の無い人には作成ボタン・つまみ・削除が無い", async () => { /* authedRoutes(…, "editor") は settings の guard でホームへ転送されるので、このテストは TypeTable の部品テストで代替し、ここでは転送を断言 */ });
// content-types-reorder.test.tsx(1 本)
it("キーボードで並べ替えると変わった型だけ menuOrder 付きで PUT し、失敗ならトーストと取り直し", async () => {
  // 「お知らせを並べ替え」にフォーカス → Enter → ArrowDown → Enter → PUT が 2 回(blog: menuOrder 0 → 1 … 変わる行だけ)。E31 のとおり動かなければ報告
});
// content-types-delete.test.tsx(1 本)
it("削除は確認を経て DELETE し、409 type_not_empty ならトーストを出して一覧を取り直す", async () => {
  // fireEvent.click「削除」→ alertdialog → 「削除する」→ DELETE /v1/t/t1/content-types/event が 409 { error: "type_not_empty" } → 通知 region にその文、GET が 2 回目、行が残る(Review Focus 4)
});
```

- [ ] **Step 2: テストが失敗することを確かめる**

Run: `corepack pnpm --filter @plyrs/admin exec vitest run src/components/content-types src/content-types-list.test.tsx src/content-types-delete.test.tsx src/content-types-reorder.test.tsx`
Expected: FAIL(部品が無い、旧の表)

- [ ] **Step 3: 実装する**

- [ ] **Step 4: テストが通ることを確かめる**

Run: `corepack pnpm --filter @plyrs/admin exec vitest run && corepack pnpm -r typecheck && corepack pnpm format && corepack pnpm lint`
Expected: PASS。`grep -rn "コンテンツタイプを追加" apps/admin/src` が 0 件

- [ ] **Step 5: コミット**

```bash
git add apps/admin/src
```

```bash
git commit -m "feat(admin): 設定 › コンテンツタイプの一覧を並べ替え・削除つきに作り直す"
```

---

### Task 7: フィールドの追加ダイアログ(2 段階)と削除の確認

**Files:**
- Create: `apps/admin/src/components/content-types/add-field-dialog.tsx`、`add-field-dialog.test.tsx`
- Create: `apps/admin/src/components/content-types/delete-field-dialog.tsx`、`delete-field-dialog.test.tsx`

**Interfaces:**
- Consumes: Task 3 の `ModalDialog size="lg"`、Task 5 の `FIELD_KINDS` / `FieldKind` / `suggestKey` / `autoFill` / `validateFieldKey` / `keyErrorMessage` / `FIELD_KIND_LABELS` / `ADD_FIELD_LABELS` / `FIELD_PANEL_LABELS`、`Button` / `TextField` / `DialogNote`
- Produces:

```ts
// add-field-dialog.tsx(T4、E13・E14・E15・E33)
export interface AddFieldDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  existing: readonly { key: string; label: string }[];   // 重複の検証
  hasSlug: boolean;                                       // URL スラッグのカードを無効に
  onAdd: (input: { kind: FieldKind; key: string; label: string }) => void; // 呼び出し側が閉じる
}
export function AddFieldDialog(props: AddFieldDialogProps): JSX.Element;
// 開くたびに step 1・選択なし・入力空に戻す(isOpen の立ち上がりで reset)。
// 段階の表示: 題の下に「1. 種類を選ぶ › 2. 名前を付ける」(現在の段階は weightBold、1 段目が済んだら step1Done(種類名))。
// 1 段目: グループ見出し(font.caption weightBold text.muted)+ 3 列グリッド(NARROW 1 列、gap space.sm)の Button(variant secondary、
//   高さ auto、縦並び: アイコン(Global Constraints の対応)+ 名前(font.body weightMedium)+ 説明(font.caption text.muted、左寄せ)。
//   選択中は aria-pressed と accent.surface / accent.default の枠)。上級者向けは区切り線の下に 1 枚(横並び、opacity 0.7)。
//   slug は hasSlug のとき isDisabled + disabledReason(slugTaken)。下部: キャンセル / 次へ(未選択は無効)
// 2 段目: TextField 表示名(isRequired、description labelHelp、autoFocus)+ TextField API で使う名前(isMonospace、placeholder、description keyHelp、
//   errorMessage は validateFieldKey の結果(入力があるとき)。slug なら value "slug" で isDisabled、表示名の初期値は FIELD_KIND_LABELS.slug.name)。
//   key は autoFill で追従(E14)。下部: 左「‹ 種類を選び直す」(ChevronLeft)、右 キャンセル / 追加(表示名が空か 100 字超、key に誤りなら無効)
// 追加 → onAdd({ kind, key, label: label.trim() })

// delete-field-dialog.tsx(T5、E17)
export function DeleteFieldDialog(props: { target: { label: string; key: string } | null; onConfirm: () => void; onCancel: () => void }): JSX.Element;
// ConfirmDialog tone="danger": title(label)、body(key)、DialogNote(warning、TriangleAlert)publicNote、confirm「削除する」
```

- [ ] **Step 1: 失敗するテストを書く**

```ts
// add-field-dialog.test.tsx(直接描画。1 つの it で開くのは 1 回)
it("1 段目は 10 種類のカードを基本 / つなぐ / 上級者向けに分け、選ぶまで次へが無効", () => { /* button name /テキスト\(1 行\)/ … 10 枚、「次へ」disabled → click カード → aria-pressed、enabled */ });
it("URL スラッグが既にあればカードが無効で理由が読める", async () => { /* hasSlug → button /URL スラッグ/ が aria-disabled、hover / focus で「この型には既に URL スラッグがあります」(Review Focus 5) */ });
it("日本語の表示名では API 名が空のままで追加が無効、英字なら自動で入る", async () => {
  // テキストを選び次へ → 表示名「サブタイトル」→ API 名の値 ""、「追加」disabled、「API で使う名前を入力してください」。
  // 表示名を「Sub Title」に → API 名 "sub_title"、enabled → 追加 → onAdd({ kind: "text", key: "sub_title", label: "Sub Title" })(Review Focus 1)
});
it("手で変えた API 名は表示名を変えても追従しない。重複は表示名つきで出る", async () => { /* existing [{ key: "title", label: "タイトル" }] → key を title に → 「「title」は「タイトル」で既に使われています」 */ });
it("URL スラッグを選ぶと 2 段目の API 名は slug で固定、表示名の初期値は「URL スラッグ」", async () => {});
it("種類を選び直すで 1 段目に戻り、選択は保たれる", async () => {});
// delete-field-dialog.test.tsx
it("題・本文(API 名入り)・公開 API の注記・危険色の「削除する」、初期フォーカスはキャンセル", async () => {});
```

- [ ] **Step 2: テストが失敗することを確かめる**

Run: `corepack pnpm --filter @plyrs/admin exec vitest run src/components/content-types/add-field-dialog.test.tsx src/components/content-types/delete-field-dialog.test.tsx`
Expected: FAIL(部品が無い)

- [ ] **Step 3: 実装する**

- [ ] **Step 4: テストが通ることを確かめる**

Run: `corepack pnpm --filter @plyrs/admin exec vitest run src/components/content-types && corepack pnpm -r typecheck && corepack pnpm format && corepack pnpm lint`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add apps/admin/src/components/content-types
```

```bash
git commit -m "feat(admin): フィールドの追加ダイアログ(種類 → 名前)と削除の確認を足す"
```

---

### Task 8: フィールドの詳細設定パネル

**Files:**
- Create: `apps/admin/src/components/content-types/field-panel.tsx`、`field-panel.test.tsx`

**Interfaces:**
- Consumes: Task 4 の `SidePanel`、Task 5 の `FieldDraft` / `changeKind` / `availableKinds` / `validateFieldKey` / `keyErrorMessage` / `autoFill` / `FIELD_KIND_LABELS` / `FIELD_PANEL_LABELS`、`TextField` / `TextArea` / `Checkbox` / `CheckboxGroup` / `Select` / `SegmentedControl` / `Button` / `IconButton`、`FIELD_LABEL_MAX_LENGTH` / `FIELD_DESCRIPTION_MAX_LENGTH`
- Produces:

```ts
// field-panel.tsx(E 4 章、E13・E16・E19・E22・E34・E35)
export interface FieldPanelProps {
  draft: FieldDraft | null;                       // null = 閉じる
  others: readonly { key: string; label: string }[];  // 自分以外(重複の検証・slug の有無)
  typeOptions: readonly { key: string; name: string }[]; // 参照できる型の候補(E22)
  isTitle: boolean;                               // 開いた時点で titleField がこのフィールドか
  isReadOnly: boolean;                            // E9
  returnFocusTo: RefObject<HTMLElement | null>;
  onApply: (draft: FieldDraft, options: { isTitle: boolean }) => void;
  onCancel: () => void;
  onDelete: () => void;                           // 「このフィールドを削除」(確認は呼び出し側)
}
export function FieldPanel(props: FieldPanelProps): JSX.Element | null;
// draft が変わるたびにローカルの複製(local)と isTitle を取り直す(key で useEffect)。SidePanel(title = local.label || local.key、subtitle(種類名)、onClose = onCancel)。
// 本文(上から): Select 種類(items = availableKinds(local, hasSlug(others)) の名前、onChange → changeKind。isReadOnly なら isReadOnly)/
//   TextField 表示名(isRequired、description、errorMessage: 空 or 100 字超)/ TextField API で使う名前(isMonospace、isNew なら編集可 + keyHelp + validateFieldKey の errorMessage、
//   そうでなければ isDisabled + keyHelpSaved。isNew かつ slug 以外なら autoFill で表示名に追従)/ TextArea 説明文(rows 2、description、500 字超のエラー)/
//   区切り線 / Checkbox 必須 / kind text: Checkbox タイトルに使う(+ help)、TextField 最大文字数(inputMode numeric、isMonospace)、Checkbox 絞り込み・並べ替え(+ help)、Checkbox 同じ値を許可しない(+ help)/
//   slug: Checkbox 同じ値を許可しない(isSelected true、isDisabled、uniqueSlugHelp)、Checkbox 絞り込み・並べ替え、最大文字数 / number: 整数のみ、絞り込み・並べ替え、同じ値を許可しない /
//   boolean: 絞り込み・並べ替え / datetime: 絞り込み・並べ替え、同じ値を許可しない / select: 選択肢の表(E34)、Checkbox 複数選択、絞り込み・並べ替え /
//   asset: SegmentedControl 件数 / reference: CheckboxGroup 参照できる型(typeOptions、errorMessage が空なら allowedTypesRequired)、SegmentedControl 件数、Checkbox 並び順を保持(+ help)/ richtext・json: 無し
// 下部: 左 Button variant="dangerLink"「このフィールドを削除」(isReadOnly なら無し)、右 キャンセル / 適用(isReadOnly なら「閉じる」だけ)。
// 適用の検証(E34 を含む): 表示名 1〜100、説明 ≤ 500、key(isNew のとき)、最大文字数は空か正の整数、select は options ≥ 1・value 非空・value 重複なし、reference は allowedTypes ≥ 1。
// 通れば onApply({ ...local, label: trim, description: trim }, { isTitle })
```

- [ ] **Step 1: 失敗するテストを書く**

```ts
// field-panel.test.tsx(直接描画。SidePanel は非モーダル)
it("テキストの設定項目を言い換えた文言で出し、適用で下書きを返す", async () => {
  // dialog「タイトル」、副題「種類: テキスト(1 行)」、checkbox「必須」「タイトルに使う」「公開 API で絞り込み・並べ替えに使う」「同じ値を許可しない」、textbox「最大文字数」
  // 必須を on、最大文字数 "200" → 適用 → onApply({ …required: true, maxLength: "200" }, { isTitle: false })
});
it("保存済みの API 名は変更できず、未保存なら表示名に追従して重複を検証する", async () => {});
it("API 名が slug でなければ種類に URL スラッグが無い", async () => { /* Select「種類」の候補に「URL スラッグ」が無い。key slug の draft なら有る(Review Focus 5) */ });
it("種類を数値に変えると設定が既定に戻り、副題が変わる", async () => { /* vi.mock 無しで RAC Select を開く(部品テストは許容)。難しければ Select を list-columns-select と同じ方式で 1 ファイルに分けて差し替える */ });
it("選択肢は表で編集し、値が空や重複なら適用できない", async () => {});
it("参照は型の候補・件数・並び順を保持を出し、型を 1 つも選ばないと適用できない", async () => {});
it("読み取り専用は入力が isReadOnly で、下部は閉じるだけ", () => {});
it("このフィールドを削除で onDelete を呼ぶ", async () => {});
```

- [ ] **Step 2: テストが失敗することを確かめる**

Run: `corepack pnpm --filter @plyrs/admin exec vitest run src/components/content-types/field-panel.test.tsx`
Expected: FAIL(部品が無い)

- [ ] **Step 3: 実装する**

- [ ] **Step 4: テストが通ることを確かめる**

Run: `corepack pnpm --filter @plyrs/admin exec vitest run src/components/content-types && corepack pnpm -r typecheck && corepack pnpm format && corepack pnpm lint`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add apps/admin/src/components/content-types
```

```bash
git commit -m "feat(admin): フィールドの詳細設定パネルを足す"
```

---

### Task 9: 型のエディタ(作成・編集・読み取り専用)とルート

**Files:**
- Create: `apps/admin/src/components/content-types/field-list.tsx`、`field-list.test.tsx`
- Create: `apps/admin/src/components/content-types/list-columns-select.tsx`
- Create: `apps/admin/src/components/content-types/list-columns-picker.tsx`、`list-columns-picker.test.tsx`
- Create: `apps/admin/src/components/content-types/type-editor.tsx`、`type-editor.test.tsx`
- Create: `apps/admin/src/test-utils/list-columns-select-mock.tsx`
- Rewrite: `apps/admin/src/routes/t/$tenantSlug/settings/content-types/new.tsx`、`$typeKey.edit.tsx`
- Create: `apps/admin/src/content-types-new.test.tsx`、`content-types-edit.test.tsx`、`content-types-field-delete.test.tsx`

**Interfaces:**
- Consumes: Task 3 の `SortableList`、Task 5 の全部、Task 7 の `AddFieldDialog` / `DeleteFieldDialog`、Task 8 の `FieldPanel`、`TenantPageHeader` / `PageBody`、`DialogNote`、`Badge` / `Button` / `IconButton` / `TextField` / `TextArea` / `Select` / `EmptyState` / `toaster`、`homeCrumb` / `settingsCrumb` / `settingsContentTypesCrumb` / `currentCrumb`、`useCan`、`useTenantSync` / `useSyncHasSynced` / `useRecordsOfTypes`、`contentTypesQueryOptions`、`putContentType`、`uuidv7`
- Produces:

```ts
// field-list.tsx(E 5.2、T2・T5、E18)
export interface FieldListProps {
  drafts: readonly FieldDraft[];
  original: readonly FieldDefinition[];            // 保存済みの定義(変更の検出)
  records: readonly SyncRecord[] | null;           // null = 同期前(件数なし)
  titleKey: string | null;                         // effectiveTitleField
  editingKey: string | null;                       // パネルで開いている行
  isReadOnly: boolean;
  onEdit: (key: string, trigger: HTMLElement) => void;  // 「編集」/「詳細」。trigger はフォーカスの戻し先
  onReorder: (orderedKeys: string[]) => void;
}
export function FieldList(props: FieldListProps): JSX.Element;
// 外枠(stroke.default border.default、radius.container、overflow hidden、bg.canvas)の SortableList(rowHeight "tall"、isDisabled = isReadOnly、dragLabel(label))。
// 行(flex、gap space.sm、NARROW は wrap): 表示名(weightMedium)+ API 名(font.caption familyMono text.muted)(flex 1)/ 種類(font.caption text.muted、幅 130px。
// 種類を変更なら「{元} → {新}」)/ タグ(Badge neutral。必須に変更・種類を変更は tone="warning")/ Button secondary sm「編集」(editingKey と同じ行は primary「編集中」+ aria-expanded、isReadOnly は「詳細」)。
// 編集中の行は accent.surface。変更(fieldChange)があれば行の下に DialogNote(warning、TriangleAlert)で warnings の文(件数は records から countEmpty / countFilled、null なら件数なし)

// list-columns-select.tsx(テストで差し替えるため 1 ファイル)
export function ListColumnsSelect(props: { label: string; items: { value: string; label: string }[]; onChange: (value: string) => void; isDisabled: boolean }): JSX.Element;
// Select(isLabelHidden、placeholder = label、selectedValue "")。選ぶと onChange(value) を呼び、表示は未選択に戻る
// test-utils/list-columns-select-mock.tsx: 同じ props の素の <select aria-label={label}>(先頭に空の option)

// list-columns-picker.tsx(E20)
export function ListColumnsPicker(props: { fields: readonly { key: string; label: string }[]; value: readonly string[]; onChange: (value: string[]) => void; isReadOnly: boolean }): JSX.Element;
// 見出し「一覧に表示する列」+「最大 3 件」(font.caption text.muted)、チップ(Badge accent: 表示名 + IconButton X「{表示名}を外す」。isReadOnly なら × 無し)、
// ListColumnsSelect(items = value に無いフィールド、isDisabled = value.length >= LIST_COLUMNS_MAX || isReadOnly)、help

// type-editor.tsx(E4・E24・E25・E29)
export type TypeEditorMode = "new" | "edit" | "view";
export interface TypeEditorProps {
  slug: string;
  mode: TypeEditorMode;
  initial: TypeDraft;
  original: readonly FieldDefinition[];            // new は []
  typeName: string;                                // h1(new は createTitle)
  existingTypes: readonly ContentTypeSummary[];    // API 名の重複と参照の候補
  records: readonly SyncRecord[] | null;
  onSubmit: (draft: TypeDraft) => Promise<void>;   // ルートが PUT・invalidate・トースト・遷移
  onCancel: () => void;
  isPending: boolean;
}
export function TypeEditor(props: TypeEditorProps): JSX.Element;
// 状態: draft(TypeDraft)、keyTouched、editingKey、addOpen、deleteTarget、panelReturnRef。
// 見出し: TenantPageHeader(title typeName、breadcrumbs [home, settings, settingsContentTypes, current(new は createCrumb、他は型名)]、
//   meta(view なら viewMeta)、primaryAction(view 以外: Button「作成」/「保存」。isDisabled と disabledReason: パネルが開いていれば panelOpenReason、
//   それ以外は無効の理由なし)、補助操作「キャンセル」(view は無し))。
// 有効条件(E4): new → name 非空・key の検証が null・fields ≥ 1・説明 ≤ 1000・editingKey null。edit → それに加えて isTypeDraftDirty(draft, initial)。
// 本文(PageBody、maxWidth SETTINGS_MAX_WIDTH、flex column gap space.lg、paddingInlineEnd: editingKey !== null ? 420px : 0(NARROW 0)):
//   2 列グリッド(NARROW 1 列): TextField 表示名(isRequired、help、autoFocus(new))/ TextField API 名(isMonospace、new は isRequired + placeholder + keyHelpNew +
//   autoFill で追従 + errorMessage(validateTypeKey、入力があるとき)、edit / view は isDisabled + keyHelpEdit)。TextField 説明(placeholder、help、1000 字超のエラー)。
//   「フィールド {n}」(font.body weightMedium + font.caption の件数)と fieldsHelp(右)→ fields 0 件なら EmptyState(compact、LayoutGrid、title / description、action「フィールドを追加」(view は無し))、
//   あれば FieldList → Button secondary(Plus)「フィールドを追加」(view は無し)。ListColumnsPicker(fields = draft.fields の key / label(label || key))。
// FieldPanel(draft = editingKey の FieldDraft、others、typeOptions = referenceCandidates(existingTypes, mode === "new" ? null : draft.key)、isTitle、isReadOnly = view)。
// onApply: draft.fields を差し替え、isTitle なら titleField = key、isTitle でなく titleField === key なら null。パネルを閉じる。
// AddFieldDialog(existing = fields の key / label、hasSlug)。onAdd: emptyFieldDraft を末尾に足し、閉じてから editingKey = key(続けてパネル)。
// onDelete(パネル): isNew なら即時に消す、そうでなければ deleteTarget → DeleteFieldDialog → 確認で消す。消したらパネルを閉じ、titleField / listColumns から外す
```

`new.tsx`: `loader` は `fetchQuery(contentTypesQueryOptions)`。`TypeEditor mode="new"`、`initial = emptyTypeDraft()`、`original = []`、`typeName = createTitle`、`records = null`。`onSubmit`: `buildDefinition({ id: uuidv7(), version: 1, draft })` → ok でなければ `toaster.error(errors.join(" "))`(描画側で検証済みなので保険)→ `putContentType` → `invalidateQueries(content-types)` → `toaster.success(created)` → 一覧へ。失敗は `toaster.error(errorMessage(cause, saveFailed))`。`useCan("type:manage")` が false なら `mode="view"` ではなく一覧へ `navigate`(作る権限が無い)。

`$typeKey.edit.tsx`: `loader` は現行どおり。`existing` が無ければ `TenantPageHeader(title typeKey)` + `notFound(typeKey)`(現行の形)。`mode = existing.source === "user" && can ? "edit" : "view"`、`initial = toTypeDraft(existing)`、`original = existing.fields`、`records = hasSynced ? useRecordsOfTypes(registry, [typeKey]) : null`。`onSubmit`: `buildDefinition({ id: existing.id, version: existing.version, menuOrder: existing.menuOrder ?? undefined, draft })` → PUT → invalidate → `toaster.success(saved)` → 一覧へ。

- [ ] **Step 1: 失敗するテストを書く**

```ts
// field-list.test.tsx
it("行に表示名・API 名・種類・タグ・編集を出し、編集中の行は「編集中」", () => {});
it("必須に変更と種類を変更の行には警告のタグと件数つきの注意が行の下に出る", () => { /* records 3 件(空 2 件)→ 「必須に変更」Badge、「…(2 件)は…」が row の中にある(DOM の親子で断言) */ });
it("records が null なら件数なしの文", () => {});
it("読み取り専用はつまみが無く「詳細」", () => {});
// list-columns-picker.test.tsx
it("選択中をチップで出し、外すと onChange、3 件で追加が無効", async () => {});
// type-editor.test.tsx(直接描画。AddFieldDialog を開く it は 1 回だけ開く)
it("新規は表示名・API 名・フィールドがそろうまで作成が無効で、英字の表示名から API 名が入る", async () => { /* 「News」→ key "news"。フィールド 0 件の EmptyState。作成 disabled */ });
it("フィールドを追加すると末尾に行が増え、続けてパネルが開く", async () => { /* fireEvent.click「フィールドを追加」→ dialog → /テキスト/ → 次へ → 表示名「Title」→ 追加 → row「Title」、dialog「Title」(パネル)が開く、作成は disabledReason */ });
it("編集は変更が無いと保存が無効で、表示名を変えると有効になり onSubmit に下書きを渡す", async () => {});
it("パネルの適用でタイトルに使うが移り、行のタグが変わる", async () => {});
it("読み取り専用は保存・追加・列の変更が無く、行の詳細でパネルが読み取り専用で開く", async () => {});
it("API 名の重複は型名つきで出る", async () => { /* existingTypes に asset(アセット)→ key "asset" → 「「asset」は「アセット」で既に使われています」 */ });
// content-types-new.test.tsx(1 本。records-harness)
it("型を作ると定義を PUT して一覧に戻り、トーストが出る", async () => {
  // E28 と同じ手順(表示名「記事」→ API 名「article」→ 追加ダイアログ → title → 適用 → 作成)。PUT body: key article、name 記事、fields [{ key: "title", type: "text", label: "title" }]、source user、version 1、id が UUID。
  // 通知「作成しました」、tab「コンテンツタイプ」が選択中(Review Focus 1 の作成側)
});
// content-types-edit.test.tsx(モーダル無し。vi.mock("./components/content-types/list-columns-select") で素の select)
it("既存のフィールドを必須にすると件数つきの注意が出て、保存すると PUT に入る", async () => {
  // bootstrapped(socket, [article 2 件(title 空 1 件)], [articleType]) → 「編集」(title の行)→ パネルの checkbox「必須」→ 適用 → Badge「必須に変更」、「(1 件)」→ 保存 → PUT body の fields[0].required true、version 2、id が元の id(Review Focus 3)
});
it("一覧に表示する列を足すと listColumns が PUT に入る", async () => {});
it("保存が 409 なら利用者向けの文のトーストを出して画面に留まる", async () => { /* key_mismatch → ERROR_MESSAGES.key_mismatch、pathname が edit のまま */ });
it("モジュールの型は読み取り専用で開き、保存が無い", async () => {});
it("無い型は見つからない文を出す", async () => {});
// content-types-field-delete.test.tsx(1 本)
it("保存済みのフィールドの削除は確認を経て行を消し、保存で fields から外れる", async () => {});
```

- [ ] **Step 2: テストが失敗することを確かめる**

Run: `corepack pnpm --filter @plyrs/admin exec vitest run src/components/content-types src/content-types-new.test.tsx src/content-types-edit.test.tsx src/content-types-field-delete.test.tsx`
Expected: FAIL(部品が無い、ルートが仮の `<p>`)

- [ ] **Step 3: 実装する**

- [ ] **Step 4: テストが通ることを確かめる**

Run: `corepack pnpm --filter @plyrs/admin exec vitest run && corepack pnpm -r typecheck && corepack pnpm format && corepack pnpm lint`
Expected: PASS。`grep -rn "既存のレコードは自動では追従しません\|ContentTypeForm" apps/admin/src` が 0 件

- [ ] **Step 5: コミット**

```bash
git add apps/admin/src
```

```bash
git commit -m "feat(admin): 型の作成・編集を右パネルつきのエディタに作り直す"
```

---

### Task 10: E2E のヘルパー、全体の検証、preview での実機確認、報告

**Files:**
- Modify: `apps/e2e/helpers/setup.ts:100-130`(`createArticleType` / `createArticleRecord`。E28)

- [ ] **Step 1: E2E のヘルパーを直す**

`createArticleType`: 「コンテンツタイプを追加」→「コンテンツタイプを作成」。`textbox「key」` → `textbox「表示名」` に「記事」、`textbox「API 名」` に「article」(日本語の表示名なので手入力)。「フィールドを追加」→ `dialog「フィールドを追加」` の `button { name: /テキスト\(1 行\)/ }` → 「次へ」→ ダイアログ内の `textbox「表示名」` に「title」(API 名は自動で `title`)→ 「追加」→ `dialog「title」`(パネル)の「適用」→ 「作成」。末尾の断言(タブが選択中)はそのまま。コメントを E28 の手順に。

`createArticleRecord`: 行の「レコード」リンクの代わりに `page.getByRole("complementary").getByRole("link", { name: "記事", exact: true }).click()`(サイドバーの型のリンク)。以降は同じ。

- [ ] **Step 2: 静的検査とテスト**

Run: `corepack pnpm lint && corepack pnpm format:check && corepack pnpm -r typecheck && corepack pnpm -r --filter "!@plyrs/e2e" test`
Expected: すべて成功(ui の RAC のテストがタイムアウトしたら単独で再実行。api の session.test が落ちたら単独で再実行)。`grep -rln "tokens.stylex" apps/admin/src/components apps/admin/src/routes/t` が 0 件

- [ ] **Step 3: ビルドと E2E(ユーザーに依頼。サンドボックスの外。`apps/api/.wrangler` / `apps/admin/.wrangler` が消える)**

Run: `pnpm --filter @plyrs/admin build && pnpm --filter @plyrs/e2e test`
Expected: build 成功、3 spec が PASS

- [ ] **Step 4: dev での見た目の確認(ユーザーに依頼。`run` スキルを使ってよい)**

依頼書 3 章「確認する状態」の「型設計」と「共通」を owner で見る:

- 一覧: 説明文、利用者の型(表示名 / 説明 ・ API 名 / フィールド数 / 件数 / 編集)、0 件の型にだけ「削除」、つまみでドラッグするとサイドバーの順が変わる(再読み込み後も)、モジュールの型は見出し + バッジ + 注記で「フィールドを見る」、`asset` が無い、`version` `source` の文字が無い
- 新規作成: 「作成」が表示名・API 名・フィールド 1 件までは無効、英字の表示名で API 名が自動、フィールド 0 件の空状態、追加ダイアログの 3 列カード(JSON は区切り線の下に薄く)、URL スラッグが既にあればカードが無効で理由、2 段目で日本語なら API 名の入力を求める、追加後に末尾 + パネル
- 編集: 48px の行・タグ・「編集」でパネル(420px、本文が右に避ける)、パネルの各種類の設定項目(言い換えた文言)、「タイトルに使う」が 1 つだけ、一覧に表示する列のチップ(最大 3)、必須に変更 / 種類を変更で行の直下に警告色の注意(件数つき)、保存済みフィールドの削除で危険色の確認、API 名のエラー(使えない文字の例、重複、予約語)、保存後に一覧とトースト、キャンセルで一覧へ
- キーボード: つまみにフォーカス → Enter → ↓ → Enter で並べ替わる。パネルを Esc で閉じると「編集」にフォーカスが戻る。設定のタブを ← → で動かし Enter で遷移した後、そのタブにフォーカスが残る(E3)
- 狭い画面(959px 以下): 一覧のフィールド数の列が隠れる、2 列が 1 列、カードが 1 列、パネルが全面のシート、行の種類・タグが折り返す。ダーク: 行・タグ・警告の注記・パネル・カードの配色

- [ ] **Step 5: ブランチの仕上げ**

superpowers:finishing-a-development-branch に従い、統合方法(ローカルマージ / push して PR / 残す)をユーザーに提示して選んでもらう。push はユーザーに確認してから(`git -c credential.helper='!gh auth git-credential' push https://github.com/hiz8/plyrs.git <branch>`、PR は `gh pr create --repo hiz8/plyrs`)。ワークツリー隔離のセッションでは main 側の git 操作が拒否されるため、ローカルマージは ExitWorktree(keep) で main に戻ってから `git merge --ff-only`(main に同名の未追跡ファイルがあれば先に消す。`git worktree remove` はサンドボックス外から)。

- [ ] **Step 6: preview での実機確認(ロードマップ 5 章の注記。ユーザーに依頼)**

main への反映で preview に自動デプロイされる。`/t/<slug>/settings/content-types` と `/t/<slug>/settings/content-types/<key>/edit` を直接開いて描画されること(SPA シェルの転送)、型の並べ替えがサイドバーに反映されること、新しい型の作成と公開 API(`/public/v1/<slug>/records/<key>`)での取得、フィールドの必須化・種類の変更・削除の注意と保存、0 件の型の削除(同じ API 名で作り直せる)を確かめる。食い違いがあれば報告する(直すか後続に回すかはユーザーが決める)。

- [ ] **Step 7: 報告**

ユーザーに次をまとめて報告する: 裁定台帳(E1〜E35)と設計書への書き戻し、実行中に下した裁定(SDD の台帳 `.superpowers/sdd/<計画名>/progress.md` の Ruling)、D3 にあって V4-E に入れなかったもの(T1 の 52px の行、T2 の本文とパネルの重ね描き)、読む側の未対応(E21: 一覧の `listColumns`、ホームの型の `description`)、後続へ送るもの(E26 の離脱ガード、E27 の 7 章の未決、design-sync の再同期は V4-F の最後)、E2E・preview で見つかった食い違い、`.design-sync/NOTES.md` に記録した ui の変更(`SortableList`・`SidePanel`・`ModalDialog.size`)。

---

## セルフレビュー(2026-10-20)

- 仕様の網羅: E 3 章(10 種類とグループ、画像・ファイルの既定の埋め込み、参照できる型の複数選択、URL スラッグの規約と 1 つだけ、JSON を上級者向けに)→ Task 5(`FIELD_KINDS` / `kindOf` / `buildDefinition`)・7(カード)・8(パネル)。4 章(言い換え、選択肢の表、1 件だけ / 複数、並び順を保持、埋め込みを表示しない)→ Task 5(文言)・8。5.1(列、key を小さく、asset を出さない、モジュールの型の見出し、ドラッグで menuOrder、0 件の型だけ削除)→ Task 3・5・6。5.2(表示名 / API 名 / 説明、48px の行、右パネル 420px、狭い画面、タイトルに使う、2 段階のダイアログ、自動生成、作成後の key 不変)→ Task 3・4・7・8・9。5.3(冒頭の注意をやめ、行の直下にインライン、タグ、件数、削除の確認、API 名のエラーに例)→ Task 5・7・9。5.4(0 件だけ削除、409 の案内、文言)→ Task 6。6 章(書く側: `titleField` / `listColumns` / `label` / `description` / `menuOrder` / 型の `description`)→ Task 6・8・9(読む側は E21)。H 2 章(h1 1 つ、主操作 / 補助操作)→ Task 6・9。H 6・8 章 → Task 6・9。H 10・11 章 → Task 3・4・9。V4-G の後回し → Task 2。旧トークンの持ち越し → Task 5(削除)
- 型の整合: `FieldKind` / `FieldDraft` / `TypeDraft` / `KeyError`(Task 5)を Task 7(`onAdd` の `{ kind, key, label }`)・8(`FieldPanelProps.draft`・`onApply(draft, { isTitle })`)・9(`TypeEditorProps.initial`・`FieldListProps.drafts`)で使う。`TypeRow` / `PluginTypeGroup`(Task 5)を Task 6 の `TypeTable` / `PluginTypeGroups` が使う。`SortableList.onReorder(orderedIds)`(Task 3)を Task 6(`orderedKeys` → `menuOrderUpdates`)と Task 9(`FieldList.onReorder`)が受ける。`SidePanel.returnFocusTo`(Task 4)を Task 8 の `FieldPanelProps.returnFocusTo` が渡し、Task 9 の `FieldList.onEdit(key, trigger)` が元を供給する。`ModalDialog.size="lg"`(Task 3)を Task 7 が使う
- Review Focus: 5 項目すべてに Task 6・7・8・9 のテスト名を結んだ
- ステップの粒度: 各タスクのコード本体は署名と pinned な値(文言・寸法・順序・検証の規則・エラーの対応)だけで、アルゴリズムを決める必要がある箇所(`suggestKey` / `autoFill` の規則、`kindOf` の判定、`reorderIds`、`fieldChange` と件数の数え方、保存の有効条件、パネルの適用の検証、`menuOrderUpdates` の差分)だけ 1 行で書いた
- 入れなかったもの(範囲外として報告): 7 章の未決(複数行テキスト、日付のみ。E27)、読む側の `listColumns` と型の `description`(E21)、離脱ガード(E26)、運営コンソールの旧トークン(V4 の範囲外)、design-sync の再同期(V4-F)
