# マルチテナント CMS/BaaS 技術選定書

> design-spec-v5.md の実装に先立つ主要技術の選定。設計仕様で確定済みの技術(Cloudflare 系・tanstack-db)を前提とし、残る領域を確定する。
> 各項目は「採用 / 根拠 / 代替案 / リスクと注意」の形式で記す。最終確認日: 2026-07-12。

---

## 0. 前提(設計仕様で確定済み・再選定しない)

| 領域                            | 技術                             | 仕様書の根拠  |
| ------------------------------- | -------------------------------- | ------------- |
| ホスト・実行層                  | Cloudflare Workers               | 第3章         |
| テナントデータ                  | Durable Objects (SQLite backend) | 第2・3・6章   |
| コントロールプレーン / 公開投影 | D1                               | 第3・11・12章 |
| 非同期搬送                      | Cloudflare Queues                | 第9・12章     |
| バイナリ                        | R2                               | 第3・5章      |
| キャッシュ・ブロックリスト      | Cache API / KV                   | 第3・11・12章 |
| ローカルファースト同期基盤      | TanStack Query / TanStack DB     | 第0・8・10章  |

---

## 1. 希望技術の検証(6点、すべて採用)

### 1.1 フレームワーク: React 19 + TanStack Start — 採用

- **現状**: v1.0 Release Candidate(2025-09 到達、2026-07 時点も RC 継続)。API は stable 扱いで、feature-complete。Cloudflare が公式パートナーであり、Workers へのデプロイは第一級サポート。
- **本プロジェクトとの適合**:
  - TanStack Router / Query / DB / Form と同一エコシステムで、ローカルファースト主軸(仕様第0章)と設計思想が揃う。管理画面は「DO と WebSocket 同期する SPA」が本体であり、Start の selective SSR / SPA モードで管理画面を SPA 寄りに倒せる。
  - サーバー機能(server functions / server routes)は使うが、公開配信 API は別 Worker に分離する(→ 2.4)。Start は管理画面アプリの殻に徹する。
- **リスクと注意**:
  - RC のため **バージョンを厳密に固定**(`^` を使わず exact pin)し、リリースノートを追って計画的に上げる。
  - React Server Components は experimental。本プロジェクトでは**使わない**(管理画面はクライアント中心、公開側はヘッドレスで対象外)。
- **代替案**: Vite + TanStack Router 素組み(Start の server 層が不要になった場合の縮退先。Router 部分はそのまま使えるため移行コストは小さい)。

### 1.2 UI ライブラリ: react-aria-components + react-aria — 採用

- **現状**: Adobe 製、安定版。アクセシビリティ実装(WAI-ARIA / フォーカス管理 / 国際化対応の挙動)を持つヘッドレドコンポーネント群。
- **本プロジェクトとの適合**: 固定管理画面(仕様第0章)を自作するにあたり、見た目を持たないヘッドレスUIは StyleX と直交して組み合わせられる。Dialog / Menu / ListBox / Table / DatePicker 等、管理画面に必要な部品が揃う。
- **StyleX との統合パターン(重要)**: react-aria-components の `className` は render props(状態関数)を受け取れる。StyleX 側は `stylex.props()` が `{className, style}` を返すため、次の形で合成する:

  ```tsx
  <Button
    className={({ isPressed, isHovered }) =>
      stylex.props(
        styles.base,
        isPressed && styles.pressed,
        isHovered && styles.hovered,
      ).className ?? ""
    }
  />
  ```

  このヘルパー(状態 → StyleX スタイル合成)を `packages/ui` に1つ用意し、全コンポーネントで統一する。

- **リスクと注意**: data 属性セレクタ(`[data-hovered]` 等)による指定は StyleX の静的制約と相性が悪いため、上記 render props 方式に統一する。

### 1.3 スタイリング: StyleX — 採用

- **現状**: Meta が活発に開発継続中(2025年末に新サイト公開、2026年はエルゴノミクス改善・新機能・ツーリング強化を予告)。公式 `@stylexjs/unplugin` が Vite を直接サポートし、ビルド時にCSSを集約して Vite の CSS アセットに注入する。
- **本プロジェクトとの適合**:
  - ビルド時アトミックCSS生成のため**ランタイムコストゼロ**。ローカルファーストで重い同期処理を抱える管理画面において、スタイル層が実行時に何もしないのは適合的。
  - テーマ(`defineVars` / `createTheme`)でダーク/ライトやテナント別アクセントを型安全に扱える。
- **リスクと注意**:
  - **動的な値のスタイルは不得手**(静的解析前提)。ユーザー定義コンテンツ由来の動的スタイル(例: 色フィールドのプレビュー)は inline style で逃がす、と規約化する。
  - Vite プラグインの読み込み順: StyleX プラグインを `@vitejs/plugin-react` より**前**に置く(Fast Refresh 維持のため)。TanStack Start の Vite 設定に組み込む際に順序を確認する。
- **代替案**: vanilla-extract(同じくビルド時・型安全。StyleX に問題が出た場合の退避先)。

### 1.4 リンター・フォーマッター: oxlint + oxfmt — 採用

- **現状**:
  - **oxlint**: v1 系で安定(stable リリースから1年以上)。type-aware linting も利用可能に。
  - **oxfmt**: ベータ(v0.5x)。ただし Prettier の JS/TS 適合テストを 100% パスし、vuejs/core・vercel/turborepo・sentry-javascript 等の大規模 OSS が既に採用。import ソート・package.json ソート内蔵。
- **本プロジェクトとの適合**: 個人開発でツールチェーンを軽く保つ方針(リーンなコア、仕様第9章の思想)と一致。ESLint + Prettier の設定メンテコストを排除できる。
- **リスクと注意**:
  - oxfmt はベータのため **exact pin** し、アップデートは差分を見て計画的に。フォーマット差分が出てもコード意味論には無害(フォーマッタの性質上、リスクは低い)。
  - oxlint は型情報ルールを有効化しても **`tsc --noEmit` の型チェックは別途 CI に残す**(リンターと型検査は役割が別)。

### 1.5 テスト: Vitest + React Testing Library — 採用(+ 追加1点)

- **現状**: Vitest は VoidZero 製で Vite ネイティブ。oxc 系ツールチェーンと同じ開発元で相性・継続性ともに良い。
- **追加選定: `@cloudflare/vitest-pool-workers`**(Cloudflare 公式)。Vitest のテストを **workerd ランタイム上で実行**でき、DO・D1・Queues・R2 をローカルでバインドしてテストできる。本プロジェクトのコア(DO 内の書き込み経路・フック・アウトボックス・投影 consumer)は Workers ランタイム依存が強く、Node 上のユニットテストだけでは検証できないため必須。
- **テスト構成**:
  - **ユニット(Node)**: メタモデルのバリデーション、Zod スキーマ生成、AST → relations 抽出、競合判定ロジック等の純関数。
  - **統合(vitest-pool-workers)**: DO 書き込み経路(beforeWrite → commit → outbox)、publish → 投影 consumer、認可2段、alarm 多重化。
  - **コンポーネント(RTL + jsdom/happy-dom)**: 管理画面 UI。
  - **E2E(Playwright)**: 導入は後回し可。同期(WebSocket)を含むクリティカルパスのみ薄く。
- **リスクと注意**: vitest-pool-workers が要求する Vitest のバージョンレンジに引きずられることがある。Vitest のメジャーアップは pool-workers の対応を確認してから。

### 1.6 日付: date-fns — 採用(v4 + タイムゾーン拡張)

- **選定詳細**: **date-fns v4 + `@date-fns/tz`**(必要に応じ `@date-fns/utc`)。
- **本プロジェクトとの適合**: 仕様第5章「datetime は UTC の ISO8601 で格納し、タイムゾーンは表示層で扱う」に対し、v4 のファーストクラス TZ サポート(`TZDate`)が表示層の変換をそのまま担う。関数単位 tree-shaking で管理画面バンドルにも Workers にも軽い。
- **規約**: 格納・転送は常に UTC ISO8601 文字列。`TZDate` はコンポーネント境界の内側(表示・入力 UI)でのみ使い、状態や data JSON に Date オブジェクトを持ち込まない。

---

## 2. 新規選定

### 2.1 言語・型システム: TypeScript(strict)

- **採用**: TypeScript 最新安定版、`strict: true` + `noUncheckedIndexedAccess`。
- **根拠**: TanStack 系・Drizzle・Zod・StyleX すべてが型を最大の価値とするライブラリであり、strict でなければ選定の意味が半減する。
- **注意**: メタモデル(実行時型定義)と TS の静的型の境界を明確にする。実行時スキーマ→型は Zod の `z.infer` を経由し、`any` の脱出ハッチを `data` JSON パース部の1箇所に閉じ込める。

### 2.2 パッケージマネージャ・リポジトリ構成: pnpm workspaces(モノレポ)

- **採用**: pnpm。単一リポジトリの workspace 構成。Turborepo 等のタスクランナーは**入れない**(個人開発規模では pnpm の `--filter` で足りる。ビルドが遅くなってから再検討)。
- **想定構成**:

  ```
  apps/
    admin/        # TanStack Start(管理画面)
    api/          # Hono(公開配信 API・公開 write・Webhook 受け口)
    sync/         # DO 定義(テナント DO)+ 同期プロトコル実装 ※デプロイ単位は api と統合も可
    consumers/    # Queues consumer(投影・副作用フック)
  packages/
    metamodel/    # content_types の型・Zod スキーマ生成・バリデーション(純関数)
    sync-protocol/# 同期メッセージ型・field_versions 競合判定(クライアント/DO 共用)
    ui/           # react-aria-components + StyleX のコンポーネント資産
    db/           # Drizzle スキーマ(DO 用 / D1 用)
  ```

- **根拠**: DO・Worker・管理画面が「同期プロトコル」「メタモデル」の型を共有する構造(仕様第8・10章)のため、モノレポでの型共有が実質必須。
- **npm workspaces ではなく pnpm を採る理由**(npm でも成立はするが、以下の実利で pnpm とする):
  1. **厳格な node_modules(phantom dependency 防止)**: npm はフラット hoist のため宣言外依存が import できてしまう。`packages/metamodel` / `sync-protocol` のようにクライアント・Worker 双方から使う共有パッケージでは、宣言外依存の混入が Workers バンドル時に初めて発覚する事故になりやすく、pnpm の symlink 構造はこれをインストール時点で弾く。
  2. **catalogs**: ワークスペース全体の依存バージョンを一箇所で定義できる。第3章のバージョン方針(Start / oxfmt の exact pin)を複数パッケージ横断で統制する手段としてそのまま機能する。npm に相当機能はない。
  3. **`pnpm patch` 内蔵**: RC/beta を2つ抱える構成では上流修正待ちの一時パッチが現実的にあり得る。npm では patch-package の追加導入が必要。
  4. インストール速度・ディスク効率(content-addressable store)。これは副次的。

### 2.3 ビルド・デプロイ基盤: Vite + Wrangler + @cloudflare/vite-plugin

- **採用**: Vite(Start に内蔵)。Cloudflare へのデプロイは `@cloudflare/vite-plugin` + Wrangler。ローカル開発は `wrangler dev` / vite-plugin の workerd ローカル実行で、DO・D1・Queues・R2 をローカルバインドする。
- **根拠**: TanStack Start の Cloudflare デプロイ公式経路。vitest-pool-workers と合わせ、ローカルで本番同等のランタイムを再現できる。
- **注意**: DO のマイグレーション(`new_sqlite_classes`)は wrangler 設定の管理対象。wrangler.jsonc を apps ごとに持ち、環境(preview / production)を分ける。

### 2.4 サーバー HTTP フレームワーク: Hono

- **採用**: Hono(公開配信 API・公開 write エンドポイント・DO 内部の fetch ルーティング)。
- **根拠**:
  - Workers ファーストで最軽量級。公開 read パスは「投影 D1 + キャッシュだけを叩く最速経路」(仕様第12章)であるべきで、フレームワークのオーバーヘッド最小化がそのまま効く。
  - **Hono RPC**(`hono/client`)により、管理画面からの非同期 API(publish / unpublish / モジュール有効化等、WebSocket 同期に乗らない操作)を型安全に呼べる。
  - DO クラス内のルーティング(同期 WS のアップグレード、公開 write の受理)にもそのまま使える。
- **役割分担の明確化**: TanStack Start の server functions は**管理画面固有の glue**(セッション確立・初期データ)に限定し、ドメイン API はすべて Hono 側に置く。公開 API はヘッドレス契約(仕様第0章)なので、管理画面フレームワークから独立させる。
- **代替案**: itty-router(さらに軽いが RPC 型安全がない)。

### 2.5 DB アクセス・マイグレーション: Drizzle ORM + drizzle-kit

- **採用**: Drizzle ORM。DO には `drizzle-orm/durable-sqlite` ドライバ、D1 には D1 ドライバ。マイグレーションは drizzle-kit で生成し、DO は**コンストラクタで `blockConcurrencyWhile` + migrator による JIT 適用**(確立済みパターン)。
- **根拠**:
  - Durable Objects SQLite と D1 の**両方を公式サポート**する唯一の主要 ORM。DO(コンテンツ中核+運用テーブル)と D1(コントロールプレーン・投影3テーブル)を同じスキーマ定義言語・同じ型推論で書ける。
  - SQL-like で抽象が薄く、generated column・expression index・`batch()`(投影 consumer の原子性、仕様第12.3章)等、仕様が要求する SQLite の生機能に手が届く。
  - drizzle-zod で Zod との接続も既製。
- **注意**:
  - **メタモデル部分は Drizzle の型推論の外**にある(`records.data` は JSON)。Drizzle が守るのは物理テーブルの形まで。`data` 内の型安全は 2.6 の動的 Zod が担う、という二層を混同しない。
  - 宣言ベース索引(`"indexed": true` → generated column 追加、仕様第6章)は drizzle-kit の静的マイグレーションでは表現できない。**実行時 DDL は型定義マイグレーション経路(仕様第4.2章)で raw SQL 実行**とし、drizzle-kit は固定スキーマ部分のみを管理する、と役割を切る。

### 2.6 スキーマバリデーション: Zod v4

- **採用**: Zod v4。Workers バンドルサイズが問題になる箇所は `zod/mini` を使用。
- **根拠**:
  - **メタモデル → 実行時スキーマ生成**(仕様第4章、tanstack-db の typed collection をレジストリから実行時生成)に対し、Zod はスキーマを値として合成するのが自然で、フィールド型パレット(第5章)の各型を Zod スキーマ片にマップする実装が素直。
  - Standard Schema 準拠のため、TanStack Form・tanstack-db・Hono のバリデータミドルウェア・drizzle-zod と**単一のスキーマ定義で接続**できる。
  - validate-on-write(第4.2章)・寛容 read(unknown フィールド保持 = `passthrough`/`loose`)の両方を表現できる。
- **代替案**: Valibot(バンドル最小。`zod/mini` で不足した場合の乗り換え先。Standard Schema 準拠なので接続層は書き直し不要)。

### 2.7 リッチテキストエディタ: Tiptap v3(ProseMirror)

- **採用**: Tiptap v3。ドキュメントは ProseMirror JSON(= 仕様第5章の「構造化 JSON AST」)として `records.data` に格納。
- **根拠**:
  - **ProseMirror の strict なドキュメントスキーマ**が、仕様の中核要求と一対一で対応する: (a) スキーマ外のノードは存在できない → validate-on-write と整合、(b) リンク・埋め込みメディアをカスタムノード(mark/node)として第一級で定義 → 保存時に AST を走査して `relations (origin='body')` へ投影(第6章)する実装が決定的に書ける。
  - ヘッドレス(UI 非依存)なので react-aria-components + StyleX のツールバー・UI と衝突しない。
  - CMS 用途の実績・拡張エコシステム(mention、placeholder、カスタム embed)が最も厚い。
  - 将来オプションの「本文限定の協調編集」(仕様第10章)にも y-prosemirror という確立経路がある(採用は保留のまま)。
- **AST 永続化の規約**: エディタの JSON をそのまま真実源にするが、**スキーマバージョンを AST ルートに刻む**(`{"schemaVersion": 1, "doc": {...}}`)。エディタ拡張の追加=スキーマ進化であり、寛容 read(第4.2章)の対象として扱う。
- **代替案(不採用理由明記)**:
  - **Lexical**(Meta): StyleX と同じ開発元で思想は近いが、2026年時点でも 0.x であり、リリースごとに非互換変更・deprecated 削除が続いている。**AST を年単位で永続化する本用途では、ドキュメントフォーマットの安定性を最優先**し ProseMirror 系を採る。
  - Plate / BlockNote: ProseMirror ではなく Slate 系/Tiptap ラッパー。抽象が厚く、AST の完全な制御という要求に合わない。

### 2.8 フォーム: TanStack Form

- **採用**: TanStack Form(v1 系、安定版)。
- **根拠**: Standard Schema 対応で Zod(2.6)と直結。TanStack エコシステムで揃え、メタモデル駆動の動的フォーム(content_types からフィールド定義を読んでフォームを組み立てる)をスキーマ→フォームの一本道で実装できる。
- **代替案**: react-hook-form(実績最大。TanStack Form に不具合が出た場合の退避先)。

### 2.9 認証・トークン: jose + WebCrypto(自作、フレームワーク不採用)

- **採用**:
  - **JWT 署名・検証**: `jose`(Workers 完全対応のデファクト)。仕様第11.2章の短命 JWT(15分)発行と Worker 入口での署名検証。
  - **セッション・ユーザー・membership**: 中央 D1 に Drizzle で自作(仕様が構造を完全に規定済み)。
  - **パスワード**: 初期は **WebCrypto PBKDF2**(Workers ネイティブ、外部依存ゼロ)。将来 **passkey(WebAuthn)** を第一認証に格上げする余地を残す。特権テナント(第11.6章)は当初から passkey または TOTP を必須化。
- **根拠**: 仕様第11章は「中央 D1 真実源 + 短命 JWT + KV ブロックリスト + 2段認可」という**具体的な独自構造を既に確定**している。Better Auth 等の認証フレームワークはそれ自身のスキーマ・セッションモデルを持ち込むため、この設計に合わせて歪めるより、プリミティブ(jose + WebCrypto)の上に薄く自作する方が総コストが低い。「自分専用の理想 CMS」原則(第9.1章)とも整合。
- **代替案**: Better Auth(D1/Drizzle 対応あり。もし OAuth プロバイダ連携を多数持ちたくなったら、認証**入口だけ**を委ね、セッション・認可は仕様どおり自作構造に落とす形で部分採用を検討)。

### 2.10 ID 生成: uuid(UUIDv7)

- **採用**: `uuid` パッケージの **UUIDv7**(RFC 9562)。クライアント(管理画面)・Workers・DO のすべてで同一実装を使う。
- **根拠**: 仕様第5章「ID はクライアント生成(ULID/UUID)」。UUIDv7 は時間順(先頭 48bit がミリ秒タイムスタンプ)のため、SQLite B-tree への挿入局所性・カーソルページネーションのタイブレーカー・ID からの生成時刻復元(デバッグ)といった ULID の利点をそのまま保持する。`uuid` はエコシステムの基幹ライブラリでメンテナンスが最も堅牢な部類であり、同一ミリ秒内の単調性も RFC 準拠のカウンタで担保される。
- **選定経緯**:
  - **ulidx(当初案)は撤回**。最終リリースが約2年前で止まりメンテナンス評価が Inactive であることに加え、README 自身が Cloudflare Workers との非完全互換(Workers のリクエスト中時刻凍結仕様)を注記しているため。
  - **nanoid(代替候補)は不採用**。メンテナンス・サイズは最良だが純ランダムでタイムスタンプを持たず、時間順ソート性を失う。UUIDv7 なら同等のメンテナンス品質でソート性を維持できるため。
- **注意**: Workers/DO 内では `Date.now()` がリクエスト中に凍結されるため、同一リクエスト内の連続生成は同一ミリ秒扱いになるが、UUIDv7 のミリ秒内カウンタが単調性を保つので実害はない(そもそも records の ID は仕様どおりクライアント生成が主経路)。
- **規約**: 36 文字の標準表記(ハイフン付き小文字)で統一して格納する。
- **仕様書との整合**: design-spec-v5.md の各所にある「ULID」表記(records/relations 等の DDL コメント、第5章の帰結)は **UUIDv7 に読み替える**。仕様の本質要求(クライアント生成・衝突フリー・時間順)は UUIDv7 で満たされるため設計変更は不要。仕様書の次版更新時に表記を揃えること。

### 2.11 WebSocket 同期: DO Hibernation API 直接使用(ラッパー不採用)

- **採用**: サーバー側は **WebSocket Hibernation API を素で使う**(`acceptWebSocket` / `webSocketMessage`)。クライアント側の再接続・バックオフは `partysocket`(単体利用可能な再接続 WebSocket クライアント)を採用。
- **根拠**: 仕様第3章がハイバネーションを課金構造の生命線と規定しており、抽象レイヤー(PartyServer 等)を挟むとハイバネーション挙動の制御・検証が間接化する。同期プロトコル(第10章: field_versions・競合裁定)は完全に独自なので、ラッパーの提供する部屋・ブロードキャスト抽象に得るものが少ない。クライアント側だけは再接続処理が定型なので既製を使う。
- **メッセージ形式**: JSON(初期)。プロファイリングで問題が出たら CBOR 等を検討(現段階では複雑さを買わない)。

### 2.12 濫用防止(公開 write): Cloudflare Turnstile + Workers Rate Limiting

- **採用**: 仕様第9.7・11.7章の「DO 到達前の Worker 層防御」の実体として、**Turnstile**(Bot 検証)+ **Workers Rate Limiting API / WAF レートルール**。
- **根拠**: 仕様第3章のコスト DoS 注記が既に Turnstile を名指ししている。いずれも Cloudflare ネイティブで追加インフラ不要。
- **注意**: 詳細仕様は仕様書どおり実装フェーズ送り(未処理論点)。ここでは技術の確定のみ。

### 2.13 CI/CD: GitHub Actions + wrangler

- **採用**: GitHub Actions。`oxlint` → `oxfmt --check` → `tsc --noEmit` → `vitest`(unit + pool-workers)→ `wrangler deploy`(cloudflare/wrangler-action)。preview 環境は Workers の preview URL / 環境分割で。
- **根拠**: リポジトリホストの標準経路。個人開発で専用 CD 基盤は過剰。

---

## 3. バージョン方針

| 技術                                   | 状態         | 方針                                                            |
| -------------------------------------- | ------------ | --------------------------------------------------------------- |
| TanStack Start / Router                | v1 RC        | **exact pin**。リリースノート追従の上で計画的更新               |
| oxfmt                                  | beta (0.x)   | **exact pin**。フォーマット差分を確認して更新                   |
| oxlint                                 | stable (1.x) | minor 追従可                                                    |
| Tiptap / ProseMirror                   | stable (3.x) | minor 追従可。**AST スキーマバージョンを自前管理**              |
| Lexical 系                             | —            | 不採用(参考: 0.x で非互換変更継続中)                            |
| Drizzle / Zod / Hono / date-fns / jose | stable       | 通常運用(minor 追従)                                            |
| Vitest + pool-workers                  | stable       | **pool-workers の対応レンジを先に確認**してから Vitest を上げる |

pnpm の `overrides` と renovate(または手動)で管理。RC/beta を2つ(Start・oxfmt)抱えるが、いずれも「壊れても影響がビルド/フォーマットに閉じる」層であり、データ層・同期層には安定版のみを置く、という危険度の傾斜をつけている。

---

## 4. 保留事項(実装フェーズで判断)

- **E2E(Playwright)の導入時期**: 同期プロトコルの結合バグが手動確認で辛くなった時点で導入。
- **メール送信プロバイダ**(メール配信モジュール用): モジュール実装時に選定(候補: Resend / SES)。仕様第9.8章の Queues + send_log 冪等構造はプロバイダ非依存。
- **アセットアップロード方式**: R2 への直接 PUT(presigned)か Worker 経由か。アセット型実装時に決定。
- **`zod/mini` への切り替え判断**: Workers バンドルサイズを計測してから。
- **本文協調編集(y-prosemirror)**: 仕様第10章どおり「痛みが出てから」。Tiptap 採用により経路だけ確保済み。

---

## 5. 選定サマリ

| 領域             | 選定                                                              |
| ---------------- | ----------------------------------------------------------------- |
| フレームワーク   | React 19 + TanStack Start(RC、pin 運用)                           |
| ルーティング     | TanStack Router(Start 内蔵)                                       |
| UI               | react-aria-components + react-aria                                |
| スタイリング     | StyleX(@stylexjs/unplugin)                                        |
| 状態・同期       | TanStack Query / DB(確定済み)                                     |
| フォーム         | TanStack Form                                                     |
| HTTP(API 層)     | Hono(+ Hono RPC)                                                  |
| ORM              | Drizzle ORM(durable-sqlite / D1)+ drizzle-kit                     |
| バリデーション   | Zod v4(zod/mini 選択可)                                           |
| リッチテキスト   | Tiptap v3(ProseMirror JSON AST)                                   |
| 認証             | jose + WebCrypto(自作)/ 特権は passkey・TOTP                      |
| ID               | uuid(UUIDv7)                                                      |
| WebSocket        | Hibernation API 直 + partysocket(client)                          |
| 日付             | date-fns v4 + @date-fns/tz                                        |
| Lint / Format    | oxlint / oxfmt                                                    |
| テスト           | Vitest + RTL + @cloudflare/vitest-pool-workers(+ Playwright 後日) |
| 濫用防止         | Turnstile + Rate Limiting                                         |
| パッケージ管理   | pnpm workspaces(モノレポ)                                         |
| ビルド・デプロイ | Vite + @cloudflare/vite-plugin + Wrangler                         |
| CI/CD            | GitHub Actions                                                    |
