# 0001. 管理画面のディレクトリ構成を、フィーチャーベースとルート単位のコロケーションへ再編し、依存ルールを oxlint で強制する

- ステータス: 提案
- 日付: 2026-11-08
- 対象: `apps/admin/src`(パッケージ間の依存ルールは `packages/*` と `apps/*` 全体)

## 背景と課題

`apps/admin/src` は、ほぼレイヤーベースで構成されている。`routes/`・`components/`・`lib/` の 3 つに分かれる。

- `lib/` には約 60 のモジュールがフラットに並ぶ。API クライアント、ドメイン関数(`content-list.ts`・`media.ts`)、フック(`use-*.ts`)が同じ階層に混在している。
- `components/` の下だけは `media/`・`home/`・`content-types/` などの機能別ディレクトリがあり、部分的にフィーチャーベースになっている。
- 画面フローの統合テスト約 50 本(`home-flow.test.tsx` など)が `src/` 直下に並んでいる。

import 関係を洗い出すと、次の問題が見つかった。

| 箇所                                                                   | 問題                                                                                                                                                                            |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lib/labels.ts`(1097 行)                                               | 全画面が使う共通モジュールなのに、`content-list`・`media-list`・`content-type-form`・`permissions`・`sync-indicator` の型を import している(共通側から個別機能への逆向きの依存) |
| `lib/admin-api.ts`(454 行)                                             | 共通の API クライアントなのに、`history`・`proposals` の型を import している                                                                                                    |
| `lib/media-list.ts`                                                    | 検索用の関数 `normalizeForSearch` を `content-list` から借りている                                                                                                              |
| `lib/list-cells.ts`                                                    | `kindOf` を `content-type-form` から借りている(record 系から型定義系への依存)                                                                                                   |
| `components/record-form.tsx`・`asset-picker.tsx`                       | `media/media-picker-dialog`・`media-thumb` を直接 import している(record 系から media 系への依存)                                                                               |
| `components/settings/` の `settings-card`・`card-state`・`dialog-note` | settings 専用の場所にあるが、media・content-types・account からも使われている                                                                                                   |

どのファイルをどこに置くか、どこからどこへ依存してよいかの規則がない。そのため、置き場所の判断が人によって変わり、逆向きの依存も増えていく。規則は、文書に書くだけでなく lint で機械的に強制したい。

## 判断の要因

- 置き場所が機械的に決まること(新しいファイルの置き場所で迷わない)
- TanStack Router のファイルベースルーティングと衝突しないこと
- 依存ルールを lint で強制できること
- CI とローカルの lint を速いまま保つこと(現状、リポジトリ全体で約 0.09 秒)
- 依存ライブラリを増やさないこと
- 機能単位で少しずつ移行できること

## 検討した選択肢

1. レイヤーベース(現状維持)
2. フィーチャーベース(Bulletproof React 準拠)
3. Feature-Sliced Design(FSD)
4. ルート単位のコロケーション(TanStack Router の `-` 接頭辞を使う)
5. Nx 式のライブラリ分類(scope × type)

4 と 5 は単独では成り立たないので、組み合わせて比べた。

- **案 A**: 2 + 4 + 5
- **案 B**: 3 + 5

候補の調査で外したもの(Atomic Design、Clean / Hexagonal Architecture、Vertical Slice、Ducks、Micro-frontends)と、外した理由は「選択肢ごとの長所と短所」に書く。

## 決定

**案 A(フィーチャーベース + ルート単位のコロケーション + パッケージ分類)を採用する。** 依存ルールは、oxlint の組み込みルール `no-restricted-imports` で強制する。設定ファイルは `oxlint.config.ts` とし、feature の一覧と許可リストから `overrides` を自動生成する。

### 置き場所の規則

上から順に判定する。

1. **1 つのルートのサブツリー内だけで使うもの**: そのルートたちに共通する、最も近い親ディレクトリの `-` 付きディレクトリへ置く(`-components/`、`-tests/` など)。TanStack Router は、`-` で始まるファイルとディレクトリをルートとして扱わない。
2. **ルートのサブツリーをまたいで使い、特定の機能に属するもの**: `features/<機能>/` へ置く。外へ公開するものは `index.ts` から export する。
3. **機能に依存しないもの**: `shared/` へ置く。
4. **アプリの起動と全体の配線**: `app/` へ置く。

```
apps/admin/src/
  app/       router.tsx, start.ts, server.ts, server-routing.ts, api-paths.ts,
             styles.css, error-screen.tsx, sync-context.tsx(Provider)
  routes/    ルートファイルと、ルート専用の部品(-components/、-tests/ など)
  features/  records/, media/, content-types/(各 feature の index.ts が公開 API)
  shared/    api/, ui/, lib/
  test-utils/
```

依存してよい方向は次のとおり。

| 依存元          | 依存してよい先                                                                                      |
| --------------- | --------------------------------------------------------------------------------------------------- |
| `app/`          | `routes/`・`features/`・`shared/`                                                                   |
| `routes/`       | 自分のサブツリーと祖先ディレクトリの `-` 付きディレクトリ、`features/*`(`index.ts` のみ)、`shared/` |
| `features/<f>/` | 自 feature の内部、許可リストにある他 feature(`index.ts` のみ)、`shared/`                           |
| `shared/`       | `shared/` のみ                                                                                      |

feature 間の依存は、既定ですべて禁止する。初期の許可リストは **records → media の 1 本だけ**とする(record-form がアセット選択の部品を使うため)。許可を追加するときは、`oxlint.config.ts` の許可リストを変える変更として、レビューで判断する。

### import の書き方の規則

- 層やスライスをまたぐ import は、エイリアス `~/`(`apps/admin/src` を指す)で書く。
- 相対 import は、同じ feature の中と、同じルートのサブツリーの中だけで使う。
- エイリアスは tsconfig の `paths` で定義し、Vite 8 の組み込みオプション `resolve.tsconfigPaths` で解決する(追加の依存は不要)。

この規則も lint で強制できる。直接「エイリアスを使え」と指示するルールはないが、区画の外へ出る相対 import をすべてエラーにすれば、層をまたぐ import を書く方法はエイリアスしか残らない。

### パッケージ間の依存ルール(Nx 式の分類)

各パッケージに次の分類を付ける。

| パッケージ             | type        | scope                |
| ---------------------- | ----------- | -------------------- |
| `@plyrs/metamodel`     | util        | shared               |
| `@plyrs/sync-protocol` | util        | shared               |
| `@plyrs/richtext`      | util        | shared(api でも使う) |
| `@plyrs/sync-client`   | data-access | shared(api も依存)   |
| `@plyrs/ui`            | ui          | web                  |
| `@plyrs/db`            | data-access | api                  |

依存ルールは次のとおり。

- util は util にだけ依存してよい。
- ui は util にだけ依存してよい(data-access には依存しない)。
- scope が web のパッケージは api から使わない。scope が api のパッケージは web から使わない。

現状の依存関係はすでにこのルールを満たしているので、ファイルの移動はない。ルールを `oxlint.config.ts` にパッケージごとの override として書き、`@plyrs/*` の import を禁止する形で強制する。pnpm は、`package.json` に書いていない依存を解決できない。そのため、import を lint で禁止すれば、依存の追加も実質的に防げる。

## 結果

### 良い点

- 置き場所が 4 段階の判定で機械的に決まる。
- 画面専用の部品とテストがルートの隣に集まり、`components/` と `src/` 直下の肥大が解消する。
- 依存ルールを lint で強制でき、逆向きの依存が CI で止まる。
- lint 時間はほぼ変わらない(約 0.09 秒から約 0.10 秒)。依存ライブラリも増えない。
- 機能単位で 1 PR ずつ移行できる。

### 悪い点

- `oxlint.config.ts`(TS 形式の設定ファイル)は oxlint では experimental 扱いである。動かなくなった場合は、生成結果を `.oxlintrc.json` に書き出して戻す。
- 判定は import の文字列に対して行われ、実際のファイルパスには解決されない。そのためエイリアスの規約が前提になり、ファイルの深さごとに override を分ける必要がある。
- `routes/` のルールはディレクトリ名で判定する。URL のセグメントに `features`・`shared`・`app` という名前のルートを作ると誤検出する(現状は該当なし)。
- records → media の依存が、例外として 1 本残る。
- 移行の途中は、旧構成と新構成が混在する。

### 確認方法

- `pnpm lint` が、依存ルールの違反を `no-restricted-imports` のエラーとして報告すること。
- 違反の例を含むフィクスチャを用意し、検出されることを確認する(下記「lint の検証結果」を参照)。
- `pnpm typecheck`・`pnpm test`・`pnpm --filter @plyrs/admin build` が、エイリアス導入後も通ること。

## 選択肢ごとの長所と短所

### 案 A: 2 + 4 + 5

- 良い点: 判定ルールが 3〜4 段階で単純。TanStack Router の仕様をそのまま使える。機能単位で移行できる。
- 良い点: 依存ルールを、oxlint の組み込みルールだけで強制できる。
- 悪い点: feature が 20 を超えると、feature 間の境界が曖昧になりやすい。
- 悪い点: エイリアスの規約と、深さ別の override が必要。

### 案 B: 3 + 5(Feature-Sliced Design)

`app / pages / widgets / features / entities / shared` の 6 層に分ける。

- 良い点: 大規模でもルールが崩れにくい。公式 linter(Steiger)がある。
- 悪い点: `pages` 層が `routes/` と役割で重なり、各画面が `routes/x.tsx` と `pages/x/` の 2 箇所に割れる。
- 悪い点: 同じ層のスライス同士の import が禁止される。そのため record-form が `pick-asset`(feature)を使えず、widgets へ上げることになる。conflict-dialog やフィールドの入力部品も一緒に widgets へ移る。
- 悪い点: entities 同士の参照に `@x` 記法(スライス間の限定公開)が必要になる。
- 悪い点: 層の判定(feature か widget か entity か)で迷いやすく、移行が一括になりやすい。
- 悪い点: Steiger を使うと、oxlint とは別の依存が増える。

admin の規模(テストを除くソース約 170 ファイル)では、FSD は重すぎると判断した。

### 1: レイヤーベース(現状維持)

- 良い点: 移行コストがない。
- 悪い点: 「背景と課題」の問題が残り、`lib/` の肥大と逆向きの依存が続く。

### 調査したが候補から外したもの

| パターン                                         | 外した理由                                                                                                       |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| Atomic Design                                    | 部品を大きさで分類する方式で、ディレクトリ全体の構成方針ではない                                                 |
| Clean / Hexagonal Architecture                   | 純粋な関数の分離は、パッケージ分割(metamodel・sync-protocol)ですでに実現している。SPA の内部まで層を作るのは過剰 |
| Vertical Slice、DDD の境界づけられたコンテキスト | ディレクトリの形としては、フィーチャーベースや FSD とほぼ同じ                                                    |
| Ducks(Redux modules)                             | Redux 前提。plyrs は TanStack DB と sync-client を使っている                                                     |
| Micro-frontends                                  | admin は 1 つの Worker で配信する SPA で、分割する理由がない                                                     |

## 詳細

### lint の方式の比較

oxlint 1.86.0(リポジトリに入っている版)で検証した。oxlint には、ESLint で層の境界の定番だった `import/no-restricted-paths` がない。そのため、次の 2 つの方式を比べた。

| 方式                                             | 追加の依存 | lint 時間(リポジトリ全体 766 ファイル) | 判定     |
| ------------------------------------------------ | ---------- | -------------------------------------- | -------- |
| 現状                                             | なし       | 約 0.09 秒                             | —        |
| **`no-restricted-imports` + `overrides`**        | なし       | **約 0.10 秒**                         | **採用** |
| 自作の JS プラグイン(約 60 行のローカルファイル) | なし       | 約 0.46〜0.57 秒                       | 代替案   |

- 時間は 7 回計測したうちの最良値。計測環境の Node は 22(プロジェクトの指定は 24)。
- `oxlint.config.ts` の読み込みにかかる時間は約 0.03 秒。
- JS プラグインは、import 先を実際のパスに解決して判定するので正確で、エイリアスも深さ別の override も要らない。ただし、JS プラグインの機能は alpha で semver の対象外であり、JS の実行環境の起動で約 0.4 秒の固定費がかかる。エイリアスの規約が運用上つらいと分かった場合に切り替える。

### lint の検証結果

案 A の構成を模したフィクスチャで、次の検出を確認した。

| 検証項目                                                                                                  | 結果                                      |
| --------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| 他 feature への深い import(`~/features/media/components/x`)を禁止し、公開 API(`~/features/media`)だけ許可 | 検出できた                                |
| 自 feature の内部は許可(否定パターン `!~/features/records/**`)                                            | 許可できた                                |
| feature 間の依存を許可リストで制御(records → media だけ許可)                                              | 許可外を検出できた                        |
| shared → features/routes、features → routes/app の禁止                                                    | 検出できた                                |
| `import type`、`export … from`、動的な `import("…")`                                                      | どれも検出できた                          |
| feature の外へ出る相対 import(`../../media/x`)を禁止し、feature 内の相対 import(`../lib/x`)は許可         | 区別できた                                |
| routes から features・shared・app への相対 import                                                         | 検出できた                                |
| shared の区画をまたぐ相対 import(`shared/ui` → `../lib/x`)                                                | 検出できた                                |
| 別サブツリーの `-` 付きディレクトリの import を禁止し、祖先の `-` 付きディレクトリは許可                  | 区別できた(正規表現 `/[^./][^/]*/-[^/]+`) |
| `oxlint.config.ts` の自動検出(`-c` 指定なし)                                                              | 読み込まれた                              |

検証中に分かった oxlint の挙動は次のとおり。設定を書くときの前提になる。

- 複数の override が同じファイルに当たると、後のものがルールの設定全体を置き換える(設定はマージされない)。そのため、override ごとにパターンをすべて書く必要がある。`oxlint.config.ts` で自動生成するのはこのためである。
- サブディレクトリに置いた `.oxlintrc.json` も同様で、一番近い設定だけが使われ、ルートの設定とマージされない。
- `regex` パターンは Rust の正規表現で、先読み・後読みは使えない。
- エイリアスに `package.json` の `imports`(`#/*`、`#src/*`)は使えない。`#/` は Node 22 と TypeScript 7 で不正な指定として拒否される。`#src/*` は拡張子を補完しないので、TypeScript が解決できない。

### `oxlint.config.ts` の骨子

```ts
// 依存ルールの生成元。feature を追加・削除するときと、feature 間の依存を許可するときはここを変える。
const SRC = "apps/admin/src";
const FEATURES = ["records", "media", "content-types"];
// 依存元 → 依存してよい他 feature(index.ts 経由のみ)。
const ALLOW_CROSS: Record<string, string[]> = { records: ["media"] };
// feature 内のディレクトリの最大の深さ。これより深いファイルは相対 import の検査から漏れる。
const MAX_DEPTH = 4;

const featureOverrides = FEATURES.flatMap((f) =>
  Array.from({ length: MAX_DEPTH }, (_, i) => i + 1).map((depth) => ({
    files: [`${SRC}/features/${f}/${"*/".repeat(depth - 1)}*.{ts,tsx}`],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: FEATURES.filter((o) => o !== f && !(ALLOW_CROSS[f] ?? []).includes(o)).map(
            (o) => ({
              name: `~/features/${o}`,
              message: `features/${f} から features/${o} への依存は許可されていない`,
            }),
          ),
          patterns: [
            {
              group: ["~/features/*/**", `!~/features/${f}/**`],
              message: "他 feature は公開 API(index.ts)経由で import する",
            },
            {
              group: ["~/routes/**", "~/app/**"],
              message: "features から routes・app へは依存できない",
            },
            {
              group: [`${"../".repeat(depth)}**`],
              message: "feature の外へ出る import は ~/ で書く",
            },
          ],
        },
      ],
    },
  })),
);
```

routes・shared・パッケージの override も、同じファイルに同じ形で書く。

### 移行の手順

1. **ファイル移動を伴わない準備**: `labels.ts` と `admin-api.ts` から機能固有の型を外す。`search`(`normalizeForSearch` など)と `kindOf` を共通の場所へ切り出す。
2. **エイリアスと lint の導入**: tsconfig の `paths` と `resolve.tsconfigPaths` を設定し、`oxlint.config.ts` を追加する。shared・パッケージのルールから有効にする。
3. **ルート単位のコロケーション**: home、account、proposals、settings、history の順に移す。依存がルート内で完結しているものから始める。
4. **features の作成**: `features/records`・`features/media`・`features/content-types` を作り、`index.ts` で公開 API を固める。feature のルールを有効にする。
5. **残りを `shared/` と `app/` へ移す**: `components/` と `lib/` を空にして削除する。

## 未確認の事項

- Vite 8 の `resolve.tsconfigPaths` が、admin の dev サーバー・ビルド・vitest で `~/` を解決できること(tsc での解決は確認済み)
- 依存ルールを、実際のコードベースへ導入した場合の lint 時間(検証はフィクスチャで行った)
- エディタの oxc 拡張が `oxlint.config.ts` を読めること

## 関連

- [hiz8/plyrs#110](https://github.com/hiz8/plyrs/issues/110) — api の循環 import の解消と `import/no-cycle` の導入(この ADR とは別に扱う)
- `docs/tech-selection.md` — 技術選定とバージョン方針
