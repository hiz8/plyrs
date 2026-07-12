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
| 2 | `2026-07-12-phase2-do-write-path.md` | 計画済み |
| 3〜10 | 各フェーズ着手時に作成 | 未着手 |

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
