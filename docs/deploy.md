# デプロイ手順書(preview / production)

## 0. 前提と警告

- **素の `wrangler deploy`(`--env` なし)は禁止**。`apps/api/wrangler.jsonc` / `apps/admin/wrangler.jsonc` のトップレベルブロックは dev/vitest 用(`vitest-pool-workers` が `configPath` で読む)であり、`database_id` や KV `id` はすべてダミー値。必ず `--env preview` か `--env production` を付けてデプロイする。
- GitHub Secrets(リポジトリまたは各 Environment に設定): `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID`。
- GitHub の `production` Environment には **必須レビュアー(Required reviewers)を設定する**(Settings → Environments → production → Deployment protection rules)。`.github/workflows/deploy.yml` の `workflow_dispatch` はこの Environment 保護を経由するため、レビュー承認なしに本番へは出ない。`preview` Environment はレビュー不要のまま(push のたびに自動デプロイするため)。

## 1. 初回リソース作成(環境ごと)

`preview` と `production` はそれぞれ独立したリソース一式を持つ。以下を **環境ごとに 2 回**実行する(`[-preview]` は preview のときだけ付ける)。`wrangler` はワークスペースルートの devDependency から解決される(`pnpm exec wrangler ...`)。

```bash
# Queues(通常 + DLQ、projection と modules の 2 系統 × 2 = 4 個)
pnpm exec wrangler queues create plyrs-projection[-preview]
pnpm exec wrangler queues create plyrs-projection[-preview]-dlq
pnpm exec wrangler queues create plyrs-modules[-preview]
pnpm exec wrangler queues create plyrs-modules[-preview]-dlq

# D1(control-plane と projection の 2 個)
pnpm exec wrangler d1 create plyrs-control-plane[-preview]
pnpm exec wrangler d1 create plyrs-projection[-preview]

# R2(assets)
pnpm exec wrangler r2 bucket create plyrs-assets[-preview]

# KV(BLOCKLIST と TENANT_SLUGS の 2 個)
pnpm exec wrangler kv namespace create BLOCKLIST[-preview]
pnpm exec wrangler kv namespace create TENANT_SLUGS[-preview]
```

実際のコマンドでは `[-preview]` を外すかそのまま `-preview` サフィックスを付けて置換する。例: preview の control-plane D1 は `pnpm exec wrangler d1 create plyrs-control-plane-preview`、production は `pnpm exec wrangler d1 create plyrs-control-plane`。

出力された ID を `apps/api/wrangler.jsonc` の該当 `env` ブロックへ転記する:

| リソース | 出力される ID | 転記先(`env.preview` / `env.production`) |
| --- | --- | --- |
| `plyrs-projection[-preview]` queue | (名前のみ、ID 不要) | `queues.producers[0].queue` / `queues.consumers[0].queue` / 各 `dead_letter_queue` |
| `plyrs-modules[-preview]` queue | (名前のみ、ID 不要) | `queues.producers[1].queue` / `queues.consumers[1].queue` / 各 `dead_letter_queue` |
| `plyrs-control-plane[-preview]` D1 | `database_id` | `d1_databases[0].database_id`(binding `DB`) |
| `plyrs-projection[-preview]` D1 | `database_id` | `d1_databases[1].database_id`(binding `PROJECTION_DB`) |
| `plyrs-assets[-preview]` R2 | (名前のみ、ID 不要) | `r2_buckets[0].bucket_name` |
| `BLOCKLIST[-preview]` KV | `id` | `kv_namespaces[0].id` |
| `TENANT_SLUGS[-preview]` KV | `id` | `kv_namespaces[1].id` |

D1 のマイグレーションは初回作成直後に一度だけ手動適用してもよい(以後は `.github/workflows/deploy.yml` が push のたびに `wrangler d1 migrations apply --remote` を実行する):

```bash
pnpm exec wrangler d1 migrations apply DB --remote -c apps/api/wrangler.jsonc --env preview
pnpm exec wrangler d1 migrations apply PROJECTION_DB --remote -c apps/api/wrangler.jsonc --env preview
```

Rate limit(`unsafe.bindings` の `ratelimit`)の `namespace_id` はダッシュボード上の実 ID ではなく **アカウント内で一意な任意の文字列**(wrangler が要求する識別子)。本リポジトリでは `env.preview` = `2001`(`PUBLIC_WRITE_LIMITER`)/ `2002`(`AUTH_LIMITER`)、`env.production` = `3001` / `3002` を割り当てている。**同一アカウント内の他の Worker が同じ `namespace_id` を使っていないことを確認する**(衝突するとレート制限バケットが共有されてしまう)。衝突が判明した場合はここと `wrangler.jsonc` の両方を新しい未使用の数値に差し替える。

## 2. secrets(環境ごと)

```bash
# 32 字以上必須。短いと requireSaneSecret が fail-closed で全 API を 500 にする(apps/api/src/middleware/sane-secret.ts)。
wrangler secret put JWT_SECRET --env <env> -c apps/api/wrangler.jsonc

# 公開 write(/public/v1/:tenantSlug/modules/...)用。未設定(または空文字)だと 503 { error: "misconfigured" } で fail-closed。
wrangler secret put TURNSTILE_SECRET_KEY --env <env> -c apps/api/wrangler.jsonc

# 任意。設定したときだけ /auth/signup・/auth/login で Turnstile 検証が必須化される(apps/api/src/routes/auth.ts)。
wrangler secret put AUTH_TURNSTILE_SECRET_KEY --env <env> -c apps/api/wrangler.jsonc
```

`AUTH_TURNSTILE_SITE_KEY` はシークレットではなく公開値なので `vars`(`wrangler.jsonc` またはダッシュボード設定)で設定する(任意 — 未設定なら `/auth/turnstile-config` が `{ siteKey: null }` を返す)。

`wrangler secret put` は上記のとおり `pnpm exec` を介さず直接 `wrangler`(ローカル PATH またはグローバルインストール)を使ってもよいし、`pnpm exec wrangler secret put ...` でも同じ結果になる。対話的にシークレット値を求められる(パイプで渡す場合は `echo -n '<value>' | wrangler secret put JWT_SECRET --env <env> -c apps/api/wrangler.jsonc`)。

## 3. デプロイ

- `main` への push → `.github/workflows/deploy.yml` が **`preview` へ自動デプロイ**(D1 migrations apply → api deploy → admin build+deploy の順)。
- `production` へのデプロイは **`workflow_dispatch`(Actions タブから手動実行)** のみ。`environment: preview` を選ぶと push と同じ preview デプロイを再実行できる。

手動でローカルからデプロイする場合(緊急時など)のコマンド:

```bash
# 1) D1 migrations
pnpm exec wrangler d1 migrations apply DB --remote -c apps/api/wrangler.jsonc --env <env>
pnpm exec wrangler d1 migrations apply PROJECTION_DB --remote -c apps/api/wrangler.jsonc --env <env>

# 2) api デプロイ
pnpm exec wrangler deploy -c apps/api/wrangler.jsonc --env <env>

# 3) admin ビルド + デプロイ(vite の cloudflare プラグインが CLOUDFLARE_ENV を見て env ブロックを解決し、
#    dist 配下に解決済み wrangler.json を書き出す。実パスは `apps/admin/dist/server/wrangler.json`)
CLOUDFLARE_ENV=<env> pnpm --filter @plyrs/admin build
pnpm exec wrangler deploy -c "$(find apps/admin/dist -name wrangler.json -print -quit)"
```

`<env>` は `preview` か `production`。

## 4. super 管理者の初期化

初回のみ(`super_admins` テーブルが空のときだけ成立する):

```bash
curl -X POST https://<api-host>/super-auth/bootstrap \
  -H 'content-type: application/json' \
  -d '{"email":"admin@example.com","password":"<12 字以上>"}'
```

応答の `totpSecret`(または `otpauthUri`)を認証アプリ(Google Authenticator 等)に登録する。`otpauthUri` は QR 表示未実装のため手入力になる(見送り事項)。以後 `/super-auth/bootstrap` は `403 { "error": "already_bootstrapped" }` を返す。

**TOTP を紛失した場合の復旧**: `super_admins` を全削除して再 bootstrap する(紐づく `super_sessions` も合わせて削除する — 外部キー制約はないが孤児セッションを残さないため)。

```bash
pnpm exec wrangler d1 execute DB --remote -c apps/api/wrangler.jsonc --env <env> \
  --command "DELETE FROM super_sessions; DELETE FROM super_admins;"
```

実行後、上記の `bootstrap` を再度叩けば新しい super 管理者を作成できる。

## 5. ローカル開発の注意

- `apps/api/.dev.vars` の `JWT_SECRET` は **32 字以上**に更新が必要(Phase 10 の `requireSaneSecret` 導入以降。短いままだと `/auth/*` `/v1/*` `/super-auth/*` `/super/v1/*` が丸ごと 500 になる)。
- `apps/e2e`(Task 16 で追加予定)のテストは `apps/api/.wrangler` / `apps/admin/.wrangler`(ローカル永続化ディレクトリ)を **毎回削除する**運用になる(super 管理者の bootstrap が「空のときのみ」条件のため、また tenant slug の一意制約を毎回クリーンな状態から検証するため)。開発中にローカルで貯めたデータは E2E 実行のたびに消える点に注意する。
