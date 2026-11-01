# M0-3 認可サーバー(論点 C1・C2・D2)の試作結果

> MCP 導入の実装計画 M0-3。試作コードは `spike/mcp-oauth` ブランチの `apps/api/src/spike/` と
> `apps/api/test/oauth-spike.test.ts`(main にはマージしない)。
> 結論は design-spec 第 16.2・16.3 章と決定ログ(決定 47〜49)に反映した。ゲート G0 の 4 項目
> (A1 の形式 = 決定 46、C1 の方式 = 決定 47、PAT の検証経路 = 決定 49、D2 の配置 = 決定 48)が揃った。

## 結論

| 論点 | 採用 | 根拠(要約) |
| --- | --- | --- |
| C1 認可サーバーの方式 | **(a) `@cloudflare/workers-oauth-provider` v1 の分割 API**(`OAuthAuthorizationServer` / `OAuthResourceServer`)。自前実装は採らない | 認可コード + PKCE、同意ヘルパー、CIMD / DCR、Authorization Server Metadata、PRM、`insufficient_scope` の challenge が揃い、試作で一巡した(下記 2〜4)。自前で書くと M3-1 が L から XL に膨らむ |
| C1 認可サーバーの置き場 | **api Worker**。issuer は admin オリジンのテナント別パス `https://<admin>/oauth/t/<tenantId>`、admin は `/oauth` と `/.well-known/oauth-authorization-server` を api へ同一オリジン転送する | セッション(D1)もロール(memberships)も api にしかない。admin に置くと `/authorize` のたびに api へ往復し、`OAUTH_KV` と api → admin の binding を 3 環境分増やす |
| C2 / PAT の検証経路 | **`OAuthResourceServer` の `validateToken` で PAT と OAuth を合流**。PAT は接頭辞で振り分けて D1 1 照会、OAuth は同 Worker 内の `validateToken`(KV 1 回 + 復号)。両方に BLOCKLIST 2 キーを適用 | ライブラリは「自前トークンと併用する validator」を公式に想定している(docs/resource-servers.md「Alongside your own tokens」)。Service Binding の RPC は不要になる |
| D2 MCP エンドポイントのオリジン | **api Worker の直接オリジン** `https://<api>/mcp/t/<tenantId>`(= `resource`) | Bearer 専用で cookie を使わない。admin 経由は 1 ホップ増えるだけで得るものがない。`/public/v1` と同じく「api の直接の責務」に揃う |
| 逆向き Service Binding(api → admin) | **dev で成立する**(確認済み)が、**採らない** | 上の置き場の決定で不要になった。採る場合は vitest が起動できず(相手の Worker が無い)`miniflare.serviceBindings` のスタブが要る |

## 試作で確かめたこと

### 1. api → admin の逆向き Service Binding(dev)

admin の `vite dev` が api を auxiliary worker として起こす構成で、api の `wrangler.jsonc` に
`services: [{ binding: "ADMIN", service: "plyrs-admin" }]` を足し、admin → api(`API` binding)→ admin(`ADMIN` binding)
の往復を `GET /v1/_spike/admin-ping` で確認した。

| 確認項目 | 結果 |
| --- | --- |
| `@cloudflare/vite-plugin` 1.62.5 で entry worker への binding を auxiliary worker から張れるか | **張れる**。`curl http://127.0.0.1:5173/v1/_spike/admin-ping` → `{"status":200,"body":{"publicApiOrigin":""}}`(admin の `/_config` の応答) |
| vitest(`@cloudflare/vitest-plugin`)への影響 | **起動に失敗する**(`binding "ADMIN" refers to a service "core:user:plyrs-admin", but no such service is defined`)。`vitest.config.ts` の `miniflare.serviceBindings` にスタブを置けば動く |
| 運用コスト | binding の定義がトップレベル・preview・production の 3 か所に増える(env 間で継承されない)。admin 側にも `OAUTH_KV` が要る |

→ 技術的には可能だが、認可サーバーを api に置けば使わずに済む。

### 2. `@cloudflare/workers-oauth-provider` 1.2.4 分割 API の評価(①〜④)

| 評価項目 | 結果 |
| --- | --- |
| ① Service Binding の相互参照 | 分割 API は「認可サーバーの Worker が `WorkerEntrypoint` で `validateToken(resource, token)` を公開し、リソースサーバーが `env.AUTH_SERVER.validateToken` を渡す」形。同一 Worker なら `(env) => (resource, token) => as.validateToken(resource, token, env)` でよく RPC は無い。**api に両方を置くので RPC 無しの形を採る**。別 Worker で `OAuthError` を投げると RPC 越しに plain `Error` になる制約も回避できる |
| ② external tokens | 分割 API では `validateToken` が「ただの関数」なので、トークンの形(接頭辞)で振り分けて自前検証に流せる。`OAuthProvider`(単一 Worker 版)の `resolveExternalToken` と同じ役割。**PAT はこの経路に乗せる**(下記 3)。`null` を返せば 401 の challenge、`OAuthError("invalid_token", {statusCode: 403})` を投げれば 403 になることを確認 |
| ③ `OAUTH_KV` | 固定名の KV binding。トークン・grant・client を保存し、access token は TTL 付き(最小 60 秒)。別インスタンスで発行したトークンを検証できる = **状態は KV にだけあり、オブジェクトは要求ごとに作り直せる**(確認済み)。KV の最終的整合性により、失効が全拠点へ届くまでの遅れは KV の性質どおり |
| ④ PAT の検証経路 | ライブラリに PAT 機能は無い。②の経路で自前の D1 表を引く。詳細は 3 |
| `resources` が構築時に固定 | **テナント別の audience を採るなら、テナントを URL で運ぶ必要がある**。親パス `/mcp` だけを登録した AS に `resource=/mcp/t/<id>` を送ると `AuthorizationError`(`resource_not_configured`)で拒否される(確認済み)。子孫パスはリソースサーバー側の受け入れ(token の audience が親で、要求が `/mcp/tools`)だけに適用され、`resource` パラメータの照合には効果がない |
| テナント別 issuer(パス付き) | issuer を `https://admin.example/oauth/t/<tenantId>` にすると、authorize `…/authorize`、token `…/oauth/token`、metadata `/.well-known/oauth-authorization-server/oauth/t/<tenantId>` がすべてテナントを含む。**どの入口でも URL だけからテナントが決まり、要求ごとに `new OAuthAuthorizationServer({issuer, resources: [tenantResource]})` を組み立てられる**(metadata の `issuer` / `protected_resources` が期待どおり出ることを確認) |
| 構築コスト | `new OAuthAuthorizationServer(...)` 50 回の平均 0.04 ms。要求ごとの構築で問題ない |
| CIMD | `clientIdMetadataDocumentEnabled: true` には compatibility flag `global_fetch_strictly_public` が要る(無いと起動時に警告が出て無効化される)。有効化すると metadata に `client_id_metadata_document_supported: true` が載る。**wrangler.jsonc(api)に flag を足す**(M3-1) |
| DCR | 既定では `registration_endpoint` が metadata に出ない。fallback に残すには `clientRegistrationEndpoint` を設定する(M3-1) |
| 同意ヘルパー | `describeConsent` → `beginConsent`(`__Host-oauth-consent-…` cookie + handle)→ `approveConsent`(scope を絞れる、handle は 1 回限り)→ `completeAuthorization` の一巡を確認。`approveConsent` は承認したスコープに絞った request を返す。クライアント名はエスケープ必須(`<b>evil</b>` がそのまま返る) |
| access token TTL | `accessTokenTTL: 900` で `expiresAt` が 15 分以内になることを確認(決定どおり既存 JWT と同じ) |

### 3. PAT の検証経路と OAuth との合流(`src/spike/pat.ts`、`src/spike/mcp-gate.ts`)

- PAT は `plyrs_pat_` + 32 バイトの base64url。D1 にはハッシュ(SHA-256)だけを保存し、`memberships` を join した 1 回の照会で
  「ハッシュ一致・テナント一致・未失効・期限内・会員である」を判定する。**ロールは PAT に焼き込まず毎回 `memberships` から引く**
  (長命トークンなのでロール変更を即時に反映する)。
- OAuth は同意時に grant の props に `{userId, tenantId, role}` を入れ、`validateToken` が復号して返す。ロールは access token の
  15 分の間は固定(既存 JWT と同じ遅れ)。refresh のたびに `tokenExchangeCallback` の `newProps` で `memberships` から読み直す(M3-4)。
- 合流後の認可コンテキストは `{userId, role, tenantId, exp, scopes, tokenId, via}`。BLOCKLIST の `blocked:user` / `blocked:membership`
  を両方に適用し、BAN が PAT と OAuth の両方を同時に止めることを確認した。
- `OAuthResourceServer` をホストにすると、401(`WWW-Authenticate: Bearer resource_metadata="…/.well-known/oauth-protected-resource/mcp/t/<id>", scope="record:read"`)、
  PRM(`resource` / `authorization_servers` / `scopes_supported`)、`insufficientScope(ctx.auth, ["record:delete"])` の 403 を
  ライブラリが出し、**PAT でも同じ 401 / 403 / PRM が返る**。別テナントの PAT は 401。

### 4. 未ログインで `/authorize` に来たときの Turnstile 付きログイン往復

- `parseAuthRequest` は状態を持たない(同じ URL で 2 回呼んで同じ結果、KV に何も残らない)。**未ログインなら
  `302 → https://<admin>/login?return_to=/oauth/t/<id>/authorize?…` に回し、ログイン後に同じ URL へ戻して
  もう一度 `parseAuthRequest` すればよい**。状態を持ち始めるのは `beginConsent` から(ログイン後)。
- admin の `/login` は Turnstile を既に持つ(`routes/login.tsx`)が、`return_to` の検索パラメータが無く、成功後は `/tenants` へ
  固定で遷移する。**M3-2 で `return_to` を足す**(同一オリジンの `/oauth/t/` 配下のパスだけ許可するオープンリダイレクト対策を含む)。
- 同意画面の描画は 2 案: (i) api が `/oauth/t/<id>/authorize` で HTML を描画する(ライブラリの手本どおり、admin は転送だけ)、
  (ii) admin の SPA 経路にして api は `describeConsent` / `approveConsent` の JSON 端点を出す。**(i) を推す**(転送の接頭辞が
  `/oauth` 1 つで済み、cookie 束縛の handle をそのまま使える)。管理画面の見た目に揃えたくなった時点で (ii) に移れる。

### 5. 遅延計測(workerd ローカル、`performance.now` の分解能は 1 ms)

| 計測対象 | n | p50 | p90 | 平均 |
| --- | --- | --- | --- | --- |
| `new OAuthAuthorizationServer(...)` | 50 | 0 ms | 0 ms | 0.04 ms |
| OAuth `validateToken`(KV 1 回 + 復号) | 50 | 1 ms | 1 ms | 0.7 ms |
| PAT 検証(D1 1 照会、join) | 50 | 1 ms | 2 ms | 1.4 ms |
| 入口の判定(OAuth + BLOCKLIST 2 キー) | 50 | 2 ms | 2 ms | 1.8 ms |
| 入口の判定(PAT + BLOCKLIST 2 キー) | 50 | 2 ms | 3 ms | 2.3 ms |
| 認可コード + PKCE の一巡(client 作成〜token 発行) | 5 | 14 ms | 26 ms | 16.6 ms |

ローカルの値であり、実環境では KV(拠点キャッシュ)・D1(リージョン往復)の遅延が乗る。PAT の D1 照会は既存の
セッション判定(`/auth/me`)と同じ性質で、DO を起こす経路の前段としては許容範囲。Service Binding の RPC は採らない構成なので未計測。

## M1・M3 への引き継ぎ事項

- **M1-3b(PAT)**: `personal_access_tokens` を drizzle のスキーマ(`control-plane.ts`)とマイグレーションにする。列は
  `id, token_hash(UNIQUE), user_id, tenant_id, scopes, expires_at, revoked_at, created_at, last_used_at, name`。検証は
  `memberships` を join した 1 照会。接頭辞 `plyrs_pat_` は限定公開中は変えうる(16.12)。
- **M1-5(入口)**: `OAuthResourceServer` をホストにし、`validateToken` に合流関数を差す。M1 の時点では OAuth 側は常に `null`
  (PAT のみ)でよく、PRM の `authorization_servers` にはテナント別 issuer を先に書いておける。`requiredScopes: ["record:read"]`。
- **M3-1(認可サーバー)**: api の `wrangler.jsonc` 3 か所に `OAUTH_KV` と `compatibility_flags: ["global_fetch_strictly_public"]`、
  `clientRegistrationEndpoint`。admin の `api-paths.ts` の接頭辞に `/oauth` と `/.well-known/oauth-authorization-server` を足す。
  認可サーバーは要求ごとに `tenantFromIssuerPath` で組み立てる。ライブラリの版は catalog に置く。
- **M3-2(同意画面)**: `/login` に `return_to`(同一オリジン・`/oauth/t/` 配下のみ)。同意ページは api が HTML を描画(案 i)。
  `record:publish` は所有者以外に見せない、既定で外す(決定 43)。利用者が当該テナントの会員でなければ同意に進ませない。
- **M3-3(リソースサーバー側)**: 合流関数の BLOCKLIST 照会と `insufficientScope`。スコープの階層(`record:write` が `record:read`
  を含む等)を判定に入れる。
- **M3-4(TTL とロール)**: `accessTokenTTL: 900`、`tokenExchangeCallback` の refresh で `memberships` からロールを読み直す。
- **運用**: `purgeExpiredData` を既存の日次 cron(`scheduled`)に足す。`onError` で `internal.category/reason` をログに出す。

## 試作の実行方法

```bash
git checkout spike/mcp-oauth
export PATH="/opt/node24/bin:$PATH"   # Node 24
pnpm install --frozen-lockfile
pnpm --filter @plyrs/api exec vitest run --no-isolate --max-workers=1 --reporter=verbose test/oauth-spike.test.ts

# 逆向き Service Binding の確認(apps/api/.dev.vars と apps/admin/.dev.vars を用意してから)
pnpm --filter @plyrs/admin dev
curl http://127.0.0.1:5173/v1/_spike/admin-ping
```
