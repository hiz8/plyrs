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
| M0-4 | 本書と M1 の詳細計画 | — | S | #36 |

ゲート G0(A1 の形式、C1 の方式、PAT の検証経路、D2 の配置が決定ログにある)は決定 46〜49 で満たした。

### M1 読み取り専用 MCP — 詳細計画 `2026-11-01-m1-readonly-mcp.md`

目的は、A1・A2 に依存しない読み取りだけの MCP を先に出し、ツール説明と一覧 API の設計を実利用で確かめること。
ここで作る入口・カタログ・一覧 RPC・PAT は M4 でそのまま使う。

| PR | 内容 | 論点 | 規模 | 状態 |
| --- | --- | --- | --- | --- |
| M1-1 | 操作カタログの骨格と DO の `invoke(op, input)` RPC。最初の操作は `type_list` / `type_get` / `record_get` | B1 | M | 実装済み(2026-11-01、PR #39、スタック PR で順にマージ) |
| M1-2 | DO の一覧 RPC(`record_list`)。文法は `public/query.ts` を共有し、`records.data` に対する実行器を新設 | A4 | M | 実装済み(2026-11-01、PR #40、スタック PR で順にマージ) |
| M1-3a | PAT の表と発行・失効 API(例外としてスキーマ変更と同じ PR)。`AuditAction` に `token.issue` / `token.revoke` | C1 ④・C2 | M | 実装済み(2026-11-01、PR #41、スタック PR で順にマージ) |
| M1-3b | PAT の検証と認可コンテキスト(`scopes` `tokenId` `tokenKind`)。`record:read` の `requireOperation` を初めて実装 | C2・C3 | L | 実装済み(2026-11-01、PR #42、スタック PR で順にマージ) |
| M1-4 | 管理画面の PAT 画面(発行・一覧・失効)。`record:publish` は既定で外し所有者だけが付与 | C3・C5 | M | 実装済み(2026-11-01、PR #45、スタック PR で順にマージ) |
| M1-5 | MCP の入口 `/mcp/t/:tenantId`(api 直接オリジン、決定 48)。`server/discover`、405、Origin 検証、ヘッダと本文の照合、エラーの 3 層、PRM、`Mcp-Name` 単位の Rate Limiting | D1・D2・E2・E4・E5 | L | 実装済み(2026-11-01、PR #43、スタック PR で順にマージ) |
| M1-6 | 読み取りツールの公開。カタログから `tools/list` を生成、型スキーマを resources で配る、本文の包み方、Markdown の片方向変換 | A3・B2・E1 | M | 実装済み(2026-11-01、PR #44、スタック PR で順にマージ) |
| M1-7 | 実クライアントでの検証と公開(Claude Code・Cursor・VS Code・MCP Inspector)。E2E のスモーク、`docs/deploy.md` | — | M | E2E と手順書は実装済み(2026-11-01、PR #46)。所有者が Claude Code から接続して一通りの取得を確認(2026-11-02)。往復時間は preview で実測済み(2026-11-03、7 章)。他クライアントの確認は未了 |

ゲート G1: preview と production で、外部の MCP クライアントから PAT で接続し、型の参照・一覧・単体取得ができること。
`Mcp-Name` 単位の Rate Limiting が入っていること。

### M2 データと操作の土台 — 完了(2026-11-02)、詳細計画 `2026-11-02-m2-data-and-operations.md`

| PR | 内容 | 論点 | 規模 | 状態 |
| --- | --- | --- | --- | --- |
| (計画) | 本書の M2 詳細計画と claude-code-review ワークフローの整形 | — | S | #50 |
| M2-1 | 最上位ブロックへの安定 ID 付与(`RICH_TEXT_SCHEMA_VERSION` を metamodel へ移して 2 に、決定的な導出、エディタの ID 拡張)。エディタへ渡す前に必ず導出を通し、`onCreate` の付与が push を起こさないことを確認する。決定 46 | A1 | M | #51 |
| M2-2 | Markdown ⇄ AST の双方向変換と忠実度テスト(`@tiptap/markdown`)。最初に `marked` と `@tiptap/pm` が workerd 上で動くことを確かめる。M1-6 の片方向変換を置き換える | A1・A4 | M | #52 |
| M2-3a | 変更履歴の表と `writeRecord` での記録(区切り規則、actor / via、保持と差分圧縮)。決定 41 | A2・C4 | L | #53 |
| M2-3b | publish と delete の履歴の記録点 | A2 | M | #54 |
| M2-4 | 履歴の操作(`record_history` / `record_compare` / `record_restore`)をカタログに追加 | A2・D3 | M | #55 |
| M2-5 | 管理画面の履歴画面 | A2・C4 | M | #56 |
| M2-6 | 競合判定のモード(`resolveSyncWrite` に判定モード、エージェント経路は strict)。決定 42 | B3 ① | S | #57 |
| M2-7a | 書き込み操作のカタログ移設(create / update / delete / publish / unpublish)。create はクライアント指定 UUIDv7 で冪等 | B1・E3 | L | #58 |
| M2-7b | REST の `PUT /records/...` を `baseFieldVersions` 必須にする | B1・B3 | S | #59 |
| M2-8 | 型とフィールドの description、型単位の執筆ガイド欄 | A3 | M | #60 |
| M2-9 | 下書きを含む全文検索(DO-SQLite FTS5)と `record_search`。決定 43 | A4 | M | #61 |
| (仕上げ) | ブランチ全体レビューの Important 4 件の修正と本書の更新 | — | M | #62 |

ゲート G2(全書き込み操作がカタログ経由になり、同期・REST・publish・delete のいずれでも履歴が記録され、管理画面から復元できること)は M2-4 / M2-5 / M2-7b で満たした。書き込み操作の MCP 公開(tools/list への掲出)は M4-1。

### M3 OAuth の認証基盤(決定 47〜49 を前提にした分割)— 完了(2026-11-03)、詳細計画 `2026-11-03-m3-oauth.md`

| PR | 内容 | 論点 | 規模 | 状態 |
| --- | --- | --- | --- | --- |
| M3-1 | 認可サーバー(`@cloudflare/workers-oauth-provider` 分割 API、api Worker)。テナント別 issuer、`OAUTH_KV` と `global_fetch_strictly_public` を 3 環境分、CIMD 優先・DCR fallback、admin の転送接頭辞に `/oauth` と `/.well-known/oauth-authorization-server`、M1-5 の PRM に `authorization_servers` | C1 | L | 実装済み(2026-11-03、PR #65、スタック PR で順にマージ) |
| M3-2 | 同意画面(api が HTML を描画)。`/login` に `return_to`、Turnstile 付きログインを経て `/authorize` に戻る。会員でなければ進ませない。`record:publish` は既定で外し所有者だけ | C3・C5・D1 | M | 実装済み(2026-11-03、PR #66) |
| M3-3 | リソースサーバー側の検証。`validateToken` で OAuth を PAT と同じ判定に合流、`insufficient_scope` の step-up(スコープに階層は設けない。16.3) | C2・C3・E2 | M | 実装済み(2026-11-03、PR #67) |
| M3-4 | access token の TTL 15 分、refresh 時のロール読み直し(`tokenExchangeCallback`)、`purgeExpiredData` を日次 cron に | C3 | S | 実装済み(2026-11-03、PR #68) |
| M3-5 | 管理画面の「接続中のアプリ」画面(OAuth の付与と PAT を 1 つの一覧に) | C1・C4 | M | 実装済み(2026-11-03、PR #69) |
| 仕上げ | E2E `oauth.spec.ts`、`docs/deploy.md` 3.5 の OAuth の手順、ブランチ全体のレビュー、本書の更新 | — | S | 実装済み(2026-11-03、PR #70) |

ゲート G3: preview で、CIMD で接続するクライアントと DCR fallback で接続するクライアントをそれぞれ 1 つ以上確認し、スコープ不足から step-up できること(確認項目は `docs/deploy.md` 3.5)。**通過(2026-11-03)**: CIMD(claude.ai のコネクタ)・step-up・失効を所有者が preview で確認(10 章)。DCR は E2E(dev)で固定済みで、preview での MCP Inspector 接続は任意として残す。

### M4 書き込み MCP の公開 — 詳細計画 `2026-11-03-m4-write-mcp.md`

| PR | 内容 | 論点 | 規模 |
| --- | --- | --- | --- |
| M4-1 | record の書き込みツール(create / update / delete)。update はブロック単位の部分編集、outputSchema は成功形と競合形の oneOf、`attempt` の自己申告(#77 M4-1a、#78 M4-1b) | B3 ②③・D3・E3 | L |
| M4-2 | publish / unpublish / compare ツール。同じ利用者への確認は MRTR の elicitation。PAT 接続向けには `error_description` とツール説明に所有者が `record:publish` 付き PAT を発行する導線(#80、決定 50) | B2・C5 | M |
| M4-3 | 履歴ツール(history / restore)の公開(#79) | A2・D3 | S |
| M4-4 | アセット登録(使い切りのアップロードトークン)(#81、決定 51) | D3 | M |
| M4-5 | URL からのアセット取り込み(SSRF 対策)(#82、決定 52) | D3 | M |
| M4-6 | 公開前の仕上げ(E2E、/security-review、DO の rows written / read の計測(書き込み 1 回の rows read が record 数に比例しないことを含む)、接続ガイド)(#83。M4-0a の CI 検査は #75、M3 の見送り指摘は #76) | E1〜E4 | M |

ゲート G4: 書き込み・競合・スコープ不足の E2E、/security-review の指摘の解消、ツールごとの DO 計測が基準内。

### M5 拡張(M4 の実利用を見てから順番を決める)

提案(change set)、ブロック単位の競合判定、モジュールの MCP ツール、公開側 MCP、型ごとのツール、意味検索、
サービスアカウント、型単位のスコープ。各項目は別の詳細計画になる規模。

拡張に入る前に、最初の計画 M5a で M4 の申し送り(11 章)を片付ける。拡張の各項目は M5b 以降の計画で扱う。

#### M5a M4 の申し送りの整理 — 詳細計画 `2026-11-04-m5a-carryovers.md`

| PR | 内容 | 論点 | 規模 |
| --- | --- | --- | --- |
| M5a-1 | リッチテキストの逆差分を最上位ブロック単位にする(決定 53) | A2 | M |
| M5a-2 | unique のフィールドに重複検査用の索引を自動で作る(決定 54。所有者の判断で自動作成に決定、2026-11-04) | — | M |
| M5a-3 | MCP で作ったアセットの履歴に経路と tokenId を残す(`asset_upload_tokens.token_kind`) | C4 | S |
| M5a-4 | アップロードの受け取りで発行に使ったトークンの失効とロールの降格を見る | C3 | S |
| M5a-5 | PAT のスコープ不足をツールの業務エラーにして対処を示す(決定 55) | C3・E2 | S |
| M5a-6 | G4 の小さな不具合(取り込みの User-Agent、確認の `default: true`、エンベロープ入力の検査)、/security-review、申し送り | E1・C5 | S |

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
| 変更履歴の保持本数・期間、区切り | — | M0-1 | **決定 41**(M2-3a で実装。本数・期間の妥当性は M4-6 で実測) |
| DO 側の一覧でフィルタできるフィールドの範囲 | 索引宣言済み + システム列 | M1-2 | 未決 |
| PAT の有効期限の上限 | 書き込みスコープ付きは短くする | M1-3a | 未決(M1 計画の仮置き: 読み取りのみ 365 日、書き込み付き 90 日) |
| 旧版プロトコルのクライアントへの対応(廃止済みの `initialize` / `notifications/initialized` を送るクライアントに何を返すか) | 2026-07-28 のみ | M1-5 | 未決 |
| 同意画面の実装形(api の HTML か admin の SPA 経路か) | api の HTML | M3-2 | **決定済み(2026-11-03)**: api が `hono/html` で描画(M3-2、`apps/api/src/oauth/consent-page.ts`)。管理画面の見た目に揃えたくなったら SPA 経路に移せる |
| エージェント経路の競合判定の既定(B3 ①) | strict | M2-6 | **決定 42** |
| 再適用回数の数え方(B3 ③) | `attempt` 引数の自己申告 | M4-1 | **決定済み(2026-11-03)**: `attempt`(1〜3)の自己申告。3 回目の conflict は `giveUp`(M4-1b) |
| publish ツールの出し方 | 常に出して 403 step-up | M4-2 | **決定済み(2026-11-03)**: 常に出して 403 step-up(design-spec 16.8) |
| elicitation 非対応クライアントの publish(C5) | B4 までは拒否して人に回す | M4-2 | **決定 50**(所有者の判断、拒否して人に回す) |
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
| M1 | `2026-11-01-m1-readonly-mcp.md` | 完了(2026-11-02) |
| M2 | `2026-11-02-m2-data-and-operations.md` | 完了(2026-11-02) |
| M3 | `2026-11-03-m3-oauth.md` | 完了(2026-11-03)。ゲート G3 通過 |
| M4 | `2026-11-03-m4-write-mcp.md` | 実装完了(2026-11-03)。ゲート G4 は preview での所有者の確認待ち |
| M5 | `2026-11-04-m5a-carryovers.md`(M5a。M5b 以降は着手時に作る) | M5a 計画中(2026-11-04) |

## 7. M1 完了時の申し送り(2026-11-01)

- PR は #39 → #40 → #41 → #42 → #43 → #44 → #45 → #46 のスタック(base が前の PR)。順にマージする
- **実クライアント確認(2026-11-02)**: #46 までを `main` にマージした後、所有者がローカルの Claude Code から PAT で接続し、型の参照・一覧・単体取得まで一通りのデータを取得できることを確認した(ゲート G1 の接続条件は満たした)。接続先の環境(preview / production)と往復時間は記録していない
- **往復時間の実測(2026-11-03、preview)**: 所有者が `docs/deploy.md` 3.5 節の手順(curl、PAT、5 回ずつ)で測った。`tools/list` 0.354 / 0.250 / 0.646 / 0.499 / 0.581 秒、`record_get` 0.398 / 0.207 / 0.397 / 0.414 / 0.231 秒(いずれも接続の確立を含む全体時間)。`record_get`(DO 往復 2 回)が `tools/list`(DO 往復 1 回)より遅くはないので、`type_get` を DO 側で同梱する見直しは不要とする。`MCP_IP_LIMITER`(600 回 / 60 秒)もこの実測では変えない
- **未了**: Cursor / VS Code / MCP Inspector からの接続確認(手順は所有者に渡し済み。結果が届き次第ここに追記する)。production は `workflow_dispatch` 後に MCP Inspector でスモーク
- M1-6 の Markdown 変換(`apps/api/src/mcp/richtext-markdown.ts`)は ui のエディタの拡張集合を api 側に最小複製していた。**M2-2 で `@plyrs/richtext` に移し**、逆方向(Markdown → JSON)とスキーマ検証を足した。独自ノードの Markdown は M0-2 の仮置きをそのまま確定(design-spec 16.10)
- `@tiptap/markdown` は peer を完全一致で要求するため catalog で `3.31.4` に固定。tiptap を上げるときは同時に上げる
- `tools/list` の `ttlMs` / `cacheScope` は SDK(`@modelcontextprotocol/server` 2.4.0)が一覧全体に 1 つしか持てないため、各操作の `cache` のうち最も保守的な値(現状 0 / private)。`resources/read`(`plyrs://types/{key}`)は `type_get` の 60 秒
- MCP の入口の Rate Limiting は 2 段: トークン検証の前に接続元 IP 単位(`MCP_IP_LIMITER`、600 回 / 60 秒。未認証の連打で D1 の PAT 照会を起こさないため)、検証の後にテナント・利用者・ツール名単位(`MCP_LIMITER`、60 回 / 60 秒。DO を起こす経路の保護)。IP 単位の上限は NAT 配下の複数利用者を想定して緩めにしてあり、実測で見直す
- `@modelcontextprotocol/hono` は使わず、`createMcpHandler` を要求ごとに直接呼ぶ(ヘッダと本文の照合とレート制限を SDK より前に置くため)。dev の E2E は admin の `DEV_PROXY_PUBLIC=1` で `/mcp` を api へ転送する(本番は転送しない)
- `record_get` の `markdown` は Worker 層で付け、richtext フィールドの判定のため `type_get` をもう 1 回 DO に呼ぶ(record_get 1 回あたり DO 往復 2 回)。往復時間の実測で問題なら DO 側で型を同梱する
- 入力の Zod 不一致は SDK の `inputSchema` 検証が先に `isError`(text のみ)で返す。DO の `invalid_input` は MCP 経路では到達しない

## 8. M0 完了時の申し送り(2026-11-01)

- 試作ブランチ `spike/mcp-richtext` と `spike/mcp-oauth` は origin に残し、マージしない。依存を足したのも試作ブランチ内だけ
- M1-5 の MCP サーバーの SDK は `@modelcontextprotocol/server` 2.x(仕様 2026-07-28 対応、stateless Streamable HTTP)+ `@modelcontextprotocol/hono` を第一候補にする。Cloudflare の `agents` は Durable Object にセッションを置く作りで、stateless の方針(16.2)に合わない。版は M1-5 の着手時に `minimumReleaseAge`(7 日)を満たすものを catalog に置く
- 認可サーバーのオブジェクトは要求ごとに組み立てる(構築コストは無視できる)。`resources` が構築時固定であることが設計の根拠なので、ライブラリの更新でこの制約が外れても issuer のパスでテナントを運ぶ形は変えない(URL だけから決まる単純さを優先)
- admin の `/login` に `return_to` が無い。M3-2 で足す(同一オリジンの `/oauth/t/` 配下のみ)

## 9. M2 完了時の申し送り(2026-11-02)

- PR は #50 → #51 → … → #61 → #62 のスタック(base が前の PR)。順にマージする。#62 はブランチ全体レビュー(別の視点)の Important 4 件の修正で、対象は M2-1(エディタの再描画)・M2-7a(status の strict 判定)・M2-9(起動時再索引の分割)にまたがる。各 PR 単体では該当の指摘が未修正のまま見える
- **履歴の data は input 形式**(relations を統合した、同期の `input` と同じ形)。`record_restore` がそのまま書き戻せ、`record_compare` が同期の表現と一致するため。公開版の疑似行は `published_snapshots` から `buildSyncInput` で組み立てる
- **履歴の畳み込みの起点は版の `created_at`**(直前の書き込みからではなく、版が始まってから 15 分)。publish / unpublish の版は常に区切れ、全文で残り、prune されない。保持本数(100)・期間(365 日)・全文で持つ本数(10)の妥当性は M4-6 で実測する
- **`record_update` の strict 判定**: `changedFields` の各フィールドで `baseFieldVersions` が現在と違えば conflict(欠けは 0)。加えて `status` を変える更新は `baseFieldVersions` が現在の `fieldVersions` 全体と一致することを要求する(16.6 に追記)。`changedFields: []` で判定を抜けても何も書かれない
- **REST の応答形の変更(破壊的、16.4)**: `PUT /records/:type/:id` は既存 record の更新で `baseFieldVersions` 必須(新規作成は不要)。応答は `{ ok, record }`(`changedFields` / `applied` は無くなった)。publish は `{ ok, snapshot: { recordId, sourceVersion, publishedAt } }`。未公開の unpublish は 409 ではなく 200(`sourceVersion: null`)。リポジトリ内の消費者は無い。PUT は `getRecord` → `invoke` の 2 RPC で、間に同期 push が割り込むと `already_exists`(安全側)
- **書き込み操作は `via: ["rest"]`**のまま(tools/list に出ない)。M4-1 で `"mcp"` を足すとき、MCP 入口(`apps/api/src/mcp/server.ts` の `invoke`)は `options.tenantSlug` を渡していないので `record_publish` が「tenant slug is required」で失敗する。M4-1 の最初に直す。`record_update` の `attempt` 引数と conflict 形の `outputSchema` oneOf も M4-1
- **Markdown → AST の事前検出**(`packages/richtext/src/markdown.ts`)は marked の lexer のトークン走査(table / task 付き list_item / `plyrs://asset/` 以外の image、入れ子も再帰)で `unsupported_markdown` にする(#52 のレビューで正規表現から置き換え。省略形の GFM 表も拾い、コードフェンス内では発火しない)。`AssetImage.parseMarkdown` に届いた外部 URL は `UnsupportedMarkdownError` で業務エラーになる
- **空の many-relation `[]`** は保存で relations 行が無くなり `buildSyncInput` がキーを出さないため、`record_create` の冪等比較で `already_exists`、`record_compare` で「`[]` → 未設定」と揺れる。正規化で空配列を落とすか `buildSyncInput` が `[]` を返すかを M4-1 で決める
- **全文検索**: tokenizer は trigram。3 文字以上の語は MATCH、2 文字以下の語を含む問い合わせは LIKE(全走査、limit 付き)。LIKE 経路の snippet は最初の語だけを括る。既存テナントの索引は DO 起動時に 1 歩(200 件)だけ入れ、続きは alarm `search_reindex` で回す。super の `POST /super/v1/tenants/:tenantId/search-reindex` も同じ分割(応答の `done` が false なら続きは alarm)。FTS5 の仮想テーブルは drizzle のスキーマで表せないため `0008_records_fts.sql` だけ手書き(CLAUDE.md に明記)。**FTS の行は `rowid` を `records.rowid` に揃え、張り直し・削除は `rowid` で引く**(UNINDEXED 列の `record_id` で DELETE すると内容表の全走査になり、書き込み 1 回の rows read が record 数に比例する。#61 のレビューで修正)。書き込みごとの行コスト(履歴の UPDATE + FTS の DELETE/INSERT)は **rows written と rows read の両方**を M4-6 で実測する(同種の全走査は rows read 側にしか現れない)。`recordHistory` の prune は毎 INSERT で全履歴行を SELECT しており、COUNT + `updated_at <` に絞れる
- **エディタ**: v1 の本文を開くと最上位ブロックの ID は導出、入れ子は UniqueID が付ける。差し替え判定は最上位以外の `attrs.id` と末尾の空段落(StarterKit の TrailingNode)を無視する。保存値には TrailingNode の段落は入らない
- **履歴画面の復元**は応答後に同期で版が届くのを最長 3 秒待って編集画面へ戻る。応答の snapshot で collection を直接 upsert すれば待ちが要らない(見送り)
- **M1 の未了**(往復時間の実測、Cursor / VS Code / MCP Inspector からの接続確認)は引き続き未了。デプロイ環境が要る(往復時間は 2026-11-03 に preview で実測した。7 章)

## 10. M3 完了時の申し送り(2026-11-03)

- PR は #64 → #65 → #66 → #67 → #68 → #69 → #70 のスタック(base が前の PR)。順にマージする。#70 はブランチ全体レビュー(Critical 0・Important 3・Minor 13)の Important 3 件 + Minor 4 件の修正と E2E・手順書・本書。各 PR 単体では該当の指摘が未修正のまま見える
- **レビューで見送った指摘(M4 以降)**: (a) 同意 POST で handle の保存済み要求が URL の tenantId 向けか(`request.resource` / `issuer`)を照合していない(B の会員が A の handle を B に POST すると B の resource のコードが A の iss で出る。権限昇格ではない)。(b) `parseAuthRequest`(CIMD の外向き fetch)をセッション確認より前に呼ぶ(入口の IP 制限で緩和)。(c) refresh 時の D1 / KV の一時障害を `temporarily_unavailable` に包んでいない(500 になる)。`isMembershipBlocked` も refresh では見ない(入口で 403)。(d) `listUserGrants(userId, { limit: 100 })` は利用者の全テナント合計 100 件を取ってから resource で絞るので、他テナントで付与の多い利用者ではこのテナントの付与が落ちうる。(e) 会員解除・BAN で OAuth の付与を失効させない(access token は BLOCKLIST、refresh は invalid_grant で止まるが、KV に最長 30 日残り所有者の画面には出ない)。(f) AS metadata と PRM の `app.get` が OPTIONS を受けない(ブラウザ内クライアントの preflight)。(g) セッション cookie が `SameSite=Strict` なので、ホスト型クライアントからの `/authorize` 遷移はログイン済みでも毎回 `/login` を経由する(流れ自体は通る)。(h) 認可コード未交換(TTL 600 秒)の付与も「接続中」に並ぶ。(i) `insufficientScope` の日本語の description は `WWW-Authenticate` ヘッダからは落ちる(本文 JSON には残る)
- **ゲート G3 の preview 確認(2026-11-03、所有者)**: claude.ai のカスタムコネクタ(認証「今すぐサインイン」、OAuth クライアント「Claude の公開アイデンティティ」= CIMD、トランスポート Streamable HTTP)でログイン → 同意画面 → 接続が完了し、`tools/list` を取得できた。`record:write` だけで承認した付与で型の一覧を呼ぶとスコープ不足で止まり、`record:read` を含めて再認可すると通った(step-up)。設定 › 接続中のアプリ に claude.ai の付与が並び、失効すると claude.ai の呼び出しが認証エラーになった。DCR のクライアント(MCP Inspector)の preview 接続は未実施(E2E `oauth.spec.ts` が dev で DCR・step-up・失効を固定している。CIMD は `global_fetch_strictly_public` のためローカルでは試せない)
- **claude.ai はコネクタを削除しても refresh token を残す**: 「マイコネクタ」から削除して再登録すると `/authorize` を通らず `/token` の refresh で繋ぎ直すため、同意画面が出ない。同意画面を出し直すには plyrs 側で付与を失効する(失効すると refresh が `invalid_grant` になり認可からやり直す)。書き込みツールは M4 まで無いので、`record:write` を付けても claude.ai は書き換えを断るだけで、サーバー側の 403 には到達しない
- **#70 のマージ時に preview のデプロイが失敗していた(PR #72 で修正)**: `consent.ts` がモジュールのトップレベルで `Response` を組み立てており、api のアップロードが検証エラー 10021(global scope での Disallowed operation)で止まり admin もデプロイされなかった。vitest(workerd)も dev サーバーもモジュールを要求の中で読み込むため CI では再現しない。**再発防止の候補(所有者の提案)**: `wrangler deploy --dry-run --env preview --outdir <dir>` でバンドルし、最小構成の設定で `wrangler dev --no-bundle` を起動してトップレベルのエラーが出ないか見る手順を CI の check ジョブに足す(ネットワーク不要、数十秒)。M4 の着手時に入れる
- **issuer と resource は vars から組む**: issuer `${ADMIN_ORIGIN}/oauth/t/:tenantId`、resource `${API_ORIGIN}/mcp/t/:tenantId`。MCP の入口は要求の URL から resource を作り、`API_ORIGIN` のそれと違えば OAuth の token は 401。dev と E2E は api の `.dev.vars` に `ADMIN_ORIGIN` / `API_ORIGIN` を書く(`apps/api/.dev.vars.example`。E2E は `global-setup.ts` が未作成時に 5199 で書く)
- **OAuth の tokenId はグラント ID**(access token `userId:grantId:secret` の 2 要素目)。失効の単位と監査ログの targetId はこれ。PAT の tokenId(PAT の行 ID)と同じ `McpAuth.tokenId` に入る
- **ロールの反映は refresh 単位**: access token は 15 分、グラントの props の `role` は同意時に固定し、refresh で `memberships` から読み直す(無ければ `invalid_grant` で付与ごと失効)。ロール変更・会員解除は最長 15 分、BAN は入口の BLOCKLIST で即時
- **スコープ判定の場所**: `tools/call` の要するスコープ(カタログの `requires`)は MCP の入口(`mcp/route.ts`)で DO を起こす前に 403 にする。DO 内の判定(`authorize.ts`)はそのまま二重に残る。`resources/read` と `prompts/get` は `record:read` 前提で、入口では見ない(DO 内で判定)
- **付与の一覧はテナントの会員ごとに `listUserGrants`**(会員 50 人 × 100 件まで)。会員が多いテナントでは遅くなる。ライブラリに「resource ごとの一覧」が無いため。M5 で件数が問題になったら、付与時に D1 へ索引行を書く
- **編集者は自分の付与を失効できない**(一覧・失効とも `member:manage`)。PAT と同じ運用。自分の付与だけ失効できる経路は M5 の候補
- **同意画面は api の HTML**(`hono/html`、管理画面のスタイルは使わない)。文言は `consent-page.ts` に直書き(admin の `TOKEN_LABELS` と同じ文を写している。片方を変えたらもう片方も)
- **E2E の E2E 間干渉**: `oauth.spec.ts` は page(未ログイン)と request(API 用)の cookie を分けている。`page.request` を使うと page がログイン済みになり、return_to の経路が通らない
- **M1 の未了**: Cursor / VS Code / MCP Inspector からの PAT 接続確認(手順は所有者に渡し済み)

## 11. M4 完了時の申し送り(2026-11-03)

- **書き込みツールの一式**: `record_create` / `record_update` / `record_delete` / `record_restore` / `record_publish` / `record_unpublish` / `asset_upload` / `asset_import_url`。接続ガイドは `docs/deploy.md` 3.6。`tools/list` はスコープで絞らない(E2E の mcp-smoke も先頭の読み取りツールだけを固定する形にした)
- **publish の確認(決定 50)**: elicitation を宣言しないクライアントは `confirmation_unavailable`。緩めるのは `apps/api/src/mcp/confirm.ts` の 1 か所。M5 の提案(change set)ができたら、確認できないクライアントの publish を提案に回す案がある
- **Worker で実行する操作(`runsIn: "worker"`)**: SHA-256・外部 fetch・R2 が要る操作は DO の同期ハンドラを持たず、`apps/api/src/mcp/worker-ops.ts` で実行する。判定の順序(スコープ → ロール → 入力)は DO の `runOperation` と同じ。REST には出していない
- **DO の計測(M4-6)**: `invoke` の結果に `meter = { rowsRead, rowsWritten }`、Worker はログ `mcp.op` を出す。実測で 2 件の比例を見つけて直した。(1) 一意性検査が `json_extract` で型の record を全件走査していた(300 件で create の rows read 311)。indexed のフィールドは生成カラムの部分インデックスで引くようにした。**indexed でない unique は今も全件走査**なので、unique を付けるフィールドは indexed も付けるのが望ましい(管理画面で強制するかは未決)。**M5a-2 で解消**: unique のフィールドは indexed でなくても引き当て用の生成カラムを持つ(決定 54。既存テナントには alarm で足す)。(2) 一覧の既定の並びにインデックス `idx_records_type_updated` を足した(マイグレーション 0010)。数字は報告書 `m4-report.md`
- **履歴の保持(決定 41)は変えない**: 5000 文字の記事を 15 分超の間隔で 300 回編集し 20 回 publish した実測で、版は 113(write 93 + publish 20)、履歴の容量は約 1.3 MB(DO の増分 1.4 MB)。逆差分はフィールド単位なので、リッチテキストの本文を 1 段落だけ直しても本文全体が差分に入り、圧縮はほとんど役に立たない(差分 1 版あたり約 11.7 KB、全文 1 版あたり約 12.8 KB)。容量を減らすならブロック単位の逆差分が次の手(M5 以降の候補)
- **アップロードトークンの残る隙**: 受け取り時に BLOCKLIST の 2 キーは見るが、発行に使ったトークン(PAT / OAuth)の失効とロールの降格は見ない(最長 10 分・1 回・画像だけ)。/security-review では悪用可能性なしと判断した。**M5a-4 で解消**: 受け取りで発行に使ったトークンの有効性と今のロールを引き直す(失効・期限切れ・会員でなければ 403 `token_revoked`、viewer への降格は 403 `forbidden`)
- **全体レビューで直したもの**: アップロード URL は D1 にあるテナントだけ DO を起こす(未認証の入口で任意の tenantId の DO を作らせない)。REST の応答から `meter` を外す。ブロックの挿入で導出 ID が既存のブロックの ID を奪わない(`ensureTopLevelBlockIds` が保存済みの ID を先に押さえる)。publish の確認に record の版と最新の `history_seq` を入れ、DO が公開と同じトランザクションの中で照合する(承諾までの更新や、公開 → 取り下げの後の確認の使い回しは `record_changed`。所有者のレビューで照合を DO の中に移した)。所有者のレビューでほかに 2 件を直した: リッチテキストのリンクの scheme を書き込み時に検査する(`javascript:` などを拒否。許可リストは管理画面のエディタに揃え、今の値に無かったリンクだけを見る)、URL 取り込みの host の末尾ドットをすべて外してから検査する
- **リンク検査の残り**: JSON 入力は ProseMirror のスキーマ検証を通らないので、語彙に無いノードの `attrs` に入れた URL は見ていない(既知の語彙に URL を持つノードは無い)。JSON 入力にも `checkRichText` を通すと閉じる
- **全体レビューで見送ったもの**: (1) 一意性検査を生成カラムで引くようにしたので、比較が列の型の affinity に従う(`json_extract` のときより厳しくなる場合がある。たとえば数値と数字の文字列)。実害の報告は無いので記録だけ。(2) アップロードの受け取りは `tokenId` を使っておらず、アセットの履歴の経路は常に `rest` になる。M5 の監査の整理で揃える(**M5a-3 で解消**: MCP の 2 経路は via `mcp` と tokenId を記録する)
- **ゲート G4**: `docs/deploy.md` 3.6 の手順で所有者が preview で確かめる。結果はここに追記する
- **G4 の確認結果(2026-11-04、preview、Claude Code)**: 手順 1〜5 を一通り行った。公開し直し(下の 3)だけクライアントの不具合で保留
  1. PAT は `record:publish` なし → ありの順に差し替えた(差し替えは `/mcp` の再接続で反映)
  2. `record_create` で Markdown から作成 → 段落 1 つをブロック操作で replace → 管理画面でタイトルを直す → 古い `baseFieldVersions` で更新して `conflict`(`title` だけ)→ `record_get` で読み直して `attempt: 2` で通った。管理画面でタイトルだけを保存しても `body` の版は上がらない
  3. `record:publish` の無い PAT は `Insufficient scope: required "record:publish"`。ある PAT では確認が出て、承諾すると公開された。拒否は `declined`。2 回目の公開し直しでは、Claude Code のフォームで boolean の `confirm` 欄が Space で切り替わらず、Accept しても `declined` になった(Claude Code 側の不具合とみる)。`confirmation_unavailable` は Claude Code が elicitation に対応しているので未確認
  4. `asset_import_url`(Google のロゴ、PNG 13,504 バイト)と `asset_upload` → POST(64×64 の PNG、HTTP 201)を行い、本文に `plyrs://asset/…` で入れて管理画面で表示されることを確かめた
  5. `mcp.op` の計測(新規の record、本文は 4〜8 ブロック):

     | op | ok | rowsRead | rowsWritten | ms |
     |---|---|---|---|---|
     | `record_create` | true | 8 | 10 | 344 |
     | `record_update`(ブロック replace) | true | 14 | 7 | 53 |
     | `record_update` | `conflict` | 5 | 0 | 30 |
     | `record_get` | true | 2 | 0 | 23 |
     | `record_update`(タイトル) | true | 19 | 9 | 46 |
     | `record_publish` | true | 20 | 9 | 1971 |
     | `asset_import_url` | `fetch_failed` | null | null | 234 |
     | `asset_import_url` | true | null | null | 1031 |
     | `asset_upload` | true | null | null | 30 |
     | `record_update`(画像 2 つを insert) | true | 23 | 19 | 102 |

     スコープ不足と `declined` の publish は `mcp.op` の行が出ない(操作の実行前に止まるため)。基準(M4-6: rows read が record 数に比例しない)は 1 テナントの測定では比例を見られないが、書き込み 1 回の rowsRead は 5〜23 に収まり、M4-6 の実測(10 件と 300 件で一致)と矛盾しない
- **G4 で見つかったこと(未対応)**:
  - ~~旧形式(ブロック ID 無し)の本文の record に初めて書き込むと、本文を変えていなくても `body` の fieldVersion が上がる~~ → 直した。`writeRecordCore` が入力にだけ `ensureRecordBlockIds` を当て、保存済みの ID 無しの値と比べていた。差分を取る前に保存値にも同じ導出を当てる(導出 ID は位置 + 内容で決まるので、内容が同じなら一致する)
  - ~~管理画面のエディタの TrailingNode が足す末尾の空の段落が、本文の保存で一緒に保存される~~ → 直した。エディタの `onUpdate` で、末尾の空の段落の 1 つ前が段落でない(TrailingNode が足す条件)ときだけ外して渡す。段落のあとに利用者が足した空の段落は残す。すでに保存された空の段落は消さない(次に本文を編集したときに外れる)
  - スコープ不足のエラーのメッセージに対処の方法が無い(ツールの説明文にはある)
  - `asset_import_url` が Wikimedia(upload.wikimedia.org)で 403 になる。Worker の fetch に User-Agent が無いためとみられる(未確認)
  - Claude Code の elicitation フォームで boolean の欄を切り替えられないことがある。サーバー側の対策案は `confirmSchema` の `confirm` に `default: true` を付けること(Accept / Decline の選択だけで確認になる。仕様と SDK の扱いは未確認)
  - MCP のブロック操作の replace は、入れ子の段落(箇条書きの項目の中)の `attrs.id` を落とす。契約(決定 44)の外で参照も無いので直さない

