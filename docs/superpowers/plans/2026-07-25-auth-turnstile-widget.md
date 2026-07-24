# signup/login の Turnstile ウィジェット統合

日付: 2026-07-25 / ブランチ: worktree-auth-turnstile-widget(基点 acbc4f0)

## 背景(調査済み — 再調査不要)

preview 実機確認で発覚した機能ギャップ。API 側は実装済み:

- `apps/api/src/routes/auth.ts`: `AUTH_TURNSTILE_SECRET_KEY` 設定時、`/auth/signup`・
  `/auth/login` は body の `turnstileToken`(z.string().max(2048).optional())を
  `requireAuthTurnstile` で検証。欠落 → 400 `{"error":"turnstile_required"}`、
  検証失敗 → 403 `{"error":"turnstile_invalid"}`(実際のエラー名は auth.ts を確認)。
- `GET /auth/turnstile-config` → `{ siteKey: string | null }`(公開値)。

admin UI 側にウィジェット表示・トークン取得・送出コードが**存在しない**ため、
AUTH_TURNSTILE 有効化で signup/login が必ず 400 になる。preview は一時的に
AUTH_TURNSTILE_SECRET_KEY を削除して回避中 — 本実装のデプロイ後に再設定する。

前提事実:

- admin に CSP ヘッダなし(challenges.cloudflare.com のスクリプト読み込みは自由)。
- dev / E2E は AUTH_TURNSTILE 未設定(siteKey null)— ウィジェット非表示のまま挙動不変が必須。
- ルートは defaultSsr: false(loader はクライアント専用)。siteKey 取得は
  super-login.tsx の loader パターン(queryClient.fetchQuery)を踏襲してよい。
- auth 系 UI テストは `createAppContext(stubFetch(routes))` の DI パターン
  (auth-flow.test.tsx 参照)。fetchMock は使わない。
- Turnstile 公式: スクリプトは `https://challenges.cloudflare.com/turnstile/v0/api.js`
  を explicit レンダリングで使用(`?render=explicit&onload=<cb>`)。
  `window.turnstile.render(el, { sitekey, callback, "expired-callback", "error-callback" })`
  が widgetId を返し、`reset(widgetId)` / `remove(widgetId)` を持つ。
  トークンは約 300 秒で失効(expired-callback が呼ばれる)。

## Global Constraints(全タスク共通)

- `@ts-expect-error`・`any` 禁止。完了報告前にルートで `pnpm lint`(警告 0)と
  `pnpm format:check`。
- テストで `fetchMock` 禁止。fetch は DI(createAppContext(stubFetch))、
  `window.turnstile` は vi.stubGlobal 等の偽装で。
- TDD 必須(テスト先行・RED 確認)。
- 全コマンドは `cd /home/hiz/work/plyrs/.claude/worktrees/auth-turnstile-widget && ...`。
  コミット前に `git rev-parse --abbrev-ref HEAD` でブランチ確認。bare git stash 禁止。
  `git add` は明示パスのみ。untracked dotfiles(.bashrc / .claude/ 等)は絶対に add しない。
- ルート追加なし(既存 signup/login の変更のみ)→ routeTree 再生成不要。
- 既存コードのコメント密度(1〜2 行・設計裁定の根拠)・命名・idiom に合わせる。
- siteKey null 時の挙動は完全に現状維持(dev/E2E の前提)。

## Task 1: Turnstile スクリプトローダーと React コンポーネント

対象: `apps/admin/src/lib/turnstile.ts`(新規)/
`apps/admin/src/components/turnstile-widget.tsx`(新規)+ 各テスト

1. `lib/turnstile.ts`(React 非依存):
   - `loadTurnstile(): Promise<TurnstileApi>` — script タグを 1 回だけ注入し
     (`?render=explicit&onload=<一意なコールバック名>`)、onload で resolve。
     二重呼び出しは同じ Promise を返す(idempotent)。すでに `window.turnstile` が
     あれば即 resolve。script の onerror で reject。
   - `TurnstileApi` 型: `render(el, params) => string` / `reset(id)` / `remove(id)`。
     params は sitekey / callback / "expired-callback" / "error-callback" のみ
     (使う分だけ手書き。網羅不要 — YAGNI)。
   - テスト(jsdom): script が 1 回だけ注入される / onload コールバックで resolve /
     既存 window.turnstile で即 resolve / onerror で reject。
2. `components/turnstile-widget.tsx`:
   - props: `siteKey: string` / `onToken: (token: string | null) => void`。
   - マウントで loadTurnstile → render。callback で onToken(token)、
     expired-callback / error-callback で onToken(null)(error 時は reset も検討 —
     公式推奨に従う)。アンマウントで remove。
   - ロード失敗時は onToken(null) のまま(送信側のガードに委ねる)。
   - テスト(jsdom): 偽 window.turnstile で render 呼び出し・callback 発火 →
     onToken 受領 / expired → onToken(null) / アンマウント → remove。
3. GREEN 確認: `pnpm --filter @plyrs/admin test`。

## Task 2: signup/login への統合と api-client 拡張

対象: `apps/admin/src/lib/api-client.ts` / `apps/admin/src/routes/signup.tsx` /
`apps/admin/src/routes/login.tsx` / `apps/admin/src/auth-flow.test.tsx`(拡張)

1. `api-client.ts`: `signup` / `login` に第 3 引数 `turnstileToken?: string` を追加。
   指定時のみ body に `turnstileToken` を含める(未指定時の body は現状と同一)。
   `turnstileConfig(): Promise<{ siteKey: string | null }>` も追加
   (GET /auth/turnstile-config)。
2. signup.tsx / login.tsx(両方同じパターン):
   - loader で `queryClient.fetchQuery({ queryKey: ["turnstile-config"], ... })`
     (super-login.tsx の loader パターン踏襲)。
   - siteKey 非 null のとき TurnstileWidget を表示し token を state 管理。
     token が無い間は送信ボタンを disable(必須なのに欠落した 400 を防ぐ)。
   - siteKey null のときは一切変化なし(ウィジェット非表示・従来 UI)。
   - 送信で token を渡す。API が turnstile 系エラーを返した場合は他の 400 系と
     同様の日本語メッセージ表示(messageFor に追加)+ token state をクリア。
   - ラベル・ボタン名など既存文言は変えない(E2E がロール名に依存)。
3. テスト(auth-flow.test.tsx 拡張 + 必要なら新ファイル):
   - siteKey あり: ウィジェット領域が表示され、token 取得後に submit すると
     POST body に turnstileToken が含まれる(stubFetch で body を検証)。
   - siteKey あり・token 未取得: 送信ボタン disabled。
   - siteKey null: ウィジェット非表示・POST body に turnstileToken なし
     (既存テストが壊れないことも含む)。
   - turnstile エラー応答でメッセージ表示。
   - TurnstileWidget は偽 window.turnstile(vi.stubGlobal)でトークン発火を制御。
4. GREEN 確認: `pnpm --filter @plyrs/admin test` 全件 +
   `pnpm --filter @plyrs/admin typecheck`。

## 完了ゲート(ブランチ全体 — 最終レビュー前)

- ルートで `pnpm test` / `pnpm typecheck` / `pnpm lint`(警告 0)/ `pnpm format:check`。
- E2E 3 本(dev は siteKey null なので挙動不変のはず — 回帰確認として実行)。

## マージ後(コントローラが実施 — タスク外)

- main へローカルマージ → push → Deploy 完走。
- ユーザーに AUTH_TURNSTILE_SECRET_KEY の再設定を依頼(値はユーザー保管)→
  実機で signup/login のウィジェット表示・通過(§16-3)を確認。
