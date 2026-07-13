# 実装ロードマップ（マスタープラン）

> 出典: `docs/design-spec.md`（設計仕様）/ `docs/tech-selection.md`（技術選定）
> 本書はフェーズ分割と依存関係を固定する索引ドキュメントである。各フェーズの着手時に、
> superpowers:writing-plans 形式の詳細計画（TDD・完全なコード付き）を
> `docs/superpowers/plans/` に1ファイルずつ作成する。
> Phase 1 の詳細計画は作成済み: `2026-07-12-phase1-foundation-and-metamodel.md`

---

## 1. 設計ドキュメントのレビュー所見

両ドキュメントは相互に高い整合性を持つ（矛盾は実質ゼロ。ULID 表記は tech-selection 2.10 で
UUIDv7 への読み替えが既に明記済み）。ただし実装時に決定が必要なギャップが6点ある。
各ギャップには暫定方針（デフォルト案)と、確定させるフェーズを割り当てる。

| # | ギャップ | 暫定方針（デフォルト案） | 確定フェーズ |
|---|---------|------------------------|-------------|
| G1 | **content_types のクライアント配布経路が未定義**。仕様 10.1 は「同期対象は records のみ」だが、クライアントは tanstack-db の typed collection 生成と動的フォーム構築のために content_types を必要とする | 同一 WebSocket 上で content_types を **read-only メタコレクション**として配信（records と同じチェックポイント機構に相乗り）。型の作成・変更は WS 同期ではなく専用 API（Hono RPC）経由 | Phase 4 |
| G2 | **同期のブートストラップ / 再接続チェックポイント / 削除が未定義**。仕様 10 章は競合解決を規定するが「切断中に何が変わったか」を知る機構と record 削除の意味論がない | DO 全体で単調増加する `seq` を records に持たせ、クライアントは最終受信 seq をチェックポイントとして再接続時に送る。削除は**トゥームストーン**（`deleted_at` ソフト削除）で同期に載せる。`seq` 列自体は Phase 2 の書き込み経路に先置き | Phase 2（seq 列）/ Phase 4（プロトコル） |
| G3 | **公開 API のテナント解決が未定義**。投影 D1 は共有（tenant_id 列）だが、リクエストからどう tenant を特定するか仕様にない | パスプレフィックス `/v1/t/{tenantSlug}/...`。tenantSlug → tenant_id はコントロールプレーン D1 + KV キャッシュで解決（DO 非経由を維持） | Phase 5 |
| G4 | **slug の投影実カラム化の規約が未定義**。仕様 12.2 の records 投影は `slug` を実カラムに持つが、slug はシステムフィールド（5章）ではなく、どのフィールドを slug とみなすかの規約がない | 規約:「フィールド key が `slug` かつ `unique: true` のフィールド」を投影の slug カラムに昇格（新しい宣言語彙を増やさない） | Phase 5 |
| G5 | **JWT リフレッシュ経路が未定義**。15分 JWT の失効後の再発行フローが仕様にない | httpOnly セッション cookie（D1 セッションが真実源）を提示して短命 JWT を再発行する `/auth/token` エンドポイント | Phase 3 |
| G6 | **モジュールマニフェスト形式が未定義**（仕様 4.2 はバージョン付きマニフェストの存在のみ規定） | モジュール実装フェーズで形式設計（型定義配列 + 権限宣言 + version の JSON） | Phase 9 |

仕様書自身が明示する未処理論点（スロット語彙 = 論点P、公開 write 濫用防止の具体 = 論点W）は
それぞれ Phase 6 / Phase 9 に割り当てる。非目標（13章: 全文検索・i18n・アセット変換・
エクスポート・DO ロケーション）は本ロードマップのスコープ外のまま維持する。

---

## 2. フェーズ分割

各フェーズは単体で「動作し、テスト可能なソフトウェア」を成果物とする。
番号は依存順であり、Phase 6 以降は一部並行可能。

| Phase | 名称 | 内容 | 主な検証手段 | 依存 | 仕様章 |
|-------|------|------|------------|------|--------|
| 1 | **モノレポ基盤 + metamodel** | pnpm workspaces / TS strict / oxlint・oxfmt / Vitest / CI。`packages/metamodel`: フィールド型パレットのメタスキーマ、content_type 定義スキーマ（名前空間規則）、実行時 Zod スキーマ生成、寛容 read、relation 分離 | Node ユニットテスト | — | 4・5章 |
| 2 | **テナント DO 書き込み経路** | `packages/db`（Drizzle スキーマ: content_types / records / relations / outbox / alarm・有効化レジストリ）、TenantDO クラス（blockConcurrencyWhile + JIT migration）、書き込み経路（validate → beforeWrite フックパイプライン → version / field_versions / seq 更新 → relations 再投影）、システムフック（unique 検証）、content_type 登録 API、宣言ベース indexed の generated column DDL、削除（トゥームストーン） | @cloudflare/vitest-pool-workers | 1 | 6・9.4・5章 |
| 3 | **コントロールプレーン + 認証** | 中央 D1 スキーマ（tenants / users / memberships / sessions）、signup / login（WebCrypto PBKDF2）、jose による短命 JWT 発行・検証、KV ブロックリスト、Worker 入口ゲート（第1段認可）→ DO ルーティング、第2段認可のシステム beforeWrite フック（デフォルトロール owner/editor/viewer をコードに焼く）、JWT リフレッシュ（G5） | pool-workers | 2 | 2・11章 |
| 4 | **同期プロトコル** | `packages/sync-protocol`（メッセージ型、field_versions 競合判定の純関数: 別フィールド両立 / スカラー LWW / 本文検知）、DO 側 WebSocket Hibernation エンドポイント、ブートストラップ + seq チェックポイント + トゥームストーン配信（G2）、content_types メタコレクション配信（G1）、クライアント同期エンジン（partysocket + tanstack-db コレクション実行時生成） | unit + pool-workers | 3 | 8・10章 |
| 5 | **publish → 投影 → 公開 API** | published_snapshots と publish / unpublish、outbox + sweeper（**alarm 多重化レジストリのコア実装はここ**）、Queues consumer（冪等 upsert / delete、source_version 順序ガード、D1 batch 原子性）、投影 D1 の3テーブル（records 投影 / relations 投影 / projection_index）、テナント単位再投影ジョブ、Hono 公開 read API（単体 / 一覧 / 索引宣言フィールドのフィルタ・ソート / カーソルページネーション / 関係解決）、テナント解決（G3）、slug 昇格規約（G4）、エッジキャッシュ | pool-workers | 2（consumer は 3 のインフラ不要） | 7・9.6・12章 |
| 6 | **管理画面基盤** | `apps/admin`（TanStack Start SPA 寄り構成）、`packages/ui`（react-aria-components + StyleX 合成ヘルパー、スロット語彙の初版 = 論点P）、ログインフロー、content_type ビルダー UI、メタモデル駆動動的フォーム（TanStack Form + Zod）、record 一覧・編集（同期エンジン接続）、publish / unpublish 操作（Hono RPC）、ワークフロー status 操作と archive 時公開中警告 | RTL + 手動 | 3・4・5 | 7・8章 |
| 7 | **リッチテキスト** | Tiptap v3 エディタ、AST エンベロープ（schemaVersion）、AST → relations（origin='body'）抽出の純関数と DO 側再投影への接続、エディタ UI（packages/ui のツールバー）、本文競合の手動解決 UI | unit + RTL | 6 | 5・6・10.4章 |
| 8 | **アセット** | asset コンテンツ型（システム型）、R2 バインディング、アップロード方式決定（presigned PUT か Worker 経由か = 保留事項）、メディア関係フィールド UI、orphan 検出 | pool-workers + 手動 | 6 | 5章（論点E） |
| 9 | **モジュールシステム** | マニフェスト形式（G6）、有効化レジストリと適用済み version 記録、フック配送の汎用化（beforeWrite / afterWrite / afterPublish）、alarm 多重化のモジュール向け汎用化、モジュール権限宣言の DO 展開、Queues による型定義再配布、実証: 予約モジュール（公開 write + Turnstile + Rate Limiting = 論点W）またはメール配信モジュール | pool-workers | 5・6 | 4.2・9・11.7章 |
| 10 | **特権テナント + 運用** | 特権ログイン分離（passkey / TOTP 必須）、テナント CRUD、super 権限と監査ログ、健全性チェック（archived かつ公開中の一覧等）、デプロイパイプライン整備（preview / production 環境分割）、E2E（Playwright）薄く導入 | pool-workers + E2E | 3・5・6 | 11.6・7章 |

### 依存関係の要点

- Phase 5 の sweeper が alarm 多重化レジストリを必要とするため、**alarm 多重化のコア実装は
  Phase 5 に置き、Phase 9 でモジュール向けに汎用化**する（新機構の二重実装を避ける）。
- Phase 4（同期）と Phase 5（投影）は Phase 2 完了後に**並行着手可能**（同期は records、
  投影は snapshots と、触る面が分離しているため）。
- 管理画面（Phase 6）はモック API で先行着手も可能だが、同期エンジン（Phase 4）が本体の
  価値なので順序どおりを推奨。

### アプリのデプロイ単位（tech-selection 2.2 の保留の解決案）

`apps/sync`（DO 定義）は独立 Worker とせず **`apps/api` に同居**させる
（DO クラスは束ねる Worker からエクスポートする必要があり、公開 write → DO 到達の経路も
api Worker が持つため）。tech-selection の「デプロイ単位は api と統合も可」を採る。
Phase 2 の詳細計画で最終確定する。

---

## 3. 計画ファイルの規約

- 命名: `YYYY-MM-DD-phaseN-<slug>.md`
- 各計画は superpowers:writing-plans 形式（TDD、完全なコード、チェックボックス step）。
- フェーズ完了時にこのロードマップの当該行に完了日を追記する。

| Phase | 計画ファイル | 状態 |
|-------|-------------|------|
| 1 | `2026-07-12-phase1-foundation-and-metamodel.md` | 完了（2026-07-12 main へマージ） |
| 2 | `2026-07-12-phase2-do-write-path.md` | 完了（2026-07-13 main へマージ） |
| 3 | `2026-07-13-phase3-control-plane-auth.md` | 完了（2026-07-13 main へマージ） |
| 4a | `2026-07-13-phase4a-sync-server.md` | 完了（2026-07-13 main へマージ） |
| 4b | `2026-07-13-phase4b-sync-client.md` | 完了（2026-07-13 main へマージ） |
| 5a | `2026-07-13-phase5a-publish-projection.md` | 完了（2026-07-14 main へマージ） |
| 5b〜10 | 各フェーズ着手時に作成 | 未着手 |

---

## 4. Phase 1 完了時の申し送り（最終レビュー 2026-07-12）

Phase 1 実装完了（ブランチ worktree-phase1-foundation-metamodel、41 tests green、最終レビュー「マージ可」）。

**G7: `required` の意味論 — 裁定済み（2026-07-12 ユーザー決定）:**

- 決定: **required は非空を強制する**。required text は `.min(1)`、required の many-relation / multiple-select は要素≥1。空値許容の現行挙動（キー存在のみ）は Phase 1 時点の暫定であり、**Phase 2 冒頭の小修正として metamodel に適用する**（対象: `buildRecordInputSchema` の required 分岐 + テスト）。背景: Phase 6 動的フォームの直感と一致し、`required`+`unique` slug の空文字衝突も構造的に防ぐ。

**Phase 2 への技術申し送り:**

- ID 検証は `uuidSchema`（小文字 UUID 強制・拒否方式）に統一済み。UUID バージョンは問わない（v7 は生成側の規約）。
- `splitRecordInput` の refs 配列 index をそのまま `relations.ordinal` に使える（フィールド定義順・配列順保持）。
- many-relation の重複 ref / multiple-select の重複値は現状検証を通る。relations 再投影時の dedup 方針を Phase 2 で決定。
- `required`+`unique` の slug と空文字の相互作用は G7 の裁定に依存。
- `key` / `name` / select option 等の長さ上限は未設定。入力ハードニングは Phase 2 の API 境界の責務。
- `buildRecordInputSchema` / `tolerantReadData` は呼び出しごとにスキーマ再構築。`(contentType.id, version)` キーのメモ化を Phase 2/4 で検討（Phase 4 クライアントコレクションのホットパス）。

**軽微（将来対応・記録のみ）:**

- ルート lint スクリプトの `--no-error-on-unmatched-pattern` は lint 対象が恒常化した今は外せる。
- CI に actions の SHA ピン / `timeout-minutes` / `concurrency` を将来追加。
- oxfmt はスクリプト経由でのみ ignore が効く（`--ignore-path` 明示のため）。CONTRIBUTING 整備時に注記。

---

## 5. Phase 2 完了時の申し送り（最終レビュー 2026-07-13）

Phase 2 実装完了（DO 書き込み経路、91 tests green、最終レビュー「マージ可」）。G7（required 非空）適用済み。

**Phase 3（認可）への申し送り:**

- **beforeWrite パイプラインは no-op ゲートの後にある**。no-op 書き込みはフック未実行のまま全データ入り snapshot を返すため、認可をこのパイプラインだけに載せると「現在値を正確に当てた書き込み」が内容確認オラクルになる。認可第1判定は RPC 入口（no-op 判定より前）に置くこと。
- `deleteRecord` はフックパイプラインを通らない。beforeDelete 相当の設計が必要。
- 2本目のフック追加時に、複数フックの短絡動作テストを必ず追加（現状1本のため未検証）。
- `HookRejection.code` は `Extract<WriteErrorCode, ...>` に変えると WriteErrorCode との手動同期が消える。

**Phase 4（同期）への申し送り:**

- seq のロールバック欠番は DO 再起動後に**再利用され得る**（メモリカウンタが MAX(seq) に巻き戻る）。単調性は保たれるが「一度発番したら不使用」ではない前提で設計。
- content_type の変更は seq を消費しない。型定義の同期は `content_types.version` を別チャネルとして扱う。
- 型定義から削除された relation フィールドのクリーンアップ書き込みは field_versions をバンプしない（キーが定義に無いため凍結残存）。relation クリアの検知は record.seq/version 側で行う。
- **RecordSnapshot は relations を含まない**が、書き込みは全置換（relation 省略=クリア）。getRecord → 編集 → writeRecord の read-modify-write で optional relation が無言クリアされる継ぎ目がある。Phase 4 のクライアント/同期表現では snapshot に relations を含めるか、「writeRecord 入力は relation 全量必須」を契約として明文化すること。
- `buildRecordInputSchema` / `tolerantReadData` の `(contentType.id, version)` メモ化はクライアントコレクションのホットパスで必須級。
- RPC 型の注意: `Record<string, unknown>` を含む戻り値は Cloudflare の `Rpc.Serializable` 検査で ok:true 側が never に潰れる。テストは `apps/api/test/rpc-unwrap.ts` の型付きアンラップを使う（@ts-expect-error 禁止）。

**Phase 5（publish/投影）への申し送り:**

- **動的 `g_*` generated column は Drizzle スキーマの外**にある。将来の drizzle-kit マイグレーションが records のテーブル再ビルドを行うと g_*/idx_g_* が黙って消え、content_types 由来の prev と物理スキーマが乖離する。records の再ビルド禁止を規約化するか、`applyIndexDdl` の prev を `pragma table_xinfo` から導出する防御を入れる。
- stale relations 問題は解消済み（blanket 再投影）。relations テーブルは信頼して読める。

**軽微（記録のみ）:**

- unique 照会の `type = ?` バインドは部分索引（リテラル WHERE）を使えない可能性。検証済み typeKey のリテラル埋め込みで解消可（書き込み頻度が低い現状は不急）。
- 同一定義の content_type 再登録でも version が +1 される。Phase 9 の冪等マニフェスト再配信で no-op 検出を検討。
- `CREATE INDEX` に IF NOT EXISTS がなく DROP 側と非対称（復旧シナリオの保険として将来揃える）。
- `actor` / key・name 長さ上限等の入力ハードニングは HTTP API フェーズ（Phase 3 以降）の責務のまま未消化。

---

## 6. Phase 3 完了時の申し送り（最終レビュー 2026-07-13）

Phase 3 実装完了（コントロールプレーン + 認証、128 tests green、最終レビュー「マージ可」）。エンドツーエンドの認証済み書き込み（signup → tenant 作成 → token → ゲート → DO 第2段認可）が HTTP で成立。

**セキュリティ上の重要決定（実装済み）:**

- JWT_SECRET は **wrangler.jsonc の vars に置かない**（fail-closed 化）。テスト = vitest.config の miniflare.bindings、ローカル dev = `.dev.vars`、本番 = `wrangler secret put JWT_SECRET`。secret 未設定の本番は全リクエスト 401 で「即座に壊れる」側に倒れる（計画の「テストは vars」記述はこの方式へ置換 — 意図は保存）。
- 第2段認可は beforeWrite パイプラインではなく **TenantDO の RPC 入口**（authorize.ts、no-op 判定より前）。design-spec §11.5 の「beforeWrite と同じ機構」記述は次版更新事項。

**Phase 4（同期）への申し送り:**

- ブラウザ WebSocket は Authorization ヘッダを付けられない。WS upgrade のトークン搬送（Sec-WebSocket-Protocol / クエリ / 短命 one-time ticket）を設計すること。ゲートのロジック（署名 → tid 照合 → blocklist）は tenant-gate.ts から関数として再利用可能。
- **確立済みソケットはブロック後も生き続ける**。メッセージ処理時の再チェック or ブロックイベントでの切断経路を設計項目に。
- JWT は 15 分で切れる。長寿命 WS 接続のトークン更新（再認証メッセージ）も同時に設計。

**Phase 10（特権テナント・membership 管理）前に裁定必須:**

- **ブロックリストの粒度**: 現状 `blocked:user:{userId}`（ユーザー・グローバル）。テナント単位の権限剥奪を即時化する手段がない（JWT 自然失効 ≤15 分 + token 再発行時の D1 再読込が現状の失効モデル — §11.2 と整合するが、membership 変更 API を作る際は (userId, tenantId) 粒度 or membership epoch の導入を先に決めること）。
- あわせて: JWT_SECRET 最小長の起動時検証、__Host- cookie prefix、セッション掃除、email 小文字正規化、signup/login レート制限（Turnstile はここ）。

**軽微（記録のみ）:**

- login は email 不在時に PBKDF2 を跳ばす形（応答時間でユーザー列挙可 — signup 409 で既に列挙可能なため増分ほぼゼロ）。
- signup / tenant 作成の SELECT→INSERT は同時競合時に一意制約違反の素の 500（一意索引が整合性は保証）。onError ハンドラは未整備。
- viewer-403 e2e は status のみアサート。GET content-types/:key・DELETE records の HTTP 経路は e2e 未走行（DO 層では担保済み）。
- PBKDF2 は workerd 上限 100k iterations（OWASP 600k 未達のプラットフォーム天井、passkey 格上げで解消予定）。

---

## 7. Phase 4a 完了時の申し送り（最終レビュー 2026-07-13）

Phase 4a（同期サーバー）完了。168 tests green、最終レビュー「マージ可」。WS 認証 upgrade → ブートストラップ（seq チェックポイント差分・トゥームストーン・content_types）→ push（フィールド単位裁定・ack・ブロードキャスト）→ ライフサイクル（失効切断・BAN 切断・型再配信・ハイバネーション生存）が workerd 上で実証済み。

**Phase 4b（クライアントエンジン）が守るべきワイヤ契約:**

- **重複配信あり → record 単位で冪等適用せよ**。upgrade 受理〜hello の間に他クライアントの push があると `change` が `welcome` より先に届き、同じ record が bootstrap の sync ページにも再登場する。record は全状態なので「id ごとに `record.seq` が大きい方を採用」で収束する。
- **checkpoint 前進規則**: `sync` の `complete: true` を受けてから `serverSeq` へ前進。`welcome.serverSeq < 手元 checkpoint` はサーバーリセットの兆候 → 全再同期にフォールバック（サーバーは検知手段を提供しない）。
- **ソケット内のトークン更新は無い**（設計持ち越し）。4001 close を受けたら新トークンを `/auth/token` で取り、checkpoint 付き hello で再接続する。exp 前の先回り再接続を推奨。
- **失効ソケットは配信対象外**（read 側にも ≤15分の失効が効く）。keepalive の `ping`/`pong` は `KEEPALIVE_PING` / `KEEPALIVE_PONG` 定数を使う（DO 側は auto-response で起きない）。
- **conflict ack にサーバー現在値は入らない**（`conflicts` のフィールド一覧のみ）。手動解決 UI は手元の最新 record と突き合わせる。将来 `current: SyncRecord` を同梱する拡張を検討。
- **delete は裁定を通らない**（常に勝つ。richtext 編集中でも競合検知しない — 記録すべき意味論決定）。トゥームストーンへの upsert は `record_deleted` ack（復活不可）→ クライアントはローカル record を破棄。
- **ack の失敗コード語彙**は `ACK_ERROR_CODES`（sync-protocol）に列挙。`AckResult.code` の型は Phase 9 のモジュール拡張のため `string` のまま。
- **空の many-relation はキーごと省略**（`[]` ではない）。`status` は裁定外（到着順 LWW）。
- push は1バッチ最大100件（`MAX_CHANGES_PER_PUSH`）。sync ページも100件単位（ちょうど100件のとき空の complete ページが1つ余分に来る）。

**Phase 10（BAN 実装）への申し送り:**

- `blockUser`（KV）と同時に、該当テナント DO の `disconnectUser(userId)` を必ず呼ぶこと（確立済みソケットは KV だけでは切れない）。現状の呼び出し元はテストのみ。

**軽微（記録のみ）:**

- `loadSyncRecordsSince` は record ごとに content_type を引き直す N+1（DO 内 SQLite なので現状許容。大規模テナントでカタログのキャッシュを検討）。
- `handleHello` は全バックログをメモリに実体化してから送る。リッチテキスト肥大時は WS メッセージ上限に当たりうる → 将来バイト量ベースのページングへ。
- DO の `fetch()` は upgrade ヘッダのみ検査しパスを見ない（現状 Worker からの唯一の呼び出しが `/sync` のため安全）。
- 内部ヘッダ `x-plyrs-auth` の実行時形状検証は無し（呼び出し元が1箇所で信頼できるため。増えるなら zod 検証を入れる）。

---

## 8. Phase 4b 完了時の申し送り（最終レビュー 2026-07-13）

Phase 4b（クライアント同期エンジン）完了。236 tests green、最終レビュー「マージ可」。`packages/sync-client` は依存フリーのコア（transport seam / 冪等ストア / アウトボックス / プロトコル状態機械）+ 隔離された tanstack-db アダプタ + partysocket ブラウザトランスポート。**実 DO との e2e（workerd 上で実エンジンを駆動）で疎通を実証済み**。

**Phase 6（管理画面）が守るべき配線契約（5点・全部必須）:**

1. `onContentTypes → registry.sync` / `onReady → registry.markReady`（**呼ばないと live query が永久待機**）/ `onStoreChange → registry.applyStoreChange`（**未配線だと確定レコードがコレクションに載らず、保存した編集が消えたように見える**）/ `onReset → registry.reset`（未配線だとサーバーリセット後にゴーストが残る）。engine ↔ registry の循環は `let registry!` の前方参照で解く。
2. **ステータスの意味論**: `"closed"` は「stop() した」「オフライン（アウトボックス温存・push promise は保留）」「4003 で拒否（アウトボックス棄却・promise reject）」の3つを兼ねる。区別が必要なら push promise の reject 有無で判別するか、engine 側にステータス分離を先に入れる。
3. **再開トリガはアプリの責務**: バックオフ枯渇後・オフライン後に自動再開はしない。`online` イベント / visibilitychange / 再試行ボタンで **`start()` を再度呼ぶ**（アウトボックスは温存されており、ready 後に自動再送される）。`start()` は "ready" 前に resolve するので UI は `onStatus` を待つこと。
4. **耐久ストレージを実装する場合**: `SyncStorage` は checkpoint とアウトボックスのみを永続化する。**レコードも永続化するなら、`start()` の前に `engine.store.apply(record)` でシードすること**（さもないと空ストアガードが checkpoint を破棄し、毎回フル再同期になる — 安全側だが帯域を浪費）。
5. **競合 UI**: 再送は at-least-once。conflict ack が「実は成功済みの自分の変更」に返ることがある（ack 消失後の再送）。警告を出す前に手元 store の最新 record と突き合わせること。

**未解決の設計課題（Phase 6 着手前に裁定）:**

- **同一レコードへの連続編集が自分自身と競合する**: ack 未着のまま同じ record を再編集すると、2回目の `baseFieldVersions` が古いままサーバーに届き、richtext は conflict 裁定でロールバック＝**直前の打鍵が UI から消える**（リッチテキストのオートセーブで常態化しうる）。対策案: レコード単位で push を直列化する、または ack の確定 `fieldVersions` で未送信 change を rebase する。
- half-open ソケット（close も ack も来ない）を検知する仕組みが無い（keepalive のタイムアウト検知が未実装）。

**@tanstack/db（BETA 0.6.14、exact pin）更新時の注意:**

- `startSync: true` は**必須**（既定 false。無いと `sync()` が発火せず適用が永久 no-op になる silent failure）。
- 楽観的更新の確定は**ハンドラの Promise 解決**で起こる（同期ストリームのエコーを待たない）。ちらつき防止はライブラリの persisting-transaction 遅延が担保しており、手動マージは不要（入れると二重書き込みになる）。
- 削除の同期状態書き込みは `DeleteKeyMessage`（キーのみ、`value` 無し）。**`collection.get()` は楽観的オーバーレイ越しの見え方**なので「同期状態に存在するか」の判定に使ってはならない（アダプタは自前の `syncedKeys` で追跡している）。
- アダプタは `@plyrs/sync-client/tanstack` サブパス。ルート import では BETA ライブラリを評価しない。

---

## 9. Phase 5a 完了時の申し送り（最終レビュー 2026-07-14）

Phase 5a（publish → アウトボックス → Queues → 共有投影 D1）完了。Task 8 で `apps/api/test/projection-e2e.test.ts`
を追加し、`worker.queue()` を一切呼ばずに DO スタブ経由の publish/unpublish/delete だけを叩き、実 miniflare
キューブローカ経由で投影 D1 にデータが着地することをポーリングで確認した（3 tests green）。これにより
producer バインディング名・キュー名・consumer 登録の配線が初めて実証された（Task 1〜7 のユニットテストは
すべて `worker.queue(...)` を直接呼んでおり、ブローカを経由していなかった）。

**順序トークンは `publishSeq` であって `source_version` ではない（レビューで再現済みの重大論点）:**

`records.version`（= snapshot の `source_version`）は publish / unpublish では変化しない。そのため
「unpublish → 無編集で republish」を行うと、異なる publish 世代が同じ `source_version` を運んでしまい、
遅れて届いた stale な delete ジョブが republish 後の生きた行を消しうる（`source_version` だけをガードに
使う実装で実際に FAIL することを修正前に確認済み）。順序ガードは DO 全体で単調増加する **`publishSeq`**
で行う。この値は `do_config` テーブルに **`nextPublishSeq()` が発番のたびに永続化**しており、
`published_snapshots` や `outbox` の行の MAX から復元してはならない ―― この2テーブルの行は
unpublish やスイーパーの `purgeSent()` で消えるため、MAX 復元は起動直後にカウンタを 0 へ巻き戻し、
republish が既に送出済みの世代番号を再び採ってしまう事故を再現済み（`apps/api/test/publish.test.ts`
の `restores publish_seq...` / `does not let publish_seq rewind...` の2テストがこの穴を固定している）。

**`projection_tombstones` は復活防止のために存在する（GC は意図的に無い）:**

再投影のページ読み取りは公開中スナップショットの「ある時点のスナップショット」であり、その読み取り後に
unpublish の delete ジョブが先着すると、遅れて届く再投影由来の stale な書き込みが `upsertStatements()` の
無条件 INSERT 経路を通って、削除済みのはずのレコードを公開テーブルへ復活させてしまう（実際に再現し、
`projection-consumer.test.ts` の「resurrection race」3テストで固定済み）。対策として delete ジョブは
`projection_tombstones` に墓標を立て、`upsertStatements()` の INSERT/UPDATE 双方を「同じ
`(tenant_id, record_id)` について、自分（書き込み側）の `publish_seq` より新しい墓標が存在しない」
`NOT EXISTS`（`publish_seq > payload.publishSeq`）でガードし、より新しい世代の書き込みが勝った時点で
自分以下の墓標をクリアする（訂正: 「同じ `(tenant_id, record_id)` の墓標が存在しない」という無条件の
NOT EXISTS ではない ―― `publish_seq` の大小を見ずに存在有無だけで弾くなら、下記の「無害な孤児墓標」が
それより新しい世代の正当な書き込みまで永久に弾いてしまい、矛盾する）。**周期的な GC は意図的に実装
していない**: 時刻ベースの GC を入れたところ、2つの再投影ウォークが重なった場合に、後発ウォークの
終端 sweep が先発ウォークがまだ依存している墓標を
消してしまい、先発ウォークの遅延した stale write が無防備になって復活事故を再現した
（`projection-consumer.test.ts` の「overlapping reprojection walks」テストで固定済み）。周期 GC は
Phase 10 の運用整備に持ち越す。

**Phase 5b（公開 read API）への申し送り:**

- 公開 read API は `projected_records` を直接読み、「unpublish 済みか」を確認するフィルタは**不要**
  （墓標は `projection_tombstones` という別テーブルに意図的に隔離してあり、`projected_records` に
  マージしてはならない）。
- クエリ面: 単体/一覧取得は `(tenant_id, record_id)` PK と `(tenant_id, type, published_at)` /
  `(tenant_id, type, slug)` の索引で引く。
- `projection_index` は「フィルタ/ソートで record_id を絞り込む」用途に限る（レコード本体の復元には
  使わない ―― 復元は必ず `projected_records.data` への join に戻る）。
- 索引済み複数値フィールド（multiple-select 等）の select は行分割で持つため、フィルタは any-of 意味論
  になる。**ソートは単一値フィールドに対してのみ定義される**（複数値フィールドでソートすると行が
  重複するため未定義）。
- 関係解決は `projected_relations` に対してのみ行い、参照先が未公開（= 投影に存在しない）なら
  単純に**不在**として扱う（ソフト参照。エラーにしない）。
- 公開パスは **`/public/v1/:tenantSlug/...`**（2026-07-13 裁定。ロードマップ§1 の G3 default 案
  `/v1/t/{tenantSlug}/...` から変更）。`tenantSlug → tenantId` はコントロールプレーン D1 + KV キャッシュ
  で解決し、DO は経由しない。

**G3 / G4 の確定内容（本フェーズの裁定表を転記）:**

- **G3（公開 API のテナント解決）**: 公開パスは `/public/v1/:tenantSlug/...`。5a では公開 read
  エンドポイントを作らない（Phase 5b のスコープ）。
- **G4（slug の実カラム昇格規約）**: フィールド key が `slug` かつ `type: "text"` かつ
  `config.unique === true` のフィールドの値だけを投影の `slug` 実カラムへ昇格する。該当フィールドが
  無ければ `slug = NULL`。

**裁定（2026-07-13）:**

- 公開中レコードの削除は **unpublish を強制する**（`deleteRecord` は snapshot を消し、outbox に
  delete ジョブを積む）。**archive は仕様どおり強制 unpublish しない**（archive ≠ delete）。
- `snapshotEmbed: "value"` は **Phase 5a では未実装**（id のみを解決する参照のまま）。埋め込み対象
  フィールドの語彙はアセット型と一緒に Phase 8 で決める。

**Phase 9（モジュール）への申し送り:**

- alarm レジストリ（`alarm_registry(kind, due_at)`）は design-spec §9.6 が求める多重化のコア実装として
  既に一般化された形で入っている。`kind` を `module_id` に読み替えるだけで転用でき、システム固有なのは
  `TenantDO.alarm()` のディスパッチ分岐（`kind === OUTBOX_SWEEP` の分岐）だけである。
- `effectiveNow()`（`apps/api/src/do/alarms.ts`）は「`alarm()` が呼ばれたこと自体がレジストリの最早
  `due_at` の到来を証明する」という前提で、早期起床やクロック誤差を `Math.max(Date.now(), earliestDue)`
  で吸収する。**これは性質ではなく制約として読むこと**: この前提が成り立つのは、レジストリに登録する
  すべての `setAlarm` 呼び出しが必ずレジストリ全体の最小値（`minDueAt`）で物理アラームを張っている
  （＝物理アラームの発火時刻とレジストリの最早 `due_at` が常に一致する）からに過ぎない。Phase 9 で
  モジュールが自前のタイマーを追加する際、レジストリ全体の最小値ではない `due_at` で `setAlarm` を
  直接張るモジュールが一つでも現れると、この前提は崩れ、他の登録が「まだ最小値ではない」うちに
  `alarm()` が呼ばれて `effectiveNow()` が実際より早い時刻を返しうる（任意に早い起床を許してしまう）。
  モジュール向け汎用化では、物理アラームの設定経路を `armSweep()` 相当の一本（常に `minDueAt` を張る）
  に集約させ、モジュールが直接 `ctx.storage.setAlarm()` を呼ばないことを保証する必要がある。

**未解決 / 将来対応:**

- DLQ は設定済み（`plyrs-projection-dlq`、`max_retries: 5`）だが、**意図的にコンシューマーを
  付けていない** ―― outbox 行は enqueue 成功（`sent=1`）で消えるが、それは projection 成功を意味
  しない。リトライを使い切って drop されたジョブは outbox 側からは既に何も残っておらず再送できない
  ため、メッセージは DLQ に park させたまま運用者が手動で確認・再投入する運用を前提にする。
  DLQ の監視・アラート配線（滞留検知、自動リプレイ等）は Phase 10 の運用整備で追加する。
- 再投影ウォークは直列化されていない（オーナーが連打すると複数の epoch が同時に走る）。今は上記の
  墓標ガードにより安全だが、それぞれが投影全件のフルパスを消費する。
- 墓標行は GC されない（record 数に比例して増え続ける有界リーク。at-least-once 再配信された stale な
  delete が着地した場合、record 1 件につき最大 1 個の無害な孤児墓標が残りうる）。
- 再投影はオーナー操作のみで cron 起動は無い（乖離が起きても自動回復しない）。
- `getPublishedPage`（再投影のページ読み取り RPC）は 1 回の呼び出しで最大 50 件ぶんの完全なペイロード
  （`data` + `relations` + index 行）を単一の DO RPC 応答に載せており、バイト数の予算を持たない。
  richtext 等で 1 レコードが大きいテナントでは、1 ページの応答サイズが実用上問題になるほど
  膨らみうる。ページサイズをバイト予算で動的に絞る仕組みは Phase 10 の関心事とする。
