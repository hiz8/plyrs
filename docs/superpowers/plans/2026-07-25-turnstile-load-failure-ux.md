# Turnstile スクリプトロード失敗時の UX 改善(fast-follow)

日付: 2026-07-25 / ブランチ: worktree-turnstile-load-failure-ux(基点 c6da6a4)

## 背景(最終レビュー Important 1 — 調査済み)

challenges.cloudflare.com のロード失敗(ネットワーク断・プライバシー系ブロッカー・CF
障害)時、signup/login の submit は永久 disabled になるが**ユーザーに理由が表示されない**。
さらに `loadTurnstile` の rejected Promise がモジュールスコープにキャッシュされるため、
failureCount 再マウントを含むあらゆる再試行が(フルリロードまで)同じ rejection を返す。
production の AUTH_TURNSTILE 有効化前に解消する裁定(2026-07-25)。

あわせて同レビューの Minor 2 件も同梱する:
- widget の catch / 各 render callback に cancelled ガードがない(アンマウント後発火の防御)
- onload グローバル関数(`window.__plyrsTurnstileOnload`)が resolve 後も残置

## Global Constraints

- `@ts-expect-error`・`any`・fetchMock 禁止。lint 警告 0 / format:check / typecheck 必須。
- TDD 必須(RED → GREEN)。window.turnstile / script 要素は jsdom + vi.stubGlobal で偽装。
- 全コマンドは `cd /home/hiz/work/plyrs/.claude/worktrees/turnstile-load-failure-ux && ...`。
  ブランチ確認・明示パス git add・untracked dotfiles 無視は従来どおり。
- 既存文言・ロール名(E2E 依存)は変えない。siteKey null 時の挙動は不変。
- コメント密度は既存(1〜2 行)に合わせる。

## Task 1: ロード失敗の再試行可能化と可視化

対象: `apps/admin/src/lib/turnstile.ts` / `apps/admin/src/components/turnstile-widget.tsx` /
`apps/admin/src/routes/signup.tsx` / `apps/admin/src/routes/login.tsx` + 各テスト

1. `turnstile.ts`:
   - reject 時に `loadPromise = null` へ戻し、失敗した script 要素を DOM から除去する
     (次回呼び出しで再注入できる状態にする)。onload グローバルも失敗時は削除。
   - resolve 後も `window.__plyrsTurnstileOnload` を delete(Minor 3)。
   - テスト: 失敗 → 再呼び出しで新しい script が注入される(rejected promise の
     再利用ではない)/ 成功後にグローバル関数が消えている。
2. `turnstile-widget.tsx`:
   - props に `onLoadError?: () => void` を追加。loadTurnstile の catch で
     (cancelled でなければ)`onToken(null)` に加えて `onLoadError` を呼ぶ。
   - catch と各 render callback(callback / expired-callback / error-callback)の
     冒頭に cancelled ガードを追加(Minor 2 — remove() 前提への依存を排除)。
   - テスト: ロード失敗 → onLoadError 発火 / アンマウント後の遅延発火では
     onToken・onLoadError とも呼ばれない。
3. signup.tsx / login.tsx(両方同じパターン):
   - onLoadError で「認証ウィジェットの読み込みに失敗しました。再試行するか、
     ページを再読み込みしてください。」等のメッセージを既存のエラー表示枠
     (role=alert 相当 — 既存の error 表示の仕組みを再利用)に表示し、
     failureCount をインクリメントして再マウント再試行できる導線にする
     (再試行の具体 UI は既存パターンに合わせ最小で — 新規ボタンを足すか
     エラーメッセージ+自動再試行にするかは実装者判断。過剰装備は不要)。
   - テスト: ロード失敗 → メッセージ表示。siteKey null 時は従来どおり(回帰)。
4. GREEN: `pnpm --filter @plyrs/admin test` 全件 + typecheck + ルート lint / format:check。

## 完了ゲート

- ルート `pnpm test` / `pnpm typecheck` / `pnpm lint` / `pnpm format:check`、E2E 3 本。
