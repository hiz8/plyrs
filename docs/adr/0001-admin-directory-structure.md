# 0001. 管理画面のディレクトリ構成を、フィーチャーベースとルート単位のコロケーションへ再編し、依存ルールを oxlint で強制する

- ステータス: 提案
- 日付: 2026-11-08
- 対象: `apps/admin/src`(パッケージ間の依存ルールは `packages/*` と `apps/*` 全体)

## 背景と課題

`apps/admin/src` は、ほぼレイヤーベースで構成されている。`routes/`・`components/`・`lib/` の 3 つに分かれる。

- `lib/` には 47 のモジュール(テストを含めると 91 ファイル)がフラットに並ぶ。API クライアント、ドメイン関数(`content-list.ts`・`media.ts`)、フック(`use-*.ts`)が同じ階層に混在している。
- `components/` の下だけは `media/`・`home/`・`content-types/` などの機能別ディレクトリがあり、部分的にフィーチャーベースになっている。
- 画面フローの統合テスト 51 本(`home-flow.test.tsx` など)が `src/` 直下に並んでいる。

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
4. **アプリの起動と全体の配線**: app 層へ置く。app 層は、`src/` 直下のフレームワークのエントリと `app/` ディレクトリからなる。

フレームワークのエントリ(`router.tsx`・`start.ts`・`server.ts`)と生成物の `routeTree.gen.ts` は、`src/` 直下に残す。TanStack Start のプラグインは、エントリを `srcDirectory`(既定 `src`)の直下で探す。`app/` へ移すには `tanstackStart` に `router.entry`・`server.entry`・`start.entry` を渡す必要がある。また `srcDirectory` 自体を `src/app` に変えると、`routesDirectory` と `generatedRouteTree` の解決位置もずれる。エントリの配置は、dev や E2E のテストが通っても実環境で壊れうる領域なので(`CLAUDE.md` の SPA シェル配信の注意を参照)、動かさない。`tsconfig.json` の `exclude: ["src/server.ts"]` と、lint の `ignorePatterns` の `**/routeTree.gen.ts` もそのまま維持する。

```
apps/admin/src/
  router.tsx, start.ts, server.ts, routeTree.gen.ts   … フレームワークのエントリ(app 層、移動しない)
  app/       server-routing.ts, api-paths.ts, error-screen.tsx
  routes/    ルートファイルと、ルート専用の部品(-components/、-tests/ など)
  features/  records/, media/, content-types/(各 feature の index.ts が公開 API)
  shared/    api/, ui/, lib/, styles/
  test-utils/
```

依存してよい方向は次のとおり。

| 依存元                       | 依存してよい先                                                                                      |
| ---------------------------- | --------------------------------------------------------------------------------------------------- |
| app 層(`src/` 直下と `app/`) | `routes/`・`features/`・`shared/`                                                                   |
| `routes/`                    | 自分のサブツリーと祖先ディレクトリの `-` 付きディレクトリ、`features/*`(`index.ts` のみ)、`shared/` |
| `features/<f>/`              | 自 feature の内部、許可リストにある他 feature(`index.ts` のみ)、`shared/`                           |
| `shared/`                    | `shared/` のみ                                                                                      |
| `test-utils/`                | すべて(層の依存ルールの対象外)                                                                      |

`test-utils/` を import してよいのはテスト(`*.test.{ts,tsx}` と `-tests/` の中)だけとする。テスト以外のファイルから `test-utils/` への import は禁止する(現状、テスト以外からの import は無い)。テストのファイル自体には、置かれた場所の層の依存ルールをそのまま適用する。

既存のコードのうち、この表と食い違うものは次のように扱う。

| 既存の依存                                                                                                                    | 扱い                                                                                                                                                                                                    |
| ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `routes/__root.tsx` → `router.tsx` の `RouterContext` 型                                                                      | `RouterContext` 型を `shared/lib/router-context.ts` へ切り出し、`router.tsx` と `__root.tsx` の両方がそこを import する                                                                                 |
| `routes/__root.tsx` → `styles.css?url`                                                                                        | `styles.css` を `shared/styles/` へ移す                                                                                                                                                                 |
| `lib/sync-context.tsx` の `useTenantSync`(ルート 12 ファイルと `media-library`・`record-editor`・`tenant-page-header` が使う) | Context オブジェクト・`TenantSyncProvider`・hook は同じファイルでないと成立しないので、ファイルごと `shared/lib/` へ置く。Provider を組み付けるのは、現状どおり `routes/t/$tenantSlug/route.tsx` とする |
| `test-utils/*` → `router.tsx`・`lib/*`                                                                                        | `test-utils/` は層の依存ルールの対象外なので、そのまま許可する                                                                                                                                          |

この扱いにより、routes・features・shared から app 層への依存は 0 本になり、例外を設けずに済む。

feature 間の依存は、既定ですべて禁止する。初期の許可リストは **records → media の 1 本だけ**とする(record-form がアセット選択の部品を使うため)。許可を追加するときは、`oxlint.config.ts` の許可リストを変える変更として、レビューで判断する。

### import の書き方の規則

- 層やスライスをまたぐ import は、エイリアス `~/`(`apps/admin/src` を指す)で書く。
- 相対 import は、同じ feature の中と、同じルートのサブツリーの中だけで使う。
- エイリアスは tsconfig の `paths` で定義し、Vite 8 の組み込みオプション `resolve.tsconfigPaths` で解決する(追加の依存は不要)。`vitest.config.ts` は `vite.config.ts` とは別のファイルで設定を共有していないので、`resolve.tsconfigPaths` は両方に設定する。

この規則も lint で強制できる。直接「エイリアスを使え」と指示するルールはないが、区画の外へ出る相対 import をすべてエラーにすれば、層をまたぐ import を書く方法はエイリアスしか残らない。

### パッケージ間の依存ルール(Nx 式の分類)

各パッケージに次の分類を付ける。

| パッケージ             | type        | scope                                                                                          |
| ---------------------- | ----------- | ---------------------------------------------------------------------------------------------- |
| `@plyrs/metamodel`     | util        | shared                                                                                         |
| `@plyrs/sync-protocol` | util        | shared                                                                                         |
| `@plyrs/richtext`      | util        | shared(api でも使う)                                                                           |
| `@plyrs/sync-client`   | data-access | shared(api の依存は devDependencies で、使うのは `apps/api/test/sync-client-e2e.test.ts` だけ) |
| `@plyrs/ui`            | ui          | web                                                                                            |
| `@plyrs/db`            | data-access | api                                                                                            |
| `@plyrs/admin`         | app         | web                                                                                            |
| `@plyrs/api`           | app         | api                                                                                            |
| `@plyrs/e2e`           | e2e         | —(workspace のパッケージに依存しない)                                                          |

依存ルールは次のとおり。

- util は util にだけ依存してよい。
- ui は util にだけ依存してよい(data-access には依存しない)。
- app は、自分の scope と scope shared のパッケージに依存してよい。app 同士は依存しない。
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
- `routes/` などのルールはディレクトリ名とファイル名で判定する。URL のセグメントに `features`・`shared`・`app`・`router`・`start`・`server` という名前のルートを作ると誤検出する(現状は該当なし)。
- エントリを `src/` 直下に残すので、app 層が `src/` 直下のファイルと `app/` の 2 箇所に分かれる。
- records → media の依存が、例外として 1 本残る。
- 移行の途中は、旧構成と新構成が混在する。

### 確認方法

- `pnpm lint` が、依存ルールの違反を `no-restricted-imports` のエラーとして報告すること。
- 違反の例を含むフィクスチャを用意し、検出されることを確認する(下記「lint の検証結果」を参照)。
- `pnpm typecheck`・`pnpm test`・`pnpm --filter @plyrs/admin build` が、エイリアス導入後も通ること。
- preview へのデプロイ後に、管理画面の SPA シェル配信(`/_shell`)と主要な画面が実環境で表示できること。

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

admin の規模(テストを除くソース 179 ファイル)では、FSD は重すぎると判断した。

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

### フレームワークのエントリを `app/` へ移す案

当初は `router.tsx`・`start.ts`・`server.ts` も `app/` へ移す案だったが、採らなかった。移すには `tanstackStart` へ `router.entry`・`server.entry`・`start.entry` を渡す設定と、`tsconfig.json` の `exclude` の追従が必要になる。得られるのは「app 層が 1 つのディレクトリにまとまる」ことだけで、dev では気づけず実環境で壊れうる変更を抱える価値はないと判断した。

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
| 深さ 2 のファイルから、深さより多く遡る相対 import(`../../../shared/x`、`../../../../x`)                  | 検出できた(`../../**` が一致する)         |
| `~/features/media/index` のように `index` まで書いた import                                               | 検出できた(注 1)                          |
| app 層のエントリ(`../router`、`~/router` など)の import を禁止し、`@tanstack/react-router` などは許可     | 区別できた                                |
| routes から features・shared・app への相対 import                                                         | 検出できた                                |
| shared の区画をまたぐ相対 import(`shared/ui` → `../lib/x`)                                                | 検出できた                                |
| 別サブツリーの `-` 付きディレクトリの import を禁止し、祖先の `-` 付きディレクトリは許可                  | 区別できた(正規表現 `/[^./][^/]*/-[^/]+`) |
| `oxlint.config.ts` の自動検出(`-c` 指定なし)                                                              | 読み込まれた                              |

注 1: `~/features/media/index` は `paths` の完全一致(`~/features/media`)からは外れるが、`patterns` の `~/features/*/**` で止まる。そのため、許可リストにある feature でも、エラーのメッセージは「公開 API(index.ts)経由で import する」になる。`index` を省いて `~/features/media` と書けば解消する。

あわせて、routes のルール(features・shared・app への相対 import の禁止、別サブツリーの `-` 付きディレクトリの禁止、routes 内のエイリアスの禁止)を現在の `apps/admin/src` に当て、違反が 0 件であることを確認した。旧構成の `../../components/...` や `../../lib/...` はどのパターンにも一致しないため、このルールは移行の初期から有効にできる。

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
// app 層(src 直下のエントリと app/)。routes・features・shared からの import を禁止する。
const APP_LAYER = ["router", "start", "server", "routeTree.gen"].flatMap((n) => [
  `~/${n}`,
  `**/${n}`,
]);
// テスト以外のファイルから test-utils への import を禁止する。
// テストのファイルは、test-utils の禁止を外した同じ内容の override を excludeFiles で分けて生成する。
const TEST_FILES = ["**/*.test.{ts,tsx}", "**/-tests/**"];

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
              group: ["~/routes/**", "~/app/**", ...APP_LAYER],
              message: "features から routes・app 層へは依存できない",
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

routes・shared・パッケージの override も、同じファイルに同じ形で書く。テストのファイルとそれ以外を `excludeFiles` で分ける点も、全 override に共通する(上の骨子では省略している)。

### 移行の手順

ルールを有効にする時期も、手順ごとに決めておく。

| 手順                                                                                                                                                                                                                           | この手順で有効にするルール                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| 1. **ファイル移動を伴わない準備**: `labels.ts` と `admin-api.ts` から機能固有の型を外す。`search`(`normalizeForSearch` など)と `kindOf` を共通の場所へ切り出す。`RouterContext` 型を `shared/lib/router-context.ts` へ切り出す | なし                                                                                                                          |
| 2. **エイリアスと lint の導入**: tsconfig の `paths` と、`vite.config.ts`・`vitest.config.ts` の両方の `resolve.tsconfigPaths` を設定し、`oxlint.config.ts` を追加する。`styles.css` を `shared/styles/` へ移す                | shared、routes、test-utils、パッケージのルール。routes のルールは現在のコードで違反 0 件を確認済み(「lint の検証結果」を参照) |
| 3. **ルート単位のコロケーション**: home、account、proposals、settings、history の順に移す。依存がルート内で完結しているものから始める                                                                                          | なし(手順 2 の routes のルールが、移した部品にもそのまま適用される)                                                           |
| 4. **features の作成**: `features/records`・`features/media`・`features/content-types` を作り、`index.ts` で公開 API を固める                                                                                                  | feature のルール。`FEATURES` に追加した feature から順に有効になる                                                            |
| 5. **残りを `shared/` と `app/` へ移す**: `sync-context.tsx` を含む `lib/` の残りを `shared/lib/` へ、`server-routing.ts`・`api-paths.ts`・`error-screen.tsx` を `app/` へ移す。`components/` と `lib/` を空にして削除する     | なし(手順 2 と 4 で全ルールが有効になっている)                                                                                |

## 未確認の事項

- Vite 8 の `resolve.tsconfigPaths` が、admin の dev サーバー・ビルド・vitest で `~/` を解決できること(tsc での解決は確認済み)。`vite.config.ts` と `vitest.config.ts` の両方に設定する前提で確認する
- preview ビルドでの動作。エントリは動かさないが、エイリアスの導入と `styles.css` の移動はビルド結果に影響するので、dev と E2E だけでなく preview へのデプロイで確認する
- 依存ルールを、実際のコードベースへ導入した場合の lint 時間(検証はフィクスチャで行った)
- エディタの oxc 拡張が `oxlint.config.ts` を読めること

## 関連

- [hiz8/plyrs#110](https://github.com/hiz8/plyrs/issues/110) — api の循環 import の解消と `import/no-cycle` の導入(この ADR とは別に扱う)
- `docs/tech-selection.md` — 技術選定とバージョン方針
