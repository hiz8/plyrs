# 管理画面 UX 再構築 V1: 共通の土台(案 H) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `packages/ui` に 3 層のデザイントークン・テーマ切り替えの仕組み・共通部品 15 種と `PageHeader` を用意し、既存 7 部品を D1 の見た目へ揃える。既存画面は旧トークン名の別名で見た目を保ったまま動かす。

**Architecture:** プリミティブ(`primitives.stylex.ts`)とセマンティック(`semantic.stylex.ts`)を StyleX の `defineVars` で定義し、ライト / ダークはセマンティックの値に `light-dark()` で持たせ、ルートの `color-scheme` で選ぶ。旧 `colors` / `spacing` / `typography`(`tokens.stylex.ts`)はセマンティックを参照する別名に置き換える。部品は react-aria-components を土台に、見た目だけを StyleX + セマンティックトークンで作る。

**Tech Stack:** StyleX 0.19.1(`@stylexjs/unplugin`)、react-aria-components 1.21.1、lucide-react ^1.55.0、Vitest 4 + jsdom + Testing Library、TanStack Start(admin)

**Spec:**
- `docs/admin-ux/h-design-tokens.md`(2〜5 章が値と実装方式の真実源)
- `docs/admin-ux/h-common-surface.md`(2 章 骨格、3 章 部品一覧、11 章 アクセシビリティ、12 章 アイコン、14 章 決定ログ)
- `docs/superpowers/plans/2026-10-17-admin-ux-rebuild-roadmap.md` 5 章 V1
- キャンバス https://claude.ai/artifact/K57TVUfpefMuiPxhZXyAnU のページ「D1 デザインシステム」(ボード 3a〜3f、4)。設計書と食い違うときは設計書を優先する

## Global Constraints

- 部品と画面が参照するのはセマンティックトークンだけ。プリミティブは `semantic.stylex.ts` からだけ参照する。`packages/ui` の `package.json` の `exports` にプリミティブは出さない
- 値は尺度に寄せる(2026-10-18 裁定): キャンバスの 13px → 14px、11px → 12px、余白 10px → 12px、6px → 8px、5px → 4px、14px → 12px、20px → 24px、28px → 32px、40px → 32px、ダイアログの題は 20px。部品固有の寸法(アイコンの大きさ、チェックボックスの箱 16px、公開状態の点 6px、ダイアログ幅 440px、トースト幅 400px、メニューの最小幅 200px、テキストエリアの最小高 96px、エディタ本文の最小高 120px)だけは部品内に数値で書き、コメントで根拠を添える
- フォームのラベルは 14px / 500(`font.body` + `font.weightMedium`)(2026-10-18 裁定)。`font.label`(16px)はフォーム内の小見出しと空状態の題に使う
- 入力欄のフォーカスは `focus.ring`(2px、2px 外側)だけで示し、枠線の色は変えない。枠線の色は通常(`border.default`)/ ホバー(`border.hover`)/ エラー(`status.danger`)の区別にだけ使う
- バッジとタブの件数は `radius.badge`(4px)の長方形。ボタンはすべて `radius.button`(pill)
- 浮いた面(`bg.raised`: メニュー・Select の候補・モーダル・トースト・メンションの候補)は常に `border.default` の 1px の枠線と `elevation.*` を伴う。トーストの地も `bg.raised`(キャンバスの successSurface / dangerSurface の地は採らない。状態はアイコンの色で示す)
- `elevation.*` は影の色だけを `light-dark()` で切り替える(2026-10-18 裁定)。形は shadow1/3、shadow2/4 で共通
- キャンバスの `bg.control` は使わず `bg.canvas` に読み替える
- 無効状態は `opacity: 0.5`。フォーカスの見た目はボタン類は `isFocusVisible`、入力欄は `isFocused` で出す
- アイコンは `lucide-react`。大きさは本文・ボタン・バッジの中 16px、メニュー 20px、空状態 32px(線幅 1.75)、それ以外は線幅 2。色は `currentColor`。装飾のアイコンには `aria-hidden` を付ける。アイコンのみのボタンは `IconButton`(`aria-label` 必須 + 同じ文言のツールチップ)を使う
- トーストは RAC の `UNSTABLE_Toast*` を `packages/ui/src/toast.tsx` だけで import して包む(2026-10-18 裁定)。成功は `role="status"`、エラーは `role="alert"`
- テーマ切り替えは仕組みと部品(`ThemeSelect`)まで。画面への配置は V4 のアカウント設定(案 G 6.2)で行う(2026-10-18 裁定)
- 既存の公開 API(`Button` の `variant` 3 種、`TextField` / `TextArea` / `Select` / `Checkbox` / `CheckboxGroup` / `RichTextEditor` の props とアクセシブルな名前)は壊さない。admin の既存テストが無修正で通ること
- `@ts-expect-error` は使わない。依存は `pnpm-workspace.yaml` の `catalog:` に追加し、各 package.json は `"catalog:"` で参照する(`minimumReleaseAge: 10080` があるため、公開から 7 日経った版を下限にする)
- コメント・ドキュメント・コミットメッセージは日本語。コミットは各タスクの最後に 1 つ(/commit スキルの規約)

## Review Focus

1. **テーマの自動(color-scheme 未指定)**: `:root` に `color-scheme: light dark` が無いと `light-dark()` は常にライトを選ぶ。OS がダークの利用者が V1 後にライトへ戻ってしまう。Task 3 で `styles.css` の宣言と、それを確かめるテストを置く
2. **必須の札がアクセシブルな名前に混ざる**: ラベルの中に「必須」を置くと `getByLabelText("タイトル")` が admin の既存テストで外れる。Task 4 で札を `aria-hidden` にし、名前が変わらないことをテストする
3. **ストレージが使えない環境**: プライベートウィンドウ等で `localStorage` が例外を投げてもテーマの読み書きで画面が落ちないこと。Task 3 でテストする
4. **ツールチップの中のボタンの slot**: `IconButton` を `slot="close"` で使う(ダイアログ・トースト)と、ツールチップの包みで slot が届かず閉じられない恐れ。Task 11・12 で「閉じる」で実際に閉じることをテストする
5. **トーストのキューがテスト間で共有される**: モジュール単位の既定キューを使うとテストが互いに干渉する。Task 12 で `createToaster()` を各テストで作り、互いに見えないことをテストする

---

## ファイル構成

`packages/ui/src/`:

| ファイル                    | 責務                                                                                                 |
| --------------------------- | ---------------------------------------------------------------------------------------------------- |
| `primitives.stylex.ts`      | 新規。プリミティブトークン(h-design-tokens.md 2 章)                                                  |
| `semantic.stylex.ts`        | 新規。セマンティックトークン(3 章)。`light-dark()` でテーマの対を持つ                                |
| `tokens.stylex.ts`          | 変更。旧 `colors` / `spacing` / `typography` をセマンティックの別名にする                            |
| `tokens-build.test.ts`      | 新規。実トークンを Vite でビルドし、出力 CSS の形を確かめる                                          |
| `test-utils/tokens-entry.ts` | 新規。上のテストのビルド入口                                                                        |
| `icon.ts`                   | 新規。アイコンの大きさと線幅の定数                                                                   |
| `field.tsx`                 | 新規。フォーム部品が共用するラベル・説明・エラー表示                                                 |
| `button.tsx`                | 変更。5 種 + 小型 + アイコン付き。`IconButton` を追加                                                |
| `tooltip.tsx`               | 新規。ツールチップ                                                                                   |
| `text-field.tsx` / `text-area.tsx` / `select.tsx` / `checkbox.tsx` / `checkbox-group.tsx` / `rich-text-editor.tsx` | 変更。D1 の見た目へ |
| `badge.tsx`                 | 新規。バッジ(公開状態の点・アイコン付き・取り消し線・等幅)                                         |
| `banner.tsx` / `empty-state.tsx` / `skeleton.tsx` | 新規                                                                           |
| `progress.tsx`              | 新規。`ProgressBar` と `Spinner`                                                                     |
| `relative-time.tsx`         | 新規。相対時刻 + ツールチップの日時(書式は admin の `lib/datetime.ts` が作る)                       |
| `dialog.tsx`                | 新規。`ModalDialog` と `ConfirmDialog`                                                               |
| `toast.tsx`                 | 新規。`createToaster` / `toaster` / `ToastRegion`                                                    |
| `breadcrumbs.tsx` / `tabs.tsx` / `menu.tsx` / `search-field.tsx` / `table.tsx` / `drop-zone.tsx` | 新規 |
| `page-header.tsx`           | 新規。パンくず・h1・補助操作・主操作・接続バナーの差し込み口                                         |
| `index.ts`                  | 変更。新しい部品を export                                                                            |

`apps/admin/`:

| ファイル                          | 責務                                                                       |
| --------------------------------- | -------------------------------------------------------------------------- |
| `vite.config.ts`                  | 変更。lightningcss に `light-dark()` を書き換えさせない                    |
| `src/styles.css`                  | 変更。`:root { color-scheme: light dark }`                                 |
| `src/lib/theme.ts`                | 新規。テーマの選択の読み書き・適用・起動時スクリプト・フック               |
| `src/routes/__root.tsx`           | 変更。`<head>` に起動時スクリプト                                          |
| `src/components/theme-select.tsx` | 新規。テーマの選択欄(配置は V4)                                          |

## タスクの依存

Task 1(設計書)→ Task 2(トークン)→ Task 3(テーマ)/ Task 4〜(部品)。Task 5(Button + Tooltip)は Task 6 以降の前提。Task 11(ダイアログ)・12(トースト)は Task 5 の `IconButton` を、Task 18(PageHeader)は Task 13(パンくず)を使う。

---

### Task 1: 設計書へ V1 の裁定を書き戻す

実装の根拠を設計書に一本化するため、コードより先に書き戻す(ロードマップ 1 章)。

**Files:**
- Modify: `docs/admin-ux/h-design-tokens.md`(2.1 透明度の表、2.4 影、3.2 の表、6 章、7 章 決定ログ)
- Modify: `docs/admin-ux/h-common-surface.md`(3 章のトーストの注記、14 章 決定ログ)

- [ ] **Step 1: h-design-tokens.md 2.1 の透明度の表に 4 行を足す**

`blackAlpha5` の行の下へ、値の小さい順に並ぶよう次を挿入する(`blackAlpha10` より前に 6 / 8、`blackAlpha10` と `blackAlpha50` の間に 18 / 40)。

```markdown
| `blackAlpha6`  | `rgba(0,0,0,.06)`       | ライトの影(menu の近い影)        |
| `blackAlpha8`  | `rgba(0,0,0,.08)`       | ライトの影(modal の近い影)       |
| `blackAlpha18` | `rgba(0,0,0,.18)`       | ライトの影(modal の遠い影)       |
| `blackAlpha40` | `rgba(0,0,0,.40)`       | ダークの影(menu の近い影)        |
```

`blackAlpha10` の用途を「ライトの押下・ライトの影(menu の遠い影)」に、`blackAlpha50` を「ライトの暗幕・ダークの影(menu の遠い影・modal の近い影)」に、`blackAlpha70` を「ダークの暗幕・ダークの影(modal の遠い影)」に直す。

- [ ] **Step 2: 2.4 の影の表の下に注記を足す**

```markdown
shadow1 と shadow3、shadow2 と shadow4 は形(オフセットとぼかし)が同じで、色の濃さだけが違う。`light-dark()` は色にしか書けないため、`elevation.*`(3.2)は shadow1〜4 を丸ごと参照せず、同じ形に透明度のプリミティブを `light-dark()` で当てて組む(V1、2026-10-18)。見え方は shadow1〜4 と同じ。shadow1〜4 は尺度として残す。
```

- [ ] **Step 3: 3.2 の表を差し替える**

冒頭の段落の「例外は `elevation.*` で、ダークでは濃い影に切り替える(D1 で確定)」の後ろに「影の色だけを `light-dark()` で切り替える(2.4 の注記)」を足し、表を次に置き換える(既存の行は残し、V1 で足した行に「(新規、V1)」を付ける)。

```markdown
| トークン                                                         | 参照先                                                                 | 現在のトークン                                                             |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `space.xxs`                                                      | space1(2px)                                                            | (新規、V1。ツールバーのボタン間、バッジの上下)                             |
| `space.xs` / `sm` / `md` / `lg` / `xl`                           | space2 / space3 / space5 / space6 / space7                             | `spacing.xs`〜`xl`(値は同じ)                                               |
| `space.inset`                                                    | space4(12px)                                                           | (新規、V1。入力欄・メニュー項目・表のセル・タブ・トーストの左右の余白)     |
| `space.pageGutter`                                               | space6                                                                 | (新規。本文の左右の余白)                                                   |
| `size.control`                                                   | space7 + space2 = 36px                                                 | (新規、D1。ボタン・入力欄・セレクト・検索欄・メニュー項目・サイドバー項目) |
| `size.controlSm`                                                 | space6 + space2 = 28px                                                 | (新規、D1。表の行内のボタン、ツールバーのボタン、チェックボックスの行)     |
| `size.row`                                                       | space7 + space4 = 44px                                                 | (新規、D1。表の行。最小タップ領域)                                         |
| `size.rowCompact`                                                | space7 + space3 = 40px                                                 | (新規、V1。表の見出し行、タブ)                                             |
| `font.family` / `font.familyMono`                                | fontSans / fontMono                                                    | `typography.fontFamily`                                                    |
| `font.body`                                                      | fontSize2                                                              | `typography.sizeMd`                                                        |
| `font.caption`                                                   | fontSize1                                                              | `typography.sizeSm`                                                        |
| `font.label`                                                     | fontSize3                                                              | `typography.sizeLg`(V1 でフォーム内の小見出し・空状態の題の用途に改めた) |
| `font.sectionTitle`                                              | fontSize4                                                              | `typography.sizeXl`(ダイアログの題にも使う)                               |
| `font.pageTitle`                                                 | fontSize5                                                              | (新規。ページ見出し)                                                       |
| `font.weightRegular` / `weightMedium` / `weightBold`             | fontWeightRegular / fontWeightMedium / fontWeightBold                  | (新規、V1)                                                                 |
| `font.lineHeightTight` / `lineHeightNormal` / `lineHeightRelaxed` | lineHeightTight / lineHeightNormal / lineHeightRelaxed                | (新規、V1)                                                                 |
| `radius.button`                                                  | radiusFull                                                             | (新規、案 R。ボタン全種。左右 padding は 16px、小型は 12px)                |
| `radius.badge`                                                   | radius1                                                                | (新規、案 R。バッジ、タブの件数。ボタンと形で区別する)                     |
| `radius.small`                                                   | radius1                                                                | (新規、V1。チェックボックスの箱、スケルトン、テキストリンクのフォーカス)   |
| `radius.control`                                                 | radius2                                                                | (部品に直書きの 4px → 8px。入力欄・テキストエリア・セレクト・検索欄・日時) |
| `radius.item`                                                    | radius2                                                                | (新規、案 R。サイドバー・メニューの項目、ツールチップ)                     |
| `radius.container`                                               | radius3                                                                | (部品に直書きの 8px → 16px。カード・メニュー・モーダル・トースト・空状態)  |
| `radius.full`                                                    | radiusFull                                                             | (新規、V1。進捗バー、公開状態の点、アバター、空状態のアイコンの円)         |
| `stroke.default` / `stroke.focus`                                | borderWidth1 / borderWidth2                                            | (新規、V1。罫線 / フォーカスの枠・ドロップ領域の破線)                      |
| `elevation.menu`                                                 | shadow1 の形に blackAlpha6・10(ダーク: blackAlpha40・50)             | (新規。メニュー・Select の候補・ツールチップ)                              |
| `elevation.modal`                                                | shadow2 の形に blackAlpha8・18(ダーク: blackAlpha50・70)             | (新規。モーダル・トースト)                                                 |
| `motion.fast` / `motion.normal`                                  | duration1 / duration2                                                  | (新規、V1。ホバー / 開閉)                                                  |
| `layer.dropdown` / `layer.modal` / `layer.toast`                 | zIndexDropdown / zIndexModal / zIndexToast                             | (新規、V1)                                                                 |
```

- [ ] **Step 4: 7 章 決定ログに 1 項目足す**

```markdown
- 2026-10-18: V1 の計画で次を確定。キャンバスの尺度に無い値(文字 13 / 11px、余白 10 / 6 / 5 / 14px など)は尺度に寄せる(13 → 14、11 → 12、10 → 12、6 → 8、5 → 4、14 → 12)。フォームのラベルは 14px / 500 とし、`font.label` は小見出しの用途に改めた。`elevation.*` は影の色だけを `light-dark()` で切り替え、そのために blackAlpha6 / 8 / 18 / 40 を足した。3.2 に `space.xxs` / `space.inset` / `size.rowCompact` / `font.*` の太さと行の高さ / `radius.small` / `radius.full` / `stroke.*` / `motion.*` / `layer.*` を足した。キャンバスの `bg.control` は採らず `bg.canvas` に読み替える
```

- [ ] **Step 5: h-common-surface.md を直す**

3 章の箇条「トーストは react-aria-components で安定版になっていない可能性がある(推測)。…」を次に置き換える。

```markdown
- トーストは react-aria-components 1.21.1 では `UNSTABLE_Toast` / `UNSTABLE_ToastRegion` / `UNSTABLE_ToastQueue` としてだけ提供されている。これを `packages/ui/src/toast.tsx` の中だけで import して包み、外へは自前の API(`createToaster` / `ToastRegion`)を出す(V1、2026-10-18)。読み上げ・フォーカス移動・F6 での移動を RAC に任せ、将来の破壊的変更は 1 ファイルに閉じ込める。トーストの地は `bg.raised` とし、成功 / エラーはアイコンの色で示す
```

14 章 決定ログに追記する。

```markdown
- 2026-10-18: V1 の計画で、トーストは RAC の UNSTABLE_ を包んで使うことにした(3 章)。キャンバスとの食い違いは設計書を優先した: トーストの地は bg.raised、メニューのアイコンは 20px、バッジ内のアイコンは 16px、空状態のアイコンは 32px(線幅 1.75)、ダイアログの題は 20px、ゴーストボタンの文字は text.muted。テーマの選択欄は部品だけ作り、配置は V4 のアカウント設定で行う
```

- [ ] **Step 6: 書式を確かめてコミット**

Run: `node_modules/.bin/oxfmt --check docs/admin-ux/h-design-tokens.md docs/admin-ux/h-common-surface.md`
Expected: 指摘はあってよい(`docs/` は `.oxfmtignore` で整形の対象外。表の桁揃えだけ目視で崩れていないことを見る)

```bash
git add docs/admin-ux/h-design-tokens.md docs/admin-ux/h-common-surface.md
git commit -m "docs: V1 の計画で決めたトークンと部品の扱いを設計書へ書き戻す"
```

---

### Task 2: 3 層のトークンと旧名の別名

**Files:**
- Create: `packages/ui/src/primitives.stylex.ts`
- Create: `packages/ui/src/semantic.stylex.ts`
- Create: `packages/ui/src/icon.ts`
- Create: `packages/ui/src/test-utils/tokens-entry.ts`
- Create: `packages/ui/src/tokens-build.test.ts`
- Modify: `packages/ui/src/tokens.stylex.ts`(全体)
- Modify: `packages/ui/package.json`(exports、依存)
- Modify: `pnpm-workspace.yaml`(catalog に `lucide-react`)

**Interfaces:**
- Produces: `@plyrs/ui/semantic.stylex` から `bg` / `text` / `border` / `accent` / `focus` / `status` / `space` / `size` / `font` / `radius` / `stroke` / `elevation` / `motion` / `layer`(以降の全タスクが `import { … } from "./semantic.stylex"` で使う)。`./icon` から `ICON_SIZE` / `ICON_STROKE`

- [ ] **Step 1: 依存を足す**

`pnpm-workspace.yaml` の catalog に、`jsdom` の次へアルファベット順で足す(1.55.0 は 2026-10-10 公開で `minimumReleaseAge` を満たす)。

```yaml
  lucide-react: ^1.55.0
```

`packages/ui/package.json` の `dependencies` に `"lucide-react": "catalog:"`、`devDependencies` に `"vite": "catalog:"` を足し、`exports` を次にする。

```json
  "exports": {
    ".": "./src/index.ts",
    "./tokens.stylex": "./src/tokens.stylex.ts",
    "./semantic.stylex": "./src/semantic.stylex.ts"
  },
```

Run: `pnpm install`(PATH に無ければ `node node_modules/pnpm/bin/pnpm.cjs install` か `corepack pnpm install`)
Expected: lockfile が更新され、`lucide-react@1.5x` が入る

- [ ] **Step 2: 失敗するビルドテストを書く**

`packages/ui/src/test-utils/tokens-entry.ts`:

```ts
import * as stylex from "@stylexjs/stylex";
import { bg, elevation, text } from "../semantic.stylex";
import { colors, spacing } from "../tokens.stylex";

// tokens-build.test.ts のビルド入口。セマンティックと旧名の別名を 1 つずつ使い、
// 両方の defineVars が出力 CSS に載るようにする
const styles = stylex.create({
  root: {
    backgroundColor: bg.canvas,
    color: text.default,
    boxShadow: elevation.menu,
    borderColor: colors.border,
    padding: spacing.md,
  },
});

export const props = stylex.props(styles.root);
```

`packages/ui/src/tokens-build.test.ts`:

```ts
import stylex from "@stylexjs/unplugin";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// 3 層トークン(h-design-tokens.md 5 章)の実体を Vite でビルドし、出力 CSS の形を確かめる。
// admin の stylex-tokens.test.ts は最小構成のフィクスチャで書き方を、こちらは実トークンを見る
const ENTRY = join(process.cwd(), "src/test-utils/tokens-entry.ts");

// lightningcss は @stylexjs/unplugin の依存。ui の直接の依存ではないため、そこから解決する
const { Features } = createRequire(
  createRequire(join(process.cwd(), "package.json")).resolve("@stylexjs/unplugin"),
)("lightningcss") as { Features: { LightDark: number } };

let outDir: string;
let css: string;

beforeAll(async () => {
  outDir = await mkdtemp(join(tmpdir(), "ui-tokens-"));
  await build({
    root: join(process.cwd(), "src"),
    configFile: false,
    logLevel: "silent",
    plugins: [stylex.vite({ lightningcssOptions: { exclude: Features.LightDark } })],
    build: { outDir, lib: { entry: ENTRY, formats: ["es"], fileName: "entry" } },
  });
  css = await readFile(join(outDir, "assets", "stylex.css"), "utf8");
}, 60_000);

afterAll(async () => {
  await rm(outDir, { recursive: true, force: true });
});

function rootValues(): string[] {
  const values: string[] = [];
  for (const block of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (/:root/.test(block[1] ?? "")) {
      for (const decl of (block[2] ?? "").matchAll(/--[\w-]+:\s*([^;]+);/g)) {
        values.push((decl[1] ?? "").trim());
      }
    }
  }
  return values;
}

describe("3 層トークンの出力(h-design-tokens.md 5 章)", () => {
  it("プリミティブは値そのもの、セマンティックの色は light-dark() でプリミティブを参照する", () => {
    const values = rootValues();
    expect(values).toContain("#2563eb");
    expect(values).toContainEqual(
      expect.stringMatching(/^light-dark\(var\(--[\w-]+\), var\(--[\w-]+\)\)$/),
    );
  });

  it("elevation は影の色だけを light-dark() で切り替える", () => {
    expect(rootValues()).toContainEqual(
      expect.stringMatching(/^0 1px 2px light-dark\(var\(--[\w-]+\), var\(--[\w-]+\)\), 0 4px 12px light-dark\(/),
    );
  });

  it("旧名はセマンティックの別名(var 参照)になり、生の値を持たない", () => {
    expect(css).not.toContain("prefers-color-scheme");
    expect(css).not.toContain("--lightningcss-light");
  });
});
```

Run: `pnpm --filter @plyrs/ui exec vitest run src/tokens-build.test.ts`
Expected: FAIL(`../semantic.stylex` が無い)

- [ ] **Step 3: プリミティブを書く**

`packages/ui/src/primitives.stylex.ts`(色の 50〜950 は Tailwind CSS v3 の既定値。gray は h-design-tokens.md 2.1 の表):

```ts
import * as stylex from "@stylexjs/stylex";

// h-design-tokens.md 2 章: 値そのもの。用途を持たない名前で、尺度として一通り定義する。
// 部品と画面はここを直接参照しない(semantic.stylex.ts だけが参照する)。
// 注意: defineVars は .stylex.ts の named export でなければならない(tokens.stylex.ts と同じ)
export const primitives = stylex.defineVars({
  white: "#ffffff",

  gray50: "#f6f7f8",
  gray100: "#e8eaed",
  gray200: "#d8dde3",
  gray300: "#b9c1c9",
  gray400: "#9aa5af",
  gray500: "#7c8892",
  gray600: "#5f6b76",
  gray700: "#333a42",
  gray800: "#272d33",
  gray900: "#1a1f24",
  gray950: "#111418",

  blue50: "#eff6ff",
  blue100: "#dbeafe",
  blue200: "#bfdbfe",
  blue300: "#93c5fd",
  blue400: "#60a5fa",
  blue500: "#3b82f6",
  blue600: "#2563eb",
  blue700: "#1d4ed8",
  blue800: "#1e40af",
  blue900: "#1e3a8a",
  blue950: "#172554",

  red50: "#fef2f2",
  red100: "#fee2e2",
  red200: "#fecaca",
  red300: "#fca5a5",
  red400: "#f87171",
  red500: "#ef4444",
  red600: "#dc2626",
  red700: "#b91c1c",
  red800: "#991b1b",
  red900: "#7f1d1d",
  red950: "#450a0a",

  green50: "#f0fdf4",
  green100: "#dcfce7",
  green200: "#bbf7d0",
  green300: "#86efac",
  green400: "#4ade80",
  green500: "#22c55e",
  green600: "#16a34a",
  green700: "#15803d",
  green800: "#166534",
  green900: "#14532d",
  green950: "#052e16",

  amber50: "#fffbeb",
  amber100: "#fef3c7",
  amber200: "#fde68a",
  amber300: "#fcd34d",
  amber400: "#fbbf24",
  amber500: "#f59e0b",
  amber600: "#d97706",
  amber700: "#b45309",
  amber800: "#92400e",
  amber900: "#78350f",
  amber950: "#451a03",

  blackAlpha5: "rgba(0,0,0,.05)",
  blackAlpha6: "rgba(0,0,0,.06)",
  blackAlpha8: "rgba(0,0,0,.08)",
  blackAlpha10: "rgba(0,0,0,.10)",
  blackAlpha18: "rgba(0,0,0,.18)",
  blackAlpha40: "rgba(0,0,0,.40)",
  blackAlpha50: "rgba(0,0,0,.50)",
  blackAlpha70: "rgba(0,0,0,.70)",
  whiteAlpha8: "rgba(255,255,255,.08)",
  whiteAlpha12: "rgba(255,255,255,.12)",

  space0: "0",
  space1: "2px",
  space2: "4px",
  space3: "8px",
  space4: "12px",
  space5: "16px",
  space6: "24px",
  space7: "32px",
  space8: "48px",
  space9: "64px",

  fontSans:
    "system-ui, -apple-system, 'Segoe UI', 'Hiragino Kaku Gothic ProN', 'Noto Sans JP', sans-serif",
  fontMono: "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace",
  fontSize1: "12px",
  fontSize2: "14px",
  fontSize3: "16px",
  fontSize4: "20px",
  fontSize5: "24px",
  fontSize6: "32px",
  fontWeightRegular: "400",
  fontWeightMedium: "500",
  fontWeightBold: "600",
  lineHeightTight: "1.25",
  lineHeightNormal: "1.5",
  lineHeightRelaxed: "1.75",

  radius0: "0",
  radius1: "4px",
  radius2: "8px",
  radius3: "16px",
  radius4: "24px",
  radiusFull: "9999px",

  borderWidth1: "1px",
  borderWidth2: "2px",

  // shadow1/2 = ライトのメニュー / モーダル、shadow3/4 = ダーク(2.4)。elevation.* は形が同じことを
  // 使って色だけを light-dark() で切り替えるため、これらは尺度として持つだけで参照しない
  shadow1: "0 1px 2px rgba(0,0,0,.06), 0 4px 12px rgba(0,0,0,.10)",
  shadow2: "0 4px 8px rgba(0,0,0,.08), 0 16px 40px rgba(0,0,0,.18)",
  shadow3: "0 1px 2px rgba(0,0,0,.4), 0 4px 12px rgba(0,0,0,.5)",
  shadow4: "0 4px 8px rgba(0,0,0,.5), 0 16px 40px rgba(0,0,0,.7)",

  duration1: "100ms",
  duration2: "200ms",

  zIndexDropdown: "100",
  zIndexModal: "200",
  zIndexToast: "300",
});
```

- [ ] **Step 4: セマンティックを書く**

`packages/ui/src/semantic.stylex.ts`:

```ts
import * as stylex from "@stylexjs/stylex";
import { primitives as p } from "./primitives.stylex";

// h-design-tokens.md 3 章: 用途の名前。値は必ずプリミティブを参照し、ライト / ダークの対は
// light-dark(ライト, ダーク) で持つ(4 章)。どちらを使うかはルートの color-scheme が決める
// (admin の styles.css が既定の `light dark` を宣言し、lib/theme.ts が上書きする)。
// 部品と画面はこのファイルだけを参照する。消費側は index.ts を経由せず直接 import する。

export const bg = stylex.defineVars({
  canvas: `light-dark(${p.white}, ${p.gray950})`,
  surface: `light-dark(${p.gray50}, ${p.gray900})`,
  // 常に border.default の枠線を伴う(モーダル・メニュー・トースト)
  raised: `light-dark(${p.white}, ${p.gray800})`,
  overlay: `light-dark(${p.blackAlpha50}, ${p.blackAlpha70})`,
  hover: `light-dark(${p.blackAlpha5}, ${p.whiteAlpha8})`,
  pressed: `light-dark(${p.blackAlpha10}, ${p.whiteAlpha12})`,
  skeleton: `light-dark(${p.gray100}, ${p.whiteAlpha8})`,
  inverse: `light-dark(${p.gray900}, ${p.gray100})`,
});

export const text = stylex.defineVars({
  default: `light-dark(${p.gray900}, ${p.gray100})`,
  muted: `light-dark(${p.gray600}, ${p.gray400})`,
  onAccent: `light-dark(${p.white}, ${p.gray950})`,
  inverse: `light-dark(${p.gray50}, ${p.gray900})`,
});

export const border = stylex.defineVars({
  default: `light-dark(${p.gray200}, ${p.gray700})`,
  hover: `light-dark(${p.gray300}, ${p.gray600})`,
});

export const accent = stylex.defineVars({
  default: `light-dark(${p.blue600}, ${p.blue400})`,
  hover: `light-dark(${p.blue700}, ${p.blue300})`,
  active: `light-dark(${p.blue800}, ${p.blue200})`,
  surface: `light-dark(${p.blue50}, ${p.blue950})`,
});

export const focus = stylex.defineVars({
  // 2px、2px 外側。入力欄の枠線色はフォーカスで変えない
  ring: `light-dark(${p.blue600}, ${p.blue400})`,
});

export const status = stylex.defineVars({
  danger: `light-dark(${p.red600}, ${p.red400})`,
  dangerHover: `light-dark(${p.red700}, ${p.red300})`,
  dangerSurface: `light-dark(${p.red50}, ${p.red950})`,
  success: `light-dark(${p.green700}, ${p.green400})`,
  successSurface: `light-dark(${p.green50}, ${p.green950})`,
  warning: `light-dark(${p.amber700}, ${p.amber400})`,
  warningSurface: `light-dark(${p.amber50}, ${p.amber950})`,
});

// 3.2: 余白・文字・その他はテーマで変えない(elevation の色だけが例外)
export const space = stylex.defineVars({
  xxs: p.space1,
  xs: p.space2,
  sm: p.space3,
  inset: p.space4,
  md: p.space5,
  lg: p.space6,
  xl: p.space7,
  pageGutter: p.space6,
});

export const size = stylex.defineVars({
  control: `calc(${p.space7} + ${p.space2})`,
  controlSm: `calc(${p.space6} + ${p.space2})`,
  row: `calc(${p.space7} + ${p.space4})`,
  rowCompact: `calc(${p.space7} + ${p.space3})`,
});

export const font = stylex.defineVars({
  family: p.fontSans,
  familyMono: p.fontMono,
  body: p.fontSize2,
  caption: p.fontSize1,
  label: p.fontSize3,
  sectionTitle: p.fontSize4,
  pageTitle: p.fontSize5,
  weightRegular: p.fontWeightRegular,
  weightMedium: p.fontWeightMedium,
  weightBold: p.fontWeightBold,
  lineHeightTight: p.lineHeightTight,
  lineHeightNormal: p.lineHeightNormal,
  lineHeightRelaxed: p.lineHeightRelaxed,
});

export const radius = stylex.defineVars({
  button: p.radiusFull,
  badge: p.radius1,
  small: p.radius1,
  control: p.radius2,
  item: p.radius2,
  container: p.radius3,
  full: p.radiusFull,
});

export const stroke = stylex.defineVars({
  default: p.borderWidth1,
  focus: p.borderWidth2,
});

// 2.4 の注記: 形は shadow1/3(menu)、shadow2/4(modal)で共通。色だけを切り替える
export const elevation = stylex.defineVars({
  menu: `0 1px 2px light-dark(${p.blackAlpha6}, ${p.blackAlpha40}), 0 4px 12px light-dark(${p.blackAlpha10}, ${p.blackAlpha50})`,
  modal: `0 4px 8px light-dark(${p.blackAlpha8}, ${p.blackAlpha50}), 0 16px 40px light-dark(${p.blackAlpha18}, ${p.blackAlpha70})`,
});

export const motion = stylex.defineVars({
  fast: p.duration1,
  normal: p.duration2,
});

export const layer = stylex.defineVars({
  dropdown: p.zIndexDropdown,
  modal: p.zIndexModal,
  toast: p.zIndexToast,
});
```

注意: `text.default` / `border.default` のように `default` という名前の変数を使う。StyleX は `defineVars` の値のオブジェクトの `default` を条件の既定として扱うが、ここでは値が文字列なので名前として扱われる想定。Step 6 のビルドテストで `text.default` が `var(--…)` に解決されることを確かめ、もしコンパイルエラーや未定義になったら、`default` を `base` に改名する(`text.base` など。設計書 3 章の表の名前との対応をコメントに残す)。

- [ ] **Step 5: 旧名を別名に置き換える**

`packages/ui/src/tokens.stylex.ts` を全体置き換え:

```ts
import * as stylex from "@stylexjs/stylex";
import { accent, bg, border, focus, font, space, status, text } from "./semantic.stylex";

// h-design-tokens.md 5 章: 旧名はセマンティックトークンの別名として残し、画面ごとに
// semantic.stylex.ts へ置き換える(ロードマップ V2 以降)。新しいコードはここを使わない。
// ダークの切り替えは prefers-color-scheme の @media から、セマンティック側の light-dark() に移った。
// 注意: defineVars は .stylex.ts ファイルの named export でなければならず、消費側は
// このファイルを直接 import する（index.ts 経由の再 export はコンパイラが解決できない）。
export const colors = stylex.defineVars({
  bg: bg.canvas,
  surface: bg.surface,
  border: border.default,
  text: text.default,
  textMuted: text.muted,
  accent: accent.default,
  accentText: text.onAccent,
  danger: status.danger,
  focusRing: focus.ring,
});

export const spacing = stylex.defineVars({
  xs: space.xs,
  sm: space.sm,
  md: space.md,
  lg: space.lg,
  xl: space.xl,
});

export const typography = stylex.defineVars({
  fontFamily: font.family,
  sizeSm: font.caption,
  sizeMd: font.body,
  sizeLg: font.label,
  sizeXl: font.sectionTitle,
});
```

`accentText` のダークは `#0b1220` から `gray950`(`#111418`)に変わる(2.1 で廃止を確定済み)。ほかの旧名の値は変わらない。

- [ ] **Step 6: アイコンの定数を書き、テストを通す**

`packages/ui/src/icon.ts`:

```ts
// h-common-surface.md 12 章: Lucide の大きさと線幅。色は常に currentColor(lucide の既定)
export const ICON_SIZE = {
  /** 本文・ボタン・バッジ・入力欄の中 */
  inline: 16,
  /** サイドバー・メニュー */
  nav: 20,
  /** 空状態・ドロップ領域 */
  empty: 32,
} as const;

export const ICON_STROKE = {
  default: 2,
  /** 32px 以上 */
  large: 1.75,
} as const;
```

Run: `pnpm --filter @plyrs/ui exec vitest run src/tokens-build.test.ts`
Expected: PASS(3 件)

Run: `pnpm --filter @plyrs/ui test && pnpm --filter @plyrs/admin test && pnpm typecheck`
Expected: すべて PASS(旧名の別名で既存の部品と画面がそのまま動く)

- [ ] **Step 7: コミット**

```bash
git add pnpm-workspace.yaml pnpm-lock.yaml packages/ui
git commit -m "feat(ui): プリミティブとセマンティックの 3 層トークンを入れ、旧名を別名にする"
```

---

### Task 3: テーマ切り替え(自動 / ライト / ダーク)

**Files:**
- Modify: `apps/admin/vite.config.ts`
- Modify: `apps/admin/src/styles.css`
- Create: `apps/admin/src/lib/theme.ts`
- Create: `apps/admin/src/lib/theme.test.ts`
- Modify: `apps/admin/src/routes/__root.tsx`
- Create: `apps/admin/src/components/theme-select.tsx`
- Create: `apps/admin/src/components/theme-select.test.tsx`

**Interfaces:**
- Consumes: `Select`(`@plyrs/ui`、Task 6 で見た目が変わるが props は同じ)
- Produces: `ThemePreference = "system" | "light" | "dark"`、`THEME_STORAGE_KEY`、`readThemePreference(storage?)`、`saveThemePreference(pref, storage?)`、`applyThemePreference(pref, root?)`、`THEME_BOOT_SCRIPT`、`useThemePreference(): [ThemePreference, (pref) => void]`、`ThemeSelect`(V4 のアカウント設定が使う)

- [ ] **Step 1: 失敗するテストを書く**

`apps/admin/src/lib/theme.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  THEME_BOOT_SCRIPT,
  THEME_STORAGE_KEY,
  applyThemePreference,
  readThemePreference,
  saveThemePreference,
} from "./theme";

afterEach(() => {
  localStorage.clear();
  document.documentElement.style.colorScheme = "";
});

const throwingStorage = {
  getItem: () => {
    throw new Error("SecurityError");
  },
  setItem: () => {
    throw new Error("SecurityError");
  },
  removeItem: () => {
    throw new Error("SecurityError");
  },
} as unknown as Storage;

describe("テーマの選択(h-design-tokens.md 4 章)", () => {
  it("既定は自動", () => {
    expect(readThemePreference()).toBe("system");
  });

  it("記憶した選択を読む。知らない値は自動として扱う", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    expect(readThemePreference()).toBe("dark");
    localStorage.setItem(THEME_STORAGE_KEY, "sepia");
    expect(readThemePreference()).toBe("system");
  });

  it("自動を選んだら記憶を消す", () => {
    saveThemePreference("light");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    saveThemePreference("system");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
  });

  it("ストレージが例外を投げても落ちない", () => {
    expect(readThemePreference(throwingStorage)).toBe("system");
    expect(() => saveThemePreference("dark", throwingStorage)).not.toThrow();
  });

  it("ルートの color-scheme に書く", () => {
    applyThemePreference("dark");
    expect(document.documentElement.style.colorScheme).toBe("dark");
    applyThemePreference("system");
    expect(document.documentElement.style.colorScheme).toBe("light dark");
  });

  it("起動時スクリプトは記憶した選択を JS の読み込み前に当てる", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "light");
    new Function(THEME_BOOT_SCRIPT)();
    expect(document.documentElement.style.colorScheme).toBe("light");
  });

  it("styles.css が自動(light dark)を既定に宣言している", () => {
    // light-dark() は color-scheme が無いと常にライトを選ぶ。宣言が消えると OS がダークの人がライトになる
    const css = readFileSync(join(process.cwd(), "src/styles.css"), "utf8");
    expect(css).toMatch(/:root\s*\{[^}]*color-scheme:\s*light dark;/);
  });
});
```

`apps/admin/src/components/theme-select.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it } from "vitest";
import { THEME_STORAGE_KEY } from "../lib/theme";
import { ThemeSelect } from "./theme-select";

afterEach(() => {
  localStorage.clear();
  document.documentElement.style.colorScheme = "";
});

it("選ぶと記憶してすぐ当てる", async () => {
  const user = userEvent.setup();
  render(<ThemeSelect />);
  await user.click(screen.getByRole("button", { name: /テーマ/ }));
  await user.click(await screen.findByRole("option", { name: "ダーク" }));
  expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
  expect(document.documentElement.style.colorScheme).toBe("dark");
});
```

Run: `pnpm --filter @plyrs/admin exec vitest run src/lib/theme.test.ts src/components/theme-select.test.tsx`
Expected: FAIL(`./theme` が無い)

- [ ] **Step 2: theme.ts を書く**

`apps/admin/src/lib/theme.ts`:

```ts
import { useCallback, useState } from "react";

// h-design-tokens.md 4 章: 自動(OS の設定)/ ライト / ダークの 3 択。既定は自動。
// 選択はブラウザに記憶し、ルートの color-scheme に書く(セマンティックトークンの light-dark() が従う)。
// アカウント単位の保存は未決(6 章)。
export type ThemePreference = "system" | "light" | "dark";

export const THEME_STORAGE_KEY = "plyrs.theme";

const COLOR_SCHEME: Record<ThemePreference, string> = {
  system: "light dark",
  light: "light",
  dark: "dark",
};

function defaultStorage(): Storage | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

export function readThemePreference(storage = defaultStorage()): ThemePreference {
  try {
    const value = storage?.getItem(THEME_STORAGE_KEY);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    // プライベートウィンドウなどで例外になる。記憶が無いのと同じ扱いにする
    return "system";
  }
}

export function saveThemePreference(preference: ThemePreference, storage = defaultStorage()): void {
  try {
    if (preference === "system") storage?.removeItem(THEME_STORAGE_KEY);
    else storage?.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // 記憶できなくても、このタブの間は applyThemePreference の結果が残る
  }
}

export function applyThemePreference(
  preference: ThemePreference,
  root: HTMLElement = document.documentElement,
): void {
  root.style.colorScheme = COLOR_SCHEME[preference];
}

// /_shell の <head> に置く起動時スクリプト。JS の本体より前に走り、記憶した選択と違う配色で
// 一瞬描画されるのを防ぐ。上の関数と同じ規則を、依存の無い 1 行で書く
export const THEME_BOOT_SCRIPT = `try{var t=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});if(t==="light"||t==="dark")document.documentElement.style.colorScheme=t}catch(e){}`;

export function useThemePreference(): [ThemePreference, (preference: ThemePreference) => void] {
  const [preference, setPreference] = useState<ThemePreference>(() => readThemePreference());
  const update = useCallback((next: ThemePreference) => {
    saveThemePreference(next);
    applyThemePreference(next);
    setPreference(next);
  }, []);
  return [preference, update];
}
```


- [ ] **Step 3: styles.css・起動時スクリプト・vite の設定**

`apps/admin/src/styles.css` の先頭に足す:

```css
/* h-design-tokens.md 4 章: 既定は自動。lib/theme.ts が記憶した選択でルートの style を上書きする */
:root {
  color-scheme: light dark;
}
```

`apps/admin/src/routes/__root.tsx` の `RootShell` の `<head>` を次にする(`import { THEME_BOOT_SCRIPT } from "../lib/theme";` を足す):

```tsx
      <head>
        {/* h-design-tokens.md 4 章: 記憶したテーマを描画より前に当てる(prerender で /_shell に入る) */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
        <HeadContent />
      </head>
```

`apps/admin/vite.config.ts` の `stylex.vite()` を次にする(admin の `stylex-tokens.test.ts` と同じ解決方法):

```ts
import { createRequire } from "node:module";
// …
// h-design-tokens.md 5 章: lightningcss に light-dark() を --lightningcss-light 等の代替表現へ
// 書き換えさせない(color-scheme の宣言が同じ処理に無いとダークが壊れる)。lightningcss は
// @stylexjs/unplugin の依存のため、そこから解決する
const requireFromConfig = createRequire(import.meta.url);
const { Features } = createRequire(requireFromConfig.resolve("@stylexjs/unplugin"))("lightningcss") as {
  Features: { LightDark: number };
};
// …
    stylex.vite({ lightningcssOptions: { exclude: Features.LightDark } }),
```

- [ ] **Step 4: ThemeSelect を書く**

`apps/admin/src/components/theme-select.tsx`:

```tsx
import { Select } from "@plyrs/ui";
import { type ThemePreference, useThemePreference } from "../lib/theme";

// h-design-tokens.md 4 章の切り替え。置き場所はアカウント設定(案 G 6.2、V4 で配置する)
const ITEMS: { value: ThemePreference; label: string }[] = [
  { value: "system", label: "自動(OS の設定に従う)" },
  { value: "light", label: "ライト" },
  { value: "dark", label: "ダーク" },
];

export function ThemeSelect() {
  const [preference, setPreference] = useThemePreference();
  return (
    <Select
      label="テーマ"
      items={ITEMS}
      selectedValue={preference}
      onChange={(value) => setPreference(value as ThemePreference)}
    />
  );
}
```

`value as ThemePreference` は `ITEMS` の値だけが来る境界の cast。

- [ ] **Step 5: テストを通す**

Run: `pnpm --filter @plyrs/admin exec vitest run src/lib/theme.test.ts src/components/theme-select.test.tsx src/stylex-tokens.test.ts`
Expected: PASS

Run: `pnpm --filter @plyrs/admin build`
Expected: 成功。`apps/admin/dist` の CSS に `--lightningcss-light` が無いこと: `grep -r lightningcss-light apps/admin/dist || echo none` → `none`

- [ ] **Step 6: コミット**

```bash
git add apps/admin
git commit -m "feat(admin): テーマの選択を記憶して color-scheme に当てる仕組みを入れる"
```

---

### Task 4: フォームの共通表示と TextField / TextArea

**Files:**
- Create: `packages/ui/src/field.tsx`
- Modify: `packages/ui/src/text-field.tsx`(全体)
- Modify: `packages/ui/src/text-area.tsx`(全体)
- Test: `packages/ui/src/text-field.test.tsx`、`packages/ui/src/text-area.test.tsx`(既存に追記)

**Interfaces:**
- Produces: `fieldClassName(): string`、`FieldLabel({ children, isRequired?, elementType? })`、`FieldDescription({ children })`、`FieldErrorMessage({ errorMessage? })`(RAC の `FieldError` を包む)、`FieldErrorText({ children, id?, slot? })`(RAC のフィールド文脈の外で使う)。Task 6・7 が使う。`TextFieldProps` に `isMonospace?: boolean` を足す

- [ ] **Step 1: 失敗するテストを足す**

`packages/ui/src/text-field.test.tsx` の末尾に足す(既存の import に合わせ、`render` / `screen` / `describe` / `expect` / `it` を使う):

```tsx
describe("TextField の D1 の見た目", () => {
  it("必須の札は見えるが、アクセシブルな名前には混ざらない", () => {
    render(<TextField label="タイトル" isRequired />);
    expect(screen.getByLabelText("タイトル")).toBeRequired();
    expect(screen.getByText("必須")).toHaveAttribute("aria-hidden", "true");
  });

  it("エラーはアイコン付きで出し、入力欄を invalid にする", () => {
    render(<TextField label="タイトル" isInvalid errorMessage="タイトルを入力してください" />);
    expect(screen.getByLabelText("タイトル")).toHaveAttribute("aria-invalid", "true");
    const error = screen.getByText("タイトルを入力してください");
    expect(error.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("フォーカスで枠線のクラスを変えず、リングのクラスだけを足す", async () => {
    render(<TextField label="タイトル" />);
    const input = screen.getByLabelText("タイトル");
    const before = input.className.split(" ");
    await userEvent.click(input);
    const after = input.className.split(" ");
    // 足されるだけで、元のクラス(枠線色を含む)は 1 つも消えない
    expect(before.every((name) => after.includes(name))).toBe(true);
    expect(after.length).toBeGreaterThan(before.length);
  });
});
```

`packages/ui/src/text-area.test.tsx` に足す:

```tsx
it("必須の札はアクセシブルな名前に混ざらない", () => {
  render(<TextArea label="概要" value="" onChange={() => {}} isRequired />);
  expect(screen.getByLabelText("概要")).toBeRequired();
});
```

Run: `pnpm --filter @plyrs/ui exec vitest run src/text-field.test.tsx src/text-area.test.tsx`
Expected: FAIL(「必須」が見つからない、svg が無い)

- [ ] **Step 2: field.tsx を書く**

```tsx
import * as stylex from "@stylexjs/stylex";
import { CircleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { FieldError, Label, Text, type ValidationResult } from "react-aria-components";
import { ICON_SIZE } from "./icon";
import { font, space, status, text } from "./semantic.stylex";

// D1 ボード 3b: ラベル → 入力欄 → 説明文またはエラー の縦並び(gap はキャンバスの 6px を 8px に寄せた)
const styles = stylex.create({
  field: {
    display: "flex",
    flexDirection: "column",
    gap: space.sm,
    fontFamily: font.family,
  },
  // 2026-10-18 裁定: ラベルは 14px / 500
  label: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.sm,
    fontSize: font.body,
    fontWeight: font.weightMedium,
    color: text.default,
  },
  required: {
    fontSize: font.caption,
    fontWeight: font.weightMedium,
    color: status.danger,
  },
  description: { fontSize: font.caption, color: text.muted },
  error: {
    display: "flex",
    alignItems: "center",
    gap: space.xs,
    fontSize: font.caption,
    color: status.danger,
  },
});

export function fieldClassName(): string {
  return stylex.props(styles.field).className ?? "";
}

export function FieldLabel({
  children,
  isRequired,
  elementType,
}: {
  children: ReactNode;
  isRequired?: boolean | undefined;
  elementType?: string;
}) {
  return (
    <Label elementType={elementType} className={stylex.props(styles.label).className ?? ""}>
      {children}
      {/* 必須は入力欄の required / aria-required で伝わる。名前に混ぜないため札は読み上げない */}
      {isRequired === true && (
        <span aria-hidden="true" {...stylex.props(styles.required)}>
          必須
        </span>
      )}
    </Label>
  );
}

export function FieldDescription({ children }: { children: ReactNode }) {
  return (
    <Text slot="description" className={stylex.props(styles.description).className ?? ""}>
      {children}
    </Text>
  );
}

function ErrorIcon() {
  return <CircleAlert size={ICON_SIZE.inline} aria-hidden="true" />;
}

/** RAC のフィールド(TextField など)の中で使う。invalid のときだけ表示される */
export function FieldErrorMessage({
  errorMessage,
}: {
  errorMessage?: string | ((validation: ValidationResult) => string) | undefined;
}) {
  return (
    <FieldError className={stylex.props(styles.error).className ?? ""}>
      {(validation) => {
        const message =
          typeof errorMessage === "function"
            ? errorMessage(validation)
            : (errorMessage ?? validation.validationErrors.join(" "));
        return (
          <>
            <ErrorIcon />
            {message}
          </>
        );
      }}
    </FieldError>
  );
}

/** RAC のフィールド文脈の外(CheckboxGroup・RichTextEditor)や Select の errorMessage スロットで使う */
export function FieldErrorText({
  children,
  id,
  slot,
}: {
  children: ReactNode;
  id?: string;
  slot?: string;
}) {
  return (
    <Text slot={slot} id={id} className={stylex.props(styles.error).className ?? ""}>
      <ErrorIcon />
      {children}
    </Text>
  );
}
```

- [ ] **Step 3: TextField を書き換える**

```tsx
import * as stylex from "@stylexjs/stylex";
import {
  Input,
  TextField as RacTextField,
  type InputRenderProps,
  type TextFieldProps as RacTextFieldProps,
  type ValidationResult,
} from "react-aria-components";
import { stylexRenderProps } from "./compose";
import { FieldDescription, FieldErrorMessage, FieldLabel, fieldClassName } from "./field";
import { bg, border, focus, font, radius, size, space, status, stroke, text } from "./semantic.stylex";

// D1 ボード 3b。フォーカスは focus.ring だけで示し、枠線の色は通常 / ホバー / エラーの区別に使う
const styles = stylex.create({
  input: {
    height: size.control,
    paddingInline: space.inset,
    fontFamily: font.family,
    fontSize: font.body,
    color: text.default,
    backgroundColor: bg.canvas,
    borderWidth: stroke.default,
    borderStyle: "solid",
    borderColor: border.default,
    borderRadius: radius.control,
    outline: "none",
    "::placeholder": { color: text.muted },
  },
  mono: { fontFamily: font.familyMono },
  hovered: { borderColor: border.hover },
  invalid: { borderColor: status.danger },
  focused: {
    outlineWidth: stroke.focus,
    outlineStyle: "solid",
    outlineColor: focus.ring,
    outlineOffset: stroke.focus,
  },
  disabled: { opacity: 0.5, backgroundColor: bg.surface, cursor: "not-allowed" },
});

export interface TextFieldProps extends Omit<RacTextFieldProps, "className" | "style"> {
  label: string;
  /** 入力欄の空欄時に薄く表示する記入例(react-aria の Input へそのまま渡る)。 */
  placeholder?: string;
  /** ラベル直下に表示する短い補足説明(react-aria の description スロット経由)。 */
  description?: string;
  errorMessage?: string | ((validation: ValidationResult) => string);
  /** 識別子(スラッグ・API で使う名前)の入力欄は等幅にする(D1 ボード 3b) */
  isMonospace?: boolean;
}

export function TextField({
  label,
  placeholder,
  description,
  errorMessage,
  isMonospace,
  ...props
}: TextFieldProps) {
  return (
    <RacTextField {...props} className={fieldClassName()}>
      <FieldLabel isRequired={props.isRequired}>{label}</FieldLabel>
      <Input
        placeholder={placeholder}
        className={stylexRenderProps<InputRenderProps>((state) => [
          styles.input,
          isMonospace === true && styles.mono,
          state.isHovered && styles.hovered,
          state.isInvalid && styles.invalid,
          state.isFocused && styles.focused,
          state.isDisabled && styles.disabled,
        ])}
      />
      {description !== undefined && <FieldDescription>{description}</FieldDescription>}
      <FieldErrorMessage errorMessage={errorMessage} />
    </RacTextField>
  );
}
```

キャンバスでは説明文はエラーと置き換わるが、RAC は description と error を両方 aria-describedby に入れられるため、両方を出したままにする(エラーが出たら説明を消すのは V3 以降の画面で必要になってから)。

- [ ] **Step 4: TextArea を書き換える**

```tsx
import * as stylex from "@stylexjs/stylex";
import {
  TextArea as RacTextArea,
  TextField as RacTextField,
  type InputRenderProps,
} from "react-aria-components";
import { stylexRenderProps } from "./compose";
import { FieldErrorMessage, FieldLabel, fieldClassName } from "./field";
import { bg, border, focus, font, radius, space, status, stroke, text } from "./semantic.stylex";

const styles = stylex.create({
  area: {
    // 部品固有の最小高(D1 ボード 3b)
    minHeight: "96px",
    paddingBlock: space.sm,
    paddingInline: space.inset,
    fontFamily: font.family,
    fontSize: font.body,
    lineHeight: font.lineHeightNormal,
    color: text.default,
    backgroundColor: bg.canvas,
    borderWidth: stroke.default,
    borderStyle: "solid",
    borderColor: border.default,
    borderRadius: radius.control,
    outline: "none",
    resize: "vertical",
  },
  hovered: { borderColor: border.hover },
  invalid: { borderColor: status.danger },
  focused: {
    outlineWidth: stroke.focus,
    outlineStyle: "solid",
    outlineColor: focus.ring,
    outlineOffset: stroke.focus,
  },
  disabled: { opacity: 0.5, backgroundColor: bg.surface, cursor: "not-allowed" },
});

export interface TextAreaProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  errorMessage?: string;
  isInvalid?: boolean;
  isRequired?: boolean;
  isDisabled?: boolean;
}

export function TextArea({
  label,
  value,
  onChange,
  rows,
  errorMessage,
  isInvalid,
  isRequired,
  isDisabled,
}: TextAreaProps) {
  return (
    <RacTextField
      value={value}
      onChange={onChange}
      isInvalid={isInvalid ?? false}
      isRequired={isRequired ?? false}
      isDisabled={isDisabled ?? false}
      className={fieldClassName()}
    >
      <FieldLabel isRequired={isRequired}>{label}</FieldLabel>
      <RacTextArea
        rows={rows ?? 6}
        className={stylexRenderProps<InputRenderProps>((state) => [
          styles.area,
          state.isHovered && styles.hovered,
          state.isInvalid && styles.invalid,
          state.isFocused && styles.focused,
          state.isDisabled && styles.disabled,
        ])}
      />
      <FieldErrorMessage errorMessage={errorMessage} />
    </RacTextField>
  );
}
```

- [ ] **Step 5: テストを通してコミット**

Run: `pnpm --filter @plyrs/ui exec vitest run src/text-field.test.tsx src/text-area.test.tsx && pnpm --filter @plyrs/admin test`
Expected: PASS(admin の `getByLabelText` が名前の変化で外れないこと)

```bash
git add packages/ui/src/field.tsx packages/ui/src/text-field.tsx packages/ui/src/text-area.tsx packages/ui/src/text-field.test.tsx packages/ui/src/text-area.test.tsx
git commit -m "feat(ui): 入力欄を D1 の見た目にし、ラベル・必須・エラーの表示を共通化する"
```

---

### Task 5: Button の見直し、IconButton とツールチップ

**Files:**
- Create: `packages/ui/src/tooltip.tsx`、`packages/ui/src/tooltip.test.tsx`
- Modify: `packages/ui/src/button.tsx`(全体)
- Test: `packages/ui/src/button.test.tsx`(追記)
- Modify: `packages/ui/src/index.ts`

**Interfaces:**
- Produces: `ButtonVariant = "primary" | "secondary" | "danger" | "link" | "dangerLink"`、`ButtonSize = "md" | "sm"`、`ButtonProps`(`icon?: LucideIcon`、`size?`、`children?: ReactNode`)、`IconButton({ icon, label, size?, …RAC の ButtonProps })`、`Tooltip({ content, children, placement?, delay? })`

- [ ] **Step 1: 失敗するテストを書く**

`packages/ui/src/button.test.tsx` の末尾に足す(`import { Plus, X } from "lucide-react";` と `import { IconButton } from "./button";` を足す):

```tsx
describe("Button の D1 の見た目", () => {
  it("アイコンは装飾として読み上げず、名前は文字から取る", () => {
    render(<Button icon={Plus}>お知らせを追加</Button>);
    const button = screen.getByRole("button", { name: "お知らせを追加" });
    expect(button.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("テキストリンクと小型はクラスが変わる", () => {
    const { rerender } = render(<Button variant="secondary">A</Button>);
    const secondary = screen.getByRole("button", { name: "A" }).className;
    rerender(<Button variant="link">A</Button>);
    expect(screen.getByRole("button", { name: "A" }).className).not.toBe(secondary);
    rerender(
      <Button variant="secondary" size="sm">
        A
      </Button>,
    );
    expect(screen.getByRole("button", { name: "A" }).className).not.toBe(secondary);
  });
});

describe("IconButton", () => {
  it("label が名前になり、キーボードのフォーカスで同じ文言のツールチップを出す", async () => {
    const onPress = vi.fn();
    render(<IconButton icon={X} label="閉じる" onPress={onPress} />);
    const button = screen.getByRole("button", { name: "閉じる" });
    await userEvent.tab();
    expect(button).toHaveFocus();
    expect(await screen.findByRole("tooltip")).toHaveTextContent("閉じる");
    await userEvent.keyboard("{Enter}");
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
```

`packages/ui/src/tooltip.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import { Button } from "./button";
import { Tooltip } from "./tooltip";

it("フォーカスで内容を出し、Esc で閉じる", async () => {
  render(
    <Tooltip content="2026/10/17 10:00">
      <Button variant="secondary">10 分前</Button>
    </Tooltip>,
  );
  await userEvent.tab();
  expect(await screen.findByRole("tooltip")).toHaveTextContent("2026/10/17 10:00");
  await userEvent.keyboard("{Escape}");
  expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
});
```

Run: `pnpm --filter @plyrs/ui exec vitest run src/button.test.tsx src/tooltip.test.tsx`
Expected: FAIL(`IconButton` / `./tooltip` が無い)

- [ ] **Step 2: tooltip.tsx を書く**

```tsx
import * as stylex from "@stylexjs/stylex";
import type { ReactElement, ReactNode } from "react";
import { Tooltip as RacTooltip, TooltipTrigger } from "react-aria-components";
import { bg, elevation, font, layer, radius, space, text } from "./semantic.stylex";

// D1 ボード 3c。地は bg.inverse で、bg.raised の面ではないため枠線は付けない(h-design-tokens.md 3.1)
const styles = stylex.create({
  tooltip: {
    backgroundColor: bg.inverse,
    color: text.inverse,
    fontFamily: font.family,
    fontSize: font.caption,
    lineHeight: font.lineHeightNormal,
    paddingBlock: space.xs,
    paddingInline: space.sm,
    borderRadius: radius.item,
    boxShadow: elevation.menu,
    whiteSpace: "nowrap",
    // モーダルやトーストの中の要素にも出すため、最も上の重なり順にする
    zIndex: layer.toast,
  },
});

export interface TooltipProps {
  content: ReactNode;
  /** RAC のフォーカスできる要素(Button など)。素の要素は Focusable で包む(relative-time.tsx) */
  children: ReactElement;
  placement?: "top" | "bottom" | "start" | "end";
  delay?: number;
}

export function Tooltip({ content, children, placement = "top", delay = 600 }: TooltipProps) {
  return (
    <TooltipTrigger delay={delay}>
      {children}
      <RacTooltip
        placement={placement}
        offset={8}
        className={stylex.props(styles.tooltip).className ?? ""}
      >
        {content}
      </RacTooltip>
    </TooltipTrigger>
  );
}
```

- [ ] **Step 3: button.tsx を書き換える**

```tsx
import * as stylex from "@stylexjs/stylex";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import {
  Button as RacButton,
  type ButtonProps as RacButtonProps,
  type ButtonRenderProps,
} from "react-aria-components";
import { stylexRenderProps } from "./compose";
import { ICON_SIZE } from "./icon";
import {
  accent,
  bg,
  border,
  focus,
  font,
  motion,
  radius,
  size,
  space,
  status,
  stroke,
  text,
} from "./semantic.stylex";
import { Tooltip } from "./tooltip";

// D1 ボード 3a: 塗り / 枠線 / 危険 / テキストリンク(+ 危険色)と、アイコンのみのゴースト(IconButton)。
// 角丸はすべて radius.button(案 R)。危険の押下はキャンバスの inset 影を採らず dangerHover だけにした
// (h-design-tokens.md 3.1 の用途「危険ボタンのホバー・押下」)
const styles = stylex.create({
  base: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: space.sm,
    height: size.control,
    paddingInline: space.md,
    fontFamily: font.family,
    fontSize: font.body,
    fontWeight: font.weightMedium,
    lineHeight: 1,
    whiteSpace: "nowrap",
    textDecoration: "none",
    borderWidth: stroke.default,
    borderStyle: "solid",
    borderColor: "transparent",
    borderRadius: radius.button,
    cursor: "pointer",
    outline: "none",
    transitionProperty: "background-color, border-color, color",
    transitionDuration: motion.fast,
  },
  sm: { height: size.controlSm, paddingInline: space.inset, fontSize: font.caption },
  primary: { backgroundColor: accent.default, color: text.onAccent },
  primaryHovered: { backgroundColor: accent.hover },
  primaryPressed: { backgroundColor: accent.active },
  secondary: { backgroundColor: bg.canvas, color: text.default, borderColor: border.default },
  secondaryHovered: { backgroundColor: bg.hover, borderColor: border.hover },
  secondaryPressed: { backgroundColor: bg.pressed, borderColor: border.hover },
  danger: { backgroundColor: status.danger, color: text.onAccent },
  dangerHovered: { backgroundColor: status.dangerHover },
  dangerPressed: { backgroundColor: status.dangerHover },
  link: {
    height: "auto",
    paddingBlock: space.xxs,
    paddingInline: space.xs,
    borderRadius: radius.small,
    backgroundColor: "transparent",
    color: accent.default,
  },
  linkHovered: { color: accent.hover, textDecoration: "underline" },
  linkPressed: { color: accent.active, textDecoration: "underline" },
  dangerLink: {
    height: "auto",
    paddingBlock: space.xxs,
    paddingInline: space.xs,
    borderRadius: radius.small,
    backgroundColor: "transparent",
    color: status.danger,
  },
  dangerLinkHovered: { color: status.dangerHover, textDecoration: "underline" },
  ghost: { backgroundColor: "transparent", color: text.muted, paddingInline: 0 },
  ghostHovered: { backgroundColor: bg.hover, color: text.default },
  ghostPressed: { backgroundColor: bg.pressed, color: text.default },
  iconMd: { width: size.control },
  iconSm: { width: size.controlSm, height: size.controlSm },
  focusVisible: {
    outlineWidth: stroke.focus,
    outlineStyle: "solid",
    outlineColor: focus.ring,
    outlineOffset: stroke.focus,
  },
  disabled: { opacity: 0.5, cursor: "not-allowed" },
});

export type ButtonVariant = "primary" | "secondary" | "danger" | "link" | "dangerLink";
export type ButtonSize = "md" | "sm";

const VARIANT_STYLES = {
  primary: [styles.primary, styles.primaryHovered, styles.primaryPressed],
  secondary: [styles.secondary, styles.secondaryHovered, styles.secondaryPressed],
  danger: [styles.danger, styles.dangerHovered, styles.dangerPressed],
  link: [styles.link, styles.linkHovered, styles.linkPressed],
  dangerLink: [styles.dangerLink, styles.dangerLinkHovered, styles.dangerLinkHovered],
} as const;

export interface ButtonProps extends Omit<RacButtonProps, "className" | "style" | "children"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** 文字の左に置く Lucide のアイコン(装飾。読み上げない) */
  icon?: LucideIcon;
  children?: ReactNode;
}

export function Button({
  variant = "primary",
  size: buttonSize = "md",
  icon: Icon,
  children,
  ...props
}: ButtonProps) {
  const [normal, hovered, pressed] = VARIANT_STYLES[variant];
  return (
    <RacButton
      {...props}
      className={stylexRenderProps<ButtonRenderProps>((state) => [
        styles.base,
        buttonSize === "sm" && styles.sm,
        normal,
        state.isHovered && hovered,
        state.isPressed && pressed,
        state.isFocusVisible && styles.focusVisible,
        state.isDisabled && styles.disabled,
      ])}
    >
      {Icon !== undefined && <Icon size={ICON_SIZE.inline} aria-hidden="true" />}
      {children}
    </RacButton>
  );
}

export interface IconButtonProps
  extends Omit<RacButtonProps, "className" | "style" | "children" | "aria-label"> {
  icon: LucideIcon;
  /** aria-label とツールチップの文言(h-common-surface.md 12 章: アイコンのみのボタンは必須) */
  label: string;
  size?: ButtonSize;
}

export function IconButton({ icon: Icon, label, size: buttonSize = "md", ...props }: IconButtonProps) {
  return (
    <Tooltip content={label}>
      <RacButton
        {...props}
        aria-label={label}
        className={stylexRenderProps<ButtonRenderProps>((state) => [
          styles.base,
          styles.ghost,
          buttonSize === "sm" ? styles.iconSm : styles.iconMd,
          state.isHovered && styles.ghostHovered,
          state.isPressed && styles.ghostPressed,
          state.isFocusVisible && styles.focusVisible,
          state.isDisabled && styles.disabled,
        ])}
      >
        <Icon size={ICON_SIZE.inline} aria-hidden="true" />
      </RacButton>
    </Tooltip>
  );
}
```

`RacButtonProps` の `children` は render 関数も取れるが、admin で関数の children を渡している箇所は無い(`grep -rn "<Button[^>]*>{(" apps/admin/src` で 0 件を確かめる)。

- [ ] **Step 4: index.ts に足す**

`export { Button, type ButtonProps, type ButtonVariant } from "./button";` を次にする:

```ts
export {
  Button,
  IconButton,
  type ButtonProps,
  type ButtonSize,
  type ButtonVariant,
  type IconButtonProps,
} from "./button";
export { Tooltip, type TooltipProps } from "./tooltip";
export { ICON_SIZE, ICON_STROKE } from "./icon";
```

- [ ] **Step 5: テストを通してコミット**

Run: `pnpm --filter @plyrs/ui exec vitest run src/button.test.tsx src/tooltip.test.tsx && pnpm --filter @plyrs/admin test && pnpm typecheck`
Expected: PASS

```bash
git add packages/ui/src/button.tsx packages/ui/src/button.test.tsx packages/ui/src/tooltip.tsx packages/ui/src/tooltip.test.tsx packages/ui/src/index.ts
git commit -m "feat(ui): ボタンを 5 種と小型にし、アイコンのみのボタンとツールチップを足す"
```

---

### Task 6: Select / Checkbox / CheckboxGroup の見直し

**Files:**
- Modify: `packages/ui/src/select.tsx`(全体)
- Modify: `packages/ui/src/checkbox.tsx`(全体)
- Modify: `packages/ui/src/checkbox-group.tsx`(全体)
- Test: `packages/ui/src/select.test.tsx`、`packages/ui/src/checkbox.test.tsx`(追記)

**Interfaces:**
- Consumes: Task 4 の `FieldLabel` / `FieldErrorText` / `fieldClassName`
- Produces: `CheckboxProps` に `isIndeterminate?` / `isInvalid?` を足す。`CheckboxBox(state)`(index からは出さない。Task 16 の表が使う)。`CheckboxGroupProps` に `isRequired?` を足す

- [ ] **Step 1: 失敗するテストを足す**

`packages/ui/src/select.test.tsx` に足す(既存の import に `within` が無ければ足す):

```tsx
it("選択中の候補に check のアイコンを付け、他の候補は付けない", async () => {
  const user = userEvent.setup();
  render(
    <Select
      label="型"
      items={[
        { value: "news", label: "お知らせ" },
        { value: "event", label: "イベント" },
      ]}
      selectedValue="news"
      onChange={() => {}}
    />,
  );
  await user.click(screen.getByRole("button", { name: /型/ }));
  const selected = await screen.findByRole("option", { name: "お知らせ" });
  expect(selected.querySelector("svg.lucide-check")).not.toBeNull();
  expect(screen.getByRole("option", { name: "イベント" }).querySelector("svg.lucide-check")).toBeNull();
});

it("エラー文をアイコン付きで出す", () => {
  render(
    <Select label="型" items={[]} selectedValue="" onChange={() => {}} errorMessage="型を選んでください" />,
  );
  expect(screen.getByText("型を選んでください").querySelector("svg")).not.toBeNull();
});
```

`packages/ui/src/checkbox.test.tsx` に足す:

```tsx
it("一部選択は mixed として読み上げる", () => {
  render(
    <Checkbox isSelected={false} isIndeterminate onChange={() => {}}>
      すべて
    </Checkbox>,
  );
  expect(screen.getByRole("checkbox", { name: "すべて" })).toHaveAttribute("aria-checked", "mixed");
});
```

`CheckboxGroup` のテストは既存のもの(配列の合成)を残す。新しく足すもの(同じファイルか、無ければ `packages/ui/src/checkbox-group.test.tsx` を作る):

```tsx
it("エラーのときはグループに説明を結び、各チェックボックスを invalid にする", () => {
  render(
    <CheckboxGroup
      label="公開先"
      options={[{ value: "web", label: "Web" }]}
      value={[]}
      onChange={() => {}}
      errorMessage="1 つ以上選んでください"
    />,
  );
  const group = screen.getByRole("group", { name: "公開先" });
  expect(group).toHaveAccessibleDescription("1 つ以上選んでください");
  expect(screen.getByRole("checkbox", { name: "Web" })).toHaveAttribute("aria-invalid", "true");
});
```

Run: `pnpm --filter @plyrs/ui exec vitest run src/select.test.tsx src/checkbox.test.tsx src/checkbox-group.test.tsx`
Expected: FAIL

- [ ] **Step 2: select.tsx を書き換える**

```tsx
import * as stylex from "@stylexjs/stylex";
import { Check, ChevronsUpDown } from "lucide-react";
import {
  Button as RacButton,
  ListBox,
  ListBoxItem,
  Popover,
  Select as RacSelect,
  SelectValue,
  type ListBoxItemRenderProps,
} from "react-aria-components";
import { stylexRenderProps } from "./compose";
import { FieldErrorText, FieldLabel, fieldClassName } from "./field";
import { ICON_SIZE } from "./icon";
import {
  accent,
  bg,
  border,
  elevation,
  focus,
  font,
  layer,
  radius,
  size,
  space,
  status,
  stroke,
  text,
} from "./semantic.stylex";

// D1 ボード 3b。候補の一覧は浮いた面(bg.raised + 枠線 + elevation.menu)
const styles = stylex.create({
  trigger: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.sm,
    height: size.control,
    paddingInline: space.inset,
    fontFamily: font.family,
    fontSize: font.body,
    color: text.default,
    backgroundColor: bg.canvas,
    borderWidth: stroke.default,
    borderStyle: "solid",
    borderColor: border.default,
    borderRadius: radius.control,
    cursor: "pointer",
    outline: "none",
    textAlign: "start",
  },
  triggerHovered: { borderColor: border.hover },
  triggerInvalid: { borderColor: status.danger },
  triggerFocused: {
    outlineWidth: stroke.focus,
    outlineStyle: "solid",
    outlineColor: focus.ring,
    outlineOffset: stroke.focus,
  },
  triggerDisabled: { opacity: 0.5, backgroundColor: bg.surface, cursor: "not-allowed" },
  chevron: { color: text.muted, flexShrink: 0 },
  popover: {
    minWidth: "var(--trigger-width)",
    padding: space.xs,
    backgroundColor: bg.raised,
    borderWidth: stroke.default,
    borderStyle: "solid",
    borderColor: border.default,
    borderRadius: radius.container,
    boxShadow: elevation.menu,
    zIndex: layer.dropdown,
    outline: "none",
  },
  listBox: { outline: "none" },
  item: {
    display: "flex",
    alignItems: "center",
    gap: space.sm,
    minHeight: size.control,
    paddingInline: space.inset,
    borderRadius: radius.item,
    fontFamily: font.family,
    fontSize: font.body,
    color: text.default,
    cursor: "pointer",
    outline: "none",
  },
  itemFocused: { backgroundColor: bg.hover },
  // 選択中は文字と check で示し、地は塗らない(D1 ボード 3b)
  itemSelected: { color: accent.default, fontWeight: font.weightMedium },
  checkSlot: { display: "inline-flex", width: "16px", flexShrink: 0 },
});

export interface SelectProps {
  label: string;
  items: { value: string; label: string }[];
  /** 空文字 = 未選択（placeholder 表示） */
  selectedValue: string;
  onChange: (value: string) => void;
  placeholder?: string;
  isDisabled?: boolean;
  errorMessage?: string;
}

export function Select({
  label,
  items,
  selectedValue,
  onChange,
  placeholder,
  isDisabled,
  errorMessage,
}: SelectProps) {
  const isInvalid = errorMessage !== undefined;
  return (
    <RacSelect
      selectedKey={selectedValue === "" ? null : selectedValue}
      onSelectionChange={(key) => onChange(key === null ? "" : String(key))}
      isDisabled={isDisabled ?? false}
      isInvalid={isInvalid}
      placeholder={placeholder ?? "選択してください"}
      className={fieldClassName()}
    >
      {({ isOpen, isFocusVisible, isDisabled: disabled }) => (
        <>
          <FieldLabel>{label}</FieldLabel>
          <RacButton
            className={stylexRenderProps<{ isHovered: boolean }>((state) => [
              styles.trigger,
              state.isHovered && styles.triggerHovered,
              isInvalid && styles.triggerInvalid,
              (isOpen || isFocusVisible) && styles.triggerFocused,
              disabled && styles.triggerDisabled,
            ])}
          >
            <SelectValue />
            <ChevronsUpDown size={ICON_SIZE.inline} aria-hidden="true" {...stylex.props(styles.chevron)} />
          </RacButton>
          {isInvalid && <FieldErrorText slot="errorMessage">{errorMessage}</FieldErrorText>}
          <Popover offset={2} className={stylex.props(styles.popover).className ?? ""}>
            <ListBox className={stylex.props(styles.listBox).className ?? ""}>
              {items.map((item) => (
                <ListBoxItem
                  key={item.value}
                  id={item.value}
                  textValue={item.label}
                  className={stylexRenderProps<ListBoxItemRenderProps>((state) => [
                    styles.item,
                    (state.isFocused || state.isHovered) && styles.itemFocused,
                    state.isSelected && styles.itemSelected,
                  ])}
                >
                  {({ isSelected }) => (
                    <>
                      <span {...stylex.props(styles.checkSlot)}>
                        {isSelected && <Check size={ICON_SIZE.inline} aria-hidden="true" />}
                      </span>
                      {item.label}
                    </>
                  )}
                </ListBoxItem>
              ))}
            </ListBox>
          </Popover>
        </>
      )}
    </RacSelect>
  );
}
```

`stylexRenderProps<{ isHovered: boolean }>` は RAC の `ButtonRenderProps` の一部だけを使う型注釈。`ButtonRenderProps` を import して使ってもよい(Task 5 と同じ)。lucide の `className` を `{...stylex.props(...)}` で渡せない場合は、`<span {...stylex.props(styles.chevron)}>` で包む。

- [ ] **Step 3: checkbox.tsx を書き換える**

```tsx
import * as stylex from "@stylexjs/stylex";
import { Check, Minus } from "lucide-react";
import type { ReactNode } from "react";
import { Checkbox as RacCheckbox, type CheckboxRenderProps } from "react-aria-components";
import { stylexRenderProps } from "./compose";
import {
  accent,
  bg,
  border,
  focus,
  font,
  radius,
  size,
  space,
  status,
  stroke,
  text,
} from "./semantic.stylex";

// D1 ボード 3b。箱はキャンバスの 18px を 16px に寄せた(表の中の箱と同じ大きさ)
const BOX = "16px";
const MARK = 12;

const styles = stylex.create({
  root: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.sm,
    minHeight: size.controlSm,
    fontFamily: font.family,
    fontSize: font.body,
    color: text.default,
    cursor: "pointer",
  },
  rootDisabled: { opacity: 0.5, cursor: "not-allowed" },
  box: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    boxSizing: "border-box",
    width: BOX,
    height: BOX,
    color: text.onAccent,
    backgroundColor: bg.canvas,
    borderWidth: stroke.default,
    borderStyle: "solid",
    borderColor: border.hover,
    borderRadius: radius.small,
  },
  boxHovered: { borderColor: text.muted },
  boxFilled: { backgroundColor: accent.default, borderColor: accent.default },
  boxInvalid: { borderColor: status.danger },
  boxFocus: {
    outlineWidth: stroke.focus,
    outlineStyle: "solid",
    outlineColor: focus.ring,
    outlineOffset: stroke.focus,
  },
});

type BoxState = Pick<
  CheckboxRenderProps,
  "isSelected" | "isIndeterminate" | "isHovered" | "isFocusVisible" | "isInvalid"
>;

/** 箱だけの描画。表の選択列(table.tsx)も使う */
export function CheckboxBox({ isSelected, isIndeterminate, isHovered, isFocusVisible, isInvalid }: BoxState) {
  return (
    <span
      aria-hidden="true"
      {...stylex.props(
        styles.box,
        isHovered && styles.boxHovered,
        (isSelected || isIndeterminate) && styles.boxFilled,
        isInvalid && styles.boxInvalid,
        isFocusVisible && styles.boxFocus,
      )}
    >
      {isIndeterminate ? (
        <Minus size={MARK} strokeWidth={3} />
      ) : isSelected ? (
        <Check size={MARK} strokeWidth={3} />
      ) : null}
    </span>
  );
}

export interface CheckboxProps {
  children: ReactNode;
  isSelected: boolean;
  onChange: (isSelected: boolean) => void;
  isDisabled?: boolean;
  /** 一部選択(表の見出しの全選択など) */
  isIndeterminate?: boolean;
  isInvalid?: boolean;
}

export function Checkbox({
  children,
  isSelected,
  onChange,
  isDisabled,
  isIndeterminate,
  isInvalid,
}: CheckboxProps) {
  return (
    <RacCheckbox
      isSelected={isSelected}
      onChange={onChange}
      isDisabled={isDisabled ?? false}
      isIndeterminate={isIndeterminate ?? false}
      isInvalid={isInvalid ?? false}
      className={stylexRenderProps<CheckboxRenderProps>((state) => [
        styles.root,
        state.isDisabled && styles.rootDisabled,
      ])}
    >
      {(state) => (
        <>
          <CheckboxBox {...state} />
          {children}
        </>
      )}
    </RacCheckbox>
  );
}
```

- [ ] **Step 4: checkbox-group.tsx を書き換える**

既存の実装注意のコメント(RacCheckboxGroup を使わない理由)はそのまま残し、本体を次にする:

```tsx
import { useId } from "react";
import * as stylex from "@stylexjs/stylex";
import { Checkbox } from "./checkbox";
import { FieldErrorText, FieldLabel, fieldClassName } from "./field";
import { space } from "./semantic.stylex";

const styles = stylex.create({
  options: { display: "flex", flexDirection: "column", gap: space.xxs },
});

export interface CheckboxGroupProps {
  label: string;
  options: { value: string; label: string }[];
  value: string[];
  onChange: (next: string[]) => void;
  errorMessage?: string;
  isRequired?: boolean;
}

// (既存の実装注意のコメントをここに残す)
export function CheckboxGroup({
  label,
  options,
  value,
  onChange,
  errorMessage,
  isRequired,
}: CheckboxGroupProps) {
  const errorId = useId();
  const isInvalid = errorMessage !== undefined;

  return (
    <div
      role="group"
      aria-label={label}
      aria-required={isRequired === true ? true : undefined}
      aria-describedby={isInvalid ? errorId : undefined}
      className={fieldClassName()}
    >
      <FieldLabel elementType="span" isRequired={isRequired}>
        {label}
      </FieldLabel>
      <div {...stylex.props(styles.options)}>
        {options.map((option) => (
          <Checkbox
            key={option.value}
            isSelected={value.includes(option.value)}
            isInvalid={isInvalid}
            onChange={(selected) =>
              onChange(selected ? [...value, option.value] : value.filter((v) => v !== option.value))
            }
          >
            {option.label}
          </Checkbox>
        ))}
      </div>
      {isInvalid && <FieldErrorText id={errorId}>{errorMessage}</FieldErrorText>}
    </div>
  );
}
```

- [ ] **Step 5: テストを通してコミット**

Run: `pnpm --filter @plyrs/ui test && pnpm --filter @plyrs/admin test`
Expected: PASS

```bash
git add packages/ui/src/select.tsx packages/ui/src/checkbox.tsx packages/ui/src/checkbox-group.tsx packages/ui/src/*.test.tsx
git commit -m "feat(ui): セレクトとチェックボックスを D1 の見た目にする"
```

---

### Task 7: RichTextEditor の見直し

機能(ツールバーの 12 操作・aria-label・メンション・画像・リンク入力)は変えず、見た目だけを D1 ボード 3b に揃える。キャンバスのツールバーは 7 操作だが、既存の操作を減らすのは本計画の範囲外とする。

**Files:**
- Modify: `packages/ui/src/rich-text-editor.tsx`(import、`styles`、`RichTextEditor` の return、`Toolbar` の return、`ToolbarToggle`)
- Test: `packages/ui/src/rich-text-editor.test.tsx`(追記)

**Interfaces:**
- Consumes: Task 4 の `FieldErrorText`、Task 5 の `Tooltip`

- [ ] **Step 1: 失敗するテストを足す**

```tsx
it("ツールバーのボタンはアイコンのみで、名前は従来どおり", () => {
  render(<RichTextEditor label="本文" value={undefined} onChange={() => {}} />);
  const bold = screen.getByRole("button", { name: "太字" });
  expect(bold).toHaveTextContent("");
  expect(bold.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  expect(screen.getAllByRole("separator").length).toBeGreaterThan(0);
});
```

Run: `pnpm --filter @plyrs/ui exec vitest run src/rich-text-editor.test.tsx`
Expected: FAIL(`太字` の文字が「B」)

- [ ] **Step 2: import と styles を差し替える**

`import { colors, spacing, typography } from "./tokens.stylex";` を消し、次を足す:

```tsx
import {
  Bold,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Image as ImageIcon,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Quote,
  SquareCode,
  type LucideIcon,
} from "lucide-react";
import { FieldErrorText } from "./field";
import { ICON_SIZE } from "./icon";
import {
  bg,
  border,
  elevation,
  focus,
  font,
  radius,
  size,
  space,
  stroke,
  text,
} from "./semantic.stylex";
import { Tooltip } from "./tooltip";
```

`const styles = stylex.create({ … })` を全体置き換え:

```tsx
// D1 ボード 3b: 外枠に入力欄と同じ枠線と角丸、ツールバーはゴーストのアイコンボタン、
// フォーカスのリングは外枠全体に付ける
const styles = stylex.create({
  root: { display: "flex", flexDirection: "column", gap: space.sm, fontFamily: font.family },
  label: { fontSize: font.body, fontWeight: font.weightMedium, color: text.default },
  frame: {
    backgroundColor: bg.canvas,
    borderWidth: stroke.default,
    borderStyle: "solid",
    borderColor: border.default,
    borderRadius: radius.control,
    outlineStyle: { default: "none", ":focus-within": "solid" },
    outlineWidth: stroke.focus,
    outlineColor: focus.ring,
    outlineOffset: stroke.focus,
  },
  toolbar: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: space.xxs,
    padding: space.xs,
    borderBottomWidth: stroke.default,
    borderBottomStyle: "solid",
    borderBottomColor: border.default,
  },
  separator: {
    alignSelf: "stretch",
    width: stroke.default,
    marginInline: space.xs,
    backgroundColor: border.default,
  },
  toolButton: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: size.controlSm,
    height: size.controlSm,
    color: text.muted,
    backgroundColor: "transparent",
    borderWidth: 0,
    borderRadius: radius.button,
    cursor: "pointer",
    outline: "none",
  },
  toolHovered: { backgroundColor: bg.hover, color: text.default },
  toolButtonActive: { backgroundColor: bg.pressed, color: text.default },
  toolFocus: {
    outlineWidth: stroke.focus,
    outlineStyle: "solid",
    outlineColor: focus.ring,
    outlineOffset: stroke.focus,
  },
  linkPanel: {
    display: "flex",
    gap: space.sm,
    alignItems: "flex-end",
    padding: space.sm,
    borderBottomWidth: stroke.default,
    borderBottomStyle: "solid",
    borderBottomColor: border.default,
  },
  content: { fontSize: font.body, color: text.default },
  mentionList: {
    display: "flex",
    flexDirection: "column",
    maxWidth: "320px",
    padding: space.xs,
    backgroundColor: bg.raised,
    borderWidth: stroke.default,
    borderStyle: "solid",
    borderColor: border.default,
    borderRadius: radius.container,
    boxShadow: elevation.menu,
  },
  mentionOption: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: space.sm,
    minHeight: size.control,
    paddingInline: space.inset,
    borderRadius: radius.item,
    cursor: "pointer",
  },
  mentionOptionActive: { backgroundColor: bg.hover },
  mentionType: { fontSize: font.caption, color: text.muted },
});
```

`editorProps.attributes.style` を次にする(ProseMirror の DOM には StyleX が届かない既存の規約どおり inline。値は尺度の space4 / space5 と lineHeightRelaxed):

```ts
          style: "outline: none; min-height: 120px; padding: 12px 16px; line-height: 1.75;",
```

- [ ] **Step 3: 描画を差し替える**

`RichTextEditor` の return の `<span {...stylex.props(styles.label)}>{label}</span>` の直後から `<EditorContent … />` までを外枠で包む:

```tsx
      <span {...stylex.props(styles.label)}>{label}</span>
      <div {...stylex.props(styles.frame)}>
        <Toolbar
          editor={editor}
          label={label}
          onRequestAssetImage={/* 既存の式をそのまま */}
        />
        <EditorContent editor={editor} {...stylex.props(styles.content)} />
      </div>
```

末尾のエラーを `{errorMessage !== undefined && <FieldErrorText>{errorMessage}</FieldErrorText>}` にする。

`Toolbar` の return の toolbar の中身を次にする(aria-label は既存のまま。区切りでまとまりを分ける):

```tsx
      <div role="toolbar" aria-label={`${label} の書式`} {...stylex.props(styles.toolbar)}>
        <ToolbarToggle label="見出し1" icon={Heading1} isActive={active.heading1} onToggle={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} />
        <ToolbarToggle label="見出し2" icon={Heading2} isActive={active.heading2} onToggle={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} />
        <ToolbarToggle label="見出し3" icon={Heading3} isActive={active.heading3} onToggle={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} />
        <ToolbarSeparator />
        <ToolbarToggle label="太字" icon={Bold} isActive={active.bold} onToggle={() => editor.chain().focus().toggleBold().run()} />
        <ToolbarToggle label="斜体" icon={Italic} isActive={active.italic} onToggle={() => editor.chain().focus().toggleItalic().run()} />
        <ToolbarToggle label="コード" icon={Code} isActive={active.code} onToggle={() => editor.chain().focus().toggleCode().run()} />
        <ToolbarSeparator />
        <ToolbarToggle label="箇条書き" icon={List} isActive={active.bulletList} onToggle={() => editor.chain().focus().toggleBulletList().run()} />
        <ToolbarToggle label="番号リスト" icon={ListOrdered} isActive={active.orderedList} onToggle={() => editor.chain().focus().toggleOrderedList().run()} />
        <ToolbarToggle label="引用" icon={Quote} isActive={active.blockquote} onToggle={() => editor.chain().focus().toggleBlockquote().run()} />
        <ToolbarToggle label="コードブロック" icon={SquareCode} isActive={active.codeBlock} onToggle={() => editor.chain().focus().toggleCodeBlock().run()} />
        <ToolbarSeparator />
        <ToolbarToggle label="リンク" icon={LinkIcon} isActive={active.link} onToggle={openLinkPanel} />
        {onRequestAssetImage !== undefined && (
          <ToolbarToggle label="画像" icon={ImageIcon} isActive={false} onToggle={onRequestAssetImage} />
        )}
      </div>
```

(oxfmt が改行を整える。)`linkPanel` の中の `Button` は `variant="secondary" size="sm"` にする。

`ToolbarToggle` を置き換え、`ToolbarSeparator` を足す:

```tsx
function ToolbarToggle({
  label,
  icon: Icon,
  isActive,
  onToggle,
}: {
  label: string;
  icon: LucideIcon;
  isActive: boolean;
  onToggle: () => void;
}) {
  return (
    <Tooltip content={label}>
      <RacToggleButton
        aria-label={label}
        isSelected={isActive}
        onChange={onToggle}
        className={stylexRenderProps<ToggleButtonRenderProps>((state) => [
          styles.toolButton,
          state.isHovered && styles.toolHovered,
          state.isSelected && styles.toolButtonActive,
          state.isFocusVisible && styles.toolFocus,
        ])}
      >
        <Icon size={ICON_SIZE.inline} aria-hidden="true" />
      </RacToggleButton>
    </Tooltip>
  );
}

function ToolbarSeparator() {
  return <span role="separator" aria-orientation="vertical" {...stylex.props(styles.separator)} />;
}
```

`ReactNode` の import が未使用になったら外す。

- [ ] **Step 4: テストを通してコミット**

Run: `pnpm --filter @plyrs/ui exec vitest run src/rich-text-editor.test.tsx src/tiptap-jsdom.test.ts && pnpm --filter @plyrs/admin exec vitest run src/richtext-flow.test.tsx src/components/record-form.test.tsx`
Expected: PASS

```bash
git add packages/ui/src/rich-text-editor.tsx packages/ui/src/rich-text-editor.test.tsx
git commit -m "feat(ui): リッチテキストエディタを外枠とアイコンのツールバーにする"
```

---

### Task 8: バッジ

**Files:**
- Create: `packages/ui/src/badge.tsx`、`packages/ui/src/badge.test.tsx`
- Modify: `packages/ui/src/index.ts`

**Interfaces:**
- Produces: `BadgeTone = "neutral" | "accent" | "success" | "warning" | "danger"`、`Badge({ tone?, dot?, icon?, isStruck?, isMonospace?, children })`。公開状態・ステータスの文言と色の対応は admin の `lib/labels.ts` 側で V3 が組む

- [ ] **Step 1: 失敗するテストを書く**

```tsx
import { render, screen } from "@testing-library/react";
import { Globe } from "lucide-react";
import { describe, expect, it } from "vitest";
import { Badge } from "./badge";

describe("Badge(D1 ボード 3d)", () => {
  it("文字を必ず出し、点とアイコンは読み上げない", () => {
    render(
      <>
        <Badge tone="success" dot>
          公開中
        </Badge>
        <Badge tone="success" icon={Globe}>
          公開中(大)
        </Badge>
      </>,
    );
    const dotted = screen.getByText("公開中");
    expect(dotted.querySelector("[aria-hidden='true']")).not.toBeNull();
    expect(screen.getByText("公開中(大)").querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("色ごとにクラスが変わる", () => {
    const { rerender } = render(<Badge tone="neutral">下書き</Badge>);
    const neutral = screen.getByText("下書き").className;
    rerender(<Badge tone="accent">下書き</Badge>);
    expect(screen.getByText("下書き").className).not.toBe(neutral);
  });
});
```

Run: `pnpm --filter @plyrs/ui exec vitest run src/badge.test.tsx`
Expected: FAIL

- [ ] **Step 2: badge.tsx を書く**

```tsx
import * as stylex from "@stylexjs/stylex";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { ICON_SIZE } from "./icon";
import { accent, bg, border, font, radius, space, status, stroke, text } from "./semantic.stylex";

// D1 ボード 3d。radius.badge(4px)の長方形で、pill のボタンと形で区別する(案 R)。
// 色だけで状態を伝えないよう、文字は必ず出す(h-common-surface.md 11 章)
const styles = stylex.create({
  badge: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.xs,
    paddingBlock: space.xxs,
    paddingInline: space.sm,
    fontFamily: font.family,
    fontSize: font.caption,
    fontWeight: font.weightMedium,
    lineHeight: font.lineHeightNormal,
    whiteSpace: "nowrap",
    borderWidth: stroke.default,
    borderStyle: "solid",
    borderColor: "transparent",
    borderRadius: radius.badge,
  },
  neutral: { backgroundColor: bg.surface, color: text.muted, borderColor: border.default },
  accent: { backgroundColor: accent.surface, color: accent.default },
  success: { backgroundColor: status.successSurface, color: status.success },
  warning: { backgroundColor: status.warningSurface, color: status.warning },
  danger: { backgroundColor: status.dangerSurface, color: status.danger },
  struck: { textDecoration: "line-through" },
  mono: { fontFamily: font.familyMono },
  // h-common-surface.md 12 章: 公開状態は 6px の点を基本にする
  dot: {
    width: "6px",
    height: "6px",
    flexShrink: 0,
    borderRadius: radius.full,
    backgroundColor: "currentColor",
  },
});

export type BadgeTone = "neutral" | "accent" | "success" | "warning" | "danger";

export interface BadgeProps {
  tone?: BadgeTone;
  /** 公開状態の 6px の点 */
  dot?: boolean;
  /** アイコン付きは公開ボックスの大きい表示でだけ使う(12 章) */
  icon?: LucideIcon;
  /** アーカイブの取り消し線 */
  isStruck?: boolean;
  /** 識別子の表示 */
  isMonospace?: boolean;
  children: ReactNode;
}

export function Badge({ tone = "neutral", dot, icon: Icon, isStruck, isMonospace, children }: BadgeProps) {
  return (
    <span
      {...stylex.props(
        styles.badge,
        styles[tone],
        isStruck === true && styles.struck,
        isMonospace === true && styles.mono,
      )}
    >
      {dot === true && <span aria-hidden="true" {...stylex.props(styles.dot)} />}
      {Icon !== undefined && <Icon size={ICON_SIZE.inline} aria-hidden="true" />}
      {children}
    </span>
  );
}
```

- [ ] **Step 3: export してコミット**

`index.ts` に `export { Badge, type BadgeProps, type BadgeTone } from "./badge";` を足す。

Run: `pnpm --filter @plyrs/ui exec vitest run src/badge.test.tsx`
Expected: PASS

```bash
git add packages/ui/src/badge.tsx packages/ui/src/badge.test.tsx packages/ui/src/index.ts
git commit -m "feat(ui): バッジを足す"
```

---

### Task 9: バナー・空状態・スケルトン

**Files:**
- Create: `packages/ui/src/banner.tsx`、`packages/ui/src/empty-state.tsx`、`packages/ui/src/skeleton.tsx`
- Create: `packages/ui/src/status-surfaces.test.tsx`(3 部品のテスト)
- Modify: `packages/ui/src/index.ts`

**Interfaces:**
- Produces: `Banner({ tone: "warning" | "danger", children, action? })`、`EmptyState({ title, description?, icon?, action?, size?: "default" | "compact" })`、`Skeleton({ width?, height?, shape?: "text" | "block" | "circle" })`

- [ ] **Step 1: 失敗するテストを書く**

```tsx
import { render, screen } from "@testing-library/react";
import { Inbox } from "lucide-react";
import { describe, expect, it } from "vitest";
import { Banner } from "./banner";
import { Button } from "./button";
import { EmptyState } from "./empty-state";
import { Skeleton } from "./skeleton";

describe("Banner", () => {
  it("警告は status、エラーは alert で読み上げ、操作を添えられる", () => {
    render(
      <>
        <Banner tone="warning" action={<Button size="sm" variant="secondary">今すぐ再接続</Button>}>
          サーバーとの接続が切れています。
        </Banner>
        <Banner tone="danger">このサイトのメンバーから外されました。</Banner>
      </>,
    );
    expect(screen.getByRole("status")).toHaveTextContent("サーバーとの接続が切れています。");
    expect(screen.getByRole("button", { name: "今すぐ再接続" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("メンバーから外されました");
  });
});

describe("EmptyState", () => {
  it("題・説明・次の行動を出す。題は見出しにしない(ページの h1 と競合させない)", () => {
    render(
      <EmptyState
        icon={Inbox}
        title="イベントはまだありません"
        description="最初のイベントを追加しましょう。"
        action={<Button>イベントを追加</Button>}
      />,
    );
    expect(screen.getByText("イベントはまだありません")).toBeInTheDocument();
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "イベントを追加" })).toBeInTheDocument();
  });
});

describe("Skeleton", () => {
  it("読み上げない", () => {
    const { container } = render(<Skeleton width={64} height={22} />);
    expect(container.firstElementChild).toHaveAttribute("aria-hidden", "true");
  });
});
```

Run: `pnpm --filter @plyrs/ui exec vitest run src/status-surfaces.test.tsx`
Expected: FAIL

- [ ] **Step 2: banner.tsx を書く**

```tsx
import * as stylex from "@stylexjs/stylex";
import { CircleAlert, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { ICON_SIZE } from "./icon";
import { border, font, space, status, stroke, text } from "./semantic.stylex";

// D1 ボード 3e / 4: シェル上部に 1 か所だけ置く画面全体のお知らせ。角丸なし、下に罫線
const styles = stylex.create({
  banner: {
    display: "flex",
    alignItems: "center",
    gap: space.inset,
    paddingBlock: space.inset,
    paddingInline: space.pageGutter,
    fontFamily: font.family,
    fontSize: font.body,
    color: text.default,
    borderBottomWidth: stroke.default,
    borderBottomStyle: "solid",
    borderBottomColor: border.default,
  },
  warning: { backgroundColor: status.warningSurface },
  danger: { backgroundColor: status.dangerSurface },
  warningIcon: { color: status.warning, display: "inline-flex", flexShrink: 0 },
  dangerIcon: { color: status.danger, display: "inline-flex", flexShrink: 0 },
  message: { flex: 1 },
});

export interface BannerProps {
  tone: "warning" | "danger";
  children: ReactNode;
  /** 小型の枠線ボタン(例: 今すぐ再接続) */
  action?: ReactNode;
}

export function Banner({ tone, children, action }: BannerProps) {
  const Icon = tone === "warning" ? TriangleAlert : CircleAlert;
  return (
    <div role={tone === "danger" ? "alert" : "status"} {...stylex.props(styles.banner, styles[tone])}>
      <span {...stylex.props(tone === "warning" ? styles.warningIcon : styles.dangerIcon)}>
        <Icon size={ICON_SIZE.inline} aria-hidden="true" />
      </span>
      <span {...stylex.props(styles.message)}>{children}</span>
      {action}
    </div>
  );
}
```

- [ ] **Step 3: empty-state.tsx を書く**

```tsx
import * as stylex from "@stylexjs/stylex";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { ICON_SIZE, ICON_STROKE } from "./icon";
import { bg, border, font, radius, space, stroke, text } from "./semantic.stylex";

// D1 ボード 3e。アイコンは 12 章の 32px(線幅 1.75)を 64px の円に置く。
// compact は閲覧者向けなど、アイコンもボタンも無い小さい表示
const styles = stylex.create({
  root: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    textAlign: "center",
    gap: space.sm,
    paddingBlock: space.xl,
    paddingInline: space.lg,
    fontFamily: font.family,
    borderWidth: stroke.default,
    borderStyle: "dashed",
    borderColor: border.default,
    borderRadius: radius.container,
  },
  iconCircle: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "64px",
    height: "64px",
    borderRadius: radius.full,
    backgroundColor: bg.surface,
    color: text.muted,
  },
  title: { margin: 0, fontSize: font.label, fontWeight: font.weightBold, color: text.default },
  titleCompact: { fontSize: font.body },
  description: { margin: 0, maxWidth: "320px", fontSize: font.body, color: text.muted },
  action: { marginTop: space.sm },
});

export interface EmptyStateProps {
  title: string;
  description?: ReactNode;
  icon?: LucideIcon;
  /** 塗りのボタン、または「絞り込みを解除」のテキストリンク */
  action?: ReactNode;
  size?: "default" | "compact";
}

export function EmptyState({ title, description, icon: Icon, action, size = "default" }: EmptyStateProps) {
  return (
    <div {...stylex.props(styles.root)}>
      {Icon !== undefined && (
        <span {...stylex.props(styles.iconCircle)}>
          <Icon size={ICON_SIZE.empty} strokeWidth={ICON_STROKE.large} aria-hidden="true" />
        </span>
      )}
      <p {...stylex.props(styles.title, size === "compact" && styles.titleCompact)}>{title}</p>
      {description !== undefined && <p {...stylex.props(styles.description)}>{description}</p>}
      {action !== undefined && <div {...stylex.props(styles.action)}>{action}</div>}
    </div>
  );
}
```

- [ ] **Step 4: skeleton.tsx を書く**

```tsx
import * as stylex from "@stylexjs/stylex";
import { bg, radius } from "./semantic.stylex";

// D1 ボード 3e: 置き換える部品と同じ寸法で描く。各要素は aria-hidden、親(画面)に aria-busy を付ける
const pulse = stylex.keyframes({
  "0%": { opacity: 1 },
  "50%": { opacity: 0.55 },
  "100%": { opacity: 1 },
});

const styles = stylex.create({
  base: {
    display: "block",
    backgroundColor: bg.skeleton,
    borderRadius: radius.small,
    animationName: pulse,
    // 緩い明滅(キャンバスの指定)。開閉用の motion.normal(200ms)では速すぎるため部品内で持つ
    animationDuration: "1.6s",
    animationIterationCount: "infinite",
    animationTimingFunction: "ease-in-out",
    "@media (prefers-reduced-motion: reduce)": { animationName: "none" },
  },
  circle: { borderRadius: radius.full },
  dims: (width: string, height: string) => ({ width, height }),
});

export interface SkeletonProps {
  width?: number | string;
  height?: number | string;
  shape?: "text" | "block" | "circle";
}

function toCss(value: number | string): string {
  return typeof value === "number" ? `${value}px` : value;
}

export function Skeleton({ width = "100%", height = 14, shape = "block" }: SkeletonProps) {
  return (
    <span
      aria-hidden="true"
      {...stylex.props(styles.base, shape === "circle" && styles.circle, styles.dims(toCss(width), toCss(height)))}
    />
  );
}
```

`"@media (prefers-reduced-motion: reduce)": { animationName: "none" }` の書き方がコンパイルエラーになる場合は、StyleX の既定の書式 `animationName: { default: pulse, "@media (prefers-reduced-motion: reduce)": "none" }` にする。

- [ ] **Step 5: export してコミット**

`index.ts` に足す:

```ts
export { Banner, type BannerProps } from "./banner";
export { EmptyState, type EmptyStateProps } from "./empty-state";
export { Skeleton, type SkeletonProps } from "./skeleton";
```

Run: `pnpm --filter @plyrs/ui exec vitest run src/status-surfaces.test.tsx`
Expected: PASS

```bash
git add packages/ui/src/banner.tsx packages/ui/src/empty-state.tsx packages/ui/src/skeleton.tsx packages/ui/src/status-surfaces.test.tsx packages/ui/src/index.ts
git commit -m "feat(ui): バナー・空状態・スケルトンを足す"
```

---

### Task 10: 進捗表示と相対時刻

**Files:**
- Create: `packages/ui/src/progress.tsx`、`packages/ui/src/progress.test.tsx`
- Create: `packages/ui/src/relative-time.tsx`、`packages/ui/src/relative-time.test.tsx`
- Modify: `packages/ui/src/index.ts`

**Interfaces:**
- Consumes: Task 5 の `Tooltip`
- Produces: `ProgressBar({ label, value, maxValue?, valueLabel?, tone?: "accent" | "success" })`、`Spinner({ label })`、`RelativeTime({ value: { text, absolute, iso } })`(admin の `formatDateTime()` の戻り値 `FormattedDateTime` と同じ形を受ける)

- [ ] **Step 1: 失敗するテストを書く**

`packages/ui/src/progress.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { ProgressBar, Spinner } from "./progress";

it("ProgressBar は progressbar として値と件数の文言を持つ", () => {
  render(<ProgressBar label="公開しています…" value={3} maxValue={10} valueLabel="3 / 10 件" />);
  const bar = screen.getByRole("progressbar", { name: "公開しています…" });
  expect(bar).toHaveAttribute("aria-valuenow", "3");
  expect(bar).toHaveAttribute("aria-valuetext", "3 / 10 件");
  expect(screen.getByText("3 / 10 件")).toBeInTheDocument();
});

it("Spinner は文言を出し、アイコンは読み上げない", () => {
  render(<Spinner label="アップロードしています…" />);
  const text = screen.getByText("アップロードしています…");
  expect(text.parentElement?.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
});
```

`packages/ui/src/relative-time.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import { RelativeTime } from "./relative-time";

it("相対表記は time 要素で、フォーカスで日時のツールチップを出す", async () => {
  render(
    <RelativeTime value={{ text: "10 分前", absolute: "2026/10/17 10:00", iso: "2026-10-17T01:00:00.000Z" }} />,
  );
  const time = screen.getByText("10 分前");
  expect(time.tagName).toBe("TIME");
  expect(time).toHaveAttribute("dateTime", "2026-10-17T01:00:00.000Z");
  await userEvent.tab();
  expect(await screen.findByRole("tooltip")).toHaveTextContent("2026/10/17 10:00");
});

it("7 日より前は日時をそのまま出し、ツールチップもフォーカスも持たない", () => {
  render(
    <RelativeTime value={{ text: "2026/08/01 09:30", absolute: "2026/08/01 09:30", iso: "2026-08-01T00:30:00.000Z" }} />,
  );
  expect(screen.getByText("2026/08/01 09:30")).not.toHaveAttribute("tabindex");
});
```

Run: `pnpm --filter @plyrs/ui exec vitest run src/progress.test.tsx src/relative-time.test.tsx`
Expected: FAIL

- [ ] **Step 2: progress.tsx を書く**

```tsx
import * as stylex from "@stylexjs/stylex";
import { LoaderCircle } from "lucide-react";
import { ProgressBar as RacProgressBar } from "react-aria-components";
import { ICON_SIZE } from "./icon";
import { accent, bg, border, font, radius, space, status, stroke, text } from "./semantic.stylex";

// D1 ボード 3e(バー)/ D2・D3(回転アイコン)
const spin = stylex.keyframes({
  from: { transform: "rotate(0deg)" },
  to: { transform: "rotate(360deg)" },
});

const styles = stylex.create({
  root: { display: "flex", flexDirection: "column", gap: space.xs, fontFamily: font.family },
  header: { display: "flex", justifyContent: "space-between", gap: space.sm, fontSize: font.body },
  label: { color: text.default },
  value: { color: text.muted },
  track: {
    height: space.sm,
    overflow: "hidden",
    backgroundColor: bg.surface,
    borderWidth: stroke.default,
    borderStyle: "solid",
    borderColor: border.default,
    borderRadius: radius.full,
  },
  fill: { height: "100%", borderRadius: radius.full, backgroundColor: accent.default },
  fillSuccess: { backgroundColor: status.success },
  fillWidth: (percentage: number) => ({ width: `${percentage}%` }),
  spinner: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.sm,
    fontFamily: font.family,
    fontSize: font.body,
    fontWeight: font.weightBold,
    color: accent.default,
  },
  spinIcon: {
    display: "inline-flex",
    animationName: spin,
    animationDuration: "1s",
    animationIterationCount: "infinite",
    animationTimingFunction: "linear",
  },
});

export interface ProgressBarProps {
  label: string;
  value: number;
  maxValue?: number;
  /** 右上の件数などの文言(aria-valuetext にも使う) */
  valueLabel?: string;
  tone?: "accent" | "success";
}

export function ProgressBar({ label, value, maxValue = 100, valueLabel, tone = "accent" }: ProgressBarProps) {
  return (
    <RacProgressBar
      value={value}
      maxValue={maxValue}
      aria-label={label}
      valueLabel={valueLabel}
      className={stylex.props(styles.root).className ?? ""}
    >
      {({ percentage = 0, valueText }) => (
        <>
          <div {...stylex.props(styles.header)}>
            <span aria-hidden="true" {...stylex.props(styles.label)}>
              {label}
            </span>
            <span aria-hidden="true" {...stylex.props(styles.value)}>
              {valueText}
            </span>
          </div>
          <div {...stylex.props(styles.track)}>
            <div
              {...stylex.props(
                styles.fill,
                tone === "success" && styles.fillSuccess,
                styles.fillWidth(percentage),
              )}
            />
          </div>
        </>
      )}
    </RacProgressBar>
  );
}

/** 一括操作・アップロードの実行中。親(画面)に aria-busy を付ける */
export function Spinner({ label }: { label: string }) {
  return (
    <span {...stylex.props(styles.spinner)}>
      <span {...stylex.props(styles.spinIcon)}>
        <LoaderCircle size={ICON_SIZE.inline} aria-hidden="true" />
      </span>
      <span>{label}</span>
    </span>
  );
}
```

テストの `screen.getByText("3 / 10 件")` は `aria-hidden` の要素でも `getByText` で見つかる(Testing Library の `getByText` は既定で隠れた要素も対象)。もし見つからない場合は `{ hidden: true }` ではなく `getByText` の既定のまま調べ、`aria-hidden` を外すかを判断する(名前と値は progressbar の属性で読み上げられるため、見た目の文字は読み上げから外すのが正)。

- [ ] **Step 3: relative-time.tsx を書く**

```tsx
import * as stylex from "@stylexjs/stylex";
import { Focusable } from "react-aria-components";
import { focus, font, radius, stroke, text } from "./semantic.stylex";
import { Tooltip } from "./tooltip";

// h-common-surface.md 5 章 / D1 ボード 3e。書式は admin の lib/datetime.ts(formatDateTime)が作り、
// ここは表示だけを持つ。相対表記のときだけ点線の下線とツールチップで日時を添える
const styles = stylex.create({
  time: { fontFamily: font.family, fontSize: font.body, color: text.muted },
  relative: {
    textDecorationLine: "underline",
    textDecorationStyle: "dotted",
    textUnderlineOffset: "3px",
    borderRadius: radius.small,
    cursor: "default",
    // 素の <time> のため RAC の isFocusVisible が無い。:focus-visible で同じリングを出す
    outlineStyle: { default: "none", ":focus-visible": "solid" },
    outlineWidth: stroke.focus,
    outlineColor: focus.ring,
    outlineOffset: stroke.focus,
  },
});

export interface RelativeTimeValue {
  /** 画面に出す文字列(相対表記、または日時) */
  text: string;
  /** 日時の文字列 */
  absolute: string;
  /** <time dateTime> に入れる ISO 8601 */
  iso: string;
}

export function RelativeTime({ value }: { value: RelativeTimeValue }) {
  if (value.text === value.absolute) {
    return (
      <time dateTime={value.iso} {...stylex.props(styles.time)}>
        {value.text}
      </time>
    );
  }
  return (
    <Tooltip content={value.absolute}>
      <Focusable>
        <time tabIndex={0} dateTime={value.iso} {...stylex.props(styles.time, styles.relative)}>
          {value.text}
        </time>
      </Focusable>
    </Tooltip>
  );
}
```


- [ ] **Step 4: export してコミット**

```ts
export { ProgressBar, Spinner, type ProgressBarProps } from "./progress";
export { RelativeTime, type RelativeTimeValue } from "./relative-time";
```

Run: `pnpm --filter @plyrs/ui exec vitest run src/progress.test.tsx src/relative-time.test.tsx`
Expected: PASS

```bash
git add packages/ui/src/progress.tsx packages/ui/src/progress.test.tsx packages/ui/src/relative-time.tsx packages/ui/src/relative-time.test.tsx packages/ui/src/index.ts
git commit -m "feat(ui): 進捗表示と相対時刻を足す"
```

---

### Task 11: モーダルダイアログと確認ダイアログ

**Files:**
- Create: `packages/ui/src/dialog.tsx`、`packages/ui/src/dialog.test.tsx`
- Modify: `packages/ui/src/index.ts`

**Interfaces:**
- Consumes: Task 5 の `Button` / `IconButton`
- Produces: `ModalDialog({ title, isOpen, onOpenChange, children, footer?, role?, isDismissable?, showCloseButton? })`、`ConfirmDialog({ title, isOpen, onOpenChange, children, confirmLabel, cancelLabel?, tone?: "danger" | "primary", onConfirm, isPending? })`。確認の実行後に閉じるのは呼び出し側(`onConfirm` の中で `onOpenChange(false)`)。V3 の削除・取り下げ、V4 のメンバー追加・メディア選択が使う

- [ ] **Step 1: 失敗するテストを書く**

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { Button } from "./button";
import { ConfirmDialog, ModalDialog } from "./dialog";

function Harness({ onConfirm }: { onConfirm: () => void }) {
  const [isOpen, setOpen] = useState(false);
  return (
    <>
      <Button onPress={() => setOpen(true)}>削除</Button>
      <ConfirmDialog
        isOpen={isOpen}
        onOpenChange={setOpen}
        title="お知らせを削除しますか？"
        confirmLabel="削除する"
        onConfirm={() => {
          onConfirm();
          setOpen(false);
        }}
      >
        公開中のページも消え、元に戻せません。
      </ConfirmDialog>
    </>
  );
}

describe("ConfirmDialog", () => {
  it("危険な確認は alertdialog で、実行ボタンに初期フォーカスがある", async () => {
    const user = userEvent.setup();
    render(<Harness onConfirm={() => {}} />);
    await user.click(screen.getByRole("button", { name: "削除" }));
    const dialog = await screen.findByRole("alertdialog", { name: "お知らせを削除しますか？" });
    expect(dialog).toHaveTextContent("元に戻せません");
    expect(screen.getByRole("button", { name: "削除する" })).toHaveFocus();
  });

  it("キャンセルで閉じて開いたボタンへフォーカスを戻し、実行は呼ばない", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<Harness onConfirm={onConfirm} />);
    const opener = screen.getByRole("button", { name: "削除" });
    await user.click(opener);
    await user.click(await screen.findByRole("button", { name: "キャンセル" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("実行ボタンで onConfirm を呼ぶ", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<Harness onConfirm={onConfirm} />);
    await user.click(screen.getByRole("button", { name: "削除" }));
    await user.click(await screen.findByRole("button", { name: "削除する" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });
});

describe("ModalDialog", () => {
  it("右上の閉じるボタンと Esc で閉じる", async () => {
    const user = userEvent.setup();
    function Open() {
      const [isOpen, setOpen] = useState(true);
      return (
        <ModalDialog title="メンバーを追加" isOpen={isOpen} onOpenChange={setOpen}>
          本文
        </ModalDialog>
      );
    }
    const { rerender } = render(<Open />);
    await user.click(await screen.findByRole("button", { name: "閉じる" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    rerender(<></>);
    render(<Open />);
    await screen.findByRole("dialog", { name: "メンバーを追加" });
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
```

Run: `pnpm --filter @plyrs/ui exec vitest run src/dialog.test.tsx`
Expected: FAIL

- [ ] **Step 2: dialog.tsx を書く**

```tsx
import * as stylex from "@stylexjs/stylex";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { Dialog, Heading, Modal, ModalOverlay } from "react-aria-components";
import { Button, IconButton } from "./button";
import { bg, border, elevation, font, layer, radius, space, stroke, text } from "./semantic.stylex";

// D1 ボード 3c。本体は浮いた面(bg.raised + 枠線 + elevation.modal)。題は設計書どおり 20px
const styles = stylex.create({
  overlay: {
    position: "fixed",
    inset: 0,
    zIndex: layer.modal,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: space.md,
    backgroundColor: bg.overlay,
  },
  modal: {
    // 部品固有の幅(D1 ボード 3c)
    width: "440px",
    maxWidth: "100%",
    maxHeight: "100%",
    overflowY: "auto",
    backgroundColor: bg.raised,
    borderWidth: stroke.default,
    borderStyle: "solid",
    borderColor: border.default,
    borderRadius: radius.container,
    boxShadow: elevation.modal,
    outline: "none",
  },
  dialog: {
    display: "flex",
    flexDirection: "column",
    gap: space.md,
    padding: space.lg,
    fontFamily: font.family,
    outline: "none",
  },
  header: { display: "flex", alignItems: "flex-start", gap: space.sm },
  title: {
    flex: 1,
    margin: 0,
    fontSize: font.sectionTitle,
    fontWeight: font.weightBold,
    lineHeight: font.lineHeightTight,
    color: text.default,
  },
  body: { fontSize: font.body, lineHeight: font.lineHeightNormal, color: text.muted },
  footer: { display: "flex", justifyContent: "flex-end", gap: space.sm },
});

export interface ModalDialogProps {
  title: string;
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  children: ReactNode;
  /** 右寄せのボタン。実行ボタンを右端に置く */
  footer?: ReactNode;
  role?: "dialog" | "alertdialog";
  /** 暗幕のクリックで閉じるか */
  isDismissable?: boolean;
  showCloseButton?: boolean;
}

export function ModalDialog({
  title,
  isOpen,
  onOpenChange,
  children,
  footer,
  role = "dialog",
  isDismissable = true,
  showCloseButton = true,
}: ModalDialogProps) {
  return (
    <ModalOverlay
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      isDismissable={isDismissable}
      className={stylex.props(styles.overlay).className ?? ""}
    >
      <Modal className={stylex.props(styles.modal).className ?? ""}>
        <Dialog role={role} className={stylex.props(styles.dialog).className ?? ""}>
          <div {...stylex.props(styles.header)}>
            <Heading slot="title" {...stylex.props(styles.title)}>
              {title}
            </Heading>
            {showCloseButton && <IconButton icon={X} label="閉じる" size="sm" slot="close" />}
          </div>
          <div {...stylex.props(styles.body)}>{children}</div>
          {footer !== undefined && <div {...stylex.props(styles.footer)}>{footer}</div>}
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}

export interface ConfirmDialogProps {
  title: string;
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  /** 何が起きるかの説明 */
  children: ReactNode;
  /** 実行する操作名(「OK」にしない。h-common-surface.md 4.2) */
  confirmLabel: string;
  cancelLabel?: string;
  /** 8 章: 元に戻せない・公開中の内容に影響する操作は danger */
  tone?: "danger" | "primary";
  onConfirm: () => void;
  isPending?: boolean;
}

export function ConfirmDialog({
  title,
  isOpen,
  onOpenChange,
  children,
  confirmLabel,
  cancelLabel = "キャンセル",
  tone = "danger",
  onConfirm,
  isPending,
}: ConfirmDialogProps) {
  return (
    <ModalDialog
      title={title}
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      role={tone === "danger" ? "alertdialog" : "dialog"}
      isDismissable={false}
      showCloseButton={false}
      footer={
        <>
          <Button variant="secondary" slot="close">
            {cancelLabel}
          </Button>
          <Button
            variant={tone === "danger" ? "danger" : "primary"}
            autoFocus
            isDisabled={isPending ?? false}
            onPress={onConfirm}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </ModalDialog>
  );
}
```

`Heading` に `{...stylex.props()}` の `style` が型で合わなければ `className={stylex.props(styles.title).className ?? ""}` にする。

- [ ] **Step 3: export してコミット**

```ts
export { ConfirmDialog, ModalDialog, type ConfirmDialogProps, type ModalDialogProps } from "./dialog";
```

Run: `pnpm --filter @plyrs/ui exec vitest run src/dialog.test.tsx`
Expected: PASS(Review Focus 4: `slot="close"` がツールチップの包みを越えて届くこと)

```bash
git add packages/ui/src/dialog.tsx packages/ui/src/dialog.test.tsx packages/ui/src/index.ts
git commit -m "feat(ui): モーダルダイアログと確認ダイアログを足す"
```

---

### Task 12: トースト

**Files:**
- Create: `packages/ui/src/toast.tsx`、`packages/ui/src/toast.test.tsx`
- Modify: `packages/ui/src/index.ts`

**Interfaces:**
- Consumes: Task 5 の `Button` / `IconButton`
- Produces: `ToastTone = "success" | "danger"`、`ToastAction = { label: string; onAction: () => void; icon?: LucideIcon }`、`Toaster = { success(title): string; error(title, action?): string; close(key): void }`、`createToaster(): Toaster`、`toaster`(アプリ全体の 1 つ)、`ToastRegion({ toaster? })`(V2 のシェルが置く)

- [ ] **Step 1: 失敗するテストを書く**

```tsx
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RotateCw } from "lucide-react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastRegion, createToaster } from "./toast";

afterEach(() => {
  vi.useRealTimers();
});

describe("トースト(h-common-surface.md 11 章)", () => {
  it("成功は status で読み上げ、5 秒で消える", () => {
    vi.useFakeTimers();
    const toaster = createToaster();
    render(<ToastRegion toaster={toaster} />);
    act(() => {
      toaster.success("公開しました");
    });
    expect(screen.getByRole("status")).toHaveTextContent("公開しました");
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(screen.queryByText("公開しました")).not.toBeInTheDocument();
  });

  it("エラーは alert で、閉じるまで残り、操作を押すと実行して閉じる", async () => {
    const user = userEvent.setup();
    const toaster = createToaster();
    const onAction = vi.fn();
    render(<ToastRegion toaster={toaster} />);
    act(() => {
      toaster.error("公開できませんでした", { label: "再試行", icon: RotateCw, onAction });
    });
    expect(screen.getByRole("alert")).toHaveTextContent("公開できませんでした");
    await user.click(screen.getByRole("button", { name: "再試行" }));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("公開できませんでした")).not.toBeInTheDocument();
  });

  it("閉じるボタンで閉じる", async () => {
    const user = userEvent.setup();
    const toaster = createToaster();
    render(<ToastRegion toaster={toaster} />);
    act(() => {
      toaster.error("削除できませんでした");
    });
    await user.click(screen.getByRole("button", { name: "閉じる" }));
    expect(screen.queryByText("削除できませんでした")).not.toBeInTheDocument();
  });

  it("別々に作ったトーストは互いに見えない", () => {
    const first = createToaster();
    const second = createToaster();
    render(<ToastRegion toaster={second} />);
    act(() => {
      first.success("A");
    });
    expect(screen.queryByText("A")).not.toBeInTheDocument();
  });
});
```

Run: `pnpm --filter @plyrs/ui exec vitest run src/toast.test.tsx`
Expected: FAIL

- [ ] **Step 2: toast.tsx を書く**

```tsx
import * as stylex from "@stylexjs/stylex";
import { CircleAlert, CircleCheck, X, type LucideIcon } from "lucide-react";
import {
  Text,
  UNSTABLE_Toast as RacToast,
  UNSTABLE_ToastContent as RacToastContent,
  UNSTABLE_ToastQueue as RacToastQueue,
  UNSTABLE_ToastRegion as RacToastRegion,
  type ToastRenderProps,
} from "react-aria-components";
import { Button, IconButton } from "./button";
import { stylexRenderProps } from "./compose";
import { ICON_SIZE } from "./icon";
import {
  bg,
  border,
  elevation,
  focus,
  font,
  layer,
  radius,
  space,
  status,
  stroke,
  text,
} from "./semantic.stylex";

// h-common-surface.md 3 章(2026-10-18): RAC 1.21.1 ではトーストが UNSTABLE_ としてだけ提供される。
// UNSTABLE_ の import はこのファイルに閉じ込め、外へは Toaster と ToastRegion だけを出す。
// 地は bg.raised(設計書 3.1)とし、成功 / エラーはアイコンの色で示す

export type ToastTone = "success" | "danger";

export interface ToastAction {
  label: string;
  onAction: () => void;
  icon?: LucideIcon;
}

interface ToastValue {
  tone: ToastTone;
  title: string;
  action?: ToastAction;
}

// 11 章: 成功は 5 秒で消え、エラーは閉じるまで残す
const SUCCESS_TIMEOUT_MS = 5_000;

export interface Toaster {
  /** @internal ToastRegion が使う */
  readonly queue: RacToastQueue<ToastValue>;
  success(title: string): string;
  error(title: string, action?: ToastAction): string;
  close(key: string): void;
}

export function createToaster(): Toaster {
  const queue = new RacToastQueue<ToastValue>({ maxVisibleToasts: 3 });
  return {
    queue,
    success: (title) => queue.add({ tone: "success", title }, { timeout: SUCCESS_TIMEOUT_MS }),
    error: (title, action) =>
      queue.add(action === undefined ? { tone: "danger", title } : { tone: "danger", title, action }),
    close: (key) => queue.close(key),
  };
}

/** アプリ全体で 1 つのトースト。ToastRegion はシェル(V2)が 1 か所に置く */
export const toaster = createToaster();

const styles = stylex.create({
  region: {
    position: "fixed",
    insetInlineEnd: space.lg,
    insetBlockEnd: space.lg,
    zIndex: layer.toast,
    display: "flex",
    flexDirection: "column",
    gap: space.sm,
    // 部品固有の幅(D1 ボード 3c)
    width: "400px",
    maxWidth: `calc(100vw - 2 * ${space.md})`,
    outline: "none",
  },
  toast: {
    display: "flex",
    alignItems: "flex-start",
    gap: space.inset,
    padding: space.inset,
    fontFamily: font.family,
    fontSize: font.body,
    lineHeight: font.lineHeightNormal,
    color: text.default,
    backgroundColor: bg.raised,
    borderWidth: stroke.default,
    borderStyle: "solid",
    borderColor: border.default,
    borderRadius: radius.container,
    boxShadow: elevation.modal,
    outline: "none",
  },
  focusVisible: {
    outlineWidth: stroke.focus,
    outlineStyle: "solid",
    outlineColor: focus.ring,
    outlineOffset: stroke.focus,
  },
  // 28px の閉じるボタンと 1 行目の高さを揃える
  icon: { display: "inline-flex", flexShrink: 0, paddingBlock: space.xs },
  successIcon: { color: status.success },
  dangerIcon: { color: status.danger },
  content: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: space.sm,
    paddingBlock: space.xxs,
  },
});

export function ToastRegion({ toaster: target = toaster }: { toaster?: Toaster }) {
  return (
    <RacToastRegion
      queue={target.queue}
      aria-label="通知"
      className={stylex.props(styles.region).className ?? ""}
    >
      {({ toast }) => {
        const { tone, title, action } = toast.content;
        const Icon = tone === "success" ? CircleCheck : CircleAlert;
        return (
          <RacToast
            toast={toast}
            className={stylexRenderProps<ToastRenderProps<ToastValue>>((state) => [
              styles.toast,
              state.isFocusVisible && styles.focusVisible,
            ])}
          >
            <span {...stylex.props(styles.icon, tone === "success" ? styles.successIcon : styles.dangerIcon)}>
              <Icon size={ICON_SIZE.inline} aria-hidden="true" />
            </span>
            {/* RAC は role="alert" を既定にする。成功は status で控えめに読み上げる(11 章) */}
            <RacToastContent
              role={tone === "danger" ? "alert" : "status"}
              {...stylex.props(styles.content)}
            >
              <Text slot="title">{title}</Text>
              {action !== undefined && (
                <Button
                  variant="secondary"
                  size="sm"
                  {...(action.icon === undefined ? {} : { icon: action.icon })}
                  onPress={() => {
                    action.onAction();
                    target.close(toast.key);
                  }}
                >
                  {action.label}
                </Button>
              )}
            </RacToastContent>
            <IconButton icon={X} label="閉じる" size="sm" slot="close" />
          </RacToast>
        );
      }}
    </RacToastRegion>
  );
}
```

注意:
- RAC の `ToastContent` は `useContextProps` で文脈の props(`role: "alert"`)と渡した props を合わせ、後者が勝つ(`react-aria-components/dist/private/Toast.mjs` で確認済み)。テストで `role="status"` にならない場合は、この前提が版の更新で崩れていないかを見る
- RAC の `UNSTABLE_ToastRegion` は表示中のトーストが無いと何も描画しない。テストで `act()` の外から `toaster.success()` を呼ぶと警告になるため、必ず `act()` で包む

- [ ] **Step 3: export してコミット**

```ts
export {
  ToastRegion,
  createToaster,
  toaster,
  type ToastAction,
  type ToastTone,
  type Toaster,
} from "./toast";
```

Run: `pnpm --filter @plyrs/ui exec vitest run src/toast.test.tsx`
Expected: PASS(Review Focus 4・5)

```bash
git add packages/ui/src/toast.tsx packages/ui/src/toast.test.tsx packages/ui/src/index.ts
git commit -m "feat(ui): RAC の UNSTABLE_Toast を包んだトーストを足す"
```

---

### Task 13: パンくずとタブ

**Files:**
- Create: `packages/ui/src/breadcrumbs.tsx`、`packages/ui/src/tabs.tsx`
- Create: `packages/ui/src/navigation.test.tsx`
- Modify: `packages/ui/src/index.ts`

**Interfaces:**
- Produces: `BreadcrumbItem = { id: string; label: string; href?: string }`、`Breadcrumbs({ items })`、`TabItem = { id: string; label: string; count?: number }`、`Tabs({ label, items, selectedKey, onSelectionChange, children: (id) => ReactNode })`。リンクは RAC の `Link`(`href`)。TanStack Router での画面内遷移は、V2 で admin のルートに RAC の `RouterProvider` を置いてつなぐ

- [ ] **Step 1: 失敗するテストを書く**

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Breadcrumbs } from "./breadcrumbs";
import { Tabs } from "./tabs";

describe("Breadcrumbs", () => {
  it("nav の中に並べ、末尾を現在地にする", () => {
    render(
      <Breadcrumbs
        items={[
          { id: "home", label: "ホーム", href: "/t/acme" },
          { id: "news", label: "お知らせ", href: "/t/acme/content/news" },
          { id: "edit", label: "編集" },
        ]}
      />,
    );
    const nav = screen.getByRole("navigation", { name: "パンくず" });
    expect(nav).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "ホーム" })).toHaveAttribute("href", "/t/acme");
    expect(screen.getByText("編集").closest("[aria-current='page']")).not.toBeNull();
  });
});

describe("Tabs", () => {
  const items = [
    { id: "all", label: "すべて", count: 24 },
    { id: "published", label: "公開中", count: 15 },
    { id: "archived", label: "アーカイブ", count: 0 },
  ];

  it("件数を添え、選ぶと onSelectionChange に id を渡す", async () => {
    const onSelectionChange = vi.fn();
    render(
      <Tabs label="公開状態" items={items} selectedKey="all" onSelectionChange={onSelectionChange}>
        {(id) => <p>panel:{id}</p>}
      </Tabs>,
    );
    expect(screen.getByRole("tablist", { name: "公開状態" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /すべて/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: /すべて/ })).toHaveTextContent("24");
    expect(screen.getByText("panel:all")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: /公開中/ }));
    expect(onSelectionChange).toHaveBeenCalledWith("published");
  });
});
```

Run: `pnpm --filter @plyrs/ui exec vitest run src/navigation.test.tsx`
Expected: FAIL

- [ ] **Step 2: breadcrumbs.tsx を書く**

```tsx
import * as stylex from "@stylexjs/stylex";
import { ChevronRight } from "lucide-react";
import {
  Breadcrumb,
  Breadcrumbs as RacBreadcrumbs,
  Link,
  type LinkRenderProps,
} from "react-aria-components";
import { stylexRenderProps } from "./compose";
import { ICON_SIZE } from "./icon";
import { focus, font, radius, space, stroke, text } from "./semantic.stylex";

// D1 ボード 3c / 4。キャンバスの 13px は尺度の 14px(font.body)に寄せた
const styles = stylex.create({
  list: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: space.sm,
    margin: 0,
    padding: 0,
    listStyle: "none",
    fontFamily: font.family,
    fontSize: font.body,
  },
  item: { display: "inline-flex", alignItems: "center", gap: space.sm, minWidth: 0 },
  link: {
    color: text.muted,
    textDecoration: "none",
    borderRadius: radius.small,
    outline: "none",
    cursor: "pointer",
  },
  linkHovered: { color: text.default },
  current: {
    display: "inline-block",
    // 長い末尾の項目だけを省略記号で切る(D1 ボード 3c)
    maxWidth: "200px",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: text.default,
    fontWeight: font.weightMedium,
    cursor: "default",
  },
  focusVisible: {
    outlineWidth: stroke.focus,
    outlineStyle: "solid",
    outlineColor: focus.ring,
    outlineOffset: stroke.focus,
  },
  separator: { display: "inline-flex", color: text.muted, flexShrink: 0 },
});

export interface BreadcrumbItem {
  id: string;
  label: string;
  /** 末尾(現在地)は省略する */
  href?: string;
}

export function Breadcrumbs({ items }: { items: BreadcrumbItem[] }) {
  return (
    <nav aria-label="パンくず">
      <RacBreadcrumbs items={items} className={stylex.props(styles.list).className ?? ""}>
        {(item) => (
          <Breadcrumb id={item.id} className={stylex.props(styles.item).className ?? ""}>
            {({ isCurrent }) => (
              <>
                <Link
                  {...(item.href === undefined ? {} : { href: item.href })}
                  title={isCurrent ? item.label : undefined}
                  className={stylexRenderProps<LinkRenderProps>((state) => [
                    styles.link,
                    !isCurrent && state.isHovered && styles.linkHovered,
                    isCurrent && styles.current,
                    state.isFocusVisible && styles.focusVisible,
                  ])}
                >
                  {item.label}
                </Link>
                {!isCurrent && (
                  <span {...stylex.props(styles.separator)}>
                    <ChevronRight size={ICON_SIZE.inline} aria-hidden="true" />
                  </span>
                )}
              </>
            )}
          </Breadcrumb>
        )}
      </RacBreadcrumbs>
    </nav>
  );
}
```

- [ ] **Step 3: tabs.tsx を書く**

```tsx
import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import {
  Tab,
  TabList,
  TabPanel,
  Tabs as RacTabs,
  type TabRenderProps,
} from "react-aria-components";
import { stylexRenderProps } from "./compose";
import { accent, bg, border, focus, font, radius, size, space, stroke, text } from "./semantic.stylex";

// D1 ボード 3d。件数は radius.badge の長方形(案 R)。件数 0 のタブは薄く出す(案 D 3.2)
const styles = stylex.create({
  list: {
    display: "flex",
    gap: space.xs,
    borderBottomWidth: stroke.default,
    borderBottomStyle: "solid",
    borderBottomColor: border.default,
    fontFamily: font.family,
  },
  tab: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.sm,
    height: size.rowCompact,
    paddingInline: space.inset,
    marginBottom: `calc(-1 * ${stroke.default})`,
    fontSize: font.body,
    fontWeight: font.weightMedium,
    color: text.muted,
    borderBottomWidth: stroke.focus,
    borderBottomStyle: "solid",
    borderBottomColor: "transparent",
    borderTopLeftRadius: radius.item,
    borderTopRightRadius: radius.item,
    cursor: "pointer",
    outline: "none",
    whiteSpace: "nowrap",
  },
  dimmed: { opacity: 0.5 },
  hovered: { backgroundColor: bg.hover },
  selected: { color: accent.default, borderBottomColor: accent.default },
  focusVisible: {
    outlineWidth: stroke.focus,
    outlineStyle: "solid",
    outlineColor: focus.ring,
    outlineOffset: `calc(-1 * ${stroke.focus})`,
  },
  count: {
    paddingInline: space.xs,
    fontSize: font.caption,
    lineHeight: font.lineHeightNormal,
    color: text.muted,
    backgroundColor: bg.surface,
    borderWidth: stroke.default,
    borderStyle: "solid",
    borderColor: border.default,
    borderRadius: radius.badge,
  },
  countSelected: {
    color: accent.default,
    backgroundColor: accent.surface,
    borderColor: "transparent",
  },
  panel: { outline: "none" },
});

export interface TabItem {
  id: string;
  label: string;
  count?: number;
}

export interface TabsProps {
  /** タブの並びの名前(例: 公開状態) */
  label: string;
  items: TabItem[];
  selectedKey: string;
  onSelectionChange: (key: string) => void;
  /** 選ばれたタブの中身。URL の状態から描く画面が多いため、id だけを渡す */
  children: (id: string) => ReactNode;
}

export function Tabs({ label, items, selectedKey, onSelectionChange, children }: TabsProps) {
  return (
    <RacTabs selectedKey={selectedKey} onSelectionChange={(key) => onSelectionChange(String(key))}>
      <TabList aria-label={label} className={stylex.props(styles.list).className ?? ""}>
        {items.map((item) => (
          <Tab
            key={item.id}
            id={item.id}
            className={stylexRenderProps<TabRenderProps>((state) => [
              styles.tab,
              item.count === 0 && !state.isSelected && styles.dimmed,
              state.isHovered && styles.hovered,
              state.isSelected && styles.selected,
              state.isFocusVisible && styles.focusVisible,
            ])}
          >
            {({ isSelected }) => (
              <>
                {item.label}
                {item.count !== undefined && (
                  <span {...stylex.props(styles.count, isSelected && styles.countSelected)}>
                    {item.count}
                  </span>
                )}
              </>
            )}
          </Tab>
        ))}
      </TabList>
      {items.map((item) => (
        <TabPanel key={item.id} id={item.id} className={stylex.props(styles.panel).className ?? ""}>
          {children(item.id)}
        </TabPanel>
      ))}
    </RacTabs>
  );
}
```

- [ ] **Step 4: export してコミット**

```ts
export { Breadcrumbs, type BreadcrumbItem } from "./breadcrumbs";
export { Tabs, type TabItem, type TabsProps } from "./tabs";
```

Run: `pnpm --filter @plyrs/ui exec vitest run src/navigation.test.tsx`
Expected: PASS

```bash
git add packages/ui/src/breadcrumbs.tsx packages/ui/src/tabs.tsx packages/ui/src/navigation.test.tsx packages/ui/src/index.ts
git commit -m "feat(ui): パンくずと件数付きのタブを足す"
```

---

### Task 14: メニュー

**Files:**
- Create: `packages/ui/src/menu.tsx`、`packages/ui/src/menu.test.tsx`
- Modify: `packages/ui/src/index.ts`

**Interfaces:**
- Produces: `Menu({ trigger, label, onAction, children, placement? })`、`MenuItem({ id, children, icon?, tone?: "danger", isDisabled?, isCurrent? })`、`MenuSection({ title?, children })`、`MenuSeparator()`。アカウントメニュー・サイト切替(V2)、一括操作・行アクション(V3)が使う。無効の理由のツールチップは V3 で行アクションと一緒に扱う

- [ ] **Step 1: 失敗するテストを書く**

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Ellipsis, Pencil, Trash2 } from "lucide-react";
import { expect, it, vi } from "vitest";
import { IconButton } from "./button";
import { Menu, MenuItem, MenuSection, MenuSeparator } from "./menu";

it("トリガーで開き、選んだ項目の id を onAction に渡す。無効の項目は選べない", async () => {
  const user = userEvent.setup();
  const onAction = vi.fn();
  render(
    <Menu label="行の操作" trigger={<IconButton icon={Ellipsis} label="その他" />} onAction={onAction}>
      <MenuSection title="お知らせ">
        <MenuItem id="edit" icon={Pencil}>
          編集
        </MenuItem>
        <MenuItem id="unpublish" isDisabled>
          公開を取り下げる
        </MenuItem>
      </MenuSection>
      <MenuSeparator />
      <MenuItem id="delete" icon={Trash2} tone="danger">
        削除
      </MenuItem>
    </Menu>,
  );
  await user.click(screen.getByRole("button", { name: "その他" }));
  const menu = await screen.findByRole("menu", { name: "行の操作" });
  expect(menu).toHaveTextContent("お知らせ");
  expect(screen.getByRole("menuitem", { name: "公開を取り下げる" })).toHaveAttribute("aria-disabled", "true");
  await user.click(screen.getByRole("menuitem", { name: "削除" }));
  expect(onAction).toHaveBeenCalledWith("delete");
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
});
```

Run: `pnpm --filter @plyrs/ui exec vitest run src/menu.test.tsx`
Expected: FAIL

- [ ] **Step 2: menu.tsx を書く**

```tsx
import * as stylex from "@stylexjs/stylex";
import { Check, type LucideIcon } from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import {
  Header,
  Menu as RacMenu,
  MenuItem as RacMenuItem,
  MenuSection as RacMenuSection,
  MenuTrigger,
  Popover,
  Separator,
  type MenuItemRenderProps,
} from "react-aria-components";
import { stylexRenderProps } from "./compose";
import { ICON_SIZE } from "./icon";
import {
  accent,
  bg,
  border,
  elevation,
  font,
  layer,
  radius,
  size,
  space,
  status,
  stroke,
  text,
} from "./semantic.stylex";

// D1 ボード 3c。アイコンは設計書 12 章の 20px(キャンバスの 16px は採らない)
const styles = stylex.create({
  popover: {
    // 部品固有の最小幅(D1 ボード 3c)
    minWidth: "200px",
    padding: space.xs,
    backgroundColor: bg.raised,
    borderWidth: stroke.default,
    borderStyle: "solid",
    borderColor: border.default,
    borderRadius: radius.container,
    boxShadow: elevation.menu,
    zIndex: layer.dropdown,
    outline: "none",
  },
  menu: { outline: "none", fontFamily: font.family },
  item: {
    display: "flex",
    alignItems: "center",
    gap: space.inset,
    minHeight: size.control,
    paddingInline: space.inset,
    fontSize: font.body,
    color: text.default,
    borderRadius: radius.item,
    cursor: "pointer",
    outline: "none",
  },
  itemFocused: { backgroundColor: bg.hover },
  danger: { color: status.danger },
  current: { backgroundColor: accent.surface, color: accent.default, fontWeight: font.weightMedium },
  disabled: { opacity: 0.5, cursor: "not-allowed" },
  label: {
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  header: {
    paddingTop: space.sm,
    paddingBottom: space.xs,
    paddingInline: space.inset,
    fontSize: font.caption,
    fontWeight: font.weightMedium,
    color: text.muted,
  },
  separator: {
    height: stroke.default,
    marginBlock: space.xs,
    backgroundColor: border.default,
    borderWidth: 0,
  },
});

export interface MenuProps {
  /** RAC の Button / IconButton */
  trigger: ReactElement;
  label: string;
  onAction: (id: string) => void;
  children: ReactNode;
  placement?: "bottom start" | "bottom end" | "top start" | "top end";
}

export function Menu({ trigger, label, onAction, children, placement = "bottom start" }: MenuProps) {
  return (
    <MenuTrigger>
      {trigger}
      <Popover placement={placement} offset={4} className={stylex.props(styles.popover).className ?? ""}>
        <RacMenu
          aria-label={label}
          onAction={(key) => onAction(String(key))}
          className={stylex.props(styles.menu).className ?? ""}
        >
          {children}
        </RacMenu>
      </Popover>
    </MenuTrigger>
  );
}

export interface MenuItemProps {
  id: string;
  children: string;
  icon?: LucideIcon;
  tone?: "danger";
  isDisabled?: boolean;
  /** サイト切替の現在のサイト(地を accent.surface にし check を付ける) */
  isCurrent?: boolean;
}

export function MenuItem({ id, children, icon: Icon, tone, isDisabled, isCurrent }: MenuItemProps) {
  return (
    <RacMenuItem
      id={id}
      textValue={children}
      isDisabled={isDisabled ?? false}
      className={stylexRenderProps<MenuItemRenderProps>((state) => [
        styles.item,
        (state.isFocused || state.isHovered) && styles.itemFocused,
        tone === "danger" && styles.danger,
        isCurrent === true && styles.current,
        state.isDisabled && styles.disabled,
      ])}
    >
      {Icon !== undefined && <Icon size={ICON_SIZE.nav} aria-hidden="true" />}
      {/* 長いサイト名は省略記号で切る。全文は title で出す */}
      <span title={children} {...stylex.props(styles.label)}>
        {children}
      </span>
      {isCurrent === true && <Check size={ICON_SIZE.inline} aria-hidden="true" />}
    </RacMenuItem>
  );
}

export function MenuSection({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <RacMenuSection>
      {title !== undefined && <Header className={stylex.props(styles.header).className ?? ""}>{title}</Header>}
      {children}
    </RacMenuSection>
  );
}

export function MenuSeparator() {
  return <Separator className={stylex.props(styles.separator).className ?? ""} />;
}
```

- [ ] **Step 3: export してコミット**

```ts
export {
  Menu,
  MenuItem,
  MenuSection,
  MenuSeparator,
  type MenuItemProps,
  type MenuProps,
} from "./menu";
```

Run: `pnpm --filter @plyrs/ui exec vitest run src/menu.test.tsx`
Expected: PASS

```bash
git add packages/ui/src/menu.tsx packages/ui/src/menu.test.tsx packages/ui/src/index.ts
git commit -m "feat(ui): メニューを足す"
```

---

### Task 15: 検索欄

**Files:**
- Create: `packages/ui/src/search-field.tsx`、`packages/ui/src/search-field.test.tsx`
- Modify: `packages/ui/src/index.ts`

**Interfaces:**
- Consumes: Task 5 の `IconButton`
- Produces: `SearchField({ label, value, onChange, placeholder? })`(`label` は aria-label。一覧の検索欄は見えるラベルを持たない)

- [ ] **Step 1: 失敗するテストを書く**

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { expect, it } from "vitest";
import { SearchField } from "./search-field";

function Harness() {
  const [value, setValue] = useState("");
  return <SearchField label="お知らせを検索" placeholder="お知らせを検索" value={value} onChange={setValue} />;
}

it("入力中だけ消去ボタンを出し、押すか Esc で消す", async () => {
  const user = userEvent.setup();
  render(<Harness />);
  const box = screen.getByRole("searchbox", { name: "お知らせを検索" });
  expect(screen.queryByRole("button", { name: "検索語を消す" })).not.toBeInTheDocument();
  await user.type(box, "キャンペーン");
  await user.click(screen.getByRole("button", { name: "検索語を消す" }));
  expect(box).toHaveValue("");
  await user.type(box, "秋");
  await user.keyboard("{Escape}");
  expect(box).toHaveValue("");
});
```

Run: `pnpm --filter @plyrs/ui exec vitest run src/search-field.test.tsx`
Expected: FAIL

- [ ] **Step 2: search-field.tsx を書く**

```tsx
import * as stylex from "@stylexjs/stylex";
import { Search, X } from "lucide-react";
import { Input, SearchField as RacSearchField, type InputRenderProps } from "react-aria-components";
import { IconButton } from "./button";
import { stylexRenderProps } from "./compose";
import { ICON_SIZE } from "./icon";
import { bg, border, focus, font, radius, size, space, stroke, text } from "./semantic.stylex";

// D1 ボード 3b。入力欄と同じ寸法で、左に search、入力中は右に消去ボタン
const styles = stylex.create({
  root: { position: "relative", display: "flex", alignItems: "center", fontFamily: font.family },
  icon: {
    position: "absolute",
    insetInlineStart: space.inset,
    display: "inline-flex",
    color: text.muted,
    pointerEvents: "none",
  },
  input: {
    width: "100%",
    height: size.control,
    paddingInlineStart: `calc(${space.inset} + ${ICON_SIZE.inline}px + ${space.sm})`,
    paddingInlineEnd: `calc(${size.controlSm} + ${space.sm})`,
    fontFamily: font.family,
    fontSize: font.body,
    color: text.default,
    backgroundColor: bg.canvas,
    borderWidth: stroke.default,
    borderStyle: "solid",
    borderColor: border.default,
    borderRadius: radius.control,
    outline: "none",
    "::placeholder": { color: text.muted },
    // ブラウザ既定の消去ボタンを隠す(自前の消去ボタンと二重になる)
    "::-webkit-search-cancel-button": { display: "none" },
  },
  hovered: { borderColor: border.hover },
  focused: {
    outlineWidth: stroke.focus,
    outlineStyle: "solid",
    outlineColor: focus.ring,
    outlineOffset: stroke.focus,
  },
  clear: { position: "absolute", insetInlineEnd: space.xs, display: "inline-flex" },
});

export interface SearchFieldProps {
  /** aria-label(見えるラベルは置かない) */
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export function SearchField({ label, value, onChange, placeholder }: SearchFieldProps) {
  return (
    <RacSearchField
      aria-label={label}
      value={value}
      onChange={onChange}
      className={stylex.props(styles.root).className ?? ""}
    >
      {({ isEmpty }) => (
        <>
          <span {...stylex.props(styles.icon)}>
            <Search size={ICON_SIZE.inline} aria-hidden="true" />
          </span>
          <Input
            placeholder={placeholder}
            className={stylexRenderProps<InputRenderProps>((state) => [
              styles.input,
              state.isHovered && styles.hovered,
              state.isFocused && styles.focused,
            ])}
          />
          {!isEmpty && (
            <span {...stylex.props(styles.clear)}>
              {/* SearchField の ButtonContext が消去の動作を与える */}
              <IconButton icon={X} label="検索語を消す" size="sm" />
            </span>
          )}
        </>
      )}
    </RacSearchField>
  );
}
```

`"::-webkit-search-cancel-button"` が StyleX でコンパイルエラーになる場合は、その行を消し `apps/admin/src/styles.css` に `input[type="search"]::-webkit-search-cancel-button { display: none; }` を足す。

- [ ] **Step 3: export してコミット**

```ts
export { SearchField, type SearchFieldProps } from "./search-field";
```

Run: `pnpm --filter @plyrs/ui exec vitest run src/search-field.test.tsx`
Expected: PASS

```bash
git add packages/ui/src/search-field.tsx packages/ui/src/search-field.test.tsx packages/ui/src/index.ts
git commit -m "feat(ui): 検索欄を足す"
```

---

### Task 16: 表(選択・並べ替え付き)

**Files:**
- Create: `packages/ui/src/table.tsx`、`packages/ui/src/table.test.tsx`
- Modify: `packages/ui/src/index.ts`

**Interfaces:**
- Consumes: Task 6 の `CheckboxBox`
- Produces: `Table`(RAC の `TableProps` から `className` / `style` を除いたもの)、`TableHeader<T>`、`Column({ children: string, hideOnNarrow?, …ColumnProps })`、`TableBody<T>`、`Row<T>`、`Cell({ hideOnNarrow?, …CellProps })`。選択列は `selectionMode="multiple"` のとき見出しと各行に自動で入る。行アクション(ホバーで出す操作)は V3 で一覧と一緒に作る

- [ ] **Step 1: 失敗するテストを書く**

```tsx
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { Cell, Column, Row, Table, TableBody, TableHeader } from "./table";

const rows = [
  { id: "a", title: "年末年始のお知らせ", updated: "10 分前" },
  { id: "b", title: "秋のキャンペーン", updated: "昨日" },
];

it("選択列を自動で足し、並べ替えと選択を呼び出し側へ渡す", async () => {
  const user = userEvent.setup();
  const onSortChange = vi.fn();
  const onSelectionChange = vi.fn();
  render(
    <Table
      aria-label="お知らせ"
      selectionMode="multiple"
      sortDescriptor={{ column: "updated", direction: "descending" }}
      onSortChange={onSortChange}
      onSelectionChange={onSelectionChange}
    >
      <TableHeader>
        <Column id="title" isRowHeader allowsSorting>
          タイトル
        </Column>
        <Column id="updated" allowsSorting hideOnNarrow>
          更新
        </Column>
      </TableHeader>
      <TableBody items={rows}>
        {(row) => (
          <Row id={row.id}>
            <Cell>{row.title}</Cell>
            <Cell hideOnNarrow>{row.updated}</Cell>
          </Row>
        )}
      </TableBody>
    </Table>,
  );
  const table = screen.getByRole("grid", { name: "お知らせ" });
  // 見出しの全選択 + 各行
  expect(within(table).getAllByRole("checkbox")).toHaveLength(3);
  expect(screen.getByRole("columnheader", { name: /更新/ })).toHaveAttribute("aria-sort", "descending");
  await user.click(screen.getByRole("columnheader", { name: /タイトル/ }));
  expect(onSortChange).toHaveBeenCalledWith({ column: "title", direction: "ascending" });
  await user.click(within(screen.getByRole("row", { name: /秋のキャンペーン/ })).getByRole("checkbox"));
  expect(onSelectionChange).toHaveBeenCalled();
});

it("selectionMode が無ければ選択列を出さない", () => {
  render(
    <Table aria-label="メンバー">
      <TableHeader>
        <Column id="name" isRowHeader>
          名前
        </Column>
      </TableHeader>
      <TableBody items={[{ id: "u1", name: "管理者" }]}>
        {(row) => (
          <Row id={row.id}>
            <Cell>{row.name}</Cell>
          </Row>
        )}
      </TableBody>
    </Table>,
  );
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
});
```

RAC の表は `role="grid"` で描画される(`treegrid` ではない)。名前が合わない場合は `screen.getByRole("grid")` の実際の DOM を `screen.debug()` で見て合わせる。

Run: `pnpm --filter @plyrs/ui exec vitest run src/table.test.tsx`
Expected: FAIL

- [ ] **Step 2: table.tsx を書く**

```tsx
import * as stylex from "@stylexjs/stylex";
import { ChevronDown, ChevronsUpDown, ChevronUp } from "lucide-react";
import {
  Cell as RacCell,
  Checkbox as RacCheckbox,
  Collection,
  Column as RacColumn,
  Row as RacRow,
  Table as RacTable,
  TableBody as RacTableBody,
  TableHeader as RacTableHeader,
  useTableOptions,
  type CellProps,
  type CellRenderProps,
  type ColumnProps,
  type ColumnRenderProps,
  type RowProps,
  type RowRenderProps,
  type SortDirection,
  type TableBodyProps,
  type TableHeaderProps,
  type TableProps,
} from "react-aria-components";
import { CheckboxBox } from "./checkbox";
import { stylexRenderProps } from "./compose";
import { ICON_SIZE } from "./icon";
import { accent, bg, border, focus, font, size, space, stroke, text } from "./semantic.stylex";

// D1 ボード 3d / 案 D 5 章: 行 44px・見出し 40px、選択行は accent.surface、ホバーは bg.hover。
// 幅 960px 未満では hideOnNarrow の列を隠す(h-common-surface.md 10 章)
const NARROW = "@media (max-width: 959px)";

const styles = stylex.create({
  table: {
    width: "100%",
    borderCollapse: "collapse",
    fontFamily: font.family,
    fontSize: font.body,
    color: text.default,
  },
  column: {
    height: size.rowCompact,
    paddingInline: space.inset,
    textAlign: "start",
    fontSize: font.caption,
    fontWeight: font.weightMedium,
    color: text.muted,
    whiteSpace: "nowrap",
    borderBottomWidth: stroke.default,
    borderBottomStyle: "solid",
    borderBottomColor: border.default,
    outline: "none",
  },
  sortable: { cursor: "pointer" },
  sorted: { color: text.default },
  columnInner: { display: "inline-flex", alignItems: "center", gap: space.xs },
  sortIdle: { display: "inline-flex", opacity: 0.5 },
  sortActive: { display: "inline-flex" },
  // 部品固有の幅(D1 ボード 3d の先頭列)
  selection: { width: "32px", paddingInline: space.inset },
  row: { height: size.row, outline: "none" },
  rowHovered: { backgroundColor: bg.hover },
  rowSelected: { backgroundColor: accent.surface },
  cell: {
    paddingInline: space.inset,
    verticalAlign: "middle",
    borderBottomWidth: stroke.default,
    borderBottomStyle: "solid",
    borderBottomColor: border.default,
    outline: "none",
  },
  focusVisible: {
    outlineWidth: stroke.focus,
    outlineStyle: "solid",
    outlineColor: focus.ring,
    outlineOffset: `calc(-1 * ${stroke.focus})`,
  },
  hideOnNarrow: { display: { default: null, [NARROW]: "none" } },
  checkbox: { display: "inline-flex", cursor: "pointer" },
});

function SelectionCheckbox() {
  return (
    <RacCheckbox slot="selection" className={stylex.props(styles.checkbox).className ?? ""}>
      {(state) => <CheckboxBox {...state} />}
    </RacCheckbox>
  );
}

function SortIcon({ direction }: { direction: SortDirection | undefined }) {
  if (direction === undefined) {
    return (
      <span {...stylex.props(styles.sortIdle)}>
        <ChevronsUpDown size={ICON_SIZE.inline} aria-hidden="true" />
      </span>
    );
  }
  const Icon = direction === "ascending" ? ChevronUp : ChevronDown;
  return (
    <span {...stylex.props(styles.sortActive)}>
      <Icon size={ICON_SIZE.inline} aria-hidden="true" />
    </span>
  );
}

export function Table(props: Omit<TableProps, "className" | "style">) {
  return <RacTable {...props} className={stylex.props(styles.table).className ?? ""} />;
}

export function TableHeader<T extends object>({
  columns,
  children,
}: Omit<TableHeaderProps<T>, "className" | "style">) {
  const { selectionBehavior, selectionMode } = useTableOptions();
  return (
    <RacTableHeader>
      {selectionMode !== "none" && selectionBehavior === "toggle" && (
        <RacColumn className={stylex.props(styles.column, styles.selection).className ?? ""}>
          {selectionMode === "multiple" && <SelectionCheckbox />}
        </RacColumn>
      )}
      <Collection items={columns}>{children}</Collection>
    </RacTableHeader>
  );
}

export interface TableColumnProps extends Omit<ColumnProps, "className" | "style" | "children"> {
  children: string;
  hideOnNarrow?: boolean;
}

export function Column({ children, hideOnNarrow, ...props }: TableColumnProps) {
  return (
    <RacColumn
      {...props}
      className={stylexRenderProps<ColumnRenderProps>((state) => [
        styles.column,
        state.allowsSorting && styles.sortable,
        state.sortDirection !== undefined && styles.sorted,
        state.isFocusVisible && styles.focusVisible,
        hideOnNarrow === true && styles.hideOnNarrow,
      ])}
    >
      {({ allowsSorting, sortDirection }) => (
        <span {...stylex.props(styles.columnInner)}>
          {children}
          {allowsSorting && <SortIcon direction={sortDirection} />}
        </span>
      )}
    </RacColumn>
  );
}

export function TableBody<T extends object>(props: Omit<TableBodyProps<T>, "className" | "style">) {
  return <RacTableBody {...props} />;
}

export function Row<T extends object>({
  id,
  columns,
  children,
  ...props
}: Omit<RowProps<T>, "className" | "style">) {
  const { selectionBehavior, selectionMode } = useTableOptions();
  return (
    <RacRow
      id={id}
      {...props}
      className={stylexRenderProps<RowRenderProps>((state) => [
        styles.row,
        state.isHovered && styles.rowHovered,
        state.isSelected && styles.rowSelected,
        state.isFocusVisible && styles.focusVisible,
      ])}
    >
      {selectionMode !== "none" && selectionBehavior === "toggle" && (
        <RacCell className={stylex.props(styles.cell, styles.selection).className ?? ""}>
          <SelectionCheckbox />
        </RacCell>
      )}
      <Collection items={columns}>{children}</Collection>
    </RacRow>
  );
}

export interface TableCellProps extends Omit<CellProps, "className" | "style"> {
  hideOnNarrow?: boolean;
}

export function Cell({ hideOnNarrow, ...props }: TableCellProps) {
  return (
    <RacCell
      {...props}
      className={stylexRenderProps<CellRenderProps>((state) => [
        styles.cell,
        state.isFocusVisible && styles.focusVisible,
        hideOnNarrow === true && styles.hideOnNarrow,
      ])}
    />
  );
}
```

`{ default: null, [NARROW]: "none" }` が型エラーになる場合は `display: { default: "table-cell", [NARROW]: "none" }` にする。`useTableOptions()` が返す `selectionMode` の型に `"none"` が無ければ、比較を `selectionMode === "single" || selectionMode === "multiple"` にする。

- [ ] **Step 3: export してコミット**

```ts
export {
  Cell,
  Column,
  Row,
  Table,
  TableBody,
  TableHeader,
  type TableCellProps,
  type TableColumnProps,
} from "./table";
```

Run: `pnpm --filter @plyrs/ui exec vitest run src/table.test.tsx`
Expected: PASS

```bash
git add packages/ui/src/table.tsx packages/ui/src/table.test.tsx packages/ui/src/index.ts
git commit -m "feat(ui): 選択と並べ替え付きの表を足す"
```

---

### Task 17: ドロップ領域とファイル選択

**Files:**
- Create: `packages/ui/src/drop-zone.tsx`、`packages/ui/src/drop-zone.test.tsx`
- Modify: `packages/ui/src/index.ts`

**Interfaces:**
- Consumes: Task 5 の `Button`
- Produces: `DropZone({ onFiles, acceptedFileTypes?, allowsMultiple?, title?, description?, buttonLabel?, isDisabled? })`。上限の文言(20 MB、案 F)は呼び出し側が `description` で渡す

- [ ] **Step 1: 失敗するテストを書く**

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { DropZone } from "./drop-zone";

it("ファイルを選ぶと onFiles に File の配列を渡す", async () => {
  const onFiles = vi.fn();
  const { container } = render(
    <DropZone onFiles={onFiles} description="画像・PDF・動画、1 ファイル 20 MB まで" />,
  );
  expect(screen.getByText("ここにファイルをドロップ")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "ファイルを選択" })).toBeInTheDocument();
  const input = container.ownerDocument.querySelector<HTMLInputElement>("input[type='file']");
  expect(input).not.toBeNull();
  const file = new File(["x"], "cover.png", { type: "image/png" });
  await userEvent.upload(input as HTMLInputElement, file);
  expect(onFiles).toHaveBeenCalledWith([file]);
});
```

Run: `pnpm --filter @plyrs/ui exec vitest run src/drop-zone.test.tsx`
Expected: FAIL

- [ ] **Step 2: drop-zone.tsx を書く**

```tsx
import * as stylex from "@stylexjs/stylex";
import { Upload } from "lucide-react";
import {
  DropZone as RacDropZone,
  FileTrigger,
  Text,
  type DropZoneRenderProps,
} from "react-aria-components";
import { Button } from "./button";
import { stylexRenderProps } from "./compose";
import { ICON_SIZE, ICON_STROKE } from "./icon";
import { accent, border, focus, font, radius, space, stroke, text } from "./semantic.stylex";

// D1 ボード 3e。キーボードでは「ファイルを選択」にフォーカスが移り、Enter で選択が開く
const styles = stylex.create({
  zone: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: space.sm,
    paddingBlock: space.xl,
    paddingInline: space.lg,
    fontFamily: font.family,
    fontSize: font.caption,
    color: text.muted,
    textAlign: "center",
    borderWidth: stroke.focus,
    borderStyle: "dashed",
    borderColor: border.hover,
    borderRadius: radius.container,
    outline: "none",
  },
  dropTarget: { borderColor: accent.default, backgroundColor: accent.surface, color: accent.default },
  focusVisible: {
    outlineWidth: stroke.focus,
    outlineStyle: "solid",
    outlineColor: focus.ring,
    outlineOffset: stroke.focus,
  },
  disabled: { opacity: 0.5 },
  title: { fontSize: font.body, fontWeight: font.weightMedium, color: text.default },
  titleDropTarget: { color: accent.default },
});

export interface DropZoneProps {
  onFiles: (files: File[]) => void;
  /** MIME type(例: image/png) */
  acceptedFileTypes?: string[];
  allowsMultiple?: boolean;
  title?: string;
  /** 受け付ける種類と上限(例: 画像・PDF・動画、1 ファイル 20 MB まで) */
  description?: string;
  buttonLabel?: string;
  isDisabled?: boolean;
}

export function DropZone({
  onFiles,
  acceptedFileTypes,
  allowsMultiple = true,
  title = "ここにファイルをドロップ",
  description,
  buttonLabel = "ファイルを選択",
  isDisabled,
}: DropZoneProps) {
  return (
    <RacDropZone
      isDisabled={isDisabled ?? false}
      getDropOperation={(types) =>
        acceptedFileTypes === undefined || acceptedFileTypes.some((type) => types.has(type))
          ? "copy"
          : "cancel"
      }
      onDrop={async (event) => {
        const files: File[] = [];
        for (const item of event.items) {
          if (item.kind === "file") files.push(await item.getFile());
        }
        if (files.length > 0) onFiles(allowsMultiple ? files : files.slice(0, 1));
      }}
      className={stylexRenderProps<DropZoneRenderProps>((state) => [
        styles.zone,
        state.isDropTarget && styles.dropTarget,
        state.isFocusVisible && styles.focusVisible,
        state.isDisabled && styles.disabled,
      ])}
    >
      {({ isDropTarget }) => (
        <>
          <Upload size={ICON_SIZE.empty} strokeWidth={ICON_STROKE.large} aria-hidden="true" />
          <Text slot="label" {...stylex.props(styles.title, isDropTarget && styles.titleDropTarget)}>
            {isDropTarget ? "ここに置くとアップロードします" : title}
          </Text>
          {description !== undefined && <span>{description}</span>}
          <FileTrigger
            {...(acceptedFileTypes === undefined ? {} : { acceptedFileTypes })}
            allowsMultiple={allowsMultiple}
            onSelect={(list) => {
              if (list !== null && list.length > 0) onFiles(Array.from(list));
            }}
          >
            <Button variant="secondary" isDisabled={isDisabled ?? false}>
              {buttonLabel}
            </Button>
          </FileTrigger>
        </>
      )}
    </RacDropZone>
  );
}
```

`Text` に `{...stylex.props()}` が型で合わなければ `className={stylex.props(...).className ?? ""}` にする。

- [ ] **Step 3: export してコミット**

```ts
export { DropZone, type DropZoneProps } from "./drop-zone";
```

Run: `pnpm --filter @plyrs/ui exec vitest run src/drop-zone.test.tsx`
Expected: PASS

```bash
git add packages/ui/src/drop-zone.tsx packages/ui/src/drop-zone.test.tsx packages/ui/src/index.ts
git commit -m "feat(ui): ドロップ領域とファイル選択を足す"
```

---

### Task 18: PageHeader

**Files:**
- Create: `packages/ui/src/page-header.tsx`、`packages/ui/src/page-header.test.tsx`
- Modify: `packages/ui/src/index.ts`

**Interfaces:**
- Consumes: Task 13 の `Breadcrumbs` / `BreadcrumbItem`
- Produces: `PageHeader({ title, breadcrumbs?, primaryAction?, secondaryActions?, banner? })`。V2 以降のすべての画面が使う。`banner` は切断時の接続バナー(V2 でシェルが渡す)の差し込み口で、ヘッダーと本文の間に置く

- [ ] **Step 1: 失敗するテストを書く**

```tsx
import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { Banner } from "./banner";
import { Button } from "./button";
import { PageHeader } from "./page-header";

it("h1 を 1 つだけ置き、補助操作 → 主操作の順に右端へ並べ、バナーはヘッダーの後ろに置く", () => {
  render(
    <PageHeader
      title="お知らせ"
      breadcrumbs={[
        { id: "home", label: "ホーム", href: "/t/acme" },
        { id: "news", label: "お知らせ" },
      ]}
      secondaryActions={<Button variant="secondary">インポート</Button>}
      primaryAction={<Button>お知らせを追加</Button>}
      banner={<Banner tone="warning">サーバーとの接続が切れています。</Banner>}
    />,
  );
  expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("お知らせ");
  const secondary = screen.getByRole("button", { name: "インポート" });
  const primary = screen.getByRole("button", { name: "お知らせを追加" });
  expect(secondary.compareDocumentPosition(primary) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  const header = screen.getByRole("banner");
  const banner = screen.getByRole("status");
  expect(header.contains(banner)).toBe(false);
  expect(header.compareDocumentPosition(banner) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

it("パンくずと操作は省ける", () => {
  render(<PageHeader title="ホーム" />);
  expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});
```

`<header>` は `<main>` などの区分要素の外にあるときだけ `banner` のロールを持つ。テストでは最上位に描画するため `getByRole("banner")` で取れる。

Run: `pnpm --filter @plyrs/ui exec vitest run src/page-header.test.tsx`
Expected: FAIL

- [ ] **Step 2: page-header.tsx を書く**

```tsx
import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import { type BreadcrumbItem, Breadcrumbs } from "./breadcrumbs";
import { border, font, size, space, stroke, text } from "./semantic.stylex";

// h-common-surface.md 2 章 / D1 ボード 4: パンくず → 見出し行(h1 + 補助操作 + 主操作)。
// 切断時の接続バナーはヘッダーと本文の間に挟む。編集画面の主操作は公開ボックスに置く(案 C)ため、
// primaryAction を渡さない
const styles = stylex.create({
  header: {
    display: "flex",
    flexDirection: "column",
    gap: space.sm,
    paddingTop: space.lg,
    paddingBottom: space.md,
    paddingInline: space.pageGutter,
    fontFamily: font.family,
    borderBottomWidth: stroke.default,
    borderBottomStyle: "solid",
    borderBottomColor: border.default,
  },
  titleRow: { display: "flex", alignItems: "center", gap: space.md, minWidth: 0 },
  title: {
    flex: 1,
    minWidth: 0,
    // ボタンの高さに揃える
    minHeight: size.control,
    display: "flex",
    alignItems: "center",
    margin: 0,
    fontSize: font.pageTitle,
    fontWeight: font.weightBold,
    lineHeight: font.lineHeightTight,
    color: text.default,
  },
  titleText: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  actions: { display: "flex", alignItems: "center", gap: space.sm, flexShrink: 0 },
});

export interface PageHeaderProps {
  title: string;
  breadcrumbs?: BreadcrumbItem[];
  /** 塗りのボタン 1 つ(新規追加・保存など) */
  primaryAction?: ReactNode;
  /** 枠線のボタン。主操作の左に置く */
  secondaryActions?: ReactNode;
  /** 切断時の接続バナー(V2 でシェルが渡す) */
  banner?: ReactNode;
}

export function PageHeader({
  title,
  breadcrumbs,
  primaryAction,
  secondaryActions,
  banner,
}: PageHeaderProps) {
  const hasActions = primaryAction !== undefined || secondaryActions !== undefined;
  return (
    <>
      <header {...stylex.props(styles.header)}>
        {breadcrumbs !== undefined && breadcrumbs.length > 0 && <Breadcrumbs items={breadcrumbs} />}
        <div {...stylex.props(styles.titleRow)}>
          <h1 {...stylex.props(styles.title)}>
            <span title={title} {...stylex.props(styles.titleText)}>
              {title}
            </span>
          </h1>
          {hasActions && (
            <div {...stylex.props(styles.actions)}>
              {secondaryActions}
              {primaryAction}
            </div>
          )}
        </div>
      </header>
      {banner}
    </>
  );
}
```

- [ ] **Step 3: export してコミット**

```ts
export { PageHeader, type PageHeaderProps } from "./page-header";
```

Run: `pnpm --filter @plyrs/ui exec vitest run src/page-header.test.tsx`
Expected: PASS

```bash
git add packages/ui/src/page-header.tsx packages/ui/src/page-header.test.tsx packages/ui/src/index.ts
git commit -m "feat(ui): ページの骨格の PageHeader を足す"
```

---

### Task 19: 全体の検証と既存画面の確認

**Files:**
- 変更なし(問題が見つかったときだけ該当ファイルを直す)

- [ ] **Step 1: 静的検査とテスト**

Run: `pnpm lint && pnpm format:check && pnpm typecheck && pnpm test`
Expected: すべて成功。`format:check` で落ちたら `pnpm format` をかけてから該当タスクの修正として扱う

- [ ] **Step 2: ビルドの出力を確かめる**

Run: `pnpm --filter @plyrs/admin build`
Expected: 成功

Run: `grep -rl "lightningcss-light" apps/admin/dist || echo none`
Expected: `none`

Run: `grep -l "plyrs.theme" $(find apps/admin/dist -name "_shell*.html")`
Expected: prerender された `_shell` の HTML が 1 件見つかる(起動時スクリプトが `<head>` に入っている)

Run: `grep -o "light-dark(var(--[a-z0-9]*), var(--[a-z0-9]*))" -r apps/admin/dist --include=*.css | head -3`
Expected: 1 件以上(セマンティックトークンが `light-dark()` のまま出ている)

- [ ] **Step 3: E2E**

Run: `pnpm --filter @plyrs/e2e test`
Expected: 3 spec がすべて PASS(`.wrangler` のローカルデータは消える)

- [ ] **Step 4: 既存画面の見た目を確かめる(ロードマップ 5 章の注記)**

`pnpm --filter @plyrs/admin dev` で起動し(`run` スキルを使ってよい)、ログイン → サイト選択 → コンテンツ一覧 → 編集 → メディア → 設定 を、OS の配色をライト / ダークにしてそれぞれ開く。確かめること:

- 旧名の別名のおかげで、画面の配色・余白・文字の大きさが V1 前と同じ(部品の角丸・高さ・フォーカスは D1 の見た目に変わってよい)
- ダークで背景・文字が反転し、`light-dark()` が働いている(styles.css の `color-scheme` が効いている)
- DevTools のコンソールで `localStorage.setItem("plyrs.theme", "light")` → 再読み込みで、OS がダークでもライトで描画され、一瞬ダークになることがない

食い違いがあればスクリーンショットを添えて報告する(直すのは V2 以降の画面の置き換えで扱うか、ここで直すかをユーザーに確認する)。

- [ ] **Step 5: ブランチの仕上げ**

superpowers:finishing-a-development-branch に従い、ローカルの main へマージする(これまでの開発フロー)。push はユーザーに確認してから。

- [ ] **Step 6: キャンバスへの同期(依頼書 docs/admin-ux/design-briefs/README.md 2 章の D0 に相当)**

マージ後、`/design-sync` で `packages/ui` の部品と `semantic.stylex.ts` / `primitives.stylex.ts` を、キャンバス https://claude.ai/artifact/K57TVUfpefMuiPxhZXyAnU のデザインシステムへ同期する。同期は 1 部品ずつの差分で行われる。そのあと D1 のボード(3a〜3f、4)と見た目を突き合わせ、次を報告する:

- 尺度に寄せた値(Global Constraints)や設計書を優先した箇所(トーストの地、メニューのアイコン 20px など)で、キャンバスとの差が残るところ
- それ以外に食い違いがあれば、設計書を優先したうえで一覧にする(設計書を直すか、キャンバスを直すかはユーザーが決める)
