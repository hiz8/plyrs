# 管理画面 UX 再構築 V2: 骨格(案 A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** テナント内の画面を、3 段のサイドバー・パンくずと `PageHeader`・シェル 1 か所の接続バナー・幅 960px 未満の上部バーとドロワーで組み直し、テナント選択画面を「サイト選択」に作り替える。

**Architecture:** シェル(`routes/t/$tenantSlug/route.tsx`)がサイドバー・上部バー・接続バナーを持ち、各画面は admin の `Page` 部品(`PageHeader` + シェルのバナー + 本文の余白)だけで組む。サイドバーの中身は同期済みの型定義(`useSyncTypes`)とモジュール一覧 API から純関数(`lib/nav.ts`)で作り、`nav:item` スロットはモジュール独自の画面だけに使う。シェル固有の部品は `apps/admin/src/components/shell/` に置き、再利用できる `Drawer` と `Avatar` は `packages/ui` に足す。

**Tech Stack:** TanStack Start / Router 1.171(SPA モード)、react-aria-components 1.21.1、StyleX 0.19.1(`@stylexjs/unplugin`)、lucide-react、TanStack Query、Vitest 4 + jsdom + Testing Library、Playwright

**Spec:**
- `docs/admin-ux/a-navigation.md`(案 A。3〜8 章が V2 の真実源)
- `docs/admin-ux/h-common-surface.md`(2 章 骨格、6 章 状態の表示、7 章 権限、10〜12 章)、`docs/admin-ux/h-design-tokens.md`(セマンティックトークン)
- `docs/superpowers/plans/2026-10-17-admin-ux-rebuild-roadmap.md` 5 章 V2
- キャンバス https://claude.ai/artifact/K57TVUfpefMuiPxhZXyAnU のページ「D2 骨格と主要 3 画面」(S1〜S8)。設計書と食い違うときは設計書を優先する。食い違いと裁定は Task 1 で設計書へ書き戻す

## 裁定(2026-10-19)

前セッションで伊地さんに確認したもの(1〜3)と、この計画で既定を選んだもの(4〜10)。4 以降は Task 1 で設計書に書き戻す。

1. **シェル部品の置き場**: サイドバーの項目・サイト名のトリガー・上部バーは `apps/admin/src/components/shell/` に置く。TanStack の `Link` と RAC の `Button` を直接使い、スタイルはセマンティックトークンだけ。`Drawer` と `Avatar` は `packages/ui` に足して design-sync する
2. **ホームの暫定(`/t/:slug/`)**: 利用者の型(`source: "user"`)があればサイドバーの並びで先頭の型の一覧へ転送する。型が無ければ、owner は設定のコンテンツタイプへ転送し、editor / viewer には h1「ホーム」と案内文だけの暫定画面を出す
3. **サイト選択の「最終ログイン」**: V2 では出さない。カードは頭文字・サイト名・役割バッジ・chevron-right。API の追加は範囲外(必要なら案 G / V4)
4. **寸法は尺度に寄せる**(V1 の 2026-10-18 裁定を V2 にも当てる): キャンバスと a-navigation.md 3.5 の 11px → 12px(`font.caption`)、13px → 14px(`font.body`)、15px → 16px(`font.label`)、10px → 12px(`space.inset`)、6px → 8px(`space.sm`)。部品固有の寸法(サイドバー幅 240px、項目の高さ 36 / 32 / 28px、上部バー 48px、アバター 24px、頭文字のマーク 40px、サイト選択の幅 520px、子項目の字下げ 40px)は数値で書き、コメントで根拠を添える
5. **メニューのアイコンは 20px**(h-common-surface.md 12 章。キャンバスの 16px は採らない)。役割バッジは `Badge`(`radius.badge` の長方形。キャンバスの pill は採らない)
6. **アカウントメニュー**は「メールアドレス(見出し)→ サイトを切り替え(所属が複数のときだけ)→ 区切り → ログアウト」。キャンバスの「アカウント設定」は案 G の画面ができる V4 で足す
7. **サイト切替メニュー**は見出し「サイトを切り替え」、各サイトの行(現在のサイトに check、役割を右に添える)、区切り、「サイト一覧を開く」(キャンバスにあり、設計書に無かったもの)
8. **型のアイコン**は利用者の型・モジュールの型とも `file-text`。モジュールの見出しにアイコンは付けない(型ごとのアイコンは a-navigation.md 10 章の未決事項のまま)
9. **見出しの右の主操作は V2 では動かさない**: 一覧の「新規レコード」などの既存の操作は本文に残し、`PageHeader` への移設と文言(「{型名}を追加」)は画面を作り直す V3 / V4 で行う。V2 の `Page` は `primaryAction` を受けられるようにだけしておく
10. **旧トークンの置き換え範囲**: V2 で作り直すファイル(シェル、サイト選択、ホーム、`components/shell/*`)はセマンティックトークンだけで書く。V3 / V4 で作り直す 8 画面は、見出しと接続バナーを `Page` に置き換え、その分の旧トークンのスタイル(`title` など)だけを消す。本文の旧トークンは V3 / V4 で置き換える

## Global Constraints

- 部品と画面が参照するのはセマンティックトークン(`@plyrs/ui/semantic.stylex`)だけ。V2 で新しく書くファイルは `@plyrs/ui/tokens.stylex` を import しない
- 1 画面に h1 は 1 つ。テナント内の画面の h1 は `Page`(= `PageHeader`)だけが出す
- 現在地の項目に `aria-current="page"`。子画面(作成・編集)では親の型の項目をハイライトする(a-navigation.md 3.4)
- 狭い画面の境目は `@media (max-width: 959px)`(`packages/ui/src/table.tsx` の `NARROW` と同じ値)
- アイコンは `lucide-react`。サイドバー・メニューは 20px(`ICON_SIZE.nav`)、本文・ボタン・バッジの中は 16px(`ICON_SIZE.inline`)、色は `currentColor`、装飾は `aria-hidden="true"`。アイコンのみのボタンは `IconButton`(`aria-label` 必須)
- 用語は `lib/labels.ts` の `TERMS` / `ROLE_LABELS` から引く。画面に「テナント」と出さない(「サイト」と呼ぶ)
- 権限の出し分けは `useCan`(`lib/use-can.ts`)。設定は `type:manage`、子項目の「新規追加」は `record:write` で判定する
- `@ts-expect-error` は使わない。依存の追加は無い(使うのは既存の react-aria-components・lucide-react・TanStack)
- packages/ui の公開 API を変えたら `index.ts` から export し、実装後に `.design-sync/NOTES.md` の再同期の手順で claude.ai/design の「plyrs Design System」を更新する(Task 14)
- コメント・ドキュメント・コミットメッセージは日本語。コミットは各タスクの最後に 1 つ(/commit スキルの規約)
- サンドボックスでは `corepack pnpm` を使う。ルートの `pnpm typecheck` / `pnpm test` は素の pnpm を呼ぶので、`corepack pnpm -r typecheck`、`corepack pnpm -r --filter "!@plyrs/e2e" test` で代える

## Review Focus

1. **所属 1 件の利用者の着地**: サイト選択を飛ばすと、ログイン直後に `/tenants` → `/t/:slug/` → ホームの転送が続く。型 0 件の owner は設定のコンテンツタイプ、型 0 件の editor はホームの案内、型ありは先頭の型の一覧に着くこと。Task 11 と Task 13 でテストする。E2E のヘルパー(`apps/e2e/helpers/setup.ts`)はこの着地に合わせて直す
2. **モジュール一覧・自分の情報の取得失敗**: サイドバーは `/v1/t/:id/modules` と `/auth/me` を新たに読む。どちらかが失敗しても、サイドバーはモジュールの見出しを出さない・アバターを「?」にするだけで、画面は落ちないこと。Task 9 でテストする
3. **ドロワーを開いたまま幅を広げる**: 960px 以上ではドロワーを閉じ、フォーカスの閉じ込めが残らないこと。項目を選んだとき・Esc・暗幕のタップでも閉じ、閉じたらメニューボタンへフォーカスが戻ること。Task 6 と Task 10 でテストする
4. **初回同期の前の接続中**: 初回同期の前(`hasSynced === false`)の `connecting` では接続バナーを出さない(各画面は読み込み中の表示を出している)。初回の接続が失敗した `closed` と、初回同期のあとの切断・再同期ではバナーを出すこと。Task 7 の `shouldShowConnectionBanner` でテストする
5. **サイドバーとページ内のリンクの名前の重複**: サイドバーに型名(「記事」)と「新規追加」のリンクが増えるため、既存テストの `getByRole("link", { name })` が複数に当たりうる。既存テストは `within(screen.getByRole("main"))` で本文に絞って直し、テストの意図は変えないこと(Task 9・12)

---

## ファイル構成

`packages/ui/src/`:

| ファイル | 責務 |
| --- | --- |
| `table.tsx` | 変更。選択列のセルと見出しにフォーカスの見た目を付ける |
| `menu.tsx` | 変更。`MenuItem` に右寄せの補足 `description` を足す |
| `avatar.tsx` | 新規。頭文字のアバター(24px の丸 / 40px の角丸の四角) |
| `drawer.tsx` | 新規。左から重なって開くドロワー(RAC の `ModalOverlay` / `Modal` / `Dialog`) |
| `index.ts` | 変更。`Avatar` / `Drawer` を export |

`apps/admin/src/`:

| ファイル | 責務 |
| --- | --- |
| `lib/stylex-dev.ts` | 新規。dev のときだけ StyleX の仮想 CSS と runtime を `<head>` に足す設定 |
| `lib/nav.ts` | 新規。サイドバーの中身・同期状態の表示・接続バナーの出し分け・パンくずを作る純関数 |
| `components/app-providers.tsx` | 新規。RAC の `I18nProvider`(ja-JP)・`RouterProvider`(TanStack Router へ接続)・`ToastRegion` |
| `components/shell/shell-banner.tsx` | 新規。シェルの接続バナーと、それを画面へ渡す context |
| `components/shell/page.tsx` | 新規。`Page`(`PageHeader` + シェルのバナー + 本文)と `PageBody` |
| `components/shell/nav-item.tsx` | 新規。サイドバーの項目・子項目・見出しの見た目 |
| `components/shell/site-switcher.tsx` | 新規。上段のサイト名とサイト切替メニュー |
| `components/shell/account-menu.tsx` | 新規。下段のアカウントボタンとメニュー |
| `components/shell/sync-indicator.tsx` | 新規。同期状態の点と短い表示 |
| `components/shell/sidebar.tsx` | 新規。3 段のサイドバー |
| `components/shell/top-bar.tsx` | 新規。幅 960px 未満の上部バーとドロワー |
| `components/connection-banner.tsx` | 削除(Task 12) |
| `routes/__root.tsx` | 変更。dev の StyleX、body の書体・色・地、`AppProviders` |
| `routes/t/$tenantSlug/route.tsx` | 変更。シェルを作り直す |
| `routes/t/$tenantSlug/index.tsx` | 変更。ホームの暫定 |
| `routes/tenants.tsx` | 変更。サイト選択画面 |
| `routes/t/$tenantSlug/{content,media,settings}/**` の 8 画面 | 変更。見出しと接続バナーを `Page` に置き換える |
| `router.tsx` | 変更。コアの `nav:item` 3 件の登録を消す |

`apps/e2e/helpers/setup.ts`: 変更。ログイン後の着地とサイト選択の見出し。

## タスクの依存

Task 1(設計書)→ Task 2〜6(前提と ui の部品。互いに独立)→ Task 7(純関数)→ Task 8(`Page` とバナー)→ Task 9(サイドバー)→ Task 10(上部バー。Task 6・9 を使う)→ Task 11(ホーム)→ Task 12(8 画面。Task 8 を使う)→ Task 13(サイト選択。Task 5 の `Avatar` を使う)→ Task 14(検証と同期)。

---

### Task 1: 設計書へ V2 の裁定を書き戻す

実装の根拠を設計書に一本化するため、コードより先に書き戻す(ロードマップ 1 章)。

**Files:**
- Modify: `docs/admin-ux/a-navigation.md`(3.1、3.3、3.4、3.5、5 章、8 章、10 章、11 章)
- Modify: `docs/admin-ux/h-common-surface.md`(3 章の部品の表、14 章)

- [ ] **Step 1: a-navigation.md 3.1 の切替メニューの段落を差し替える**

```markdown
- 切替メニューは見出し「サイトを切り替え」の下に各サイトを並べ、役割(管理者 / 編集者 / 閲覧者)を右に添え、現在のサイトにチェックを付ける。区切りの下に「サイト一覧を開く」(サイト選択画面へ)を置く。長いサイト名は 1 行で省略し、全文を `title` で出す(D2 で確定、V2 で「サイト一覧を開く」を追加)
```

- [ ] **Step 2: 3.3 のアカウントメニューの段落を差し替える**

```markdown
- サイドバーの最下部に置く。メニューは見出しのメールアドレス、「サイトを切り替え」(所属が複数のときだけ。サイト選択画面へ)、区切り、「ログアウト」。キャンバスの「アカウント設定」は案 G の画面と一緒に V4 で足す(2026-10-19)
```

同じ節の同期状態の段落の末尾に「初回同期の前は点を `text.muted` にし、状態の名前(接続中など)を出す。接続バナーは初回同期の後の切断・再同期と、初回接続の失敗のときだけ出す(V2)」を足す。

- [ ] **Step 3: 3.5 の表を尺度に寄せた値へ置き換える**

表の前に「キャンバスの 11 / 13 / 15px と余白 10 / 6px は V1 の裁定(h-design-tokens.md 7 章)に従い 12 / 14 / 16px と 12 / 8px に寄せる(2026-10-19)。部品固有の寸法は数値のまま」を足し、表を次にする。

```markdown
| 項目           | 値                                                                                                                                                                            |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| サイドバーの幅 | 240px 固定。`bg.surface`、右に `border.default`                                                                                                                               |
| 上段           | 「plyrs」12px(`font.caption`)600 `text.muted` + サイト名 36px(16px `font.label` 600)。所属が複数ならボタンにし、chevron-down 16px を添える。下に罫線                           |
| 中段の項目     | 高さ 36px(`size.control`)、アイコン 20px、左右 padding 12px(`space.inset`)、間 8px、角丸 `radius.item`、14px。見出し(コンテンツ / 予約)は 12px 600 `text.muted`                |
| 現在地         | `accent.surface` の塗り + `accent.default` の文字 500、`aria-current="page"`。枠線なし                                                                                         |
| 型の子項目     | 現在地の型だけ「一覧」「新規追加」を展開。高さ 32px、14px、字下げ 40px(アイコン 20 + 間 8 + 12)。現在でない子は `text.muted`、現在の子は塗りなしで `accent.default` の文字 500 |
| 下段           | 上に罫線。設定 36px(管理者のみ)→ 同期状態 28px(`size.controlSm`)→ アカウント 36px(頭文字のアバター 24px + メール + chevron-up)                                                |
| 本文上部       | `PageHeader`(V1)。左右 24px(`space.pageGutter`)                                                                                                                              |
| 狭い画面       | 上部バー 48px(部品固有の寸法)、`bg.surface`、下に罫線。メニューボタンは `IconButton`(menu 20px)。暗幕は上部バーの下から                                                            |
```

- [ ] **Step 4: 5 章の末尾に画面ごとのパンくずと見出しの表を足す**

```markdown
### 5.1 画面ごとのパンくずと見出し(V2、2026-10-19)

| 画面                   | パンくず                                          | 見出し(h1)                       |
| ---------------------- | ------------------------------------------------- | -------------------------------- |
| ホーム(暫定)           | ホーム                                            | ホーム                           |
| コンテンツの一覧       | ホーム › {型名}                                   | {型名}                           |
| コンテンツの新規追加   | ホーム › {型名} › 新規追加                        | {型名} を作成                    |
| コンテンツの編集       | ホーム › {型名} › 編集(閲覧者は「表示」)          | {型名} を編集                    |
| メディア               | ホーム › メディア                                 | メディア                         |
| コンテンツタイプ       | ホーム › 設定 › コンテンツタイプ                  | コンテンツタイプ                 |
| コンテンツタイプの作成 | ホーム › 設定 › コンテンツタイプ › 新規           | 新規コンテンツタイプ             |
| コンテンツタイプの編集 | ホーム › 設定 › コンテンツタイプ › {型名}         | コンテンツタイプを編集: {型名}   |
| モジュール             | ホーム › 設定 › モジュール                        | モジュール                       |

- 末尾(現在地)はリンクにしない(V1 の `Breadcrumbs`)
- 見出しの右の主操作(一覧の「{型名}を追加」など)と見出しの文言の見直しは、画面を作り直す V3 / V4 で行う
```

- [ ] **Step 5: 8 章の画面の形の段落を差し替える**

```markdown
- 画面の形(D2 で確定、V2 で一部変更): 地は `bg.surface`、中央に幅 520px の縦並び。「plyrs」、「サイトを選択」の見出し(h1)、「{メール} として N つのサイトに所属しています」の説明、サイトごとに 1 枚のカード(頭文字のマーク 40px、サイト名 16px 600、役割のバッジ、chevron-right)、下に「別のアカウントでログイン」のテキストリンク(ログアウトしてログイン画面へ)。頭文字のマークは将来のサイトアイコンの置き場で、地は全サイト `accent.surface`
- キャンバスにある「最終ログイン」は、テナント一覧の API が返さないため V2 では出さない(2026-10-19)。必要になったら案 G で API と一緒に扱う
- 所属が 0 件のときは「サイトは運営者が発行します」とだけ出す
```

- [ ] **Step 6: 10 章の型のアイコンの行を差し替え、11 章に決定ログを足す**

10 章: 「型ごとのアイコン(WordPress の Dashicons に相当)を持たせるか。V2 では利用者の型・モジュールの型とも Lucide の file-text を当てる(キャンバスの予約の calendar-check などは型の定義にアイコンが無いため採らない)」

11 章に追記:

```markdown
- 2026-10-19: V2 の計画で裁定。ホームの暫定(型あり → 先頭の型の一覧、型なし → owner は設定、他は案内)、サイト選択の最終ログインは出さない、寸法は尺度に寄せる(3.5)、アカウントメニューの「アカウント設定」は V4、サイト切替メニューに「サイト一覧を開く」、型のアイコンは file-text、画面ごとのパンくず(5.1)。シェル固有の部品は管理画面に置き、`Drawer` と `Avatar` は packages/ui に足す
```

- [ ] **Step 7: h-common-surface.md を直す**

3 章の部品の表に 2 行を足す(既存の行の形式に合わせる): 「アバター(頭文字) | サイドバーのアカウント、サイト選択のマーク | A」「ドロワー | 狭い画面のサイドバー | A」。14 章に「2026-10-19: V2 で `Avatar` と `Drawer` を追加し、`MenuItem` に右寄せの補足(サイト切替の役割)を足した。メニューのアイコンは 20px のまま(キャンバスの 16px は採らない)」を足す。

- [ ] **Step 8: コミット**

```bash
git add docs/admin-ux/a-navigation.md docs/admin-ux/h-common-surface.md
git commit -m "docs: 案 A と案 H に V2 の裁定を書き戻す"
```

---

### Task 2: dev サーバーで StyleX の CSS を配信する

V1 以前から、dev では StyleX の CSS が届かず画面がスタイル無しになる(本番ビルドは正常)。`@stylexjs/unplugin` は dev で HTML シェルへ仮想 CSS と runtime を差し込む必要がある(`node_modules/@stylexjs/unplugin/README.md` の「Dev HTML injection」)。

**Files:**
- Create: `apps/admin/src/lib/stylex-dev.ts`
- Test: `apps/admin/src/lib/stylex-dev.test.ts`
- Modify: `apps/admin/src/routes/__root.tsx`

**Interfaces:**
- Produces: `stylexDevHead(isDev: boolean): { links: Array<{ rel: "stylesheet"; href: string }>; scripts: Array<{ type: "module"; src: string }> }`

- [ ] **Step 1: 失敗するテストを書く**

```ts
describe("stylexDevHead", () => {
  it("adds the virtual stylesheet and runtime in dev", () => {
    expect(stylexDevHead(true)).toEqual({
      links: [{ rel: "stylesheet", href: "/virtual:stylex.css" }],
      scripts: [{ type: "module", src: "/@id/virtual:stylex:runtime" }],
    });
  });
  it("adds nothing in production builds", () => {
    expect(stylexDevHead(false)).toEqual({ links: [], scripts: [] });
  });
});
```

- [ ] **Step 2: テストが落ちることを確かめる**

Run: `corepack pnpm --filter @plyrs/admin exec vitest run src/lib/stylex-dev.test.ts`
Expected: FAIL(`stylexDevHead` が無い)

- [ ] **Step 3: `stylexDevHead` を実装し、`__root.tsx` の `head()` に混ぜる**

`head()` の `links` を `[{ rel: "stylesheet", href: appCss }, ...dev.links]`、`scripts` を `dev.scripts` にする(`const dev = stylexDevHead(import.meta.env.DEV)`)。TanStack の route `head` は `scripts` を受け、`HeadContent` が描画する。コメントで README の節を指す。

- [ ] **Step 4: テストが通ることを確かめる**

Run: `corepack pnpm --filter @plyrs/admin exec vitest run src/lib/stylex-dev.test.ts`
Expected: PASS

- [ ] **Step 5: dev サーバーで実際に CSS が届くことを確かめる**

Run(サンドボックス外): `corepack pnpm --filter @plyrs/admin dev` を起動し、別の端末で `curl -s http://localhost:5173/virtual:stylex.css | head -c 300` と `curl -s http://localhost:5173/login | grep -c "virtual:stylex"`。
Expected: CSS の本文(`.x` で始まる規則)が返り、HTML に 2 か所の参照がある。ブラウザで `/login` を開き、入力欄とボタンに V1 の見た目が当たっていること。

`<script src="/@id/virtual:stylex:runtime">` が CORS やプロキシで読めない場合(ブラウザのコンソールにエラー)は、README の代替どおり `apps/admin/src/stylex-dev-runtime.ts`(中身は `import("virtual:stylex:runtime")` の 1 行)を作り、`scripts` の `src` をそのファイル(`/src/stylex-dev-runtime.ts`)に替える。テストの期待値も合わせて直す。

- [ ] **Step 6: 本番ビルドに混ざらないことを確かめる**

Run: `corepack pnpm --filter @plyrs/admin build && grep -rl "virtual:stylex" apps/admin/dist || echo none`
Expected: `none`

- [ ] **Step 7: コミット**

```bash
git add apps/admin/src/lib/stylex-dev.ts apps/admin/src/lib/stylex-dev.test.ts apps/admin/src/routes/__root.tsx
git commit -m "fix(admin): dev サーバーで StyleX の CSS を配信する"
```

---

### Task 3: シェルの土台(body の書体・地、I18nProvider、RouterProvider、ToastRegion)

部品の CSS は body を指定しないため、部品の外の文字がブラウザ既定の明朝体になっている。RAC の内部文言(表の全選択など)を日本語に固定し(h-common-surface.md 5 章)、`Breadcrumbs` などの RAC の `Link` を TanStack Router の画面内遷移につなぎ、トーストの表示先をシェルに 1 か所置く。

**Files:**
- Create: `apps/admin/src/components/app-providers.tsx`
- Test: `apps/admin/src/components/app-providers.test.tsx`
- Modify: `apps/admin/src/routes/__root.tsx`

**Interfaces:**
- Produces: `AppProviders({ children }: { children: ReactNode }): JSX.Element`。`RootComponent` が `QueryClientProvider` の内側で `<AppProviders><Outlet /></AppProviders>` と使う
- Consumes: `ToastRegion` / `toaster`(`@plyrs/ui`)、`useRouter`(TanStack)

- [ ] **Step 1: 失敗するテストを書く**

テスト内で `createRootRoute` + `createRoute` の最小のルーター(`/` に `<Breadcrumbs items={[{ id: "a", label: "一覧", href: "/list" }, { id: "b", label: "今" }]} />`、`/list` に h1「一覧の画面」)を作り、ルートの component を `<AppProviders><Outlet /></AppProviders>` にする。

```tsx
it("routes RAC links through the TanStack router without a full page load", async () => {
  const router = renderMinimalRouter("/");
  const link = await screen.findByRole("link", { name: "一覧" });
  expect(link).toHaveAttribute("href", "/list");
  await userEvent.click(link);
  expect(await screen.findByRole("heading", { name: "一覧の画面" })).toBeInTheDocument();
  expect(router.state.location.pathname).toBe("/list");
});

it("fixes the RAC locale to ja-JP", async () => {
  // useLocale を読むだけの子を `/` に置く
  renderMinimalRouter("/", <LocaleProbe />);
  expect(await screen.findByText("ja-JP")).toBeInTheDocument();
});

it("renders toasts added to the shared toaster", async () => {
  renderMinimalRouter("/");
  act(() => {
    toaster.success("保存しました");
  });
  expect(await screen.findByRole("status")).toHaveTextContent("保存しました");
});
```

`toaster.success` が返す key を控え、テストの後で `toaster.close(key)` で閉じる(`toaster` は共有のため。V1 Review Focus 5)。

- [ ] **Step 2: テストが落ちることを確かめる**

Run: `corepack pnpm --filter @plyrs/admin exec vitest run src/components/app-providers.test.tsx`
Expected: FAIL(`AppProviders` が無い)

- [ ] **Step 3: `AppProviders` を実装する**

`I18nProvider locale="ja-JP"` → `RouterProvider navigate={(href, options) => router.navigate({ to: href, ...options })} useHref={(href) => router.buildLocation({ to: href }).href}` → `children` と `<ToastRegion />`。RAC の `RouterConfig` は `declare module "react-aria-components"` で `routerOptions` を TanStack の `NavigateOptions` から `to` を除いたものに型付けする(`href` は文字列のまま)。

- [ ] **Step 4: `__root.tsx` を直す**

`RootComponent` で `AppProviders` を使う。`RootShell` の `<body>` に `stylex.props(styles.body)` を当てる: `fontFamily: font.family`、`fontSize: font.body`、`lineHeight: font.lineHeightNormal`、`color: text.default`、`backgroundColor: bg.canvas`、`margin: 0`。

- [ ] **Step 5: テストが通ることを確かめる**

Run: `corepack pnpm --filter @plyrs/admin exec vitest run src/components/app-providers.test.tsx src/router.test.tsx src/shell.test.tsx`
Expected: PASS

- [ ] **Step 6: コミット**

```bash
git add apps/admin/src/components/app-providers.tsx apps/admin/src/components/app-providers.test.tsx apps/admin/src/routes/__root.tsx
git commit -m "feat(admin): シェルの土台に書体・日本語の locale・ルーター連携・トーストを置く"
```

---

### Task 4: 表の選択セルにフォーカスの見た目を付ける

V1 の最終レビューで「V2 で使う前に直す」とされた残り。表の行の選択列(`RacCell`)と見出しの全選択の列(`RacColumn`)は `className` が固定で、キーボードでフォーカスしても見た目が変わらない。

**Files:**
- Modify: `packages/ui/src/table.tsx`(`TableHeader` の選択列、`Row` の選択セル)
- Test: `packages/ui/src/table.test.tsx`

- [ ] **Step 1: 失敗するテストを書く**

`menu.test.tsx` の様式(フォーカス前後の `className` の差)で、選択付きの表(`selectionMode="multiple"`)を描き、Tab で表に入って矢印キーで行の選択セルへ移ったとき、そのセル(`role="gridcell"` の 1 列目)の `className` がフォーカス前と変わることを確かめる。全選択の列見出し(`role="columnheader"` の 1 列目)も同様。

```tsx
it("shows the focus ring on the selection cell", async () => {
  renderSelectableTable();
  const cell = within(screen.getAllByRole("row")[1]!).getAllByRole("gridcell")[0]!;
  const before = cell.className;
  await userEvent.tab();
  await userEvent.keyboard("{ArrowDown}{ArrowLeft}");
  expect(cell).toHaveFocus();
  expect(cell.className).not.toBe(before);
});
```

(`!` の代わりに既存テストの様式どおり明示のガードを使う。)

- [ ] **Step 2: テストが落ちることを確かめる**

Run: `corepack pnpm --filter @plyrs/ui exec vitest run src/table.test.tsx`
Expected: FAIL(className が変わらない)

- [ ] **Step 3: 選択セルと選択列に `stylexRenderProps` で `styles.focusVisible` を当てる**

`Cell` と同じく `CellRenderProps` / `ColumnRenderProps` の `isFocusVisible` で切り替える。

- [ ] **Step 4: テストが通ることを確かめる**

Run: `corepack pnpm --filter @plyrs/ui exec vitest run src/table.test.tsx`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add packages/ui/src/table.tsx packages/ui/src/table.test.tsx
git commit -m "fix(ui): 表の選択セルにフォーカスの見た目を付ける"
```

---

### Task 5: `MenuItem` の補足と `Avatar`

**Files:**
- Modify: `packages/ui/src/menu.tsx`
- Create: `packages/ui/src/avatar.tsx`
- Modify: `packages/ui/src/index.ts`
- Test: `packages/ui/src/menu.test.tsx`、`packages/ui/src/avatar.test.tsx`

**Interfaces:**
- Produces: `MenuItemProps` に `description?: string`(ラベルの右に 12px の `text.muted` で出す。現在の項目では `accent.default` を継ぐ)
- Produces: `Avatar({ label, size }: { label: string; size: "sm" | "lg" }): JSX.Element`。`sm` = 24px の丸(`radius.full`、文字 12px 600)、`lg` = 40px の角丸の四角(`radius.item`、文字 16px 600)。地 `accent.surface`、文字 `accent.default`。頭文字は `Array.from(label.trim())[0]` を大文字にしたもの、空なら「?」。`aria-hidden="true"`(名前は隣の文字が担う)

- [ ] **Step 1: 失敗するテストを書く**

```tsx
// menu.test.tsx
it("appends the description to the item's accessible name", async () => {
  renderMenu(<MenuItem id="b" description="編集者">Blog</MenuItem>);
  await openMenu();
  expect(screen.getByRole("menuitem", { name: "Blog 編集者" })).toBeInTheDocument();
});

// avatar.test.tsx
it.each([
  ["owner@example.com", "O"],
  ["  ブログ", "ブ"],
  ["😀 site", "😀"],
  ["", "?"],
])("shows the initial of %j as %j", (label, initial) => {
  const { container } = render(<Avatar label={label} size="sm" />);
  expect(container.firstElementChild).toHaveTextContent(initial);
  expect(container.firstElementChild).toHaveAttribute("aria-hidden", "true");
});
```

- [ ] **Step 2: テストが落ちることを確かめる**

Run: `corepack pnpm --filter @plyrs/ui exec vitest run src/menu.test.tsx src/avatar.test.tsx`
Expected: FAIL

- [ ] **Step 3: `description` と `Avatar` を実装し、`index.ts` から `Avatar` / `AvatarProps` を export する**

`description` はラベルの `span` の後ろ、`(現在)` の前に置く。寸法 24 / 40px はコメントで a-navigation.md 3.5・8 章を指す。

- [ ] **Step 4: テストが通ることを確かめる**

Run: `corepack pnpm --filter @plyrs/ui exec vitest run src/menu.test.tsx src/avatar.test.tsx`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add packages/ui/src/menu.tsx packages/ui/src/menu.test.tsx packages/ui/src/avatar.tsx packages/ui/src/avatar.test.tsx packages/ui/src/index.ts
git commit -m "feat(ui): メニューの項目の補足と頭文字のアバターを足す"
```

---

### Task 6: `Drawer`

狭い画面でサイドバーを入れるドロワー(a-navigation.md 3.4)。上部バーを隠さないよう、暗幕と本体は `top` の位置から下に重ねる。

**Files:**
- Create: `packages/ui/src/drawer.tsx`
- Modify: `packages/ui/src/index.ts`
- Test: `packages/ui/src/drawer.test.tsx`

**Interfaces:**
- Produces: `Drawer({ isOpen, onOpenChange, label, top, children }: { isOpen: boolean; onOpenChange: (isOpen: boolean) => void; label: string; top?: string; children: ReactNode }): JSX.Element`。RAC の `ModalOverlay`(`isDismissable`、地 `bg.overlay`、`position: fixed`、`top` から下、`zIndex: layer.modal`)+ `Modal`(左端、幅 240px、高さいっぱい、`bg.surface`、右に `border.default`、`elevation.modal`)+ `Dialog`(`aria-label={label}`)。`top` の既定は `"0"`

- [ ] **Step 1: 失敗するテストを書く**

```tsx
function Harness() {
  const [isOpen, setOpen] = useState(false);
  return (
    <>
      <Button onPress={() => setOpen(true)}>メニューを開く</Button>
      <Drawer isOpen={isOpen} onOpenChange={setOpen} label="メニュー" top="48px">
        <a href="#x">項目</a>
      </Drawer>
    </>
  );
}

it("opens as a labelled dialog and moves focus inside", async () => {
  render(<Harness />);
  await userEvent.click(screen.getByRole("button", { name: "メニューを開く" }));
  const dialog = screen.getByRole("dialog", { name: "メニュー" });
  expect(dialog).toContainElement(document.activeElement as HTMLElement);
});

it("closes on Escape and returns focus to the opener", async () => {
  render(<Harness />);
  const opener = screen.getByRole("button", { name: "メニューを開く" });
  await userEvent.click(opener);
  await userEvent.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(opener).toHaveFocus();
});

it("closes when the backdrop is pressed", async () => {
  render(<Harness />);
  await userEvent.click(screen.getByRole("button", { name: "メニューを開く" }));
  await userEvent.click(document.body); // ModalOverlay の外側の押下
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
```

暗幕の押下の再現は `dialog.test.tsx` の既存の様式があればそれに合わせる。

- [ ] **Step 2: テストが落ちることを確かめる**

Run: `corepack pnpm --filter @plyrs/ui exec vitest run src/drawer.test.tsx`
Expected: FAIL

- [ ] **Step 3: `Drawer` を実装し、`index.ts` から `Drawer` / `DrawerProps` を export する**

`dialog.tsx` の `ModalDialog` と同じ RAC の組み方にする。幅 240px はコメントで a-navigation.md 3.4 を指す。動きは付けない(`motion.*` は V3 以降で必要になったら)。

- [ ] **Step 4: テストが通ることを確かめる**

Run: `corepack pnpm --filter @plyrs/ui exec vitest run src/drawer.test.tsx`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add packages/ui/src/drawer.tsx packages/ui/src/drawer.test.tsx packages/ui/src/index.ts
git commit -m "feat(ui): 左から重なって開くドロワーを足す"
```

---

### Task 7: サイドバーとバナーの純関数(`lib/nav.ts`)

**Files:**
- Create: `apps/admin/src/lib/nav.ts`
- Test: `apps/admin/src/lib/nav.test.ts`

**Interfaces:**
- Consumes: `ContentTypeDefinition`(`@plyrs/metamodel`)、`ModuleSummary`(`lib/admin-api.ts`。`navTypes` は API が解決済みで、省略時はモジュールの全型がマニフェスト順で入る)、`SyncStatus`(`@plyrs/sync-client`)、`BreadcrumbItem`(`@plyrs/ui`)、`SYNC_STATUS_LABELS`(`lib/labels.ts`)
- Produces:
  - `interface NavTypeEntry { key: string; name: string }`
  - `contentNavEntries(types: readonly ContentTypeDefinition[]): NavTypeEntry[]` — `source === "user"` の型を、`menuOrder` の昇順(未設定は後ろ)→ 表示名の `localeCompare(…, "ja")` の順に並べる
  - `interface NavModuleGroup { moduleId: string; name: string; types: NavTypeEntry[] }`
  - `moduleNavGroups(types: readonly ContentTypeDefinition[], modules: readonly ModuleSummary[]): NavModuleGroup[]` — 有効なモジュールだけを API の順で。型は `navTypes` の順で、同期済みの型に無い key は飛ばす(型名は同期済みの型定義の `name`)
  - `type SyncIndicatorTone = "success" | "warning" | "muted"`
  - `syncIndicator(status: SyncStatus, hasSynced: boolean): { tone: SyncIndicatorTone; label: string }`
  - `shouldShowConnectionBanner(status: SyncStatus, hasSynced: boolean): boolean`
  - `siteBreadcrumbs(tenantSlug: string, trail: readonly { label: string; href?: string }[]): BreadcrumbItem[]` — 先頭に `{ id: "home", label: "ホーム", href: "/t/{slug}/" }` を置き、続く段の id は `"crumb-{index}"`。`trail` が空なら「ホーム」1 段だけで、その段は `href` を持たない(現在地)

- [ ] **Step 1: 失敗するテストを書く**

```ts
const type = (key: string, name: string, extra: Partial<ContentTypeDefinition> = {}) =>
  ({ id: key, key, name, source: "user", version: 1, fields: [], ...extra }) as ContentTypeDefinition;

describe("contentNavEntries", () => {
  it("keeps only user types, ordered by menuOrder then by Japanese name", () => {
    const types = [
      type("blog", "ブログ"),
      type("event", "イベント"),
      type("news", "お知らせ", { menuOrder: 1 }),
      type("asset", "アセット", { source: "system" }),
      type("booking.slot", "予約枠", { source: "plugin", pluginId: "booking" }),
    ];
    expect(contentNavEntries(types).map((entry) => entry.key)).toEqual(["news", "event", "blog"]);
  });
});

describe("moduleNavGroups", () => {
  const slot = type("booking.slot", "予約枠", { source: "plugin", pluginId: "booking" });
  const resource = type("booking.resource", "予約リソース", { source: "plugin", pluginId: "booking" });
  const booking = {
    moduleId: "booking", name: "予約", description: null,
    navTypes: ["booking.resource", "booking.slot", "booking.missing"],
    version: 1, enabled: true, appliedVersion: 1,
  };
  it("lists enabled modules with their nav types in manifest order", () => {
    expect(moduleNavGroups([slot, resource], [booking])).toEqual([
      { moduleId: "booking", name: "予約", types: [
        { key: "booking.resource", name: "予約リソース" },
        { key: "booking.slot", name: "予約枠" },
      ] },
    ]);
  });
  it("skips disabled modules", () => {
    expect(moduleNavGroups([slot], [{ ...booking, enabled: false }])).toEqual([]);
  });
});

describe("syncIndicator / shouldShowConnectionBanner", () => {
  it.each([
    ["ready", true, "success", "同期済み", false],
    ["connecting", false, "muted", "接続中", false],
    ["closed", false, "warning", "再接続しています…", true],
    ["connecting", true, "warning", "再接続しています…", true],
    ["syncing", true, "warning", "再接続しています…", true],
    ["closed", true, "warning", "再接続しています…", true],
  ] as const)("%s (hasSynced=%s)", (status, hasSynced, tone, label, banner) => {
    expect(syncIndicator(status, hasSynced)).toEqual({ tone, label });
    expect(shouldShowConnectionBanner(status, hasSynced)).toBe(banner);
  });
});

describe("siteBreadcrumbs", () => {
  it("starts from home and leaves the last crumb without a link", () => {
    expect(siteBreadcrumbs("blog", [{ label: "記事", href: "/t/blog/content/article" }, { label: "編集" }]))
      .toEqual([
        { id: "home", label: "ホーム", href: "/t/blog/" },
        { id: "crumb-0", label: "記事", href: "/t/blog/content/article" },
        { id: "crumb-1", label: "編集" },
      ]);
  });
  it("makes home the current crumb on the home screen", () => {
    expect(siteBreadcrumbs("blog", [])).toEqual([{ id: "home", label: "ホーム" }]);
  });
});
```

初回同期の前の `syncing` / `idle` は `muted` + `SYNC_STATUS_LABELS` の名前(バナーなし)。テストの表に `idle` の行も足す。

- [ ] **Step 2: テストが落ちることを確かめる**

Run: `corepack pnpm --filter @plyrs/admin exec vitest run src/lib/nav.test.ts`
Expected: FAIL

- [ ] **Step 3: `lib/nav.ts` を実装する**

- [ ] **Step 4: テストが通ることを確かめる**

Run: `corepack pnpm --filter @plyrs/admin exec vitest run src/lib/nav.test.ts`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add apps/admin/src/lib/nav.ts apps/admin/src/lib/nav.test.ts
git commit -m "feat(admin): サイドバーの中身と接続の表示を決める純関数を足す"
```

---

### Task 8: `Page` とシェルの接続バナー

画面ごとに置いている `ConnectionBanner` を、シェルの 1 か所で作って `PageHeader` の `banner` に差し込む形へ集約する(h-common-surface.md 6 章)。画面は `Page` を使うだけで、バナーを意識しない。

**Files:**
- Create: `apps/admin/src/components/shell/shell-banner.tsx`
- Create: `apps/admin/src/components/shell/page.tsx`
- Test: `apps/admin/src/components/shell/page.test.tsx`

**Interfaces:**
- Consumes: `shouldShowConnectionBanner`(Task 7)、`Banner` / `Button` / `PageHeader` / `BreadcrumbItem`(`@plyrs/ui`)
- Produces:
  - `ShellConnectionBanner({ status, hasSynced, onReconnect }: { status: SyncStatus; hasSynced: boolean; onReconnect: () => void }): JSX.Element | null`
  - `ShellBannerProvider({ banner, children }: { banner: ReactNode; children: ReactNode })` と `useShellBanner(): ReactNode`(Provider の外では `null`)
  - `interface PageProps { title: string; breadcrumbs?: BreadcrumbItem[]; primaryAction?: ReactNode; secondaryActions?: ReactNode; children: ReactNode }`
  - `Page(props: PageProps)` — `<PageHeader … banner={useShellBanner()} />` と、本文の `<div>`(padding `space.lg` / 左右 `space.pageGutter`)
  - `PageBody({ children }: { children: ReactNode })` — 見出しの無い状態(初回同期前の読み込み中など)の本文の余白だけ

- [ ] **Step 1: 失敗するテストを書く**

```tsx
it("renders the warning banner with the reconnect action", async () => {
  const onReconnect = vi.fn();
  render(<ShellConnectionBanner status="closed" hasSynced onReconnect={onReconnect} />);
  expect(screen.getByRole("status")).toHaveTextContent(
    "サーバーとの接続が切れています。再接続しています… 編集内容はこの端末に保存され、再接続後に送信されます",
  );
  await userEvent.click(screen.getByRole("button", { name: "今すぐ再接続" }));
  expect(onReconnect).toHaveBeenCalledOnce();
});

it("renders nothing while synced", () => {
  const { container } = render(<ShellConnectionBanner status="ready" hasSynced onReconnect={() => {}} />);
  expect(container).toBeEmptyDOMElement();
});

it("places the shell banner between the header and the body", () => {
  render(
    <ShellBannerProvider banner={<div role="status">切断中</div>}>
      <Page title="記事">本文</Page>
    </ShellBannerProvider>,
  );
  const heading = screen.getByRole("heading", { level: 1, name: "記事" });
  const banner = screen.getByRole("status");
  expect(heading.compareDocumentPosition(banner) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(banner.compareDocumentPosition(screen.getByText("本文")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});
```

- [ ] **Step 2: テストが落ちることを確かめる**

Run: `corepack pnpm --filter @plyrs/admin exec vitest run src/components/shell/page.test.tsx`
Expected: FAIL

- [ ] **Step 3: 実装する**

バナーの文言はテストのとおり(D2 S3)。「今すぐ再接続」は `Button variant="secondary" size="sm"`(`TenantSync.start()` は多重呼び出しに耐えるため、再接続中も押せてよい)。

- [ ] **Step 4: テストが通ることを確かめる**

Run: `corepack pnpm --filter @plyrs/admin exec vitest run src/components/shell/page.test.tsx`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add apps/admin/src/components/shell/shell-banner.tsx apps/admin/src/components/shell/page.tsx apps/admin/src/components/shell/page.test.tsx
git commit -m "feat(admin): 画面の骨格の Page とシェルの接続バナーを足す"
```

---

### Task 9: 3 段のサイドバー

**Files:**
- Create: `apps/admin/src/components/shell/nav-item.tsx`
- Create: `apps/admin/src/components/shell/site-switcher.tsx`
- Create: `apps/admin/src/components/shell/account-menu.tsx`
- Create: `apps/admin/src/components/shell/sync-indicator.tsx`
- Create: `apps/admin/src/components/shell/sidebar.tsx`
- Modify: `apps/admin/src/routes/t/$tenantSlug/route.tsx`
- Modify: `apps/admin/src/router.tsx`(コアの `nav:item` 3 件の登録を消す。コメントは「型・メディア・設定の項目はシェルが生成する(案 A 4 章)」に直す)
- Test: `apps/admin/src/shell.test.tsx`
- Modify(スタブの追加と、リンク名の重複の解消): `apps/admin/src/{asset-flow,content-type-builder,modules-page,publish-slots,records-flow,richtext-flow,router}.test.tsx`

**Interfaces:**
- Consumes: Task 5 の `Avatar` と `MenuItem` の `description`、Task 7 の `contentNavEntries` / `moduleNavGroups` / `syncIndicator`、Task 8 の `ShellBannerProvider` / `ShellConnectionBanner`、`useCan`、`tenantsQueryOptions` / `meQueryOptions` / `modulesQueryOptions`、`slots.get("nav:item")`
- Produces:
  - `interface SidebarProps { tenant: TenantSummary; tenants: readonly TenantSummary[]; email: string | null; types: readonly ContentTypeDefinition[]; modules: readonly ModuleSummary[]; navItems: readonly NavItemContribution[]; syncStatus: SyncStatus; hasSynced: boolean; onLogout: () => void }`
  - `Sidebar(props: SidebarProps)` — `<nav aria-label="メインナビゲーション">`。Task 10 がドロワーの中でも同じものを使う
  - `SyncIndicator({ status, hasSynced, compact }: { status: SyncStatus; hasSynced: boolean; compact?: boolean })` — `compact` は点だけ(`title` に表示名)。Task 10 の上部バーが使う

サイドバーの中身(a-navigation.md 3 章、寸法は Task 1 で直した 3.5):

- 上段: 「plyrs」、サイト名。所属が 2 件以上なら RAC の `Button` をトリガーにした `Menu`(`label="サイトを切り替え"`)。`MenuSection title="サイトを切り替え"` に各サイト(`id` = slug、`description` = `roleLabel(role)`、`isCurrent`)、`MenuSeparator`、`MenuItem id="__sites"`「サイト一覧を開く」。サイトを選ぶと `/t/$tenantSlug/` へ、「サイト一覧を開く」は `/tenants` へ移る。所属が 1 件なら文字だけ
- 中段(ここだけ縦にスクロール):
  - 「ホーム」(house)→ `/t/$tenantSlug/`
  - 見出し「コンテンツ」(`TERMS.content`)と `contentNavEntries` の各型(file-text)→ `/t/$tenantSlug/content/$typeKey`。現在の型(ルートの `typeKey` が一致)だけ子項目「一覧」(現在 = 一覧の画面)と「新規追加」(plus 16px。現在 = 作成画面。`useCan("record:write")` が偽なら出さない)を展開する。型が 0 件なら見出しの直下に、`useCan("type:manage")` なら「最初のコンテンツタイプを作成」(plus、`accent.default`、`/t/$tenantSlug/settings/content-types/new` へ)、そうでなければ「コンテンツの種類がまだありません。サイトの管理者に作成を依頼してください」(12px `text.muted`)
  - 「メディア」(image、`TERMS.media`)→ `/t/$tenantSlug/media`
  - `moduleNavGroups` の各モジュールに見出し(モジュール名)と型の項目(子項目の展開は利用者の型と同じ)、その下に `group === "module:{moduleId}"` の `nav:item`
  - `group` の無い `nav:item` は中段の最後
- 下段: `useCan("type:manage")` なら「設定」(settings)→ `/t/$tenantSlug/settings/content-types`(現在 = パスが `/t/{slug}/settings` で始まる)、その下に `group === "settings"` の `nav:item`。`SyncIndicator`(`role="status"`)。アカウントボタン(`Avatar size="sm" label={email ?? ""}` + メール(無ければ「アカウント」)+ chevron-up)で `Menu`(`placement="top start"`、`label="アカウント"`): `MenuSection title={email}`(メールが無ければ見出しなし)、所属が 2 件以上なら「サイトを切り替え」(chevrons-up-down、`/tenants` へ)、`MenuSeparator`、「ログアウト」(log-out)
- 現在地は `aria-current="page"` + `accent.surface` の塗り。判定は `useLocation().pathname` と `useParams({ strict: false }).typeKey`。`nav:item` は `UntypedLink` の境界 cast をそのまま使い、`params` に `tenantSlug` を重ねて束縛する(既存の契約)

シェル(`route.tsx`)はグリッド(`240px 1fr`、`minHeight: 100vh`)で `Sidebar` と `<main>` を並べ、`<main>` の中を `<TenantSyncProvider>` と `<ShellBannerProvider banner={<ShellConnectionBanner … onReconnect={() => tenantSync.start()} />}>` で包む。ヘッダー(「{テナント名}(テナント切替)」・同期のテキスト・再接続・ログアウトのボタン)は消す。同期の開始・停止、`online` での再開、ログアウトの処理は今のまま移す。モジュールは `useQuery(modulesQueryOptions(adminApi, tenant.id)).data ?? []`、所属は `useQuery(tenantsQueryOptions(api)).data ?? [tenant]`、メールは `useQuery(meQueryOptions(api)).data?.email ?? null`。

- [ ] **Step 1: 失敗するテストを書く(`shell.test.tsx`)**

既存の「renders nav from the slot registry, the tenant header…」は新しいシェルに合わせて置き換える。`authedRoutes` に `"/auth/me"`(`{ userId: "u1", email: "owner@example.com" }`)と `"/v1/t/t1/modules"`(`{ modules: [] }`)を足す。型は `records-flow.test.tsx` の `socketHarness` / `bootstrapped` の様式で同期経由で届ける(このファイルにも同じヘルパーを置く)。

```tsx
it("builds the three-tier sidebar from synced types", async () => {
  renderShell("/t/blog/content/article", { types: [articleType, newsType] });
  const nav = await screen.findByRole("navigation", { name: "メインナビゲーション" });
  expect(within(nav).getByRole("link", { name: "ホーム" })).toHaveAttribute("href", "/t/blog/");
  expect(within(nav).getByRole("link", { name: "記事" })).toHaveAttribute("aria-current", "page");
  expect(within(nav).getByRole("link", { name: "一覧" })).toHaveAttribute("aria-current", "page");
  expect(within(nav).getByRole("link", { name: "新規追加" })).toHaveAttribute("href", "/t/blog/content/article/new");
  // 現在でない型は子項目を展開しない
  expect(within(nav).getAllByRole("link", { name: "一覧" })).toHaveLength(1);
  expect(within(nav).getByRole("link", { name: "メディア" })).toHaveAttribute("href", "/t/blog/media");
  expect(within(nav).getByRole("link", { name: "設定" })).toHaveAttribute("href", "/t/blog/settings/content-types");
  expect(within(nav).getByRole("status")).toHaveTextContent("同期済み");
  expect(await within(nav).findByRole("button", { name: /owner@example.com/ })).toBeInTheDocument();
});

it("highlights the parent type while editing a record", async () => { /* /content/article/{id} → 「記事」が aria-current、「一覧」は aria-current なし */ });

it("hides settings and the new-item link from viewers", async () => { /* role: "viewer" → 「設定」「新規追加」が無い */ });

it("shows the create-first-type link to owners when there are no types", async () => {
  renderShell("/t/blog/settings/content-types", { types: [] });
  const nav = await screen.findByRole("navigation", { name: "メインナビゲーション" });
  expect(await within(nav).findByRole("link", { name: "最初のコンテンツタイプを作成" }))
    .toHaveAttribute("href", "/t/blog/settings/content-types/new");
});

it("asks editors to contact the admin when there are no types", async () => { /* role: "editor" → 案内文 */ });

it("groups enabled module types and module nav items under the module heading", async () => {
  /* modules: [booking(enabled, navTypes: ["booking.resource","booking.slot"])]、types に plugin の 2 型、
     slots.register("nav:item", { id: "booking.calendar", label: "予約カレンダー", to: "/t/$tenantSlug/media",
     group: "module:booking", order: 0 }) → 見出し「予約」の後に「予約リソース」「予約枠」「予約カレンダー」の順 */
});

it("switches sites from the site menu when the user belongs to several", async () => {
  /* tenants: [Blog(owner), Shop(editor)] → サイト名のボタン「Blog」を押す → menuitem「Blog 管理者 (現在)」、
     「Shop 編集者」を選ぶ → router.state.location.pathname が "/t/shop/" から始まる(先は Task 11 のホーム) */
});

it("shows the site name as plain text for a single site", async () => { /* ボタン「Blog」が無い */ });

it("keeps working when the module list and the profile fail to load", async () => {
  /* "/auth/me" と "/v1/t/t1/modules" が 500 → ナビは描画され、アカウントのボタン名は「アカウント」、モジュールの見出しなし */
});

it("logs out from the account menu", async () => { /* アカウント → 「ログアウト」 → /auth/logout が呼ばれ、見出し「ログイン」 */ });

it("shows a single connection banner in the page when the socket drops after sync", async () => {
  /* bootstrapped の後に socket を閉じる → role=status の「サーバーとの接続が切れています」が 1 つ、
     ナビの同期状態は「再接続しています…」 */
});
```

- [ ] **Step 2: テストが落ちることを確かめる**

Run: `corepack pnpm --filter @plyrs/admin exec vitest run src/shell.test.tsx`
Expected: FAIL

- [ ] **Step 3: `nav-item.tsx` / `sync-indicator.tsx` / `site-switcher.tsx` / `account-menu.tsx` / `sidebar.tsx` を実装し、`route.tsx` と `router.tsx` を直す**

スタイルはセマンティックトークンだけ(裁定 4・10)。上段と下段は固定し、中段だけ `overflowY: "auto"`。長いサイト名とメールは 1 行で省略し、`title` に全文。

- [ ] **Step 4: シェルのテストが通ることを確かめる**

Run: `corepack pnpm --filter @plyrs/admin exec vitest run src/shell.test.tsx`
Expected: PASS

- [ ] **Step 5: 既存のテストを直す**

Run: `corepack pnpm --filter @plyrs/admin test`
落ちるテストは次の 2 種類だけのはず。それ以外で落ちたら実装を疑う。
- スタブに無い `/auth/me` / `/v1/t/t1/modules` の取得: 各ファイルの `authedRoutes` に Step 1 と同じスタブを足す
- リンク名の重複(サイドバーの「記事」「新規追加」など): `within(screen.getByRole("main"))` で本文に絞る

Expected: 全件 PASS

- [ ] **Step 6: コミット**

```bash
git add apps/admin/src/components/shell apps/admin/src/routes/t/\$tenantSlug/route.tsx apps/admin/src/router.tsx apps/admin/src/*.test.tsx
git commit -m "feat(admin): 3 段のサイドバーでシェルを作り直す"
```

---

### Task 10: 幅 960px 未満の上部バーとドロワー

**Files:**
- Create: `apps/admin/src/components/shell/top-bar.tsx`
- Modify: `apps/admin/src/routes/t/$tenantSlug/route.tsx`
- Test: `apps/admin/src/shell.test.tsx`

**Interfaces:**
- Consumes: `Drawer`(Task 6)、`Sidebar` / `SidebarProps` / `SyncIndicator`(Task 9)、`IconButton`
- Produces: `TopBar({ sidebar }: { sidebar: SidebarProps })` — 48px のバー(`IconButton` menu 20px、`aria-label` は閉じているとき「メニューを開く」/ 開いているとき「メニューを閉じる」、`aria-expanded`)、「plyrs」、サイト名(文字だけ。切替はドロワーの上段から)、`SyncIndicator compact`。ボタンで `Drawer`(`label="メニュー"`、`top="48px"`)を開き、中に `Sidebar` を描く

シェルは狭い画面(`@media (max-width: 959px)`)でグリッドを 1 列にし、常設の `Sidebar` を `display: none`、`TopBar` を表示する。広い画面では `TopBar` を `display: none`。ドロワーは次のとき閉じる: 暗幕・Esc(`Drawer`)、`useLocation().pathname` が変わったとき(項目の選択)、`window.matchMedia("(min-width: 960px)")` が一致に変わったとき。

- [ ] **Step 1: 失敗するテストを書く**

```tsx
it("opens the drawer from the top bar and closes it after navigating", async () => {
  renderShell("/t/blog/content/article", { types: [articleType] });
  const toggle = await screen.findByRole("button", { name: "メニューを開く" });
  expect(toggle).toHaveAttribute("aria-expanded", "false");
  await userEvent.click(toggle);
  const drawer = screen.getByRole("dialog", { name: "メニュー" });
  await userEvent.click(within(drawer).getByRole("link", { name: "メディア" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "メニュー" })).not.toBeInTheDocument());
});

it("closes the drawer when the viewport becomes wide", async () => {
  /* window.matchMedia をテスト内で差し替え、change イベントで matches: true を流す → dialog が消える */
});
```

jsdom はメディアクエリを評価しないため、両方のナビが DOM にある前提で `within(drawer)` に絞る。jsdom に `window.matchMedia` が無ければ、既存の `src/lib/theme.test.ts` の差し替えの様式に合わせる。

- [ ] **Step 2: テストが落ちることを確かめる**

Run: `corepack pnpm --filter @plyrs/admin exec vitest run src/shell.test.tsx`
Expected: FAIL

- [ ] **Step 3: `top-bar.tsx` を実装し、`route.tsx` のグリッドに組み込む**

- [ ] **Step 4: テストが通ることを確かめる**

Run: `corepack pnpm --filter @plyrs/admin exec vitest run src/shell.test.tsx`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add apps/admin/src/components/shell/top-bar.tsx apps/admin/src/routes/t/\$tenantSlug/route.tsx apps/admin/src/shell.test.tsx
git commit -m "feat(admin): 狭い画面の上部バーとドロワーを足す"
```

---

### Task 11: ホームの暫定(`/t/:slug/`)

裁定 2。案 B のホーム(V4)ができるまでの暫定。

**Files:**
- Modify: `apps/admin/src/routes/t/$tenantSlug/index.tsx`
- Test: `apps/admin/src/shell.test.tsx`

**Interfaces:**
- Consumes: `contentTypesQueryOptions`(`lib/queries.ts`)、`contentNavEntries`(Task 7)、`can`(`lib/permissions.ts`)、`Page` / `siteBreadcrumbs`
- 判定は `beforeLoad` で行う: 親の `beforeLoad` が返す `context.tenant` を使い、`context.queryClient.fetchQuery(contentTypesQueryOptions(context.adminApi, tenant.id))` で型を取る(`ensureQueryData` は作成直後の古い一覧を返しうるため。`tenants.tsx` の loader のコメントと同じ理由)。同期は画面の描画後に始まるため、転送の判定には HTTP の一覧を使う

- [ ] **Step 1: 失敗するテストを書く**

```tsx
it("forwards home to the first content type list", async () => {
  const router = renderAt("/t/blog/", authedRoutes()); // 型: 記事(user)
  await waitFor(() => expect(router.state.location.pathname).toBe("/t/blog/content/article"));
});

it("forwards an owner without content types to the content type settings", async () => {
  const router = renderAt("/t/blog/", authedRoutes({ "/v1/t/t1/content-types": vi.fn(() => jsonResponse(200, { contentTypes: [] })) }));
  await waitFor(() => expect(router.state.location.pathname).toBe("/t/blog/settings/content-types"));
});

it("shows a placeholder home to an editor without content types", async () => {
  /* role: "editor"、型 0 件 → h1「ホーム」、本文に「コンテンツの種類がまだありません。サイトの管理者に作成を依頼してください」、
     パンくずの「ホーム」はリンクでない */
});
```

既存の「/t/:slug/ は設定のコンテンツタイプへ」を確かめているテストがあれば、上の 3 件に置き換える。

- [ ] **Step 2: テストが落ちることを確かめる**

Run: `corepack pnpm --filter @plyrs/admin exec vitest run src/shell.test.tsx`
Expected: FAIL

- [ ] **Step 3: `index.tsx` を実装する**

型あり → `redirect({ to: "/t/$tenantSlug/content/$typeKey", params: { tenantSlug, typeKey } })`、型なしで `can(tenant.role, "type:manage")` → `redirect({ to: "/t/$tenantSlug/settings/content-types", params })`、それ以外は `component` で `<Page title="ホーム" breadcrumbs={siteBreadcrumbs(slug, [])}>` と案内文。

- [ ] **Step 4: テストが通ることを確かめる**

Run: `corepack pnpm --filter @plyrs/admin exec vitest run src/shell.test.tsx`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add apps/admin/src/routes/t/\$tenantSlug/index.tsx apps/admin/src/shell.test.tsx
git commit -m "feat(admin): ホームの暫定の転送と案内を入れる"
```

---

### Task 12: 8 画面の見出しとバナーを `Page` に置き換える

裁定 9・10。見出し・パンくず・接続バナーだけを置き換え、本文は触らない。

**Files:**
- Modify: `apps/admin/src/routes/t/$tenantSlug/content/$typeKey/{index,new,$recordId}.tsx`
- Modify: `apps/admin/src/routes/t/$tenantSlug/media/index.tsx`
- Modify: `apps/admin/src/routes/t/$tenantSlug/settings/content-types/{index,new,$typeKey.edit}.tsx`
- Modify: `apps/admin/src/routes/t/$tenantSlug/settings/modules/index.tsx`
- Delete: `apps/admin/src/components/connection-banner.tsx`
- Test: `apps/admin/src/{records-flow,asset-flow,content-type-builder,modules-page}.test.tsx`

各画面で:
- `<ConnectionBanner … />` と `<h1>` / `<h2>`(モジュール)を消し、本文を `<Page title breadcrumbs>` で包む。パンくずと見出しは Task 1 で足した a-navigation.md 5.1 の表のとおり(`siteBreadcrumbs` を使う。型名は同期済みの型定義の `name`)
- 編集画面のパンくずの末尾は `useCan("record:write")` が偽なら「表示」、真なら「編集」
- メディアの見出しは「アセット」から「メディア」(`TERMS.media`)にする
- 初回同期前の「同期中…」と「未知のコンテンツタイプです」の早期 return は `PageBody` で包む(表示の作り直しは V3)
- 不要になった `title` のスタイルと、使わなくなった旧トークンの import を消す。本文で使う旧トークンは残す

- [ ] **Step 1: 失敗するテストを書く**

`records-flow.test.tsx` に:

```tsx
it("shows breadcrumbs and a single h1 on the record editor", async () => {
  /* /t/blog/content/article/{RECORD_1} → パンくず nav「パンくず」に「ホーム」「記事」のリンクと現在地「編集」、
     h1 は 1 つで「記事 を編集」 */
});
```

`modules-page.test.tsx` に「モジュールの画面の見出しが h1」、`asset-flow.test.tsx` に「見出しが『メディア』」、`content-type-builder.test.tsx` に「パンくずが ホーム › 設定 › コンテンツタイプ」を足す。

- [ ] **Step 2: テストが落ちることを確かめる**

Run: `corepack pnpm --filter @plyrs/admin exec vitest run src/records-flow.test.tsx src/modules-page.test.tsx src/asset-flow.test.tsx src/content-type-builder.test.tsx`
Expected: FAIL

- [ ] **Step 3: 8 画面を直し、`connection-banner.tsx` を消す**

`grep -rn "ConnectionBanner\|connection-banner" apps/admin/src` が 0 件になること。

- [ ] **Step 4: admin の全テストが通ることを確かめる**

Run: `corepack pnpm --filter @plyrs/admin test`
Expected: 全件 PASS(既存テストで見出し「アセット」を待つものがあれば「メディア」に直す)

- [ ] **Step 5: コミット**

```bash
git add -A apps/admin/src
git commit -m "feat(admin): 各画面の見出しとパンくずと接続バナーを Page に揃える"
```

---

### Task 13: サイト選択画面

a-navigation.md 8 章(Task 1 で直したもの)。

**Files:**
- Modify: `apps/admin/src/routes/tenants.tsx`
- Test: `apps/admin/src/auth-flow.test.tsx`、`apps/admin/src/shell.test.tsx`
- Modify: `apps/e2e/helpers/setup.ts`

**Interfaces:**
- Consumes: `Avatar size="lg"`(Task 5)、`Badge`、`roleLabel`、`meQueryOptions`、`resetClientSession`

画面: 地 `bg.surface`、中央に幅 520px(`maxWidth`)、上下 48px(部品固有の寸法。セマンティックに 48px の余白が無いため数値で書く)。「plyrs」(12px 600 `text.muted`)、h1「サイトを選択」(`font.pageTitle` 600)、説明「{メール} として {N} つのサイトに所属しています」(メールが取れなければ「{N} つのサイトに所属しています」、14px `text.muted`)。カードは `<ul>` の各 `<li>` に 1 枚の `Link`(`/t/$tenantSlug/`):`Avatar size="lg" label={name}`、サイト名 16px 600(1 行で省略、`title` に全文)、`Badge`(owner は `tone="accent"`、他は `"neutral"`)、chevron-right 16px。カードは `bg.canvas`、`border.default` の枠、`radius.container`、ホバーで `border.hover` + `elevation.menu`、フォーカスは `focus.ring`。下に「別のアカウントでログイン」(`Button variant="link"`。ログアウトしてから `/login`)。0 件なら「サイトは運営者が発行します」だけを出す(説明とカードは出さない)。

loader: 所属が 1 件なら `redirect({ to: "/t/$tenantSlug/", params: { tenantSlug } })`(a-navigation.md 8 章)。

- [ ] **Step 1: 失敗するテストを書く(`auth-flow.test.tsx`)**

見出し「テナントを選択」を待つ既存の箇所は「サイトを選択」に、「テナントは運営者が発行します」は「サイトは運営者が発行します」に直す。「lists tenants as links into the shell」は次に置き換える。

```tsx
it("lists sites as cards with Japanese role names and no slug", async () => {
  const tenants = vi.fn(() => jsonResponse(200, { tenants: [
    { id: "t1", slug: "blog", name: "Blog", role: "owner" },
    { id: "t2", slug: "shop", name: "Shop", role: "editor" },
  ] }));
  renderAt("/tenants", {
    "/auth/tenants": tenants,
    "/auth/me": vi.fn(() => jsonResponse(200, { userId: "u1", email: "owner@example.com" })),
  });
  expect(await screen.findByRole("heading", { level: 1, name: "サイトを選択" })).toBeInTheDocument();
  expect(await screen.findByText("owner@example.com として 2 つのサイトに所属しています")).toBeInTheDocument();
  const blog = screen.getByRole("link", { name: /Blog/ });
  expect(blog).toHaveAttribute("href", "/t/blog/");
  expect(blog).toHaveTextContent("管理者");
  expect(blog).not.toHaveTextContent("blog /");
  expect(screen.getByRole("link", { name: /Shop/ })).toHaveTextContent("編集者");
});

it("skips the chooser when the user belongs to a single site", async () => {
  /* tenants: [Blog] → /tenants を開くと pathname が "/t/blog/" から始まる(Task 11 の転送でさらに先へ進んでよい) */
});

it("logs in again with another account", async () => {
  /* 2 件 → 「別のアカウントでログイン」→ /auth/logout が呼ばれ、見出し「ログイン」 */
});
```

ログイン後・サインアップ後に「サイトを選択」を待つ既存のテストは、所属 0 件のスタブのまま見出しだけを直す。

- [ ] **Step 2: テストが落ちることを確かめる**

Run: `corepack pnpm --filter @plyrs/admin exec vitest run src/auth-flow.test.tsx`
Expected: FAIL

- [ ] **Step 3: `tenants.tsx` を作り直す**

- [ ] **Step 4: admin の全テストが通ることを確かめる**

Run: `corepack pnpm --filter @plyrs/admin test`
Expected: 全件 PASS(`shell.test.tsx` の「所属しない slug は /tenants へ」は、所属 1 件のスタブだと /tenants がさらに唯一のサイトへ転送する。期待を「pathname が `/t/blog/` から始まる」に直すか、所属 2 件のスタブにして見出し「サイトを選択」を待つ)

- [ ] **Step 5: E2E のヘルパーを直す**

E2E の利用者は所属 1 件・型 0 件の owner のため、ログイン後は サイト選択を飛ばしてホーム → 設定のコンテンツタイプへ着く。
- `loginAsUser`: 見出し「テナントを選択」の待ちを、見出し「コンテンツタイプ」の待ちに替える
- `createArticleType`: 先頭の `page.getByRole("link", { name: tenantName }).click()` と直後の見出しの待ちを消す(引数 `tenantName` は呼び出し元とあわせて消す。`core-journey.spec.ts` / `two-tab-sync.spec.ts`)。「新規コンテンツタイプ」のリンクはサイドバーの「最初のコンテンツタイプを作成」と名前が違うため、そのままでよい
- コメントの「テナント選択ページから」を「ログイン後の着地(設定のコンテンツタイプ)から」に直す

- [ ] **Step 6: コミット**

```bash
git add apps/admin/src/routes/tenants.tsx apps/admin/src/auth-flow.test.tsx apps/admin/src/shell.test.tsx apps/e2e
git commit -m "feat(admin): テナント選択をサイト選択の画面に作り替える"
```

---

### Task 14: 全体の検証、design-sync、preview での確認

**Files:**
- Modify: `docs/superpowers/plans/2026-10-17-admin-ux-rebuild-roadmap.md`(5 章の V2 の行に「**完了**」と計画へのリンク)
- Modify: `.design-sync/` 配下(再同期の手順が生成・更新するもの)

- [ ] **Step 1: 静的検査とテストを全部通す**

Run: `corepack pnpm lint && corepack pnpm format:check && corepack pnpm -r typecheck && corepack pnpm -r --filter "!@plyrs/e2e" test`
Expected: すべて成功

- [ ] **Step 2: ビルドと E2E**

Run(サンドボックス外): `corepack pnpm --filter @plyrs/admin build && corepack pnpm --filter @plyrs/e2e test`
Expected: ビルド成功(`routeTree.gen.ts` に差分が出たらコミットに含める)、E2E の 3 spec が PASS

- [ ] **Step 3: dev で見た目を確かめる**

Run(サンドボックス外): `corepack pnpm --filter @plyrs/admin dev`。owner と editor、所属 1 件と 2 件、型 0 件と 12 件、ライトとダーク、幅 1280px と 800px で、サイドバー・上部バーとドロワー・パンくず・切断時のバナー(dev サーバーの api を止めて確かめる)・サイト選択を撮影し、キャンバスの D2(S1〜S8)と見比べる。設計書と違う箇所があれば直し、キャンバスとの違いは裁定どおりであることを確かめる

- [ ] **Step 4: design-sync**

`.design-sync/NOTES.md` の再同期の手順で、`Avatar` / `Drawer` / `MenuItem` の `description` / 表の選択セルの変更を claude.ai/design の「plyrs Design System」へ反映する

- [ ] **Step 5: ロードマップを更新してコミット**

```bash
git add docs/superpowers/plans/2026-10-17-admin-ux-rebuild-roadmap.md .design-sync
git commit -m "docs: ロードマップの V2 を完了にし、packages/ui を再同期する"
```

- [ ] **Step 6: main へ入れたあと preview で実機確認する**

ロードマップ 5 章と CLAUDE.md の注意(dev / E2E が緑でも SPA シェルが実機で壊れうる)のとおり、main への push で preview(https://plyrs-admin-preview.hiz.workers.dev/)にデプロイされたら、`/login` → サイト選択 → ホームの転送 → サイドバーの各項目、旧 URL(`/t/:slug/records/:typeKey`)のリダイレクト、ページの再読み込み(`/_shell` の配信)、幅 800px のドロワーを確かめる。HTML に `virtual:stylex` が含まれないことも確かめる
