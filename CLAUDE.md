# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 概要

plyrs は Cloudflare 上のマルチテナント CMS/BaaS(kintone 的に「型をデータとして定義する」メタモデル + ヘッドレス公開配信)。設計判断の真実源は以下で、コード中のコメントは `§12.3` `論点W` `裁定 10` `Phase 9` のようにこれらを参照する:

- `docs/design-spec.md` — 設計仕様(章番号 `§N`・論点記号・決定ログ)
- `docs/tech-selection.md` — 技術選定とバージョン方針
- `docs/deploy.md` — preview / production デプロイ手順、super 管理者 bootstrap
- `docs/superpowers/plans/2026-07-12-implementation-roadmap.md` — フェーズ計画の索引(各フェーズの申し送り・未裁定事項)。フェーズ別詳細計画は同ディレクトリ

ドキュメント・コメント・コミットメッセージは日本語。

## コマンド

pnpm workspaces(pnpm 10、Node 22)。依存バージョンは `pnpm-workspace.yaml` の `catalog:` で一元管理する(各 package.json は `"catalog:"` 指定)。

```bash
pnpm lint            # oxlint
pnpm format          # oxfmt(書き込み)/ pnpm format:check
pnpm typecheck       # 全パッケージ tsc --noEmit(TypeScript 7 / strict + noUncheckedIndexedAccess)
pnpm test            # e2e 以外の全 vitest
```

CI(`.github/workflows/ci.yml`)は lint → format:check → typecheck → test と e2e を実行する。

単体実行:

```bash
pnpm --filter @plyrs/api exec vitest run --no-isolate --max-workers=1 test/publish.test.ts
pnpm --filter @plyrs/admin exec vitest run src/lib/sync.test.ts -t "<テスト名>"
pnpm --filter @plyrs/e2e test        # Playwright(.wrangler を削除してから dev サーバー起動)
pnpm --filter @plyrs/admin dev       # 管理画面 + api を auxiliary worker として同一 dev サーバーで起動
pnpm --filter @plyrs/admin build     # routeTree.gen.ts の再生成もこれで行う
```

マイグレーション生成(必ず drizzle-kit で生成し手書きしない。生成後は `pnpm format`):

```bash
pnpm --filter @plyrs/db generate             # テナント DO-SQLite(drizzle/、DO 起動時に自動適用)
pnpm --filter @plyrs/db generate:d1          # コントロールプレーン D1(drizzle-d1/)
pnpm --filter @plyrs/db generate:projection  # 公開投影 D1(drizzle-projection/)
```

## アーキテクチャ

### デプロイ単位とパッケージ

- `apps/api` — Hono の Worker。テナント DO(`TenantDO`)、Queues consumer、cron もこの 1 Worker に同居する。エントリは `src/index.ts`
- `apps/admin` — TanStack Start(SPA モード)の管理画面。**独立 Worker** で、`/auth`・`/v1` などの API パスは service binding `API` で api Worker へ同一オリジン転送する(`src/server.ts` + `src/lib/server-routing.ts`)
- `apps/e2e` — Playwright。3 spec は共有 dev サーバー・共有ローカル D1 前提で順序依存(`playwright.config.ts` の projects/dependencies で固定)
- `packages/metamodel` — フィールド型パレット・content type 定義・Zod スキーマ生成・tolerant read(純関数、クライアントと DO で共用)
- `packages/sync-protocol` — 同期メッセージ型とフィールド単位の競合解決(`resolve.ts`)
- `packages/sync-client` — 同期エンジン(outbox / store / transport)と TanStack DB 連携(`./tanstack`)
- `packages/db` — Drizzle スキーマ 3 系統: `schema.ts`(DO 内)/ `control-plane.ts`(D1)/ `projection.ts`(投影 D1)
- `packages/ui` — react-aria-components + StyleX のコンポーネント、Tiptap リッチテキストエディタ

### データの置き場(物理分離が背骨)

- **テナント = 1 Durable Object (SQLite)**。DO 境界がテナント境界なので DO 内テーブルに `tenant_id` 列は無い。中核は `content_types`(型定義をデータとして持つ)/ `records`(全コンテンツ、`data` は JSON)/ `relations`(関係、片側のみ格納・ソフト参照)。DO が各テナントの single-writer
- **コントロールプレーン D1**(`DB`): テナント・ユーザー・メンバーシップ・セッション・super 管理者。認可はリクエスト入口(Worker)で DO を開かずに判定する
- **投影 D1**(`PROJECTION_DB`): 全テナント共有、`tenant_id` 付きの公開読み取りモデル。再構築可能な派生物
- R2 `ASSETS`(キー `${tenantId}/${assetId}`、バイナリ不変)、KV `BLOCKLIST` / `TENANT_SLUGS`

### 非対称二経路(design-spec §8)

- **書き込み経路**: 管理画面 → sync-client → `/v1/t/:tenantId/sync` の WebSocket(**Hibernation API 必須**、素の `accept()` 禁止)→ DO。書き込みは `do/write-record.ts` に集約され、validate-on-write → beforeWrite フック(一意性 `unique-check`・asset 防御・モジュールフック)→ 差分 → outbox 記録
- **公開 read 経路**: `/public/v1/:tenantSlug/...` は**DO を起こさない**。投影 D1 とキャッシュのみを読む(`src/public/`)。publish 時に DO の outbox → `PROJECTION_QUEUE` → consumer(`projection/consumer.ts`)が冪等に投影する
- 例外: モジュールの公開 write(`routes/public-write.ts`)は Turnstile + Rate Limiting を DO 到達前の Worker 層で検証する(コスト DoS 対策)
- Queues consumer は `index.ts` の単一 `queue()` がキュー名で振り分ける。`-dlq` は D1 へ退避し `/super/v1/dead-letters` から運用する

### その他の重要な前提

- **ID はクライアント生成の UUIDv7**。関係はソフト参照で dangling を正常系として扱う
- 型定義変更で既存 records を一括変換しない(tolerant read + validate-on-write の遅延適合)
- プラグイン(モジュール)の型キーはモジュール ID で名前空間化(例 `booking.slot`)。モジュールは `apps/api/src/modules/` に manifest + registry で静的登録
- 同期の競合解決: 別フィールドはマージ、同一スカラーは LWW、同一リッチテキストは検知して手動解決
- DO の RPC 戻り値は Cloudflare の型が union を潰すため、`src/rpc-unwrap.ts` の `asXxx()` で実型へ戻す。**`@ts-expect-error` による抑止は禁止**
- admin は `src/start.ts` で `defaultSsr: false`。Workers には SPA の 404→シェル リライト層が無いため `server.ts` が `/_shell` を自前配信する(dev では prerender が無く SSR にフォールバックするので、dev/E2E が緑でも実機で壊れうる)

## テスト

- api のテストは `@cloudflare/vitest-pool-workers`(workerd 上で実行)。`vitest.config.ts` が D1 マイグレーションをバインディングとして注入し、`test/apply-migrations.ts` で適用する。DO は `env.TENANT_DO.get(env.TENANT_DO.idFromName(<一意な名前>))` でテストごとに分離する
- `cloudflare:test` の `fetchMock` は pool-workers 0.18 で削除済み。外部 fetch のモックは `vi.spyOn(globalThis, "fetch")`(`test/public-write.test.ts` が様式)
- admin / ui は jsdom + Testing Library

## ローカル開発・デプロイの注意

- `wrangler.jsonc` のトップレベルは dev / vitest 用で ID はダミー。**`--env` なしの `wrangler deploy` は禁止**(必ず `--env preview|production`)。binding 系は env ごとに全定義が必要(継承されない)
- `apps/api/.dev.vars` の `JWT_SECRET` は 32 字以上必須(短いと `requireSaneSecret` が `/auth/*` `/v1/*` `/super-auth/*` `/super/v1/*` を 500 で閉じる)。`apps/admin/.dev.vars` は `.dev.vars.example` を参照(`DEV_PROXY_PUBLIC=1` で dev のみ公開 API を転送)
- E2E は実行のたびに `apps/api/.wrangler` / `apps/admin/.wrangler` を削除する(ローカルデータは消える)
- main への push で preview に自動デプロイ。production は `workflow_dispatch` + Environment の必須レビュー
