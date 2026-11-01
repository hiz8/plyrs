# MCP 導入 実装ロードマップ(M0〜M5)

> 出典: `docs/design-spec.md` 第 16 章(エージェント接続)、決定 36〜49、`docs/tech-selection.md` 2.7・2.9。
> 計画の原本は MCP 導入の実装計画(Claude Doc、2026-11-01 承認)で、本書はその索引をリポジトリに固定したもの。
> 各フェーズの着手時に superpowers:writing-plans 形式の詳細計画を本ディレクトリに 1 ファイルずつ作る。
> 既存の Phase 1〜10(`2026-07-12-implementation-roadmap.md`)と混ざらないよう、MCP 系は M0〜M5 と呼ぶ。

---

## 1. 前提と方針

最初の外部公開は M1 の読み取り専用 MCP(PAT 認証)で、preview と production に**限定公開**する(決定 40)。
書き込みを含む MCP はデータの土台(M2)がそろった M4 で PAT 接続として公開する(決定 39)。OAuth(M3)は
並行で進め、claude.ai や ChatGPT のコネクタのような PAT を貼れないホスト型クライアントの接続を足すもので、
M4 の前提ではない。

進め方の原則:

1. **決定は文書で先に固める。** 各フェーズの着手前に design-spec へ反映し、決定ログに記録する
2. **書き込みの安全性は M2 が担保し、トークンの入手経路に依存しない。** PAT は暫定措置ではなく恒久的な正式経路(16.3)
3. **捨てる実装を作らない。** M1 の読み取りツールも操作カタログの上に作り、M4 で書き込み操作を足すだけにする。例外は M1-6 の片方向 Markdown 変換だけ(M2-2 で置き換える)
4. **1 PR は 1 つの検証可能な単位。** DB スキーマ変更、DO の RPC、MCP の公開面、管理画面の UI は原則として別 PR。分けられないものだけ L とし、理由を書く
5. **既存経路を通す。** 書き込みは `writeRecord`、公開は `publishRecord`、削除は既存の削除経路を通す
6. **名前と用語をそろえる。** 文言は `docs/glossary.md`(「エージェント接続(MCP)の用語」)に従う

```
M0 決定と試作 ──► M1 読み取り専用 MCP ──────────────► M4 書き込み MCP(PAT)──► M5 拡張
        │              │  カタログ・入口・PAT を M4 が使う     ▲
        ├──────────► M2 データと操作の土台 ─────────────────┘
        │                                                     ┆ OAuth 接続を後から足す(公開条件ではない)
        └──────────► M3 OAuth の認証基盤 ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┘
```

M0 の決定後、M1・M2・M3 は並行で進められる。

## 2. フェーズと PR

規模は S(文書のみ・小さな変更)、M(1 つの層に閉じる実装)、L(スキーマ変更や複数の層にまたがる実装)の相対表記。

### M0 決定と試作 — 完了(2026-11-01)

| PR | 内容 | 論点 | 規模 | 状態 |
| --- | --- | --- | --- | --- |
| M0-1 | design-spec に第 16 章を新設、§13・§14・決定ログ(36〜45)、用語集 | A2・A4・B1・C5・D1・E1〜E5 | S | #33 |
| M0-2 | リッチテキスト形式の試作(`spike/mcp-richtext`)。結果は `2026-11-01-m0-2-richtext-spike-result.md`、決定 46 | A1 | M | #34 |
| M0-3 | 認可サーバーの試作(`spike/mcp-oauth`)。結果は `2026-11-01-m0-3-oauth-spike-result.md`、決定 47〜49 | C1・C2・D2 | M | #35 |
| M0-4 | 本書と M1 の詳細計画 | — | S | — |

ゲート G0(A1 の形式、C1 の方式、PAT の検証経路、D2 の配置が決定ログにある)は決定 46〜49 で満たした。

### M1 読み取り専用 MCP — 詳細計画 `2026-11-01-m1-readonly-mcp.md`

目的は、A1・A2 に依存しない読み取りだけの MCP を先に出し、ツール説明と一覧 API の設計を実利用で確かめること。
ここで作る入口・カタログ・一覧 RPC・PAT は M4 でそのまま使う。

| PR | 内容 | 論点 | 規模 |
| --- | --- | --- | --- |
| M1-1 | 操作カタログの骨格と DO の `invoke(op, input)` RPC。最初の操作は `type_list` / `type_get` / `record_get` | B1 | M |
| M1-2 | DO の一覧 RPC(`record_list`)。文法は `public/query.ts` を共有し、`records.data` に対する実行器を新設 | A4 | M |
| M1-3a | PAT の表と発行・失効 API(例外としてスキーマ変更と同じ PR)。`AuditAction` に `token.issue` / `token.revoke` | C1 ④・C2 | M |
| M1-3b | PAT の検証と認可コンテキスト(`scopes` `tokenId` `via`)。`record:read` の `requireOperation` を初めて実装 | C2・C3 | L |
| M1-4 | 管理画面の PAT 画面(発行・一覧・失効)。`record:publish` は既定で外し所有者だけが付与 | C3・C5 | M |
| M1-5 | MCP の入口 `/mcp/t/:tenantId`(api 直接オリジン、決定 48)。`server/discover`、405、Origin 検証、ヘッダと本文の照合、エラーの 3 層、PRM、`Mcp-Name` 単位の Rate Limiting | D1・D2・E2・E4・E5 | L |
| M1-6 | 読み取りツールの公開。カタログから `tools/list` を生成、型スキーマを resources で配る、本文の包み方、Markdown の片方向変換 | A3・B2・E1 | M |
| M1-7 | 実クライアントでの検証と公開(Claude Code・Cursor・VS Code・MCP Inspector)。E2E のスモーク、`docs/deploy.md` | — | M |

ゲート G1: preview と production で、外部の MCP クライアントから PAT で接続し、型の参照・一覧・単体取得ができること。
`Mcp-Name` 単位の Rate Limiting が入っていること。

### M2 データと操作の土台

| PR | 内容 | 論点 | 規模 |
| --- | --- | --- | --- |
| M2-1 | 最上位ブロックへの安定 ID 付与(`RICH_TEXT_SCHEMA_VERSION` 2、決定的な導出、エディタの ID 拡張)。決定 46 | A1 | M |
| M2-2 | Markdown ⇄ AST の双方向変換と忠実度テスト(`@tiptap/markdown`)。M1-6 の片方向変換を置き換える | A1・A4 | M |
| M2-3a | 変更履歴の表と `writeRecord` での記録(区切り規則、actor / via、保持と差分圧縮)。決定 41 | A2・C4 | L |
| M2-3b | publish と delete の履歴の記録点 | A2 | M |
| M2-4 | 履歴の操作(`record_history` / `record_compare` / `record_restore`)をカタログに追加 | A2・D3 | M |
| M2-5 | 管理画面の履歴画面 | A2・C4 | M |
| M2-6 | 競合判定のモード(`resolveSyncWrite` に判定モード、エージェント経路は strict)。決定 42 | B3 ① | S |
| M2-7a | 書き込み操作のカタログ移設(create / update / delete / publish / unpublish)。create はクライアント指定 UUIDv7 で冪等 | B1・E3 | L |
| M2-7b | REST の `PUT /records/...` を `baseFieldVersions` 必須にする | B1・B3 | S |
| M2-8 | 型とフィールドの description、型単位の執筆ガイド欄 | A3 | M |
| M2-9 | 下書きを含む全文検索(DO-SQLite FTS5)と `record_search`。決定 43 | A4 | M |

ゲート G2: 全書き込み操作がカタログ経由になり、同期・REST・publish・delete のいずれでも履歴が記録され、管理画面から復元できること。

### M3 OAuth の認証基盤(決定 47〜49 を前提にした分割)

| PR | 内容 | 論点 | 規模 |
| --- | --- | --- | --- |
| M3-1 | 認可サーバー(`@cloudflare/workers-oauth-provider` 分割 API、api Worker)。テナント別 issuer、`OAUTH_KV` と `global_fetch_strictly_public` を 3 環境分、CIMD 優先・DCR fallback、admin の転送接頭辞に `/oauth` と `/.well-known/oauth-authorization-server`、M1-5 の PRM に `authorization_servers` | C1 | L |
| M3-2 | 同意画面(api が HTML を描画)。`/login` に `return_to`、Turnstile 付きログインを経て `/authorize` に戻る。会員でなければ進ませない。`record:publish` は既定で外し所有者だけ | C3・C5・D1 | M |
| M3-3 | リソースサーバー側の検証。`validateToken` で OAuth を PAT と同じ判定に合流、`insufficient_scope` の step-up、スコープの階層 | C2・C3・E2 | M |
| M3-4 | access token の TTL 15 分、refresh 時のロール読み直し(`tokenExchangeCallback`)、`purgeExpiredData` を日次 cron に | C3 | S |
| M3-5 | 管理画面の「接続中のアプリ」画面(OAuth の付与と PAT を 1 つの一覧に) | C1・C4 | M |

ゲート G3: preview で、CIMD で接続するクライアントと DCR fallback で接続するクライアントをそれぞれ 1 つ以上確認し、スコープ不足から step-up できること。

### M4 書き込み MCP の公開

| PR | 内容 | 論点 | 規模 |
| --- | --- | --- | --- |
| M4-1 | record の書き込みツール(create / update / delete)。update はブロック単位の部分編集、outputSchema は成功形と競合形の oneOf、`attempt` の自己申告 | B3 ②③・D3・E3 | L |
| M4-2 | publish / unpublish / compare ツール。同じ利用者への確認は MRTR の elicitation。PAT 接続向けには `error_description` とツール説明に所有者が `record:publish` 付き PAT を発行する導線 | B2・C5 | M |
| M4-3 | 履歴ツール(history / restore)の公開 | A2・D3 | S |
| M4-4 | アセット登録(使い切りのアップロードトークン) | D3 | M |
| M4-5 | URL からのアセット取り込み(SSRF 対策) | D3 | M |
| M4-6 | 公開前の仕上げ(E2E、/security-review、DO の rows written / read の計測、接続ガイド) | E1〜E4 | M |

ゲート G4: 書き込み・競合・スコープ不足の E2E、/security-review の指摘の解消、ツールごとの DO 計測が基準内。

### M5 拡張(M4 の実利用を見てから順番を決める)

提案(change set)、ブロック単位の競合判定、モジュールの MCP ツール、公開側 MCP、型ごとのツール、意味検索、
サービスアカウント、型単位のスコープ。各項目は別の詳細計画になる規模。

## 3. 依存関係

書き込み MCP 公開までの最長経路は M0-2 → M2-1 → M2-2 → M4-1(リッチテキストの系列)。M4 は M3 を待たない。

| PR | 待つ PR | 理由 |
| --- | --- | --- |
| M1-4 | M1-3a | 発行・失効 API を使う |
| M1-3b | M1-3a | 表を検証する |
| M1-5 | M1-3b | 入口の認証に PAT の検証を使う |
| M1-6 | M1-1・M1-2・M1-5 | カタログ・一覧 RPC・入口の上にツールを出す |
| M2-3b | M2-3a | 履歴の表を使う |
| M2-4・M2-6・M2-7a・M2-8・M2-9 | M1-1 | 操作と経路の列挙をカタログに足す |
| M2-7a | M2-6 | 書き込み操作が経路ごとの判定モードを使う |
| M2-7b | M2-7a | カタログに移した update を REST から呼ぶ |
| M2-9 | M2-2 | プレーンテキスト抽出を共有する |
| M3-2 | M3-1 | 認可サーバーの同意フローに載せる |
| M3-3 | M1-3b・M1-5 | PAT と同じ判定に合流させる |
| M4-1 | M2-1・M2-2・M2-7a・M1-3b | ブロック単位の編集と冪等な書き込みがあり、PAT で認可できればよい |
| M4-2 | M2-7a・M1-4 | publish 操作と、所有者が `record:publish` を付与する PAT 画面を使う |
| M4-3 | M2-4 | 履歴の操作をそのまま出す |
| M5 の提案 | M2-3a・M4-2 | 差分の表示に履歴を使い、publish 確認の代替先になる |
| M5 のブロック単位の競合判定 | M2-1 | ブロック ID が確定している必要がある |

## 4. 未決事項と決める時期

| 未決事項 | 仮置き | 決める場所 | 状態 |
| --- | --- | --- | --- |
| リッチテキストの形式(A1) | — | M0-2 | **決定 46** |
| 認可サーバーの方式と置き場(C1) | — | M0-3 | **決定 47** |
| PAT の検証経路(C1 ④) | — | M0-3 | **決定 49** |
| MCP エンドポイントのオリジン(D2) | — | M0-3 | **決定 48** |
| 変更履歴の保持本数・期間、区切り | — | M0-1 | **決定 41**(仮置き、M2-3a で実測) |
| DO 側の一覧でフィルタできるフィールドの範囲 | 索引宣言済み + システム列 | M1-2 | 未決 |
| PAT の有効期限の上限 | 書き込みスコープ付きは短くする | M1-3a | 未決(M1 計画の仮置き: 読み取りのみ 365 日、書き込み付き 90 日) |
| 旧版プロトコルのクライアントへの対応 | 2026-07-28 のみ | M1-5 | 未決 |
| 同意画面の実装形(api の HTML か admin の SPA 経路か) | api の HTML | M3-2 | 未決(M0-3 結果 4 節) |
| エージェント経路の競合判定の既定(B3 ①) | strict | M2-6 | **決定 42** |
| 再適用回数の数え方(B3 ③) | `attempt` 引数の自己申告 | M4-1 | 未決 |
| publish ツールの出し方 | 常に出して 403 step-up | M4-2 | 未決 |
| elicitation 非対応クライアントの publish(C5) | B4 までは拒否して人に回す | M4-2 | 未決 |
| 型単位のスコープ(C3) | 初期は採らない | M5 | 未決 |
| ブロック単位の競合判定の方式(B3 ④) | — | M5 | 未決 |
| サービスアカウント(C4)、公開側 MCP の認証(D4)、意味検索(A4) | — | M5 | 未決 |

## 5. リスクと対策

| リスク | 影響 | 対策 |
| --- | --- | --- |
| PAT は長命な bearer トークンで、書き込みも PAT で公開する | 漏えい時の影響が大きい | 有効期限の上限(M1-3a)、発行時のスコープ最小化と publish 既定オフ(M1-4)、失効画面(M1-4・M3-5) |
| 読み取り MCP は公開 API と違って DO を起こす | production での DO のコストと負荷 | `Mcp-Name` 単位の Rate Limiting を G1 の条件にし、一覧の limit に上限を設ける |
| M1-6 の片方向 Markdown 変換が M2-2 で作り直しになる | 小さな手戻り | M1-6 は最小限の変換に留める |
| MCP 仕様の次の改訂や SDK の破壊的変更 | 入口と認可の作り直し | 入口(M1-5)と認可(M3)をカタログから切り離し、バージョンは `catalog:` で固定する |
| 履歴と FTS5 で DO-SQLite の容量と書き込み行数が増える | テナントあたりのコスト増 | 区切り規則・保持上限・差分圧縮を M2-3a に含め、M4-6 で実測する |
| エージェントが本文中の指示に従って意図しない操作をする | 誤編集・誤公開 | E1 の包み方、publish の既定オフ、履歴からの復元の 3 重で受ける |

## 6. 計画ファイルの規約

- 命名: `YYYY-MM-DD-mN-<slug>.md`。試作の結果は `-spike-result`
- フェーズ完了時に本書の当該表に完了日と PR 番号を追記する

| フェーズ | 計画 / 結果ファイル | 状態 |
| --- | --- | --- |
| M0 | `2026-11-01-m0-2-richtext-spike-result.md`、`2026-11-01-m0-3-oauth-spike-result.md` | 完了(2026-11-01) |
| M1 | `2026-11-01-m1-readonly-mcp.md` | 計画済み |
| M2〜M5 | 着手時に作る | — |

## 7. M0 完了時の申し送り(2026-11-01)

- 試作ブランチ `spike/mcp-richtext` と `spike/mcp-oauth` は origin に残し、マージしない。依存を足したのも試作ブランチ内だけ
- M1-5 の MCP サーバーの SDK は `@modelcontextprotocol/server` 2.x(仕様 2026-07-28 対応、stateless Streamable HTTP)+ `@modelcontextprotocol/hono` を第一候補にする。Cloudflare の `agents` は Durable Object にセッションを置く作りで、stateless の方針(16.2)に合わない。版は M1-5 の着手時に `minimumReleaseAge`(7 日)を満たすものを catalog に置く
- 認可サーバーのオブジェクトは要求ごとに組み立てる(構築コストは無視できる)。`resources` が構築時固定であることが設計の根拠なので、ライブラリの更新でこの制約が外れても issuer のパスでテナントを運ぶ形は変えない(URL だけから決まる単純さを優先)
- admin の `/login` に `return_to` が無い。M3-2 で足す(同一オリジンの `/oauth/t/` 配下のみ)
