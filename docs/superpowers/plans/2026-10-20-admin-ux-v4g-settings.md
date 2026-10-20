# 管理画面 UX 再構築 V4-G: 設定とアカウント(案 G) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 設定を見出し「設定」の下の 4 タブ(一般 / コンテンツタイプ / メンバー / モジュール)にし、「一般」(サイト名・識別子・公開 API の URL)、「メンバー」(一覧・追加・ロール変更・外す)、「モジュール」(説明付きのカードと有効化 / 無効化)を作り、アカウントメニューから開く「アカウント設定」(メール・パスワード変更・テーマ・所属サイト)を足す。あわせて V4-B の持ち越し(「読み込み中…」の直書き、「はじめに」の手順 3、`modulesQueryOptions` の retry、`SEPARATOR` の文言化)を片付ける。

**Architecture:** 画面の判断は純関数に寄せ、部品は描くだけにする(V2〜V4-B と同じ)。設定の枠は layout route ではなく部品 `SettingsFrame`(h1「設定」+ `Tabs` + 本文の幅)を各タブのルートが描き、`settings/route.tsx` は owner 以外を転送する guard だけを持つ(案 G 7 章)。メンバーの行の判断(自分 / 最後の管理者 / ロールを下げるか)は `lib/members.ts`、公開 API の URL は `lib/public-api.ts`、モジュールの件数は `lib/modules.ts` の純関数。データは HTTP のクエリ(`membersQueryOptions` / `modulesQueryOptions` / `meQueryOptions` / `tenantsQueryOptions` / `configQueryOptions`)だけで描き、同期を待たない。同期データは無効化の確認の件数と有効化直後のリンクにだけ使う(無ければ省く)。ダイアログは `ModalDialog` / `ConfirmDialog`、結果は `toaster`。見た目はセマンティックトークンと `@plyrs/ui` の部品だけで組む。

**Tech Stack:** StyleX 0.19.1、react-aria-components 1.21.1(`Link` と `components/shell/` 以外は ui の部品経由)、TanStack Router 1.170.18、TanStack Query 5、lucide-react、Vitest + jsdom + Testing Library、Playwright

**Spec:**
- `docs/admin-ux/g-settings-account.md`(3 章 一般、4 章 メンバー、5 章 モジュール、6 章 アカウント、7 章 権限が真実源。8 章 運営コンソール、9 章 未決事項は範囲外)
- `docs/admin-ux/h-common-surface.md`(2 章 骨格、3 章 部品、4 章 文言、5 章 日時、6 章 状態、7 章 権限、8 章 確認の使い分け、10 章 画面幅、11 章 アクセシビリティ、12 章 アイコン)
- `docs/admin-ux/h-design-tokens.md`(3 章 セマンティックトークン、4 章 テーマ)
- `docs/admin-ux/a-navigation.md` 3.3(設定・アカウントメニュー)
- `docs/admin-ux/b-home.md` 2.6(「はじめに」の手順 3、V4-B の裁定 B4)
- `docs/superpowers/plans/2026-10-17-admin-ux-rebuild-roadmap.md` 5 章 V4
- `docs/superpowers/plans/2026-10-20-admin-ux-v4b-home.md`(V4-B の裁定 B4・B19 と、テスト基盤 `test-utils/api-stubs.ts` の契約)
- `docs/admin-ux/design-briefs/03-remaining-screens.md` 3 章「確認する状態」の「メンバー」(自分が最後の管理者、ロールを下げるときの案内、自分を外すときの確認)と「共通」(ダーク、狭い画面)
- キャンバス https://claude.ai/artifact/K57TVUfpefMuiPxhZXyAnU のページ「D3 残りの画面」の G1〜G6。フレームは `project/D3-Settings-General.dc.html`(G1)、`D3-Members.dc.html`(G2)、`D3-Members-Add.dc.html`(G3)、`D3-Members-Dialogs.dc.html`(G4)、`D3-Modules.dc.html`(G5)、`D3-Account.dc.html`(G6)。設計書と食い違うときは設計書を優先する(食い違いは「裁定台帳」に記し、Task 1 で設計書に書き戻し、最後に報告する)

## Global Constraints

- 画面と部品が参照するのはセマンティックトークン(`@plyrs/ui/semantic.stylex`)だけ。本計画で触る admin のファイル(`routes/t/$tenantSlug/settings/**`、`routes/t/$tenantSlug/account.tsx`、`components/settings/**`、`components/account/**`)に旧 `@plyrs/ui/tokens.stylex` の参照を作らない。`routes/super/**` は文言の置き換えだけで、トークンは触らない(V4 の範囲外)
- キャンバスの寸法は尺度に寄せる(V1〜V4-B と同じ対応表): 文字 13px→14px(`font.body`)、12px→`font.caption`、15px→16px(`font.label`)、18px→16px、20px→`font.sectionTitle`、24px→`font.pageTitle`。余白 10px→12px(`space.inset`)、6px→8px(`space.sm`)、4px→`space.xs`、16px→`space.md`、20px→24px(`space.lg`)、28px→24px(`space.lg`)、32px→`space.xl`。部品固有の寸法は数値で書き、コメントで根拠(g-settings-account.md の章 / D3 G1〜G6)を添える: 設定とアカウントの本文の最大幅 880px(`SETTINGS_MAX_WIDTH`。メンバーも 880px、裁定 G27)、カードの角 `radius.container`・padding `space.lg`、ロール説明カードの 3 列グリッド間隔 `space.inset`、メンバーの表の行 52px(`size.row`)、モジュールのアイコン枠 44px(角 `radius.item`)、セグメントの外枠 `size.control`・内側のボタン `size.controlSm`、ダイアログの幅は ui の既定
- 幅 960px 未満の切り替えは CSS のメディアクエリ `"@media (max-width: 959px)"` だけで行う(各ファイルに `const NARROW`。JS の `matchMedia` は使わない)。2 列のグリッド(サイト名 / 識別子、パスワードの入力欄)と 3 列のロール説明カードは NARROW で 1 列。メンバーの表は「参加日」を `hideOnNarrow`。モジュールのカードは NARROW でボタンを説明の下に回す(flex-wrap)
- 画面は `@plyrs/ui` の部品(`Button` / `IconButton` / `TextField` / `Select` / `Badge` / `Banner` / `Skeleton` / `ModalDialog` / `ConfirmDialog` / `Tabs` / `Table` 系 / `Avatar` / `Tooltip` / `EmptyState` / `PageHeader` / `toaster` と、本計画で足す `SegmentedControl`)で組む。react-aria-components を admin から直接 import してよいのは `components/shell/` と、V3 の R23・V4-B の B10 で認めた表・枠の中のリンク(`Link` の `href`)だけ。所属サイトの「切り替える」と有効化直後の「{型名}を追加 ›」もこの例外に含める(裁定 G28)
- 画面上の呼称と文言は `lib/labels.ts` に置く(画面・部品に日本語を直書きしない。例外: テストの断言)。「テナント」は「サイト」、ロールは「管理者 / 編集者 / 閲覧者」(`roleLabel`)。文体は「です・ます」、ボタンは操作名(H 4.2)。確認ダイアログのボタンは「OK」にしない
- 日時は `lib/datetime.ts` で出す(参加日は本計画で足す `formatDate` の「2026/07/16」)。ユーザー ID・ISO 文字列・`version` / `appliedVersion` を画面に出さない(現行のモジュール画面の「v1(適用済み v1)」は消える)
- エラーは `lib/error-messages.ts` の `errorMessage(cause, fallback)` で利用者向けの文にする。本計画で `ERROR_MESSAGES` に `last_owner` / `already_member` / `user_not_found`(上書き)を足す。入力の問題はフィールドの下(H 6 章)、操作の失敗はトースト(エラー色)、取得の失敗は `role="alert"` の文と「再試行」
- 見出しは 1 画面に `h1` が 1 つ(設定は「設定」、アカウント設定は「アカウント設定」)。各カードの題は `h2`(`SettingsCard`)、モジュールのカードの題も `h2`
- アイコンは `lucide-react`、ボタン・バッジの中は `ICON_SIZE.inline`、装飾は `aria-hidden`。使うアイコン(H 12 章): settings(設定)/ users(メンバー)/ puzzle(モジュール)/ copy(コピー)/ plus(追加)/ user-cog(アカウント設定)/ monitor・sun・moon(テーマ)/ circle-check(有効にしました)/ circle-alert(未登録の案内)/ triangle-alert(自分を外す警告)/ clock(反映の遅れ)/ rotate-cw(再試行)/ arrow-right-left(切り替える)
- 権限の出し分けは `useCan()` だけ(ロールの直書き禁止。`components/shell/sidebar.tsx` の `can(tenant.role, …)` は既存のまま)。`settings/route.tsx` の guard は router の `beforeLoad` なので `can(context.tenant.role, "site:manage")` を使う。設定の 4 タブは owner だけ(7 章)。アカウント設定は全員
- 確認は `ConfirmDialog`。元に戻せない操作(メンバーを外す、自分を外す)は `tone="danger"`(初期フォーカスはキャンセル、H 8 章)。ロールを下げる・モジュールを無効にするは `tone="primary"`(戻せる)
- RTL テストの方針(V2〜V4-B で分かった罠): router 経由で描くテスト(`renderAt`)では RAC の Popover(`Menu` / `Select`)を user-event で開けず、同じファイルで RAC の Modal を 2 回開くとハングする。したがって (1) ダイアログ・メニュー・`Select` の挙動は部品単位のテスト(`components/**/*.test.tsx` の直接描画)で担保する、(2) router 経由でモーダルを開くテストは **1 ファイル 1 本**にする(`settings-members-add.test.tsx` / `settings-members-remove.test.tsx` / `settings-members-remove-self.test.tsx` / `settings-members-demote.test.tsx` / `settings-modules-disable.test.tsx`)、(3) ロールの `Select` を使う router テストは `vi.mock("./components/settings/role-select", …)` で素の `<select>` に差し替える(`role-select.tsx` を 1 ファイルに分けるのはこのため)、(4) モーダルを開く操作は `fireEvent.click`、それ以外は `userEvent`。アカウントメニューの「アカウント設定」は `components/shell/account-menu.test.tsx`(直接描画)で押し、router 側は `/t/blog/account` を初期パスにする
- `getByRole("status")` は複数一致する(サイドバーの同期状態、有効化の帯)ため、名前か `within` で絞る。トーストは `within(screen.getByRole("region", { name: "通知" }))`。TanStack Query v5 の `isError` はバックグラウンド再取得の失敗でも true になるので、取得済みの表示を消したくない場面は `isLoadingError` を使う(V4-B の裁定)
- 設定とアカウントの画面は同期を待たずに描く(現行の設定画面と同じ。`useSyncHasSynced` で止めない)。同期データを使うのはモジュールの無効化の件数(G3)と有効化直後のリンク(G15)だけで、未同期なら省く
- クリップボードは `navigator.clipboard.writeText`。成功でトースト「コピーしました」、失敗(未対応・拒否)でエラーのトースト「コピーできませんでした」。jsdom では `navigator.clipboard` が無いので、テストは `Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn() }, configurable: true })` で差し替える
- 新しいルート(`settings/route.tsx` / `settings/general.tsx` / `settings/members.tsx` / `account.tsx`)を足すと `src/routeTree.gen.ts` の再生成が要る。サンドボックス内では `vite build` が EROFS で落ちることがある(dev-flow の教訓 8)ので、ルートを足すタスクの実装者はルートファイルを作った時点で NEEDS_CONTEXT として止まり、コントローラがサンドボックス無効で `corepack pnpm --filter @plyrs/admin build` を実行して `routeTree.gen.ts` を更新してから再開させる(先にサンドボックス内で試してよい。通ればそのまま進む)
- `@ts-expect-error` は使わない。素の `git stash` は使わない。コメント・ドキュメント・コミットメッセージは日本語。コミットは各タスクの最後に 1 つ(`/commit` スキルの規約。帰属行は付けない)。git は 1 回の呼び出しに 1 コマンド(`git add … && git commit …` の複合は使わない)
- サンドボックスの道具: `pnpm` は `corepack pnpm`。ルートの `pnpm typecheck` / `pnpm test` は使わず `corepack pnpm -r typecheck`、`corepack pnpm -r --filter "!@plyrs/e2e" test`(この 1 コマンドだけバックグラウンド可。リダイレクトやループと組み合わせない)。`corepack pnpm format:check` の「No config found, using defaults」は正常な警告(exit 1 のときだけ整形漏れ)。`pnpm install`、admin の `build`(上の例外を除く)、`dev` サーバー、E2E、design-sync はサンドボックスの外で実行する(「ユーザーに依頼」と書く)。並列実行で ui の RAC のテストが 5 秒でタイムアウトしたら、そのファイルを単独で再実行して判断する。apps/api の `test/session.test.ts`「stores only a hash of the token」は稀に落ちる(単独で通れば無視)
- `docs/` と `.design-sync/` は oxfmt の対象外。それ以外は各タスクの最後に `corepack pnpm format` をかけ、コントローラがタスクごとに `corepack pnpm format:check` を確かめる(実装者の「format 済み」報告だけで済ませない)
- ロードマップ 5 章の注記どおり preview で実機確認する(Task 10)。push とコミットはユーザーに確認してから
- design-sync の再同期(V2・V3・V4-B・本計画分)は V4-F の計画の末尾に 1 回まとめて行う。本計画で ui を変えた分(`SegmentedControl` の新設)は `.design-sync/NOTES.md` の「V4 で変えた部品」に記録だけする
- サブエージェントへのディスパッチ文には、作業ツリーのパスを `cd` 付きで強制すること、`git log --oneline -2` の実出力を貼らせること、テストの実出力を貼らせること、`@ts-expect-error` 禁止と素の `git stash` 禁止、git は 1 回 1 コマンド、サブエージェントを spawn しないこと、報告ファイルを必ず書くこと、を含める

## 裁定台帳(2026-10-20)

計画を書く時点で決めたこと。G1〜G3 はユーザー裁定。Task 1 で設計書に書き戻し、最終報告で一覧にする。番号は本文から参照する。

| #   | 項目                                                                       | 裁定                                                                                                                                                                                                                                                                                                                                 | 書き戻し先            |
| --- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------- |
| G1  | 公開 API のベース URL の出所(G 3 章)                                       | admin Worker の `vars` に `PUBLIC_API_ORIGIN` を足し(dev は空文字 = 同一オリジン、preview は `https://plyrs-api-preview.hiz.workers.dev`、production は `https://plyrs-api.hiz.workers.dev`)、`server.ts` が `GET /_config` で `{ publicApiOrigin }` を返す。api 側は触らない。ユーザー裁定                                           | g 3 章、deploy.md     |
| G2  | テーマの切り替えの部品(G 6.2、H トークン 4 章)                             | 設計書どおり 3 択のセグメント。ui に `SegmentedControl`(RAC `RadioGroup` ベース、pill)を新設し、`components/theme-select.tsx`(`ThemeSelect`)は `components/theme-segment.tsx`(`ThemeSegment`)に置き換える。ユーザー裁定                                                                                                             | g 6.2、h 3 章         |
| G3  | モジュールの無効化の確認の件数(G 5 章)                                     | 出す。同期済みのレコードから navTypes の型ごとに削除済みを除いて数え、「予約 3 件、予約枠 2 件」の形。初回同期前は件数の無い文にする。API は無効化で型もレコードも残す(`tenant-do.ts` の `setModuleEnabled`、§9.5)ことを確認した。ユーザー裁定                                                                                        | g 5 章                |
| G4  | 設定の着地先とサイドバーの「設定」の href                                  | `/settings` → `/settings/general`(最初のタブ)。サイドバーの「設定」と `settingsCrumb` の href も `/settings/general`。E2E の `createArticleType` はサイドバーの「設定」の後にタブ「コンテンツタイプ」を押す                                                                                                                                | a 3.3、g 3 章         |
| G5  | 4 タブの枠の実装                                                           | layout route ではなく部品 `SettingsFrame`(h1「設定」+ `Tabs` + 本文の最大幅)を各タブのルートが描く。`settings/route.tsx` は owner 以外を `/t/$tenantSlug` へ転送する guard だけ(7 章)。`content-types/index.tsx` は見出し・パンくず・主操作の部分だけ `SettingsFrame` に差し替え、表は触らない(V4-E)。`content-types/new` と `edit` はタブの外(自前の見出しのまま) | g 3 章、g 7 章        |
| G6  | タブの件数(D3 G2「メンバー 3」)                                            | 出さない(他のタブを開くたびにメンバー一覧を取ることになる)                                                                                                                                                                                                                                                                             | g 4.1                 |
| G7  | 「最終ログイン」の列(G 4.1「API の有無で実装時に判断」)                    | 出さない(`MemberSummary` に無い)                                                                                                                                                                                                                                                                                                       | g 4.1                 |
| G8  | 「例: お知らせの一覧」の URL(G 3 章)                                       | サイドバーの先頭の型(`sidebarContentTypes(types)[0]`)で作り、ラベルは「例: {型名}の一覧」。型が無い(未同期を含む)ときはこの行を出さない                                                                                                                                                                                                 | g 3 章                |
| G9  | メンバーの行の寸法                                                         | アバターは `Avatar size="sm"`(24px。キャンバスの 28px は尺度に無い)、ロールの `Select` は `size="sm"`(28px)、「外す」は `Button variant="dangerLink" size="sm"`                                                                                                                                                                       | g 4.1                 |
| G10 | ロール説明カードの文(G 4.1「permissions.ts に合わせる」)                   | 管理者「すべての操作に加えて、設定(コンテンツタイプ・メンバー・モジュール)を変更できます」/ 編集者「コンテンツとメディアの作成・編集・公開ができます。設定は変更できません」/ 閲覧者「コンテンツとメディアを見るだけです。作成・編集・公開はできません」(D3 G2)。ダイアログのロールの説明にも同じ文を使う                                       | g 4.1                 |
| G11 | 「自分」の判定                                                             | `meQueryOptions` の `userId` と行の `userId` の一致。`me` が取れないときは「自分」の印と自分向けの確認文を出さず、通常の確認にする(API が最後の owner を守る)                                                                                                                                                                             | g 4.5                 |
| G12 | 自分のロールを下げる・自分を外した後(G 4.5)                                | どちらも確認ダイアログに「この操作のあと、設定を開けなくなります。戻すには他の管理者({メール})に追加してもらう必要があります」の警告色の注記。成功したら tenants クエリを invalidate し、ロールを下げたときは `/t/$tenantSlug`(ホーム)へ、外したときは `/tenants`(サイト選択)へ移る                                                        | g 4.5                 |
| G13 | 「他の管理者({メール})」                                                   | 自分以外の owner のメールアドレスを「、」で結ぶ(`otherOwnerEmails`)。自分が最後の管理者なら操作自体が出ないので、空になることはない                                                                                                                                                                                                    | g 4.5                 |
| G14 | メンバー追加の失敗の出し方(G 4.2)                                          | 404 `user_not_found` は入力欄の下の案内(サインアップ URL `${location.origin}/signup` と「URL をコピー」)、409 `already_member` は入力欄の下の「このメールアドレスは既にメンバーです」、それ以外はダイアログ内の `role="alert"` の文(`errorMessage`)。ダイアログは閉じない                                                               | g 4.2                 |
| G15 | モジュールのカードの中身(G 5 章、D3 G5)                                    | 「増えるもの」の箇条書きは manifest に項目が無いため出さず、`description` の段落だけ。アイコンは共通の `Puzzle`(manifest にアイコンが無い)。有効化直後の帯(`role="status"`)は「有効にしました。」+ navTypes の型のうち同期で届いているものへ「{型名}を追加 ›」(`/content/<key>/new`)。帯はページ内の状態で、再読み込みで消える            | g 5 章                |
| G16 | モジュールの無効化の確認(G 5 章)                                           | `tone="primary"`(戻せる)。題「{名前}モジュールを無効にしますか？」、本文「サイドバーから「{名前}」が消え、公開サイトのこのモジュールの API は応答しなくなります。」、注記「モジュールのコンテンツ({件数})は削除されません。再び有効化すると元に戻ります」。有効化は確認なしでトースト                                                     | g 5 章                |
| G17 | アカウント設定の URL と導線(G 6 章)                                        | `/t/:slug/account`。パンくず「ホーム › アカウント設定」、サイドバーの現在地は無し。アカウントメニューの先頭に「アカウント設定」(user-cog)、区切り、「サイトを切り替え」(所属が複数のとき)、「ログアウト」                                                                                                                                 | g 6.1、a 3.3          |
| G18 | パスワード変更の結果の出し方(G 6.2)                                        | 送信前の検証: 新しいパスワードが 12 字未満 → 新しいパスワード欄の下「12 文字以上で入力してください」、確認が不一致 → 確認欄の下「新しいパスワードが一致しません」。API の 403 `wrong_password` → 現在のパスワード欄の下、400 `same_password` → 新しいパスワード欄の下、それ以外はトースト。成功: 入力を空にしてトースト「パスワードを変更しました」(`revokedSessions` > 0 なら「。他の端末 {n} 件をログアウトしました」を足す) | g 6.2                 |
| G19 | 所属サイトのカード(G 6.2)                                                  | `tenantsQueryOptions` の一覧。行は `Avatar size="sm"` + サイト名 + ロールの `Badge`(管理者は accent、他は neutral。サイト選択と同じ)+ 現在のサイトは「現在のサイト」の補足、他は「切り替える」のリンク(`/t/<slug>`)                                                                                                                     | g 6.2                 |
| G20 | サイト名の保存(G 3 章)                                                     | 「保存」は入力が元の名前と同じ(前後の空白を除いて比較)か空か 100 字超なら無効。空・100 字超は入力欄の下に理由。成功で tenants クエリを invalidate(サイドバーとサイト選択に反映)+ トースト「保存しました」。失敗はトースト(`errorMessage`)                                                                                             | g 3 章                |
| G21 | 「読み込み中…」の直書き(V3 持ち越し 2、V4-B の B19)                        | `routes/super/{index,users,audit,dlq,modules,tenants.$tenantId}.tsx` の 6 か所を `LOADING_LABEL`(「読み込み中」。末尾の「…」は落ちる)に置き換える。文言だけでトークンは触らない。`settings/modules/index.tsx` は作り直しで消える                                                                                                        | (コード)              |
| G22 | V4-B の申し送り                                                            | `modulesQueryOptions` に `retry: 1`。`components/home/home-card.tsx` の `SEPARATOR` は `HOME_LABELS.separator`。「型 0 件のときホームがウィジェットも出さない」は b-home.md 2.6 の解釈どおり据え置き(変えない)                                                                                                                             | (コード)              |
| G23 | 設定画面の読み込み中                                                       | `SettingsFrame` の h1 とタブは最初から出し、タブの中身だけスケルトン(本文の入れ物に `aria-busy`)。取得の失敗は中身の位置に `role="alert"` の文と「再試行」(`isLoadingError`)                                                                                                                                                              | g 3 章、h 6 章        |
| G24 | `/_config` の配線(G1)                                                      | `isApiPath` には含めず、`resolveServerRoute` に `"config"` を足す(`pathname === "/_config"`)。`apps/admin/.dev.vars.example` に `PUBLIC_API_ORIGIN=`(空)。`worker-configuration.d.ts` は `corepack pnpm --filter @plyrs/admin cf-typegen` で再生成する                                                                                | deploy.md             |
| G25 | タブの実装                                                                 | ui の `Tabs`(RAC Tabs)で、`onSelectionChange` で `navigate`。`children(id)` は選ばれたタブだけ中身を返す。タブの名前(`label`)は「設定の項目」                                                                                                                                                                                             | g 3 章                |
| G26 | 最後の管理者の行(G 4.5)                                                    | ロールのセレクトと「外す」の代わりに、`Button variant="link" size="sm" disabledReason={理由}` の「最後の管理者」(フォーカスでき、理由がツールチップと `aria-describedby` で読める。H 7 章の「無効にして理由を添える」)                                                                                                                      | g 4.5                 |
| G27 | メンバーの本文の幅(D3 G2 は 960px)                                         | 他のタブと同じ 880px(表は 4 列で収まる)                                                                                                                                                                                                                                                                                                | g 4.1                 |
| G28 | RAC `Link` を admin から直接使う例外の追加                                 | 所属サイトの「切り替える」、有効化直後の「{型名}を追加 ›」(R23・B10 の拡張)                                                                                                                                                                                                                                                             | h 3 章                |
| G29 | 「はじめに」の手順 3(V4-B の B4、D3 H5)                                    | 題「メンバーを招待する」、本文「編集を手伝ってくれる人を、設定 › メンバーから追加します。追加できるのは plyrs に登録済みの人です」、ボタン `variant="secondary"`「メンバーを追加」→ `/settings/members`。手順は配列にして描く                                                                                                              | b 2.6                 |
| G30 | ロールを下げる確認の本文(G 4.3、D3 G4)                                     | 閲覧者へ「コンテンツの作成・編集・公開ができなくなります。」、編集者へ(管理者から)「設定(コンテンツタイプ・メンバー・モジュール)を変更できなくなります。」。注記(clock、警告色)「反映まで最大 15 分かかります。すぐに止めたい場合は、いったんメンバーから外してください」。上げるときは確認なしでトースト「{メール} を{ロール}にしました」 | g 4.3                 |

## Review Focus

1. **自分が最後の管理者**: 自分の行にロールのセレクトと「外す」が出ず、「最後の管理者」とその理由が読めること。他の管理者を足した後は操作が出ること。→ Task 7 の settings-members-list.test「自分が最後の管理者の行は操作の代わりに「最後の管理者」と理由を出し、管理者が 2 人なら操作が出る」
2. **外す・ロール変更が運営者の操作と重なる**(409 `last_owner` / 404 `not_found`): エラーのトーストが出て、一覧が取り直されること(行が消えるか元に戻る)。→ Task 7 の settings-members-remove.test「409 last_owner ならエラーのトーストを出して一覧を取り直す」
3. **未登録のメールアドレス**: 「追加する」の後に入力欄の下へ案内とサインアップ URL のコピーが出て、ダイアログは閉じず、同じダイアログで入力し直して追加できること。→ Task 7 の settings-members-add.test「未登録なら案内と URL のコピーを出し、入力し直すと追加できる」
4. **モジュール一覧の取得に失敗**: 見出しとタブは残り、中身にエラー文と「再試行」が出て、再試行でカードが描かれること。→ Task 8 の settings-modules.test「取得に失敗すると中身だけにエラーと再試行が出る」
5. **現在のパスワードが違う**(403 `wrong_password`): 現在のパスワード欄の下に文が出て、入力は消えず、ログイン画面に飛ばされないこと(401 ではないため)。→ Task 9 の account-page.test「現在のパスワードが違うと現在のパスワード欄の下に文が出て入力は残る」

---

## ファイル構成

`packages/ui/src/`:

| ファイル                    | 責務                                                                            |
| --------------------------- | ------------------------------------------------------------------------------- |
| `segmented-control.tsx`     | 新規。`SegmentedControl`(RAC RadioGroup / Radio の pill 3 択。G2)                |
| `segmented-control.test.tsx` | 新規                                                                           |
| `index.ts`                  | 変更。`SegmentedControl` の export                                              |

`apps/admin/`:

| ファイル                                           | 責務                                                                                                                  |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `wrangler.jsonc`、`.dev.vars.example`、`worker-configuration.d.ts` | 変更。`PUBLIC_API_ORIGIN`(G1・G24)                                                                            |
| `src/server.ts`、`src/lib/server-routing.ts`       | 変更。`GET /_config`(G24)                                                                                             |
| `src/lib/api-client.ts`                            | 変更。`getConfig()`、`AppConfig`                                                                                       |
| `src/lib/queries.ts`                               | 変更。`configQueryOptions`、`membersQueryOptions`、`modulesQueryOptions` の `retry: 1`(G22)                            |
| `src/lib/labels.ts`                                | 変更。`SETTINGS_LABELS` / `MEMBER_LABELS` / `MODULE_LABELS` / `ACCOUNT_LABELS`、`NAV_LABELS.accountSettings`、`HOME_LABELS.gettingStarted.inviteMembers` / `separator`、`ROLE_DESCRIPTIONS` |
| `src/lib/error-messages.ts`                        | 変更。`last_owner` / `already_member` / `user_not_found`                                                               |
| `src/lib/datetime.ts`                              | 変更。`formatDate`                                                                                                     |
| `src/lib/breadcrumbs.ts`                           | 変更。`settingsCrumb` の href(G4)、`settingsContentTypesCrumb` はそのまま                                              |
| `src/lib/members.ts`                               | 新規。メンバーの行の判断(自分 / 最後の管理者 / 下げるか / 他の管理者)の純関数                                           |
| `src/lib/public-api.ts`                            | 新規。公開 API の URL の組み立て                                                                                       |
| `src/lib/modules.ts`                               | 新規。モジュールの型ごとの件数と、有効化後のリンク先の純関数                                                           |
| `src/components/settings/settings-frame.tsx`       | 新規。h1「設定」+ タブ + 本文(G5・G25)                                                                                 |
| `src/components/settings/settings-card.tsx`        | 新規。`SettingsCard`(h2 付きの枠。アカウントでも使う)                                                                  |
| `src/components/settings/copy-field.tsx`           | 新規。等幅の URL と「コピー」                                                                                          |
| `src/components/settings/site-name-form.tsx`       | 新規。サイト名の入力と「保存」(G20)                                                                                    |
| `src/components/settings/role-cards.tsx`           | 新規。3 枚のロール説明カード(G10)                                                                                      |
| `src/components/settings/role-select.tsx`          | 新規。ロールの `Select`(テストで差し替えるため 1 ファイル)                                                             |
| `src/components/settings/members-table.tsx`        | 新規。メンバーの表(G9・G26)                                                                                            |
| `src/components/settings/add-member-dialog.tsx`    | 新規。追加ダイアログ(G14)                                                                                              |
| `src/components/settings/member-dialogs.tsx`       | 新規。`RemoveMemberDialog` / `DemoteMemberDialog`(G12・G13・G30)                                                       |
| `src/components/settings/module-card.tsx`          | 新規。モジュールのカード(G15)                                                                                          |
| `src/components/settings/disable-module-dialog.tsx` | 新規。無効化の確認(G3・G16)                                                                                           |
| `src/components/account/password-form.tsx`         | 新規。パスワード変更の 3 入力(G18)                                                                                     |
| `src/components/account/site-list.tsx`             | 新規。所属サイト(G19)                                                                                                  |
| `src/components/theme-segment.tsx`                 | 新規(`theme-select.tsx` を置き換え。G2)                                                                                |
| `src/components/shell/account-menu.tsx`            | 変更。「アカウント設定」(G17)                                                                                          |
| `src/components/shell/sidebar.tsx`                 | 変更。設定の href(G4)、`onOpenAccount`                                                                                 |
| `src/components/home/getting-started.tsx`、`home-card.tsx` | 変更。手順 3(G29)、`SEPARATOR`(G22)                                                                            |
| `src/routes/t/$tenantSlug/route.tsx`               | 変更。`onOpenAccount` の配線                                                                                           |
| `src/routes/t/$tenantSlug/index.tsx`               | 変更。手順 3 の `navigate`                                                                                             |
| `src/routes/t/$tenantSlug/settings/route.tsx`      | 新規。owner 以外の転送(G5)                                                                                             |
| `src/routes/t/$tenantSlug/settings/index.tsx`      | 変更。`/settings/general` へ転送(G4)                                                                                   |
| `src/routes/t/$tenantSlug/settings/general.tsx`    | 新規。一般                                                                                                             |
| `src/routes/t/$tenantSlug/settings/members.tsx`    | 新規。メンバー                                                                                                         |
| `src/routes/t/$tenantSlug/settings/modules/index.tsx` | 書き換え。モジュール                                                                                                |
| `src/routes/t/$tenantSlug/settings/content-types/index.tsx` | 変更。見出し部分だけ `SettingsFrame`(G5)                                                                       |
| `src/routes/t/$tenantSlug/account.tsx`             | 新規。アカウント設定                                                                                                   |
| `src/routes/super/*.tsx`(6 ファイル)               | 変更。「読み込み中…」→ `LOADING_LABEL`(G21)                                                                           |
| `src/routeTree.gen.ts`                             | 再生成                                                                                                                 |
| `src/test-utils/api-stubs.ts`                      | 変更。`/_config` と `/v1/t/t1/members` の既定                                                                           |
| `src/settings-general.test.tsx`、`settings-members-list.test.tsx`、`settings-members-add.test.tsx`、`settings-members-remove.test.tsx`、`settings-members-remove-self.test.tsx`、`settings-members-demote.test.tsx`、`settings-modules.test.tsx`、`settings-modules-disable.test.tsx`、`account-page.test.tsx` | 新規。router テスト |
| `src/modules-page.test.tsx`                        | 削除(`settings-modules.test.tsx` に置き換え)                                                                           |
| `src/shell.test.tsx`、`content-type-builder.test.tsx`、`components/shell/sidebar.test.tsx`、`lib/navigation.test.ts`、`lib/breadcrumbs.test.ts`、`home-flow.test.tsx`、`components/home/getting-started.test.tsx` | 変更。href と見出しの断言 |

`apps/e2e/helpers/setup.ts`(G4)。`docs/admin-ux/{g,h,a,b}-*.md`、`docs/deploy.md`: 裁定の書き戻し。`.design-sync/NOTES.md`: 部品の変更の記録。

## タスクの依存

Task 1(設計書)→ Task 2(持ち越し)→ Task 3(ui の `SegmentedControl`、`/_config`)→ Task 4(文言・純関数・クエリ)→ Task 5(設定の枠と一般)→ Task 6(メンバーの部品)→ Task 7(メンバーのルート)→ Task 8(モジュール)→ Task 9(アカウント)→ Task 10(E2E・検証・preview・報告)。Task 2・3 は Task 4 以降と独立だが、Task 2 の `LOADING_LABEL` と Task 3 の `/_config` を Task 5 が使うため先に置く。Task 8 と Task 9 は Task 7 と独立(Task 5 の枠と Task 4 の文言だけを使う)。

---

### Task 1: 設計書へ V4-G の裁定を書き戻す

**Files:**
- Modify: `docs/admin-ux/g-settings-account.md`(3・4.1・4.2・4.3・4.5・5・6.1・6.2・7・10 章)
- Modify: `docs/admin-ux/h-common-surface.md`(3 章、6 章、14 章)
- Modify: `docs/admin-ux/a-navigation.md`(3.3)
- Modify: `docs/admin-ux/b-home.md`(2.6、7 章)
- Modify: `docs/deploy.md`(環境変数の節)
- Add: `docs/superpowers/plans/2026-10-20-admin-ux-v4g-settings.md`(本計画。実装ブランチの最初のコミットに含める)

- [ ] **Step 1: g-settings-account.md に G1・G3〜G20・G23・G25〜G27・G30 を書く**

各章に「(2026-10-20、V4-G)」付きで 1〜2 文ずつ足し、既存の文は消さない。3 章: G1(URL の出所)、G4(着地先)、G5(枠の実装)、G8(例の URL)、G20(保存の条件)、G23(読み込み中)、G25(タブ)。4.1: G6(件数なし)、G7(最終ログインなし)、G9、G10、G27。4.2: G14。4.3: G30。4.5: G11、G12、G13、G26。5 章: G3(件数の数え方。「推測: 無効化でデータが消えない前提」の括弧書きを「確認済み(`tenant-do.ts` の `setModuleEnabled`、§9.5)」に改める)、G15、G16。6.1: G17。6.2: G2(セグメントを `SegmentedControl` で実装)、G18、G19。7 章: 「設定の URL を owner 以外が開いたときはホームへ転送する(G5)」。10 章 決定ログに 1 行: 「2026-10-20: V4-G の計画で G1〜G30(台帳は `docs/superpowers/plans/2026-10-20-admin-ux-v4g-settings.md`)を確定。D3 との食い違いは設計書を優先した: タブの件数と最終ログインは出さない、モジュールの「増えるもの」の箇条書きは出さない(manifest に無い)、メンバーの本文の幅は 880px、アバターは 24px」

- [ ] **Step 2: h-common-surface.md・a-navigation.md・b-home.md・deploy.md を直す**

h 3 章の V4-B の行の下に「V4-G(2026-10-20): `SegmentedControl`(3 択の pill)を足した(G2)。所属サイトの「切り替える」と有効化直後の「{型名}を追加 ›」も RAC の `Link` を admin から直接使う(G28)」。h 6 章の表の下に「設定・アカウントの取得失敗は中身の位置に `role="alert"` の文と「再試行」(G23)」。h 14 章 決定ログに 1 行。a 3.3「設定」の「案 G の実装までは出さない」を「V4-G(2026-10-20)で 4 タブ(一般 / コンテンツタイプ / メンバー / モジュール)にし、着地先は一般(G4)」に、「アカウントメニュー」の V2 の行の下に「V4-G(2026-10-20)で「アカウント設定」(`/t/:slug/account`)を先頭に足した(G17)」。b 2.6 の B4 の行を「(2026-10-20、V4-G)手順 3「メンバーを招待する」を足した(G29)」に改め、7 章 決定ログに 1 行。deploy.md の環境変数の節に `PUBLIC_API_ORIGIN`(admin の `vars`。preview / production の値と、dev は空文字で同一オリジン)を 1 項目足す。

- [ ] **Step 3: コミット**

```bash
git add docs/admin-ux docs/deploy.md docs/superpowers/plans/2026-10-20-admin-ux-v4g-settings.md
```

```bash
git commit -m "docs: V4-G(設定とアカウント)の計画と裁定を案 G・案 H・案 A・案 B の設計書に書き戻す"
```

---

### Task 2: V4-B からの持ち越し(super の「読み込み中…」、はじめにの手順 3、modules の retry、SEPARATOR)

**Files:**
- Modify: `apps/admin/src/routes/super/index.tsx:140`、`users.tsx:111`、`audit.tsx:39`、`dlq.tsx:83`、`modules.tsx:57`、`tenants.$tenantId.tsx:200`(G21)
- Modify: `apps/admin/src/lib/labels.ts`(`HOME_LABELS.gettingStarted.inviteMembers`、`HOME_LABELS.separator`)
- Modify: `apps/admin/src/components/home/getting-started.tsx`、`apps/admin/src/components/home/getting-started.test.tsx`(G29)
- Modify: `apps/admin/src/routes/t/$tenantSlug/index.tsx`(手順 3 の `navigate`)
- Modify: `apps/admin/src/home-flow.test.tsx`(手順 3 の遷移)
- Modify: `apps/admin/src/components/home/home-card.tsx:16`(G22)
- Modify: `apps/admin/src/lib/queries.ts`(`modulesQueryOptions` に `retry: 1`)

**Interfaces:**
- Produces:

```ts
// labels.ts
HOME_LABELS.gettingStarted.inviteMembers = {
  title: "メンバーを招待する",
  body: "編集を手伝ってくれる人を、設定 › メンバーから追加します。追加できるのは plyrs に登録済みの人です",
  action: "メンバーを追加",
};
HOME_LABELS.separator = " ・ "; // home-card.tsx の SEPARATOR を置き換える
// getting-started.tsx
export function GettingStarted(props: {
  siteName: string;
  onCreateType: () => void;
  onOpenMedia: () => void;
  onInviteMembers: () => void;
}): JSX.Element;
// 手順は { title, body, action, variant, onPress }[] を map で描く(1 は primary、2・3 は secondary)
```

- [ ] **Step 1: 失敗するテストを書く**

```ts
// getting-started.test.tsx(既存の「2 つの手順」を書き換える)
it("3 つの手順と行き先のボタンを出し、押すとコールバックを呼ぶ", async () => {
  // listitem が 3 つ。button「メンバーを追加」→ onInviteMembers が 1 回
});
// home-flow.test.tsx の「型 0 件の管理者には「はじめに」が出て…」に 1 断言を足す
//   button「メンバーを追加」を click → pathname が /t/blog/settings/members(Task 5 までは Not Found になるが、
//   pathname の断言だけなら通る。通らなければ Task 7 まで it.skip にし、Task 7 で戻す)
```

- [ ] **Step 2: テストが失敗することを確かめる**

Run: `corepack pnpm --filter @plyrs/admin exec vitest run src/components/home/getting-started.test.tsx src/home-flow.test.tsx`
Expected: FAIL(listitem が 2 つ、ボタンが無い)

- [ ] **Step 3: 実装する**

super の 6 か所は `<p …>{LOADING_LABEL}</p>`(import を足す)。`home-card.tsx` の `SEPARATOR` 定数を消して `HOME_LABELS.separator` を参照する。`modulesQueryOptions` に `retry: 1` とコメント「取得の失敗で最大 7 秒ほどホームがスケルトンのままにならないよう 1 回だけ(V4-B の申し送り)」。

- [ ] **Step 4: テストが通ることを確かめる**

Run: `corepack pnpm --filter @plyrs/admin exec vitest run && corepack pnpm -r typecheck && corepack pnpm format && corepack pnpm lint`
Expected: PASS。`grep -rn "読み込み中…" apps/admin/src/routes/super` が 0 件(`settings/modules/index.tsx` の 1 件は Task 8 で消える)

- [ ] **Step 5: コミット**

```bash
git add apps/admin/src
```

```bash
git commit -m "fix(admin): V4-B の持ち越し(読み込み中の文言、はじめにの手順 3、modules の retry)を片付ける"
```

---

### Task 3: ui の `SegmentedControl` と、公開 API のオリジンを返す `/_config`

**Files:**
- Create: `packages/ui/src/segmented-control.tsx`、`packages/ui/src/segmented-control.test.tsx`
- Modify: `packages/ui/src/index.ts`
- Modify: `apps/admin/wrangler.jsonc`、`apps/admin/.dev.vars.example`、`apps/admin/worker-configuration.d.ts`(`cf-typegen` で再生成)
- Modify: `apps/admin/src/lib/server-routing.ts`、`apps/admin/src/lib/server-routing.test.ts`、`apps/admin/src/server.ts`
- Modify: `apps/admin/src/lib/api-client.ts`、`apps/admin/src/lib/api-client.test.ts`
- Modify: `apps/admin/src/lib/queries.ts`
- Modify: `apps/admin/src/test-utils/api-stubs.ts`(`/_config` の既定)
- Modify: `.design-sync/NOTES.md`

**Interfaces:**
- Produces:

```ts
// packages/ui/src/segmented-control.tsx(G2。D3 G6: 外枠 pill・内側のボタン pill、選択は accent.surface / accent.default)
export interface SegmentedItem { value: string; label: string; icon?: LucideIcon }
export interface SegmentedControlProps {
  label: string;                 // RadioGroup の aria-label
  items: SegmentedItem[];
  value: string;
  onChange: (value: string) => void;
  isDisabled?: boolean;
}
export function SegmentedControl(props: SegmentedControlProps): JSX.Element;
// RAC RadioGroup(orientation horizontal)+ Radio。外枠: 高さ size.control、padding 3px、枠 stroke.default border.default、
// 角 radius.full、地 bg.canvas。各 Radio: 高さ size.controlSm、paddingInline space.inset、font.body font.weightMedium、
// text.muted、選択で bg accent.surface / color accent.default、focus-visible は focus.ring の outline。アイコンは ICON_SIZE.inline

// apps/admin/src/lib/server-routing.ts
export type ServerRoute = "api" | "shell" | "ssr" | "config"; // pathname === "/_config" のとき "config"(isApiPath より前に判定)
// apps/admin/src/server.ts
//   route === "config" → Response.json({ publicApiOrigin: env.PUBLIC_API_ORIGIN }, { headers: { "cache-control": "no-store" } })
// apps/admin/wrangler.jsonc: 3 か所の vars に PUBLIC_API_ORIGIN(トップレベル ""、preview "https://plyrs-api-preview.hiz.workers.dev"、
//   production "https://plyrs-api.hiz.workers.dev")。.dev.vars.example に `PUBLIC_API_ORIGIN=`(空 = 同一オリジン。DEV_PROXY_PUBLIC の転送先)

// apps/admin/src/lib/api-client.ts
export interface AppConfig { publicApiOrigin: string }
// createApiClient に getConfig(): Promise<AppConfig>(GET /_config)
// apps/admin/src/lib/queries.ts
export function configQueryOptions(api: ApiClient): …; // queryKey ["config"]、staleTime Infinity(デプロイ単位で固定)

// api-stubs.ts の baseAuthedRoutes に "/_config": vi.fn(() => jsonResponse(200, { publicApiOrigin: "" }))
```

- [ ] **Step 1: 失敗するテストを書く**

```ts
// packages/ui/src/segmented-control.test.tsx
it("radiogroup として描き、選ぶと onChange に値を渡す", async () => {
  // getByRole("radiogroup", { name: "テーマ" })、radio が 3 つ、「ダーク」を click → onChange("dark")、checked
});
it("isDisabled なら選べない", async () => {});
// apps/admin/src/lib/server-routing.test.ts
it("routes GET /_config to config before the api prefixes", () => {
  expect(resolveServerRoute(new Request("https://admin.example/_config"), { devProxyPublic: false })).toBe("config");
});
// apps/admin/src/lib/api-client.test.ts
it("getConfig は /_config を読む", async () => { /* fetch スタブで { publicApiOrigin: "https://api.example" } */ });
```

- [ ] **Step 2: テストが失敗することを確かめる**

Run: `corepack pnpm --filter @plyrs/ui exec vitest run src/segmented-control.test.tsx && corepack pnpm --filter @plyrs/admin exec vitest run src/lib/server-routing.test.ts src/lib/api-client.test.ts`
Expected: FAIL(部品・関数が無い)

- [ ] **Step 3: 実装する**

`worker-configuration.d.ts` は `corepack pnpm --filter @plyrs/admin cf-typegen` で再生成する(手書きしない。サンドボックスで落ちたらコントローラに報告)。

- [ ] **Step 4: テストが通ることを確かめる**

Run: `corepack pnpm --filter @plyrs/ui exec vitest run && corepack pnpm --filter @plyrs/admin exec vitest run && corepack pnpm -r typecheck && corepack pnpm format && corepack pnpm lint`
Expected: PASS。`grep -n PUBLIC_API_ORIGIN apps/admin/wrangler.jsonc` が 3 件

- [ ] **Step 5: `.design-sync/NOTES.md` の「V4 で変えた部品」に `SegmentedControl` を足してコミット**

```bash
git add packages/ui/src apps/admin .design-sync/NOTES.md
```

```bash
git commit -m "feat(admin): SegmentedControl を足し、公開 API のオリジンを /_config で返す"
```

---

### Task 4: 文言、純関数(メンバー・公開 API・モジュール)、クエリ、日付の書式

**Files:**
- Modify: `apps/admin/src/lib/labels.ts`
- Modify: `apps/admin/src/lib/error-messages.ts`、`apps/admin/src/lib/error-messages.test.ts`
- Modify: `apps/admin/src/lib/datetime.ts`、`apps/admin/src/lib/datetime.test.ts`
- Modify: `apps/admin/src/lib/breadcrumbs.ts`、`apps/admin/src/lib/breadcrumbs.test.ts`(G4)
- Modify: `apps/admin/src/lib/queries.ts`(`membersQueryOptions`)
- Create: `apps/admin/src/lib/members.ts`、`apps/admin/src/lib/members.test.ts`
- Create: `apps/admin/src/lib/public-api.ts`、`apps/admin/src/lib/public-api.test.ts`
- Create: `apps/admin/src/lib/modules.ts`、`apps/admin/src/lib/modules.test.ts`
- Modify: `apps/admin/src/test-utils/api-stubs.ts`(`/v1/t/t1/members` の既定: 自分 1 人の owner)

**Interfaces:**
- Consumes: `MemberSummary` / `ModuleSummary`(`admin-api.ts`)、`Role` / `isRole`(`permissions.ts`)、`SyncRecord`、`NavType`
- Produces:

```ts
// labels.ts
NAV_LABELS.accountSettings = "アカウント設定";
export const ROLE_DESCRIPTIONS: Record<Role, string> = { owner: "すべての操作に加えて、設定(コンテンツタイプ・メンバー・モジュール)を変更できます", editor: "コンテンツとメディアの作成・編集・公開ができます。設定は変更できません", viewer: "コンテンツとメディアを見るだけです。作成・編集・公開はできません" }; // G10
export const SETTINGS_LABELS = {
  title: "設定",
  tabsName: "設定の項目",
  tabs: { general: "一般", "content-types": TERMS.contentType, members: "メンバー", modules: TERMS.module },
  loadFailed: "設定を読み込めませんでした", retry: "再試行",
  site: { title: "サイト", name: "サイト名", nameHelp: "サイドバーとサイト選択に表示します", nameRequired: "サイト名を入力してください", nameTooLong: "サイト名は 100 文字以内で入力してください",
          slug: "サイトの識別子", slugHelp: "公開 API の URL に含まれるため変更できません。公開済みのページに埋め込まれた URL が壊れるのを防ぐためです", save: "保存", saved: "保存しました", saveFailed: "保存できませんでした" },
  publicApi: { title: "公開 API", description: "サイトを作るフロントエンドの開発者に伝える URL です。公開したコンテンツだけが返ります", baseUrl: "ベース URL", example: (type: string) => `例: ${type}の一覧`, exampleHelp: "型の API 名は設定 › コンテンツタイプで確認できます", copy: "コピー", copied: "コピーしました", copyFailed: "コピーできませんでした" },
} as const;
export const MEMBER_LABELS = {
  add: "メンバーを追加", tableLabel: "メンバーの一覧",
  columns: { email: "メールアドレス", role: "ロール", joined: "参加日", actions: "操作" },
  self: "自分", lastOwner: "最後の管理者",
  lastOwnerReason: "このサイトを管理できる人がいなくなるため、ロールの変更と削除はできません。先に別のメンバーを管理者にしてください",
  remove: "外す", loadFailed: "メンバー一覧を取得できませんでした",
  addDialog: { title: "メンバーを追加", email: "メールアドレス", emailHelp: "plyrs に登録済みの人を追加できます", role: "ロール", submit: "追加する",
               unregistered: "このメールアドレスのユーザーは登録されていません。先にサインアップを依頼してください。", copyUrl: "URL をコピー",
               unregisteredHint: "サインアップが済んだら、同じメールアドレスでもう一度追加してください", alreadyMember: "このメールアドレスは既にメンバーです", failed: "メンバーを追加できませんでした" },
  added: (email: string) => `${email} を追加しました`,
  roleChanged: (email: string, role: string) => `${email} を${role}にしました`, roleChangeFailed: "ロールを変更できませんでした",
  demote: { title: (email: string, role: string) => `${email} を${role}にしますか？`, toViewer: "コンテンツの作成・編集・公開ができなくなります。", toEditor: "設定(コンテンツタイプ・メンバー・モジュール)を変更できなくなります。",
            delay: "反映まで最大 15 分かかります。すぐに止めたい場合は、いったんメンバーから外してください", confirm: (role: string) => `${role}にする` },
  removeDialog: { title: (email: string) => `${email} をメンバーから外しますか？`, body: "すぐにアクセスできなくなります。作成・編集したコンテンツは残ります。", confirm: "外す",
                  selfTitle: "自分をこのサイトから外しますか？", selfBody: (email: string, site: string) => `${email} は「${site}」にアクセスできなくなります。作成・編集したコンテンツは残ります。`, selfConfirm: "自分を外す" },
  lockout: (owners: string) => `この操作のあと、設定を開けなくなります。戻すには他の管理者(${owners})に追加してもらう必要があります`,
  removed: (email: string) => `${email} をメンバーから外しました`, removeFailed: "メンバーを外せませんでした",
} as const;
export const MODULE_LABELS = {
  description: "モジュールを有効にすると、サイドバーに専用の項目と、それ用のコンテンツタイプが増えます",
  enabled: "有効", disabled: "無効", enable: "有効にする", disable: "無効にする", loadFailed: "モジュール一覧を取得できませんでした",
  justEnabled: "有効にしました。", addType: (type: string) => `${type}を追加`,
  enabledToast: (name: string) => `${name}を有効にしました`, disabledToast: (name: string) => `${name}を無効にしました`,
  enableFailed: "モジュールを有効にできませんでした", disableFailed: "モジュールを無効にできませんでした",
  disableDialog: { title: (name: string) => `${name}モジュールを無効にしますか？`, body: (name: string) => `サイドバーから「${name}」が消え、公開サイトのこのモジュールの API は応答しなくなります。`,
                   keep: (counts: string) => `モジュールのコンテンツ(${counts})は削除されません。再び有効化すると元に戻ります`, keepUnknown: "モジュールのコンテンツは削除されません。再び有効化すると元に戻ります" },
  count: (name: string, n: number) => `${name} ${n} 件`, countJoin: "、",
} as const;
export const ACCOUNT_LABELS = {
  title: "アカウント設定",
  email: { title: "メールアドレス", help: "ログインに使うメールアドレスです。変更は確認メールが必要になるため、現在は変更できません", loadFailed: "メールアドレスを取得できませんでした" },
  password: { title: "パスワードの変更", current: "現在のパスワード", next: "新しいパスワード", nextHelp: "12 文字以上", confirm: "新しいパスワード(確認)",
              note: "変更すると、他の端末のセッションはすべてログアウトされます", submit: "パスワードを変更", tooShort: "12 文字以上で入力してください", mismatch: "新しいパスワードが一致しません",
              changed: "パスワードを変更しました", changedWithRevoked: (n: number) => `パスワードを変更しました。他の端末 ${n} 件をログアウトしました`, failed: "パスワードを変更できませんでした" },
  theme: { title: "テーマ", label: "テーマ", system: "自動", light: "ライト", dark: "ダーク", help: "「自動」は OS の設定に従います。選択はこのブラウザに記憶され、他の端末には引き継がれません" },
  sites: { title: "所属しているサイト", current: "現在のサイト", switch: "切り替える", loadFailed: "所属しているサイトを取得できませんでした" },
  retry: "再試行",
} as const;

// error-messages.ts に足す(G14・Review Focus 2)
last_owner: "最後の管理者のため、ロールの変更と削除はできません。先に別のメンバーを管理者にしてください",
already_member: "このメールアドレスは既にメンバーです",
user_not_found: "このメールアドレスのユーザーは登録されていません。先にサインアップを依頼してください",

// datetime.ts
export function formatDate(date: Date, timeZone?: string): string; // ja-JP の year numeric / month 2-digit / day 2-digit → "2026/07/16"

// breadcrumbs.ts: settingsCrumb(slug).href を `/t/${slug}/settings/general` に(G4)。settingsContentTypesCrumb はそのまま

// queries.ts
export function membersQueryOptions(adminApi: AdminApi, tenantId: string): …; // queryKey ["members", tenantId]、staleTime 0、retry 1

// lib/members.ts(G11〜G13・G26・G30)
export const ROLE_RANK: Record<Role, number> = { viewer: 0, editor: 1, owner: 2 };
export function isDowngrade(from: string, to: string): boolean; // 両方が Role で rank が下がるとき true。未知のロールは false
export function lastOwnerId(members: readonly MemberSummary[]): string | null; // owner がちょうど 1 人ならその userId
export function otherOwnerEmails(members: readonly MemberSummary[], selfId: string | undefined): string[]; // 自分以外の owner のメール(参加日順)
export interface MemberRow { member: MemberSummary; isSelf: boolean; isLastOwner: boolean }
export function memberRows(members: readonly MemberSummary[], selfId: string | undefined): MemberRow[]; // API の順(参加日の古い順)のまま
export function demoteBody(to: Role): string; // viewer → MEMBER_LABELS.demote.toViewer、editor → toEditor、owner → ""

// lib/public-api.ts(G1・G8)
export function publicApiBase(origin: string, slug: string): string; // `${origin}/public/v1/${slug}/`(origin は末尾の / を落とす)
export function publicRecordsUrl(origin: string, slug: string, typeKey: string): string; // `${publicApiBase}records/${typeKey}`
export function resolvePublicOrigin(configured: string, locationOrigin: string): string; // configured が "" なら locationOrigin

// lib/modules.ts(G3・G15)
export interface TypeCount { key: string; name: string; count: number }
export function moduleContentCounts(records: readonly SyncRecord[], navTypes: readonly string[], types: readonly NavType[]): TypeCount[];
// navTypes の順。deletedAt === null だけ数える。型名は types から引き、無い key は key をそのまま名前にする
export function formatCounts(counts: readonly TypeCount[]): string; // "予約 3 件、予約枠 2 件"(MODULE_LABELS.count / countJoin)
export function moduleAddLinks(navTypes: readonly string[], types: readonly NavType[], slug: string): { key: string; label: string; href: string }[];
// 同期で届いている型だけ。label は MODULE_LABELS.addType(型名)、href は `/t/${slug}/content/${key}/new`
```

- [ ] **Step 1: 失敗するテストを書く**

```ts
// members.test.ts
it("isDowngrade は rank が下がるときだけ true", () => { /* owner→editor true、editor→owner false、editor→editor false、"x"→viewer false */ });
it("lastOwnerId は owner が 1 人のときだけその userId", () => { /* 2 人なら null、0 人なら null */ });
it("otherOwnerEmails は自分以外の owner を参加日順に返す", () => {});
it("memberRows は自分と最後の管理者の印を付ける", () => { /* selfId 未指定なら isSelf は全部 false */ });
// public-api.test.ts
it("publicApiBase と publicRecordsUrl は末尾の / を重ねない", () => {
  expect(publicApiBase("https://api.example/", "shop")).toBe("https://api.example/public/v1/shop/");
  expect(publicRecordsUrl("https://api.example", "shop", "news")).toBe("https://api.example/public/v1/shop/records/news");
  expect(resolvePublicOrigin("", "http://localhost:5173")).toBe("http://localhost:5173");
});
// modules.test.ts
it("moduleContentCounts は navTypes の順に削除済みを除いて数える", () => {});
it("formatCounts は「予約 3 件、予約枠 2 件」", () => {});
it("moduleAddLinks は同期で届いている型だけ", () => {});
// datetime.test.ts
it("formatDate は日付だけを 2026/07/16 の形で返す", () => { expect(formatDate(new Date("2026-07-16T03:00:00Z"), "Asia/Tokyo")).toBe("2026/07/16"); });
// error-messages.test.ts: last_owner / already_member の文があること
// breadcrumbs.test.ts: settingsCrumb の href を /t/blog/settings/general に
```

- [ ] **Step 2: テストが失敗することを確かめる**

Run: `corepack pnpm --filter @plyrs/admin exec vitest run src/lib`
Expected: FAIL(新しいモジュールが無い、`settingsCrumb` の href が旧)

- [ ] **Step 3: 実装する**

- [ ] **Step 4: テストが通ることを確かめる**

Run: `corepack pnpm --filter @plyrs/admin exec vitest run && corepack pnpm -r typecheck && corepack pnpm format`
Expected: PASS(`sidebar.test.tsx` / `navigation.test.ts` / `shell.test.tsx` の `/settings/content-types` の断言は Task 5 で直すため、ここではまだ旧 href のまま通る)

- [ ] **Step 5: コミット**

```bash
git add apps/admin/src
```

```bash
git commit -m "feat(admin): 設定・メンバー・モジュール・アカウントの文言と純関数、メンバー一覧のクエリを足す"
```

---

### Task 5: 設定の枠(4 タブ・guard・転送・サイドバー)と「一般」

**Files:**
- Create: `apps/admin/src/components/settings/settings-frame.tsx`、`settings-card.tsx`、`copy-field.tsx`、`site-name-form.tsx`
- Test: `apps/admin/src/components/settings/copy-field.test.tsx`、`site-name-form.test.tsx`
- Create: `apps/admin/src/routes/t/$tenantSlug/settings/route.tsx`、`apps/admin/src/routes/t/$tenantSlug/settings/general.tsx`
- Modify: `apps/admin/src/routes/t/$tenantSlug/settings/index.tsx`(`/settings/general` へ)
- Modify: `apps/admin/src/routes/t/$tenantSlug/settings/content-types/index.tsx:45-70`(見出し部分だけ `SettingsFrame`)
- Modify: `apps/admin/src/components/shell/sidebar.tsx:168-171`(`settingsEntry.href` を `${base}/settings/general`)
- Modify: `apps/admin/src/routeTree.gen.ts`(再生成)
- Create: `apps/admin/src/settings-general.test.tsx`
- Modify: `apps/admin/src/shell.test.tsx`(`/t/blog/settings` → `/settings/general`、h1「コンテンツタイプ」→ h1「設定」+ tab)、`content-type-builder.test.tsx:126`、`components/shell/sidebar.test.tsx:73-76`、`lib/navigation.test.ts:78`

**Interfaces:**
- Consumes: Task 3 の `configQueryOptions`、Task 4 の `SETTINGS_LABELS` / `publicApiBase` / `publicRecordsUrl` / `resolvePublicOrigin` / `settingsCrumb`、`sidebarContentTypes`、`useSyncTypes` / `useTenantSync`、`TenantPageHeader` / `PageBody`、`Tabs` / `Button` / `TextField` / `Skeleton` / `toaster`、`renameSite`、`tenantsQueryOptions`
- Produces:

```ts
// settings-frame.tsx(G5・G23・G25)
export type SettingsTab = "general" | "content-types" | "members" | "modules";
export function SettingsFrame(props: {
  tab: SettingsTab;
  slug: string;
  primaryAction?: ReactNode;   // h1 の右(メンバーの「メンバーを追加」、コンテンツタイプの「コンテンツタイプを追加」)
  isLoading?: boolean;         // true なら children の代わりに Skeleton 3 行(aria-hidden)、入れ物に aria-busy
  error?: { message: string; onRetry: () => void }; // あれば children の代わりに role="alert" の文と「再試行」
  children: ReactNode;
}): JSX.Element;
// TenantPageHeader(title SETTINGS_LABELS.title、breadcrumbs [homeCrumb, settingsCrumb, currentCrumb(tabs[tab])]、primaryAction)
// + PageBody の中に <Tabs label={tabsName} items={4 タブ} selectedKey={tab} onSelectionChange={(id) => navigate(`/t/${slug}/settings/${id}`)}>
//   {(id) => (id === tab ? 本文 : null)}</Tabs>。本文は maxWidth SETTINGS_MAX_WIDTH(880px)、flex column gap space.lg
export const SETTINGS_MAX_WIDTH = "880px";

// settings-card.tsx
export function SettingsCard(props: { title: string; description?: string; children: ReactNode; footer?: ReactNode }): JSX.Element;
// <section aria-labelledby={h2}>。地 bg.surface、枠 stroke.default border.default、角 radius.container、padding space.lg、
// 中は flex column gap space.md。footer は右寄せ(保存ボタンなど)

// copy-field.tsx
export function CopyField(props: { label: string; value: string; help?: string }): JSX.Element;
// <span> のラベル + <code>(font.mono があればそれ、無ければ "ui-monospace, monospace"。font.caption、枠 border.default、角 radius.item、1 行省略)
// + Button variant="secondary" size="sm" icon={Copy}「コピー」(aria-label は `${label}をコピー`)。
// navigator.clipboard?.writeText(value) → toaster.success(copied) / 失敗・未対応 → toaster.error(copyFailed)

// site-name-form.tsx(G20)
export function SiteNameForm(props: { name: string; slug: string; onSave: (name: string) => Promise<void>; isPending: boolean }): JSX.Element;
// 2 列グリッド(NARROW で 1 列): TextField(サイト名、description nameHelp、errorMessage は空 / 100 字超のとき)と、識別子(FieldLabel 相当の <span> + 等幅の値 + slugHelp)。
// 「保存」(primary)は trim 後が元の name と同じ、空、100 字超のいずれかで isDisabled。submit で onSave(trim 後)
```

`general.tsx`(`/t/$tenantSlug/settings/general`): `config = useQuery(configQueryOptions(api))`、`types = useSyncTypes(useTenantSync())`、`rename = useMutation(adminApi.renameSite)` → 成功で `queryClient.invalidateQueries({ queryKey: ["tenants"] })` + `toaster.success(saved)`、失敗で `toaster.error(errorMessage(e, saveFailed))`。本文: `SettingsCard(site)` に `SiteNameForm`、`SettingsCard(publicApi, description)` に `CopyField(baseUrl)` と、`sidebarContentTypes(types)[0]` があれば `CopyField(example(型名), publicRecordsUrl, exampleHelp)`(G8)。`config` が pending なら公開 API のカードの中だけ Skeleton、`isLoadingError` ならカードの中に alert + 再試行。origin は `resolvePublicOrigin(config.data.publicApiOrigin, window.location.origin)`。

`settings/route.tsx`: `beforeLoad: ({ context, params }) => { if (!can(context.tenant.role, "site:manage")) throw redirect({ to: "/t/$tenantSlug", params }); }`、`component` は `Outlet` だけ。`settings/index.tsx` の転送先を `/t/$tenantSlug/settings/general` に。`content-types/index.tsx` は `TenantPageHeader` + `PageBody` を `<SettingsFrame tab="content-types" slug={tenantSlug} primaryAction={既存の Button}>{既存の table / 0 件の p}</SettingsFrame>` に替えるだけ(import の整理以外は触らない)。

- [ ] **Step 1: 失敗するテストを書く**

```ts
// copy-field.test.tsx
it("コピーを押すと clipboard に書いてトーストを出す", async () => { /* defineProperty で writeText を差し替え、通知 region に「コピーしました」 */ });
it("clipboard が無ければエラーのトースト", async () => {});
// site-name-form.test.tsx
it("保存は名前を変えるまで無効で、空と 100 字超は理由を出す", async () => {});
it("保存すると trim した名前で onSave を呼ぶ", async () => {});
// settings-general.test.tsx(shell-harness の renderAt。モーダル無し)
it("/settings は一般へ転送し、h1「設定」とタブ 4 つが出て、一般が選ばれている", async () => {
  // renderAt("/t/blog/settings") → pathname /t/blog/settings/general、heading level 1「設定」、tab 4 つ、tab「一般」が aria-selected
});
it("サイト名を保存すると PATCH /v1/t/t1/site を呼び、tenants を取り直してトーストを出す", async () => {});
it("公開 API のベース URL は /_config のオリジンと slug から作り、型があれば例の行も出す", async () => {
  // /_config が { publicApiOrigin: "https://api.example" } → code に https://api.example/public/v1/blog/、
  // content-types(記事)が届いているので「例: 記事の一覧」の行に …/records/article(shell-harness の authedRoutes は記事 1 件。同期の型は
  // connect で bootstrapped を流すか、records-harness の renderAt に替える。どちらでもよい)
});
it("編集者が /settings/general を開くとホームへ転送される", async () => { /* authedRoutes(…, "editor") → pathname /t/blog */ });
it("タブを押すと URL が変わる", async () => { /* tab「モジュール」click → /t/blog/settings/modules(Task 8 までは暫定画面のまま) */ });
```

`shell.test.tsx`: 337 行の `["/t/blog/settings", "/t/blog/settings/content-types"]` を `/settings/general` に。268 行付近の h1「コンテンツタイプ」の断言は `heading level 1「設定」` + `tab「コンテンツタイプ」aria-selected` に。`content-type-builder.test.tsx:126` も同じ。`sidebar.test.tsx:73-76` と `navigation.test.ts:78` の href を `/settings/general` に。

- [ ] **Step 2: テストが失敗することを確かめる**

Run: `corepack pnpm --filter @plyrs/admin exec vitest run src/components/settings src/settings-general.test.tsx`
Expected: FAIL(部品・ルートが無い)

- [ ] **Step 3: 実装する**

ルートファイルを作った時点で `routeTree.gen.ts` の再生成が要る(Global Constraints の手順。先にサンドボックス内で `corepack pnpm --filter @plyrs/admin build` を試し、EROFS ならコントローラに依頼)。

- [ ] **Step 4: テストが通ることを確かめる**

Run: `corepack pnpm --filter @plyrs/admin exec vitest run && corepack pnpm -r typecheck && corepack pnpm format && corepack pnpm lint`
Expected: PASS。`grep -rn "settings/content-types\"" apps/admin/src/components/shell/sidebar.tsx apps/admin/src/lib/breadcrumbs.ts` が `settingsContentTypesCrumb` の 1 件だけ

- [ ] **Step 5: コミット**

```bash
git add apps/admin/src
```

```bash
git commit -m "feat(admin): 設定を 4 タブの枠にし、一般(サイト名・識別子・公開 API の URL)を作る"
```

---

### Task 6: メンバーの部品(ロール説明カード、表、ロールの選択、追加ダイアログ、確認ダイアログ)

**Files:**
- Create: `apps/admin/src/components/settings/role-cards.tsx`、`role-select.tsx`、`members-table.tsx`、`add-member-dialog.tsx`、`member-dialogs.tsx`
- Test: `apps/admin/src/components/settings/role-cards.test.tsx`、`members-table.test.tsx`、`add-member-dialog.test.tsx`、`member-dialogs.test.tsx`

**Interfaces:**
- Consumes: Task 4 の `MEMBER_LABELS` / `ROLE_DESCRIPTIONS` / `MemberRow` / `isDowngrade` / `demoteBody`、`ROLE_LABELS` / `roleLabel` / `ROLES`、`formatDate`、`Avatar` / `Badge` / `Button` / `Select` / `Table` 系 / `TextField` / `ModalDialog` / `ConfirmDialog` / `Banner` / `Skeleton`
- Produces:

```ts
// role-cards.tsx(G10)
export function RoleCards(): JSX.Element; // 3 列グリッド(NARROW 1 列)。各カード: <b> ロール名(font.body)+ 説明(font.caption text.muted)。地 bg.surface、角 radius.container、padding space.inset

// role-select.tsx(G9。router テストで vi.mock する境界)
export function RoleSelect(props: { label: string; value: Role; onChange: (role: Role) => void; isDisabled?: boolean; size?: "md" | "sm" }): JSX.Element;
// items は ROLES の順(管理者 / 編集者 / 閲覧者)。Select の value は Role 文字列。onChange は isRole で絞ってから呼ぶ

// members-table.tsx(G7・G9・G11・G26)
export function MembersTable(props: {
  rows: readonly MemberRow[];
  onChangeRole: (member: MemberSummary, role: Role) => void;
  onRemove: (member: MemberSummary) => void;
  isBusy?: boolean; // 変更中は行の操作を isDisabled
}): JSX.Element;
// Table(aria-label tableLabel、selectionMode none)。列: メールアドレス(Avatar sm + email + isSelf なら Badge tone="accent"「自分」)/
// ロール(isLastOwner → Button variant="link" size="sm" disabledReason={lastOwnerReason}「最後の管理者」、それ以外 RoleSelect size="sm" aria-label `${email}のロール`)/
// 参加日(formatDate、hideOnNarrow、text.muted)/ 操作(isLastOwner → 空、それ以外 Button variant="dangerLink" size="sm"「外す」aria-label `${email}を外す`)
export function MembersTableSkeleton(): JSX.Element; // aria-hidden の Skeleton 行 3 つ

// add-member-dialog.tsx(G14)
export type AddMemberFailure = { kind: "unregistered" } | { kind: "already_member" } | { kind: "other"; message: string } | null;
export function AddMemberDialog(props: {
  isOpen: boolean; onOpenChange: (open: boolean) => void;
  onSubmit: (email: string, role: Role) => void; isPending: boolean;
  failure: AddMemberFailure; signupUrl: string;
}): JSX.Element;
// ModalDialog(title addDialog.title)。TextField(type email、label addDialog.email、description emailHelp、errorMessage は already_member のとき alreadyMember)。
// unregistered のとき入力欄の下に <div role="alert">(地 status.dangerSurface 相当のトークン、CircleAlert + unregistered 文 + CopyField 風の <code>{signupUrl}</code> + Button secondary sm「URL をコピー」+ unregisteredHint)。
// RoleSelect(label addDialog.role、既定 editor)+ その下に ROLE_DESCRIPTIONS[role](font.caption)。other のとき footer の上に role="alert" の message。
// footer: Button secondary「キャンセル」/ Button primary「追加する」(email が空なら isDisabled、isPending)。開くたびに入力を初期化する(key で作り直す)

// member-dialogs.tsx(G12・G13・G30)
export function DemoteMemberDialog(props: {
  target: { email: string; to: Role; isSelf: boolean } | null; // null で閉じる
  otherOwners: string[];
  onConfirm: () => void; onCancel: () => void; isPending: boolean;
}): JSX.Element;
// ConfirmDialog tone="primary"、title demote.title(email, roleLabel(to))、children: <p>demoteBody(to)</p> + Banner tone="warning"(Clock)demote.delay
//   + isSelf なら Banner tone="warning"(TriangleAlert)lockout(otherOwners.join("、"))。confirmLabel demote.confirm(roleLabel(to))
export function RemoveMemberDialog(props: {
  target: { email: string; isSelf: boolean } | null; siteName: string; otherOwners: string[];
  onConfirm: () => void; onCancel: () => void; isPending: boolean;
}): JSX.Element;
// ConfirmDialog tone="danger"。isSelf: title selfTitle、children selfBody(email, siteName) + Banner warning lockout、confirmLabel selfConfirm。
// それ以外: title removeDialog.title(email)、children body、confirmLabel confirm
```

- [ ] **Step 1: 失敗するテストを書く**

```ts
// role-cards.test.tsx
it("3 つのロールの説明を出す", () => {});
// members-table.test.tsx(直接描画。Select の Popover は直接描画なら開ける)
it("自分の行に「自分」の印、最後の管理者の行は操作の代わりに「最後の管理者」と理由", async () => {
  // disabledReason の Button にフォーカス → tooltip に lastOwnerReason。「外す」が無い。RoleSelect が無い
});
it("ロールを選ぶと onChangeRole に Role を渡し、「外す」で onRemove", async () => {
  // button { name: "editor@example.com のロール" } を click → option「閲覧者」→ onChangeRole(member, "viewer")
});
// add-member-dialog.test.tsx
it("メールとロールを入れて追加するを押すと onSubmit を呼ぶ", async () => {});
it("未登録の案内はサインアップ URL とコピーを出し、already_member は入力欄の下の文", async () => {});
it("ロールを変えると説明が入れ替わる", async () => {});
// member-dialogs.test.tsx(ファイル内でモーダルを 2 回開かないよう、各 it は target を 1 つだけ渡して描く)
it("ロールを下げる確認は反映の遅れを案内し、自分なら設定を開けなくなる注記も出す", () => {});
it("外す確認は自分なら危険色の「自分を外す」と他の管理者のメールを出す", () => {});
```

- [ ] **Step 2: テストが失敗することを確かめる**

Run: `corepack pnpm --filter @plyrs/admin exec vitest run src/components/settings`
Expected: FAIL(部品が無い)

- [ ] **Step 3: 実装する**

- [ ] **Step 4: テストが通ることを確かめる**

Run: `corepack pnpm --filter @plyrs/admin exec vitest run src/components/settings && corepack pnpm -r typecheck && corepack pnpm format`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add apps/admin/src/components/settings
```

```bash
git commit -m "feat(admin): メンバーの表・追加ダイアログ・ロール変更と外す確認の部品を作る"
```

---

### Task 7: メンバーのルート(一覧・追加・ロール変更・外す・自分を外す)

**Files:**
- Create: `apps/admin/src/routes/t/$tenantSlug/settings/members.tsx`
- Modify: `apps/admin/src/routeTree.gen.ts`(再生成)
- Create: `apps/admin/src/settings-members-list.test.tsx`、`settings-members-add.test.tsx`、`settings-members-remove.test.tsx`、`settings-members-remove-self.test.tsx`、`settings-members-demote.test.tsx`
- Modify: `apps/admin/src/home-flow.test.tsx`(Task 2 で skip していれば戻す)

**Interfaces:**
- Consumes: Task 5 の `SettingsFrame`、Task 6 の部品、Task 4 の `membersQueryOptions` / `memberRows` / `lastOwnerId` / `otherOwnerEmails` / `isDowngrade`、`meQueryOptions`、`addMember` / `changeMemberRole` / `removeMember`、`errorMessage`、`toaster`
- Produces: `/t/$tenantSlug/settings/members`(`component: MembersPage`)

`MembersPage` の配線:

- `members = useQuery(membersQueryOptions(adminApi, tenant.id))`、`me = useQuery(meQueryOptions(api))`、`rows = memberRows(members.data ?? [], me.data?.userId)`、`otherOwners = otherOwnerEmails(members.data ?? [], me.data?.userId)`
- `SettingsFrame tab="members" primaryAction={Button icon={Plus}「メンバーを追加」}`、`isLoading={members.isPending}`、`error={members.isLoadingError ? { message: errorMessage(members.error, loadFailed), onRetry: refetch } : undefined}`。本文: `RoleCards` → `MembersTable`
- 追加: `useMutation(addMember)`。成功で invalidate `["members", tenant.id]`、ダイアログを閉じ `toaster.success(added(email))`。失敗は `ApiError` の code で `failure` を決める(`user_not_found` → unregistered、`already_member` → already_member、他 → `{ kind: "other", message: errorMessage(e, addDialog.failed) }`)。`signupUrl = `${window.location.origin}/signup``
- ロール変更: `onChangeRole(member, role)` → `isDowngrade(member.role, role)` なら `DemoteMemberDialog` の `target` に(`isSelf = member.userId === me.data?.userId`)、そうでなければ即 `useMutation(changeMemberRole)`。成功: invalidate + `toaster.success(roleChanged(email, roleLabel(role)))`。自分を下げた成功(G12)は加えて invalidate `["tenants"]` → `navigate({ to: "/t/$tenantSlug" })`。失敗: invalidate + `toaster.error(errorMessage(e, roleChangeFailed))`
- 外す: `RemoveMemberDialog`。成功: invalidate + `toaster.success(removed(email))`。自分(G12): invalidate `["tenants"]` → `navigate({ to: "/tenants" })`。失敗: invalidate + `toaster.error(errorMessage(e, removeFailed))`(Review Focus 2)
- `isBusy` は 3 つの mutation のいずれかが `isPending`

- [ ] **Step 1: 失敗するテストを書く**

`shell-harness` の `renderAt("/t/blog/settings/members", routes)`。既定の `/v1/t/t1/members` は owner(u1)1 人。`role-select` は `vi.mock("./components/settings/role-select", () => ({ RoleSelect: ({ label, value, onChange }) => <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>…</select> }))` で差し替え、`fireEvent.change` で選ぶ。

```ts
// settings-members-list.test.tsx(モーダル無し)
it("メンバーを参加日順に出し、自分の行に「自分」、ロール説明カードが 3 枚", async () => {});
it("自分が最後の管理者の行は操作の代わりに「最後の管理者」と理由を出し、管理者が 2 人なら操作が出る", async () => { /* Review Focus 1。members を 2 通り */ });
it("取得に失敗すると中身だけにエラーと再試行が出て、再試行で一覧が出る", async () => { /* 1 回目 500、2 回目 200 */ });
it("ロールを上げると確認なしで PATCH してトーストを出す", async () => { /* viewer → editor。fireEvent.change → body { role: "editor" } */ });
// settings-members-add.test.tsx(1 本)
it("未登録なら案内と URL のコピーを出し、入力し直すと追加できる", async () => {
  // POST 1 回目 404 { error: "user_not_found" } → role="alert" に文と code「http://localhost:3000/signup」(jsdom の origin)、ダイアログは開いたまま。
  // 2 回目 200 → 閉じて通知 region に「new@example.com を追加しました」、GET members が再度呼ばれる(Review Focus 3)
});
// settings-members-remove.test.tsx(1 本)
it("「外す」は確認を経て DELETE し、409 last_owner ならエラーのトーストを出して一覧を取り直す", async () => {
  // DELETE が 409 { error: "last_owner" } → 通知 region に last_owner の文、GET members の呼び出し回数が増える(Review Focus 2)
});
// settings-members-remove-self.test.tsx(1 本)
it("自分を外すと確認に他の管理者のメールが出て、成功するとサイト選択へ移る", async () => {
  // members は u1(owner, 自分)と u2(owner)。自分の「外す」→ alertdialog「自分をこのサイトから外しますか？」に u2 のメール →「自分を外す」→ pathname /tenants
});
// settings-members-demote.test.tsx(1 本)
it("ロールを下げると確認に最大 15 分の案内が出て、確認で PATCH する", async () => {
  // editor → viewer。alertdialog「editor@example.com を閲覧者にしますか？」に「反映まで最大 15 分かかります…」→「閲覧者にする」→ PATCH body { role: "viewer" }
});
```

- [ ] **Step 2: テストが失敗することを確かめる**

Run: `corepack pnpm --filter @plyrs/admin exec vitest run src/settings-members-list.test.tsx src/settings-members-add.test.tsx`
Expected: FAIL(ルートが無い)

- [ ] **Step 3: 実装する**(`routeTree.gen.ts` の再生成は Task 5 と同じ手順)

- [ ] **Step 4: テストが通ることを確かめる**

Run: `corepack pnpm --filter @plyrs/admin exec vitest run && corepack pnpm -r typecheck && corepack pnpm format && corepack pnpm lint`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add apps/admin/src
```

```bash
git commit -m "feat(admin): 設定 › メンバー(一覧・追加・ロール変更・外す)を作る"
```

---

### Task 8: モジュール(カード、有効化の帯、無効化の確認)

**Files:**
- Create: `apps/admin/src/components/settings/module-card.tsx`、`disable-module-dialog.tsx`
- Test: `apps/admin/src/components/settings/module-card.test.tsx`、`disable-module-dialog.test.tsx`
- Modify: `apps/admin/src/routes/t/$tenantSlug/settings/modules/index.tsx`(書き換え)
- Delete: `apps/admin/src/modules-page.test.tsx`
- Create: `apps/admin/src/settings-modules.test.tsx`、`settings-modules-disable.test.tsx`

**Interfaces:**
- Consumes: Task 5 の `SettingsFrame`、Task 4 の `MODULE_LABELS` / `moduleContentCounts` / `formatCounts` / `moduleAddLinks`、`modulesQueryOptions` / `setModuleEnabled`、`useRecordsOfTypes` / `useSyncTypes` / `useSyncHasSynced` / `useTenantSync`、`Badge` / `Button` / `ConfirmDialog` / `Skeleton`、RAC `Link`(G28)
- Produces:

```ts
// module-card.tsx(G15)
export function ModuleCard(props: {
  module: ModuleSummary;
  addLinks: { key: string; label: string; href: string }[]; // 有効化直後の帯に出す。justEnabled のときだけ使う
  justEnabled: boolean;
  onEnable: () => void; onDisable: () => void; isBusy?: boolean;
}): JSX.Element;
// <section aria-labelledby={h2}>。flex(NARROW は wrap)。左: 44px の枠(accent.surface / accent.default。無効は bg.canvas + border)に Puzzle。
// 中: h2(名前 + enabled なら Badge tone="success" dot「有効」、無効なら font.caption text.muted「無効」)、description(font.body text.muted。null なら出さない)、
//   justEnabled なら <div role="status">(地 status.successSurface 相当、CircleCheck + justEnabled 文 + addLinks を Link で「{label} ›」)。
// 右: enabled → Button secondary「無効にする」/ 無効 → Button primary「有効にする」(isBusy で isDisabled)

// disable-module-dialog.tsx(G3・G16)
export function DisableModuleDialog(props: {
  target: { module: ModuleSummary; counts: TypeCount[] | null } | null; // counts null = 未同期
  onConfirm: () => void; onCancel: () => void; isPending: boolean;
}): JSX.Element;
// ConfirmDialog tone="primary"、title disableDialog.title(name)、children <p>body(name)</p> + 注記の枠(accent.surface、font.caption):
//   counts が null か空なら keepUnknown、あれば keep(formatCounts(counts))。confirmLabel「無効にする」
```

`ModulesPage`: `modules = useQuery(modulesQueryOptions(adminApi, tenant.id))`、`sync = useTenantSync()`、`types = useSyncTypes(sync)`、`hasSynced = useSyncHasSynced(sync)`、`navKeys = (modules.data ?? []).filter((m) => m.enabled).flatMap((m) => m.navTypes)`、`records = useRecordsOfTypes(sync.registry, navKeys)`。`toggle = useMutation(({ moduleId, enabled }) => setModuleEnabled(…))` → 成功: invalidate `["modules", tenant.id]`、有効化なら `setJustEnabled(moduleId)` + `toaster.success(enabledToast(name))`、無効化なら `toaster.success(disabledToast(name))`。失敗: `toaster.error(errorMessage(e, enableFailed | disableFailed))`。`SettingsFrame tab="modules"` に `isLoading={modules.isPending}`、`error`(`isLoadingError`、Review Focus 4)。本文: `<p>{MODULE_LABELS.description}</p>` → `ModuleCard` の列。無効化は `DisableModuleDialog` の `target = { module, counts: hasSynced ? moduleContentCounts(records, module.navTypes, types) : null }`。モジュールが 0 件なら `EmptyState`(Puzzle、title「モジュールはありません」は `MODULE_LABELS.empty` に足す)。

- [ ] **Step 1: 失敗するテストを書く**

```ts
// module-card.test.tsx
it("名前・有効のバッジ・説明・ボタンを出し、justEnabled なら帯と追加のリンクが出る", () => { /* link「予約枠を追加 ›」の href が /t/blog/content/booking.slot/new */ });
it("無効なモジュールは「有効にする」で onEnable を呼ぶ", async () => {});
// disable-module-dialog.test.tsx
it("件数があれば「予約 3 件、予約枠 2 件」、未同期なら件数の無い文", () => { /* 2 通りだが target は 1 つずつ描く(モーダル 2 回を避け、it を分ける) */ });
// settings-modules.test.tsx(モーダル無し)
it("モジュールをカードで出し、有効にするを押すと POST enable → トーストと帯が出る", async () => {
  // /v1/t/t1/modules が 予約(enabled false、navTypes ["booking.slot"]、description あり)。click「有効にする」→ enable が 1 回、
  // 通知 region「予約を有効にしました」、status「有効にしました。」。version / appliedVersion の文字が画面に無い
});
it("取得に失敗すると中身だけにエラーと再試行が出る", async () => { /* 1 回目 500、2 回目 200 → heading level 1「設定」は最初からある(Review Focus 4) */ });
it("サイドバーの「設定」から入った設定画面にモジュールのタブがある", async () => { /* 旧 modules-page.test の 2 本目の置き換え。mainNav に「モジュール」のリンクは無い */ });
// settings-modules-disable.test.tsx(1 本。records-harness の renderAt + bootstrapped で予約枠 2 件を流す)
it("無効にするは確認に件数を出し、確認で POST disable する", async () => {
  // alertdialog「予約モジュールを無効にしますか？」に「予約枠 2 件」→「無効にする」→ disable が 1 回、通知「予約を無効にしました」
});
```

- [ ] **Step 2: テストが失敗することを確かめる**

Run: `corepack pnpm --filter @plyrs/admin exec vitest run src/components/settings/module-card.test.tsx src/settings-modules.test.tsx`
Expected: FAIL(部品が無い、旧画面の文言)

- [ ] **Step 3: 実装する**

- [ ] **Step 4: テストが通ることを確かめる**

Run: `corepack pnpm --filter @plyrs/admin exec vitest run && corepack pnpm -r typecheck && corepack pnpm format && corepack pnpm lint`
Expected: PASS。`grep -rn "読み込み中…\|権限を確認してください" apps/admin/src/routes/t` が 0 件

- [ ] **Step 5: コミット**

```bash
git add apps/admin/src
```

```bash
git commit -m "feat(admin): 設定 › モジュールを説明付きのカードと無効化の確認に作り直す"
```

---

### Task 9: アカウント設定(メニューの項目、メール、パスワード変更、テーマ、所属サイト)

**Files:**
- Create: `apps/admin/src/components/theme-segment.tsx`、`apps/admin/src/components/theme-segment.test.tsx`
- Delete: `apps/admin/src/components/theme-select.tsx`、`apps/admin/src/components/theme-select.test.tsx`
- Create: `apps/admin/src/components/account/password-form.tsx`、`site-list.tsx`
- Test: `apps/admin/src/components/account/password-form.test.tsx`、`site-list.test.tsx`
- Modify: `apps/admin/src/components/shell/account-menu.tsx`(`onOpenAccount`)、`apps/admin/src/components/shell/sidebar.tsx`(`SidebarProps.onOpenAccount`)、`apps/admin/src/routes/t/$tenantSlug/route.tsx`(配線)
- Create: `apps/admin/src/components/shell/account-menu.test.tsx`
- Create: `apps/admin/src/routes/t/$tenantSlug/account.tsx`
- Modify: `apps/admin/src/routeTree.gen.ts`(再生成)
- Create: `apps/admin/src/account-page.test.tsx`

**Interfaces:**
- Consumes: Task 3 の `SegmentedControl`、Task 4 の `ACCOUNT_LABELS` / `NAV_LABELS.accountSettings`、Task 5 の `SettingsCard` / `SETTINGS_MAX_WIDTH`、`useThemePreference`、`changePassword` / `meQueryOptions` / `tenantsQueryOptions`、`can` / `roleLabel`、`Avatar` / `Badge` / `TextField` / `Button` / `Skeleton`、RAC `Link`(G28)
- Produces:

```ts
// theme-segment.tsx(G2)
export function ThemeSegment(): JSX.Element; // SegmentedControl(label theme.label、items system(Monitor)/ light(Sun)/ dark(Moon)、value は useThemePreference)

// account-menu.tsx(G17)
export interface AccountMenuProps { email: string | undefined; canSwitchSite: boolean; onOpenAccount: () => void; onOpenSiteList: () => void; onLogout: () => void }
// MenuItem id="account" icon={UserCog}「アカウント設定」を先頭に、MenuSeparator、(canSwitchSite の「サイトを切り替え」+ MenuSeparator)、「ログアウト」
// sidebar.tsx: SidebarProps.onOpenAccount: () => void を AccountMenu へ渡す。route.tsx: onOpenAccount: () => void navigate({ to: "/t/$tenantSlug/account", params })

// password-form.tsx(G18)
export interface PasswordFieldErrors { current?: string; next?: string }
export function PasswordForm(props: {
  onSubmit: (currentPassword: string, newPassword: string) => void;
  isPending: boolean;
  fieldErrors: PasswordFieldErrors; // API の結果(wrong_password / same_password)。親が持つ
  resetKey: number;                 // 成功のたびに親が増やし、入力を空に戻す
}): JSX.Element;
// 2 列グリッド(NARROW 1 列): 現在のパスワード / (空) / 新しいパスワード(description nextHelp)/ 確認。type="password"、autoComplete は current-password / new-password。
// 下に note(font.caption text.muted、flex 1)と Button primary「パスワードを変更」(3 つとも空でないまで isDisabled)。
// submit 前の検証: next.length < 12 → next の下 tooShort、next !== confirm → confirm の下 mismatch(ローカル state)。通れば onSubmit

// site-list.tsx(G19)
export function SiteList(props: { tenants: readonly TenantSummary[]; currentId: string }): JSX.Element;
// 行(上罫線、minHeight 44px → size.rowCompact(40px)に寄せる): Avatar sm + 名前(1 行省略、flex 1)+ Badge(can(role, "member:manage") ? accent : neutral、roleLabel)
// + currentId なら font.caption text.muted「現在のサイト」、それ以外は Link href=`/t/${slug}`「切り替える」
```

`account.tsx`(`/t/$tenantSlug/account`): `TenantPageHeader(title ACCOUNT_LABELS.title、breadcrumbs [homeCrumb, currentCrumb(title)])` + `PageBody`(maxWidth 880、flex column gap space.lg)に 4 枚の `SettingsCard`: メール(`me` pending → Skeleton、`isLoadingError` → alert + 再試行、data → `<p>{email}</p>` + help)/ パスワード(`change = useMutation(({ current, next }) => api.changePassword(current, next))`。成功: `resetKey + 1`、`fieldErrors = {}`、`toaster.success(revokedSessions > 0 ? changedWithRevoked(n) : changed)`。失敗: `ApiError` の code が `wrong_password` → `fieldErrors.current`、`same_password` → `fieldErrors.next`(文は `errorMessage`)、他 → `toaster.error(errorMessage(e, password.failed))`)/ テーマ(`ThemeSegment` + help)/ 所属サイト(`tenants = useQuery(tenantsQueryOptions(api))`、pending → Skeleton、error → alert + 再試行、data → `SiteList`)。

- [ ] **Step 1: 失敗するテストを書く**

```ts
// theme-segment.test.tsx(theme-select.test の置き換え)
it("選ぶと記憶してすぐ当てる", async () => { /* radio「ダーク」click → localStorage と colorScheme が dark */ });
// account-menu.test.tsx(直接描画。Menu の Popover は直接描画なら開ける)
it("「アカウント設定」が先頭にあり、押すと onOpenAccount を呼ぶ", async () => {});
// password-form.test.tsx
it("3 つとも入るまで無効で、12 文字未満と不一致はフィールドの下に出す", async () => {});
it("通れば onSubmit に現在と新しいパスワードを渡し、fieldErrors は該当の欄に出る", async () => {});
// site-list.test.tsx
it("現在のサイトは「現在のサイト」、他は「切り替える」のリンク", () => {});
// account-page.test.tsx(モーダル無し。shell-harness の renderAt("/t/blog/account", routes))
it("h1「アカウント設定」と 4 枚のカード(メール・パスワード・テーマ・所属サイト)が出る", async () => {});
it("パスワードを変更すると POST /auth/password を呼び、入力が空に戻ってトーストが出る", async () => {
  // 200 { ok: true, revokedSessions: 2 } → 通知「パスワードを変更しました。他の端末 2 件をログアウトしました」、textbox が空
});
it("現在のパスワードが違うと現在のパスワード欄の下に文が出て入力は残る", async () => {
  // 403 { error: "wrong_password" } → 「現在のパスワードが違います…」が textbox「現在のパスワード」の aria-describedby で結ばれ、pathname は /t/blog/account のまま(Review Focus 5)
});
it("テーマを選ぶと colorScheme が変わる", async () => {});
it("閲覧者でも開ける", async () => { /* authedRoutes(…, "viewer") → h1 が出る */ });
```

- [ ] **Step 2: テストが失敗することを確かめる**

Run: `corepack pnpm --filter @plyrs/admin exec vitest run src/components/account src/components/theme-segment.test.tsx src/components/shell/account-menu.test.tsx src/account-page.test.tsx`
Expected: FAIL(部品・ルートが無い)

- [ ] **Step 3: 実装する**(`routeTree.gen.ts` の再生成は Task 5 と同じ手順。`theme-select.tsx` を消すときは参照が無いことを `grep -rn ThemeSelect apps/admin/src` で確かめる)

- [ ] **Step 4: テストが通ることを確かめる**

Run: `corepack pnpm --filter @plyrs/admin exec vitest run && corepack pnpm -r typecheck && corepack pnpm format && corepack pnpm lint`
Expected: PASS。`grep -rn "ThemeSelect\|theme-select" apps/admin/src` が 0 件

- [ ] **Step 5: コミット**

```bash
git add apps/admin/src
```

```bash
git commit -m "feat(admin): アカウント設定(メール・パスワード変更・テーマ・所属サイト)とメニューの項目を足す"
```

---

### Task 10: E2E のヘルパー、全体の検証、preview での実機確認、報告

**Files:**
- Modify: `apps/e2e/helpers/setup.ts:100-111`(`createArticleType`。G4)

- [ ] **Step 1: E2E のヘルパーを直す**

`createArticleType`: サイドバーの「設定」を押した後、`await page.getByRole("tab", { name: "コンテンツタイプ" }).click()` を足し、`heading「コンテンツタイプ」` の 2 つの断言を `expect(page.getByRole("tab", { name: "コンテンツタイプ" })).toHaveAttribute("aria-selected", "true")` に替える(保存後は `/settings/content-types` に戻るのでタブが選ばれている)。コメントを「設定はまず「一般」に着地する(V4-G、G4)ためタブを押す」に。

- [ ] **Step 2: 静的検査とテスト**

Run: `corepack pnpm lint && corepack pnpm format:check && corepack pnpm -r typecheck && corepack pnpm -r --filter "!@plyrs/e2e" test`
Expected: すべて成功(ui の RAC のテストがタイムアウトしたら単独で再実行。api の session.test が落ちたら単独で再実行)。`grep -rln "tokens.stylex" apps/admin/src/components apps/admin/src/routes/t` が `content-type-form.tsx` だけ

- [ ] **Step 3: ビルドと E2E(ユーザーに依頼。サンドボックスの外。`apps/api/.wrangler` / `apps/admin/.wrangler` が消える)**

Run: `pnpm --filter @plyrs/admin build && pnpm --filter @plyrs/e2e test`
Expected: build 成功、3 spec が PASS(V4-B 分の E2E もここでまとめて確認する)

- [ ] **Step 4: dev での見た目の確認(ユーザーに依頼。`run` スキルを使ってよい)**

依頼書 3 章「確認する状態」の「メンバー」「共通」と、各タブの状態を owner / editor / viewer で見る:

- 設定: サイドバーの「設定」で一般に着地、h1「設定」の下にタブ 4 つ、タブで URL が変わり、ブラウザの戻るでタブが戻る。editor / viewer で `/t/<slug>/settings/general` を直接開くとホームへ転送
- 一般: サイト名を変えるまで「保存」が無効、保存でサイドバーの名前が変わりトースト。識別子は変更できない旨。ベース URL が preview の api のオリジン(G1)、型があれば例の行、コピーでトースト
- メンバー: 3 枚のロール説明、自分の行に「自分」、自分が最後の管理者なら「最後の管理者」とツールチップの理由。追加ダイアログで未登録のメール → 案内とサインアップ URL のコピー、登録済み → 追加されトースト。ロールを下げる → 最大 15 分の案内、上げる → 確認なし。他人を外す → 危険色の確認。自分を外す(管理者が 2 人のとき)→ 他の管理者のメール入りの警告 → サイト選択へ
- モジュール: カードの説明とバッジ、有効化で帯と「{型名}を追加 ›」、無効化の確認に件数(同期後)、無効化後にサイドバーから消える。`version` の文字が無い
- アカウント: メニューの先頭に「アカウント設定」、4 枚のカード、パスワード変更(違う現在のパスワード → 欄の下、成功 → トーストと他の端末のログアウト数)、テーマのセグメント 3 択(ダークで全画面の配色)、所属サイトの「切り替える」
- 狭い画面(959px 以下): 2 列が 1 列、ロール説明が 1 列、メンバーの表で参加日が隠れる、モジュールのボタンが下に回る。ダーク: カード・バッジ・警告の注記・未登録の案内・セグメントの配色

- [ ] **Step 5: ブランチの仕上げ**

superpowers:finishing-a-development-branch に従い、統合方法(ローカルマージ / push して PR / 残す)をユーザーに提示して選んでもらう。push はユーザーに確認してから(`git -c credential.helper='!gh auth git-credential' push https://github.com/hiz8/plyrs.git <branch>`、PR は `gh pr create --repo hiz8/plyrs`)。ワークツリー隔離のセッションでは main 側の git 操作が拒否されるため、ローカルマージは ExitWorktree(keep) で main に戻ってから `git merge --ff-only`(main に同名の未追跡ファイルがあれば先に消す。`git worktree remove` はサンドボックス外から)。

- [ ] **Step 6: preview での実機確認(ロードマップ 5 章の注記。ユーザーに依頼)**

main への反映で preview に自動デプロイされる(admin の `PUBLIC_API_ORIGIN` は wrangler.jsonc の preview 環境の値が使われる)。`/t/<slug>/settings/members` と `/t/<slug>/account` を直接開いて描画されること(SPA シェルの転送)、公開 API のベース URL が `https://plyrs-api-preview.hiz.workers.dev/public/v1/<slug>/` であること、コピーした URL をブラウザで開くと JSON が返ること、メンバーの追加・ロール変更・外す(別アカウントで)が API に反映されること、パスワード変更後に別の端末のセッションが切れることを確かめる。食い違いがあれば報告する(直すか後続に回すかはユーザーが決める)。

- [ ] **Step 7: 報告**

ユーザーに次をまとめて報告する: 裁定台帳(G1〜G30)と設計書への書き戻し、実行中に下した裁定(SDD の台帳 `.superpowers/sdd/<計画名>/progress.md` の Ruling)、D3 にあって V4-G に入れなかったもの(タブの件数、最終ログイン、モジュールの「増えるもの」の箇条書き、メンバーの幅 960px)、V4-B の申し送りの処理結果(G21・G22。据え置きにした「型 0 件でウィジェットも消える」)、後続へ送るもの(案 G 9 章の未決事項、design-sync の再同期は V4-F の最後、V4-E は content-types のタブの中身)、E2E・preview で見つかった食い違い、`.design-sync/NOTES.md` に記録した ui の変更(`SegmentedControl`)。

---

## セルフレビュー(2026-10-20)

- 仕様の網羅: G 3 章(サイト名・識別子・公開 API・4 タブ・保存の無効・コピーのトースト)→ Task 3(`/_config`)・4(文言・URL)・5。4.1(列・ロール名・説明カード・アバター・自分の印)→ Task 4(`memberRows`)・6・7。4.2(追加ダイアログ・登録済みのみ・未登録の案内・URL コピー・ロールの説明の入れ替え)→ Task 6・7。4.3(ロール変更・下げるときの確認と 15 分の案内)→ Task 4(`isDowngrade`)・6・7。4.4(外す確認)→ Task 6・7。4.5(最後の owner・自分を外す・自分を下げる・他の管理者のメール)→ Task 4・6・7。5 章(説明付きのカード・有効化の帯・無効化の確認・件数)→ Task 4(`moduleContentCounts`)・8。6.1(メニュー)→ Task 9。6.2(メール・パスワード・所属サイト・テーマ)→ Task 3(`SegmentedControl`)・9。7 章(権限)→ Task 5(guard)・9(全員)。H 2 章(骨格・h1 1 つ)→ Task 5・9。H 6 章(状態)→ Task 5(`SettingsFrame` の loading / error)・7・8・9。H 8 章(確認の使い分け)→ Task 6・8。H 10 章(画面幅)→ Task 5・6・8・9。H 11 章(a11y: alert、aria-busy、ツールチップの理由)→ Task 5・6。H トークン 4 章(テーマの 3 択)→ Task 3・9。a 3.3(設定の着地先・アカウントメニュー)→ Task 5・9。b 2.6(手順 3)→ Task 2。V4-B の持ち越し → Task 2
- 型の整合: `MemberRow` / `isDowngrade` / `otherOwnerEmails`(Task 4)を Task 6 の `MembersTable` / ダイアログの props と Task 7 の配線で使う。`AddMemberFailure`(Task 6)を Task 7 が `ApiError` の code から組む。`SettingsTab` / `SettingsFrame` の `isLoading` / `error`(Task 5)を Task 7・8 が使う。`TypeCount` / `formatCounts` / `moduleAddLinks`(Task 4)を Task 8 の `ModuleCard` / `DisableModuleDialog` が使う。`SegmentedControl`(Task 3)を Task 9 の `ThemeSegment` が包む。`configQueryOptions` / `resolvePublicOrigin`(Task 3・4)を Task 5 の `general.tsx` が使う。`PasswordFieldErrors` / `resetKey`(Task 9)は `account.tsx` の 1 か所で結ぶ
- Review Focus: 5 項目すべてに Task 7・8・9 のテスト名を結んだ
- ステップの粒度: 各タスクのコード本体は署名と pinned な値(文言・寸法・順序・エラーコードの対応)だけで、アルゴリズムを決める必要がある箇所(`isDowngrade` の rank、`lastOwnerId` の条件、`moduleContentCounts` の順序と除外、`SiteNameForm` の無効化条件、パスワードの送信前検証、自分を外した後の遷移)だけ 1 行で書いた
- 入れなかったもの(範囲外として報告): メール送信・招待リンク・パスワード再設定・メールアドレスの変更(G 9 章)、「他の端末からすべてログアウト」(G 9 章)、ロール変更の即時反映(G 9 章)、最終更新者の名前(B 6 章・D 10 章)、運営コンソールの見た目(V4 の範囲外)、コンテンツタイプのタブの中身(V4-E)
