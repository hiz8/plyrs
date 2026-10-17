# デザイントークン 設計

[案 H: 共通の表層](./h-common-surface.md) 9 章の詳細。管理画面と `packages/ui` の見た目の値を、3 層のトークンで管理する(2026-10-17 決定)。

```
プリミティブトークン  <  セマンティックトークン  <  テーマ
(値そのもの)          (用途の名前)              (ライト / ダーク)
```

- **プリミティブトークン**: 色・余白・文字サイズなどの値そのもの。用途を持たない名前を付ける(例: `gray900`、`space4`)。使用・未使用にかかわらず、尺度として一通り定義する
- **セマンティックトークン**: 用途の名前(例: `text.default`、`border.default`)。値は必ずプリミティブトークンを参照し、値を直接書かない
- **テーマ**: セマンティックトークンに、どのプリミティブトークンを割り当てるかの組。ライトとダークを用意する
- 部品と画面が使うのはセマンティックトークンだけとし、プリミティブトークンを直接参照しない

## 1. 現状

`packages/ui/src/tokens.stylex.ts` に 3 組の `defineVars` があり、値を直接書いている。

- `colors`: 9 色。ダーク用の値は各トークンの中に `@media (prefers-color-scheme: dark)` で書いている
- `spacing`: `xs` 4px / `sm` 8px / `md` 16px / `lg` 24px / `xl` 32px
- `typography`: フォントファミリーと、`sizeSm` 12px / `sizeMd` 14px / `sizeLg` 16px / `sizeXl` 20px

角丸(4px / 8px)や罫線の太さ(1px)は、各部品の `stylex.create` に直接書かれている。

## 2. プリミティブトークン

### 2.1 色

現在使っている 15 色をすべて尺度の中に位置づけ、不足する段と色相(成功・警告用の緑と黄)を足す。現在の値は Tailwind CSS の既定の色と一致するものが多いため、尺度の段の値もそれに合わせる。

| 色相    | 段                                                             | 現在の使用箇所(現在のトークン)                                                                                                                                                                                                                                     |
| ------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `white` | —                                                              | `#ffffff`(ライトの `bg`)                                                                                                                                                                                                                                           |
| `gray`  | 50 / 100 / 200 / 300 / 400 / 500 / 600 / 700 / 800 / 900 / 950 | `#f6f7f8`(ライトの `surface`)、`#d8dde3`(ライトの `border`)、`#5f6b76`(ライトの `textMuted`)、`#1a1f24`(ライトの `text` とダークの `surface`)、`#111418`(ダークの `bg`)、`#333a42`(ダークの `border`)、`#e8eaed`(ダークの `text`)、`#9aa5af`(ダークの `textMuted`) |
| `blue`  | 50〜950                                                        | `#2563eb` = blue600(ライトの `accent` と `focusRing`)、`#60a5fa` = blue400(ダークの `accent` と `focusRing`)、`#0b1220`(ダークの `accentText`)                                                                                                                     |
| `red`   | 50〜950                                                        | `#dc2626` = red600(ライトの `danger`)、`#f87171` = red400(ダークの `danger`)                                                                                                                                                                                       |
| `green` | 50〜950                                                        | (未使用。成功の表示に使う)                                                                                                                                                                                                                                         |
| `amber` | 50〜950                                                        | (未使用。警告の表示に使う)                                                                                                                                                                                                                                         |

- `gray` は現在の値が独自の灰色のため、現在の 8 色を次のとおり段に割り当て、残りの段(300 / 500 / 800)は前後の段の中点で補間した(D1 で確定)

  | 段      | 値        | 備考                                 |
  | ------- | --------- | ------------------------------------ |
  | gray50  | `#f6f7f8` |                                      |
  | gray100 | `#e8eaed` |                                      |
  | gray200 | `#d8dde3` |                                      |
  | gray300 | `#b9c1c9` | 補間。入力欄・枠線ボタンのホバー枠線 |
  | gray400 | `#9aa5af` |                                      |
  | gray500 | `#7c8892` | 補間。無効状態の文字(白地で 3.6:1)   |
  | gray600 | `#5f6b76` |                                      |
  | gray700 | `#333a42` |                                      |
  | gray800 | `#272d33` | 補間。ダークの浮いた面               |
  | gray900 | `#1a1f24` |                                      |
  | gray950 | `#111418` |                                      |

- `#0b1220`(ダークの `accentText`)は廃止する(D1 で確定)。blue の尺度に段は足さず、ダークの主ボタンの文字は `gray950` にする。ライトで主ボタンの文字が `bg.canvas` と同じ white であるのと対称になり、blue400 の上で 7.3:1 を保つ
- 透明度付きの色は `black` / `white` に透明度を付けたプリミティブとして持つ。どの面の上でも同じ見え方になるため、ホバー・押下・スケルトンもこれを使う

  | トークン       | 値                      | 用途                       |
  | -------------- | ----------------------- | -------------------------- |
  | `blackAlpha5`  | `rgba(0,0,0,.05)`       | ライトのホバー             |
  | `blackAlpha10` | `rgba(0,0,0,.10)`       | ライトの押下               |
  | `blackAlpha50` | `rgba(0,0,0,.50)`       | ライトの暗幕               |
  | `blackAlpha70` | `rgba(0,0,0,.70)`       | ダークの暗幕               |
  | `whiteAlpha8`  | `rgba(255,255,255,.08)` | ダークのホバー・スケルトン |
  | `whiteAlpha12` | `rgba(255,255,255,.12)` | ダークの押下               |

- 画面の地の明るさは white / gray950 で確定(D1)。gray50 / gray900 にする案も 4 面で比較したが見送った

### 2.2 余白

4px を基本単位とした尺度にする。現在の 5 段(4 / 8 / 16 / 24 / 32px)はすべて含まれる。

| トークン | 値   |
| -------- | ---- |
| `space0` | 0    |
| `space1` | 2px  |
| `space2` | 4px  |
| `space3` | 8px  |
| `space4` | 12px |
| `space5` | 16px |
| `space6` | 24px |
| `space7` | 32px |
| `space8` | 48px |
| `space9` | 64px |

### 2.3 文字

| 種類               | トークン                                                                                                        |
| ------------------ | --------------------------------------------------------------------------------------------------------------- |
| フォントファミリー | `fontSans`(現在の値)、`fontMono`(API 名やコードの表示用)                                                        |
| 文字サイズ         | `fontSize1` 12px / `fontSize2` 14px / `fontSize3` 16px / `fontSize4` 20px / `fontSize5` 24px / `fontSize6` 32px |
| 太さ               | `fontWeightRegular` 400 / `fontWeightMedium` 500 / `fontWeightBold` 600                                         |
| 行の高さ           | `lineHeightTight` 1.25 / `lineHeightNormal` 1.5 / `lineHeightRelaxed` 1.75                                      |

現在の 4 段(12 / 14 / 16 / 20px)はすべて含まれる。24px と 32px はページ見出し用に足す。

### 2.4 その他

| 種類       | トークン                                                                                                          |
| ---------- | ----------------------------------------------------------------------------------------------------------------- |
| 角丸       | `radius0` 0 / `radius1` 4px / `radius2` 8px / `radius3` 12px / `radiusFull` 9999px                                |
| 罫線の太さ | `borderWidth1` 1px / `borderWidth2` 2px                                                                           |
| 影         | `shadow1` / `shadow2`(ライトのメニュー / モーダル)、`shadow3` / `shadow4`(ダークのメニュー / モーダル。D1 で追加) |
| 時間       | `duration1` 100ms / `duration2` 200ms(開閉のアニメーション)                                                       |
| 重なり順   | `zIndexDropdown` 100 / `zIndexModal` 200 / `zIndexToast` 300                                                      |

影の値(D1 で確定)。ライトの薄い影は黒地では見えないため、ダーク用に濃い 2 段を足した。

| トークン  | 値                                                       |
| --------- | -------------------------------------------------------- |
| `shadow1` | `0 1px 2px rgba(0,0,0,.06), 0 4px 12px rgba(0,0,0,.10)`  |
| `shadow2` | `0 4px 8px rgba(0,0,0,.08), 0 16px 40px rgba(0,0,0,.18)` |
| `shadow3` | `0 1px 2px rgba(0,0,0,.4), 0 4px 12px rgba(0,0,0,.5)`    |
| `shadow4` | `0 4px 8px rgba(0,0,0,.5), 0 16px 40px rgba(0,0,0,.7)`   |

## 3. セマンティックトークン

用途で名前を付け、値はプリミティブトークンを参照する。下の表の「ライト」「ダーク」の列は 4 章のテーマでの割り当て。

### 3.1 色

| トークン                | 用途                                                             | ライト       | ダーク       | 現在のトークン |
| ----------------------- | ---------------------------------------------------------------- | ------------ | ------------ | -------------- |
| `bg.canvas`             | 画面の地                                                         | white        | gray950      | `bg`           |
| `bg.surface`            | サイドバー・カード                                               | gray50       | gray900      | `surface`      |
| `bg.raised`             | モーダル・メニュー・トースト(常に `border.default` の枠線を伴う) | white        | gray800      | (新規)         |
| `bg.overlay`            | モーダルの暗幕                                                   | blackAlpha50 | blackAlpha70 | (新規)         |
| `bg.hover`              | 行・メニュー項目・枠線ボタンのホバー                             | blackAlpha5  | whiteAlpha8  | (新規、D1)     |
| `bg.pressed`            | 行・メニュー項目・枠線ボタンの押下                               | blackAlpha10 | whiteAlpha12 | (新規、D1)     |
| `bg.skeleton`           | スケルトン                                                       | gray100      | whiteAlpha8  | (新規、D1)     |
| `bg.inverse`            | ツールチップの地                                                 | gray900      | gray100      | (新規、D1)     |
| `text.inverse`          | ツールチップの文字                                               | gray50       | gray900      | (新規、D1)     |
| `border.default`        | 罫線                                                             | gray200      | gray700      | `border`       |
| `border.hover`          | 入力欄・枠線ボタンのホバー                                       | gray300      | gray600      | (新規、D1)     |
| `text.default`          | 本文                                                             | gray900      | gray100      | `text`         |
| `text.muted`            | 補足                                                             | gray600      | gray400      | `textMuted`    |
| `text.onAccent`         | 主ボタン・危険ボタンの文字                                       | white        | gray950      | `accentText`   |
| `accent.default`        | 主ボタン・リンク                                                 | blue600      | blue400      | `accent`       |
| `accent.hover`          | 主ボタンのホバー                                                 | blue700      | blue300      | (新規)         |
| `accent.active`         | 主ボタンの押下                                                   | blue800      | blue200      | (新規、D1)     |
| `accent.surface`        | 選択行・サイドバーの現在地・「レビュー中」バッジの地             | blue50       | blue950      | (新規、D1)     |
| `focus.ring`            | フォーカスの枠(2px、2px 外側)                                    | blue600      | blue400      | `focusRing`    |
| `status.danger`         | エラー・危険な操作                                               | red600       | red400       | `danger`       |
| `status.dangerHover`    | 危険ボタンのホバー・押下                                         | red700       | red300       | (新規、D1)     |
| `status.dangerSurface`  | エラーのバナー・トースト・バッジの地                             | red50        | red950       | (新規)         |
| `status.success`        | 公開中など                                                       | green700     | green400     | (新規)         |
| `status.successSurface` | 成功のトースト・バッジの地                                       | green50      | green950     | (新規)         |
| `status.warning`        | 未反映の変更あり・切断                                           | amber700     | amber400     | (新規)         |
| `status.warningSurface` | 警告のバナー・バッジの地                                         | amber50      | amber950     | (新規)         |

ライト / ダークの列は D1 で確定した値(2026-10-17)。ダークの割り当ては、現在の値(ダークの `bg` = `#111418` など)を 2.1 で割り当てた段で置き換えたもの。`status.success` / `status.warning` のライトは当初案の 600 だと白地で 3.3:1 / 3.2:1 にしかならないため 700 にした。すべての組み合わせで本文 4.5:1 以上、部品の境界 3:1 以上を確認済み(キャンバスの「2. セマンティックトークン」ボードに比率を併記)。

### 3.2 余白・文字・その他

余白と文字はテーマで変えないため、テーマを通さずプリミティブを参照する。例外は `elevation.*` で、ダークでは濃い影に切り替える(D1 で確定)。

| トークン                               | 参照先                                       | 現在のトークン                                                             |
| -------------------------------------- | -------------------------------------------- | -------------------------------------------------------------------------- |
| `space.xs` / `sm` / `md` / `lg` / `xl` | space2 / space3 / space5 / space6 / space7   | `spacing.xs`〜`xl`(値は同じ)                                               |
| `space.pageGutter`                     | space6                                       | (新規。本文の左右の余白)                                                   |
| `size.control`                         | space7 + space2 = 36px                       | (新規、D1。ボタン・入力欄・セレクト・検索欄・メニュー項目・サイドバー項目) |
| `size.controlSm`                       | space6 + space2 = 28px                       | (新規、D1。表の行内のボタン、ツールバーのボタン)                           |
| `size.row`                             | space7 + space4 = 44px                       | (新規、D1。表の行。最小タップ領域)                                         |
| `font.body`                            | fontSize2                                    | `typography.sizeMd`                                                        |
| `font.caption`                         | fontSize1                                    | `typography.sizeSm`                                                        |
| `font.label`                           | fontSize3                                    | `typography.sizeLg`                                                        |
| `font.sectionTitle`                    | fontSize4                                    | `typography.sizeXl`                                                        |
| `font.pageTitle`                       | fontSize5                                    | (新規。ページ見出し)                                                       |
| `radius.control`                       | radius1                                      | (部品に直書きの 4px)                                                       |
| `radius.container`                     | radius2                                      | (部品に直書きの 8px)                                                       |
| `elevation.menu` / `elevation.modal`   | shadow1 / shadow2(ダーク: shadow3 / shadow4) | (新規)                                                                     |

## 4. テーマ

- テーマはライトとダークの 2 つ。セマンティックトークンの色(3.1)だけを切り替える
- ライトとダークの値の対を、セマンティックトークンの定義そのものに持たせる。値は `light-dark(ライトのプリミティブ, ダークのプリミティブ)` で書き、どちらを使うかはルートの要素の `color-scheme` で切り替える(`light dark` = 自動、`light`、`dark`)。割り当てが 1 か所に収まり、「自動」が CSS だけで成り立ち、フォーム部品やスクロールバーなどブラウザ既定の UI の配色も一緒に切り替わる
- `createTheme` は、テナントごとのアクセント色など、割り当ての組を差し替える用途に限る(ライトとダークの切り替えには使わない)
- 切り替えは「自動(OS の設定に従う)/ ライト / ダーク」の 3 択とし、既定は「自動」にする。現在の挙動(`prefers-color-scheme` への追従)は「自動」として引き継ぐ。選択はブラウザに記憶し、アカウント設定([案 G](./g-settings-account.md) 6.2)に切り替えの項目を置く。JS の実行前に記憶した選択と違う配色で一瞬描画されないよう、`/_shell` の `<head>` に小さなインラインスクリプトを置き、記憶した選択を `document.documentElement.style.colorScheme` に書く
- 将来、テナントごとのアクセント色(現在の `tokens.stylex.ts` のコメントで予告済み)を入れる場合は、`createTheme` で `accent.*` だけを上書きする。値は同じく `light-dark()` で書く

## 5. StyleX での実装

- プリミティブとセマンティックは `.stylex.ts` ファイルの `defineVars` として定義する(例: `primitives.stylex.ts`、`semantic.stylex.ts`)。テーマ(割り当ての組の差し替え)は `createTheme` で作る。現在のコメントにあるとおり、`defineVars` は `.stylex.ts` ファイルの名前付き export でなければならず、消費側は index.ts を経由せず直接 import する
- セマンティックトークンの値にプリミティブトークンの変数や `light-dark()` を書くこと、`createTheme` の値に別の変数を書くことは、どれもできる(5.1)。生成スクリプトによる値の展開は使わない
- StyleX のプラグインが CSS の後処理に使う lightningcss は、対象ブラウザによっては `light-dark()` を `--lightningcss-light` などを使う代替表現に書き換える。この代替表現は同じ処理の中に `color-scheme` の宣言が無いと働かず、ダークの色が壊れる。`apps/admin/vite.config.ts` の `stylex.vite()` に `lightningcssOptions: { exclude: Features.LightDark }` を指定する(V1 で `light-dark()` を使い始めるときに入れる。`light-dark()` は 2024 年に主要ブラウザが対応済み)
- 現在の `colors` / `spacing` / `typography` を使っている部品は、セマンティックトークンへ置き換える。置き換えが終わるまでは、現在の名前をセマンティックトークンの別名として残し、段階的に移行する
- 部品に直書きされている値(角丸の 4px / 8px、罫線の 1px など)も、置き換えの対象とする

### 5.1 変数の参照の検証結果(2026-10-17、ロードマップ T1)

`@stylexjs/stylex` / `@stylexjs/unplugin` 0.19.1 で確認した。検証に使った最小のトークン構成を `apps/admin/src/test-utils/stylex-tokens/` に残し、`apps/admin/src/stylex-tokens.test.ts` がそれを Vite でビルドして出力の CSS を確かめる。StyleX の版を上げたときは、このテストが通ることで同じ書き方が使えると判断できる。

フィクスチャのソース(抜粋):

```ts
// primitives.stylex.ts
export const primitives = stylex.defineVars({ white: "#ffffff", gray950: "#0b1220" });
// semantic.stylex.ts
export const semantic = stylex.defineVars({
  bgCanvas: `light-dark(${primitives.white}, ${primitives.gray950})`,
  textPrimary: primitives.gray950,
});
// accent-theme.stylex.ts
export const accentTheme = stylex.createTheme(semantic, {
  bgCanvas: `light-dark(${primitives.gray950}, ${primitives.white})`,
  textPrimary: primitives.white,
});
```

| 確認したこと                                                                   | 結果 | ビルド出力                                                       |
| ------------------------------------------------------------------------------ | ---- | ---------------------------------------------------------------- |
| `defineVars` の値に別ファイルの `defineVars` の変数を書く                      | 可   | `:root, .x… { --semantic: var(--primitive); }`                   |
| `defineVars` の値に `light-dark()` と別ファイルの変数を組み合わせて書く        | 可   | `:root, .x… { --semantic: light-dark(var(--a), var(--b)); }`     |
| `createTheme` の値に別ファイルの `defineVars` の変数を書く                     | 可   | `.x….x…, .x….x…:root { --semantic: var(--primitive); }`          |
| `createTheme` を `.stylex.ts` ファイルに置き、別パッケージ(admin)から適用する | 可   | `stylex.props(theme, …)` でテーマのクラスが要素に付く            |
| lightningcss の既定の対象ブラウザのまま `light-dark()` を書く                  | 不可 | `var(--lightningcss-light, …) var(--lightningcss-dark, …)` になる |

最後の行は 5 章のとおり `exclude: Features.LightDark` で避ける(テストもこの指定でビルドしている)。

実装時の注意:

- CSS のカスタムプロパティの `var()` は、そのプロパティを宣言した要素で解決され、子孫へは解決後の値が継承される。セマンティックトークンは `:root` で宣言されるため、子孫の要素でプリミティブトークンだけを上書きしても、セマンティックトークンには反映されない。テナントごとのアクセント色などは、4 章のとおりセマンティックトークンを上書きする形で作る
- 一方 `light-dark()` は、値を使う要素の `color-scheme` で選ばれる。`color-scheme` は継承されるため、ルートの要素で切り替えれば全体に反映される
- `createTheme` の出力が二重のクラス(`.x….x…`)になっているのは、`:root` に宣言された `defineVars` より詳細度を上げ、同じ要素(ルートの要素など)に付けたときにも上書きを成り立たせるため。これは StyleX の `useCSSLayers` が無効(現在の設定)のときの出力で、有効にすると `@layer` による優先順位に変わる
- テーマを入れ子にした場合に内側が優先されるのは、カスタムプロパティの継承による(内側の要素で宣言した値が子孫に継承される)。二重クラスの詳細度とは別の仕組み

## 6. 未決事項

- テーマ切り替えをアカウント単位で保存するか(現案はブラウザに記憶。複数の端末で揃えるにはサーバーへの保存が必要)

解消済み(D1、2026-10-17): `gray` の補間値(2.1)、`#0b1220` の位置づけ(2.1、廃止)、新規の色トークンの値とコントラスト比(3.1)。

## 7. 決定ログ

- 2026-10-17: D1(キャンバス https://claude.ai/artifact/K57TVUfpefMuiPxhZXyAnU)で 2 章の補間値と影、3.1 のダーク列、3.2 の部品の高さを確定。追加したセマンティックトークンは 3.1・3.2 の「新規、D1」。画面の地は white / gray950 のまま(gray50 / gray900 案は比較のうえ見送り)
