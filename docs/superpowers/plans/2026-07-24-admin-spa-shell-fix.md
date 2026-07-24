# admin SPA シェル配信修正(preview 実機 500 バグ)

日付: 2026-07-24 / ブランチ: worktree-admin-spa-shell-fix(基点 89e0c27)

## 背景・根本原因(調査済み — 再調査不要)

preview 実デプロイ後、SSR 中に API を呼ぶ全ルート(`/super` 系・`/super-login`・
`/tenants`・`/t/$tenantSlug` 系)の直接 URL ロード/リロードが HTTP 500 になる。

- admin は SPA モード(`tanstackStart({ spa: { enabled: true } })`)でビルドされ、
  `_shell.html` は生成・デプロイ済み(実機で `GET /_shell` → 200 を確認済み)。
- TanStack Start の SPA モードは「404 リクエストを `_shell.html` へリライトする」
  静的ホスティング前提の設計(Netlify `_redirects` 等)。Workers + server.ts 構成には
  このリライト層が存在せず、全ナビゲーションが SSR ハンドラ(`handler.fetch`)に落ちる。
- SSR 中に route の `beforeLoad`/`loader` が相対 URL fetch(`/super-auth/me`・
  `/super-auth/status` 等)を実行 → workerd の fetch は相対 URL を解決できず
  `TypeError: Invalid URL` → 500。SSR HTML 内のシリアライズ済みエラー
  `new Error("Invalid URL: /super-auth/status")` で実証済み。
- dev(vite)では SSR の相対 fetch が dev サーバー内で解決されるため既存 E2E 3 本は
  緑だった(環境差)。`/`・`/login`・`/signup` は SSR 時に fetch しないため無事。

裁定(2026-07-24): A+B の二重防御で修正する。

- **A(主防御)**: server.ts で非 API のドキュメント GET に `_shell.html` を返す
  = SPA モードのリライトを Workers 側で実装(tech-selection §1.1「SPA 寄り・
  シェル prerender」の本来の完成形)。
- **B(二次防御)**: router に `defaultSsr: false` — 仮に SSR ハンドラに落ちても
  loader/beforeLoad が SSR で走らないようにする。

## Global Constraints(全タスク共通)

- `@ts-expect-error`・`any` 禁止。完了報告前にルートで `pnpm lint`(警告 0)。
- テストで `fetchMock` は使わない(削除済み API)。fetch を差し替えるなら
  `vi.spyOn(globalThis, "fetch")` か依存注入。
- 全コマンドは `cd <worktree> && ...` 形式。コミット前に
  `git rev-parse --abbrev-ref HEAD` でブランチ確認(worktree-admin-spa-shell-fix)。
  bare な `git stash` 禁止。`git add` は明示パスのみ。
- 作業ツリー直下の untracked dotfiles(.bashrc / .gitconfig / .claude/ / .mcp.json 等)は
  sandbox マスク由来 — 無視し、絶対に git add しない。
- ルート追加はないため routeTree 再生成は不要(もし必要になったらコントローラに報告)。
- コード規約: 既存コードのコメント密度・命名・idiom に合わせる。コメントは
  「コードで表せない制約」のみ(設計裁定の根拠など既存スタイルどおり)。
- oxfmt: 完了前にルートで `pnpm format:check`。

## Task 1: router に defaultSsr: false(防御 B)

対象: `apps/admin/src/router.tsx`(+ `apps/admin/src/router.test.tsx`)

1. TDD: 先に `router.test.tsx` へ「`getRouter()` が `defaultSsr: false` を持つ」
   テストを追加し RED を確認(`router.options.defaultSsr` を参照)。既存テストの
   記述スタイル(describe/it、日本語テスト名の有無)に合わせること。
2. `getRouter()` の `createRouter({...})` に `defaultSsr: false` を追加。
   コメントで理由を 1〜2 行(例: workerd の SSR は相対 URL fetch を解決できないため
   loader/beforeLoad をクライアント専用化する。シェル配信(server.ts)が主防御で、
   これは SSR ハンドラに落ちた場合の二次防御)。
3. GREEN 確認: `pnpm --filter @plyrs/admin test`(全件)。

## Task 2: server.ts で _shell.html 配信(防御 A)

対象: `apps/admin/wrangler.jsonc` / `apps/admin/worker-configuration.d.ts`(再生成)/
`apps/admin/src/lib/server-routing.ts`(新規)/ `apps/admin/src/server.ts`
(+ 新規テスト `apps/admin/src/server-routing.test.ts`)

1. `apps/admin/wrangler.jsonc` に assets binding を宣言:
   `"assets": { "binding": "ASSETS" }`。@cloudflare/vite-plugin が directory を
   管理するため `directory` は書かない。wrangler の env 仕様上 binding 系は env ごとに
   全定義が必要なので top-level と `env.preview` / `env.production` の 3 箇所に書く
   (assets が env 内で受理されない場合は top-level のみとし、ビルド出力で
   反映を確認して方針を報告)。
2. cf-typegen で `worker-configuration.d.ts` を再生成し `Env` に `ASSETS: Fetcher` が
   入ることを確認。コマンドは admin の package.json の cf-typegen スクリプトを使う
   (`--strict-vars=false` 必須 — §16 確定事項)。sandbox の EROFS で直接書けない場合は
   一時パス($TMPDIR)に出力して cp する。
3. ルーティング判定を純関数に切り出す: `apps/admin/src/lib/server-routing.ts`
   (**`cloudflare:workers` を import しない** — jsdom の vitest で直接テストするため)。
   例:
   ```ts
   export type ServerRoute = "api" | "shell" | "ssr";
   export function resolveServerRoute(
     request: Request,
     opts: { devProxyPublic: boolean },
   ): ServerRoute
   ```
   判定順:
   - `isApiPath(pathname)` → `"api"`(既存 `./api-paths` を利用。WS upgrade も
     `/v1/...` なのでここに含まれる — 挙動を変えないこと)
   - `devProxyPublic` かつ `pathname === "/public/v1" || startsWith("/public/v1/")`
     → `"api"`(既存の dev 限定転送を維持)
   - `request.method === "GET"` かつドキュメント要求
     (`Sec-Fetch-Dest: document` ヘッダ、または `Accept` に `text/html` を含む)
     → `"shell"`
   - それ以外 → `"ssr"`
4. `server.ts` は判定結果で振り分ける薄い接着層に留める:
   - `"api"` → `env.API.fetch(request)`(従来どおり)
   - `"shell"` → `env.ASSETS.fetch(new URL("/_shell.html", request.url))` を試み、
     `ok` のときだけ `status: 200` で返す(ヘッダは shell レスポンス由来を維持)。
     `env.ASSETS` が未定義、または shell が `ok` でない場合(dev では `_shell.html` が
     存在しない)→ `handler.fetch(request)` にフォールバック = dev の従来挙動を維持
     (既存 E2E 3 本が dev SSR 前提のため必須)。
   - `"ssr"` → `handler.fetch(request)`。
5. TDD: `server-routing.test.ts` を先に書き RED → 実装 → GREEN。最低限のケース:
   - `GET /super-login`(Accept: text/html)→ `"shell"`
   - `GET /tenants`(Sec-Fetch-Dest: document のみ、Accept なし)→ `"shell"`
   - `GET /auth/turnstile-config` → `"api"`(isApiPath)
   - `GET /v1/t/abc/sync`(Upgrade: websocket)→ `"api"`
   - `POST /auth/login` → `"api"`
   - `GET /assets/index-xxxx.js`(Accept: */*)→ `"ssr"`(shell 化しない)
   - devProxyPublic true/false での `/public/v1/...` の分岐
   - `POST` の非 API パス → `"ssr"`
6. ビルド検証: `CLOUDFLARE_ENV=preview pnpm --filter @plyrs/admin build` を実行し、
   `apps/admin/dist/server/wrangler.json`(`find apps/admin/dist -name wrangler.json`)に
   assets の binding が出力されることを確認。sandbox では prerender が Request.cf
   timeout で落ちる既知事象あり(§16)— wrangler.json 出力後に落ちる分には可。
   その場合は wrangler.json の内容確認結果と「完走は CI に委ねる」旨を報告に含める。

## 完了ゲート(ブランチ全体 — 最終レビュー前)

- ルートで `pnpm test`(764+ 全件)/ `pnpm typecheck` / `pnpm lint`(警告 0)/
  `pnpm format:check`。
- E2E 3 本: `apps/e2e` のテストを実行(実行スクリプトは apps/e2e/package.json を確認)。
  実行すると apps/{admin,api}/.wrangler(ローカル永続化)が毎回削除される仕様 — 想定内。

## マージ後の検証(コントローラが実施 — タスク外)

- main へローカルマージ → push → Deploy workflow 完走 → 実機 curl:
  `/super-login` `/super` `/tenants` が 200(シェル HTML、シリアライズ済みエラーなし)。
