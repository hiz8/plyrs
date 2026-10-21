# 管理画面 UX 再構築 V4-F: メディア(案 F) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** メディアの一覧(グリッド / リスト、絞り込み・検索・並び順、画面全体へのドロップと複数ファイルの逐次アップロード、仮タイルと全体の進捗)、URL を持つ詳細パネル(プレビュー・情報・代替テキストとキャプションの保存・公開状態と公開 URL・使用箇所・削除)、複数選択と一括削除、編集画面から開くメディア選択ダイアログ(1 件 / 複数、ダイアログ内アップロード、代替テキストの編集)を案 F 3〜8 章と D3 M1〜M10・C2 のとおりに作り直し、asset 型の汎用の編集画面(と案 C 10 章の暫定)を消す。最後に design-sync の再同期(V2〜V4-F 分)をまとめて行う。

**Architecture:** 画面の判断は純関数に寄せ、部品は描くだけにする(V2〜V4-E と同じ)。絞り込み・検索・並び順の URL クエリ、種類の判定、UUIDv7 からのアップロード日時、一覧の行と件数、削除の確認の文言は `lib/media-list.ts`(新規)。アップロードの進行(仮タイルの状態、完了の印の保持、再試行・取り除く・残りを中止)は T15 の `uploadFiles` を包む `lib/use-uploads.ts`。ui に `TileGrid`(RAC `GridList layout="grid"` + 選択)、`UploadTile`、`FileDropTarget`(画面全体のドロップ)、`FileButton`(RAC `FileTrigger`)を足し、`SidePanel` に `width` / `narrowLayout`、`ModalDialog` に `size="xl"`、`DropZone` に `isFill` を足す。メディアの画面は `media/route.tsx`(レイアウト)が `MediaLibrary` を描き、`media/index.tsx` と `media/$assetId.tsx` は URL を定めるだけ。データは同期の asset レコード + 未使用一覧 API(常時)+ 公開状態の一括取得(`type=asset`)+ 使用箇所 API(詳細と削除の確認)。代替テキストとキャプションは同期経路(`collection.update`)で保存し、削除は HTTP(`deleteRecord`)で行う。選択ダイアログ `MediaPickerDialog` は一覧と同じ `TileGrid` / 絞り込み / アップロードを共用し、編集画面の `AssetRelationPicker` とリッチテキストの画像挿入から開く。確認は `ConfirmDialog`、結果は `toaster`、見た目はセマンティックトークンと `@plyrs/ui` の部品だけ。

**Tech Stack:** StyleX 0.19.1、react-aria-components 1.21.1(`GridList layout="grid"` / `DropZone` / `FileTrigger` / `Dialog`。`Link` と `components/shell/` 以外は ui の部品経由)、TanStack Router 1.170.18(`validateSearch`、レイアウトルート)、TanStack Query 5、`uuid`(UUIDv7 の時刻部)、lucide-react、Vitest + jsdom + Testing Library、Playwright

**Spec:**
- `docs/admin-ux/f-media-library.md`(2 章 現状の制約、3 章 画面構成(3.1〜3.3)、4 章 詳細パネル(4.1・4.2)、5 章 選択ダイアログ、6 章 汎用の編集画面との関係、7 章 表示性能、8 章 権限、10 章 決定ログ。9 章 未決は範囲外)
- `docs/admin-ux/h-common-surface.md`(2 章 骨格、3 章 部品、4 章 文言、6 章 状態、7 章 権限、8 章 確認の使い分け、10 章 画面幅、11 章 アクセシビリティ、12 章 アイコン)
- `docs/admin-ux/h-design-tokens.md`(3 章 セマンティックトークン)
- `docs/admin-ux/d-content-list.md` 8 章(URL のクエリ)・9 章(公開状態の一括取得)
- `docs/superpowers/plans/2026-10-17-admin-ux-rebuild-roadmap.md` 5 章 V4
- `docs/superpowers/plans/2026-10-20-admin-ux-v4e-content-types.md`(`SidePanel` / `ModalDialog.size` / `Button variant="card"` の契約、裁定 E2・E21・E23・E29・E30)
- `docs/admin-ux/design-briefs/03-remaining-screens.md` 3 章「確認する状態」の「メディア」(0 件、ドロップ中、アップロード中(一部失敗、20 MB 超え)、未使用で絞り込み、使用中のファイルの削除確認、閲覧者)、「選択ダイアログ」(1 件だけ / 複数、ダイアログ内でアップロードした直後)、「共通」(ダーク、狭い画面)
- キャンバス https://claude.ai/artifact/K57TVUfpefMuiPxhZXyAnU のページ「D3 残りの画面」の M1〜M10・C2。フレームは `project/D3-Media.dc.html`(M1 グリッド)、`D3-Media-Detail.dc.html`(M2 詳細パネル)、`D3-Media-List.dc.html`(M3 リスト)、`D3-Media-Empty.dc.html`(M4 0 件)、`D3-Media-Drop.dc.html`(M5 ドロップ中)、`D3-Media-Uploading.dc.html`(M6 アップロード中)、`D3-Media-Orphans-Delete.dc.html`(M7 未使用 + 削除確認)、`D3-Media-Viewer.dc.html`(M8 閲覧者)、`D3-MediaPicker.dc.html`(M9 複数)、`D3-MediaPicker-Single.dc.html`(M10 1 件)、`D3-Media-Narrow.dc.html`(C2 狭い画面)。設計書と食い違うときは設計書を優先する(食い違いは「裁定台帳」に記し、Task 1 で設計書に書き戻し、最後に報告する)

## Global Constraints

- 画面と部品が参照するのはセマンティックトークン(`@plyrs/ui/semantic.stylex`)だけ。`grep -rln "tokens.stylex" apps/admin/src/components apps/admin/src/routes/t` は 0 件のまま(V4-E で達成済み)
- キャンバスの寸法は尺度に寄せる(V1〜V4-E と同じ対応表): 文字 13px→14px(`font.body`)、12px→`font.caption`、11px→`font.caption`、15px→16px(`font.label`)、16px→`font.label`、18px→`font.label`、20px→`font.sectionTitle`、24px→`font.pageTitle`。余白 10px→12px(`space.inset`)、6px→8px(`space.sm`)、4px→`space.xs`、16px→`space.md`、20px→24px(`space.lg`)、32px→`space.xl`。部品固有の寸法は数値で書き、コメントで根拠(f-media-library.md の章 / D3 M1〜M10・C2)を添える: グリッドのタイル 160px・間隔 12px(`space.inset`、F 3.1)、選択ダイアログのタイル 140px・間隔 10px→`space.inset`(F 5 章)、タイルの角丸 `radius.control`、選択中のタイルの枠 `focus.ring` 2px 外側、リストのサムネイル 40px、選択中欄のサムネイル 56px、詳細パネル 360px・プレビュー高さ 200px(F 4 章)、狭い画面のシートの高さ 520px(C2)、選択ダイアログ 1040×720(F 5 章)、右の「選択中」欄 300px、ドロップ中の枠 3px→`stroke.focus`(2px)の点線 + `accent.surface` の暗幕(不透明度 0.92)、空状態のアイコン 32px(`ICON_SIZE.empty`)、ファイルのアイコン 28px→`ICON_SIZE.empty`(32px)、仮タイルのバーは `ProgressBar` の高さ、完了・アップロード完了の印は `Badge tone="success"`、リストの行 52px→`size.row`(44px)
- 幅 960px 未満の切り替えは CSS のメディアクエリ `"@media (max-width: 959px)"` だけで行う(各ファイルに `const NARROW`。JS の `matchMedia` は使わない)。グリッドは `repeat(auto-fill, minmax(120px, 1fr))` でタイルが伸びる(`aspectRatio: 1`)、絞り込みの行は折り返す、リストは種類・サイズ・アップロードの列を隠す(`hideOnNarrow`)、詳細パネルは下から出るシート(`SidePanel narrowLayout="sheet"`)、パネルを開いている間の本文の右余白 360px は 0、選択ダイアログは幅 100%・「選択中」欄をグリッドの下に回す(F33)
- 画面上の呼称と文言は `lib/labels.ts` に置く(画面・部品に日本語を直書きしない。例外: テストの断言)。呼称は「メディア」「ファイル」(「アセット」は出さない。F 冒頭)。内部の型名(`asset`、`content_type`、`r2_key`)を画面に出さない。ファイル名・公開 URL・種類(MIME)は等幅(`font.familyMono`)。文体は「です・ます」、ボタンは操作名(H 4.2)。確認ダイアログのボタンは「OK」にしない
- エラーは `lib/error-messages.ts` の `errorMessage(cause, fallback)` で利用者向けの文にする(`too_large` / `invalid_filename` / `empty_body` は既にある)。操作の失敗はトースト(エラー色)、取得の失敗(未使用一覧・公開状態・使用箇所)は該当の枠内に文と「再試行」(`isLoadingError`。V4-E Task 6 の裁定と同じ)
- 見出しは 1 画面に `h1` が 1 つ(「メディア」)。詳細パネルの題と選択ダイアログの題は RAC の `Heading slot="title"`(部品の中)
- アイコンは `lucide-react`、ボタン・バッジの中は `ICON_SIZE.inline`、装飾は `aria-hidden`。使うアイコン(H 12 章): upload(ファイルを追加・ドロップの案内)/ image(空状態・種類「画像」)/ file-text(PDF)/ film(動画)/ music(音声)/ file(その他)/ layout-grid(グリッド表示)/ list(リスト表示)/ copy(公開 URL)/ trash-2(削除)/ x(閉じる・取り除く)/ check(完了)/ rotate-cw(再試行)/ circle-alert(失敗)/ chevron-right(使用箇所)/ triangle-alert(注記)
- 権限の出し分けは `useCan()` だけ(ロールの直書き禁止): アップロード・代替テキストとキャプションの編集は `record:write`、チェックボックス・一括操作・「ファイルを削除」は `record:delete`。viewer は見出しの `meta` に「閲覧のみ」(F 8 章、M8)
- 確認は `ConfirmDialog tone="danger"`(初期フォーカスはキャンセル、H 8 章)。保存・アップロードは確認なし。削除の成功はトースト(`TOASTS.deleted`)、失敗は `errorMessage(cause, TOASTS.deleteFailed)`
- RAC の部品を admin から直接使う例外は `Link`(表・一覧・パネルの中のリンク。R23・B10・G28・E6・F14)と `components/shell/` だけ。`GridList` / `DropZone` / `FileTrigger` / `Dialog` は ui の中に閉じる
- `@ts-expect-error` は使わない。素の `git stash` は使わない。コメント・ドキュメント・コミットメッセージは日本語。コミットは各タスクの最後に 1 つ(`/commit` スキルの規約。帰属行は付けない。タイトルは 50 文字以内)。git は 1 回の呼び出しに 1 コマンド
- サンドボックスの道具: `pnpm` は `corepack pnpm`。ルートの `pnpm typecheck` / `pnpm test` は使わず `corepack pnpm -r typecheck`、パッケージごとの vitest(admin は `src/lib src/components` / ルート群 / 残りのトップレベル の 3 組に分けて回す)。`corepack pnpm format:check` の「No config found, using defaults」は正常な警告。`routeTree.gen.ts` の再生成は `corepack pnpm --filter @plyrs/admin build`(prerender がネットワークで失敗しても gen は更新される)。**本計画は `media/route.tsx` と `media/$assetId.tsx` を足すので Task 7 で再生成が要る**
- `docs/` と `.design-sync/` は oxfmt の対象外。それ以外は各タスクの最後に `corepack pnpm format` をかけ、コントローラがタスクごとに `corepack pnpm format:check` を確かめる
- テストの割り振り(V4-E の注意): ダイアログ・パネル・Select・タイルは部品単位(`components/media/*.test.tsx` の直接描画。1 つの `it` でモーダルを 2 回開かない)。router 経由でモーダル(削除の確認、選択ダイアログ)を開くテストは **1 ファイル 1 本**(`media-delete.test.tsx`、`media-bulk-delete.test.tsx`、`media-picker-field.test.tsx`、`media-picker-body.test.tsx`)。モーダルを開く操作は `fireEvent.click`。Select を使う router テストは `vi.mock` で素の `<select>` に(`media-filter-select.tsx` を 1 ファイルに分け、`test-utils/media-filter-select-mock.tsx` で差し替える)。トーストは `within(screen.getByRole("region", { name: "通知" }))`。`SidePanel` は非モーダルなので router テストで何度開いてもよい。RAC の Modal を開いた後に同じファイルで `autoFocus` 付きの画面を描かない。`useRecordsOfTypes` の key は `useSyncTypes` に届いた型に絞る(welcome 前に固定 key を渡すと 0 件のまま固まる)
- ドロップのテスト: ui の `FileDropTarget` は `fireEvent.dragEnter` / `drop`(`dataTransfer.items` を模す)で `onFiles` と暗幕の表示を断言する。jsdom で RAC の `DropZone` が `onDrop` を発火しなければ実装者は報告し、コントローラが Ruling(`collectDroppedFiles` と `FileButton` 経由の単体テストに切り替え、実機と E2E で確認)を台帳に書く
- ロードマップ 5 章の注記どおり preview で実機確認する(Task 11)。push とコミットはユーザーに確認してから
- design-sync の再同期(V2・V3・V4-B・V4-G・V4-E・V4-F 分)は Task 12 で 1 回。実行はユーザーが `/design-sync` スキルで行う(サンドボックス外)
- サブエージェントへのディスパッチ文には、作業ツリーのパスを `cd` 付きで強制すること、`git log --oneline -2` の実出力を貼らせること、テストの実出力を貼らせること、`@ts-expect-error` 禁止と素の `git stash` 禁止、git は 1 回 1 コマンド、サブエージェントを spawn しないこと、報告ファイルを必ず書くこと、サンドボックスの placeholder のドットファイル(`.bashrc` `.zshrc` `.gitconfig` `.mcp.json` `.claude/*` など 0 バイト)を add / 削除しないことを含める(`.superpowers/sdd/<計画名>/dispatch-rules.md` に 1 度書いて毎回参照させる)

## 裁定台帳(2026-10-21)

計画を書く時点で決めたこと。F1〜F4 はユーザー裁定。Task 1 で設計書に書き戻し、最終報告で一覧にする。番号は本文から参照する。

| #   | 項目                                                   | 裁定                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | 詳細パネルの部品(F 4 章、M2・C2)                       | V4-E の `SidePanel` に `width?: number`(既定 420)と `narrowLayout?: "full" \| "sheet"`(既定 full。sheet は下から出る高さ 520px の面、上端につまみの飾り)を足し、メディアは `width={360} narrowLayout="sheet"`。型設計のパネルはそのまま。非モーダル・Esc・フォーカス復帰を共用する。ユーザー裁定                                                                                                                                                                                                      |
| F2  | 表示の切り替えの記憶(F 3.1)                            | `localStorage` のキー `plyrs.media.view`、値 `grid` \| `list`、既定 `grid`、サイト共通。`lib/theme.ts` と同じ様式(読み書きを try/catch で包み、`storage` を注入できる)。URL には載せない。ユーザー裁定                                                                                                                                                                                                                                                                                              |
| F3  | E21(読む側の `listColumns` / 型の `description`)       | 後続に送る。最終報告で明記。ユーザー裁定                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| F4  | E2E                                                    | `apps/e2e/tests/media.spec.ts` を 1 本足す(core-journey に依存。アップロード → 詳細で代替テキストを保存 → 編集画面の選択ダイアログで挿入 → 削除)。ユーザー裁定                                                                                                                                                                                                                                                                                                                                       |
| F5  | ルート構成(F 4 章の URL)                               | `routes/t/$tenantSlug/media/route.tsx`(レイアウト。`validateSearch` と `MediaLibrary` の描画。`Route.useParams({ strict: false })` で `assetId` を読む)、`media/index.tsx`(`/media/`。component 無し)、`media/$assetId.tsx`(`/media/:assetId`。component 無し)。パネルの開閉は `navigate` で URL を変え、絞り込みの search は保つ。旧 `media/index.tsx` の中身は捨てる                                                                                                                            |
| F6  | URL のクエリ(F 3.2、案 D 8 章)                         | `kind`(image \| pdf \| video \| audio \| other)、`usage`(unused)、`q`(文字列)、`sort`(name。既定の新しい順は省く)。`parseMediaQuery` / `toMediaSearch`(既定値は省く。`content-list.ts` の `parseListQuery` / `toListSearch` と同じ規則)。ページ送りは無い(同期データを全件描く。遅延読み込みで賄う、F 7 章)                                                                                                                                                                                  |
| F7  | 使用状況の出所(F 3.1・3.2、M1・M3・M7)                 | 未使用一覧 API(`orphanAssetsQueryOptions`、staleTime 0)を画面を開いている間は常に取得する(グリッドの「未使用」バッジとリストの使用状況の列に要るため。現行の「ON のときだけ」をやめる)。アップロード完了・削除の後に invalidate。リストの使用状況は「使用中」(success)/「未使用」(warning)の 2 値で件数は出さない(件数は 1 件ずつの API でしか取れず、詳細パネルで出す。M3 の「2 件で使用」との食い違い)。取得失敗はバッジと列を「—」にし、絞り込み行に文と「再試行」。他の人の参照の付け外しはフォーカス復帰時の再取得で補う |
| F8  | 公開状態(F 4 章、案 D 9 章)                            | `publicationsQueryOptions(adminApi, tenantId, "asset")` を詳細パネルを開いたときに取得し、`recordId` が含まれれば公開中。公開 URL は `publicAssetUrl(origin, slug, assetId)`(`lib/public-api.ts` に足す。`${publicApiBase}assets/${assetId}`)、origin は `configQueryOptions(api)` の `publicApiOrigin` を `resolvePublicOrigin` で解決。削除後は `publicationsQueryKey` を invalidate                                                                                                                 |
| F9  | ファイルごとの進捗(F 3.3、M6)                          | `fetch` では送信の進捗が取れないため、送信中のファイルは不確定の表示(`Spinner` + 「送信しています…」)とし、M6 の「64%」とバイト数は出さない。全体の進捗は件数(「2 / 5 件が完了」)で `ProgressBar`。XHR 化は後続の候補                                                                                                                                                                                                                                                                              |
| F10 | 仮タイルの状態(F 3.3、M6)                              | `lib/use-uploads.ts` の `useUploads()` が `uploadFiles` を包み、`UploadItem` に `key`(クライアント生成)を付けた `UploadEntry` の配列と、全体の `{ done, total, failed }` を持つ。完了(`done`)は 3 秒(`DONE_HOLD_MS`)残してから消す(その間は実レコードのタイルを重複して出さない: `done` の `assetId` を持つレコードは隠す)。失敗は「再試行」(その 1 件だけ `uploadFiles([file])` を再実行)、送る前に弾いた失敗(`too_large` など)は理由と「取り除く」。「残りを中止」は `AbortController`。画面を離れても `uploadFiles` は続く(ルートの unmount で中止しない) |
| F11 | 削除(F 4.1、M7)                                        | HTTP `adminApi.deleteRecord`(現行のまま。一覧からの消滅はトゥームストーンの同期で反映)。一括は `useBulkAction().run("delete", ids, id => deleteRecord)`。一括操作のバーは案 D の `BulkBar`(メニュー付き)ではなく、メディア用の `MediaBulkBar`(「削除」「N 件すべてを選択」「選択を解除」、実行中は進捗と「残りを中止」)を同じ見た目で作る。一括削除の「使われている件数」= 選択のうち未使用一覧に無いもの(F7)。成功は `TOASTS.deleted` / `bulkResultMessage`、失敗分は `failure` + 再試行 |
| F12 | 削除後の後始末                                         | 未使用一覧と公開状態(`publicationsQueryKey`)を invalidate、選択から外す。詳細パネルで開いていたファイルを消したら `/media`(search を保つ)へ navigate                                                                                                                                                                                                                                                                                                                                                 |
| F13 | 代替テキストとキャプションの保存(F 4 章)               | 同期経路: `sync.registry.get("asset")` の `collection.update(id, draft => { draft.input = { ...draft.input, alt, caption } })`(空は key を落とす。record-editor の `updateRecord` と同じ境界 cast)。「保存」は変更があるときだけ有効。成功は `TOASTS.saved`、失敗は `errorMessage(cause, TOASTS.saveFailed)`。viewer は `TextField isReadOnly`。`alt` / `caption` は任意のまま(スキーマどおり)                                                                                                       |
| F14 | 使用箇所(F 4 章)                                       | `assetUsageQueryOptions` → `resolveUsage(usage, types, recordById)`。`recordById` は `useRecordsOfTypes(registry, usage の sourceType のうち useSyncTypes に在る型)`。各行は RAC `Link`(`/t/:slug/content/:typeKey/:recordId`。例外に追加)で「タイトル」+ 下に「{型名} ・ {フィールドの表示名 or 本文中}」+ chevron-right。型が手元に無ければタイトルは ID 先頭 8 文字、リンクは出さない。取得前は `Skeleton`、失敗は文と「再試行」。差し替えの案内(F 4.2)を末尾に `font.caption`                         |
| F15 | 選択ダイアログ(F 5 章、M9・M10)                        | `components/media/media-picker-dialog.tsx` の `MediaPickerDialog`。`ModalDialog size="xl"`(幅 1040px・高さ 720px、`maxHeight: 100%`。E23 の `size` に `"xl"` を足す)。題「メディアを選択」+ `font.caption` の「「{フィールド名}」フィールド ・ 1 件だけ / 複数選べます」、右上 `FileButton`「アップロード」。左: 種類の `Select` + `SearchField` + `TileGrid size="sm"`、右: 幅 300px の「選択中」欄(`aria-label`「選択中のファイル」)。下部: 「ここにファイルをドロップしてもアップロードできます」+ キャンセル + 「{n} 件を挿入」/「このファイルを使う」(0 件は無効) |
| F16 | 空状態のドロップ領域(F 3.3、M4)                        | ui の `DropZone` に `isFill?: boolean`(flex 1、縦横中央)を足し、0 件(絞り込み無し)のときに本文全体へ広げる。題「メディアはまだありません」、説明(M4 の文)、ボタン「ファイルを選択」。viewer は `EmptyState`(ドロップ無し)。絞り込みで 0 件は `EmptyState`「条件に一致するファイルはありません」+「絞り込みを解除」                                                                                                                                                                             |
| F17 | タイルのグリッド部品(F 3.1、M1・M9・M10)               | ui に `TileGrid`(RAC `GridList layout="grid"`)を新設。`selectionMode` none / single / multiple。multiple は `selectionBehavior="toggle"` + 左上のチェックボックス(RAC `Checkbox slot="selection"` + `CheckboxBox`)。single は `selectionBehavior="replace"`(クリックで選ぶ)+ 左上の装飾のラジオ(`aria-hidden`。行の `aria-selected` が状態)。`onAction` があれば(一覧)クリックは詳細を開き、選択はチェックボックスだけ。右上のバッジは `renderBadge`(「未使用」/ 選択順の番号)。名前は `font.caption` の等幅で 1 行省略。矢印で 2 次元に移動、Space で選択、Enter で action |
| F18 | サムネイルの遅延読み込み(F 7 章)                       | admin の `components/media/media-thumb.tsx` の `MediaThumb`(`asset-thumb.tsx` を置き換え)。`IntersectionObserver`(rootMargin 200px)で画面に入ってから `resolveUrl`(`createAssetServices` のキャッシュをそのまま使う)。`IntersectionObserver` が無い環境(jsdom)は即時。画像以外は種類のアイコン + 拡張子のタグ。サイズは prop(160 / 140 / 56 / 40、プレビューは幅 100% 高さ 200px)                                                                                                            |
| F19 | 種類の判定と表示名(F 3.2)                              | `mediaKindOf(contentType)`: `image/*` → image、`application/pdf` → pdf、`video/*` → video、`audio/*` → audio、他 → other。表示名: 画像 / PDF / 動画 / 音声 / その他。リストの「種類」列はこの表示名(MIME は詳細パネルだけ)                                                                                                                                                                                                                                                                      |
| F20 | リスト表示(F 3.1、M3)                                  | ui `Table`。列: サムネイル(40px、見出し無し)/ ファイル名(`isRowHeader`、RAC `Link` で詳細へ。下に代替テキスト、無ければ `text.muted` で「代替テキストなし」)/ 種類 / サイズ / アップロード(`RelativeTime`)/ 使用状況(`Badge`)。種類・サイズ・アップロードは `hideOnNarrow`。選択列は `record:delete` のときだけ。並べ替えは列見出しではなく絞り込み行の「並び順」で行う(列見出しの並べ替えは出さない)。行の高さは `size.row`                                                                 |
| F21 | 絞り込みの行(F 3.2、M1)                                | 左から: `Select` 種類(`isLabelHidden`、候補「すべての種類 / 画像 / PDF / 動画 / 音声 / その他」)、`Select` 使用状況(「使用中と未使用 / 未使用のみ」)、`Select` 並び順(「新しい順 / ファイル名順」)、`SearchField`(「ファイル名・代替テキストで検索」、最大幅 320px)、右端に件数「{n} 件」(未使用で絞り込み中は「{n} 件 ・ どのコンテンツからも使われていないファイル」)と `SegmentedControl`(グリッド / リスト。文字付き)。絞り込みか検索があれば「絞り込みを解除」(`Button variant="link"`)。M1 のアイコンだけの pill との食い違いは文字付きを優先(a11y) |
| F22 | 検索(F 3.2)                                            | ファイル名と代替テキストの部分一致、大文字小文字を無視(`toLocaleLowerCase`)。`q` の正規化は `content-list.ts` の `searchText` と同じ                                                                                                                                                                                                                                                                                                                                                             |
| F23 | 並び順の鍵(F 3.2)                                      | 「新しい順」はアップロード日時の降順。アップロード日時は asset の ID(サーバー生成の UUIDv7)の時刻部から得る(`uploadedAtOf(id)`。`updatedAt` は代替テキストの保存で動くため使わない)。「ファイル名順」は `localeCompare(…, "ja")` の昇順。リストの「アップロード」列と詳細の「アップロード」も同じ値                                                                                                                                                                                              |
| F24 | 権限(F 8 章、M8)                                       | Global Constraints の権限の行のとおり。viewer は「ファイルを追加」とドロップ(`FileDropTarget isDisabled`)・常時のドロップ案内・チェックボックス・一括操作・「ファイルを削除」を出さず、代替テキストとキャプションは読み取り専用、公開 URL のコピーと使用箇所のリンクは使える                                                                                                                                                                                                               |
| F25 | 文言                                                   | `MEDIA_LABELS`(一覧・詳細・削除・アップロード)と `MEDIA_PICKER_LABELS`(選択ダイアログ)を `labels.ts` に新設し、`ASSET_PICKER_LABELS` を消す。既存の `TOASTS.saved` / `deleted` / `saveFailed` / `deleteFailed`、`DIALOGS.cancel`、`CLIPBOARD_LABELS`、`LIST_LABELS.readOnly` / `retry` / `noResults.clear`、`BULK_LABELS.selected` / `clear` / `cancel` / `progress` はそのまま使う                                                                                                                                                     |
| F26 | asset 型の汎用の編集画面(F 6 章、案 C 10 章)           | `lib/legacy-redirect.ts` の `legacyPathname` を拡張: 旧セクションの置き換えの後、`/t/:slug/content/asset` と `/content/asset/new` → `/t/:slug/media`、`/content/asset/:id` → `/t/:slug/media/:id`(旧 `/records/asset/:id` も同じ結果)。`lib/publish-box.ts` の `isAsset` / `kind: "asset"` と `components/publish-box.tsx` の分岐、`record-editor.tsx` の `isAsset` 渡し、両テストの asset の `it` を消す。`record-form.tsx` の `locked`(システム管理フィールドの防御、Phase 8)は残す |
| F27 | サイドバー                                             | asset 型は `sidebarContentTypes`(`source === "user"`)で既に出ない。Task 7 の router テストで断言するだけ                                                                                                                                                                                                                                                                                                                                                                                              |
| F28 | パネルと本文の重なり(M2 は本文と見出しの右 360px を空ける) | パネルを開いている間、見出しと本文を包む `div` に `paddingInlineEnd: 360px`(NARROW は 0)。E29 と同じ                                                                                                                                                                                                                                                                                                                                                                                        |
| F29 | パネルの閉じ方とフォーカス                             | 閉じるボタン・Esc・別のタイルのクリックは `navigate`。閉じたときは `SidePanel.returnFocusTo` で開いたタイル(`onAction` 時の `document.activeElement` を ref に控える)へ戻す。パネルが開いたままグリッドの別のタイルを押すと中身が切り替わる(URL が変わる)                                                                                                                                                                                                                                      |
| F30 | ダイアログ内のアップロード(F 5 章、M10)                | 同じ `useUploads`。`done` になったファイルを選択に加え(複数は末尾、1 件は置き換え)、「アップロード完了」の印を 3 秒出し、右の「選択中」欄の代替テキストの入力欄にフォーカスを移す。同期の change が届く前は `UploadEntry` の `done` を仮の項目(ファイル名・`file.size`・「たった今アップロード」)として描き、レコードが届いたら差し替える(選択は id で保つ)                                                                                                                                 |
| F31 | 挿入と代替テキストの書き込み(F 5 章)                   | `onSelect(items: PickedMedia[])`、`PickedMedia = { id, label(ファイル名), alt }`。挿入時に、ダイアログで変えた代替テキストを asset レコードへ同期経路で保存してから `onSelect`(失敗はトースト、挿入は続ける)。`AssetRelationPicker` の複数は未選択の id を末尾に足し、1 件は置き換える。リッチテキストの画像挿入は 1 件(`insert` が 1 回分のため)                                                                                                                                               |
| F32 | ダイアログの絞り込みの既定                             | `defaultKind` prop: リッチテキストの画像挿入は `image`、「画像・ファイル」フィールドは `all`。並び順は新しい順固定、使用状況の絞り込みは出さない。検索は一覧と同じ                                                                                                                                                                                                                                                                                                                              |
| F33 | 狭い画面(C2、依頼書「共通」)                           | Global Constraints の NARROW の行のとおり。見出しの主操作は「ファイルを追加」のまま(C2 の「追加」にはしない)                                                                                                                                                                                                                                                                                                                                                                                      |
| F34 | 一覧のデータの取り方                                   | `useRecordsOfTypes(sync.registry, useSyncTypes に "asset" が在れば ["asset"] else [])`。`deletedAt === null` だけ。同期前(`useSyncHasSynced` false)は `PageLoading`                                                                                                                                                                                                                                                                                                                                 |
| F35 | 画面全体のドロップ(F 3.3、M5)                          | ui に `FileDropTarget`(RAC `DropZone` を入れ物にし、`isDropTarget` の間だけ暗幕 + 点線枠 + 「ここに置くとアップロードします」+ 「{n} ファイル ・ 1 ファイル 20 MB まで」を重ねる。件数は native の `dragenter` の `dataTransfer.items.length`)を新設。メディアの本文(見出しの下)と選択ダイアログの本体を包む。`isDisabled`(viewer)なら素の入れ物。グリッドの最下部の常時の案内は `font.caption` の点線の帯(`MEDIA_LABELS.dropHint`)                                                       |
| F36 | ui の変更の記録                                        | 新規 `TileGrid` / `UploadTile` / `FileDropTarget` / `FileButton`、変更 `SidePanel`(`width` / `narrowLayout`)/ `ModalDialog`(`size="xl"`)/ `DropZone`(`isFill`)を `.design-sync/NOTES.md` の「V4 で変えた部品」に記録し、スタブ `.design-sync/docs/TileGrid.md`(Data)/ `UploadTile.md`(Feedback)/ `FileDropTarget.md`(Forms)/ `FileButton.md`(Forms)を足す                                                                                                                                      |
| F37 | 削除の確認の文言(F 4.1、M7)                            | 1 件: 題「{ファイル名} を削除しますか？」、本文「ファイルは元に戻せません。」、使われていれば `DialogNote tone="warning"`「**{n} 件のコンテンツで使われています**({タイトル}、…)。削除すると、そのコンテンツからこのファイルが表示されなくなります。公開中のページでも表示されなくなります」(タイトルは `resolveUsage` の重複を除いた先頭 3 件、残りは「ほか {m} 件」)。使用箇所の取得中は「使用箇所を確認しています…」、失敗は「使用箇所を確認できませんでした」(削除はできる)。実行「削除する」。一括: 題「{n} 件のファイルを削除しますか？」、注記「そのうち {m} 件はコンテンツで使われています。削除すると…」 |
| F38 | `settings/modules/index.tsx` の navKeys                | `useRecordsOfTypes` に渡す key を `useSyncTypes` に届いた型に絞る(V4-E Task 6 と同種)。Task 2 で直す                                                                                                                                                                                                                                                                                                                                                                                                |
| F39 | ファイル選択のボタン                                   | ui に `FileButton`(RAC `FileTrigger` + `Button`。`onFiles` / `allowsMultiple` / `acceptedFileTypes` / `variant` / `size` / `icon`)を新設。見出しの「ファイルを追加」と選択ダイアログの「アップロード」、M6 の再試行には使わない                                                                                                                                                                                                                                                            |
| F40 | 完了の印                                               | 一覧: 仮タイルの `done` を 3 秒「完了」(`Badge tone="success"` + check)で描いてから消す。ダイアログ: 実レコードのタイルの右上に「アップロード完了」を 3 秒(`renderBadge`)                                                                                                                                                                                                                                                                                                                    |

## Review Focus

1. **アップロード中に画面を離れる・パネルを開く**: 進行中の `uploadFiles` が続き、戻ると仮タイルと全体の進捗が残っていること(ルートの unmount で中止しない)。→ Task 5 の use-uploads.test「unmount しても進行中のアップロードは続き、再 mount で状態が残る」
2. **同期の change より先に一覧を描く(welcome 前)**: asset の key が `useSyncTypes` に無い間は購読せず、届いた後に件数と一覧が出ること。→ Task 7 の media-list.test「welcome 前は PageLoading で、同期が届くとグリッドが出る」
3. **未使用一覧の取得失敗**: グリッドとリストは描かれ、バッジと列は「—」、使用状況の絞り込み中なら枠内に文と再試行が出ること。→ Task 7 の media-list.test「未使用一覧の取得に失敗してもグリッドは出て、絞り込み中は再試行が出る」
4. **使われているファイルの削除**: 確認に件数とタイトルの注記が出て、削除後にパネルが閉じて一覧へ戻り、トーストが出ること。→ Task 8 の media-delete.test「使用中のファイルは警告つきの確認を経て削除し、パネルを閉じる」
5. **選択ダイアログで代替テキストを変えて挿入**: asset レコードへ `alt` が push され、フィールドに関係が入ること。→ Task 9 の media-picker-field.test「代替テキストを入れて挿入すると alt が push され、関係が入る」

---

## ファイル構成

`packages/ui/src/`:

| ファイル                                   | 責務                                                                                  |
| ------------------------------------------ | ------------------------------------------------------------------------------------- |
| `tile-grid.tsx`、`tile-grid.test.tsx`      | 新規。`TileGrid`(RAC GridList layout="grid" + 選択 + action。F17)                     |
| `upload-tile.tsx`、`upload-tile.test.tsx`  | 新規。`UploadTile`(送信中 / 順番待ち / 失敗 / 弾いた / 完了の仮タイル。F9・F10)        |
| `file-drop-target.tsx`、`file-drop-target.test.tsx` | 新規。`FileDropTarget`(画面全体のドロップと暗幕。F35)                        |
| `file-button.tsx`、`file-button.test.tsx`  | 新規。`FileButton`(FileTrigger + Button。F39)                                         |
| `side-panel.tsx`、`side-panel.test.tsx`    | 変更。`width` / `narrowLayout`(F1)                                                    |
| `dialog.tsx`、`dialog.test.tsx`            | 変更。`ModalDialog.size="xl"`(F15)                                                    |
| `drop-zone.tsx`、`drop-zone.test.tsx`      | 変更。`isFill`(F16)                                                                   |
| `index.ts`                                 | 変更。export                                                                          |

`apps/admin/`:

| ファイル                                                      | 責務                                                                                       |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `src/routes/t/$tenantSlug/settings/modules/index.tsx`         | 変更。navKeys の購読を届いた型に絞る(F38)                                                  |
| `src/lib/labels.ts`                                           | 変更。`MEDIA_LABELS` / `MEDIA_PICKER_LABELS`、`ASSET_PICKER_LABELS` の削除(F25)            |
| `src/lib/media-list.ts`、`media-list.test.ts`                 | 新規。URL クエリ、種類、アップロード日時、一覧の行、絞り込み・並び順、表示の記憶、確認の文言 |
| `src/lib/use-uploads.ts`、`use-uploads.test.tsx`              | 新規。アップロードの進行(F10)                                                              |
| `src/lib/public-api.ts`、`public-api.test.ts`                 | 変更。`publicAssetUrl`(F8)                                                                 |
| `src/lib/legacy-redirect.ts`、`legacy-redirect.test.ts`       | 変更。asset の編集画面の転送(F26)                                                          |
| `src/lib/publish-box.ts`、`publish-box.test.ts`               | 変更。`isAsset` / `kind: "asset"` の削除(F26)                                              |
| `src/components/publish-box.tsx`、`publish-box.test.tsx`、`record-editor.tsx` | 変更。asset の分岐の削除(F26)                                              |
| `src/components/media/media-thumb.tsx`、`media-thumb.test.tsx` | 新規。遅延読み込みのサムネイル(F18)。`asset-thumb.tsx` は削除                            |
| `src/components/media/media-filter-select.tsx`                | 新規。絞り込みの `Select`(テストで差し替えるため 1 ファイル)                               |
| `src/components/media/media-toolbar.tsx`、`media-toolbar.test.tsx` | 新規。絞り込みの行(F21)                                                               |
| `src/components/media/media-grid.tsx`、`media-grid.test.tsx`  | 新規。`TileGrid` + `MediaThumb` + 仮タイル + 常時のドロップ案内                            |
| `src/components/media/media-table.tsx`、`media-table.test.tsx` | 新規。リスト表示(F20)                                                                     |
| `src/components/media/media-bulk-bar.tsx`、`media-bulk-bar.test.tsx` | 新規。一括操作のバー(F11)                                                           |
| `src/components/media/upload-progress-bar.tsx`                | 新規。全体の進捗と「残りを中止」(M6 の上のバー)                                            |
| `src/components/media/media-detail-panel.tsx`、`media-detail-panel.test.tsx` | 新規。詳細パネル(F 4 章)                                                    |
| `src/components/media/delete-media-dialog.tsx`、`delete-media-dialog.test.tsx` | 新規。削除の確認(1 件 / 一括。F37)                                        |
| `src/components/media/media-library.tsx`                      | 新規。一覧の画面全体(見出し・絞り込み・グリッド / リスト・アップロード・パネル・削除)      |
| `src/components/media/media-picker-dialog.tsx`、`media-picker-dialog.test.tsx` | 新規。選択ダイアログ(F15・F30〜F32)                                       |
| `src/components/asset-picker.tsx`                             | 書き換え。`AssetSelectDialog` を消し、`AssetRelationPicker` が `MediaPickerDialog` を使う  |
| `src/components/record-form.tsx`                              | 変更。本文の画像挿入が `MediaPickerDialog` を使う                                          |
| `src/routes/t/$tenantSlug/media/route.tsx`                    | 新規。レイアウト(validateSearch、`MediaLibrary`。F5)                                        |
| `src/routes/t/$tenantSlug/media/index.tsx`                    | 書き換え。component 無し                                                                   |
| `src/routes/t/$tenantSlug/media/$assetId.tsx`                 | 新規。component 無し                                                                       |
| `src/test-utils/media-filter-select-mock.tsx`                 | 新規。`vi.mock` 用の素の `<select>`                                                        |
| `src/test-utils/media-harness.ts`                             | 新規。asset レコードの作り方と media のルートの既定(`assetRecord` / `mediaRoutes`)          |
| `src/media-list.test.tsx`、`media-detail.test.tsx`、`media-upload.test.tsx`、`media-delete.test.tsx`、`media-bulk-delete.test.tsx`、`media-picker-field.test.tsx`、`media-picker-body.test.tsx`、`media-redirect.test.tsx` | 新規。router テスト |
| `src/asset-flow.test.tsx`                                     | 削除(上の router テストに置き換え)                                                         |

`apps/e2e/tests/media.spec.ts`(新規、F4)、`apps/e2e/playwright.config.ts`(project の追加)。`docs/admin-ux/f-media-library.md`、`h-common-surface.md`: 裁定の書き戻し。`.design-sync/NOTES.md`、`.design-sync/docs/*.md`: 部品の変更の記録。

## タスクの依存

Task 1(設計書)→ Task 2(modules の購読)→ Task 3(ui: `SidePanel` / `ModalDialog` / `DropZone` / `FileButton`)→ Task 4(ui: `TileGrid` / `UploadTile` / `FileDropTarget`)→ Task 5(文言・純関数・`useUploads`・転送・publish-box の整理)→ Task 6(部品: サムネイル・絞り込み・グリッド・リスト・バー)→ Task 7(ルートと `MediaLibrary`: 一覧・アップロード)→ Task 8(詳細パネルと削除)→ Task 9(選択ダイアログと編集画面の差し替え)→ Task 10(E2E)→ Task 11(検証・preview・報告)→ Task 12(design-sync の再同期)。Task 2〜4 は互いに独立。Task 6 は Task 4・5 に、Task 7 は Task 3〜6 に、Task 8 は Task 3・5・7 に、Task 9 は Task 3〜8 に依存する。

---

### Task 1: 設計書へ V4-F の裁定を書き戻す

**Files:**
- Modify: `docs/admin-ux/f-media-library.md`(3.1〜3.3・4・4.1・5・6・7・8・10 章)
- Modify: `docs/admin-ux/h-common-surface.md`(3 章、14 章)
- Add: `docs/superpowers/plans/2026-10-21-admin-ux-v4f-media.md`(本計画。実装ブランチの最初のコミットに含める)

- [ ] **Step 1: f-media-library.md に F1・F2・F5〜F13・F15〜F24・F26・F28〜F35・F37・F40 を書く**

各章に「(2026-10-21、V4-F)」付きで 1〜2 文ずつ足し、既存の文は消さない。3.1: F2(記憶のキー)、F7(未使用一覧を常時取得、リストは 2 値)、F17(`TileGrid`)、F20(リスト)、F21(絞り込みの行、文字付きの切り替え)、F23(並び順の鍵)。3.2: F6(クエリ名)、F19(種類の判定)、F22(検索)。3.3: F9(進捗は件数)、F10(仮タイルの状態と 3 秒)、F16(0 件のドロップ領域)、F35(`FileDropTarget`)、F39、F40。4 章: F1(`SidePanel` の prop)、F5(ルート構成)、F8(公開状態と URL)、F13(保存)、F14(使用箇所)、F28、F29。4.1: F11(HTTP 削除、`MediaBulkBar`、使用中の件数の出所)、F12、F37(文言)。5 章: F15、F30、F31、F32。6 章: F26(転送の規則、publish-box の整理)、F27。7 章: F18。8 章: F24。10 章 決定ログ: 「2026-10-21: V4-F の計画で F1〜F40 を決めた(docs/superpowers/plans/2026-10-21-admin-ux-v4f-media.md)。E21 は後続(F3)、E2E に media.spec を足す(F4)」

- [ ] **Step 2: h-common-surface.md を直す**

3 章の V4-E の行の下に「V4-F(2026-10-21): タイルのグリッド `TileGrid`(RAC GridList layout="grid")、アップロードの仮タイル `UploadTile`、画面全体のドロップ `FileDropTarget`、ファイル選択の `FileButton` を足した(F17・F10・F35・F39)。`SidePanel` に `width` / `narrowLayout`(F1)、`ModalDialog` に `size="xl"`(F15)、`DropZone` に `isFill`(F16)。詳細パネルの使用箇所のリンクも RAC の `Link` を admin から直接使う(F14)」。14 章 決定ログに同じ内容を 1 行。

- [ ] **Step 3: コミット**

```bash
git add docs/admin-ux docs/superpowers/plans/2026-10-21-admin-ux-v4f-media.md
```

```bash
git commit -m "docs: V4-F(メディア)の計画と裁定を案 F・案 H の設計書に書き戻す"
```

---

### Task 2: 設定 › モジュールの件数の購読を届いた型に絞る(F38)

**Files:**
- Modify: `apps/admin/src/routes/t/$tenantSlug/settings/modules/index.tsx:36-37`
- Modify: `apps/admin/src/settings-modules.test.tsx`(無ければ既存の modules の router テストに足す。`grep -rl "settings/modules" apps/admin/src/*.test.tsx` で探す)

**Interfaces:**
- Consumes: `useSyncTypes`、`useRecordsOfTypes`
- Produces: 変更なし。内部: `const navKeys = list.filter((m) => m.enabled).flatMap((m) => m.navTypes).filter((key) => types.some((type) => type.key === key))`

- [ ] **Step 1: 失敗するテストを書く**

```ts
it("モジュール一覧が同期より先に届いても、同期後に無効化の確認に件数が出る", async () => {
  // /v1/t/t1/modules が enabled の booking(navTypes ["booking.slot"])を返す。描画 → モジュールの応答を待つ → bootstrapped(socket, [booking.slot 2 件], [bookingSlotType])
  // → fireEvent.click「無効にする」→ alertdialog に「予約枠 2 件」(MODULE_LABELS.count)が出る(修正前は 0 件のまま)
});
```

- [ ] **Step 2: テストが失敗することを確かめる**

Run: `corepack pnpm --filter @plyrs/admin exec vitest run <そのテストファイル>`
Expected: FAIL(件数が 0 件 / 文が keepUnknown)

- [ ] **Step 3: 実装する**

- [ ] **Step 4: テストが通ることを確かめる**

Run: `corepack pnpm --filter @plyrs/admin exec vitest run <そのテストファイル> src/components/settings && corepack pnpm -r typecheck && corepack pnpm format && corepack pnpm lint`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add apps/admin/src
```

```bash
git commit -m "fix(admin): モジュールの件数の購読を同期に届いた型に絞る"
```

---

### Task 3: ui の `SidePanel.width` / `narrowLayout`、`ModalDialog.size="xl"`、`DropZone.isFill`、`FileButton`

**Files:**
- Modify: `packages/ui/src/side-panel.tsx`、`side-panel.test.tsx`、`dialog.tsx`、`dialog.test.tsx`、`drop-zone.tsx`、`drop-zone.test.tsx`、`index.ts`
- Create: `packages/ui/src/file-button.tsx`、`file-button.test.tsx`
- Modify: `.design-sync/NOTES.md`、Create: `.design-sync/docs/FileButton.md`(category: Forms)

**Interfaces:**
- Produces:

```ts
// side-panel.tsx(F1。D3 M2・C2)
export interface SidePanelProps {
  …既存…;
  /** 幅 px。既定 420(E 5.2)。メディアの詳細は 360(F 4 章) */
  width?: number;
  /** 狭い画面(959px 以下)の形。full = 全面のシート(既定、E2)、sheet = 下から出る高さ 520px の面(C2) */
  narrowLayout?: "full" | "sheet";
}
// 幅は stylex の dynamic style(styles.width(px))。sheet: NARROW で top auto、insetInline 0、height 520px、maxHeight 100%、
// borderTop + 上の角丸 radius.container、上端に 36×4px の `border.hover` の飾り(aria-hidden)。zIndex は同じ

// dialog.tsx(F15)
size?: "md" | "lg" | "xl";   // xl: 幅 1040px・高さ 720px(maxHeight 100%、maxWidth 100%)、dialog は flex column で children が flex 1 / minHeight 0

// drop-zone.tsx(F16)
isFill?: boolean;            // true: flex 1、minHeight 0、justifyContent center(本文全体に広げる)。アイコンは 64px の bg.surface の円に入れる(M4)

// file-button.tsx(F39)
export interface FileButtonProps {
  onFiles: (files: File[]) => void;
  allowsMultiple?: boolean;         // 既定 true
  acceptedFileTypes?: string[];     // DropZone と同じ規則(acceptsFile で絞る)
  variant?: ButtonVariant; size?: ButtonSize; icon?: LucideIcon;
  isDisabled?: boolean;
  children: ReactNode;              // ボタンの文言
}
export function FileButton(props: FileButtonProps): JSX.Element;
// RAC FileTrigger(allowsMultiple、acceptedFileTypes)の中に Button。onSelect(list) → Array.from(list).filter(acceptsFile) → 1 件以上なら onFiles。
// 同じファイルを続けて選べるよう、onSelect のあとに input の value を空にする(FileTrigger は内部の input を持つ: ref ではなく、onSelect で event.target をたどれないため、
// FileTrigger を key で作り直す(選ぶたびに key を +1))
```

- [ ] **Step 1: 失敗するテストを書く**

```ts
// side-panel.test.tsx に足す
it("width と narrowLayout=sheet は別のクラスで描かれる", () => {
  // width 360 → dialog の親の style に width: 360px(dynamic style は inline の CSS 変数 or style)。narrowLayout sheet → className が full と異なる(dialog.test の size=lg と同じ断言法)
});
// dialog.test.tsx に足す
it("size=xl は lg とも md とも違う幅のクラスを持つ", () => {});
// drop-zone.test.tsx に足す
it("isFill は外枠に別のクラスを足し、ボタンと文言は同じ", () => {});
// file-button.test.tsx
it("ファイルを選ぶと onFiles に File の配列を渡し、同じファイルを続けて選べる", async () => {
  // userEvent.upload(input[type=file], [a, b]) → onFiles([a, b])。もう一度同じ a → onFiles([a])(2 回目も呼ばれる)
});
it("acceptedFileTypes に合わないファイルは渡さない", async () => {});
it("isDisabled のときボタンは無効", () => {});
```

- [ ] **Step 2: テストが失敗することを確かめる**

Run: `corepack pnpm --filter @plyrs/ui exec vitest run src/side-panel.test.tsx src/dialog.test.tsx src/drop-zone.test.tsx src/file-button.test.tsx`
Expected: FAIL(prop・部品が無い)

- [ ] **Step 3: 実装する**

- [ ] **Step 4: テストが通ることを確かめる**

Run: `corepack pnpm --filter @plyrs/ui exec vitest run && corepack pnpm -r typecheck && corepack pnpm format && corepack pnpm lint`
Expected: PASS(RAC のテストが 5 秒でタイムアウトしたら単独で再実行)

- [ ] **Step 5: `.design-sync/NOTES.md` の「V4 で変えた部品」に `SidePanel`(`width` / `narrowLayout`)・`ModalDialog`(`size="xl"`)・`DropZone`(`isFill`)・`FileButton`(新規)を足し、`FileButton.md` のスタブを足してコミット**

```bash
git add packages/ui/src .design-sync
```

```bash
git commit -m "feat(ui): SidePanel の幅とシート、ModalDialog の xl、DropZone の isFill、FileButton"
```

---

### Task 4: ui の `TileGrid`・`UploadTile`・`FileDropTarget`

**Files:**
- Create: `packages/ui/src/tile-grid.tsx`、`tile-grid.test.tsx`、`upload-tile.tsx`、`upload-tile.test.tsx`、`file-drop-target.tsx`、`file-drop-target.test.tsx`
- Modify: `packages/ui/src/index.ts`、`.design-sync/NOTES.md`、Create: `.design-sync/docs/TileGrid.md`(Data)、`UploadTile.md`(Feedback)、`FileDropTarget.md`(Forms)

**Interfaces:**
- Consumes: `drop-zone.tsx` の `collectDroppedFiles` / `acceptsFile`(export 済み)、`checkbox.tsx` の `CheckboxBox`、`ProgressBar` / `Spinner` / `Badge` / `Button` / `IconButton`
- Produces:

```ts
// tile-grid.tsx(F17。D3 M1・M9・M10・C2)
export interface TileItem { id: string; textValue: string }
export interface TileGridProps<T extends TileItem> {
  label: string;                                   // GridList の aria-label
  items: readonly T[];
  renderThumb: (item: T) => ReactNode;             // 正方形の中身(画像 / アイコン + 拡張子)。幅・高さは TileGrid が決める
  renderBadge?: (item: T) => ReactNode;            // 右上(「未使用」/ 選択順の番号)。undefined なら無し
  selectionMode?: "none" | "single" | "multiple";  // 既定 none
  selectedKeys?: ReadonlySet<string>;
  onSelectionChange?: (keys: Set<string>) => void; // "all" は items 全部に展開
  onAction?: (id: string) => void;                 // タイルを押す(Enter / クリック)。multiple ではチェックボックス以外の領域
  disabledKeys?: ReadonlySet<string>;              // 一括削除の実行中
  size?: "md" | "sm";                              // md = 160px / 間隔 space.inset(一覧)、sm = 140px / 間隔 space.inset(ダイアログ)
  leading?: ReactNode;                             // グリッドの先頭に差し込む仮タイル(UploadTile の列。GridList の外、同じ grid に並べる: 入れ物は CSS grid で、leading を先に描き GridList を display: contents にする)
}
export function TileGrid<T extends TileItem>(props: TileGridProps<T>): JSX.Element;
// 入れ物: display grid、gridTemplateColumns { default: repeat(auto-fill, <size>px), [NARROW]: repeat(auto-fill, minmax(120px, 1fr)) }、gap space.inset。
// RAC GridList(layout="grid"、selectionMode、selectionBehavior = multiple ? "toggle" : "replace"、className display: contents)。
// GridListItem(textValue、className: flex column gap space.xs、outline none、position relative)。
//   サムネイルの枠: width 100%、aspectRatio 1、radius.control、stroke.default border.default、bg.surface、overflow hidden、
//   isSelected → outline stroke.focus solid focus.ring、outlineOffset stroke.focus(M1 の .sel)。isFocusVisible も同じ輪(選択と区別しない)。isDisabled → opacity 0.5。
//   左上(top/left space.sm): multiple → RAC Checkbox slot="selection"(aria-label = `${textValue} を選択`)+ CheckboxBox(bg.canvas の地)。single → aria-hidden の円(18px、border.hover、選択中は accent.default の 5px 枠)。
//   右上: renderBadge。下: 名前(font.caption、font.familyMono、text.muted、1 行省略、title 属性に全文)。
// キーボード: GridList の既定(矢印で 2 次元、Space で選択、Enter で onAction)

// upload-tile.tsx(F9・F10。D3 M6・M10)
export type UploadTileState =
  | { kind: "queued" }
  | { kind: "uploading" }
  | { kind: "failed"; message: string; onRetry: () => void }
  | { kind: "rejected"; message: string; detail?: string; onRemove: () => void }   // 送る前に弾いた(20 MB 超えなど)。detail は「24.8 MB」
  | { kind: "done" };
export interface UploadTileProps { name: string; state: UploadTileState; size?: "md" | "sm"; thumb?: ReactNode }  // thumb は done のときの画像(無ければ bg.surface)
export function UploadTile(props: UploadTileProps): JSX.Element;
// TileGrid のタイルと同じ寸法・角丸・名前。中身(縦中央、gap space.sm、padding space.inset、font.caption、text.muted):
//   queued → 「順番待ち」/ uploading → Spinner(label「送信しています…」)+ 文字、枠は accent.default /
//   failed → 枠 status.danger、地 status.dangerSurface、CircleAlert + message + Button variant="dangerLink" size="sm" icon RotateCw「再試行」/
//   rejected → 同じ色、message(weightMedium)+ detail + Button dangerLink「取り除く」/
//   done → 右下に Badge tone="success" icon Check「完了」(thumb の上に重ねる)。
// role="group" aria-label = name、状態の文字は aria-live="polite" の span に(failed / rejected は role="alert")

// file-drop-target.tsx(F35。D3 M5)
export interface FileDropTargetProps {
  onFiles: (files: File[]) => void;
  isDisabled?: boolean;        // true: ドロップを受けず暗幕も出さない(素の入れ物)
  hint: string;                // 暗幕の 2 行目の固定部分(「1 ファイル 20 MB まで」)。件数は部品が前に付ける(`${n} ファイル ・ ${hint}`)
  children: ReactNode;
}
export function FileDropTarget(props: FileDropTargetProps): JSX.Element;
// RAC DropZone(className: position relative、display flex、flexDirection column、flex 1、minHeight 0、outline none。getDropOperation → "copy"、onDrop → collectDroppedFiles(items, undefined, true) → onFiles)。
// 入れ物の onDragEnterCapture で event.dataTransfer?.items.length を state に控え、onDragLeave / onDrop で null に戻す。
// isDropTarget のとき children の上に重ねる(position absolute、inset space.inset、radius.container、border stroke.focus dashed accent.default、
// 地 accent.surface に opacity 0.92(color-mix は使わず、重ねる div に opacity)、pointerEvents none、role="status"): 題(font.sectionTitle weightBold accent.default)「ここに置くとアップロードします」+ font.caption「{n} ファイル ・ {hint}」(n が null なら hint だけ)。
// isDisabled のときは RAC DropZone を使わず同じ className の div を描く
```

- [ ] **Step 1: 失敗するテストを書く**

```ts
// tile-grid.test.tsx
it("タイルを grid の row として描き、名前と renderThumb / renderBadge の中身を出す", () => { /* role=grid(name label)、row 3 件、row の中に img / バッジの文字 */ });
it("multiple は各タイルにチェックボックスを出し、チェックで onSelectionChange、タイルのクリックで onAction", async () => {
  // checkbox「a.png を選択」click → onSelectionChange(new Set(["a"]))、タイルの名前を click → onAction("a") が呼ばれ selection は変わらない
});
it("single はチェックボックスを出さず、クリックで 1 件だけ選ぶ(置き換え)", async () => { /* queryByRole("checkbox") が無い。a → b と click → onSelectionChange の最後が Set(["b"]) */ });
it("disabledKeys のタイルは aria-disabled", () => {});
it("leading はグリッドの先頭に描かれる", () => { /* leading の要素が最初の row より DOM 上で前(compareDocumentPosition) */ });
// upload-tile.test.tsx
it("5 つの状態を描き、再試行と取り除くがコールバックを呼ぶ", async () => {});
// file-drop-target.test.tsx
it("ドラッグが入ると暗幕と件数が出て、ドロップで onFiles に File を渡す", async () => {
  // fireEvent.dragEnter(target, { dataTransfer: { items: [{kind:"file", type:"image/png", getAsFile }], types: ["Files"] } }) → status「ここに置くとアップロードします」「1 ファイル ・ 1 ファイル 20 MB まで」
  // fireEvent.drop(…) → onFiles([file])。RAC の DropZone が jsdom で onDrop を発火しなければ Global Constraints の「ドロップのテスト」のとおり報告
});
it("isDisabled なら暗幕を出さず onFiles を呼ばない", () => {});
```

- [ ] **Step 2: テストが失敗することを確かめる**

Run: `corepack pnpm --filter @plyrs/ui exec vitest run src/tile-grid.test.tsx src/upload-tile.test.tsx src/file-drop-target.test.tsx`
Expected: FAIL(部品が無い)

- [ ] **Step 3: 実装する**

`react-aria-components` の `GridList` / `GridListItem` / `Checkbox` / `DropZone` を各ファイルの中だけで import する。

- [ ] **Step 4: テストが通ることを確かめる**

Run: `corepack pnpm --filter @plyrs/ui exec vitest run && corepack pnpm -r typecheck && corepack pnpm format && corepack pnpm lint`
Expected: PASS

- [ ] **Step 5: NOTES.md とスタブ 3 本を足してコミット**

```bash
git add packages/ui/src .design-sync
```

```bash
git commit -m "feat(ui): タイルのグリッド、アップロードの仮タイル、画面全体のドロップを足す"
```

---

### Task 5: 文言・純関数・`useUploads`・転送・publish-box の整理

**Files:**
- Modify: `apps/admin/src/lib/labels.ts`、`labels.test.ts`
- Create: `apps/admin/src/lib/media-list.ts`、`media-list.test.ts`、`apps/admin/src/lib/use-uploads.ts`、`use-uploads.test.tsx`
- Modify: `apps/admin/src/lib/public-api.ts`、`public-api.test.ts`、`legacy-redirect.ts`、`legacy-redirect.test.ts`
- Modify: `apps/admin/src/lib/publish-box.ts`、`publish-box.test.ts`、`apps/admin/src/components/publish-box.tsx`、`publish-box.test.tsx`、`record-editor.tsx`

**Interfaces:**
- Consumes: `lib/media.ts` の `uploadFiles` / `UploadItem` / `UploadSummary` / `uploadRejection` / `UPLOAD_TOO_LARGE_MESSAGE` / `resolveUsage` / `ResolvedUsage` / `countUsingRecords`、`SyncRecord`、`uuid`(`v7` は使わない。時刻部は id の先頭 12 hex を `parseInt(…, 16)`)、`formatDateTime`
- Produces:

```ts
// labels.ts(F25)
export const MEDIA_LABELS = {
  add: "ファイルを追加", select: "ファイルを選択", readOnly: LIST_LABELS.readOnly,
  kinds: { all: "すべての種類", image: "画像", pdf: "PDF", video: "動画", audio: "音声", other: "その他" } satisfies Record<MediaKind | "all", string>,
  kindLabel: "種類", usageLabel: "使用状況", usage: { all: "使用中と未使用", unused: "未使用のみ" }, sortLabel: "並び順", sorts: { newest: "新しい順", name: "ファイル名順" },
  search: "ファイル名・代替テキストで検索", count: (n: number) => `${n} 件`, unusedCount: (n: number) => `${n} 件 ・ どのコンテンツからも使われていないファイル`,
  clearFilters: LIST_LABELS.noResults.clear, viewLabel: "表示の切り替え", views: { grid: "グリッド", list: "リスト" },
  unused: "未使用", inUse: "使用中", usageUnknown: "—", noAlt: "代替テキストなし", usageFailed: "使用状況を取得できませんでした", retry: LIST_LABELS.retry,
  tableLabel: "メディアの一覧", gridLabel: "メディアの一覧", columns: { name: "ファイル名", kind: "種類", size: "サイズ", uploaded: "アップロード", usage: "使用状況" },
  selectOf: (name: string) => `${name} を選択`, remove: "外す",
  dropHint: "画面のどこにでもファイルをドロップしてアップロードできます(1 ファイル 20 MB まで)", dropLimit: "1 ファイル 20 MB まで",
  empty: { title: "メディアはまだありません", description: "画像・PDF・動画をここにドロップするか、「ファイルを追加」から選んでください。アップロードしたファイルは、本文やアイキャッチから選べるようになります。1 ファイル 20 MB まで。",
    viewerDescription: "アップロードされたファイルがここに表示されます" },
  noResults: { title: "条件に一致するファイルはありません", description: "別の言葉で検索するか、絞り込みを解除してください" },
  upload: { queued: "順番待ち", uploading: "送信しています…", done: "完了", retry: "再試行", remove: "取り除く", failed: "アップロードできませんでした",
    progressTitle: "アップロードしています…", progress: (done: number, total: number) => `${done} / ${total} 件が完了`, failedCount: (n: number) => `${n} 件は送れませんでした`,
    cancel: BULK_LABELS.cancel, rejectedToast: (name: string) => `${name} はアップロードできません` },
  detail: { label: (name: string) => `詳細: ${name}`, close: "閉じる", kind: "種類", size: "サイズ", dimensions: "大きさ", uploaded: "アップロード", dimensionsOf: (w: number, h: number) => `${w} × ${h}`,
    alt: "代替テキスト", altHelp: "画像の内容を短く説明します。読み上げソフトや画像が表示できないときに使われます", caption: "キャプション", captionPlaceholder: "画像の下に表示する文", captionHelp: "本文に挿入したとき、画像の下に出ます",
    unset: "(未設定)", save: "保存", publication: "公開", published: "公開中", publishedNote: "使っているコンテンツと一緒に公開済み", unpublished: "未公開",
    unpublishedNote: "このファイルを使っているコンテンツを公開すると、一緒に公開されます", publicUrl: "公開 URL", copy: "コピー", publicationFailed: "公開状態を取得できませんでした",
    usage: "使用箇所", usageCount: (n: number) => `${n} 件`, usageEmpty: "まだ使われていません", usageFailed: "使用箇所を取得できませんでした", separator: " ・ ",
    replaceHint: "差し替えたいときは、新しいファイルをアップロードして、上の各コンテンツで選び直してください", delete: "ファイルを削除", notFound: "ファイルが見つかりません。削除された可能性があります" },
  deleteDialog: { title: (name: string) => `${name} を削除しますか？`, body: "ファイルは元に戻せません。", checking: "使用箇所を確認しています…", checkFailed: "使用箇所を確認できませんでした",
    inUse: (n: number) => `${n} 件のコンテンツで使われています`, inUseTitles: (titles: string, rest: number) => rest === 0 ? `(${titles})` : `(${titles}、ほか ${rest} 件)`,
    consequence: "。削除すると、そのコンテンツからこのファイルが表示されなくなります。公開中のページでも表示されなくなります", confirm: DIALOGS.delete.confirm,
    bulkTitle: (n: number) => `${n} 件のファイルを削除しますか？`, bulkInUse: (m: number) => `そのうち ${m} 件はコンテンツで使われています` },
  bulk: { region: BULK_LABELS.region, delete: "削除", selectAll: (n: number) => `${n} 件すべてを選択`, clear: BULK_LABELS.clear, running: "削除しています…", retry: BULK_LABELS.retry.delete },
} as const;
export const MEDIA_PICKER_LABELS = {
  title: "メディアを選択", fieldNote: (field: string, many: boolean) => `「${field}」フィールド ・ ${many ? "複数選べます" : "1 件だけ"}`, bodyField: "本文", upload: "アップロード", close: "閉じる",
  gridLabel: "ファイル", selected: "選択中", selectedRegion: "選択中のファイル", selectedCount: (n: number) => `${n} 件`, none: "左の一覧からファイルを選んでください",
  alt: "代替テキスト", altHelp: "挿入する前に入れておくと、本文でもそのまま使われます", altPlaceholder: "画像の内容を短く", justUploaded: "たった今アップロード", uploaded: "アップロード完了",
  dropHint: "ここにファイルをドロップしてもアップロードできます", cancel: DIALOGS.cancel, insert: (n: number) => `${n} 件を挿入`, useOne: "このファイルを使う", separator: " ・ ",
} as const;
// ASSET_PICKER_LABELS は削除

// lib/media-list.ts
export type MediaKind = "image" | "pdf" | "video" | "audio" | "other";
export const MEDIA_KINDS: readonly MediaKind[];                      // image, pdf, video, audio, other
export function mediaKindOf(contentType: string): MediaKind;        // F19
export type MediaSort = "newest" | "name";
export interface MediaQuery { kind: MediaKind | "all"; usage: "all" | "unused"; q: string; sort: MediaSort }
export const DEFAULT_MEDIA_QUERY: MediaQuery;                        // all / all / "" / newest
export function parseMediaQuery(search: Record<string, unknown>): MediaQuery;   // F6。不正な値は既定
export function toMediaSearch(query: Partial<MediaQuery>): Record<string, string>; // 既定値は省く(kind / usage / q / sort)
export function hasMediaFilters(query: MediaQuery): boolean;         // 既定と違えば true
export function uploadedAtOf(id: string): Date | null;               // F23。UUIDv7 の先頭 48 bit(ハイフンを除いた先頭 12 hex)。形が違えば null
export interface MediaRow {
  record: SyncRecord; id: string; filename: string; contentType: string; kind: MediaKind; size: number; width: number | null; height: number | null;
  alt: string; caption: string; uploadedAt: Date | null; extension: string;   // extension は asset-thumb.tsx の extensionOf(最大 4 文字、無ければ "?")と同じ
}
export function buildMediaRows(records: readonly SyncRecord[]): MediaRow[];     // deletedAt === null だけ。input の型が合わない値は既定("" / 0 / null)
export function applyMediaQuery(rows: readonly MediaRow[], query: MediaQuery, orphanIds: ReadonlySet<string> | null): MediaRow[];
// kind / usage(orphanIds が null なら usage は無視)/ q(F22)で絞り、sort(F23。uploadedAt null は末尾、同点は id 降順)で並べる
export function formatBytes(size: number): string;                   // 現行 formatSize と同じ(B / KB / MB、小数 1 桁)
export type MediaView = "grid" | "list";
export const MEDIA_VIEW_STORAGE_KEY = "plyrs.media.view";            // F2
export function readMediaView(storage?: Storage): MediaView;         // theme.ts と同じ様式(try/catch、既定 grid)
export function saveMediaView(view: MediaView, storage?: Storage): void;
export function usageTitles(usage: readonly ResolvedUsage[]): { titles: string; rest: number };  // F37。recordId で重複を除き先頭 3 件を「、」で結ぶ
export function inUseCount(ids: readonly string[], orphanIds: ReadonlySet<string>): number;      // F11。orphanIds に無い件数

// lib/use-uploads.ts(F10)
export interface UploadEntry { key: string; item: UploadItem }
export interface UploadsSnapshot {
  entries: readonly UploadEntry[];                 // 表示順(done は DONE_HOLD_MS 後に消える。rejected / failed は操作するまで残る)
  progress: { done: number; total: number; failed: number } | null;   // 進行中(queued か uploading が 1 件以上)のときだけ
  doneIds: ReadonlySet<string>;                    // 表示中の done の assetId(一覧で実レコードを隠す)
}
export interface UploadStoreOptions { onSettled?: (summary: UploadSummary) => void; onDone?: (assetId: string, file: File) => void }
export interface UploadStore {
  getSnapshot: () => UploadsSnapshot;              // useSyncExternalStore 用(同じ内容なら同じ参照)
  subscribe: (listener: () => void) => () => void;
  start: (files: readonly File[]) => Promise<UploadSummary>;          // 既存の進行に追加(別の uploadFiles 呼び出し。entries は連結)
  retry: (key: string) => void;                    // failed の 1 件を start([file]) し直し、元の entry を置き換える
  remove: (key: string) => void;                   // rejected / failed を消す
  cancel: () => void;                              // 残りを中止(AbortController)。進行中の 1 件は待つ
  setOptions: (options: UploadStoreOptions) => void;   // 画面が付け替える(トーストと invalidate は画面の責務)
}
export const DONE_HOLD_MS = 3000;
export function createUploadStore(upload: (file: File) => Promise<{ id: string }>, options?: UploadStoreOptions): UploadStore;
// 画面(React)の外に進行を持つ: ルートが unmount されても uploadFiles は続き、戻ると同じ store を読む(Review Focus 1)。
// done は DONE_HOLD_MS の setTimeout で消す。onSettled は start ごとの uploadFiles の完了で呼ぶ
export function useUploads(store: UploadStore): UploadsSnapshot;   // useSyncExternalStore(store.subscribe, store.getSnapshot)
export function uploadStoreFor(tenantId: string, upload: (file: File) => Promise<{ id: string }>): UploadStore;   // module の Map<tenantId, UploadStore>。無ければ作る(MediaLibrary と MediaPickerDialog は別の store を持ってよい: picker は createUploadStore を useMemo で)

// lib/public-api.ts(F8)
export function publicAssetUrl(origin: string, slug: string, assetId: string): string;  // `${publicApiBase(origin, slug)}assets/${assetId}`

// lib/legacy-redirect.ts(F26)
export function legacyPathname(pathname: string): string | null;
// 既存の置き換えの後(置き換えが無くても)、`/t/:slug/content/asset` → `/t/:slug/media`、`/t/:slug/content/asset/new` → `/t/:slug/media`、`/t/:slug/content/asset/:id` → `/t/:slug/media/:id`。
// どちらにも当たらなければ null。旧 `/t/:slug/records/asset/:id` は置き換え → asset の規則の順で `/t/:slug/media/:id`

// lib/publish-box.ts / components/publish-box.tsx / record-editor.tsx(F26): PublishBoxInput.isAsset、PublishBoxState の { kind: "asset" }、showStatus の asset の注記、StateRow の early return、RecordEditor の isAsset 渡しを消す
```

- [ ] **Step 1: 失敗するテストを書く**

```ts
// media-list.test.ts
it("mediaKindOf は MIME の先頭で 5 種に分ける", () => { /* image/png → image、application/pdf → pdf、video/mp4 → video、audio/mpeg → audio、text/csv → other、"" → other */ });
it("parseMediaQuery は不正な値を既定に戻し、toMediaSearch は既定値を省く", () => {
  expect(parseMediaQuery({})).toStrictEqual(DEFAULT_MEDIA_QUERY);
  expect(parseMediaQuery({ kind: "gif", usage: "unused", q: 2026, sort: "name" })).toStrictEqual({ kind: "all", usage: "unused", q: "2026", sort: "name" });
  expect(toMediaSearch({ kind: "image", q: "" })).toStrictEqual({ kind: "image" });
});
it("uploadedAtOf は UUIDv7 の時刻部を返し、形が違えば null", () => { /* "018f2b6a-7a0a-7000-8000-000000000e01" → new Date(0x018f2b6a7a0a)。"abc" → null */ });
it("buildMediaRows は削除済みを除き、input の型が合わない値を既定にする", () => {});
it("applyMediaQuery は種類・未使用・検索(大文字小文字無視、alt も)で絞り、新しい順とファイル名順で並べる", () => {});
it("read / saveMediaView は localStorage の例外に耐え、既定は grid", () => {});
it("usageTitles は重複を除いて 3 件までと残りの件数、inUseCount は未使用に無い件数", () => {});
// use-uploads.test.tsx(renderHook)
it("start で entries が queued → uploading → done と進み、3 秒後に done が消える", async () => { /* store 単位。vi.useFakeTimers、upload は deferred。doneIds に assetId が入り、3 秒後に entries と doneIds から消える */ });
it("uploadStoreFor は同じ tenantId で同じ store を返す", () => {});
it("20 MB 超は rejected で残り、remove で消える。failed は retry で送り直す", async () => {});
it("cancel で残りが queued のまま止まり、progress が null になる", async () => {});
it("unmount しても進行中のアップロードは続き、再 mount で状態が残る", async () => { /* Review Focus 1。store = createUploadStore(deferred) → renderHook(() => useUploads(store)) → start([a]) → unmount → deferred を resolve → store.getSnapshot().entries[0].item.status === "done"、onDone が呼ばれる → 再 renderHook で同じ entries */ });
// public-api.test.ts
it("publicAssetUrl は /public/v1/:slug/assets/:id", () => {});
// legacy-redirect.test.ts
it("asset 型の編集画面と一覧はメディアへ転送し、旧 records も同じ", () => {
  expect(legacyPathname("/t/blog/content/asset/018f")).toBe("/t/blog/media/018f");
  expect(legacyPathname("/t/blog/content/asset")).toBe("/t/blog/media");
  expect(legacyPathname("/t/blog/content/asset/new")).toBe("/t/blog/media");
  expect(legacyPathname("/t/blog/records/asset/018f")).toBe("/t/blog/media/018f");
  expect(legacyPathname("/t/blog/content/article/018f")).toBeNull();
});
// labels.test.ts に足す
it("メディアの種類の文言が MEDIA_KINDS と all を網羅する", () => {});
// publish-box.test.ts / publish-box.test.tsx: asset の it を消す
```

- [ ] **Step 2: テストが失敗することを確かめる**

Run: `corepack pnpm --filter @plyrs/admin exec vitest run src/lib/media-list.test.ts src/lib/use-uploads.test.tsx src/lib/public-api.test.ts src/lib/legacy-redirect.test.ts src/lib/labels.test.ts`
Expected: FAIL(関数が無い)。`ASSET_PICKER_LABELS` を消すと `asset-picker.tsx` が typecheck で落ちる → **このタスクでは `asset-picker.tsx` の import を `MEDIA_PICKER_LABELS.title` に差し替えるだけにする**(Task 9 で書き換える)

- [ ] **Step 3: 実装する**

- [ ] **Step 4: テストが通ることを確かめる**

Run: `corepack pnpm --filter @plyrs/admin exec vitest run src/lib src/components && corepack pnpm -r typecheck && corepack pnpm format && corepack pnpm lint`
Expected: PASS。`grep -rn "isAsset\|kind: \"asset\"\|ASSET_PICKER_LABELS" apps/admin/src` が 0 件

- [ ] **Step 5: コミット**

```bash
git add apps/admin/src
```

```bash
git commit -m "feat(admin): メディアの文言・純関数・アップロードの進行と asset の転送を足す"
```

---

### Task 6: 部品(サムネイル・絞り込みの行・グリッド・リスト・一括操作のバー・全体の進捗)

**Files:**
- Create: `apps/admin/src/components/media/media-thumb.tsx`、`media-thumb.test.tsx`、`media-filter-select.tsx`、`media-toolbar.tsx`、`media-toolbar.test.tsx`、`media-grid.tsx`、`media-grid.test.tsx`、`media-table.tsx`、`media-table.test.tsx`、`media-bulk-bar.tsx`、`media-bulk-bar.test.tsx`、`upload-progress-bar.tsx`
- Create: `apps/admin/src/test-utils/media-filter-select-mock.tsx`
- Delete: `apps/admin/src/components/asset-thumb.tsx`(参照元 `asset-picker.tsx` / `media/index.tsx` は Task 7・9 で消えるため、このタスクでは `asset-picker.tsx` の import を `MediaThumb` に差し替える)

**Interfaces:**
- Consumes: Task 4 の `TileGrid` / `UploadTile`、Task 5 の `MediaRow` / `MediaQuery` / `MediaKind` / `MediaView` / `UploadEntry` / `formatBytes` / `MEDIA_LABELS`、`AssetServices.resolveUrl`、`Table` 系 / `Badge` / `Select` / `SearchField` / `SegmentedControl` / `Button` / `ProgressBar` / `Spinner` / `Skeleton`、RAC `Link`、`RelativeTime` + `formatDateTime`
- Produces:

```ts
// media-thumb.tsx(F18)
export interface MediaThumbProps {
  row: Pick<MediaRow, "id" | "kind" | "extension" | "alt" | "filename">;
  resolveUrl: (assetId: string) => Promise<string | null>;
  size: "tile" | "sm" | "xs" | "preview";    // tile = 幅 100%・aspectRatio 1(TileGrid の中)、sm = 56px、xs = 40px、preview = 幅 100%・高さ 200px(objectFit contain、地 bg.surface)
  eager?: boolean;                           // true: 画面に入るのを待たずに読む(パネルのプレビュー・選択中欄)
}
export function MediaThumb(props: MediaThumbProps): JSX.Element;
// kind image のときだけ読む。useVisible(ref): IntersectionObserver(rootMargin "200px")で一度 true になったら観測をやめる。window に IntersectionObserver が無ければ最初から true。
// URL が来るまで bg.surface の枠。来たら <img src alt={alt || filename} objectFit cover(preview は contain)>。
// 画像以外・解決できない: 種類のアイコン(Global Constraints の対応。ICON_SIZE.empty、ICON_STROKE.large、text.muted)+ 拡張子のタグ(font.caption weightBold familyMono、bg.canvas、stroke.default border.default、radius.small、padding 1px space.sm。xs / sm は拡張子だけ font.caption)
export function kindIcon(kind: MediaKind): LucideIcon;   // image → Image、pdf → FileText、video → Film、audio → Music、other → File

// media-filter-select.tsx(テストで差し替えるため 1 ファイル)
export function MediaFilterSelect(props: { label: string; items: { value: string; label: string }[]; selectedValue: string; onChange: (value: string) => void }): JSX.Element;
// Select(isLabelHidden、size md)。test-utils/media-filter-select-mock.tsx: 同じ props の素の <select aria-label={label}>

// media-toolbar.tsx(F21)
export interface MediaToolbarProps {
  query: MediaQuery; onQueryChange: (next: MediaQuery) => void;
  count: number;                                  // 絞り込み後の件数
  view: MediaView; onViewChange: (view: MediaView) => void;
  usageError: { onRetry: () => void } | null;     // 未使用一覧の取得失敗(F7)
}
export function MediaToolbar(props: MediaToolbarProps): JSX.Element;
// flex、gap space.sm、alignItems center、flexWrap wrap。MediaFilterSelect ×3(種類・使用状況・並び順)、SearchField(flex 1、maxWidth 320px)、spacer、
// 件数(font.caption text.muted。usage unused なら unusedCount)、hasMediaFilters なら Button variant="link" size="sm"「絞り込みを解除」、SegmentedControl(label viewLabel、items grid(LayoutGrid)/ list(List))。
// usageError: 件数の横に role="alert" の font.caption status.danger「使用状況を取得できませんでした」+ Button link sm「再試行」

// media-grid.tsx
export interface MediaGridProps {
  rows: readonly MediaRow[];
  resolveUrl: MediaThumbProps["resolveUrl"];
  orphanIds: ReadonlySet<string> | null;          // null = 取得前・失敗(バッジ無し)
  uploads: readonly UploadEntry[];                 // 先頭の仮タイル(leading。UploadsSnapshot.entries)
  onRetryUpload: (key: string) => void; onRemoveUpload: (key: string) => void;
  selection: { selectedKeys: ReadonlySet<string>; onSelectionChange: (keys: Set<string>) => void; isDisabled: boolean } | undefined;   // undefined = 選択なし(viewer)
  onOpen: (id: string) => void;                    // 詳細を開く(TileGrid.onAction)
  showDropHint: boolean;                           // 常時のドロップ案内(viewer は false)
}
export function MediaGrid(props: MediaGridProps): JSX.Element;
// TileGrid(label gridLabel、size md、items rows(textValue filename)、renderThumb → MediaThumb size tile、renderBadge → orphanIds?.has(id) ? Badge warning「未使用」: null、
// selectionMode selection ? multiple : none、onAction onOpen、disabledKeys = isDisabled ? 全 id : 空、leading = uploads.map(UploadTile …))。
// UploadTile の state は uploadTileState(entry, { onRetry, onRemove }): queued / uploading / done はそのまま、failed は reason "error" → failed(message = errorMessage(cause, MEDIA_LABELS.upload.failed))、
// reason too_large / empty / invalid_filename → rejected(message = ERROR_MESSAGES[reason === "empty" ? "empty_body" : reason]、detail = too_large なら formatBytes(file.size))。
// 下: showDropHint なら点線の帯(stroke.focus dashed border.default、radius.container、padding space.inset、font.caption text.muted、Upload アイコン + dropHint。marginTop auto)

// media-table.tsx(F20)
export interface MediaTableProps {
  tenantSlug: string; rows: readonly MediaRow[]; resolveUrl: MediaThumbProps["resolveUrl"]; orphanIds: ReadonlySet<string> | null;
  selection: MediaGridProps["selection"]; now?: Date;
}
export function MediaTable(props: MediaTableProps): JSX.Element;
// Table(aria-label tableLabel、selectionMode、selectionBehavior toggle、selectedKeys、onSelectionChange("all" → 全 id)、disabledKeys)。
// 列: thumb(見出しは VisuallyHidden「サムネイル」、幅 56px)/ name(isRowHeader。Link(`/t/${slug}/media/${id}`、font.familyMono、weightMedium)+ 下に font.caption text.muted の alt か noAlt)/
// kind(MEDIA_LABELS.kinds[kind]、hideOnNarrow)/ size(formatBytes、familyMono、hideOnNarrow)/ uploaded(RelativeTime(formatDateTime(uploadedAt))、uploadedAt null は「—」、hideOnNarrow)/
// usage(orphanIds null → usageUnknown、has → Badge warning「未使用」、else Badge success「使用中」)。並べ替えの列見出しは無し

// media-bulk-bar.tsx(F11。bulk-bar.tsx と同じ見た目)
export interface MediaBulkBarProps {
  selectedCount: number; totalCount: number;       // 「N 件すべてを選択」の N = 絞り込み後の件数
  onSelectAll: () => void; onClear: () => void; onDelete: () => void;
  progress: { done: number; total: number; onCancel: () => void } | null;
  failure: { onRetry: () => void } | null;
}
export function MediaBulkBar(props: MediaBulkBarProps): JSX.Element;
// region「一括操作」aria-busy。progress → Spinner + ProgressBar(isLabelHidden、valueLabel BULK_LABELS.progress)+「残りを中止」。
// それ以外 → 「{n} 件を選択中」(weightBold accent)+ Button secondary sm(Trash2、status.danger の文字)「削除」+ failure なら Button secondary sm(RotateCw)「削除をもう一度試す」+ 右に link sm「{N} 件すべてを選択」「選択を解除」

// upload-progress-bar.tsx(M6 の上のバー)
export function UploadProgressBar(props: { done: number; total: number; failed: number; onCancel: () => void }): JSX.Element;
// role="status" aria-live polite。accent.surface の地、stroke.default accent.default の枠、radius.container、padding space.sm space.inset(bulk-bar と同じ)。
// 「アップロードしています…」(weightBold accent)+ 「{done} / {total} 件が完了」+ failed > 0 なら「 ・ {failed} 件は送れませんでした」+ spacer + Button secondary sm「残りを中止」。ProgressBar(isLabelHidden)は文の下に細く
```

- [ ] **Step 1: 失敗するテストを書く**

```ts
// media-thumb.test.tsx
it("画像は IntersectionObserver が無ければ即 resolveUrl を呼び、img を描く", async () => {});
it("IntersectionObserver があれば画面に入るまで resolveUrl を呼ばない(eager なら呼ぶ)", async () => { /* window.IntersectionObserver を vi.fn で差し替え、observe のコールバックを手で呼ぶ */ });
it("画像以外は種類のアイコンと拡張子を出す", () => { /* PDF → 「PDF」、text/csv の "data.csv" → 「CSV」 */ });
// media-toolbar.test.tsx(vi.mock("./media-filter-select") で素の select)
it("種類・使用状況・並び順・検索を変えると onQueryChange に新しい query が渡る", async () => {});
it("絞り込みがあれば件数の横に「絞り込みを解除」、未使用なら件数の文が変わる", () => {});
it("表示の切り替えで onViewChange", async () => {});
// media-grid.test.tsx
it("行をタイルで描き、未使用にバッジ、タイルを押すと onOpen", async () => {});
it("仮タイルを先頭に描き、再試行と取り除くがコールバックを呼ぶ", async () => {});
it("selection が無ければチェックボックスとドロップ案内が無い", () => {});
// media-table.test.tsx
it("行にサムネイル・ファイル名のリンク・代替テキスト・種類・サイズ・日時・使用状況を出す", () => { /* link href が /t/blog/media/<id>、「代替テキストなし」、Badge「使用中」/「未使用」 */ });
it("orphanIds が null なら使用状況は —、selection が無ければ選択列が無い", () => {});
// media-bulk-bar.test.tsx
it("選択中の件数と削除・すべてを選択・解除、進行中は進捗と中止", async () => {});
```

- [ ] **Step 2: テストが失敗することを確かめる**

Run: `corepack pnpm --filter @plyrs/admin exec vitest run src/components/media`
Expected: FAIL(部品が無い)

- [ ] **Step 3: 実装する**

- [ ] **Step 4: テストが通ることを確かめる**

Run: `corepack pnpm --filter @plyrs/admin exec vitest run src/lib src/components && corepack pnpm -r typecheck && corepack pnpm format && corepack pnpm lint`
Expected: PASS。`apps/admin/src/components/asset-thumb.tsx` が無い

- [ ] **Step 5: コミット**

```bash
git add apps/admin/src
```

```bash
git commit -m "feat(admin): メディアのサムネイル・絞り込み・グリッド・リスト・一括バーの部品を足す"
```

---

### Task 7: ルートと `MediaLibrary`(一覧・絞り込み・アップロード・一括選択)

**Files:**
- Create: `apps/admin/src/routes/t/$tenantSlug/media/route.tsx`、`media/$assetId.tsx`
- Rewrite: `apps/admin/src/routes/t/$tenantSlug/media/index.tsx`(component 無し)
- Create: `apps/admin/src/components/media/media-library.tsx`
- Create: `apps/admin/src/test-utils/media-harness.ts`
- Create: `apps/admin/src/media-list.test.tsx`、`media-upload.test.tsx`、`media-redirect.test.tsx`
- Modify: `apps/admin/src/asset-flow.test.tsx`(一覧の 3 本を消す。編集画面の 2 本は残し、Task 9 で `media-picker-*.test.tsx` に置き換えてファイルごと消す)
- Regenerate: `apps/admin/src/routeTree.gen.ts`(`corepack pnpm --filter @plyrs/admin build`)

**Interfaces:**
- Consumes: Task 3 の `FileButton` / `DropZone isFill`、Task 4 の `FileDropTarget`、Task 5 の `media-list.ts` / `useUploads` / `MEDIA_LABELS`、Task 6 の部品、`TenantPageHeader` / `PageBody` / `PageLoading`、`homeCrumb` / `currentCrumb`、`useCan`、`useTenantSync` / `useSyncTypes` / `useSyncHasSynced` / `useRecordsOfTypes`、`createAssetServices`、`orphanAssetsQueryOptions`、`toaster`、`uploadSummaryMessage`、`EmptyState`
- Produces:

```ts
// routes/t/$tenantSlug/media/route.tsx(F5)
export const Route = createFileRoute("/t/$tenantSlug/media")({
  validateSearch: (search: Record<string, unknown>): Partial<MediaQuery> => parseMediaQuery(search),
  search: { middlewares: [({ search, next }) => toMediaSearch(next(search)) as Partial<MediaQuery>] },   // content/$typeKey/index.tsx と同じ形
  component: MediaRoute,
});
// MediaRoute: const { assetId } = Route.useParams({ strict: false }); <MediaLibrary tenantSlug tenant adminApi api queryClient assetId={assetId ?? null} query={parseMediaQuery(search)} onQueryChange … />
// media/index.tsx: createFileRoute("/t/$tenantSlug/media/")({})。media/$assetId.tsx: createFileRoute("/t/$tenantSlug/media/$assetId")({})

// components/media/media-library.tsx
export interface MediaLibraryProps { tenantSlug: string; assetId: string | null }   // 他は Route.useRouteContext() / useNavigate() で取る(ルートの薄い包み)
export function MediaLibrary(props: MediaLibraryProps): JSX.Element;
// 状態: query(URL)、view(useState(readMediaView) + saveMediaView)、selectedKeys(Set。query が変わったら空に)、uploadStore = uploadStoreFor(tenant.id, assets.upload)(useMemo)+ useEffect で setOptions({ onSettled: summary → toaster(uploadSummaryMessage。failed > 0 は error)+ orphans の invalidate })、uploads = useUploads(uploadStore)、
// deleteTarget(Task 8)、bulk(useBulkAction、Task 8)、panelReturnRef。
// データ: sync = useTenantSync()、types = useSyncTypes(sync)、hasSynced、records = useRecordsOfTypes(sync.registry, types.some(t => t.key === ASSET_TYPE_KEY) ? [ASSET_TYPE_KEY] : [])(F34)、
// rows = buildMediaRows(records).filter(row => !uploads.doneIds.has(row.id))、orphans = useQuery(orphanAssetsQueryOptions)(常時、F7)、orphanIds = orphans.data ? new Set : null、
// visible = applyMediaQuery(rows, query, orphanIds)、canWrite = useCan("record:write")、canDelete = useCan("record:delete")。
// hasSynced false → PageLoading。
// 描画(F28: 開いていれば paddingInlineEnd 360px の div で包む):
//   TenantPageHeader(title TERMS.media、breadcrumbs [home, current(メディア)]、meta: !canWrite ? readOnly : undefined、primaryAction: canWrite ? FileButton(primary、Upload、「ファイルを追加」、onFiles → uploadStore.start) : undefined)
//   FileDropTarget(isDisabled !canWrite、hint dropLimit、onFiles → uploadStore.start) の中に PageBody:
//     rows 0 件 && !hasMediaFilters && uploads.entries 0 件 → canWrite ? DropZone(isFill、title empty.title、description empty.description、buttonLabel select、allowsMultiple) : EmptyState(Image、empty.title、viewerDescription)
//     それ以外: MediaToolbar → uploads.progress ? UploadProgressBar : null → selectedKeys.size > 0 ? MediaBulkBar : null → (visible 0 件 && hasMediaFilters ? EmptyState(noResults、action「絞り込みを解除」) : view grid ? MediaGrid : MediaTable)
//   MediaDetailPanel(Task 8)、DeleteMediaDialog(Task 8)
// 絞り込みの変更: navigate({ to: ".", search: toMediaSearch(next), replace: true })(パネルの URL を保つ)。onOpen(id): panelReturnRef.current = document.activeElement; navigate({ to: "/t/$tenantSlug/media/$assetId", params, search: 現在の search })。
// 閉じる: navigate({ to: "/t/$tenantSlug/media", params, search })。
// 「N 件すべてを選択」= visible の id 全部。選択は visible に無い id を落とす(query が変わったら空)。
// test-utils/media-harness.ts: assetRecord(id, filename, overrides)(asset-flow.test の様式。content_type / size / width / height / alt を overrides で)、mediaRoutes(overrides)(authedRoutes + "/v1/t/t1/assets/orphans" → { orphanIds: [] })、ASSET_1 / ASSET_2 の定数
```

- [ ] **Step 1: 失敗するテストを書く**

```ts
// media-list.test.tsx(renderAt("/t/blog/media", …)、bootstrapped(socket, [asset…], [ASSET_TYPE_DEFINITION, articleType])。vi.mock("./components/media/media-filter-select"))
it("welcome 前は PageLoading で、同期が届くとグリッドが出る", async () => { /* Review Focus 2。bootstrapped の前に「読み込み中」、後に grid「メディアの一覧」の row 2 件 */ });
it("未使用のファイルにバッジが出て、「未使用のみ」で絞ると他が消え、件数の文が変わる", async () => { /* orphans が [ASSET_2] → row ASSET_2 に「未使用」。select 使用状況 → unused → row 1 件、「1 件 ・ どのコンテンツ…」、URL に ?usage=unused */ });
it("種類と検索で絞り、ファイル名順に並べ替え、URL に載る", async () => {});
it("未使用一覧の取得に失敗してもグリッドは出て、絞り込み中は再試行が出る", async () => { /* Review Focus 3。orphans が 500 → row は出る、バッジ無し、「使用状況を取得できませんでした」+ 再試行 → 2 回目は 200 で消える */ });
it("リスト表示に切り替えると表になり、localStorage に残る", async () => { /* radio「リスト」→ grid(name メディアの一覧)が table になる(role=grid は同じなので rowheader のリンクで断言)、localStorage.getItem("plyrs.media.view") === "list" */ });
it("閲覧者は追加・チェックボックス・ドロップ案内が無く、メタに閲覧のみ", async () => { /* mediaRoutes({}, "viewer") */ });
it("サイドバーに asset 型は出ない", async () => { /* complementary の中に link「アセット」が無い(F27) */ });
it("0 件のときは本文全体がドロップ領域で、絞り込みで 0 件なら絞り込みを解除が出る", async () => {});
// media-upload.test.tsx
it("ファイルを追加で 2 件を順に送り、仮タイルが進み、同期の change で実タイルに置き換わる", async () => {
  // /v1/t/t1/assets を deferred にして 1 件ずつ resolve。「ファイルを追加」の input に [a, b] → group「a.png」(送信しています…)、group「b.png」(順番待ち)、status「1 / 2 件が完了」…
  // 両方 resolve → 通知「2 件のファイルをアップロードしました」、change を deliver → row「a.png」「b.png」、仮タイルは 3 秒後に消える(fake timers)
});
it("20 MB 超は送らずに弾き、理由と取り除くを出す。失敗は再試行で送り直す", async () => { /* 2 件目を 500 → group「b.png」に「再試行」→ click → assets が 3 回目 */ });
// media-redirect.test.tsx
it("/content/asset/:id と /records/asset/:id はメディアの詳細へ転送される", async () => { /* renderAt("/t/blog/content/asset/<ASSET_1>") → pathname が /t/blog/media/<ASSET_1>。records も同じ */ });
```

- [ ] **Step 2: テストが失敗することを確かめる**

Run: `corepack pnpm --filter @plyrs/admin exec vitest run src/media-list.test.tsx src/media-upload.test.tsx src/media-redirect.test.tsx`
Expected: FAIL(ルートが旧の表)

- [ ] **Step 3: 実装する**

`route.tsx` / `$assetId.tsx` を足したら `corepack pnpm --filter @plyrs/admin build` で `routeTree.gen.ts` を再生成する(prerender の失敗は無視してよい)。`MediaDetailPanel` / `DeleteMediaDialog` は Task 8 で足すため、このタスクでは `assetId` を受けるだけで描かない。

- [ ] **Step 4: テストが通ることを確かめる**

Run: `corepack pnpm --filter @plyrs/admin exec vitest run src/media-list.test.tsx src/media-upload.test.tsx src/media-redirect.test.tsx src/asset-flow.test.tsx src/shell.test.tsx && corepack pnpm -r typecheck && corepack pnpm format && corepack pnpm lint`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add apps/admin/src
```

```bash
git commit -m "feat(admin): メディアの一覧をグリッド / リストと画面全体のドロップに作り直す"
```

---

### Task 8: 詳細パネルと削除(1 件 / 一括)

**Files:**
- Create: `apps/admin/src/components/media/media-detail-panel.tsx`、`media-detail-panel.test.tsx`、`delete-media-dialog.tsx`、`delete-media-dialog.test.tsx`
- Modify: `apps/admin/src/components/media/media-library.tsx`
- Create: `apps/admin/src/media-detail.test.tsx`、`media-delete.test.tsx`、`media-bulk-delete.test.tsx`

**Interfaces:**
- Consumes: Task 3 の `SidePanel width narrowLayout`、Task 5 の `publicAssetUrl` / `usageTitles` / `inUseCount` / `formatBytes` / `MEDIA_LABELS`、Task 6 の `MediaThumb` / `MediaBulkBar`、`lib/media.ts` の `resolveUsage` / `countUsingRecords`、`assetUsageQueryOptions` / `publicationsQueryOptions` / `publicationsQueryKey` / `configQueryOptions` / `orphanAssetsQueryOptions`、`resolvePublicOrigin`、`copyText`、`useBulkAction` / `bulkResultMessage`、`ConfirmDialog` / `DialogNote` / `TextField` / `Badge` / `Button` / `IconButton` / `Skeleton` / `toaster`、RAC `Link`、`formatDateTime`
- Produces:

```ts
// media-detail-panel.tsx(F 4 章、M2・M8・C2。F1・F8・F13・F14・F29)
export interface MediaDetailPanelProps {
  tenantSlug: string; tenantId: string;
  row: MediaRow | null;                      // null = 閉じる(isOpen false の SidePanel を返す。V4-E の最終 fix と同じ)
  isOpen: boolean;                           // assetId !== null
  notFound: boolean;                         // assetId があるのに row が無い(見つからない文だけを描く)
  resolveUrl: MediaThumbProps["resolveUrl"];
  usage: { status: "pending" } | { status: "error"; onRetry: () => void } | { status: "ready"; entries: readonly ResolvedUsage[] };   // useQuery と resolveUsage は MediaLibrary
  publication: { status: "pending" } | { status: "error"; onRetry: () => void } | { status: "ready"; published: boolean; url: string };   // url は publicAssetUrl 済み
  canWrite: boolean; canDelete: boolean;
  onSave: (input: { alt: string; caption: string }) => Promise<void>;   // 同期経路(MediaLibrary が collection.update)
  onDelete: () => void;                      // 確認は MediaLibrary
  onClose: () => void;
  returnFocusTo: RefObject<HTMLElement | null>;
}
export function MediaDetailPanel(props: MediaDetailPanelProps): JSX.Element;
// SidePanel(isOpen、width 360、narrowLayout "sheet"、title = row.filename(font.familyMono)、onClose、returnFocusTo)。
// 本文(上から): MediaThumb size preview eager(右下に Badge neutral の大きさ。画像以外はアイコン)/
//   dl(grid 88px 1fr、font.caption): 種類(MIME、familyMono)/ サイズ(formatBytes)/ 大きさ(width × height。無ければ出さない)/ アップロード(formatDateTime(uploadedAt).absolute) /
//   区切り / TextField 代替テキスト(description altHelp、isReadOnly !canWrite)+ TextField キャプション(placeholder、description captionHelp)+ 右寄せ Button primary sm「保存」(canWrite のときだけ。dirty でなければ isDisabled。保存中は isPending) /
//   区切り / h3 公開: publication pending は Skeleton、error は文 + 再試行、published なら Badge success dot「公開中」+ publishedNote + url(familyMono、1 行省略)+ Button secondary sm(Copy)「コピー」(copyText)、でなければ Badge neutral「未公開」+ unpublishedNote /
//   区切り / h3 使用箇所 + 件数: usage pending は Skeleton、error は文 + 再試行、entries の各行を Link(typeKey が null なら span)、0 件は usageEmpty、末尾に replaceHint /
// footer: canDelete なら Button dangerLink「ファイルを削除」。
// 入力の取り直しは row.id に結ぶ(useEffect [row?.id]。V4-E Task 8 の Important)。行が差し替わっても(同期の change)入力中の値は保つ

// delete-media-dialog.tsx(F37)
export type DeleteMediaTarget =
  | { kind: "one"; row: MediaRow; usage: { status: "pending" } | { status: "error" } | { status: "ready"; entries: ResolvedUsage[] } }
  | { kind: "many"; ids: string[]; inUse: number };
export function DeleteMediaDialog(props: { target: DeleteMediaTarget | null; onConfirm: () => void; onCancel: () => void; isPending: boolean }): JSX.Element;
// ConfirmDialog tone="danger"(isOpen target !== null、confirmLabel 削除する)。one: title(filename)、body、usage pending → checking、error → DialogNote warning checkFailed、
// ready で countUsingRecords > 0 → DialogNote warning(TriangleAlert)<strong>inUse(n)</strong> + inUseTitles(usageTitles) + consequence。many: bulkTitle(n)、body、inUse > 0 なら DialogNote warning bulkInUse(m) + consequence
```

`media-library.tsx` に足す: `const config = useQuery(configQueryOptions(api))`、`publicOrigin = resolvePublicOrigin(config.data?.publicApiOrigin ?? "", window.location.origin)`、`publications = useQuery({ ...publicationsQueryOptions(adminApi, tenant.id, "asset"), enabled: assetId !== null })`、`usage = useQuery({ ...assetUsageQueryOptions(adminApi, tenant.id, assetId ?? deleteTarget の id ?? ""), enabled: … })`。`usageTypeKeys`(usage の sourceType のうち types に在るもの)で `useRecordsOfTypes` → `recordById` → `resolveUsage`。`isLoadingError` を `error`、`isPending` を `pending` に写して `MediaDetailPanel` の `usage` / `publication` に渡す。保存: `collection = sync.registry.get(ASSET_TYPE_KEY)` → `collection.update(id, draft => …)`(F13)→ `toaster.success(TOASTS.saved)` / `toaster.error(errorMessage(cause, TOASTS.saveFailed))`。1 件の削除: `deleteTarget = { kind: "one", row, usage }`(usage は `assetUsageQueryOptions` を `enabled: deleteTarget !== null` で)→ 確認 → `adminApi.deleteRecord` → `TOASTS.deleted`、orphans / publications の invalidate、パネルで開いていたら閉じる(F12)。一括: `MediaBulkBar.onDelete` → `{ kind: "many", ids, inUse: inUseCount(ids, orphanIds ?? new Set()) }` → 確認 → `bulk.run("delete", ids, id => adminApi.deleteRecord(tenant.id, id))` → `bulkResultMessage("delete", result)` のトースト、invalidate、選択から成功分を外す。

- [ ] **Step 1: 失敗するテストを書く**

```ts
// media-detail-panel.test.tsx(直接描画。usage / publication は props なので fetch も Query も要らない)
it("情報・公開中の URL とコピー・使用箇所のリンクを出し、保存は変更があるときだけ有効", async () => { /* dialog(name = ファイル名)、「image/jpeg」「1.2 MB」「1920 × 1080」、Badge「公開中」、button「コピー」→ copyText、link「秋のキャンペーン」href /t/blog/content/news/<id>、「お知らせ ・ アイキャッチ」「本文中」。「保存」disabled → alt を変える → enabled → click → onSave({ alt, caption }) */ });
it("未公開は案内を出し、使用箇所 0 件は文、取得失敗は再試行", () => {});
it("閲覧者は入力が読み取り専用で保存と削除が無い", () => {});
it("row が差し替わっても入力中の値を保ち、id が変わると取り直す", () => {});
it("notFound は見つからない文だけ", () => {});
// delete-media-dialog.test.tsx
it("使用中の 1 件は件数とタイトルの注記、未使用は注記なし、確認中と失敗の文", () => {});
it("一括は件数と使用中の件数", () => {});
// media-detail.test.tsx(renderAt("/t/blog/media/<ASSET_1>")。モーダル無し)
it("URL で開いた詳細に情報と公開状態と使用箇所が出て、代替テキストを保存すると push され、閉じると /media に戻る", async () => {
  // publications?type=asset が [ASSET_1]、usage が [article/hero]。dialog「one.png」、「公開中」、link「はじめの記事」。alt を入力 → 保存 → pushes の input.alt、通知「保存しました」。「閉じる」→ pathname /t/blog/media
});
it("グリッドのタイルを押すとパネルが開き、別のタイルで中身が切り替わる", async () => {});
// media-delete.test.tsx(1 本)
it("使用中のファイルは警告つきの確認を経て削除し、パネルを閉じる", async () => { /* Review Focus 4。/media/<ASSET_1> → fireEvent.click「ファイルを削除」→ alertdialog に「1 件のコンテンツで使われています」「はじめの記事」→「削除する」→ DELETE、通知「削除しました」、pathname /t/blog/media、トゥームストーンで row が消える */ });
// media-bulk-delete.test.tsx(1 本)
it("2 件を選んで一括削除すると使用中の件数つきの確認を経て順に DELETE し、結果のトーストが出る", async () => { /* orphans [ASSET_2] → inUse 1 → 「そのうち 1 件は…」。2 件目を 500 → 「1 件を削除しました。1 件は削除できませんでした」、バーに再試行 */ });
```

- [ ] **Step 2: テストが失敗することを確かめる**

Run: `corepack pnpm --filter @plyrs/admin exec vitest run src/components/media/media-detail-panel.test.tsx src/components/media/delete-media-dialog.test.tsx src/media-detail.test.tsx src/media-delete.test.tsx src/media-bulk-delete.test.tsx`
Expected: FAIL(部品が無い)

- [ ] **Step 3: 実装する**

- [ ] **Step 4: テストが通ることを確かめる**

Run: `corepack pnpm --filter @plyrs/admin exec vitest run src/components/media src/media-list.test.tsx src/media-upload.test.tsx src/media-detail.test.tsx src/media-delete.test.tsx src/media-bulk-delete.test.tsx && corepack pnpm -r typecheck && corepack pnpm format && corepack pnpm lint`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add apps/admin/src
```

```bash
git commit -m "feat(admin): メディアの詳細パネルと削除(1 件・一括)を足す"
```

---

### Task 9: メディア選択ダイアログと編集画面の差し替え

**Files:**
- Create: `apps/admin/src/components/media/media-picker-dialog.tsx`、`media-picker-dialog.test.tsx`
- Rewrite: `apps/admin/src/components/asset-picker.tsx`(`AssetSelectDialog` を消す。`AssetRelationPicker` は残す)
- Modify: `apps/admin/src/components/record-form.tsx`(`AssetSelectDialog` → `MediaPickerDialog`)
- Create: `apps/admin/src/media-picker-field.test.tsx`、`media-picker-body.test.tsx`
- Delete: `apps/admin/src/asset-flow.test.tsx`

**Interfaces:**
- Consumes: Task 3 の `ModalDialog size="xl"` / `FileButton`、Task 4 の `TileGrid` / `UploadTile` / `FileDropTarget`、Task 5 の `media-list.ts` / `useUploads` / `MEDIA_PICKER_LABELS`、Task 6 の `MediaThumb` / `MediaFilterSelect`、`SearchField` / `TextField` / `Badge` / `Button`、`useRecordsOfTypes`、`CollectionRegistry`、`AssetServices`
- Produces:

```ts
// media-picker-dialog.tsx(F 5 章、M9・M10。F15・F30〜F32)
export interface PickedMedia { id: string; label: string; alt: string }
export interface MediaPickerDialogProps {
  registry: CollectionRegistry; types: ContentTypeDefinition[]; assets: AssetServices;
  fieldName: string;                          // 題の横(本文の画像は MEDIA_PICKER_LABELS.bodyField)
  selection: "one" | "many";
  defaultKind: MediaKind | "all";             // F32
  initialIds?: readonly string[];             // many で既に選ばれている id(選択順の先頭に置く。既定 [])
  onSelect: (items: PickedMedia[]) => void;   // 呼び出し側が閉じる
  onClose: () => void;
}
export function MediaPickerDialog(props: MediaPickerDialogProps): JSX.Element;
// ModalDialog(size xl、isOpen、title MEDIA_PICKER_LABELS.title、role dialog、onOpenChange(false) → onClose、footer: dropHint(font.caption text.muted、左)+ キャンセル + primary(many → insert(n)、one → useOne。n 0 は isDisabled))。
// 題の横: font.caption text.muted の fieldNote(fieldName, many)、右上 FileButton secondary sm「アップロード」(allowsMultiple = many)。
// 本体を FileDropTarget(hint dropLimit)で包む。flex row(NARROW column): 左(flex 1、minWidth 0、flex column、gap space.inset、overflow auto): MediaFilterSelect 種類 + SearchField、
//   TileGrid(label gridLabel、size sm、items visible(新しい順固定、kind / q で絞る)、selectionMode = selection === "many" ? "multiple" : "single"、selectedKeys、renderThumb、
//   renderBadge: many → 選択順の番号(Badge accent、`${index + 1}`)、uploadedIds.has(id) → Badge success(Check)「アップロード完了」、leading = uploads の仮タイル(size sm))。
// 右(width 300px、NARROW width auto、borderLeft、padding space.md、flex column、gap space.inset、overflow auto、aria-label selectedRegion): 「選択中 {n} 件」(weightBold)、
//   選んだ順に: MediaThumb sm + ファイル名(familyMono、font.caption)+ 「{w} × {h} ・ {size}」(one で直後のアップロードなら justUploaded も)、TextField 代替テキスト(description altHelp、placeholder)。one は MediaThumb preview(高さ 150px → preview 200px の部品を流用)。0 件は none の文。
// 選択順: orderedIds: string[](TileGrid の onSelectionChange で、既存の順を保ちつつ新しい id を末尾に、外れた id を除く。one は 1 件に置き換え)。alt の下書き: Map<id, string>(初期値はレコードの alt)。
// アップロード(F30): store = useMemo(() => createUploadStore(assets.upload))、setOptions({ onDone: (assetId, file) → orderedIds に足す(one は置換)、uploadedIds に足して 3 秒後に外す、pendingFocus = assetId })、uploads = useUploads(store)。done の仮項目: レコードが届くまで { id, filename: file.name, size: file.size } を選択中欄に描く。
//   レコードが届いた(useRecordsOfTypes に現れた)直後に、その項目の代替テキストの入力欄に focus(pendingFocus を useEffect で消化)。
// 挿入: onSelect(orderedIds.map(id → { id, label: filename(レコードが無ければ file.name), alt: 下書き }))。alt の保存(F31)は呼び出し側ではなくダイアログが行う: 変わった id だけ registry.get("asset").update(id, …)(失敗はトースト、挿入は続ける)

// asset-picker.tsx(書き換え)
export function AssetRelationPicker(props: 既存と同じ): JSX.Element;
// 「アセットを選択」→ MEDIA_PICKER_LABELS.title(「メディアを選択」)、「解除」→ `MEDIA_LABELS.remove`(「外す」)。選択中の表示は MediaThumb xs + ファイル名。
// open なら MediaPickerDialog(fieldName = field.label ?? field.key、selection = cardinality、defaultKind "all"、initialIds = 選択中の id、onSelect: many → 未選択の id を末尾に足す、one → 置換(F31))

// record-form.tsx: imageInsert !== null のとき MediaPickerDialog(fieldName bodyField、selection "one"、defaultKind "image"、onSelect: items[0] で imageInsert({ id, label }))
```

- [ ] **Step 1: 失敗するテストを書く**

```ts
// media-picker-dialog.test.tsx(直接描画。1 つの it で開くのは 1 回。vi.mock("./media-filter-select"))
it("複数は選んだ順に番号が付き、選択中欄に代替テキストの入力欄が並び、挿入で順に返す", async () => { /* b → a の順に checkbox → 番号 1 / 2、「2 件を挿入」→ onSelect([{ id: b, alt: "…" }, { id: a, … }]) */ });
it("1 件はラジオで置き換わり、ボタンは「このファイルを使う」", async () => {});
it("種類の既定が image なら PDF が出ず、検索で絞れる", async () => {});
it("アップロードが完了すると選択に加わり、印が付き、代替テキストにフォーカスが移る", async () => { /* assets.upload を deferred → resolve({ id }) → registry に change を流す(FakeSocket 無しなら registry の collection に直接 write)→ textbox「代替テキスト」が activeElement、Badge「アップロード完了」 */ });
it("変えた代替テキストは挿入時に asset レコードへ書く", async () => {});
// media-picker-field.test.tsx(1 本。renderAt("/t/blog/content/article/new")。asset-flow の「selects an asset from the dialog」の後継)
it("代替テキストを入れて挿入すると alt が push され、関係が入る", async () => { /* Review Focus 5。fireEvent.click「メディアを選択」→ dialog「メディアを選択」→ checkbox or tile「one.png」→ alt「写真」→「このファイルを使う」→ 下書き保存 → pushes に asset の alt と article の hero */ });
// media-picker-body.test.tsx(1 本。asset-flow の「inserts an assetImage node」の後継)
it("本文の画像ボタンから 1 件を選ぶと assetImage が本文に入る", async () => {});
```

- [ ] **Step 2: テストが失敗することを確かめる**

Run: `corepack pnpm --filter @plyrs/admin exec vitest run src/components/media/media-picker-dialog.test.tsx src/media-picker-field.test.tsx src/media-picker-body.test.tsx`
Expected: FAIL(部品が無い)

- [ ] **Step 3: 実装する**

- [ ] **Step 4: テストが通ることを確かめる**

Run: `corepack pnpm --filter @plyrs/admin exec vitest run src/lib src/components`、続けて `corepack pnpm --filter @plyrs/admin exec vitest run src/media-*.test.tsx src/records-flow.test.tsx src/richtext-flow.test.tsx`、`corepack pnpm -r typecheck && corepack pnpm format && corepack pnpm lint`
Expected: PASS。`grep -rn "AssetSelectDialog\|asset-thumb\|アセットを選択" apps/admin/src` が 0 件、`asset-flow.test.tsx` が無い

- [ ] **Step 5: コミット**

```bash
git add apps/admin/src
```

```bash
git commit -m "feat(admin): メディア選択ダイアログを作り、編集画面の呼び出しを差し替える"
```

---

### Task 10: E2E の media.spec(F4)

**Files:**
- Create: `apps/e2e/tests/media.spec.ts`
- Modify: `apps/e2e/playwright.config.ts`(project `media`、`dependencies: ["core-journey"]`。`two-tab-sync` は core-journey 依存のまま)

- [ ] **Step 1: spec を書く**

```ts
// media.spec.ts: core-journey が作った journey サイトの owner でログイン(email は core-journey と共有できないため、この spec でも signupUser + provisionTenant(slug "media")+ createArticleType を行う)
test("upload, edit alt, pick from the editor, and delete", async ({ page }) => {
  // サイドバー「メディア」→ heading「メディア」。「ファイルを追加」の input に setInputFiles({ name: "cover.png", mimeType: "image/png", buffer: 1×1 PNG })
  // → gridcell / row「cover.png」が出る(group「cover.png」の仮タイルが消えるまで待つ)→ タイルを click → dialog「cover.png」→ textbox「代替テキスト」に「表紙」→「保存」→ 通知「保存しました」→ URL が /media/<uuid>
  // → 「閉じる」→ サイドバー「記事」→「記事を追加」.first() → textbox「title」→「メディアを選択」→ dialog「メディアを選択」→ tile「cover.png」→「このファイルを使う」→ 「cover.png」が選択中に出る → 公開ボックスの「下書き保存」
  // → サイドバー「メディア」→ タイル → 「ファイルを削除」→ alertdialog に「1 件のコンテンツで使われています」→「削除する」→ 通知「削除しました」→ row が消える
});
```

strict mode で同名ボタンが 2 つ並ぶ画面は `.first()`(V4-E Task 10 の教訓)。ドロップは試さない(`setInputFiles` だけ)。

- [ ] **Step 2: 実行(ユーザーに依頼。サンドボックス外)**

Run: `pnpm --filter @plyrs/e2e test`
Expected: 4 spec が PASS。落ちたら warm-up の対象(`apps/e2e/warm-up.ts`)を見直す

- [ ] **Step 3: コミット**

```bash
git add apps/e2e
```

```bash
git commit -m "test(e2e): メディアのアップロード・代替テキスト・選択・削除を通す"
```

---

### Task 11: 全体の検証、preview での実機確認、報告

- [ ] **Step 1: 静的検査とテスト**

Run: `corepack pnpm lint && corepack pnpm format:check && corepack pnpm -r typecheck`、admin は 3 組に分けて vitest、ui / api / 他は `corepack pnpm --filter <pkg> exec vitest run`
Expected: すべて成功(ui の RAC のテストがタイムアウトしたら単独で再実行。api の session.test が落ちたら単独で再実行)。`grep -rln "tokens.stylex" apps/admin/src/components apps/admin/src/routes/t` が 0 件、`grep -rn "アセット" apps/admin/src --include=*.tsx --include=*.ts | grep -v test` が 0 件(`ASSET_TYPE_DEFINITION.name` は metamodel で範囲外)

- [ ] **Step 2: ビルドと E2E(ユーザーに依頼。サンドボックスの外。`apps/api/.wrangler` / `apps/admin/.wrangler` が消える)**

Run: `pnpm --filter @plyrs/admin build && pnpm --filter @plyrs/e2e test`
Expected: build 成功、4 spec が PASS

- [ ] **Step 3: dev での見た目の確認(ユーザーに依頼。`run` スキルを使ってよい)**

依頼書 3 章「確認する状態」の「メディア」「選択ダイアログ」「共通」を owner / viewer で見る:

- グリッド: 160px のタイル、12px 間隔、等幅のファイル名、画像以外のアイコン + 拡張子、左上のチェックボックス、右上の「未使用」、最下部の点線の案内、絞り込みの行(種類 / 使用状況 / 並び順 / 検索 / 件数 / 切り替え)、URL のクエリ、再読み込み後もリスト表示が残る
- リスト: 40px のサムネイル、ファイル名の下の代替テキスト / 「代替テキストなし」、種類・サイズ・日時、「使用中」/「未使用」
- 0 件: 本文全体のドロップ領域。ドロップ中: 暗幕 + 点線 + 件数。アップロード中: 先頭の仮タイル(送信中 / 順番待ち)、上のバー(「2 / 5 件が完了」「残りを中止」)、完了の印が 3 秒、20 MB 超えの理由と「取り除く」、一部失敗の通知と再試行
- 詳細: URL `/media/:id` の直接開き、幅 360px で本文が右に避ける(列数が減る)、プレビュー 200px と大きさ、情報、代替テキスト / キャプションの保存、公開中の URL のコピー / 未公開の案内、使用箇所のリンク(タイトル ・ 型名 ・ フィールド名 / 本文中)、「ファイルを削除」と警告つきの確認、Esc と閉じるでタイルにフォーカスが戻る
- 一括: チェックで一括操作のバー、「N 件すべてを選択」、使用中を含む一括削除の確認、進捗と中止
- 選択ダイアログ: 1040×720、題 + フィールド名 + 1 件 / 複数、右上のアップロード、140px のタイル、複数の番号 / 1 件のラジオ、右の選択中欄の代替テキスト、アップロード直後の印とフォーカス、「N 件を挿入」/「このファイルを使う」、本文の画像挿入は種類が画像で開く
- 閲覧者: 追加・ドロップ・チェック・削除が無く、代替テキストが読み取り専用、コピーと使用箇所は使える
- 旧 URL: `/content/asset/<id>` と `/records/asset/<id>` がメディアの詳細へ転送される。サイドバーに「アセット」が無い
- 狭い画面(959px 以下): タイルが伸びる、絞り込みが折り返す、リストの列が隠れる、詳細が下から出るシート、ダイアログが縦並び。ダーク: タイル・バッジ・暗幕・パネル・ダイアログの配色

- [ ] **Step 4: ブランチの仕上げ**

superpowers:finishing-a-development-branch に従い、統合方法(ローカルマージ / push して PR / 残す)をユーザーに提示して選んでもらう。push はユーザーに確認してから(`git -c credential.helper='!gh auth git-credential' push https://github.com/hiz8/plyrs.git <branch>`、PR は `gh pr create --repo hiz8/plyrs`)。ワークツリー隔離のセッションでは main 側の git 操作が拒否されるため、ローカルマージは ExitWorktree(keep) で main に戻ってから `git merge --ff-only`(main に同名の未追跡ファイルがあれば先に消す。`git worktree remove` はサンドボックス外から)。

- [ ] **Step 5: preview での実機確認(ロードマップ 5 章の注記。ユーザーに依頼)**

main への反映で preview に自動デプロイされる。`/t/<slug>/media` と `/t/<slug>/media/<id>` を直接開いて描画されること(SPA シェルの転送)、実ファイルのアップロード(画像・PDF・20 MB 超え)、公開中のコンテンツから使われているファイルの公開 URL が `/public/v1/<slug>/assets/<id>` で取れること、削除後に公開 URL が 404 になること、旧 URL の転送を確かめる。食い違いがあれば報告する(直すか後続に回すかはユーザーが決める)。

- [ ] **Step 6: 報告**

ユーザーに次をまとめて報告する: 裁定台帳(F1〜F40)と設計書への書き戻し、実行中に下した裁定(SDD の台帳 `.superpowers/sdd/<計画名>/progress.md` の Ruling)、D3 にあって V4-F に入れなかったもの(M6 のファイルごとの % とバイト数(F9)、M3 の「2 件で使用」(F7)、M1 のアイコンだけの切り替え(F21)、C2 の「追加」(F33))、後続へ送るもの(E21(F3)、XHR による進捗(F9)、E26 の離脱ガード、案 F 9 章の未決(縮小画像 API、受け付ける形式、`asset` 型の名前)、`record-form.tsx` の `locked`)、E2E・preview で見つかった食い違い、`.design-sync/NOTES.md` に記録した ui の変更(F36)。

---

### Task 12: design-sync の再同期(V2・V3・V4-B・V4-G・V4-E・V4-F 分)

**Files:**
- Modify: `.design-sync/NOTES.md`(再同期の結果と「Re-sync risks」の更新)
- 実行はユーザーが `/design-sync` スキル(DesignSync ツール)で行う。サンドボックス外

- [ ] **Step 1: 対象の確認**

`.design-sync/NOTES.md` の「V2 で変えた部品」〜「V4 で変えた部品」の一覧と、`.design-sync/docs/` のスタブ(V4-E の `SortableList.md` / `SidePanel.md`、V4-F の `TileGrid.md` / `UploadTile.md` / `FileDropTarget.md` / `FileButton.md`)がそろっていることを確かめる。新しい部品のプレビュー: `TileGrid`(3 件、multiple、1 件選択、バッジ付き。`cardMode: column`)、`UploadTile`(5 状態を横に並べる)、`FileDropTarget`(静的には暗幕が出ない → 子にグリッドを置いた素の状態。「静的に描けない状態」に追記)、`FileButton`(secondary)、`SidePanel`(`narrowLayout="sheet"` は描画幅 960px 未満の環境で下から出る形になる → overrides の viewport で確かめる)、`ModalDialog size="xl"`(viewport を 1100×800 に)

- [ ] **Step 2: 再同期(ユーザー)**

`.design-sync/NOTES.md` の「再同期の手順」1〜3 を `/design-sync` で実行する(`buildCmd` は packages/ui を変えたので必須)。描画の警告(GRID_OVERFLOW など)が出たら overrides で対応し、NOTES.md の「Known render warns」に書く

- [ ] **Step 3: NOTES.md を更新してコミット**

「V2 で変えた部品」〜「V4 で変えた部品」の各節の「再同期が必要」を「2026-10-xx に再同期済み」に改め、気づきを「部品側の気づき」「Re-sync risks」に足す。

```bash
git add .design-sync
```

```bash
git commit -m "docs(design-sync): V2〜V4-F の部品を再同期した記録を残す"
```

---

## セルフレビュー(2026-10-21)

- 仕様の網羅: F 3 章(グリッド / リスト、切り替えと記憶、絞り込み・検索・並び順、URL のクエリ)→ Task 5(純関数)・6(部品)・7(ルート)。3.3(画面全体のドロップ、暗幕と件数、常時の案内、0 件の領域、複数の逐次送信、20 MB の事前拒否、仮タイル、全体の進捗と中止、一部失敗の通知)→ Task 3(`DropZone.isFill` / `FileButton`)・4(`UploadTile` / `FileDropTarget`)・5(`useUploads`)・7。4 章(URL、360px、プレビュー → 情報 → 代替テキスト・キャプション → 公開 → 使用箇所 → 削除、閉じる / Esc、狭い画面のシート)→ Task 3(`SidePanel`)・8。4.1(確認の文言、一括のバー、使用中の件数)→ Task 6(`MediaBulkBar`)・8。4.2(差し替えの案内)→ Task 8。5 章(共用の部品、ダイアログ内アップロード、代替テキストの編集、1 件 / 複数、形)→ Task 3(`size="xl"`)・9。6 章(転送、案 C 10 章の暫定の撤去、サイドバー)→ Task 5・7。7 章(遅延読み込み、キャッシュ)→ Task 6(`MediaThumb`)。8 章(viewer)→ Task 7・8。H 2 章(h1 1 つ、主操作)→ Task 7。H 6・8 章 → Task 7・8。H 10・11 章 → Task 3・4・7。V4-E の持ち越し(F38)→ Task 2。design-sync → Task 12
- 型の整合: `MediaRow` / `MediaQuery` / `MediaKind` / `MediaView`(Task 5)を Task 6(`MediaGridProps.rows` / `MediaToolbarProps.query`)・7・8(`MediaDetailPanelProps.row`)・9 が使う。`UploadEntry` / `UploadsState`(Task 5)を Task 6(`MediaGridProps.uploads`)・7・9 が使う。`TileGrid.onAction(id)`(Task 4)を Task 6 の `MediaGridProps.onOpen` が受け、`TileGrid.leading` に Task 6 が `UploadTile` を渡す。`UploadTileState`(Task 4)へは Task 6 の `uploadTileState(entry, …)` が写す。`SidePanel.width / narrowLayout`(Task 3)を Task 8 が `360 / "sheet"` で使う。`ModalDialog size="xl"`(Task 3)を Task 9 が使う。`PickedMedia`(Task 9)を `asset-picker.tsx` と `record-form.tsx` が受ける。`DeleteMediaTarget`(Task 8)の `usage` は `ResolvedUsage[]`(`lib/media.ts`)。Task 8 の `MediaDetailPanelProps` は usage / publication を props で受け、useQuery は `MediaLibrary` に置く
- Review Focus: 5 項目すべてに Task 5・7・8・9 のテスト名を結んだ
- ステップの粒度: 各タスクのコード本体は署名と pinned な値(文言・寸法・順序・クエリ名・判定の規則・エラーの対応)だけで、アルゴリズムを決める必要がある箇所(`uploadedAtOf`、`applyMediaQuery` の並び、`useUploads` の進行と 3 秒の保持、`FileDropTarget` の件数の取り方、`TileGrid` の single / multiple の振る舞い、選択順の保ち方、`legacyPathname` の 2 段の置き換え)だけ 1 行で書いた
- 入れなかったもの(範囲外として報告): 案 F 9 章の未決(縮小画像 API、受け付ける形式の絞り込み、`asset` 型の名前)、E21(F3)、XHR による送信の進捗(F9)、E26 の離脱ガード、`record-form.tsx` の `locked`(F26)
