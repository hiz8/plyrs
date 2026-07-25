# Minor 掃除(§16 積み残し + 本セッション収集分)

日付: 2026-07-25 / ブランチ: worktree-minor-sweep(基点 791c5a9)

## 背景

ロードマップ §16 の「Minor 積み残し(最終レビューで全件申し送り可と裁定)」約 16 件と、
preview 実機確認セッション(2026-07-24〜25)で収集した 3 件をまとめて掃除する裁定
(2026-07-25)。いずれも Minor — 挙動変更は最小限・防御的な閉じ込めとテスト追補が中心。
production 移行前に main へ載せる。

## Global Constraints(全タスク共通)

- `@ts-expect-error`・`any`・fetchMock 禁止(fetch 差し替えは `vi.spyOn(globalThis, "fetch")`
  か DI)。lint 警告 0 / format:check / typecheck 必須。
- TDD: 挙動変更には先行する失敗テスト。テスト追補のみの項目は「現挙動を固定する」
  テストを書く(RED は不要 — ただし assert が実挙動を検証していること)。
- auth 系テストは test/rate-limit-helper.ts の fake を env に spread(AUTH_LIMITER は
  miniflare がグローバル共有で実シミュレート)。super 系テストは test/super-login.ts の
  resetSuperAdmins で afterEach 掃除。テナント作成は test/create-tenant.ts の direct insert。
- 全コマンドは `cd /home/hiz/work/plyrs/.claude/worktrees/minor-sweep && ...`。コミット前に
  `git rev-parse --abbrev-ref HEAD` で `worktree-minor-sweep` を確認。bare git stash 禁止。
  `git add` は明示パスのみ。untracked dotfiles は絶対に add しない。
- 既存コメント密度(1〜2 行)・命名・idiom に合わせる。項目ごとの過剰リファクタ禁止
  (YAGNI — 記載スコープのみ)。
- drizzle migration が必要になる項目はない(あると気づいたら BLOCKED で報告)。
- admin の routeTree 再生成は不要(ルート追加なし)。

## Task 1: api — モジュール/キュー/テスト系(5 件)

対象: apps/api/src/modules/enablement.ts / apps/api/src/modules/module-alarms.ts /
apps/api/src/index.ts / 対応テスト / apps/api/test?/control-plane.test.ts

1. **hasValidPermissionsShape が配列を通す**(enablement.ts): 冒頭に
   `Array.isArray` チェックを足して配列を全閉。回帰テスト(配列 → 不正扱い)。
2. **runModuleAlarmHandler の未使用 moduleId 引数**(module-alarms.ts): 未使用引数を
   除去し呼び出し側を追随(公開シグネチャなら現状維持を報告 — 実態を見て判断)。
3. **env サフィックス付き modules キュー実配送の直接テストなし**(index.ts の queue()):
   `plyrs-modules-preview` / `plyrs-modules-preview-dlq` など環境サフィックス付き
   キュー名でも判別(endsWith("-dlq") 優先 → startsWith("plyrs-modules"))が正しく
   働くことの直接テストを追加。
4. **index.ts queue() doc コメントのドリフト**: 実装と食い違っている記述を実装に
   合わせて修正(実装は変えない)。
5. **control-plane.test.ts の到達しないフォールバック**: 到達しないフォールバック
   コード(テスト内)を削除または到達可能に修正。

## Task 2: api — auth/super 系(7 件)

対象: apps/api/src/routes/auth.ts / public-write.ts(statusFor の所在は要確認)/
apps/api/src/routes/super.ts / apps/api/src/auth/ban.ts / super-auth.ts / docs/deploy.md

1. **turnstileToken 空文字の 403 化**(auth.ts:21): `z.string().max(2048).optional()` に
   `min(1)` を足し、空文字を 400(zod 検証)で早期拒否(現在は siteverify まで行って
   403 turnstile_failed になる)。
2. **statusFor の「`:` 含み → 409」の広さ**: 対象コードを特定し、`:` を含むだけで 409 に
   する判定を実際の衝突条件に狭める…のが §16 の含意だが、**挙動を変えるリスクが
   スコープに見合わなければ「現挙動を固定するテスト + コメントで広さを明文化」に
   格下げしてよい**(判断を報告に明記)。
3. **super テナント作成 slug TOCTOU の素 500**(super.ts): 併発時 UNIQUE 制約違反が
   素の 500 になる — SqliteError を捕捉して 409 `{ error: "slug_taken" }` へ。
   回帰テスト(直接 insert で先取りした slug に対する作成 → 409)。
4. **users 検索 LIKE の % _ 未エスケープ + membershipCount=0 未テスト**(super.ts:164
   付近): LIKE 検索語の `%` `_` `\` をエスケープ(escape 句)。membershipCount=0 の
   ユーザーが一覧に出るケースのテストを追加。
5. **banUserEverywhere の逐次 disconnect**(auth/ban.ts): 逐次 await の disconnect を
   Promise.all(または allSettled — 失敗時方針は既存に合わせる)で並列化。
6. **/super-auth/me の削除済み admin email null**(super-auth.ts): 削除済み admin の
   セッションで /super-auth/me が email null を返すケースの明示テスト(挙動は現状維持
   — admin UI は me.email ?? me.adminId 表示で対応済み)。
7. **Turnstile ペア設定の明文化**(docs/deploy.md §2): AUTH_TURNSTILE_SECRET_KEY と
   AUTH_TURNSTILE_SITE_KEY は**ペアで設定・解除**すること、secret のみ設定すると
   「ウィジェット非表示のまま全 signup/login が 400」になる旨を追記(コード変更なし)。

## Task 3: admin — super UI 系(5 件)

対象: apps/admin/src/routes/super/ 配下 / 対応テスト

1. **DLQ 再投入・再配布ボタンの isPending disable なし**(super/dlq.tsx・super/modules.tsx):
   mutation の isPending 中はボタンを disable(二重発火防止)。テストで固定。
2. **super 4 ページの styles 複製**: super 配下ページの重複 stylex 定義を共通モジュール
   (例: super/styles.ts)へ抽出。見た目の変更なし(スナップショット的に既存テストが
   green のままであること)。
3. **super/route.tsx「401 以外再送出」の直接テスト**: beforeLoad が 401 以外
   (例: 500)の SuperApiError を再送出することの直接テスト。
4. **ログアウトクリック遷移テスト**: super シェルのログアウトボタン → /super-login へ
   遷移(+ queryClient クリア)を検証するテスト。
5. **rename・unban・ownerEmail 省略 body の専用テスト**: super テナント rename /
   users unban / テナント作成 ownerEmail 省略の各リクエスト body・応答の専用テスト
   (admin 側 or api 側 — §16 の文脈に合わせ実装を見て適切な側に追加。既存テストの
   重複があればスキップし報告)。

## Task 4: admin — datetime ヒント + server-routing テスト追補(2 件)

対象: apps/admin/src/components/record-form.tsx / apps/admin/src/lib/server-routing.test.ts

1. **datetime フィールドの形式ヒント**(record-form.tsx:407 の datetime ケース):
   TextField に placeholder(`2026-10-01T00:20:00Z` 等の例示)と、説明テキスト
   (UTC の Z 終端 ISO 8601 のみ受理される旨)を追加。検証エラー時のメッセージが
   「Invalid input」のみで形式が伝わらない問題も、フィールド近傍の説明で補う
   (バリデーション自体は metamodel の管轄なので変えない)。TextField の
   description/placeholder サポートは @plyrs/ui の実装を確認して使えるものを使う。
   テストで placeholder/説明の存在を固定。
2. **server-routing テスト追補**: `/public/v1` 完全一致(trailing segment なし)の
   devProxyPublic 分岐と、Sec-Fetch-Dest も Accept もない素の GET(ヘッダなし)の
   フォールスルー("ssr")のテストを追加(実装変更なし)。

## 完了ゲート(ブランチ全体 — 最終レビュー前)

- ルートで `pnpm test` / `pnpm typecheck` / `pnpm lint`(警告 0)/ `pnpm format:check`。
- E2E 3 本。

## マージ後(コントローラ)

- main へ ff マージ → push → Deploy/CI green 確認。その後 production 移行フェーズへ。
