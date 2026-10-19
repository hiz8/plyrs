# 管理画面 UX 再構築 V2: 骨格(案 A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** テナント内のシェルを案 A の形(3 段のサイドバー、パンくず + `PageHeader`、シェルに 1 か所の接続バナー、幅 960px 未満の上部バーとドロワー)に作り直し、サイト選択画面を D2 の形にする。あわせて V1 から持ち越した土台(dev の StyleX CSS 配信、body の書体、`I18nProvider` / `RouterProvider` / `ToastRegion`、表の選択セルのフォーカス)を入れる。

**Architecture:** シェルは `apps/admin/src/routes/t/$tenantSlug/route.tsx` が組み立て、サイドバーの中身は `apps/admin/src/components/shell/` の部品に分ける(裁定 2026-10-19: シェル固有の部品は admin 内に置き、再利用できる `Drawer` / `Avatar` だけ `packages/ui` に足す)。サイドバーの項目・現在地・モジュール群・同期状態の 3 状態は `apps/admin/src/lib/` の純関数で決め、部品は描くだけにする。ナビ項目とパンくずは react-aria-components の `Link`(`href`)で描き、`__root.tsx` の RAC `RouterProvider` が TanStack Router の画面内遷移につなぐ。接続バナーは `TenantPageHeader`(admin)が同期状態を見て `PageHeader` の `banner` に差し込む。見た目はセマンティックトークンだけで組む。

**Tech Stack:** StyleX 0.19.1(`@stylexjs/unplugin`、dev は `virtual:stylex.css`)、react-aria-components 1.21.1(`Link` / `Menu` / `ModalOverlay` / `I18nProvider` / `RouterProvider`)、TanStack Router / Start(SPA モード)、lucide-react、Vitest + jsdom + Testing Library、Playwright

**Spec:**
- `docs/admin-ux/a-navigation.md`(2〜8 章が真実源。3.5 の寸法表は D2 で確定)
- `docs/admin-ux/h-common-surface.md`(2 章 骨格、5 章 日時と locale、6 章 状態の表示、7 章 権限、10 章 画面幅、11 章 アクセシビリティ、12 章 アイコン)
- `docs/admin-ux/h-design-tokens.md`(3 章 セマンティックトークン、5 章 StyleX)
- `docs/superpowers/plans/2026-10-17-admin-ux-rebuild-roadmap.md` 5 章 V2
- キャンバス https://claude.ai/artifact/K57TVUfpefMuiPxhZXyAnU のページ「D2 骨格と主要 3 画面」(S1〜S8)。設計書と食い違うときは設計書を優先する(食い違いは Task 1 で設計書に書き戻し、最後に報告する)

## Global Constraints

- 画面と部品が参照するのはセマンティックトークン(`@plyrs/ui/semantic.stylex`)だけ。本計画で触るファイルからは旧 `@plyrs/ui/tokens.stylex`(`colors` / `spacing` / `typography`)の参照を無くす(対応: `colors.bg`→`bg.canvas`、`surface`→`bg.surface`、`border`→`border.default`、`text`→`text.default`、`textMuted`→`text.muted`、`accent`→`accent.default`、`accentText`→`text.onAccent`、`danger`→`status.danger`、`focusRing`→`focus.ring`、`spacing.xs/sm/md/lg/xl`→`space.xs/sm/md/lg/xl`、`typography.fontFamily`→`font.family`、`sizeSm`→`font.caption`、`sizeMd`→`font.body`、`sizeLg`→`font.label`、`sizeXl`→`font.sectionTitle`。直書きの `"1px"` → `stroke.default`、`"4px"/"6px"` の角丸 → `radius.control`、`"8px"` の角丸 → `radius.container`)。触らないファイル(`record-form.tsx` など)は旧名のまま残す
- キャンバスの寸法は尺度に寄せる(V1 の裁定と同じ): 文字 13px → 14px(`font.body`)、11px → 12px(`font.caption`)、15px → 16px(`font.label`)、22px → 24px(`font.pageTitle`)。余白 10px → 12px(`space.inset`)、6px → 8px(`space.sm`)、2px → `space.xxs`、4px → `space.xs`、14px → 12px、18px → 16px(`space.md`)、20px → 24px(`space.lg`)。サイドバーの幅 240px、上部バーの高さ 48px、ドロワーの幅 240px、サイト選択の幅 520px、メニューの幅 260px / 224px、アバター 24px / 40px、同期の点 8px、子項目の字下げ 40px は部品固有の寸法として数値で書き、コメントで根拠(a-navigation.md 3.5 / D2)を添える
- 幅 960px 未満の切り替えは CSS のメディアクエリ `"@media (max-width: 959px)"` だけで行う(`packages/ui/src/table.tsx` の `NARROW` と同じ文字列。StyleX 0.19.1 に `defineConsts` が無いため各ファイルに定数で書く)。JS の `matchMedia` は使わない
- シェル固有の部品(ナビ項目、サイト名のトリガー、アカウントのトリガー、上部バー)は `apps/admin/src/components/shell/` に置き、react-aria-components の `Link` / `Button` を直接使ってよい(裁定 2026-10-19)。それ以外は `@plyrs/ui` の部品(`Menu` / `MenuItem` / `Banner` / `Button` / `IconButton` / `Avatar` / `Drawer` / `Badge` / `Skeleton` / `EmptyState` / `PageHeader` / `Tooltip`)を使う
- 画面上の呼称は `lib/labels.ts` の対応表に従う(テナント → サイト、owner / editor / viewer → 管理者 / 編集者 / 閲覧者)。本計画で足す文言も `labels.ts` に置く
- 見出しは 1 画面に `h1` が 1 つ(`PageHeader` だけが h1 を持つ)。サイドバーの見出し(「コンテンツ」「予約」など)は heading 要素にしない
- アイコンは `lucide-react`、サイドバーとメニューは `ICON_SIZE.nav`(20px)、ボタン・バッジ・パンくずの中は `ICON_SIZE.inline`(16px)。装飾のアイコンは `aria-hidden`。アイコンのみのボタンは `IconButton`(`aria-label` 必須)
- 権限の出し分けは `can()` / `useCan()` だけで判定する(ロールの直書き禁止)。閲覧者には「新規追加」(子項目・主操作)を出さない(H 7 章「隠す」)。設定は `type:manage` を持つロール(owner)にだけ出す
- `@ts-expect-error` は使わない。コメント・ドキュメント・コミットメッセージは日本語。コミットは各タスクの最後に 1 つ(`/commit` スキルの規約)
- サンドボックスの道具: `pnpm` は `corepack pnpm`。ルートの `pnpm typecheck` / `pnpm test` は使わず `corepack pnpm -r typecheck`、`corepack pnpm -r --filter "!@plyrs/e2e" test`。`pnpm install`、admin の `build`、`dev` サーバー、E2E はサンドボックスの外で実行する(実行できない手順は「ユーザーに依頼」と書く)
- `docs/` と `.design-sync/` は oxfmt の対象外。それ以外は各タスクの最後に `corepack pnpm format` をかける
- ロードマップ 5 章の注記どおり、V2 は preview 環境で実機確認する(Task 15)。push はユーザーに確認してから

## Review Focus

1. **初回同期が終わる前に切断する(接続が一度も成功しない)**: 利用者は再接続の手段を失ってはならない。同期前の画面(`PageLoading`)でもヘッダーの下に接続バナーと「今すぐ再接続」が出ること → Task 10 の shell.test「初回接続の失敗でもバナーから再接続できる」
2. **非所属の slug → `/tenants` → 所属 1 件で自動転送**: `/t/ghost` を開いた利用者が `/t/blog` に着地し、ループしないこと → Task 12 の shell.test「非所属の slug は唯一の所属サイトへ転送する」
3. **モジュールを有効化した直後で、その型がまだ同期で届いていない**: 見出しだけが空で出たり、未知の型のリンクが出たりしないこと → Task 7 の navigation.test「同期済みの型に無い navTypes は出さない」と「型も slot 項目も無い見出しは出さない」
4. **自分の情報(`/auth/me`)の取得が 401 以外で失敗する**: シェル全体がエラー画面に落ちず、アカウント行がメール無しで描かれること → Task 10 の shell.test「me の取得失敗でもシェルは描かれる」
5. **狭い画面でドロワーの項目を選ぶ**: 遷移後にドロワーが閉じ、フォーカスがメニューボタンへ戻ること(開いたままだと本文が隠れる)→ Task 10 の shell.test「ドロワーの項目を選ぶと閉じる」

---

## ファイル構成

`packages/ui/src/`:

| ファイル                          | 責務                                                                                               |
| --------------------------------- | -------------------------------------------------------------------------------------------------- |
| `table.tsx`                       | 変更。選択の列・セルに `focusVisible` の見た目(V1 最終レビューの持ち越し)                           |
| `page-header.tsx`                 | 変更。`title` を `ReactNode` に(同期前のスケルトン)、狭い幅で左右 16px                              |
| `menu.tsx`                        | 変更。`MenuItem` に右寄せの補足 `detail`(サイト切替の役割)                                          |
| `avatar.tsx`                      | 新規。頭文字のアバター(24px / 40px)                                                                 |
| `drawer.tsx`                      | 新規。左から重なるドロワー(RAC `ModalOverlay` / `Modal` / `Dialog`)                                 |
| `index.ts`                        | 変更。`Avatar` / `Drawer` を export                                                                 |

`apps/admin/src/`:

| ファイル                                       | 責務                                                                                                   |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `routes/__root.tsx`                            | 変更。dev の StyleX CSS、body の書体・色・地、`I18nProvider`、RAC `RouterProvider`、`ToastRegion`      |
| `lib/labels.ts`                                | 変更。ナビ・同期状態・接続バナー・サイト選択の文言                                                     |
| `lib/navigation.ts`                            | 新規。型の並び、モジュール群、slot の `to` → href、現在地の判定(純関数)                                |
| `lib/sync-indicator.ts`                        | 新規。同期状態の 3 状態(純関数)                                                                        |
| `lib/breadcrumbs.ts`                           | 新規。パンくずの各段を作る関数                                                                         |
| `components/connection-banner.tsx`             | 書き換え。`Banner` + 「今すぐ再接続」                                                                  |
| `components/tenant-page-header.tsx`            | 新規。`PageHeader` に接続バナーを差し込む。`PageBody` / `PageLoading` も同居                           |
| `components/shell/nav-link.tsx`                | 新規。サイドバーの項目(RAC `Link` + アイコン + 現在地)と子項目                                         |
| `components/shell/site-switcher.tsx`           | 新規。上段(「plyrs」+ サイト名 + 切替メニュー)                                                         |
| `components/shell/sync-indicator.tsx`          | 新規。下段の同期状態                                                                                   |
| `components/shell/account-menu.tsx`            | 新規。下段のアカウントメニュー                                                                         |
| `components/shell/sidebar.tsx`                 | 新規。3 段の組み立て(中段のコンテンツ / メディア / モジュール / slot、型 0 件の案内)                  |
| `components/shell/top-bar.tsx`                 | 新規。幅 960px 未満の上部バー                                                                          |
| `routes/t/$tenantSlug/route.tsx`               | 書き換え。シェルの組み立て(広い画面のサイドバー、狭い画面の上部バー + `Drawer`、me / modules の取得) |
| `routes/t/$tenantSlug/index.tsx`               | 書き換え。ホームの暫定(裁定 2026-10-19)                                                                |
| `routes/t/$tenantSlug/content/index.tsx`       | 変更なし(ホームへ転送。ホームの挙動が変わる)                                                           |
| `routes/tenants.tsx`                           | 書き換え。サイト選択画面(所属 1 件は飛ばす)                                                            |
| `routes/t/$tenantSlug/content/$typeKey/*.tsx`  | 変更。`TenantPageHeader` + パンくず + 旧トークンの置き換え                                             |
| `routes/t/$tenantSlug/media/index.tsx`         | 同上                                                                                                   |
| `routes/t/$tenantSlug/settings/**/*.tsx`       | 同上(モジュール画面の h2 → h1)                                                                         |

`apps/e2e/helpers/setup.ts`: 新しいシェルの導線に合わせる。`docs/admin-ux/a-navigation.md` / `h-common-surface.md`: V2 の裁定の書き戻し。`.design-sync/NOTES.md`: 部品の追加の記録。

## タスクの依存

Task 1(設計書)→ Task 2・3(土台)→ Task 4〜6(ui の部品)→ Task 7(純関数)→ Task 8(ヘッダー)→ Task 9(サイドバー)→ Task 10(シェル)→ Task 11・12(ホーム・サイト選択)→ Task 13(各画面)→ Task 14(E2E)→ Task 15(検証)。Task 4・5・6 は互いに独立。Task 11・12 は互いに独立。

---

### Task 1: 設計書へ V2 の裁定を書き戻す

**Files:**
- Modify: `docs/admin-ux/a-navigation.md`(3.3、7 章、8 章、9 章、11 章 決定ログ)
- Modify: `docs/admin-ux/h-common-surface.md`(6 章、14 章 決定ログ)

- [ ] **Step 1: a-navigation.md を直す**

次を書き足す(既存の文は消さない)。

- 3.3 同期状態: 3 状態の定義を足す。「初回同期が完了する前は `text.muted` の点と「同期中…」。`ready` は `status.success` の点と「同期済み」。`closed`、または初回同期の後に `ready` 以外になったときは警告色の triangle-alert と「再接続しています…」とし、本文のヘッダー(パンくず・見出し・罫線)の直下に接続バナーを出す(2026-10-19)」
- 3.3 アカウントメニュー: 「V2 ではメールアドレス(見出し)、「サイトを切り替え」(所属が複数のときだけ、サイト選択画面へ)、「ログアウト」。D2 にある「アカウント設定」は案 G(V4)で足す(2026-10-19)」
- 3.1: 「切替メニューの見出しは「サイトを切り替え」、末尾に区切り線と「サイト一覧を開く」(サイト選択画面へ)を置く(D2、2026-10-19)」
- 7 章: 「閲覧者には「新規追加」の子項目と一覧の主操作を出さない(H 7 章の「隠す」。D2 の S2)」
- 8 章: 「V2 ではカードに最終ログインを出さない(テナント一覧 API に無い。必要なら案 G で API に足す。2026-10-19)。頭文字のマークの色はサイトによらず `accent.default`(D2 の 2 枚目の緑は採らない)」
- 9 章 案 B: 「V2 の暫定(2026-10-19 裁定): `/t/:slug/` は、利用者定義の型があれば先頭の型の一覧へ転送する。無ければ owner は設定のコンテンツタイプへ転送し、editor / viewer は h1「ホーム」と 7 章の案内文だけの暫定画面を出す。案 B で置き換える」
- 11 章 決定ログに 1 行: 「2026-10-19: V2 の計画で上記を確定。D2 との食い違いは設計書を優先した: 現在地の角丸は `radius.item`(S1 注記の 4px は採らない)、パンくずの区切りは chevron-right アイコン(「›」の文字は図の表記)、狭い画面の見出しも 24px のまま(22px は尺度に無い)、サイト名・パンくず・子項目の 13 / 11 / 15px は 14 / 12 / 16px」

- [ ] **Step 2: h-common-surface.md を直す**

- 6 章の「接続の切断」の行に「バナーはヘッダー(パンくず・見出し・罫線)と本文の間(`PageHeader` の `banner`)。文言は「サーバーとの接続が切れています。再接続しています… 編集内容はこの端末に保存され、再接続後に送信されます」、操作は小型の枠線ボタン「今すぐ再接続」(D2 の S3、2026-10-19)」を足す
- 2 章の末尾に「一覧の主操作の文言は「{型名}を追加」(D2)。同期が終わるまでは見出しをスケルトンにし、本文も スケルトンにする(6 章)」を足す
- 14 章 決定ログに 1 行: 「2026-10-19: V2 の計画で接続バナーの位置と文言、主操作の文言、同期前のスケルトンを確定」

- [ ] **Step 3: コミット**

```bash
git add docs/admin-ux/a-navigation.md docs/admin-ux/h-common-surface.md
git commit -m "docs: V2(骨格)の裁定を案 A・案 H の設計書に書き戻す"
```

---

### Task 2: dev サーバーで StyleX の CSS を配信する

V1 以前からの既存の問題。`@stylexjs/unplugin` 0.19.1 の Vite アダプタは dev で `/virtual:stylex.css`(CSS)と `virtual:stylex:runtime`(HMR 用の小さな runtime)を配るが、HTML シェルへの差し込みは `transformIndexHtml` 頼みで、TanStack Start のシェル(`__root.tsx` が描く)には入らない。README の "Dev HTML injection (baseline)" のとおり、`import.meta.env.DEV` のときだけ `<link>` と `import('virtual:stylex:runtime')` をシェルに入れる。

**Files:**
- Modify: `apps/admin/src/routes/__root.tsx`
- Modify(必要なときだけ): `apps/admin/vite.config.ts`
- Test: 手動(dev サーバーはサンドボックスの外)

**Interfaces:**
- Produces: dev の画面にスタイルが当たる。本番ビルドの `_shell` は変わらない

- [ ] **Step 1: `__root.tsx` の `head()` に dev 専用の link と script を足す**

```ts
head: () => ({
  meta: [...],
  links: [
    { rel: "stylesheet", href: appCss },
    // dev では StyleX の CSS がバンドルに入らず、unplugin の dev エンドポイントから取る
    // (@stylexjs/unplugin README "Dev HTML injection")。build では prerender に入れない
    ...(import.meta.env.DEV ? [{ rel: "stylesheet", href: "/virtual:stylex.css" }] : []),
  ],
  scripts: import.meta.env.DEV
    ? [{ type: "module", children: "import('virtual:stylex:runtime')" }]
    : [],
}),
```

`scripts` は TanStack Router の `head()` の戻り値(`AnyRouteMatch["headScripts"]`)。`<Scripts />` が描く。

- [ ] **Step 2: dev で確かめる(ユーザーに依頼。サンドボックスの外)**

Run: `pnpm --filter @plyrs/admin dev` を起動し、別の端末で
```bash
curl -s http://localhost:5173/virtual:stylex.css | head -c 300
```
Expected: `:root` の `--` 変数と `.x…` のクラスが返る(空文字なら、Cloudflare の Vite プラグインが先にリクエストを Worker へ回している。その場合は Step 3)

ブラウザで `/login` を開き、Expected: ボタンに塗りと pill の角丸が付き、入力欄に枠線がある(スタイル無しの明朝体ではない)。ファイルを編集して保存すると、リロード無しで見た目が追従する(`stylex:css-update`)

- [ ] **Step 3(Step 2 で CSS が空のときだけ): `vite.config.ts` を直す**

`stylex.vite({ ..., devPersistToDisk: true })` を足す(client / ssr の 2 環境で収集した規則を `node_modules/.stylex/rules.json` で共有する。README の `devPersistToDisk`)。それでも空なら、`import('virtual:stylex:css-only')` + `devMode: "css-only"` に切り替えて再確認し、結果を報告する。

- [ ] **Step 4: 本番ビルドに入っていないことを確かめる(ユーザーに依頼)**

Run: `pnpm --filter @plyrs/admin build && grep -l "virtual:stylex" $(find apps/admin/dist -name "*.html") || echo none`
Expected: `none`

- [ ] **Step 5: 単体テストが通ることを確かめてコミット**

Run: `corepack pnpm --filter @plyrs/admin exec vitest run src/router.test.tsx`
Expected: PASS(`import.meta.env.DEV` は vitest では true だが、head は描画されないので影響しない)

```bash
git add apps/admin/src/routes/__root.tsx apps/admin/vite.config.ts
git commit -m "fix(admin): dev サーバーで StyleX の CSS をシェルに差し込む"
```

---

### Task 3: シェルの土台(body の書体、I18nProvider、RouterProvider、ToastRegion)

**Files:**
- Modify: `apps/admin/src/routes/__root.tsx`
- Test: `apps/admin/src/router.test.tsx`

**Interfaces:**
- Produces: アプリ全体で RAC の `Link href` が TanStack Router の画面内遷移になる。`toaster.success()` / `toaster.error()` がどの画面でも表示される。RAC の内部文言が日本語

- [ ] **Step 1: 失敗するテストを書く(router.test.tsx に追加)**

```tsx
import { act } from "@testing-library/react";
import { toaster } from "@plyrs/ui";

it("toaster の通知がシェルの ToastRegion に出る", async () => {
  const router = getRouter({
    context: createAppContext(stubFetch(401, { error: "unauthenticated" })),
    history: createMemoryHistory({ initialEntries: ["/login"] }),
  });
  render(<RouterProvider router={router} />);
  await screen.findByRole("heading", { name: "ログイン" });
  act(() => {
    toaster.success("保存しました");
  });
  expect(await screen.findByRole("status")).toHaveTextContent("保存しました");
});
```

RAC の `RouterProvider` が画面内遷移につながることは、Task 10 の shell.test「パンくずのリンクは画面内遷移になる」で確かめる(ここでは RAC の `Link` を置く画面がまだ無い)。

Run: `corepack pnpm --filter @plyrs/admin exec vitest run src/router.test.tsx`
Expected: FAIL(status が無い)

- [ ] **Step 2: `__root.tsx` を直す**

- `RootShell`: `<body {...stylex.props(styles.body)}>`。`styles.body = { margin: 0, fontFamily: font.family, fontSize: font.body, lineHeight: font.lineHeightNormal, color: text.default, backgroundColor: bg.canvas }`(`styles.css` の `body { margin: 0 }` は残す)
- `RootComponent`: `const router = useRouter();` を取り、

```tsx
<QueryClientProvider client={queryClient}>
  {/* h-common-surface.md 5 章: RAC の内部文言(表の全選択など)を日本語に固定する */}
  <I18nProvider locale="ja-JP">
    {/* RAC の Link / Breadcrumbs の href を TanStack Router の画面内遷移につなぐ */}
    <RouterProvider navigate={(href) => void router.navigate({ href })} useHref={(href) => href}>
      <Outlet />
      {/* h-common-surface.md 3 章: トーストの置き場はシェルに 1 か所 */}
      <ToastRegion />
    </RouterProvider>
  </I18nProvider>
</QueryClientProvider>
```

`RouterProvider` は `react-aria-components` から import(TanStack の `RouterProvider` と名前が衝突するので `RouterProvider as RacRouterProvider`)。`router.navigate({ href })` は TanStack Router 1.171 の `NavigateOptions.href`。

- [ ] **Step 3: テストが通ることを確かめてコミット**

Run: `corepack pnpm --filter @plyrs/admin exec vitest run src/router.test.tsx`
Expected: PASS

```bash
git add apps/admin/src/routes/__root.tsx apps/admin/src/router.test.tsx
git commit -m "feat(admin): シェルの土台に body の書体・I18nProvider・RouterProvider・ToastRegion を置く"
```

---

### Task 4: ui の持ち越し修正(表の選択セル、PageHeader、MenuItem の detail)

**Files:**
- Modify: `packages/ui/src/table.tsx`、`packages/ui/src/table.test.tsx`
- Modify: `packages/ui/src/page-header.tsx`、`packages/ui/src/page-header.test.tsx`
- Modify: `packages/ui/src/menu.tsx`、`packages/ui/src/menu.test.tsx`

**Interfaces:**
- Produces: `PageHeaderProps.title: ReactNode`(文字列のときだけ `title` 属性で全文を出す)。`MenuItemProps.detail?: string`(右寄せ `font.caption` `text.muted`。アクセシブルな名前に含める)

- [ ] **Step 1: 失敗するテストを書く**

table.test.tsx(選択セルにキーボードでフォーカスすると見た目が変わる。menu.test.tsx 61〜64 行の様式):

```tsx
it("選択の列とセルにもキーボードのフォーカスの見た目が付く", async () => {
  render(<SelectableTable />); // 既存テストの selectionMode="multiple" の表を使う
  const user = userEvent.setup();
  const selectionCell = screen.getAllByRole("gridcell")[0]!;
  const before = selectionCell.className;
  await user.tab(); // 表へ
  await user.keyboard("{ArrowDown}{ArrowRight}"); // 先頭行 → 選択セル(RAC のセル移動)
  await user.keyboard("{ArrowLeft}");
  expect(document.activeElement).toBe(selectionCell);
  expect(selectionCell.className).not.toBe(before);
});
```

セルへの移動の順はテストを書きながら RAC の挙動に合わせてよい。断言は「選択セルがフォーカスを持ち、className が変わる」。

page-header.test.tsx:

```tsx
it("title に要素を渡せる(同期前のスケルトン)", () => {
  render(<PageHeader title={<Skeleton width={160} height={24} />} />);
  expect(screen.getByRole("heading", { level: 1 })).not.toHaveAttribute("title");
});
```

menu.test.tsx:

```tsx
it("detail は右に補足として出て、名前にも含まれる", async () => {
  render(
    <Menu trigger={<Button>サイト</Button>} label="サイトを切り替え" onAction={() => {}}>
      <MenuItem id="a" detail="管理者">Blog</MenuItem>
    </Menu>,
  );
  await userEvent.setup().click(screen.getByRole("button", { name: "サイト" }));
  expect(await screen.findByRole("menuitem", { name: "Blog 管理者" })).toBeInTheDocument();
});
```

Run: `corepack pnpm --filter @plyrs/ui exec vitest run src/table.test.tsx src/page-header.test.tsx src/menu.test.tsx`
Expected: 3 本とも FAIL

- [ ] **Step 2: 直す**

- `table.tsx`: `TableHeader` の選択列 `RacColumn` と `Row` の選択セル `RacCell` の `className` を `stylexRenderProps` にし、`state.isFocusVisible && styles.focusVisible` を足す(他の列・セルと同じ)
- `page-header.tsx`: `title: ReactNode`。`<span title={typeof title === "string" ? title : undefined}>`。`header` の `paddingInline` を `{ default: space.pageGutter, [NARROW]: space.md }` にし(`const NARROW = "@media (max-width: 959px)"`、D2 の S6)、`<h1>` に `aria-busy` は付けない
- `menu.tsx`: `MenuItemProps` に `detail?: string`。`textValue` は `detail` があれば `${children} ${detail}`。label の `span` の後ろに `<span {...stylex.props(styles.detail)}>{detail}</span>`(`styles.detail = { flexShrink: 0, fontSize: font.caption, color: text.muted }`)

- [ ] **Step 3: テストが通ることを確かめてコミット**

Run: `corepack pnpm --filter @plyrs/ui exec vitest run`
Expected: PASS

```bash
git add packages/ui/src/table.tsx packages/ui/src/table.test.tsx packages/ui/src/page-header.tsx packages/ui/src/page-header.test.tsx packages/ui/src/menu.tsx packages/ui/src/menu.test.tsx
git commit -m "fix(ui): 表の選択セルのフォーカス、見出しの要素化、メニュー項目の補足を足す"
```

---

### Task 5: Avatar(頭文字のアバター)

**Files:**
- Create: `packages/ui/src/avatar.tsx`、`packages/ui/src/avatar.test.tsx`
- Modify: `packages/ui/src/index.ts`

**Interfaces:**
- Produces: `Avatar({ name: string; size?: "sm" | "md" })`。装飾(`aria-hidden="true"`。名前は隣のテキストが伝える)。`sm` は 24px の円、`accent.surface` の地に `accent.default` の `font.caption` 600(サイドバーの下段)。`md` は 40px の `radius.control` の角丸、`accent.default` の地に `text.onAccent` の `font.label` 600(サイト選択のカード)。文字は `name` の先頭 1 文字(`Array.from(name)[0]`)を大文字に、空なら「?」

- [ ] **Step 1: 失敗するテストを書く**

```tsx
import { render } from "@testing-library/react";
import { expect, it } from "vitest";
import { Avatar } from "./avatar";

it("先頭の 1 文字を大文字で出し、読み上げからは外す", () => {
  const { container } = render(<Avatar name="owner@example.com" />);
  const avatar = container.firstElementChild!;
  expect(avatar).toHaveTextContent("O");
  expect(avatar).toHaveAttribute("aria-hidden", "true");
});

it("サロゲートペアの先頭も 1 文字として扱い、空なら ? を出す", () => {
  expect(render(<Avatar name="𠮷野" />).container).toHaveTextContent("𠮷");
  expect(render(<Avatar name="" />).container).toHaveTextContent("?");
});
```

Run: `corepack pnpm --filter @plyrs/ui exec vitest run src/avatar.test.tsx`
Expected: FAIL

- [ ] **Step 2: `avatar.tsx` を書き、`index.ts` に `export { Avatar, type AvatarProps } from "./avatar";` を足す**

- [ ] **Step 3: テストが通ることを確かめてコミット**

```bash
git add packages/ui/src/avatar.tsx packages/ui/src/avatar.test.tsx packages/ui/src/index.ts
git commit -m "feat(ui): 頭文字のアバターを足す"
```

---

### Task 6: Drawer(左から重なるドロワー)

**Files:**
- Create: `packages/ui/src/drawer.tsx`、`packages/ui/src/drawer.test.tsx`
- Modify: `packages/ui/src/index.ts`

**Interfaces:**
- Produces: `Drawer({ isOpen: boolean; onOpenChange: (isOpen: boolean) => void; label: string; children: ReactNode; offsetTop?: number })`。RAC の `ModalOverlay isDismissable` → `Modal` → `Dialog aria-label={label}`。暗幕は `bg.overlay`、`position: fixed`、`top` は `offsetTop`(既定 0。上部バーの下だけを覆う)、`zIndex: layer.modal`。本体は左端に幅 240px、`bg.surface`、右に `border.default`、`elevation.modal`、高さは暗幕いっぱい。Esc・暗幕のクリックで `onOpenChange(false)`。フォーカスは RAC が中に閉じ込め、閉じたら開いた要素へ戻す

- [ ] **Step 1: 失敗するテストを書く**

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { Drawer } from "./drawer";

it("開くとダイアログとして名前が付き、Esc で閉じる", async () => {
  const onOpenChange = vi.fn();
  render(
    <Drawer isOpen onOpenChange={onOpenChange} label="メニュー">
      <a href="/x">項目</a>
    </Drawer>,
  );
  const dialog = await screen.findByRole("dialog", { name: "メニュー" });
  expect(dialog).toContainElement(screen.getByRole("link", { name: "項目" }));
  await userEvent.setup().keyboard("{Escape}");
  expect(onOpenChange).toHaveBeenCalledWith(false);
});

it("閉じているときは何も描かない", () => {
  render(<Drawer isOpen={false} onOpenChange={() => {}} label="メニュー">x</Drawer>);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
```

Run: `corepack pnpm --filter @plyrs/ui exec vitest run src/drawer.test.tsx`
Expected: FAIL

- [ ] **Step 2: `drawer.tsx` を書く(`dialog.tsx` の `ModalOverlay` / `Modal` / `Dialog` の使い方と同じ)。`offsetTop` は `stylex.create({ offset: (top: number) => ({ top }) })` の動的スタイル。`index.ts` に export を足す**

- [ ] **Step 3: テストが通ることを確かめてコミット**

```bash
git add packages/ui/src/drawer.tsx packages/ui/src/drawer.test.tsx packages/ui/src/index.ts
git commit -m "feat(ui): 狭い画面のサイドバー用のドロワーを足す"
```

---

### Task 7: ナビゲーション・同期状態・パンくずの純関数と文言

**Files:**
- Create: `apps/admin/src/lib/navigation.ts`、`apps/admin/src/lib/navigation.test.ts`
- Create: `apps/admin/src/lib/sync-indicator.ts`、`apps/admin/src/lib/sync-indicator.test.ts`
- Create: `apps/admin/src/lib/breadcrumbs.ts`、`apps/admin/src/lib/breadcrumbs.test.ts`
- Modify: `apps/admin/src/lib/labels.ts`

**Interfaces:**
- Produces(`navigation.ts`):
  - `interface NavType { key: string; name: string; source: "user" | "plugin" | "system"; menuOrder?: number | null }`(同期の `ContentTypeDefinition` と HTTP の `ContentTypeSummary` の両方が満たす)
  - `sidebarContentTypes<T extends NavType>(types: readonly T[]): T[]` — `source === "user"` だけ。`menuOrder` 昇順(`null` / `undefined` は後ろ)、同順は `name` の `localeCompare(…, "ja")`
  - `interface ModuleNavGroup { moduleId: string; name: string; types: { key: string; name: string }[] }`
  - `moduleNavGroups(modules: readonly Pick<ModuleSummary, "moduleId" | "name" | "enabled" | "navTypes">[], types: readonly NavType[]): ModuleNavGroup[]` — `enabled` のモジュールだけ、`navTypes` の順で、`types` に同じ `key` があるものだけを型として持つ
  - `resolveNavHref(to: string, params: Readonly<Record<string, string>>): string` — `to` の `$name` を `params[name]` で置き換える(無い名前はそのまま)
  - `interface NavEntry { key: string; href: string; matchPrefix?: string }`
  - `activeNavKey(entries: readonly NavEntry[], pathname: string): string | null` — `pathname` が `href` と一致、または `(matchPrefix ?? href) + "/"` で始まる、または `matchPrefix` と一致する項目のうち、`matchPrefix ?? href` が最も長いものの `key`。無ければ `null`
- Produces(`sync-indicator.ts`): `type SyncIndicatorState = "syncing" | "ready" | "disconnected"`、`syncIndicatorState(status: SyncStatus, hasSynced: boolean): SyncIndicatorState` — `closed` → `disconnected`、`ready` → `ready`、それ以外は `hasSynced ? "disconnected" : "syncing"`
- Produces(`breadcrumbs.ts`、戻り値はすべて `BreadcrumbItem`): `homeCrumb(slug)`(id `home`、「ホーム」、`/t/${slug}`)、`contentTypeCrumb(slug, type: { key; name })`(id `type:${key}`、型名、`/t/${slug}/content/${key}`)、`mediaCrumb(slug)`(「メディア」、`/t/${slug}/media`)、`settingsCrumb(slug)`(「設定」、`/t/${slug}/settings/content-types`)、`settingsContentTypesCrumb(slug)`(「コンテンツタイプ」、`/t/${slug}/settings/content-types`)、`currentCrumb(label)`(id `current`、href 無し)
- Produces(`labels.ts`): `NAV_LABELS = { home: "ホーム", content: "コンテンツ", media: "メディア", settings: "設定", list: "一覧", add: "新規追加", createFirstType: "最初のコンテンツタイプを作成", noTypes: "コンテンツの種類がまだありません。サイトの管理者に作成を依頼してください", openMenu: "メニューを開く", closeMenu: "メニューを閉じる", switchSite: "サイトを切り替え", openSiteList: "サイト一覧を開く", logout: "ログアウト", mainNav: "メインナビゲーション" }`、`SYNC_INDICATOR_LABELS: Record<SyncIndicatorState, string> = { syncing: "同期中…", ready: "同期済み", disconnected: "再接続しています…" }`、`CONNECTION_BANNER = { message: "サーバーとの接続が切れています。再接続しています… 編集内容はこの端末に保存され、再接続後に送信されます", reconnect: "今すぐ再接続" }`、`SITE_SELECT = { title: "サイトを選択", description: (email: string, count: number) => `${email} として ${count} つのサイトに所属しています`, none: "サイトは運営者が発行します", otherAccount: "別のアカウントでログイン" }`。`SYNC_STATUS_LABELS` は残す(他で使用)

- [ ] **Step 1: 失敗するテストを書く(navigation.test.ts)**

```ts
import { describe, expect, it } from "vitest";
import { activeNavKey, moduleNavGroups, resolveNavHref, sidebarContentTypes } from "./navigation";

const t = (key: string, name: string, extra: Partial<{ source: "user" | "plugin" | "system"; menuOrder: number | null }> = {}) =>
  ({ key, name, source: "user", menuOrder: null, ...extra }) as const;

describe("sidebarContentTypes", () => {
  it("利用者の型だけを menuOrder → 名前の順に並べる", () => {
    const types = [t("blog", "ブログ"), t("asset", "メディア", { source: "system" }), t("event", "イベント", { menuOrder: 1 }), t("news", "お知らせ"), t("booking.slot", "予約枠", { source: "plugin" })];
    expect(sidebarContentTypes(types).map((x) => x.key)).toEqual(["event", "news", "blog"]);
  });
});

describe("moduleNavGroups", () => {
  const types = [t("booking.slot", "予約枠", { source: "plugin" }), t("booking.resource", "予約リソース", { source: "plugin" })];
  it("有効なモジュールの navTypes を、同期済みの型がある順で出す", () => {
    const modules = [{ moduleId: "booking", name: "予約", enabled: true, navTypes: ["booking.resource", "booking.slot", "booking.reservation"] }];
    expect(moduleNavGroups(modules, types)).toEqual([
      { moduleId: "booking", name: "予約", types: [{ key: "booking.resource", name: "予約リソース" }, { key: "booking.slot", name: "予約枠" }] },
    ]);
  });
  it("無効なモジュールは出さず、同期済みの型に無い navTypes は出さない", () => {
    const modules = [
      { moduleId: "booking", name: "予約", enabled: false, navTypes: ["booking.slot"] },
      { moduleId: "shop", name: "店舗", enabled: true, navTypes: ["shop.item"] },
    ];
    expect(moduleNavGroups(modules, types)).toEqual([{ moduleId: "shop", name: "店舗", types: [] }]);
  });
});

describe("resolveNavHref", () => {
  it("$name をパラメータで置き換える", () => {
    expect(resolveNavHref("/t/$tenantSlug/content/$typeKey", { tenantSlug: "blog", typeKey: "booking.slot" })).toBe("/t/blog/content/booking.slot");
    expect(resolveNavHref("/t/$tenantSlug/modules/booking/$unknown", { tenantSlug: "blog" })).toBe("/t/blog/modules/booking/$unknown");
  });
});

describe("activeNavKey", () => {
  const entries = [
    { key: "home", href: "/t/blog" },
    { key: "type:news", href: "/t/blog/content/news" },
    { key: "media", href: "/t/blog/media" },
    { key: "settings", href: "/t/blog/settings/content-types", matchPrefix: "/t/blog/settings" },
  ];
  it.each([
    ["/t/blog", "home"],
    ["/t/blog/content/news", "type:news"],
    ["/t/blog/content/news/new", "type:news"],
    ["/t/blog/content/news/0190a1b2-c3d4-7000-8000-000000000001", "type:news"],
    ["/t/blog/content/newsletter", "home"],
    ["/t/blog/settings/modules", "settings"],
    ["/t/blog/settings", "settings"],
    ["/t/other/media", null],
  ])("%s → %s", (pathname, key) => {
    expect(activeNavKey(entries, pathname)).toBe(key);
  });
});
```

`/t/blog/content/newsletter` が `home` になるのは、`/t/blog` が前方一致の最長だから(型が無いコンテンツはホームを現在地にする。実際には `content/index.tsx` がホームへ転送する)。

sync-indicator.test.ts:

```ts
it.each([
  ["idle", false, "syncing"], ["connecting", false, "syncing"], ["syncing", false, "syncing"],
  ["ready", false, "ready"], ["ready", true, "ready"],
  ["connecting", true, "disconnected"], ["syncing", true, "disconnected"],
  ["closed", false, "disconnected"], ["closed", true, "disconnected"],
] as const)("%s / hasSynced=%s → %s", (status, hasSynced, expected) => {
  expect(syncIndicatorState(status, hasSynced)).toBe(expected);
});
```

breadcrumbs.test.ts:

```ts
it("各段の href は tenantSlug 配下、現在地は href を持たない", () => {
  expect(homeCrumb("blog")).toEqual({ id: "home", label: "ホーム", href: "/t/blog" });
  expect(contentTypeCrumb("blog", { key: "booking.slot", name: "予約枠" })).toEqual({ id: "type:booking.slot", label: "予約枠", href: "/t/blog/content/booking.slot" });
  expect(settingsCrumb("blog")).toEqual({ id: "settings", label: "設定", href: "/t/blog/settings/content-types" });
  expect(currentCrumb("編集")).toEqual({ id: "current", label: "編集" });
});
```

Run: `corepack pnpm --filter @plyrs/admin exec vitest run src/lib/navigation.test.ts src/lib/sync-indicator.test.ts src/lib/breadcrumbs.test.ts`
Expected: FAIL(モジュールが無い)

- [ ] **Step 2: 3 ファイルと `labels.ts` の追加分を書く**

`navigation.ts` は `@plyrs/sync-client` / router に依存しない(`ModuleSummary` は `./admin-api` から型だけ import)。

- [ ] **Step 3: テストが通ることを確かめてコミット**

Run: `corepack pnpm --filter @plyrs/admin exec vitest run src/lib`
Expected: PASS

```bash
git add apps/admin/src/lib/navigation.ts apps/admin/src/lib/navigation.test.ts apps/admin/src/lib/sync-indicator.ts apps/admin/src/lib/sync-indicator.test.ts apps/admin/src/lib/breadcrumbs.ts apps/admin/src/lib/breadcrumbs.test.ts apps/admin/src/lib/labels.ts
git commit -m "feat(admin): サイドバーの並び・現在地・同期状態・パンくずを純関数にまとめる"
```

---

### Task 8: 接続バナーと TenantPageHeader / PageBody / PageLoading

**Files:**
- Rewrite: `apps/admin/src/components/connection-banner.tsx`
- Create: `apps/admin/src/components/tenant-page-header.tsx`、`apps/admin/src/components/tenant-page-header.test.tsx`

**Interfaces:**
- Consumes: Task 7 の `syncIndicatorState`、`CONNECTION_BANNER`。`@plyrs/ui` の `PageHeader` / `Banner` / `Button` / `Skeleton`。`lib/sync-context.tsx` の `useTenantSync` / `useSyncStatus` / `useSyncHasSynced`
- Produces:
  - `ConnectionBanner({ onReconnect: () => void })` — `<Banner tone="warning" action={<Button variant="secondary" size="sm" onPress={onReconnect}>今すぐ再接続</Button>}>{CONNECTION_BANNER.message}</Banner>`。状態の判定は持たない(`status` prop は廃止)
  - `TenantPageHeader(props: Omit<PageHeaderProps, "banner">)` — `syncIndicatorState(status, hasSynced) === "disconnected"` のとき `banner={<ConnectionBanner onReconnect={() => sync.start()} />}` を渡して `PageHeader` を描く。これがシェルで接続バナーを出す唯一の場所
  - `PageBody({ children })` — 本文の包み。`paddingInline: { default: space.pageGutter, [NARROW]: space.md }`、`paddingBlock: space.lg`
  - `PageLoading({ breadcrumbs })` — 同期前の表示。`TenantPageHeader` に `title={<Skeleton width={160} height={24} />}` を渡し、本文に `<div role="status" aria-label="読み込み中">` + `Skeleton` 3 行(`height={14}`、幅 100% / 80% / 60%)

- [ ] **Step 1: 失敗するテストを書く(tenant-page-header.test.tsx)**

`TenantSyncProvider` に `createTenantSync` の実体を渡すとエンジンが要るため、`TenantSync` の最小スタブを作る(`shell.test.tsx` の `FakeSocket` は使わない):

```tsx
function fakeSync(status: SyncStatus, hasSynced: boolean) {
  const start = vi.fn();
  const sync = {
    getStatus: () => status, getHasSynced: () => hasSynced, getTypes: () => [],
    subscribe: () => () => {}, start, stop: vi.fn(), engine: {} as never, registry: {} as never,
  } as unknown as TenantSync;
  return { sync, start };
}

it("切断中はヘッダーの下に接続バナーを出し、今すぐ再接続で start() を呼ぶ", async () => {
  const { sync, start } = fakeSync("closed", true);
  render(<TenantSyncProvider sync={sync}><TenantPageHeader title="お知らせ" /></TenantSyncProvider>);
  const banner = screen.getByRole("status");
  expect(banner).toHaveTextContent("サーバーとの接続が切れています");
  expect(screen.getByRole("banner").compareDocumentPosition(banner) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  await userEvent.setup().click(screen.getByRole("button", { name: "今すぐ再接続" }));
  expect(start).toHaveBeenCalledTimes(1);
});

it("同期済みならバナーを出さない", () => {
  render(<TenantSyncProvider sync={fakeSync("ready", true).sync}><TenantPageHeader title="お知らせ" /></TenantSyncProvider>);
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});

it("初回同期の前はスケルトンの見出しと読み込み中の本文を出す", () => {
  render(<TenantSyncProvider sync={fakeSync("connecting", false).sync}><PageLoading breadcrumbs={[{ id: "home", label: "ホーム", href: "/t/blog" }]} /></TenantSyncProvider>);
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("");
  expect(screen.getByRole("status", { name: "読み込み中" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "ホーム" })).toHaveAttribute("href", "/t/blog");
});
```

Run: `corepack pnpm --filter @plyrs/admin exec vitest run src/components/tenant-page-header.test.tsx`
Expected: FAIL

- [ ] **Step 2: 2 ファイルを書く**

`connection-banner.tsx` の先頭のコメント(§12 必須①: 切断中もフォーム(未保存入力)を維持し、保存はアウトボックスに積まれて接続回復後に送信される)は残す。

- [ ] **Step 3: テストが通ることを確かめてコミット**

Run: `corepack pnpm --filter @plyrs/admin exec vitest run src/components/tenant-page-header.test.tsx`
Expected: PASS(この時点で既存画面は旧 `ConnectionBanner status` を呼んでいるため typecheck は落ちる。Task 13 で直すので、ここでは `corepack pnpm --filter @plyrs/admin exec vitest run src/components` までを確かめる)

```bash
git add apps/admin/src/components/connection-banner.tsx apps/admin/src/components/tenant-page-header.tsx apps/admin/src/components/tenant-page-header.test.tsx
git commit -m "feat(admin): 接続バナーを PageHeader に差し込む TenantPageHeader を足す"
```

---

### Task 9: サイドバーの部品

**Files:**
- Create: `apps/admin/src/components/shell/nav-link.tsx`、`site-switcher.tsx`、`sync-indicator.tsx`、`account-menu.tsx`、`sidebar.tsx`
- Create: `apps/admin/src/components/shell/sidebar.test.tsx`

**Interfaces:**
- Consumes: Task 7 の純関数と文言。`@plyrs/ui` の `Menu` / `MenuItem` / `MenuSection` / `MenuSeparator` / `Avatar` / `Tooltip` / `ICON_SIZE`。`lib/permissions.ts` の `can`、`lib/labels.ts` の `roleLabel`
- Produces:

```ts
// nav-link.tsx
export interface NavLinkProps { href: string; label: string; icon?: LucideIcon; isCurrent: boolean }
export function NavLink(props: NavLinkProps): JSX.Element;      // 36px、RAC Link、aria-current="page" | undefined
export function NavChildLink(props: { href: string; label: string; icon?: LucideIcon; isCurrent: boolean }): JSX.Element; // 32px、字下げ 40px
export function NavHeading({ id, children }: { id: string; children: string }): JSX.Element; // 12px 600 text.muted の div(heading 要素にしない)

// site-switcher.tsx
export interface SiteSwitcherProps { tenant: TenantSummary; tenants: readonly TenantSummary[]; onSwitch: (slug: string) => void; onOpenList: () => void }
export function SiteSwitcher(props: SiteSwitcherProps): JSX.Element;
// 「plyrs」(font.caption 600 text.muted、letter-spacing 0.04em)の下にサイト名。tenants.length > 1 のときだけ
// RAC Button(36px、font.label 600、chevron-down 16px、title={tenant.name})を Menu の trigger にする。
// Menu label="サイトを切り替え"、MenuSection title="サイトを切り替え"、MenuItem id=slug detail=roleLabel(role) isCurrent、
// MenuSeparator、MenuItem id="__list" 「サイト一覧を開く」。1 件なら名前だけを span で出す(ボタンにしない)

// sync-indicator.tsx
export function SyncIndicator({ state }: { state: SyncIndicatorState }): JSX.Element;
// 高さ 28px、role="status"。ready: 8px の status.success の点 + 「同期済み」(font.caption text.muted)。
// syncing: text.muted の点 + 「同期中…」。disconnected: TriangleAlert 16px + 「再接続しています…」(status.warning、500)

// account-menu.tsx
export interface AccountMenuProps { email: string | undefined; canSwitchSite: boolean; onOpenSiteList: () => void; onLogout: () => void }
export function AccountMenu(props: AccountMenuProps): JSX.Element;
// trigger は RAC Button(36px、Avatar sm name={email ?? "?"}、メール 1 行省略、chevron-up 16px)、aria-label="アカウント"。
// Menu placement="top start" label="アカウント"。MenuSection title={email}(無ければ title 無し)、
// canSwitchSite のときだけ MenuItem id="sites" icon=ArrowUpDown 「サイトを切り替え」、MenuSeparator、MenuItem id="logout" icon=LogOut 「ログアウト」

// sidebar.tsx
export interface SidebarProps {
  tenant: TenantSummary; tenants: readonly TenantSummary[]; email: string | undefined;
  types: readonly NavType[]; hasSynced: boolean; modules: readonly ModuleSummary[] | undefined;
  slotItems: readonly NavItemContribution[]; syncState: SyncIndicatorState; pathname: string;
  onSwitchTenant: (slug: string) => void; onOpenTenantList: () => void; onLogout: () => void;
}
export function Sidebar(props: SidebarProps): JSX.Element;
```

`Sidebar` の構成(a-navigation.md 3 章・3.5):
- 全体: 幅 240px、`bg.surface`、右に `border.default`、`display: flex; flexDirection: column; height: 100%`。上段・下段は `flex: none`、中段は `flex: 1; minHeight: 0; overflowY: auto`
- 上段: `SiteSwitcher`。`padding: space.inset`、下に罫線
- 中段: `<nav aria-label="メインナビゲーション">`、`padding: space.sm`、項目間 `space.xxs`。順に
  1. ホーム(`House`、href `/t/${slug}`)
  2. `NavHeading` 「コンテンツ」+ `sidebarContentTypes(types)` の各型(`FileText`、href `/t/${slug}/content/${key}`)。現在地の型だけ子項目「一覧」(href 同じ、`isCurrent` は pathname が href と一致)と「新規追加」(`Plus`、href + `/new`、`can(role, "record:write")` のときだけ)。型が 0 件のとき、`hasSynced` が false なら(型がまだ届いていないだけ)`Skeleton` を 2 行(高さ 36px に合わせ `height={20}`、上下 `space.sm`)出し、true なら owner(`can(role, "type:manage")`)は `accent.default` の RAC Link(`Plus` 16px、「最初のコンテンツタイプを作成」、href `/t/${slug}/settings/content-types/new`)、それ以外は `font.caption` `text.muted` の「コンテンツの種類がまだありません。サイトの管理者に作成を依頼してください」
  3. メディア(`Image`、href `/t/${slug}/media`)。上に `space.sm` の空き
  4. `moduleNavGroups(modules ?? [], types)` の各群: `NavHeading` モジュール名 + 型(`FileText`、href `/t/${slug}/content/${key}`。子項目の規則はコンテンツと同じ)+ `group === "module:${moduleId}"` の slot 項目(`resolveNavHref(to, { ...params, tenantSlug })`)。型も slot 項目も無い群は見出しごと出さない
  5. `group` 未指定の slot 項目
- 下段: 上に罫線、`padding: space.sm`。`can(role, "type:manage")` のときだけ 設定(`Settings`、href `/t/${slug}/settings/content-types`、`matchPrefix` `/t/${slug}/settings`)と `group === "settings"` の slot 項目 → `SyncIndicator` → `AccountMenu`
- 現在地は `activeNavKey(entries, pathname)` で 1 つだけ決める(entries はホーム / 各型 `type:${key}` / メディア / 各 slot `slot:${id}` / 設定)

- [ ] **Step 1: 失敗するテストを書く(sidebar.test.tsx)**

```tsx
const tenant = { id: "t1", slug: "blog", name: "Blog", role: "owner" };
const other = { id: "t2", slug: "shop", name: "Shop", role: "editor" };
const types = [
  { key: "news", name: "お知らせ", source: "user", menuOrder: null },
  { key: "blog", name: "ブログ", source: "user", menuOrder: null },
  { key: "booking.slot", name: "予約枠", source: "plugin", menuOrder: null },
] as const;
const modules = [{ moduleId: "booking", name: "予約", description: null, navTypes: ["booking.slot"], version: 1, enabled: true, appliedVersion: 1 }];

function renderSidebar(overrides: Partial<SidebarProps> = {}) {
  const props: SidebarProps = {
    tenant, tenants: [tenant, other], email: "owner@example.com", types, hasSynced: true, modules, slotItems: [],
    syncState: "ready", pathname: "/t/blog/content/news",
    onSwitchTenant: vi.fn(), onOpenTenantList: vi.fn(), onLogout: vi.fn(), ...overrides,
  };
  render(<Sidebar {...props} />);
  return props;
}

it("3 段の項目を並べ、現在地の型だけ子項目を展開する", () => {
  renderSidebar();
  const nav = screen.getByRole("navigation", { name: "メインナビゲーション" });
  const names = within(nav).getAllByRole("link").map((a) => a.textContent);
  expect(names).toEqual(["ホーム", "お知らせ", "一覧", "新規追加", "ブログ", "メディア", "予約枠"]);
  expect(within(nav).getByRole("link", { name: "お知らせ" })).toHaveAttribute("aria-current", "page");
  expect(within(nav).getByRole("link", { name: "一覧" })).toHaveAttribute("href", "/t/blog/content/news");
  expect(within(nav).getByRole("link", { name: "新規追加" })).toHaveAttribute("href", "/t/blog/content/news/new");
  expect(screen.getByRole("link", { name: "設定" })).toHaveAttribute("href", "/t/blog/settings/content-types");
});

it("編集画面でも親の型が現在地になり、子項目は現在地にならない", () => {
  renderSidebar({ pathname: "/t/blog/content/news/0190a1b2-c3d4-7000-8000-000000000001" });
  expect(screen.getByRole("link", { name: "お知らせ" })).toHaveAttribute("aria-current", "page");
  expect(screen.getByRole("link", { name: "一覧" })).not.toHaveAttribute("aria-current");
});

it("閲覧者には設定と新規追加を出さない", () => {
  renderSidebar({ tenant: { ...tenant, role: "viewer" } });
  expect(screen.queryByRole("link", { name: "設定" })).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "新規追加" })).not.toBeInTheDocument();
});

it("型が無いとき、管理者には作成への案内、編集者には文言を出す", () => {
  renderSidebar({ types: [] });
  expect(screen.getByRole("link", { name: "最初のコンテンツタイプを作成" })).toHaveAttribute("href", "/t/blog/settings/content-types/new");
  cleanup();
  renderSidebar({ types: [], tenant: { ...tenant, role: "editor" } });
  expect(screen.getByText("コンテンツの種類がまだありません。サイトの管理者に作成を依頼してください")).toBeInTheDocument();
});

it("初回同期の前は型 0 件の案内を出さない(型がまだ届いていないだけ)", () => {
  renderSidebar({ types: [], hasSynced: false, syncState: "syncing" });
  expect(screen.queryByRole("link", { name: "最初のコンテンツタイプを作成" })).not.toBeInTheDocument();
  expect(screen.queryByText(/コンテンツの種類がまだありません/)).not.toBeInTheDocument();
});

it("サイト切替メニューは所属が複数のときだけ開き、役割と現在のサイトを示す", async () => {
  const props = renderSidebar();
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Blog" }));
  expect(await screen.findByRole("menuitem", { name: /Blog 管理者/ })).toHaveTextContent("(現在)");
  await user.click(screen.getByRole("menuitem", { name: /Shop 編集者/ }));
  expect(props.onSwitchTenant).toHaveBeenCalledWith("shop");
  cleanup();
  renderSidebar({ tenants: [tenant] });
  expect(screen.queryByRole("button", { name: "Blog" })).not.toBeInTheDocument();
  expect(screen.getByText("Blog")).toBeInTheDocument();
});

it("アカウントメニューからログアウトできる", async () => {
  const props = renderSidebar();
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "アカウント" }));
  expect(await screen.findByText("owner@example.com")).toBeInTheDocument();
  await user.click(screen.getByRole("menuitem", { name: "ログアウト" }));
  expect(props.onLogout).toHaveBeenCalledTimes(1);
});

it("同期状態の 3 状態", () => {
  renderSidebar({ syncState: "disconnected" });
  expect(screen.getByRole("status")).toHaveTextContent("再接続しています…");
});

it("slot の項目はモジュールの見出しの下、未指定は中段の最後、無効なモジュールの群は出さない", () => {
  renderSidebar({
    slotItems: [
      { id: "booking.calendar", label: "予約カレンダー", to: "/t/$tenantSlug/modules/booking/calendar", order: 0, group: "module:booking" },
      { id: "x.extra", label: "追加画面", to: "/t/$tenantSlug/content/$typeKey", params: { typeKey: "news" }, order: 0 },
      { id: "ghost.item", label: "幽霊", to: "/t/$tenantSlug/x", order: 0, group: "module:ghost" },
    ],
  });
  const names = within(screen.getByRole("navigation", { name: "メインナビゲーション" })).getAllByRole("link").map((a) => a.textContent);
  expect(names).toEqual(["ホーム", "お知らせ", "一覧", "新規追加", "ブログ", "メディア", "予約枠", "予約カレンダー", "追加画面"]);
  expect(screen.getByRole("link", { name: "追加画面" })).toHaveAttribute("href", "/t/blog/content/news");
});
```

Run: `corepack pnpm --filter @plyrs/admin exec vitest run src/components/shell/sidebar.test.tsx`
Expected: FAIL

- [ ] **Step 2: 5 ファイルを書く**

見た目(3.5): 項目 36px、アイコン 20px、左右 `space.inset`、角丸 `radius.item`、`text.default`。現在地は `accent.surface` の塗り + `accent.default` の文字 500、枠線なし。ホバーは `bg.hover`、フォーカスは `focus.ring` の 2px の輪(`stroke.focus`、内側 `calc(-1 * stroke.focus)`)。子項目 32px、`font.body`、左 40px(アイコン 20 + 間隔 12 + 8 に寄せる。`paddingInlineStart: "40px"` は数値で書き根拠を添える)、`text.muted`、現在の子は `accent.default` 500。RAC `Link` の render props で `isHovered` / `isFocusVisible` を `stylexRenderProps` に渡す(`@plyrs/ui` の `stylexRenderProps`)。

- [ ] **Step 3: テストが通ることを確かめてコミット**

Run: `corepack pnpm --filter @plyrs/admin exec vitest run src/components/shell`
Expected: PASS

```bash
git add apps/admin/src/components/shell
git commit -m "feat(admin): 3 段のサイドバーの部品を足す"
```

---

### Task 10: シェルの組み立て(route.tsx、上部バー、ドロワー)

**Files:**
- Create: `apps/admin/src/components/shell/top-bar.tsx`
- Rewrite: `apps/admin/src/routes/t/$tenantSlug/route.tsx`
- Modify: `apps/admin/src/shell.test.tsx`

**Interfaces:**
- Consumes: Task 9 の `Sidebar`、Task 6 の `Drawer`、Task 7 の `syncIndicatorState`、`lib/queries.ts` の `tenantsQueryOptions` / `meQueryOptions` / `modulesQueryOptions`
- Produces:
  - `TopBar({ tenantName, syncState, isMenuOpen, onToggleMenu }: { tenantName: string; syncState: SyncIndicatorState; isMenuOpen: boolean; onToggleMenu: () => void })` — `<header>`、高さ 48px、`bg.surface`、下に罫線、`paddingInline: space.sm`、gap `space.sm`。`IconButton`(`MenuIcon` 20px、`aria-label` は開いていれば「メニューを閉じる」、閉じていれば「メニューを開く」、`aria-expanded`)→「plyrs」(`font.caption` 600 `text.muted`)→ サイト名(`font.label` 600、1 行省略、`flex: 1`)→ 同期の点(8px。`ready` は `status.success`、`syncing` は `text.muted`、`disconnected` は `status.warning`。`title` に `SYNC_INDICATOR_LABELS[state]`)
  - `ShellLayout`(route.tsx): `display: grid; gridTemplateColumns: { default: "240px 1fr", [NARROW]: "1fr" }; minHeight: 100vh`。左の `<aside>` に `Sidebar`(`display: { default: "block", [NARROW]: "none" }`、`position: sticky; top: 0; height: 100vh`)。右は `TopBar`(`display: { default: "none", [NARROW]: "flex" }`)+ `<main>`(padding なし。各画面の `TenantPageHeader` と `PageBody` が余白を持つ)。`Drawer`(`isOpen={drawerOpen}`、`label="メニュー"`、`offsetTop={48}`)の中に同じ props の `Sidebar`。`useRouterState({ select: (s) => s.location.pathname })` が変わったら `setDrawerOpen(false)`
  - データ: `useQuery(tenantsQueryOptions(api))`(beforeLoad が入れたキャッシュ)、`useQuery(meQueryOptions(api))`(失敗してもシェルは描く。`email` は `data?.email`)、`useQuery(modulesQueryOptions(adminApi, tenant.id))`。`types` は `useSyncTypes(tenantSync)`、`hasSynced` は `useSyncHasSynced(tenantSync)`、`syncState` は `syncIndicatorState(useSyncStatus(tenantSync), hasSynced)`
  - 操作: `onSwitchTenant(slug)` → `navigate({ to: "/t/$tenantSlug", params: { tenantSlug: slug } })`、`onOpenTenantList` → `navigate({ to: "/tenants" })`、`onLogout` は現行の `logout()`
  - 現行のヘッダー(`{tenant.name}（テナント切替）`、「同期: …」、「再接続」、「ログアウト」)は無くす。`UntypedLink` と `SYNC_STATUS_LABELS` の import も無くす。`beforeLoad`(旧 URL の転送、認証ガード)は変えない

- [ ] **Step 1: shell.test.tsx を新しいシェルに合わせて書き換える(失敗する状態にする)**

`authedRoutes()` に `"/auth/me": vi.fn(() => jsonResponse(200, { userId: "u1", email: "owner@example.com" }))` と `"/v1/t/t1/modules": vi.fn(() => jsonResponse(200, { modules: [] }))` を足す。既存テストの置き換え:

- 「renders nav from the slot registry, the tenant header, …」→ 「サイドバーにホーム・型・メディア・設定が並び、設定画面のコンテンツタイプ一覧が出る」: `getByRole("link", { name: "設定" })` が `aria-current="page"`、`getByRole("link", { name: "ホーム" })` の href `/t/blog`、`getByRole("link", { name: "メディア" })` の href `/t/blog/media`(型は `/v1/t/t1/content-types` ではなく同期で届く。`pendingConnect` では届かないので、型の項目は断言せず、「最初のコンテンツタイプを作成」も出ないこと(同期前)を断言する)。`queryByRole("link", { name: /Blog/ })` が無い(ヘッダーの廃止)。型の項目が出ることは、`FakeSocket` で型を届ける `records-flow.test.tsx` の様式で 1 本足す: 「同期で届いた型がサイドバーに並び、現在地の型だけ子項目を展開する」(`/t/blog/content/article` を開き、`link "記事"` が `aria-current="page"`、`link "一覧"` と `link "新規追加"` がある)
- 「binds nav item params …」: `group: "module:test"` を外す(群の無い slot 項目は中段の最後)。別に「有効でないモジュールの群の slot 項目は出ない」を足す
- 「redirects to /tenants for a slug the user does not belong to」→ Task 12 で書き換える(ここでは `/tenants` の見出しが「サイトを選択」になる変更だけ: tenants スタブを 2 件にして `heading "サイトを選択"`)
- 「redirects /t/$tenantSlug to the content type list」→ Task 11 で書き換える(この時点では `/t/blog` → 型 1 件(article)→ `/t/blog/content/article` に変わる。Task 11 まで一時的に失敗してよい。`it.skip` にせず Task 11 で直す)
- 「logs out from the shell header」×2 → アカウントメニュー経由: `click(button "アカウント")` → `click(menuitem "ログアウト")`
- 「shows the sync status indicator while connecting」→ `getByRole("status")` が「同期中…」
- 「offers a reconnect button …」→ 初回同期が終わる前(`hasSynced=false`)の `closed` でも、`findByRole("button", { name: "今すぐ再接続" })` が出る(Review Focus 1。`/t/blog/settings/content-types` は同期を待たない画面なので、`/t/blog/content/article` で確かめる。`PageLoading` の中の `TenantPageHeader` がバナーを出す)。ボタン押下で `connects.length` が 1 増える

新規:

```tsx
it("me の取得失敗でもシェルは描かれる(Review Focus 4)", async () => {
  renderAt("/t/blog/settings/content-types", authedRoutes({ "/auth/me": vi.fn(() => jsonResponse(500, { error: "boom" })) }));
  expect(await screen.findByRole("button", { name: "アカウント" })).toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("ドロワーを開いて項目を選ぶと閉じる(Review Focus 5)", async () => {
  renderAt("/t/blog/settings/content-types", authedRoutes({ "/v1/t/t1/modules": vi.fn(() => jsonResponse(200, { modules: [] })) }));
  const user = userEvent.setup();
  const toggle = await screen.findByRole("button", { name: "メニューを開く" });
  await user.click(toggle);
  const drawer = await screen.findByRole("dialog", { name: "メニュー" });
  expect(screen.getByRole("button", { name: "メニューを閉じる" })).toHaveAttribute("aria-expanded", "true");
  await user.click(within(drawer).getByRole("link", { name: "メディア" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "メニュー" })).not.toBeInTheDocument());
  expect(await screen.findByRole("heading", { level: 1 })).toBeInTheDocument(); // メディア画面(同期前はスケルトン)
});

it("パンくずのリンクは画面内遷移になる", async () => {
  const router = renderAt("/t/blog/settings/content-types", authedRoutes());
  await screen.findByRole("heading", { name: "コンテンツタイプ" });
  await userEvent.setup().click(within(screen.getByRole("navigation", { name: "パンくず" })).getByRole("link", { name: "設定" }));
  await waitFor(() => expect(router.state.location.pathname).toBe("/t/blog/settings/content-types"));
});
```

パンくずのテストは Task 13 で設定画面に `TenantPageHeader` が入るまで失敗する。Task 13 の後に通ることを Task 15 で確かめる。

Run: `corepack pnpm --filter @plyrs/admin exec vitest run src/shell.test.tsx`
Expected: FAIL

- [ ] **Step 2: `top-bar.tsx` と `route.tsx` を書く**

- [ ] **Step 3: テストを確かめてコミット**

Run: `corepack pnpm --filter @plyrs/admin exec vitest run src/shell.test.tsx`
Expected: 「redirects /t/$tenantSlug …」「非所属 slug」「パンくず」以外が PASS(残りは Task 11〜13)

```bash
git add apps/admin/src/components/shell/top-bar.tsx "apps/admin/src/routes/t/\$tenantSlug/route.tsx" apps/admin/src/shell.test.tsx
git commit -m "feat(admin): テナントのシェルを 3 段のサイドバーと狭い画面の上部バーに作り直す"
```

---

### Task 11: ホームの暫定(/t/:slug/)

**Files:**
- Rewrite: `apps/admin/src/routes/t/$tenantSlug/index.tsx`
- Modify: `apps/admin/src/shell.test.tsx`

**Interfaces:**
- Consumes: Task 7 の `sidebarContentTypes`、`lib/queries.ts` の `contentTypesQueryOptions`、`lib/permissions.ts` の `can`、Task 8 の `TenantPageHeader` / `PageBody`、`@plyrs/ui` の `EmptyState`
- Produces(裁定 2026-10-19): `beforeLoad` で `context.queryClient.ensureQueryData(contentTypesQueryOptions(context.adminApi, context.tenant.id))` を取り、`sidebarContentTypes(types)[0]` があれば `/t/$tenantSlug/content/$typeKey` へ `redirect`。無ければ `can(context.tenant.role, "type:manage")` のとき `/t/$tenantSlug/settings/content-types` へ `redirect`。どちらでもなければ `component` の暫定画面: `TenantPageHeader title="ホーム" breadcrumbs={[currentCrumb("ホーム")]}` + `PageBody` に `EmptyState`(題「コンテンツの種類がまだありません」、説明「サイトの管理者に作成を依頼してください」、アイコン `FileText`、ボタン無し)

- [ ] **Step 1: shell.test.tsx の転送のテストを書き換える**

```tsx
describe("ホームの暫定(案 A 9 章、2026-10-19 裁定)", () => {
  it("利用者の型があれば先頭の型の一覧へ転送する", async () => {
    const router = renderAt("/t/blog", authedRoutes());
    await waitFor(() => expect(router.state.location.pathname).toBe("/t/blog/content/article"));
  });
  it("型が無い管理者は設定のコンテンツタイプへ転送する", async () => {
    const router = renderAt("/t/blog", authedRoutes({ "/v1/t/t1/content-types": vi.fn(() => jsonResponse(200, { contentTypes: [] })) }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/t/blog/settings/content-types"));
  });
  it("型が無い編集者には案内だけの暫定画面を出す", async () => {
    renderAt("/t/blog", authedRoutes({
      "/auth/tenants": vi.fn(() => jsonResponse(200, { tenants: [{ ...blogTenant, role: "editor" }] })),
      "/v1/t/t1/content-types": vi.fn(() => jsonResponse(200, { contentTypes: [] })),
    }));
    expect(await screen.findByRole("heading", { level: 1, name: "ホーム" })).toBeInTheDocument();
    expect(screen.getByText("コンテンツの種類がまだありません")).toBeInTheDocument();
  });
});
```

既存の「末尾を削った `/t/blog/content` は … `/t/blog/settings/content-types` へ」は `/t/blog/content/article` に変える(ホーム経由)。

Run: `corepack pnpm --filter @plyrs/admin exec vitest run src/shell.test.tsx -t "ホームの暫定"`
Expected: FAIL

- [ ] **Step 2: `index.tsx` を書く**

- [ ] **Step 3: テストを確かめてコミット**

```bash
git add "apps/admin/src/routes/t/\$tenantSlug/index.tsx" apps/admin/src/shell.test.tsx
git commit -m "feat(admin): サイトのトップを先頭の型の一覧へ転送し、型が無いときの暫定画面を置く"
```

---

### Task 12: サイト選択画面

**Files:**
- Rewrite: `apps/admin/src/routes/tenants.tsx`
- Modify: `apps/admin/src/auth-flow.test.tsx`、`apps/admin/src/shell.test.tsx`

**Interfaces:**
- Consumes: `tenantsQueryOptions` / `meQueryOptions`、`roleLabel`、`SITE_SELECT`、`@plyrs/ui` の `Avatar`(`md`)/ `Badge` / `Button`
- Produces: `loader` は `fetchQuery(tenants)` と `ensureQueryData(me)`(me の失敗は握りつぶし `email` を `undefined` に。401 は `/login`)。**所属が 1 件なら `redirect({ to: "/t/$tenantSlug", params: { tenantSlug } })`**(8 章)。画面(D2 S8): 地は `bg.surface`、中央に幅 520px の縦並び(`gap: space.lg`、上下中央)。「plyrs」(`font.body` 600 `text.muted`、letter-spacing 0.06em)→ `h1` 「サイトを選択」(`font.pageTitle` 600)→ 説明 `SITE_SELECT.description(email, count)`(`font.body` `text.muted`。`email` が無ければ「N つのサイトに所属しています」)→ カードの `<ul>`(間隔 `space.sm`)。カードは TanStack `Link`(`to="/t/$tenantSlug"`)で、`padding: space.md`、`bg.canvas`、`border.default`、`radius.container`、`gap: space.inset`、中は `Avatar size="md" name={tenant.name}` → 名前(`font.label` 600、1 行省略、`flex: 1`)→ `Badge tone={role === "owner" ? "accent" : "neutral"}`(`roleLabel(role)`)→ `ChevronRight` 16px `text.muted`。ホバーは `border.hover` + `elevation.menu`、フォーカスは `focus.ring`。最終ログインは出さない(裁定)。下に `Button variant="link"` 「別のアカウントでログイン」(ログアウト → `/login`)。0 件は「サイトは運営者が発行します」+ 同じリンク
- 旧 `slug / role` の表示と「ログアウト」ボタンは無くす

- [ ] **Step 1: テストを直す(失敗する状態にする)**

auth-flow.test.tsx: `"テナントを選択"` の 5 か所を `"サイトを選択"` に。それぞれの tenants スタブが 1 件なら 2 件にする(1 件は転送されて選択画面が出ない。テストの意図はログイン後の着地なので、2 件で画面を確かめる)。0 件のテストがあれば「サイトは運営者が発行します」に合わせる。`/tenants` の loader が `/auth/me` も取るようになるため、各テストの fetch スタブに `/auth/me`(`{ userId: "u1", email: "user@example.com" }`)を足す(スタブが無い path で例外を投げる様式のテストで、握りつぶしの経路に頼らない)。

shell.test.tsx:

```tsx
it("非所属の slug は、所属が 1 件なら唯一のサイトへ転送する(Review Focus 2)", async () => {
  const router = renderAt("/t/ghost/settings/content-types", authedRoutes());
  await waitFor(() => expect(router.state.location.pathname).toBe("/t/blog/content/article"));
});

it("非所属の slug は、所属が複数ならサイト選択へ戻す", async () => {
  renderAt("/t/ghost/settings/content-types", authedRoutes({
    "/auth/tenants": vi.fn(() => jsonResponse(200, { tenants: [blogTenant, { id: "t2", slug: "shop", name: "Shop", role: "editor" }] })),
  }));
  expect(await screen.findByRole("heading", { name: "サイトを選択" })).toBeInTheDocument();
  expect(screen.getByText("owner@example.com として 2 つのサイトに所属しています")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /Shop/ })).toHaveAttribute("href", "/t/shop");
  expect(screen.getByRole("link", { name: /Shop/ })).toHaveTextContent("編集者");
  expect(screen.queryByText("shop")).not.toBeInTheDocument(); // slug は出さない
});
```

Run: `corepack pnpm --filter @plyrs/admin exec vitest run src/auth-flow.test.tsx src/shell.test.tsx`
Expected: FAIL

- [ ] **Step 2: `tenants.tsx` を書く**

- [ ] **Step 3: テストを確かめてコミット**

Run: `corepack pnpm --filter @plyrs/admin exec vitest run src/auth-flow.test.tsx src/shell.test.tsx`
Expected: PASS(パンくずのテストを除く)

```bash
git add apps/admin/src/routes/tenants.tsx apps/admin/src/auth-flow.test.tsx apps/admin/src/shell.test.tsx
git commit -m "feat(admin): サイト選択画面を D2 の形にし、所属が 1 件なら飛ばす"
```

---

### Task 13: 各画面に TenantPageHeader とパンくずを入れ、旧トークンを置き換える

**Files:**
- Modify: `apps/admin/src/routes/t/$tenantSlug/content/$typeKey/index.tsx`、`new.tsx`、`$recordId.tsx`
- Modify: `apps/admin/src/routes/t/$tenantSlug/media/index.tsx`
- Modify: `apps/admin/src/routes/t/$tenantSlug/settings/content-types/index.tsx`、`new.tsx`、`$typeKey.edit.tsx`
- Modify: `apps/admin/src/routes/t/$tenantSlug/settings/modules/index.tsx`
- Modify: `apps/admin/src/records-flow.test.tsx`、`apps/admin/src/content-type-builder.test.tsx`、`apps/admin/src/modules-page.test.tsx`、`apps/admin/src/asset-flow.test.tsx`(文言の変更に追従)

**Interfaces:**
- Consumes: Task 8 の `TenantPageHeader` / `PageBody` / `PageLoading`、Task 7 の `*Crumb`、`useCan`
- Produces: 各画面の見出し・パンくず・主操作は次のとおり。`ConnectionBanner` の直接描画と `<h1>` / `<h2>` の自前の見出しは無くす。同期待ち(`!hasSynced`)は `<PageLoading breadcrumbs={[homeCrumb(slug)]} />`。本文は `<PageBody>` で包む。同じファイルの旧トークン参照は Global Constraints の対応で置き換える

| 画面                               | title                             | breadcrumbs                                                              | primaryAction                                                                                            |
| ---------------------------------- | --------------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| content/$typeKey/index             | `{型名}`                          | home › current(型名)                                                     | `useCan("record:write")` のとき `<Button icon={Plus} onPress={→ new}>{型名}を追加</Button>`。旧「新規レコード」リンクは無くす |
| content/$typeKey/new               | `{型名}を追加`                    | home › contentType › current(「新規追加」)                               | なし(フォームの「作成」はそのまま)                                                                        |
| content/$typeKey/$recordId         | `{型名}を編集`                    | home › contentType › current(「編集」)                                   | なし(案 C で公開ボックスへ)                                                                               |
| media/index                        | 「メディア」                      | home › current(「メディア」)                                             | なし(アップロードの input はそのまま本文に残す)                                                           |
| settings/content-types/index       | 「コンテンツタイプ」              | home › settings › current(「コンテンツタイプ」)                          | `<Button icon={Plus} onPress={→ new}>コンテンツタイプを追加</Button>`。旧「新規コンテンツタイプ」リンクは無くす |
| settings/content-types/new         | 「コンテンツタイプを追加」        | home › settings › settingsContentTypes › current(「新規追加」)           | なし                                                                                                     |
| settings/content-types/$typeKey.edit | `{型名}`                        | home › settings › settingsContentTypes › current(型名)                   | なし                                                                                                     |
| settings/modules/index             | 「モジュール」                    | home › settings › current(「モジュール」)                                | なし                                                                                                     |

`{型名}を追加` の「を追加」の前に空白を入れない(現行の「{型名} を作成」の空白はやめる。D2)。

- [ ] **Step 1: 画面を 1 つずつ直し、そのたびに関係するテストを直して回す**

テストの追従(確かめながら直す):
- `records-flow.test.tsx` 133 行: `getByRole("link", { name: "新規レコード" })` → `getByRole("button", { name: "記事を追加" })`。139 行の `/同期中/` → `getByRole("status", { name: "読み込み中" })`。301 行の `/再同期中/` → `/接続が切れています/`。見出しを断言している箇所は表の文言に合わせる
- `content-type-builder.test.tsx` 79 行: link 「新規コンテンツタイプ」→ button 「コンテンツタイプを追加」。124 行はそのまま
- `modules-page.test.tsx`: 見出しが `h1` 「モジュール」になる(`getByRole("heading", { level: 1 })`)
- `asset-flow.test.tsx`: 見出し「アセット」を断言していれば「メディア」に

Run: `corepack pnpm --filter @plyrs/admin exec vitest run`
Expected: PASS(Task 10 のパンくずのテストもここで通る)

- [ ] **Step 2: typecheck と format**

Run: `corepack pnpm -r typecheck && corepack pnpm format`
Expected: 成功。`grep -rn "tokens.stylex" apps/admin/src/routes/t apps/admin/src/routes/tenants.tsx apps/admin/src/components/shell apps/admin/src/components/connection-banner.tsx apps/admin/src/components/tenant-page-header.tsx` が 0 件

- [ ] **Step 3: コミット**

```bash
git add apps/admin/src/routes/t apps/admin/src/*.test.tsx
git commit -m "feat(admin): 全画面にパンくず付きの PageHeader を入れ、接続バナーをシェルに集約する"
```

---

### Task 14: E2E のヘルパーを新しいシェルに合わせる

**Files:**
- Modify: `apps/e2e/helpers/setup.ts`
- Modify(必要なら): `apps/e2e/tests/core-journey.spec.ts`、`apps/e2e/tests/two-tab-sync.spec.ts`

**Interfaces:**
- Produces: `loginAsUser` はログイン後に `page.waitForURL(/\/t\/[^/]+\//)`(所属 1 件のためサイト選択を飛ばしてサイトへ着地する。型の有無で着地先が変わるので URL だけを待つ)。`createArticleType(page, tenantName)` は `tenantName` 引数を無くし、`page.getByRole("link", { name: "設定" }).click()` → 見出し「コンテンツタイプ」→ `button "コンテンツタイプを追加"` → 以降は同じ。`createArticleRecord` の「新規レコード」リンクは `button "記事を追加"`。他は変えない(「レコード」リンク、「作成」「保存」「公開」はそのまま)

- [ ] **Step 1: ヘルパーと spec の呼び出しを直す**

`core-journey.spec.ts` / `two-tab-sync.spec.ts` の `createArticleType(page, "Journey")` → `createArticleType(page)`。

- [ ] **Step 2: E2E を回す(ユーザーに依頼。サンドボックスの外。`apps/api/.wrangler` / `apps/admin/.wrangler` が消える)**

Run: `pnpm --filter @plyrs/e2e test`
Expected: 3 spec が PASS。dev サーバーで StyleX の CSS が出るようになった(Task 2)ので、Playwright のトレースで見た目も確かめられる

- [ ] **Step 3: コミット**

```bash
git add apps/e2e
git commit -m "test(e2e): サイト選択の省略と新しいシェルの導線に合わせる"
```

---

### Task 15: 全体の検証、デザインシステムへの同期、preview での実機確認

**Files:**
- Modify: `.design-sync/NOTES.md`(部品の追加と気づきの追記)
- 変更なし(問題が見つかったときだけ該当ファイルを直す)

- [ ] **Step 1: 静的検査とテスト**

Run: `corepack pnpm lint && corepack pnpm format:check && corepack pnpm -r typecheck && corepack pnpm -r --filter "!@plyrs/e2e" test`
Expected: すべて成功

- [ ] **Step 2: ビルド(ユーザーに依頼)**

Run: `pnpm --filter @plyrs/admin build && grep -l "virtual:stylex" $(find apps/admin/dist -name "*.html") || echo none`
Expected: 成功、`none`

- [ ] **Step 3: dev での見た目の確認(ユーザーに依頼。`run` スキルを使ってよい)**

`pnpm --filter @plyrs/admin dev` で、所属 2 件の利用者と 1 件の利用者、owner と viewer で次を見る:

- ログイン → 所属 1 件はサイトを経由せずトップ(先頭の型の一覧)へ。2 件はサイト選択(カードに役割、slug 無し)
- サイドバー: 上段のサイト名(2 件なら ▾ とメニューに役割・(現在)・「サイト一覧を開く」)、中段(ホーム / コンテンツの型 / メディア / 有効なモジュールの群)、現在地の塗りと子項目の展開、下段(設定は owner のみ / 同期済みの点 / アカウントメニュー)
- 型を 12 件以上作って中段だけがスクロールし、上段・下段が固定される
- パンくず → 見出し → 罫線 → 本文、の順で全画面(設定・モジュール含む)。モジュール画面の見出しが h1
- api の dev サーバーを止めて切断 → 下段が警告色の「再接続しています…」、見出しの下にバナー、「今すぐ再接続」で復帰
- 幅を 959px 以下にして上部バーとドロワー(暗幕・Esc・項目の選択で閉じる、フォーカスがボタンへ戻る)
- OS の配色をダークにしてサイドバー・バナー・サイト選択の配色
- 部品の外の文字(サイドバー、サイト選択の説明)がゴシック体になっている(body の書体)

- [ ] **Step 4: ブランチの仕上げ**

superpowers:finishing-a-development-branch に従い、ローカルの main へマージする。push はユーザーに確認してから(`git -c credential.helper='!gh auth git-credential' push https://github.com/hiz8/plyrs.git main`)。

- [ ] **Step 5: preview での実機確認(ロードマップ 5 章の注記。ユーザーに依頼)**

main への push で preview に自動デプロイされる。preview で Step 3 と同じ項目のうち、SPA シェルに関わるものを確かめる: 深い URL(`/t/<slug>/content/<type>/<id>`、`/t/<slug>/settings/modules`)を直接開いて描画されること、旧 URL(`/t/<slug>/records/<type>`)が転送されること、ダークの配色、`localStorage` の `plyrs.theme` を `dark` にして再読み込みしても一瞬ライトにならないこと。食い違いがあれば報告する(直すか V3 に回すかはユーザーが決める)。

- [ ] **Step 6: キャンバスのデザインシステムへ同期(`.design-sync/NOTES.md` の再同期の手順)**

`packages/ui` に `Avatar` / `Drawer` を足し、`PageHeader` / `MenuItem` / `Table` を変えたので再同期する(サンドボックスの外)。`.design-sync/docs/` に `Avatar` / `Drawer` のスタブを足す。`NOTES.md` の「部品側の気づき(未対応)」から「Table の選択セル」を消し、`Drawer` は `overrides` で `cardMode: single`・`viewport: 720x480`、プレビューは `isOpen` で開く旨を足す。

- [ ] **Step 7: 報告**

ユーザーに次をまとめて報告する: D2 との食い違いで設計書を優先した点(Task 1 の決定ログ)、D2 にあって V2 に入れなかったもの(「アカウント設定」の項目、最終ログイン、サイトごとのアバターの色、狭い画面の「追加」への短縮)、Task 2 の dev 配信の結果(`devPersistToDisk` の要否)、preview で見つかった食い違い。

---

## セルフレビュー(2026-10-19)

- 仕様の網羅: 案 A 2 章(ヘッダー無し)→ Task 10。3.1〜3.5 → Task 9・10。4 章(slot の group / params)→ Task 9(描画)。5 章 → Task 8・13。6 章 → 変更なし(T10 で済)。7 章 → Task 9。8 章 → Task 12。9 章の暫定 → Task 11。H 2 章 → Task 8・13。H 5 章(locale)→ Task 3。H 6 章(バナー・スケルトン)→ Task 8。H 10 章 → Task 4・8・10。H 11 章(`aria-current`、モーダルのフォーカス)→ Task 6・9。V1 の持ち越し(dev CSS、body、I18n、RouterProvider、ToastRegion、表の選択セル)→ Task 2・3・4
- 型の整合: `SidebarProps.types: readonly NavType[]`(Task 9)に `useSyncTypes` の `ContentTypeDefinition[]`(`menuOrder?: number`)と、Task 11 の `ContentTypeSummary`(`menuOrder: number | null`)の両方を渡せるよう、`NavType.menuOrder` は `number | null | undefined`。`SyncIndicatorState` は Task 7 で定義し Task 8〜10 が使う。`TenantSummary.role` は文字列のため、判定はすべて `can(role, …)`
- 入れなかったもの(範囲外として報告): `ErrorScreen` の「ホームへ戻る」(H 6 章。V2 の画面に含めない)、設定のタブ(案 G、V4)、閲覧者の一覧の「閲覧のみ」表示(案 D、V3)
