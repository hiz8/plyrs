# Phase 10: 特権テナント + 運用 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 特権ログイン分離(パスワード + TOTP 必須)・テナント CRUD・super 権限と監査ログ・健全性チェック・DLQ 運用・デプロイパイプライン(preview/production)・E2E(Playwright)薄い導入を一体で実装する。

**Architecture:** 特権系は既存コントロールプレーン(中央 D1)に super_admins / super_sessions / audit_logs / dead_letters を追加し、通常ユーザーと物理的に交差しない別ログイン経路(/super-auth)+ super セッション cookie 直認証の管理 API(/super/v1)として api Worker に同居させる。DO への特権操作は Worker(信頼境界)が合成 AuthContext を渡して第2段認可を飛び越え、行使は必ず audit_logs に記録する。admin Worker に /super ルートツリーを追加し、プロキシ転送プレフィックスを拡張する。

**Tech Stack:** 既存スタック(Hono / drizzle / jose / pool-workers / TanStack Start / RTL)+ WebCrypto TOTP(RFC 6238 自前実装・依存追加なし)+ @playwright/test(新規 devDependency)。

## 裁定事項(2026-07-18 ユーザー確定・全タスクの前提)

1. **特権認証 = パスワード + TOTP 必須**(RFC 6238 / WebCrypto HMAC-SHA1 自前実装)。passkey は将来格上げ枠として温存。
2. **特権アカウント = 別テーブル完全分離**(super_admins / super_sessions / 別 cookie)。通常 users と交差ゼロ。
3. **監査ログ = 中央 D1 の audit_logs テーブル**(append-only。削除 API は作らない)。
4. **ブロックリスト = (userId, tenantId) 粒度の KV キーを追加した二層**(グローバル BAN + テナント単位)。BAN は §7 どおり disconnectUser 併呼。
5. **E2E = スモーク 3 本前後**(コアジャーニー / 特権コンソール / 2 タブ WS 同期)。IME・ドラッグ系は手動のまま。
6. **運用機能 = 全部入り**: 健全性チェック束(archived 公開中 / レガシー asset 型 / 旧形式 richtext / 孤児 R2)+ DLQ 一覧・手動リプレイ + 再投影・型再配布トリガー + §6 セキュリティ束。墓標周期 GC / QPS 監視 / getPublishedPage バイト予算 / 公開 read レート制限は見送り(申し送りへ)。
7. **§15 Minor 冒頭掃除 = 実害系 + 隣接の 3 件のみ**(permissions JSON.parse / モジュール拒否コードの HTTP 不一致 / runModuleAlarm throw 隔離)。
8. **デプロイ = wrangler env(preview / production)+ GitHub Actions**(main push → preview 自動、production は workflow_dispatch 手動)。§15-2 の 3 点はこの中で消化。
9. **テナント作成は super 専用化**(一般の POST /v1/tenants と admin の作成フォームを廃止。Phase 3 の暫定開放を閉じ、signup → DO 無限作成のコスト攻撃面も閉じる)。
10. **E2E の公開 API 到達は dev 限定転送**(admin server.ts に DEV_PROXY_PUBLIC=1 のときだけ /public/v1 を転送。本番は 6a 裁定どおり転送しない)。

## 設計確定事項(コントローラ裁定・計画作成時)

- **DLQ park は「キュー内滞留」から「D1 退避」へ変更**: plyrs-projection-dlq / plyrs-modules-dlq に consumer を付け、**durable な D1 insert(dead_letters)完了後にのみ ack** する。§9 の「consumer を付けない」の意図 =「黙って ack しない」は「ack より先に永続化する」で保存され、一覧・リプレイが D1 読みで実装できる(Queues HTTP Pull API + 外部 API トークンを回避)。wrangler.jsonc の当該コメントも書き換えること。
- **super ルートは JWT 不使用**: /super/v1 は毎リクエスト super セッション cookie を D1 照会(低頻度な管理操作で D1 1 回は許容。JWT 面を増やさない)。DO RPC へは `superAuthContext()` の合成 AuthContext(`userId: "super:<adminId>"`, `role: "owner"`)を渡す — §11.6「第2段を飛び越える」の実装形。行使は呼び出し元ルートで必ず writeAudit。
- **TOTP は単段ログイン**(email + password + totpCode を 1 リクエスト。中間状態セッションなし)。リプレイ防止は super_admins.totp_last_counter(受理済み counter 以下を拒否)。時計ずれは ±1 step 許容。
- **bootstrap 経路**: super_admins が 0 行のときのみ POST /super-auth/bootstrap が有効(以後 403)。応答で TOTP secret + otpauth URI を返し、初回ログインが登録確認を兼ねる。紛失時は手動 SQL(手順書に記載)。
- **監査は操作成功後に await で書く**(失敗は 500 として表面化 — best-effort にしない)。
- **membership ブロックの KV キーは expirationTtl 1200 秒**(JWT 15 分 + マージン。失効後は D1 の membership 不在が引き継ぐため自己清掃)。グローバル BAN キーは無期限(従来どおり)。
- **auth 用 Turnstile は別 var**(AUTH_TURNSTILE_SECRET_KEY / AUTH_TURNSTILE_SITE_KEY、**optional**)。設定時のみ signup/login で必須。公開 write の TURNSTILE_SECRET_KEY(fail-closed)とはブラスト半径を分離(テスト全滅を防ぐ)。
- **JWT_SECRET 最小長 32 字**。テスト値を 39 字へ更新(`test-secret-do-not-use-in-prod-0123456789` — 既存 30 字のままだと全テストが 500 になる)。ガードは /auth・/v1・/super-auth・/super/v1 のみ(公開 read は JWT 不使用のため巻き込まない)。
- **テナント slug は不変**(rename は name のみ)。slug 変更は §14-3(凍結 embed URL)未解決のため実装しない。
- **テナント削除の順序**: control-plane 行削除(新規トークン発行を止める)→ KV slug cache 削除 → DO wipe(全ソケット切断 + deleteAlarm + deleteAll)→ 投影 D1 5 テーブル削除 → R2 prefix 削除。

## Global Constraints

- 全コマンドは `cd <worktree> && ...` で実行。コミット前に `git rev-parse --abbrev-ref HEAD` を確認。
- TS strict / `@ts-expect-error`・`any` 禁止 / oxlint 警告 0 / oxfmt(`pnpm format:check`)clean。
- コミット件名は 50 字以内。git add は明示パスのみ。bare `git stash` 禁止。
- 外部 fetch のモックは `vi.spyOn(globalThis, "fetch")`(apps/api/test/public-write.test.ts が様式。fetchMock は削除済み API)。
- `pnpm --filter X test -- <pattern>` は効かない。`pnpm --filter X exec vitest run <pattern>` を使う。
- drizzle migration は `pnpm --filter @plyrs/db generate:d1`(実生成。手書き SQL は `drizzle-kit generate --custom` のみ)。records テーブルの再ビルド禁止(§5 規約)。
- admin のルート追加後は routeTree.gen.ts 再生成が必要(`pnpm --filter @plyrs/admin build`)— sandbox EROFS のためコントローラ二段方式(実装サブエージェントは生成物を触らず、コントローラが生成 → コミット)。
- wrangler.jsonc の binding 追加後は `pnpm --filter @plyrs/api cf-typegen` / `pnpm --filter @plyrs/admin cf-typegen` で worker-configuration.d.ts を再生成してコミット。
- tenant_modules を書くテストは afterEach で必ず戻す(共有 D1 --no-isolate のリーク対策。test/module-flow.test.ts が様式)。
- ワークツリー直下の `.bashrc` / `.gitconfig` / `.claude/settings.json` 等の untracked エントリは sandbox のマスク。無視する(add も削除も不要)。
- RPC の戻り値は apps/api/src/rpc-unwrap.ts の型付きアンラップ様式(`Rpc.Serializable` の never 潰れ対策)。
- 完了報告前にルートで `pnpm lint` を必ず実行し出力を貼る。

## File Structure(このフェーズで触るファイルの全体像)

```
packages/db/src/control-plane.ts            [変更] super_admins / super_sessions / audit_logs / dead_letters 追加
packages/db/drizzle-d1/0002_*.sql           [生成] 上記 4 テーブル
packages/db/drizzle-d1/0003_*.sql           [生成 --custom] email 小文字化
apps/api/src/auth/totp.ts                   [新規] RFC 6238(base32 / HOTP / verify / otpauth URI)
apps/api/src/auth/email.ts                  [新規] normalizeEmail
apps/api/src/auth/session.ts                [変更] token 生成/sha256Hex を export・purgeExpiredSessions
apps/api/src/auth/super-session.ts          [新規] super セッション(別 cookie)
apps/api/src/auth/blocklist.ts              [変更] (userId, tenantId) 粒度の二層化
apps/api/src/auth/ban.ts                    [新規] banUserEverywhere / revokeMembership(disconnectUser 併呼)
apps/api/src/audit.ts                       [新規] writeAudit
apps/api/src/middleware/tenant-gate.ts      [変更] membership ブロック照会追加
apps/api/src/middleware/super-gate.ts       [新規] super セッション認証
apps/api/src/middleware/sane-secret.ts      [新規] JWT_SECRET 最小長ガード
apps/api/src/routes/auth.ts                 [変更] __Host- / 正規化 / レート制限 / 条件付き Turnstile / login blocked
apps/api/src/routes/super-auth.ts           [新規] status / bootstrap / login / logout / me
apps/api/src/routes/super.ts                [新規] /super/v1(テナント CRUD・users・health・orphan・DLQ・reproject・redistribute)
apps/api/src/routes/tenants.ts              [変更] tenantAdminRoutes 撤去(slug 定数と schema は残す)
apps/api/src/ops/tenant-delete.ts           [新規] カスケード削除
apps/api/src/ops/dead-letters.ts            [新規] DLQ park / replay
apps/api/src/tenant-do.ts                   [変更] healthCheck / listAssetR2Keys / wipeTenant RPC
apps/api/src/index.ts                       [変更] ルート配線 / DLQ consumer 分岐 / scheduled ハンドラ
apps/api/src/modules/module-alarms.ts       [変更] 冒頭掃除(throw 隔離)
apps/api/src/modules/enablement.ts          [変更] 冒頭掃除(permissions JSON.parse 防御)
apps/api/src/routes/tenant.ts               [変更] 冒頭掃除(statusFor の ':' 含み 409)
apps/api/wrangler.jsonc                     [変更] AUTH_LIMITER / DLQ consumers / crons / env.preview / env.production
apps/admin/src/lib/api-paths.ts             [変更] /super-auth・/super/v1 追加
apps/admin/src/server.ts                    [変更] DEV_PROXY_PUBLIC 時の /public/v1 転送
apps/admin/src/lib/super-api.ts             [新規] super 用 fetch ラッパー
apps/admin/src/routes/super-login.tsx       [新規] bootstrap + TOTP ログイン
apps/admin/src/routes/super/route.tsx       [新規] 特権シェル(ガード + nav)
apps/admin/src/routes/super/index.tsx       [新規] テナント一覧・作成・rename・削除
apps/admin/src/routes/super/tenants.$tenantId.tsx [新規] 詳細(members / health / orphan / reproject)
apps/admin/src/routes/super/users.tsx       [新規] ユーザー検索・BAN
apps/admin/src/routes/super/dlq.tsx         [新規] DLQ 一覧・リプレイ
apps/admin/src/routes/super/audit.tsx       [新規] 監査ログ一覧
apps/admin/src/routes/super/modules.tsx     [新規] モジュール一覧・再配布
apps/admin/src/routes/tenants.tsx           [変更] 作成フォーム撤去
apps/admin/wrangler.jsonc                   [変更] vars / env.preview / env.production
apps/e2e/                                   [新規] Playwright(config + 3 spec + helpers)
.github/workflows/ci.yml                    [変更] e2e ジョブ追加
.github/workflows/deploy.yml                [新規] preview 自動 / production 手動
docs/deploy.md                              [新規] リソース作成・secret・bootstrap 手順書
```

---

### Task 1: 冒頭掃除(§15 実害系 3 件)

**Files:**
- Modify: `apps/api/src/modules/enablement.ts`(module_registry.permissions の JSON.parse 箇所)
- Modify: `apps/api/src/routes/tenant.ts:43`(statusFor)
- Modify: `apps/api/src/modules/module-alarms.ts`(runModuleAlarm)
- Test: `apps/api/test/module-flow.test.ts`(追記)ほか各所

**Interfaces:**
- Produces: `statusFor` は `:` 含みコード(モジュール拒否コード)で 409 を返す。壊れた permissions 行は `[]` として扱われ RPC は throw しない。モジュール alarm ハンドラの throw は他モジュールの alarm 実行を妨げない。

- [ ] **Step 1: 失敗するテストを書く(3 本)**

(a) permissions JSON.parse 防御 — apps/api/test/module-flow.test.ts に追記:

```ts
it("tolerates a corrupted permissions row in module_registry", async () => {
  const tenantId = crypto.randomUUID();
  const stub = env.TENANT_DO.get(env.TENANT_DO.idFromName(tenantId));
  await stub.enableModule(tenantId, "booking", ownerAuth(tenantId));
  await runInDurableObject(stub, (instance: TenantDO) => {
    instance.ctx.storage.sql.exec(
      "UPDATE module_registry SET permissions = 'not-json' WHERE module_id = 'booking'",
    );
  });
  // 壊れた行があっても一覧 RPC は throw しない(permissions は空として扱う)
  const modules = await stub.listModules();
  expect(Array.isArray(modules)).toBe(true);
});
```

(ownerAuth 等のヘルパ名・enable の引数形は同ファイルの既存テストの様式に合わせること。module_registry の実カラム名も同ファイル/enablement.ts で確認して合わせる。)

(b) statusFor — モジュール拒否コードの管理 API ステータス。既存の管理 HTTP 経路テスト(booking の slot_full などを踏むテストがあるファイル。無ければ test/module-flow.test.ts に HTTP 経由で予約枠を溢れさせるケースを追記)で、管理 API 応答が **409** であることをアサート(現行は既定 400)。既存テストが 400 を期待していたら 409 へ更新。

```ts
// 期待: モジュール拒否(`booking:slot_full` 等の ':' 含みコード)は管理 API でも 409
expect(response.status).toBe(409);
```

(c) runModuleAlarm throw 隔離 — module-alarms.ts の実装を読み、runModuleAlarm(相当関数)にレジストリ注入シームを足して直接テスト:

```ts
it("isolates a throwing module alarm handler", async () => {
  // 2 モジュールぶんの alarm を登録し、1 本目のハンドラが throw しても
  // 2 本目が実行され、呼び出し自体も throw しないことを固定する。
  // (シグネチャは module-alarms.ts の実装に合わせ、registry を引数注入する)
});
```

- [ ] **Step 2: テストが FAIL することを確認**

Run: `cd <worktree> && pnpm --filter @plyrs/api exec vitest run module`
Expected: 新規 3 テストが FAIL(throw / 400 / ハンドラ連鎖停止)

- [ ] **Step 3: 最小実装**

(a) enablement.ts — permissions を読む全箇所を安全化:

```ts
function safeParsePermissions(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === "string") : [];
  } catch {
    // 壊れた行でテナント全体の RPC を落とさない(§15 Minor: JSON.parse 無防御)
    return [];
  }
}
```

(b) tenant.ts statusFor:

```ts
function statusFor(code: string): ContentfulStatusCode {
  const mapped = ERROR_STATUS[code];
  if (mapped !== undefined) {
    return mapped;
  }
  // モジュール拒否コード(`moduleId:reason`)は公開 write(409)と揃える(§15-4)
  return code.includes(":") ? 409 : 400;
}
```

(c) module-alarms.ts — モジュール単位 try/catch(ensureAssetContentType と同じテナント全損回避の規律):

```ts
try {
  await handler(/* 既存の引数 */);
} catch (error) {
  console.error("module alarm handler failed", moduleId, error);
  // 他モジュールの alarm 実行は続行する
}
```

- [ ] **Step 4: テストが PASS することを確認**

Run: `cd <worktree> && pnpm --filter @plyrs/api exec vitest run module`
Expected: PASS(既存テスト含め全 green)

- [ ] **Step 5: コミット**

```bash
git add apps/api/src/modules/enablement.ts apps/api/src/routes/tenant.ts apps/api/src/modules/module-alarms.ts apps/api/test/
git commit -m "fix: Phase 9 実害系 Minor 3 件の冒頭掃除"
```

---

### Task 2: control-plane スキーマ拡張 + migrations

**Files:**
- Modify: `packages/db/src/control-plane.ts`
- Create(生成): `packages/db/drizzle-d1/0002_*.sql` / `packages/db/drizzle-d1/0003_*.sql`
- Test: `packages/db/src/control-plane.test.ts`(追記)

**Interfaces:**
- Produces: drizzle テーブル `superAdmins` / `superSessions` / `auditLogs` / `deadLetters`(`@plyrs/db/control-plane` から import 可能)。email は既存行含め小文字に正規化済み。

- [ ] **Step 1: 失敗するテストを書く**

packages/db/src/control-plane.test.ts に追記(既存テストの様式 = テーブル定義の形をアサートする方式に合わせる):

```ts
import { auditLogs, deadLetters, superAdmins, superSessions } from "./control-plane";

it("defines super admin tables separated from users", () => {
  expect(getTableConfig(superAdmins).name).toBe("super_admins");
  expect(getTableConfig(superSessions).name).toBe("super_sessions");
  const columns = getTableConfig(superAdmins).columns.map((c) => c.name);
  expect(columns).toEqual(
    expect.arrayContaining(["id", "email", "password_hash", "totp_secret", "totp_last_counter", "created_at"]),
  );
});

it("defines audit_logs and dead_letters", () => {
  expect(getTableConfig(auditLogs).columns.map((c) => c.name)).toEqual(
    expect.arrayContaining(["id", "actor_id", "action", "target_type", "target_id", "detail", "created_at"]),
  );
  expect(getTableConfig(deadLetters).columns.map((c) => c.name)).toEqual(
    expect.arrayContaining(["id", "queue", "body", "failed_at", "replayed_at"]),
  );
});
```

- [ ] **Step 2: FAIL 確認** — Run: `pnpm --filter @plyrs/db exec vitest run control-plane` → import エラーで FAIL

- [ ] **Step 3: スキーマ実装**

packages/db/src/control-plane.ts 末尾に追加:

```ts
// design-spec §11.6: 特権アカウントは通常 users と別テーブルで完全分離(「同じ扉に置かない」の物理表現)。
// totp_last_counter は受理済み TOTP counter(以下の値のコードを拒否 = リプレイ防止)。
export const superAdmins = sqliteTable(
  "super_admins",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    totpSecret: text("totp_secret").notNull(),
    totpLastCounter: integer("totp_last_counter").notNull().default(0),
    createdAt: text("created_at").notNull(),
  },
  (table) => [uniqueIndex("idx_super_admins_email").on(table.email)],
);

export const superSessions = sqliteTable(
  "super_sessions",
  {
    id: text("id").primaryKey(),
    tokenHash: text("token_hash").notNull(),
    adminId: text("admin_id").notNull(),
    expiresAt: text("expires_at").notNull(),
    createdAt: text("created_at").notNull(),
    revokedAt: text("revoked_at"),
  },
  (table) => [
    uniqueIndex("idx_super_sessions_token_hash").on(table.tokenHash),
    index("idx_super_sessions_admin").on(table.adminId),
  ],
);

// design-spec §11.6: 強い権限には記録を伴わせる。append-only(削除 API は作らない)。
export const auditLogs = sqliteTable(
  "audit_logs",
  {
    id: text("id").primaryKey(),
    actorId: text("actor_id").notNull(),
    action: text("action").notNull(), // 'tenant.create' | 'user.ban' | ... (apps/api 側 audit.ts が語彙の真実源)
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    detail: text("detail").notNull(), // JSON
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("idx_audit_logs_created").on(table.createdAt),
    index("idx_audit_logs_target").on(table.targetType, table.targetId),
  ],
);

// Phase 10 裁定: DLQ は「キュー内滞留」ではなく D1 へ退避(ack は durable insert 後)。
// id は Queues の message.id(再配達の冪等キー)。queue は元キュー名(-dlq を剥いだもの)。
export const deadLetters = sqliteTable(
  "dead_letters",
  {
    id: text("id").primaryKey(),
    queue: text("queue").notNull(),
    body: text("body").notNull(), // ジョブ JSON
    failedAt: text("failed_at").notNull(),
    replayedAt: text("replayed_at"),
  },
  (table) => [index("idx_dead_letters_queue").on(table.queue, table.failedAt)],
);
```

- [ ] **Step 4: PASS 確認** — Run: `pnpm --filter @plyrs/db exec vitest run control-plane` → PASS

- [ ] **Step 5: migration 実生成 + email 小文字化 custom migration**

```bash
cd <worktree> && pnpm --filter @plyrs/db generate:d1
cd <worktree> && pnpm --filter @plyrs/db exec drizzle-kit generate --config drizzle-d1.config.ts --custom --name normalize-email-lowercase
```

生成された custom migration(0003_normalize-email-lowercase.sql)に手書き:

```sql
-- §6 セキュリティ束: email 小文字正規化(以後の書き込みはアプリ側 normalizeEmail が担保)。
-- 大文字小文字違いの重複が既存 D1 にあると一意制約で失敗するが、実データは開発用のみで許容(手順書に注記)。
UPDATE users SET email = lower(email);
```

生成物 2 ファイルの内容を実際に開いて確認(0002 に 4 テーブルの CREATE TABLE、0003 に上記 UPDATE)。

- [ ] **Step 6: api 側の migration 適用テストが通ることを確認**

Run: `cd <worktree> && pnpm --filter @plyrs/api exec vitest run apply-migrations auth`
Expected: PASS(readD1Migrations が新 migration を拾い、既存テストが崩れない)

- [ ] **Step 7: コミット**

```bash
git add packages/db/src/control-plane.ts packages/db/src/control-plane.test.ts packages/db/drizzle-d1/
git commit -m "feat: 特権・監査・DLQ の control-plane スキーマ"
```

---

### Task 3: TOTP(RFC 6238)実装

**Files:**
- Create: `apps/api/src/auth/totp.ts`
- Test: `apps/api/src/auth/totp.test.ts`

**Interfaces:**
- Produces: `generateTotpSecret(): string`(base32)/ `generateTotpCode(secretBase32: string, nowMs: number): Promise<string>` / `verifyTotpCode(secretBase32: string, code: string, nowMs: number): Promise<number | null>`(一致した counter。不一致は null)/ `otpauthUri(email: string, secretBase32: string): string`。Task 6 のログインと E2E ヘルパが使う。

- [ ] **Step 1: 失敗するテストを書く**

apps/api/src/auth/totp.test.ts(RFC 6238 Appendix B の SHA-1 ベクタを 6 桁に切り詰めて使用。secret は ASCII `12345678901234567890` = base32 `GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ`):

```ts
import { describe, expect, it } from "vitest";
import { base32Decode, generateTotpCode, generateTotpSecret, otpauthUri, verifyTotpCode } from "./totp";

const RFC_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

describe("totp", () => {
  it("matches RFC 6238 SHA-1 test vectors (6 digits)", async () => {
    expect(await generateTotpCode(RFC_SECRET, 59_000)).toBe("287082"); // T=59 → 94287082
    expect(await generateTotpCode(RFC_SECRET, 1_111_111_109_000)).toBe("081804"); // → 07081804
    expect(await generateTotpCode(RFC_SECRET, 1_111_111_111_000)).toBe("050471"); // → 14050471
  });

  it("verifies with ±1 step drift and returns the matched counter", async () => {
    const code = await generateTotpCode(RFC_SECRET, 59_000); // counter 1
    expect(await verifyTotpCode(RFC_SECRET, code, 59_000)).toBe(1);
    expect(await verifyTotpCode(RFC_SECRET, code, 89_000)).toBe(1); // drift -1
    expect(await verifyTotpCode(RFC_SECRET, code, 29_000)).toBe(1); // drift +1
    expect(await verifyTotpCode(RFC_SECRET, code, 149_000)).toBeNull(); // 2 step 先は拒否
  });

  it("rejects malformed codes and secrets", async () => {
    expect(await verifyTotpCode(RFC_SECRET, "12345", 59_000)).toBeNull();
    expect(await verifyTotpCode(RFC_SECRET, "abcdef", 59_000)).toBeNull();
    expect(await verifyTotpCode("!!invalid!!", "287082", 59_000)).toBeNull();
  });

  it("generates a 32-char base32 secret that roundtrips", () => {
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(base32Decode(secret)).toHaveLength(20);
  });

  it("builds an otpauth URI with issuer and encoded label", () => {
    expect(otpauthUri("a@b.com", RFC_SECRET)).toBe(
      `otpauth://totp/plyrs:a%40b.com?secret=${RFC_SECRET}&issuer=plyrs&algorithm=SHA1&digits=6&period=30`,
    );
  });
});
```

- [ ] **Step 2: FAIL 確認** — Run: `pnpm --filter @plyrs/api exec vitest run totp` → モジュール不在で FAIL

- [ ] **Step 3: 実装**

apps/api/src/auth/totp.ts:

```ts
// RFC 6238 TOTP(SHA-1 / 6 桁 / 30 秒 step)。WebCrypto のみで実装し依存を増やさない。
// SHA-1 は HMAC 用途では現行 authenticator アプリの互換既定(RFC 4226 準拠)。
const STEP_SECONDS = 30;
const DIGITS = 6;
const SECRET_BYTES = 20;
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

export function base32Decode(encoded: string): Uint8Array | null {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of encoded.toUpperCase().replace(/=+$/, "")) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) {
      return null;
    }
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

export function generateTotpSecret(): string {
  return base32Encode(crypto.getRandomValues(new Uint8Array(SECRET_BYTES)));
}

async function hotp(secret: Uint8Array, counter: number): Promise<string> {
  const message = new ArrayBuffer(8);
  const view = new DataView(message);
  view.setUint32(0, Math.floor(counter / 2 ** 32));
  view.setUint32(4, counter >>> 0);
  const key = await crypto.subtle.importKey(
    "raw",
    secret as BufferSource,
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, message));
  const offset = (mac[mac.length - 1] ?? 0) & 0x0f;
  const code =
    (((mac[offset] ?? 0) & 0x7f) << 24) |
    ((mac[offset + 1] ?? 0) << 16) |
    ((mac[offset + 2] ?? 0) << 8) |
    (mac[offset + 3] ?? 0);
  return (code % 10 ** DIGITS).toString().padStart(DIGITS, "0");
}

export async function generateTotpCode(secretBase32: string, nowMs: number): Promise<string> {
  const secret = base32Decode(secretBase32);
  if (secret === null) {
    throw new Error("invalid base32 secret");
  }
  return hotp(secret, Math.floor(nowMs / 1000 / STEP_SECONDS));
}

// 一致した counter を返す(呼び出し側が totp_last_counter との単調性でリプレイを拒否する)。
export async function verifyTotpCode(
  secretBase32: string,
  code: string,
  nowMs: number,
): Promise<number | null> {
  if (!/^\d{6}$/.test(code)) {
    return null;
  }
  const secret = base32Decode(secretBase32);
  if (secret === null) {
    return null;
  }
  const counter = Math.floor(nowMs / 1000 / STEP_SECONDS);
  for (const drift of [0, -1, 1]) {
    const candidate = counter + drift;
    if (candidate >= 0 && (await hotp(secret, candidate)) === code) {
      return candidate;
    }
  }
  return null;
}

export function otpauthUri(email: string, secretBase32: string): string {
  return `otpauth://totp/plyrs:${encodeURIComponent(email)}?secret=${secretBase32}&issuer=plyrs&algorithm=SHA1&digits=6&period=30`;
}
```

- [ ] **Step 4: PASS 確認** — Run: `pnpm --filter @plyrs/api exec vitest run totp` → PASS

- [ ] **Step 5: コミット**

```bash
git add apps/api/src/auth/totp.ts apps/api/src/auth/totp.test.ts
git commit -m "feat: WebCrypto による RFC 6238 TOTP 実装"
```

---

### Task 4: §6 セキュリティ束

**Files:**
- Create: `apps/api/src/middleware/sane-secret.ts` / `apps/api/src/auth/email.ts` / `apps/api/src/auth/rate-limit.ts`
- Modify: `apps/api/src/auth/session.ts`(helpers export + purgeExpiredSessions)/ `apps/api/src/routes/auth.ts` / `apps/api/src/index.ts`(scheduled + middleware)/ `apps/api/wrangler.jsonc`(AUTH_LIMITER / crons)/ `apps/api/vitest.config.ts`(JWT_SECRET 32 字以上へ)
- Test: `apps/api/test/security-bundle.test.ts`(新規)+ 既存 auth 系テストの env 更新

**Interfaces:**
- Consumes: Task 2 の superSessions テーブル。
- Produces: `SESSION_COOKIE = "__Host-plyrs_session"` / `normalizeEmail(email: string): string` / `generateSessionToken(): string`・`sha256Hex(value: string): Promise<string>`(session.ts から export)/ `purgeExpiredSessions(d1: D1Database, now: Date): Promise<void>` / `checkAuthRateLimit(env: Env, ip: string | undefined): Promise<"ok" | "limited" | "unavailable">` / `requireSaneSecret` middleware。Env に `AUTH_LIMITER: RateLimit`・`AUTH_TURNSTILE_SECRET_KEY?: string`・`AUTH_TURNSTILE_SITE_KEY?: string` が増える。

- [ ] **Step 1: wrangler.jsonc 変更 + 型再生成**

apps/api/wrangler.jsonc の unsafe.bindings に追加(既存 PUBLIC_WRITE_LIMITER の隣):

```jsonc
{
  "name": "AUTH_LIMITER",
  "type": "ratelimit",
  "namespace_id": "1002",
  "simple": { "limit": 10, "period": 60 },
},
```

トップレベルに cron を追加:

```jsonc
"triggers": { "crons": ["17 3 * * *"] },
```

Run: `pnpm --filter @plyrs/api cf-typegen`(worker-configuration.d.ts に AUTH_LIMITER が入ることを確認)。AUTH_TURNSTILE_SECRET_KEY / AUTH_TURNSTILE_SITE_KEY は secret / 任意 var のため型が生成されない場合、既存 TURNSTILE_SECRET_KEY と同じ方式(生成型の在り処を確認して同様に宣言)で optional string として型を通す。

- [ ] **Step 2: 失敗するテストを書く**

apps/api/test/security-bundle.test.ts:

```ts
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sessions, superSessions } from "@plyrs/db/control-plane";
import { app } from "../src/index";
import { purgeExpiredSessions } from "../src/auth/session";

function fakeLimiter(succeeds: boolean): RateLimit {
  return { limit: async () => ({ success: succeeds }) } as RateLimit;
}
const baseEnv = (): Env => ({ ...env, AUTH_LIMITER: fakeLimiter(true) }) as Env;
const credentials = { email: "Sec@Example.com", password: "password-123456" };

afterEach(() => vi.restoreAllMocks());

describe("§6 security bundle", () => {
  it("fails closed with a short JWT_SECRET", async () => {
    const res = await app.request("/auth/tenants", {}, { ...baseEnv(), JWT_SECRET: "short" });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "misconfigured" });
  });

  it("issues __Host- prefixed session cookies and normalizes email", async () => {
    const res = await app.request(
      "/auth/signup",
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(credentials) },
      baseEnv(),
    );
    expect(res.status).toBe(201);
    expect(res.headers.get("set-cookie")).toContain("__Host-plyrs_session=");
    // 大文字違いの再 signup は同一 email として 409
    const dup = await app.request(
      "/auth/signup",
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...credentials, email: "sec@example.COM" }) },
      baseEnv(),
    );
    expect(dup.status).toBe(409);
    // 小文字でログインできる
    const login = await app.request(
      "/auth/login",
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "sec@example.com", password: credentials.password }) },
      baseEnv(),
    );
    expect(login.status).toBe(200);
  });

  it("rate-limits signup and login", async () => {
    const limited = { ...baseEnv(), AUTH_LIMITER: fakeLimiter(false) } as Env;
    for (const path of ["/auth/signup", "/auth/login"]) {
      const res = await app.request(
        path,
        { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(credentials) },
        limited,
      );
      expect(res.status).toBe(429);
    }
    const bare = { ...env, AUTH_LIMITER: undefined } as unknown as Env;
    const res = await app.request(
      "/auth/login",
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(credentials) },
      bare,
    );
    expect(res.status).toBe(503);
  });

  it("requires Turnstile on signup/login only when AUTH_TURNSTILE_SECRET_KEY is set", async () => {
    const withTurnstile = { ...baseEnv(), AUTH_TURNSTILE_SECRET_KEY: "auth-secret" } as Env;
    const missing = await app.request(
      "/auth/login",
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(credentials) },
      withTurnstile,
    );
    expect(missing.status).toBe(400);
    expect(await missing.json()).toEqual({ error: "turnstile_required" });

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ success: false }), { status: 200 }),
    );
    const failed = await app.request(
      "/auth/login",
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...credentials, turnstileToken: "tok" }) },
      withTurnstile,
    );
    expect(failed.status).toBe(403);
  });

  it("exposes turnstile site key config", async () => {
    const none = await app.request("/auth/turnstile-config", {}, baseEnv());
    expect(await none.json()).toEqual({ siteKey: null });
    const configured = await app.request(
      "/auth/turnstile-config",
      {},
      { ...baseEnv(), AUTH_TURNSTILE_SITE_KEY: "site-1" } as Env,
    );
    expect(await configured.json()).toEqual({ siteKey: "site-1" });
  });

  it("purges expired and revoked sessions from both session tables", async () => {
    const db = drizzle(env.DB);
    const now = new Date("2026-07-18T00:00:00Z");
    const past = "2020-01-01T00:00:00.000Z";
    const future = "2030-01-01T00:00:00.000Z";
    await db.insert(sessions).values([
      { id: "s-live", tokenHash: "h1", userId: "u", expiresAt: future, createdAt: past },
      { id: "s-expired", tokenHash: "h2", userId: "u", expiresAt: past, createdAt: past },
      { id: "s-revoked", tokenHash: "h3", userId: "u", expiresAt: future, createdAt: past, revokedAt: past },
    ]);
    await db.insert(superSessions).values([
      { id: "ss-live", tokenHash: "h4", adminId: "a", expiresAt: future, createdAt: past },
      { id: "ss-expired", tokenHash: "h5", adminId: "a", expiresAt: past, createdAt: past },
    ]);
    await purgeExpiredSessions(env.DB, now);
    expect((await db.select().from(sessions)).map((r) => r.id)).toEqual(["s-live"]);
    expect((await db.select().from(superSessions)).map((r) => r.id)).toEqual(["ss-live"]);
  });
});
```

- [ ] **Step 3: FAIL 確認** — Run: `pnpm --filter @plyrs/api exec vitest run security-bundle` → FAIL

- [ ] **Step 4: 実装**

(a) apps/api/src/middleware/sane-secret.ts:

```ts
import { createMiddleware } from "hono/factory";

export const MIN_JWT_SECRET_LENGTH = 32;

// §6: 短い JWT_SECRET での運用を fail-closed で拒否する。公開 read(/public/v1)は
// JWT 不使用のためこのガードの外(可用性を巻き込まない)。
export const requireSaneSecret = createMiddleware<{ Bindings: Env }>(async (c, next) => {
  const secret = c.env.JWT_SECRET;
  if (typeof secret !== "string" || secret.length < MIN_JWT_SECRET_LENGTH) {
    return c.json({ error: "misconfigured" }, 500);
  }
  await next();
});
```

(b) apps/api/src/auth/email.ts:

```ts
// §6: email は保存・照合の前に必ずこの正規化を通す(signup / login / super 系 / owner 指定)。
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
```

(c) apps/api/src/auth/rate-limit.ts:

```ts
export type RateLimitDecision = "ok" | "limited" | "unavailable";

// §6: 認証系エンドポイントのレート制限。binding 欠落は設定事故として fail-closed
// (public-write と同じ規律)。key は IP(ローカル/テストは "unknown" に縮退)。
export async function checkAuthRateLimit(
  env: Env,
  ip: string | undefined,
): Promise<RateLimitDecision> {
  const limiter = env.AUTH_LIMITER;
  if (limiter === undefined) {
    return "unavailable";
  }
  const { success } = await limiter.limit({ key: ip ?? "unknown" });
  return success ? "ok" : "limited";
}
```

(d) session.ts — `SESSION_COOKIE` を `"__Host-plyrs_session"` へ変更し、生成部を export に切り出し + purge を追加:

```ts
export const SESSION_COOKIE = "__Host-plyrs_session";

export function generateSessionToken(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function sha256Hex(value: string): Promise<string> { /* 既存実装を export 化 */ }

// §6: 期限切れ・失効済みセッションの掃除(cron から呼ぶ)。
export async function purgeExpiredSessions(d1: D1Database, now: Date): Promise<void> {
  const iso = now.toISOString();
  const db = drizzle(d1);
  await db.batch([
    db.delete(sessions).where(or(lte(sessions.expiresAt, iso), isNotNull(sessions.revokedAt))),
    db
      .delete(superSessions)
      .where(or(lte(superSessions.expiresAt, iso), isNotNull(superSessions.revokedAt))),
  ]);
}
```

(createSession 内の生成コードは generateSessionToken() 呼び出しに置換。import に `superSessions`・`or`・`lte`・`isNotNull` を追加。)

(e) routes/auth.ts — signup/login の冒頭にレート制限 + Turnstile、email 正規化、cookie 削除属性:

```ts
const credentialsSchema = z.object({
  email: z.email().max(254),
  password: z.string().min(12).max(128),
  turnstileToken: z.string().max(2048).optional(),
});

async function requireAuthTurnstile(
  env: Env,
  token: string | undefined,
  ip: string | undefined,
): Promise<"ok" | "required" | "failed"> {
  const secret = env.AUTH_TURNSTILE_SECRET_KEY;
  if (secret === undefined || secret === "") {
    return "ok"; // 未設定なら不要(optional 設計 — 本番有効化は手順書)
  }
  if (token === undefined) {
    return "required";
  }
  return (await verifyTurnstile(secret, token, ip ?? null)) ? "ok" : "failed";
}
```

signup / login 冒頭(zValidator の後):

```ts
const ip = c.req.header("cf-connecting-ip");
const decision = await checkAuthRateLimit(c.env, ip);
if (decision !== "ok") {
  return decision === "limited"
    ? c.json({ error: "rate_limited" }, 429)
    : c.json({ error: "rate_limiter_unavailable" }, 503);
}
const turnstile = await requireAuthTurnstile(c.env, c.req.valid("json").turnstileToken, ip);
if (turnstile !== "ok") {
  return turnstile === "required"
    ? c.json({ error: "turnstile_required" }, 400)
    : c.json({ error: "turnstile_failed" }, 403);
}
const email = normalizeEmail(c.req.valid("json").email);
```

(signup の users 照会・insert、login の照会は正規化済み email を使う。)logout の deleteCookie は `deleteCookie(c, SESSION_COOKIE, { path: "/", secure: true })` に変更(__Host- は secure 必須)。ルータ末尾に追加:

```ts
.get("/turnstile-config", (c) => c.json({ siteKey: c.env.AUTH_TURNSTILE_SITE_KEY ?? null }))
```

(f) index.ts — ガード配線 + scheduled:

```ts
import { requireSaneSecret } from "./middleware/sane-secret";
import { purgeExpiredSessions } from "./auth/session";

app.use("/auth/*", requireSaneSecret);
app.use("/v1/*", requireSaneSecret);
// (/super-auth・/super/v1 は Task 6/7 の配線時に同じガードを併設)

export default {
  fetch: app.fetch,
  async scheduled(_controller: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
    await purgeExpiredSessions(env.DB, new Date());
  },
  async queue(/* 既存のまま */): Promise<void> { /* ... */ },
} satisfies ExportedHandler<Env, ProjectionJob | ModuleQueueJob>;
```

(g) vitest.config.ts の JWT_SECRET を `"test-secret-do-not-use-in-prod-0123456789"`(41 字)へ更新。

- [ ] **Step 5: 既存テストの回復**

Run: `pnpm --filter @plyrs/api test`
既存の auth / e2e 系テストで (1) AUTH_LIMITER 不在で 503 になるもの、(2) cookie 名 `plyrs_session` を直書きしているものを修復する。修復方針: 各テストの env 構築箇所に `AUTH_LIMITER: fakeLimiter(true)` を足す(security-bundle.test.ts の fakeLimiter を test/rate-limit-helper.ts へ抽出して共有可)。cookie 名は SESSION_COOKIE 定数を import してアサートする形へ置換。
Expected: 全 green

- [ ] **Step 6: コミット**

```bash
git add apps/api/src/middleware/sane-secret.ts apps/api/src/auth/email.ts apps/api/src/auth/rate-limit.ts apps/api/src/auth/session.ts apps/api/src/routes/auth.ts apps/api/src/index.ts apps/api/wrangler.jsonc apps/api/vitest.config.ts apps/api/worker-configuration.d.ts apps/api/test/
git commit -m "feat: §6 セキュリティ束(secret 検証・__Host-・掃除ほか)"
```

---

### Task 5: ブロックリスト二層化 + BAN ヘルパ

**Files:**
- Modify: `apps/api/src/auth/blocklist.ts` / `apps/api/src/middleware/tenant-gate.ts` / `apps/api/src/routes/auth.ts`(/token の membership ブロック + login の blocked)
- Create: `apps/api/src/auth/ban.ts`
- Test: `apps/api/test/blocklist-tiers.test.ts`

**Interfaces:**
- Produces: `isMembershipBlocked / blockMembership / unblockMembership(kv, userId, tenantId)` / `banUserEverywhere(env, userId): Promise<{ disconnected: number }>` / `revokeMembership(env, userId, tenantId): Promise<{ disconnected: number }>`。Task 8 の super ルートが使う。

- [ ] **Step 1: 失敗するテストを書く**

apps/api/test/blocklist-tiers.test.ts:

```ts
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { describe, expect, it } from "vitest";
import { memberships, users } from "@plyrs/db/control-plane";
import { banUserEverywhere, revokeMembership } from "../src/auth/ban";
import { blockMembership, isBlocked, isMembershipBlocked } from "../src/auth/blocklist";
import { signTenantToken } from "../src/auth/jwt";
import { authenticateTenantToken } from "../src/middleware/tenant-gate";

describe("two-tier blocklist", () => {
  it("blocks the gate for a (userId, tenantId) membership block only on that tenant", async () => {
    const userId = crypto.randomUUID();
    const tenantA = crypto.randomUUID();
    const tenantB = crypto.randomUUID();
    const tokenA = await signTenantToken(env.JWT_SECRET, { userId, tenantId: tenantA, role: "editor" });
    const tokenB = await signTenantToken(env.JWT_SECRET, { userId, tenantId: tenantB, role: "editor" });
    await blockMembership(env.BLOCKLIST, userId, tenantA);
    const resultA = await authenticateTenantToken(env, tenantA, tokenA);
    expect(resultA).toMatchObject({ ok: false, failure: { code: "blocked", status: 403 } });
    const resultB = await authenticateTenantToken(env, tenantB, tokenB);
    expect(resultB.ok).toBe(true);
  });

  it("banUserEverywhere sets the global block and touches every membership tenant", async () => {
    const userId = crypto.randomUUID();
    const now = new Date().toISOString();
    const db = drizzle(env.DB);
    await db.insert(users).values({ id: userId, email: `${userId}@x.com`, passwordHash: "h", createdAt: now });
    await db.insert(memberships).values([
      { userId, tenantId: crypto.randomUUID(), role: "editor", createdAt: now },
      { userId, tenantId: crypto.randomUUID(), role: "viewer", createdAt: now },
    ]);
    const { disconnected } = await banUserEverywhere(env, userId);
    expect(await isBlocked(env.BLOCKLIST, userId)).toBe(true);
    expect(disconnected).toBe(0); // ソケット未確立でも DO 呼び出し自体が成立する
  });

  it("revokeMembership deletes the row and blocks the pair", async () => {
    const userId = crypto.randomUUID();
    const tenantId = crypto.randomUUID();
    const db = drizzle(env.DB);
    await db.insert(memberships).values({ userId, tenantId, role: "editor", createdAt: new Date().toISOString() });
    await revokeMembership(env, userId, tenantId);
    expect(await db.select().from(memberships).where(eq(memberships.userId, userId))).toHaveLength(0);
    expect(await isMembershipBlocked(env.BLOCKLIST, userId, tenantId)).toBe(true);
  });
});
```

さらに既存 auth テストのファイルに「blocked ユーザーの login は 403」を追記:

```ts
it("rejects login for a globally blocked user", async () => {
  // signup 済みユーザーを blockUser してから login → 403 { error: "blocked" }
});
```

- [ ] **Step 2: FAIL 確認** — Run: `pnpm --filter @plyrs/api exec vitest run blocklist-tiers` → FAIL

- [ ] **Step 3: 実装**

(a) blocklist.ts に追加:

```ts
// §6 裁定(2026-07-18): (userId, tenantId) 粒度の二層目。TTL は JWT 15 分 + マージン —
// 失効後は D1 の membership 不在(/auth/token の再読込)が引き継ぐため自己清掃で足りる。
const MEMBERSHIP_BLOCK_TTL_SECONDS = 1200;

function membershipKey(userId: string, tenantId: string): string {
  return `blocked:membership:${userId}:${tenantId}`;
}

export async function isMembershipBlocked(
  kv: KVNamespace,
  userId: string,
  tenantId: string,
): Promise<boolean> {
  return (await kv.get(membershipKey(userId, tenantId))) !== null;
}

export async function blockMembership(
  kv: KVNamespace,
  userId: string,
  tenantId: string,
): Promise<void> {
  await kv.put(membershipKey(userId, tenantId), "1", {
    expirationTtl: MEMBERSHIP_BLOCK_TTL_SECONDS,
  });
}

export async function unblockMembership(
  kv: KVNamespace,
  userId: string,
  tenantId: string,
): Promise<void> {
  await kv.delete(membershipKey(userId, tenantId));
}
```

(b) tenant-gate.ts の authenticateTenantToken — グローバル照会の直後に追加:

```ts
if (await isMembershipBlocked(env.BLOCKLIST, claims.userId, tenantId)) {
  return { ok: false, failure: { code: "blocked", status: 403 } };
}
```

(c) routes/auth.ts — /token の membership 照会成功後に `isMembershipBlocked` → 403 blocked を追加。login のパスワード検証成功後に `isBlocked` → 403 blocked を追加。

(d) apps/api/src/auth/ban.ts:

```ts
import { eq, and } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { memberships } from "@plyrs/db/control-plane";
import { blockMembership, blockUser } from "./blocklist";

// §7 申し送り: blockUser(KV)だけでは確立済みソケットが切れない。
// BAN は必ず該当テナント DO の disconnectUser と併呼する。
export async function banUserEverywhere(env: Env, userId: string): Promise<{ disconnected: number }> {
  await blockUser(env.BLOCKLIST, userId);
  const rows = await drizzle(env.DB)
    .select({ tenantId: memberships.tenantId })
    .from(memberships)
    .where(eq(memberships.userId, userId));
  let disconnected = 0;
  for (const row of rows) {
    const stub = env.TENANT_DO.get(env.TENANT_DO.idFromName(row.tenantId));
    disconnected += await stub.disconnectUser(userId);
  }
  return { disconnected };
}

export async function revokeMembership(
  env: Env,
  userId: string,
  tenantId: string,
): Promise<{ disconnected: number }> {
  await drizzle(env.DB)
    .delete(memberships)
    .where(and(eq(memberships.userId, userId), eq(memberships.tenantId, tenantId)));
  await blockMembership(env.BLOCKLIST, userId, tenantId);
  const stub = env.TENANT_DO.get(env.TENANT_DO.idFromName(tenantId));
  const disconnected = await stub.disconnectUser(userId);
  return { disconnected };
}
```

- [ ] **Step 4: PASS 確認** — Run: `pnpm --filter @plyrs/api exec vitest run blocklist-tiers auth` → PASS(既存 auth 系含む)

- [ ] **Step 5: コミット**

```bash
git add apps/api/src/auth/blocklist.ts apps/api/src/auth/ban.ts apps/api/src/middleware/tenant-gate.ts apps/api/src/routes/auth.ts apps/api/test/
git commit -m "feat: (userId,tenantId) 粒度ブロックと BAN ヘルパ"
```

---

### Task 6: super 認証(bootstrap / login / logout / me)+ superGate + 監査ヘルパ

**Files:**
- Create: `apps/api/src/auth/super-session.ts` / `apps/api/src/audit.ts` / `apps/api/src/middleware/super-gate.ts` / `apps/api/src/routes/super-auth.ts`
- Modify: `apps/api/src/index.ts`
- Test: `apps/api/test/super-auth.test.ts`

**Interfaces:**
- Consumes: Task 2 のテーブル、Task 3 の TOTP、Task 4 の normalizeEmail / checkAuthRateLimit / generateSessionToken / sha256Hex。
- Produces: `SUPER_SESSION_COOKIE = "__Host-plyrs_super_session"` / `createSuperSession / lookupSuperSession / revokeSuperSession` / `superGate`(Variables `{ superAdmin: { adminId: string } }`)/ `writeAudit(d1, { actorId, action, targetType, targetId, detail? })` と `AuditAction` 型。HTTP: `GET /super-auth/status` → `{bootstrapped}`、`POST /super-auth/bootstrap` → 201 `{adminId, totpSecret, otpauthUri}`、`POST /super-auth/login` → `{adminId}` + cookie、`POST /super-auth/logout`、`GET /super-auth/me` → `{adminId, email}`。

- [ ] **Step 1: 失敗するテストを書く**

apps/api/test/super-auth.test.ts:

```ts
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { describe, expect, it } from "vitest";
import { auditLogs } from "@plyrs/db/control-plane";
import { generateTotpCode } from "../src/auth/totp";
import { app } from "../src/index";

function fakeLimiter(succeeds: boolean): RateLimit {
  return { limit: async () => ({ success: succeeds }) } as RateLimit;
}
const testEnv = (): Env => ({ ...env, AUTH_LIMITER: fakeLimiter(true) }) as Env;

function post(path: string, body: unknown, cookie?: string): Request {
  return new Request(`https://api.test${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
}
const CREDS = { email: "Root@Example.com", password: "super-password-123" };

function cookieOf(res: Response): string {
  const raw = res.headers.get("set-cookie") ?? "";
  return raw.split(";")[0] ?? "";
}

describe("super auth", () => {
  it("runs the bootstrap → totp login → me → logout lifecycle", async () => {
    const e = testEnv();
    expect(await (await app.request("/super-auth/status", {}, e)).json()).toEqual({ bootstrapped: false });

    const boot = await app.request(post("/super-auth/bootstrap", CREDS), undefined, e);
    expect(boot.status).toBe(201);
    const { adminId, totpSecret, otpauthUri } = (await boot.json()) as {
      adminId: string; totpSecret: string; otpauthUri: string;
    };
    expect(otpauthUri).toContain(totpSecret);
    expect(await (await app.request("/super-auth/status", {}, e)).json()).toEqual({ bootstrapped: true });
    expect((await app.request(post("/super-auth/bootstrap", CREDS), undefined, e)).status).toBe(403);

    // email は小文字化されて保存され、ログインは大文字でも通る
    const badPw = await app.request(
      post("/super-auth/login", { ...CREDS, password: "wrong-password-123", totpCode: "000000" }), undefined, e,
    );
    expect(badPw.status).toBe(401);

    const code = await generateTotpCode(totpSecret, Date.now());
    const login = await app.request(post("/super-auth/login", { ...CREDS, totpCode: code }), undefined, e);
    expect(login.status).toBe(200);
    const cookie = cookieOf(login);
    expect(cookie).toContain("__Host-plyrs_super_session=");

    // 同じコードの再使用(リプレイ)は拒否
    const replay = await app.request(post("/super-auth/login", { ...CREDS, totpCode: code }), undefined, e);
    expect(replay.status).toBe(401);

    // 次の window のコードは counter が前進しているので通る
    const nextCode = await generateTotpCode(totpSecret, Date.now() + 30_000);
    const second = await app.request(post("/super-auth/login", { ...CREDS, totpCode: nextCode }), undefined, e);
    expect(second.status).toBe(200);

    const me = await app.request("/super-auth/me", { headers: { cookie } }, e);
    expect(await me.json()).toEqual({ adminId, email: "root@example.com" });

    const logout = await app.request(
      new Request("https://api.test/super-auth/logout", { method: "POST", headers: { cookie } }), undefined, e,
    );
    expect(logout.status).toBe(200);
    expect((await app.request("/super-auth/me", { headers: { cookie } }, e)).status).toBe(401);

    const actions = (await drizzle(env.DB).select({ action: auditLogs.action }).from(auditLogs)).map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining(["super.bootstrap", "super.login"]));
  });

  it("rejects an unknown totp and rate-limits login", async () => {
    // bootstrap 済み前提の状態はテストファイル内で作る(共有 D1 のため既存 admin がいれば skip 不要
    // — このファイルは 1 worker 内で直列実行される)
    const e = testEnv();
    const wrong = await app.request(post("/super-auth/login", { ...CREDS, totpCode: "123456" }), undefined, e);
    expect(wrong.status).toBe(401);
    const limited = { ...env, AUTH_LIMITER: fakeLimiter(false) } as Env;
    const res = await app.request(post("/super-auth/login", { ...CREDS, totpCode: "123456" }), undefined, limited);
    expect(res.status).toBe(429);
  });
});
```

(注: 共有 D1(--no-isolate)のため、super_admins へ行を残すとほかのテストファイルの /super-auth/status 前提が崩れる可能性がある。このファイル以外は super_admins を触らないので現状は安全だが、**後続タスクのテストで super_admins を使うときは afterEach で削除する**こと — tenant_modules と同じ規律。)

- [ ] **Step 2: FAIL 確認** — Run: `pnpm --filter @plyrs/api exec vitest run super-auth` → FAIL

- [ ] **Step 3: 実装**

(a) apps/api/src/auth/super-session.ts:

```ts
import { and, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { v7 as uuidv7 } from "uuid";
import { superSessions } from "@plyrs/db/control-plane";
import { generateSessionToken, sha256Hex } from "./session";

// design-spec §11.6: 特権は通常セッションと別テーブル・別 cookie。TTL も短め(7 日)。
const SUPER_SESSION_TTL_DAYS = 7;

export const SUPER_SESSION_COOKIE = "__Host-plyrs_super_session";

export async function createSuperSession(
  d1: D1Database,
  adminId: string,
  now: Date,
): Promise<{ token: string; expiresAt: string }> {
  const token = generateSessionToken();
  const expiresAt = new Date(now.getTime() + SUPER_SESSION_TTL_DAYS * 86_400_000).toISOString();
  await drizzle(d1).insert(superSessions).values({
    id: uuidv7(),
    tokenHash: await sha256Hex(token),
    adminId,
    expiresAt,
    createdAt: now.toISOString(),
  });
  return { token, expiresAt };
}

export async function lookupSuperSession(
  d1: D1Database,
  token: string,
  now: Date,
): Promise<{ adminId: string } | null> {
  const rows = await drizzle(d1)
    .select({ adminId: superSessions.adminId, expiresAt: superSessions.expiresAt })
    .from(superSessions)
    .where(and(eq(superSessions.tokenHash, await sha256Hex(token)), isNull(superSessions.revokedAt)))
    .limit(1);
  const row = rows[0];
  if (row === undefined || row.expiresAt <= now.toISOString()) {
    return null;
  }
  return { adminId: row.adminId };
}

export async function revokeSuperSession(d1: D1Database, token: string, now: Date): Promise<void> {
  await drizzle(d1)
    .update(superSessions)
    .set({ revokedAt: now.toISOString() })
    .where(eq(superSessions.tokenHash, await sha256Hex(token)));
}
```

(b) apps/api/src/audit.ts:

```ts
import { drizzle } from "drizzle-orm/d1";
import { v7 as uuidv7 } from "uuid";
import { auditLogs } from "@plyrs/db/control-plane";

// design-spec §11.6: super 権限の行使は必ず記録する。操作成功後に await で書く
// (best-effort にしない — 記録の失敗は 500 として表面化させる)。
export type AuditAction =
  | "super.bootstrap"
  | "super.login"
  | "tenant.create"
  | "tenant.rename"
  | "tenant.delete"
  | "user.ban"
  | "user.unban"
  | "membership.revoke"
  | "reproject.start"
  | "module.redistribute"
  | "dlq.replay"
  | "dlq.discard"
  | "orphan_assets.delete";

export interface AuditEntry {
  actorId: string;
  action: AuditAction;
  targetType: string;
  targetId: string;
  detail?: unknown;
}

export async function writeAudit(d1: D1Database, entry: AuditEntry): Promise<void> {
  await drizzle(d1).insert(auditLogs).values({
    id: uuidv7(),
    actorId: entry.actorId,
    action: entry.action,
    targetType: entry.targetType,
    targetId: entry.targetId,
    detail: JSON.stringify(entry.detail ?? {}),
    createdAt: new Date().toISOString(),
  });
}
```

(c) apps/api/src/middleware/super-gate.ts:

```ts
import { getCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import { lookupSuperSession, SUPER_SESSION_COOKIE } from "../auth/super-session";

export type SuperGateVariables = { superAdmin: { adminId: string } };

// §11.6: super ルートは JWT を使わず、毎リクエスト super セッション cookie を D1 照会する
// (低頻度の管理操作で D1 1 回は許容。JWT 面を増やさない — 計画の設計確定事項)。
export const superGate = createMiddleware<{ Bindings: Env; Variables: SuperGateVariables }>(
  async (c, next) => {
    const token = getCookie(c, SUPER_SESSION_COOKIE);
    const session = token === undefined ? null : await lookupSuperSession(c.env.DB, token, new Date());
    if (session === null) {
      return c.json({ error: "unauthenticated" }, 401);
    }
    c.set("superAdmin", { adminId: session.adminId });
    await next();
  },
);
```

(d) apps/api/src/routes/super-auth.ts:

```ts
import { zValidator } from "@hono/zod-validator";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { superAdmins } from "@plyrs/db/control-plane";
import { writeAudit } from "../audit";
import { normalizeEmail } from "../auth/email";
import { hashPassword, verifyPassword } from "../auth/password";
import { checkAuthRateLimit } from "../auth/rate-limit";
import {
  createSuperSession,
  revokeSuperSession,
  SUPER_SESSION_COOKIE,
} from "../auth/super-session";
import { generateTotpSecret, otpauthUri, verifyTotpCode } from "../auth/totp";
import { superGate, type SuperGateVariables } from "../middleware/super-gate";

const bootstrapSchema = z.object({
  email: z.email().max(254),
  password: z.string().min(12).max(128),
});
const loginSchema = bootstrapSchema.extend({ totpCode: z.string().regex(/^\d{6}$/) });

const SUPER_COOKIE_OPTIONS = {
  path: "/",
  httpOnly: true,
  secure: true,
  sameSite: "Strict",
  maxAge: 7 * 86_400,
} as const;

type SuperAuthEnv = { Bindings: Env; Variables: SuperGateVariables };

async function rateLimited(c: Parameters<Parameters<Hono<SuperAuthEnv>["post"]>[1]>[0]) {
  const decision = await checkAuthRateLimit(c.env, c.req.header("cf-connecting-ip"));
  if (decision === "ok") {
    return null;
  }
  return decision === "limited"
    ? c.json({ error: "rate_limited" }, 429)
    : c.json({ error: "rate_limiter_unavailable" }, 503);
}

export const superAuthRoutes = new Hono<SuperAuthEnv>()
  .get("/status", async (c) => {
    const row = (
      await drizzle(c.env.DB).select({ id: superAdmins.id }).from(superAdmins).limit(1)
    )[0];
    return c.json({ bootstrapped: row !== undefined });
  })
  // super_admins が空のときだけ有効な初期化経路。secret はこの応答限り(以後表示しない)。
  // TOTP 紛失時の復旧は手動 SQL(docs/deploy.md)。
  .post("/bootstrap", zValidator("json", bootstrapSchema), async (c) => {
    const limited = await rateLimited(c);
    if (limited) return limited;
    const db = drizzle(c.env.DB);
    const existing = (await db.select({ id: superAdmins.id }).from(superAdmins).limit(1))[0];
    if (existing !== undefined) {
      return c.json({ error: "already_bootstrapped" }, 403);
    }
    const { email, password } = c.req.valid("json");
    const normalized = normalizeEmail(email);
    const secret = generateTotpSecret();
    const adminId = uuidv7();
    await db.insert(superAdmins).values({
      id: adminId,
      email: normalized,
      passwordHash: await hashPassword(password),
      totpSecret: secret,
      totpLastCounter: 0,
      createdAt: new Date().toISOString(),
    });
    await writeAudit(c.env.DB, {
      actorId: adminId,
      action: "super.bootstrap",
      targetType: "super_admin",
      targetId: adminId,
    });
    return c.json({ adminId, totpSecret: secret, otpauthUri: otpauthUri(normalized, secret) }, 201);
  })
  // 単段ログイン(パスワード + TOTP を 1 リクエスト。中間状態セッションを持たない)。
  // 失敗理由は区別せず invalid_credentials に畳む(列挙耐性)。
  .post("/login", zValidator("json", loginSchema), async (c) => {
    const limited = await rateLimited(c);
    if (limited) return limited;
    const { email, password, totpCode } = c.req.valid("json");
    const db = drizzle(c.env.DB);
    const row = (
      await db.select().from(superAdmins).where(eq(superAdmins.email, normalizeEmail(email))).limit(1)
    )[0];
    if (row === undefined || !(await verifyPassword(password, row.passwordHash))) {
      return c.json({ error: "invalid_credentials" }, 401);
    }
    const counter = await verifyTotpCode(row.totpSecret, totpCode, Date.now());
    if (counter === null || counter <= row.totpLastCounter) {
      return c.json({ error: "invalid_credentials" }, 401); // 不一致もリプレイも同じ応答
    }
    await db
      .update(superAdmins)
      .set({ totpLastCounter: counter })
      .where(eq(superAdmins.id, row.id));
    const now = new Date();
    const { token } = await createSuperSession(c.env.DB, row.id, now);
    setCookie(c, SUPER_SESSION_COOKIE, token, SUPER_COOKIE_OPTIONS);
    await writeAudit(c.env.DB, {
      actorId: row.id,
      action: "super.login",
      targetType: "super_admin",
      targetId: row.id,
    });
    return c.json({ adminId: row.id });
  })
  .post("/logout", async (c) => {
    const token = getCookie(c, SUPER_SESSION_COOKIE);
    if (token !== undefined) {
      await revokeSuperSession(c.env.DB, token, new Date());
    }
    deleteCookie(c, SUPER_SESSION_COOKIE, { path: "/", secure: true });
    return c.json({ ok: true });
  })
  .get("/me", superGate, async (c) => {
    const { adminId } = c.get("superAdmin");
    const row = (
      await drizzle(c.env.DB)
        .select({ email: superAdmins.email })
        .from(superAdmins)
        .where(eq(superAdmins.id, adminId))
        .limit(1)
    )[0];
    return c.json({ adminId, email: row?.email ?? null });
  });
```

(`rateLimited` の Context 型抽出が型的に煩雑なら、`checkAuthRateLimit` を各ハンドラ内で直接呼ぶ形に展開してよい — Task 4 の auth.ts と同じ 6 行パターン。)

(e) index.ts:

```ts
import { superAuthRoutes } from "./routes/super-auth";

app.use("/super-auth/*", requireSaneSecret);
app.route("/super-auth", superAuthRoutes);
```

- [ ] **Step 4: PASS 確認** — Run: `pnpm --filter @plyrs/api exec vitest run super-auth` → PASS

- [ ] **Step 5: コミット**

```bash
git add apps/api/src/auth/super-session.ts apps/api/src/audit.ts apps/api/src/middleware/super-gate.ts apps/api/src/routes/super-auth.ts apps/api/src/index.ts apps/api/test/super-auth.test.ts
git commit -m "feat: 特権ログイン(TOTP 必須)と監査ヘルパ"
```

---

### Task 7: super テナント CRUD(self-serve 作成の廃止を含む)

**Files:**
- Create: `apps/api/src/routes/super.ts` / `apps/api/src/ops/tenant-delete.ts`
- Modify: `apps/api/src/routes/tenants.ts`(ルート撤去・定数/schema は残す)/ `apps/api/src/index.ts` / `apps/api/src/tenant-do.ts`(wipeTenant RPC)
- Test: `apps/api/test/super-tenants.test.ts` + 既存テストの復旧

**Interfaces:**
- Consumes: superGate / writeAudit / TENANT_SLUG_PATTERN / TENANT_SLUG_MAX_LENGTH。
- Produces: HTTP(すべて superGate 配下): `GET /super/v1/tenants` → `{tenants: [{id, slug, name, createdAt, memberCount}]}`、`POST /super/v1/tenants` body `{name, slug, ownerEmail?}` → 201 `{tenantId}`(409 slug_taken / 404 unknown_owner)、`PATCH /super/v1/tenants/:tenantId` body `{name}`、`DELETE /super/v1/tenants/:tenantId` → `{ok: true}`。DO RPC `wipeTenant(): Promise<{ok: true}>`。ヘルパ `deleteTenantCascade(env, {id, slug})`。**POST /v1/tenants は 404 になる**(裁定 9)。
- 注意: このタスク以降のテストが super cookie を得るための共有ヘルパ `test/super-login.ts` を本タスクで作る(super_admins を書くため **afterEach で必ず削除** — Task 6 の注意どおり)。

- [ ] **Step 1: 失敗するテストを書く**

test/super-login.ts(共有ヘルパ):

```ts
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { superAdmins, superSessions } from "@plyrs/db/control-plane";
import { generateTotpCode } from "../src/auth/totp";
import { app } from "../src/index";

export function fakeLimiter(succeeds: boolean): RateLimit {
  return { limit: async () => ({ success: succeeds }) } as RateLimit;
}
export const superEnv = (): Env => ({ ...env, AUTH_LIMITER: fakeLimiter(true) }) as Env;

// bootstrap → login して super cookie を返す。呼び出し側は afterEach で resetSuperAdmins() を呼ぶこと
// (共有 D1 のリーク対策 — tenant_modules と同じ規律)。
export async function superLogin(): Promise<{ cookie: string; adminId: string }> {
  const e = superEnv();
  const creds = { email: `root+${crypto.randomUUID()}@x.com`, password: "super-password-123" };
  const boot = await app.request(
    new Request("https://api.test/super-auth/bootstrap", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(creds),
    }),
    undefined,
    e,
  );
  if (boot.status !== 201) throw new Error(`bootstrap failed: ${boot.status}`);
  const { adminId, totpSecret } = (await boot.json()) as { adminId: string; totpSecret: string };
  const login = await app.request(
    new Request("https://api.test/super-auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...creds, totpCode: await generateTotpCode(totpSecret, Date.now()) }),
    }),
    undefined,
    e,
  );
  if (login.status !== 200) throw new Error(`login failed: ${login.status}`);
  const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  return { cookie, adminId };
}

export async function resetSuperAdmins(): Promise<void> {
  const db = drizzle(env.DB);
  await db.delete(superSessions);
  await db.delete(superAdmins);
}
```

test/super-tenants.test.ts:

```ts
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { auditLogs, memberships, tenants, users } from "@plyrs/db/control-plane";
import { app } from "../src/index";
import { resetSuperAdmins, superEnv, superLogin } from "./super-login";

afterEach(resetSuperAdmins);

function jsonReq(method: string, path: string, cookie: string, body?: unknown): Request {
  return new Request(`https://api.test${path}`, {
    method,
    headers: { "content-type": "application/json", cookie },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe("super tenant CRUD", () => {
  it("requires the super session", async () => {
    expect((await app.request("/super/v1/tenants", {}, superEnv())).status).toBe(401);
  });

  it("self-serve tenant creation is gone", async () => {
    const res = await app.request(
      new Request("https://api.test/v1/tenants", { method: "POST", body: JSON.stringify({ name: "x", slug: "x" }) }),
      undefined,
      superEnv(),
    );
    expect(res.status).toBe(404); // 裁定 9: super 専用化
  });

  it("creates, lists, renames a tenant and assigns an owner by email", async () => {
    const { cookie } = await superLogin();
    const e = superEnv();
    const ownerEmail = `owner+${crypto.randomUUID()}@x.com`;
    await drizzle(env.DB).insert(users).values({
      id: crypto.randomUUID(), email: ownerEmail, passwordHash: "h", createdAt: new Date().toISOString(),
    });

    const missingOwner = await app.request(
      jsonReq("POST", "/super/v1/tenants", cookie, { name: "T", slug: "sup-a", ownerEmail: "nobody@x.com" }), undefined, e,
    );
    expect(missingOwner.status).toBe(404);

    const created = await app.request(
      jsonReq("POST", "/super/v1/tenants", cookie, { name: "T", slug: "sup-a", ownerEmail: ownerEmail.toUpperCase() }), undefined, e,
    );
    expect(created.status).toBe(201);
    const { tenantId } = (await created.json()) as { tenantId: string };
    const member = await drizzle(env.DB).select().from(memberships).where(eq(memberships.tenantId, tenantId));
    expect(member).toMatchObject([{ role: "owner" }]);

    const dup = await app.request(jsonReq("POST", "/super/v1/tenants", cookie, { name: "T2", slug: "sup-a" }), undefined, e);
    expect(dup.status).toBe(409);

    const listed = (await (await app.request("/super/v1/tenants", { headers: { cookie } }, e)).json()) as {
      tenants: { id: string; memberCount: number }[];
    };
    expect(listed.tenants.find((t) => t.id === tenantId)?.memberCount).toBe(1);

    const renamed = await app.request(jsonReq("PATCH", `/super/v1/tenants/${tenantId}`, cookie, { name: "T renamed" }), undefined, e);
    expect(renamed.status).toBe(200);
    const actions = (await drizzle(env.DB).select({ action: auditLogs.action }).from(auditLogs)).map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining(["tenant.create", "tenant.rename"]));
  });

  it("deletes a tenant with full cascade", async () => {
    const { cookie } = await superLogin();
    const e = superEnv();
    const created = await app.request(jsonReq("POST", "/super/v1/tenants", cookie, { name: "Del", slug: "sup-del" }), undefined, e);
    const { tenantId } = (await created.json()) as { tenantId: string };
    // 消される対象を作っておく: KV キャッシュ / R2 オブジェクト / 投影行
    await env.TENANT_SLUGS.put(`tenant-slug:sup-del`, JSON.stringify({ id: tenantId }));
    await env.ASSETS.put(`${tenantId}/some-asset`, "bytes");
    await env.PROJECTION_DB.prepare(
      "INSERT INTO projected_records (tenant_id, record_id, type, slug, data, status, published_at, published_by, source_version, publish_seq, projected_at) VALUES (?1, ?2, 't', NULL, '{}', 'draft', '2026-01-01', 'u', 1, 1, '2026-01-01')",
    ).bind(tenantId, crypto.randomUUID()).run();

    const res = await app.request(jsonReq("DELETE", `/super/v1/tenants/${tenantId}`, cookie), undefined, e);
    expect(res.status).toBe(200);
    expect(await drizzle(env.DB).select().from(tenants).where(eq(tenants.id, tenantId))).toHaveLength(0);
    expect(await env.TENANT_SLUGS.get("tenant-slug:sup-del")).toBeNull();
    expect((await env.ASSETS.list({ prefix: `${tenantId}/` })).objects).toHaveLength(0);
    const projected = await env.PROJECTION_DB.prepare(
      "SELECT COUNT(*) AS n FROM projected_records WHERE tenant_id = ?1",
    ).bind(tenantId).first<{ n: number }>();
    expect(projected?.n).toBe(0);
    const actions = (await drizzle(env.DB).select({ action: auditLogs.action }).from(auditLogs)).map((r) => r.action);
    expect(actions).toContain("tenant.delete");
  });
});
```

(projected_records の INSERT 列は packages/db/src/projection.ts の実カラムに合わせて調整すること。)

- [ ] **Step 2: FAIL 確認** — Run: `pnpm --filter @plyrs/api exec vitest run super-tenants` → FAIL

- [ ] **Step 3: 実装**

(a) tenant-do.ts に wipeTenant RPC を追加:

```ts
// Phase 10: テナント削除のカスケード。全ソケット切断 → alarm 解除 → 全ストレージ削除。
// deleteAll 後もこのインスタンスのメモリ状態は残るが、control-plane 行が先に消えている
// (ゲートが新規到達を止める)ため後続リクエストは来ない前提。次回起床時は constructor の
// JIT migration が空のテナントとして再初期化する。
async wipeTenant(): Promise<{ ok: true }> {
  for (const socket of this.ctx.getWebSockets()) {
    socket.close(CLOSE_CODES.blocked, "tenant_deleted");
  }
  await this.ctx.storage.deleteAlarm();
  await this.ctx.storage.deleteAll();
  return { ok: true };
}
```

(b) apps/api/src/ops/tenant-delete.ts:

```ts
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { memberships, tenantModules, tenants } from "@plyrs/db/control-plane";

// 削除順序(計画の設計確定事項): control-plane 行(新規トークン発行を止める)→ KV slug cache
// → DO wipe(接続切断込み)→ 投影 D1 → R2。途中失敗は 500 として表面化し、再実行で収束する
// (各段は冪等)。
export async function deleteTenantCascade(
  env: Env,
  tenant: { id: string; slug: string },
): Promise<void> {
  const db = drizzle(env.DB);
  await db.batch([
    db.delete(memberships).where(eq(memberships.tenantId, tenant.id)),
    db.delete(tenantModules).where(eq(tenantModules.tenantId, tenant.id)),
    db.delete(tenants).where(eq(tenants.id, tenant.id)),
  ]);
  await env.TENANT_SLUGS.delete(`tenant-slug:${tenant.slug}`);
  const stub = env.TENANT_DO.get(env.TENANT_DO.idFromName(tenant.id));
  await stub.wipeTenant();
  const tables = [
    "projected_records",
    "projected_relations",
    "projection_index",
    "projection_tombstones",
    "projection_fields",
  ];
  await env.PROJECTION_DB.batch(
    tables.map((table) =>
      env.PROJECTION_DB.prepare(`DELETE FROM ${table} WHERE tenant_id = ?1`).bind(tenant.id),
    ),
  );
  let cursor: string | undefined;
  do {
    const listing = await env.ASSETS.list({ prefix: `${tenant.id}/`, cursor });
    if (listing.objects.length > 0) {
      await env.ASSETS.delete(listing.objects.map((object) => object.key));
    }
    cursor = listing.truncated ? listing.cursor : undefined;
  } while (cursor !== undefined);
}
```

(c) apps/api/src/routes/super.ts(このタスクではテナント CRUD のみ。以降のタスクが同じルータへメソッドチェーンで追記):

```ts
import { zValidator } from "@hono/zod-validator";
import { asc, count, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { memberships, tenants, users } from "@plyrs/db/control-plane";
import { writeAudit } from "../audit";
import { normalizeEmail } from "../auth/email";
import { deleteTenantCascade } from "../ops/tenant-delete";
import { superGate, type SuperGateVariables } from "../middleware/super-gate";
import { TENANT_SLUG_MAX_LENGTH, TENANT_SLUG_PATTERN } from "./tenants";

const createTenantSchema = z.object({
  name: z.string().min(1).max(100),
  slug: z.string().regex(TENANT_SLUG_PATTERN).max(TENANT_SLUG_MAX_LENGTH),
  ownerEmail: z.email().max(254).optional(),
});

export const superRoutes = new Hono<{ Bindings: Env; Variables: SuperGateVariables }>()
  .use("*", superGate)
  .get("/tenants", async (c) => {
    const db = drizzle(c.env.DB);
    const rows = await db
      .select({
        id: tenants.id,
        slug: tenants.slug,
        name: tenants.name,
        createdAt: tenants.createdAt,
        memberCount: count(memberships.userId),
      })
      .from(tenants)
      .leftJoin(memberships, eq(memberships.tenantId, tenants.id))
      .groupBy(tenants.id)
      .orderBy(asc(tenants.slug));
    return c.json({ tenants: rows });
  })
  // 裁定 9: テナント作成は super 専用。ownerEmail 指定時は既存ユーザーを owner に任命する。
  .post("/tenants", zValidator("json", createTenantSchema), async (c) => {
    const { name, slug, ownerEmail } = c.req.valid("json");
    const db = drizzle(c.env.DB);
    const dup = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, slug)).limit(1);
    if (dup.length > 0) {
      return c.json({ error: "slug_taken" }, 409);
    }
    let ownerId: string | null = null;
    if (ownerEmail !== undefined) {
      const owner = (
        await db.select({ id: users.id }).from(users).where(eq(users.email, normalizeEmail(ownerEmail))).limit(1)
      )[0];
      if (owner === undefined) {
        return c.json({ error: "unknown_owner" }, 404);
      }
      ownerId = owner.id;
    }
    const now = new Date().toISOString();
    const tenantId = uuidv7();
    const statements = [db.insert(tenants).values({ id: tenantId, slug, name, createdAt: now })];
    if (ownerId !== null) {
      statements.push(
        db.insert(memberships).values({ userId: ownerId, tenantId, role: "owner", createdAt: now }),
      );
    }
    await db.batch(statements as [typeof statements[0], ...typeof statements]);
    await writeAudit(c.env.DB, {
      actorId: c.get("superAdmin").adminId,
      action: "tenant.create",
      targetType: "tenant",
      targetId: tenantId,
      detail: { slug, name, ownerId },
    });
    return c.json({ tenantId }, 201);
  })
  // slug は不変(§14-3 の凍結 embed URL 問題があるため rename は name のみ)。
  .patch("/tenants/:tenantId", zValidator("json", z.object({ name: z.string().min(1).max(100) })), async (c) => {
    const tenantId = c.req.param("tenantId");
    const { name } = c.req.valid("json");
    const db = drizzle(c.env.DB);
    const row = (await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.id, tenantId)).limit(1))[0];
    if (row === undefined) {
      return c.json({ error: "not_found" }, 404);
    }
    await db.update(tenants).set({ name }).where(eq(tenants.id, tenantId));
    await writeAudit(c.env.DB, {
      actorId: c.get("superAdmin").adminId,
      action: "tenant.rename",
      targetType: "tenant",
      targetId: tenantId,
      detail: { name },
    });
    return c.json({ ok: true });
  })
  .delete("/tenants/:tenantId", async (c) => {
    const tenantId = c.req.param("tenantId");
    const db = drizzle(c.env.DB);
    const row = (
      await db.select({ id: tenants.id, slug: tenants.slug }).from(tenants).where(eq(tenants.id, tenantId)).limit(1)
    )[0];
    if (row === undefined) {
      return c.json({ error: "not_found" }, 404);
    }
    await deleteTenantCascade(c.env, row);
    await writeAudit(c.env.DB, {
      actorId: c.get("superAdmin").adminId,
      action: "tenant.delete",
      targetType: "tenant",
      targetId: tenantId,
      detail: { slug: row.slug },
    });
    return c.json({ ok: true });
  });
```

(`db.batch` の型引数が煩雑なら 2 つの `db.insert` を逐次 await に分解してよい — 作成は低頻度で原子性は一意索引が守る。)

(d) routes/tenants.ts — `tenantAdminRoutes` を削除し、`TENANT_SLUG_PATTERN` / `TENANT_SLUG_MAX_LENGTH` の export だけ残す(公開 read の tenant-resolver 前段検証が使い続ける)。

(e) index.ts:

```ts
import { superRoutes } from "./routes/super";

app.use("/super/v1/*", requireSaneSecret);
app.route("/super/v1", superRoutes);
// app.route("/v1/tenants", tenantAdminRoutes) は削除(裁定 9)
```

- [ ] **Step 4: 既存テストの復旧**

Run: `pnpm --filter @plyrs/api test`
POST /v1/tenants を使ってテナントを作っている既存テスト(Phase 3 以降の e2e 系)を、control-plane D1 へ直接 insert するヘルパ(または superLogin 経由)へ置換する。**推奨: test/create-tenant.ts に `insertTenantWithOwner(userId): Promise<{tenantId, slug}>`(drizzle 直 insert)を作って一括置換**(HTTP 経由よりも速く、super_admins のリークも避けられる)。
Expected: 全 green

- [ ] **Step 5: コミット**

```bash
git add apps/api/src/routes/super.ts apps/api/src/ops/tenant-delete.ts apps/api/src/routes/tenants.ts apps/api/src/index.ts apps/api/src/tenant-do.ts apps/api/test/
git commit -m "feat: super テナント CRUD と self-serve 作成の廃止"
```

---

### Task 8: super ユーザー管理 + BAN ルート

**Files:**
- Modify: `apps/api/src/routes/super.ts`(追記)
- Test: `apps/api/test/super-users.test.ts`

**Interfaces:**
- Consumes: Task 5 の banUserEverywhere / revokeMembership / unblockUser、Task 7 の superRoutes。
- Produces: `GET /super/v1/users?q=` → `{users: [{id, email, createdAt, membershipCount}]}`(最大 100 件・email 昇順)、`POST /super/v1/users/:userId/ban` → `{ok: true, disconnected}`、`POST /super/v1/users/:userId/unban`、`GET /super/v1/tenants/:tenantId/members` → `{members: [{userId, email, role, createdAt}]}`、`DELETE /super/v1/tenants/:tenantId/members/:userId` → `{ok: true, disconnected}`。

- [ ] **Step 1: 失敗するテストを書く**

test/super-users.test.ts(様式は Task 7 と同じ。afterEach resetSuperAdmins):

```ts
describe("super user management", () => {
  it("searches users with membership counts", async () => {
    // users 2 人 + memberships を direct insert → GET /super/v1/users?q=<片方の email 断片>
    // → 1 件だけ返り membershipCount が正しい
  });

  it("bans and unbans a user", async () => {
    // POST ban → isBlocked true + audit 'user.ban' / POST unban → isBlocked false + audit 'user.unban'
  });

  it("lists members and revokes a membership", async () => {
    // GET members → email/role が入る。DELETE → membership 行が消え
    // isMembershipBlocked true + audit 'membership.revoke'
  });
});
```

(それぞれ Task 7 のテストと同型の具体アサーションで書く。ban/unban は Task 5 のヘルパを経由するため、ここでは HTTP 応答と audit 行、KV 状態のみ検証すれば足りる。)

- [ ] **Step 2: FAIL 確認** — Run: `pnpm --filter @plyrs/api exec vitest run super-users` → FAIL

- [ ] **Step 3: 実装** — routes/super.ts へ追記:

```ts
  .get("/users", async (c) => {
    const q = c.req.query("q") ?? "";
    const db = drizzle(c.env.DB);
    const rows = await db
      .select({
        id: users.id,
        email: users.email,
        createdAt: users.createdAt,
        membershipCount: count(memberships.tenantId),
      })
      .from(users)
      .leftJoin(memberships, eq(memberships.userId, users.id))
      .where(q === "" ? undefined : like(users.email, `%${q}%`))
      .groupBy(users.id)
      .orderBy(asc(users.email))
      .limit(100);
    return c.json({ users: rows });
  })
  .post("/users/:userId/ban", async (c) => {
    const userId = c.req.param("userId");
    const { disconnected } = await banUserEverywhere(c.env, userId);
    await writeAudit(c.env.DB, {
      actorId: c.get("superAdmin").adminId,
      action: "user.ban",
      targetType: "user",
      targetId: userId,
      detail: { disconnected },
    });
    return c.json({ ok: true, disconnected });
  })
  .post("/users/:userId/unban", async (c) => {
    const userId = c.req.param("userId");
    await unblockUser(c.env.BLOCKLIST, userId);
    await writeAudit(c.env.DB, {
      actorId: c.get("superAdmin").adminId,
      action: "user.unban",
      targetType: "user",
      targetId: userId,
    });
    return c.json({ ok: true });
  })
  .get("/tenants/:tenantId/members", async (c) => {
    const rows = await drizzle(c.env.DB)
      .select({
        userId: memberships.userId,
        email: users.email,
        role: memberships.role,
        createdAt: memberships.createdAt,
      })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(eq(memberships.tenantId, c.req.param("tenantId")))
      .orderBy(asc(users.email));
    return c.json({ members: rows });
  })
  .delete("/tenants/:tenantId/members/:userId", async (c) => {
    const tenantId = c.req.param("tenantId");
    const userId = c.req.param("userId");
    const { disconnected } = await revokeMembership(c.env, userId, tenantId);
    await writeAudit(c.env.DB, {
      actorId: c.get("superAdmin").adminId,
      action: "membership.revoke",
      targetType: "membership",
      targetId: `${userId}:${tenantId}`,
      detail: { disconnected },
    });
    return c.json({ ok: true, disconnected });
  })
```

(import に `like`・`unblockUser`・`banUserEverywhere`・`revokeMembership` を追加。)

- [ ] **Step 4: PASS 確認** — Run: `pnpm --filter @plyrs/api exec vitest run super-users` → PASS

- [ ] **Step 5: コミット**

```bash
git add apps/api/src/routes/super.ts apps/api/test/super-users.test.ts
git commit -m "feat: super ユーザー管理と BAN ルート"
```

---

### Task 9: DO 健全性 RPC + 孤児 R2 検出ルート

**Files:**
- Modify: `apps/api/src/tenant-do.ts`(healthCheck / listAssetR2Keys)/ `apps/api/src/routes/super.ts`(追記)/ `apps/api/src/rpc-unwrap.ts`(アンラップ追加)
- Test: `apps/api/test/super-health.test.ts`

**Interfaces:**
- Produces: DO RPC `healthCheck(): HealthReport`、`listAssetR2Keys(): string[]`。HTTP: `GET /super/v1/tenants/:tenantId/health` → HealthReport、`GET /super/v1/tenants/:tenantId/orphan-assets` → `{orphans: [{key, size}]}`、`DELETE /super/v1/tenants/:tenantId/orphan-assets` body `{keys: string[]}` → `{ok: true, deleted}`。

```ts
export interface HealthReport {
  // 仕様 7 章の確定事項: archived かつ公開中の一覧
  archivedPublished: { recordId: string; type: string; publishedAt: string }[];
  // §14-1: レガシー user 型 'asset'(ensureAssetContentType がスキップする状態)
  legacyAssetType: boolean;
  // §13: 旧形式(非構造)richtext を持つ record(validate-on-write が保存不能にする)
  legacyRichtextRecords: { recordId: string; type: string; fieldKey: string }[];
}
```

- [ ] **Step 1: 失敗するテストを書く**

test/super-health.test.ts(runInDurableObject でレガシー状態を直接 SQL 再現する — test/asset-ownership.test.ts の様式):

```ts
describe("tenant health check", () => {
  it("reports archived-published, legacy asset type and legacy richtext", async () => {
    // 準備(既存テストヘルパで): content_type 登録(richtext フィールド持ち)→ record 作成 →
    // publish → status を archived へ。さらに runInDurableObject で:
    //  - content_types に source='user', key='asset' の行を direct insert(id は別 UUID)
    //  - richtext フィールドの data を旧形式(例: {"body": "plain string"})へ direct UPDATE
    // 検証: GET /super/v1/tenants/:tenantId/health が
    //  archivedPublished に該当 record / legacyAssetType: true /
    //  legacyRichtextRecords に {recordId, fieldKey: "body"} を含む
  });

  it("detects and deletes orphan R2 binaries but refuses referenced or foreign keys", async () => {
    // 準備: アップロード経路(または createAssetRecord RPC + ASSETS.put)で参照済み asset を1つ、
    // ASSETS.put(`${tenantId}/orphan-1`) で孤児を1つ、`${otherTenantId}/x` で他テナントを1つ。
    // GET orphan-assets → orphans が orphan-1 のみ(参照済み・他テナントは含まない)
    // DELETE keys:[orphan-1] → R2 から消え audit 'orphan_assets.delete'
    // DELETE keys:[`${otherTenantId}/x`] → 400(assetKeyBelongsToTenant ガード)
    // DELETE keys:[参照済み key] → 400(参照中は消させない)
  });
});
```

- [ ] **Step 2: FAIL 確認** — Run: `pnpm --filter @plyrs/api exec vitest run super-health` → FAIL

- [ ] **Step 3: 実装**

(a) tenant-do.ts(SQL 実行はファイル内の既存 RPC と同じ様式で。フィールド定義の JSON 列は content_types.fields):

```ts
// Phase 10: 特権コンソールの健全性チェック。管理オンデマンド呼び出し前提のフルスキャン
// (DO 内 SQLite なので実テナント規模では許容。公開経路からは呼ばれない)。
healthCheck(): HealthReport {
  const archivedPublished = [
    ...this.ctx.storage.sql.exec(
      `SELECT r.id AS record_id, r.type, s.published_at
       FROM records r JOIN published_snapshots s ON s.record_id = r.id
       WHERE r.status = 'archived' AND r.deleted_at IS NULL`,
    ),
  ].map((row) => ({
    recordId: row.record_id as string,
    type: row.type as string,
    publishedAt: row.published_at as string,
  }));

  const legacyAsset = [
    ...this.ctx.storage.sql.exec(
      "SELECT source FROM content_types WHERE key = 'asset' AND source != 'system'",
    ),
  ];

  const legacyRichtextRecords: { recordId: string; type: string; fieldKey: string }[] = [];
  const types = [...this.ctx.storage.sql.exec("SELECT key, fields FROM content_types")];
  for (const typeRow of types) {
    const richtextKeys = safeRichtextFieldKeys(typeRow.fields as string);
    if (richtextKeys.length === 0) continue;
    const rows = this.ctx.storage.sql.exec(
      "SELECT id, data FROM records WHERE type = ?1 AND deleted_at IS NULL",
      typeRow.key as string,
    );
    for (const row of rows) {
      const data = safeParseObject(row.data as string);
      if (data === null) continue;
      for (const fieldKey of richtextKeys) {
        const value = data[fieldKey];
        if (value !== null && value !== undefined && isLegacyRichTextValue(value)) {
          legacyRichtextRecords.push({ recordId: row.id as string, type: typeRow.key as string, fieldKey });
        }
      }
    }
  }
  return { archivedPublished, legacyAssetType: legacyAsset.length > 0, legacyRichtextRecords };
}

listAssetR2Keys(): string[] {
  const rows = this.ctx.storage.sql.exec(
    "SELECT data FROM records WHERE type = 'asset' AND deleted_at IS NULL",
  );
  const keys: string[] = [];
  for (const row of rows) {
    const data = safeParseObject(row.data as string);
    const key = data?.["r2_key"];
    if (typeof key === "string") keys.push(key);
  }
  return keys;
}
```

モジュールレベルのヘルパ(同ファイル下部):

```ts
function safeParseObject(raw: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function safeRichtextFieldKeys(fieldsJson: string): string[] {
  try {
    const parsed: unknown = JSON.parse(fieldsJson);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (f): f is { key: string; type: string } =>
          typeof f === "object" && f !== null &&
          typeof (f as { key?: unknown }).key === "string" &&
          (f as { type?: unknown }).type === "richtext",
      )
      .map((f) => f.key);
  } catch {
    return [];
  }
}

// §13 の構造検証と同じ判定: envelope が object で doc.type が string なら新形式。
function isLegacyRichTextValue(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return true;
  const doc = (value as { doc?: unknown }).doc;
  return !(typeof doc === "object" && doc !== null &&
    typeof (doc as { type?: unknown }).type === "string");
}
```

(richtext のフィールド型名・data 内の r2_key キー名は metamodel の実定義と突き合わせて確認すること。ずれていたらテストが検出する。)

(b) rpc-unwrap.ts に `asHealthReport` / `asStringArray` を既存様式で追加。

(c) routes/super.ts へ追記:

```ts
  .get("/tenants/:tenantId/health", async (c) => {
    const tenantId = c.req.param("tenantId");
    const stub = c.env.TENANT_DO.get(c.env.TENANT_DO.idFromName(tenantId));
    return c.json(asHealthReport(await stub.healthCheck()));
  })
  .get("/tenants/:tenantId/orphan-assets", async (c) => {
    const tenantId = c.req.param("tenantId");
    const stub = c.env.TENANT_DO.get(c.env.TENANT_DO.idFromName(tenantId));
    const referenced = new Set(asStringArray(await stub.listAssetR2Keys()));
    const orphans: { key: string; size: number }[] = [];
    let cursor: string | undefined;
    do {
      const listing = await c.env.ASSETS.list({ prefix: `${tenantId}/`, cursor });
      for (const object of listing.objects) {
        if (!referenced.has(object.key)) {
          orphans.push({ key: object.key, size: object.size });
        }
      }
      cursor = listing.truncated ? listing.cursor : undefined;
    } while (cursor !== undefined);
    return c.json({ orphans });
  })
  .delete(
    "/tenants/:tenantId/orphan-assets",
    zValidator("json", z.object({ keys: z.array(z.string().min(1)).min(1).max(100) })),
    async (c) => {
      const tenantId = c.req.param("tenantId");
      const { keys } = c.req.valid("json");
      // §14 の教訓: asset 系の新経路には必ず帰属ガードを併設する
      if (!keys.every((key) => assetKeyBelongsToTenant(tenantId, key))) {
        return c.json({ error: "foreign_key" }, 400);
      }
      const stub = c.env.TENANT_DO.get(c.env.TENANT_DO.idFromName(tenantId));
      const referenced = new Set(asStringArray(await stub.listAssetR2Keys()));
      if (keys.some((key) => referenced.has(key))) {
        return c.json({ error: "still_referenced" }, 400); // 削除直前の再照会(レース対策)
      }
      await c.env.ASSETS.delete(keys);
      await writeAudit(c.env.DB, {
        actorId: c.get("superAdmin").adminId,
        action: "orphan_assets.delete",
        targetType: "tenant",
        targetId: tenantId,
        detail: { keys },
      });
      return c.json({ ok: true, deleted: keys.length });
    },
  )
```

(import: `assetKeyBelongsToTenant` は apps/api/src/assets/ownership.ts。)

- [ ] **Step 4: PASS 確認** — Run: `pnpm --filter @plyrs/api exec vitest run super-health` → PASS

- [ ] **Step 5: コミット**

```bash
git add apps/api/src/tenant-do.ts apps/api/src/rpc-unwrap.ts apps/api/src/routes/super.ts apps/api/test/super-health.test.ts
git commit -m "feat: 健全性チェック RPC と孤児 R2 検出"
```

---

### Task 10: DLQ の D1 park + 一覧・リプレイルート

**Files:**
- Create: `apps/api/src/ops/dead-letters.ts`
- Modify: `apps/api/src/index.ts`(queue 分岐)/ `apps/api/wrangler.jsonc`(DLQ consumers + コメント更新)/ `apps/api/src/routes/super.ts`(追記)
- Test: `apps/api/test/dead-letters.test.ts`

**Interfaces:**
- Produces: `parkDeadLetter(env, dlqQueue: string, message: {id: string; body: unknown}): Promise<void>`。HTTP: `GET /super/v1/dead-letters` → `{deadLetters: [{id, queue, body, failedAt, replayedAt}]}`(failed_at 降順・最大 200)、`POST /super/v1/dead-letters/:id/replay` → `{ok: true}`、`DELETE /super/v1/dead-letters/:id` → `{ok: true}`。

- [ ] **Step 1: 失敗するテストを書く**

test/dead-letters.test.ts(DLQ バッチはテストブローカが自動 consume しないため createMessageBatch + worker.queue で手動駆動 — Phase 9 の様式):

```ts
import { createMessageBatch, env, createExecutionContext } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { afterEach, describe, expect, it } from "vitest";
import { auditLogs, deadLetters } from "@plyrs/db/control-plane";
import worker, { app } from "../src/index";
import { resetSuperAdmins, superEnv, superLogin } from "./super-login";

afterEach(async () => {
  await resetSuperAdmins();
  await drizzle(env.DB).delete(deadLetters); // 共有 D1 のリーク対策
});

describe("dead letter park & replay", () => {
  it("parks a DLQ message into D1 and acks (idempotent by message id)", async () => {
    const body = { jobType: "reproject", tenantId: crypto.randomUUID(), cursor: null, epoch: 1 };
    const batch = createMessageBatch("plyrs-projection-dlq", [
      { id: "msg-1", timestamp: new Date(), body, attempts: 5 },
    ]);
    const ctx = createExecutionContext();
    await worker.queue(batch, env, ctx);
    await worker.queue(createMessageBatch("plyrs-projection-dlq", [
      { id: "msg-1", timestamp: new Date(), body, attempts: 6 },
    ]), env, ctx); // 再配達しても 1 行のまま
    const rows = await drizzle(env.DB).select().from(deadLetters);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "msg-1", queue: "plyrs-projection" });
    expect(JSON.parse(rows[0]?.body ?? "")).toEqual(body);
  });

  it("lists, replays to the source queue, and discards", async () => {
    const { cookie } = await superLogin();
    const e = superEnv();
    // 有効な reproject ジョブを park 済みの前提を direct insert で作る
    // (replay 後、実 miniflare ブローカ経由で projection consumer が走ることを
    //  projection-e2e.test.ts と同じポーリングで観測する — publish 済み record を先に用意)
    // 手順: テナント + 型 + record + publish(既存ヘルパ)→ dead_letters に reproject ジョブ挿入
    // → POST replay → projected_records に行が現れるまでポーリング
    // → replayedAt が立ち audit 'dlq.replay' が残る
    // → DELETE → 行が消え audit 'dlq.discard' が残る
  });
});
```

(2 本目は projection-e2e.test.ts のヘルパ・ポーリング様式で具体化する。)

- [ ] **Step 2: FAIL 確認** — Run: `pnpm --filter @plyrs/api exec vitest run dead-letters` → FAIL

- [ ] **Step 3: 実装**

(a) apps/api/src/ops/dead-letters.ts:

```ts
// Phase 10 裁定: DLQ は「キュー内滞留」ではなく D1 退避。ack は durable insert 完了後
// (§9 の「黙って ack しない」の意図は「ack より先に永続化する」で保存される)。
// キュー名は環境サフィックス付き(例: plyrs-projection-preview-dlq)でも動くよう、
// 完全一致表ではなく「-dlq を剥ぐ」規約で source を導出する(Task 15 の env 分割と対)。
export async function parkDeadLetter(
  env: Env,
  dlqQueue: string,
  message: { id: string; body: unknown },
): Promise<void> {
  if (!dlqQueue.endsWith("-dlq")) {
    throw new Error(`not a dlq: ${dlqQueue}`);
  }
  const source = dlqQueue.slice(0, -"-dlq".length);
  await env.DB.prepare(
    "INSERT OR REPLACE INTO dead_letters (id, queue, body, failed_at, replayed_at) VALUES (?1, ?2, ?3, ?4, NULL)",
  )
    .bind(message.id, source, JSON.stringify(message.body), new Date().toISOString())
    .run();
}
```

(b) index.ts の queue() 冒頭に分岐を追加:

```ts
if (batch.queue.endsWith("-dlq")) {
  // DLQ consumer: D1 に退避できたものだけ ack する。insert 失敗は retry
  // (DLQ の DLQ は無い — max_retries 10 を使い切ると喪失するリスクは許容し console.error に残す)。
  for (const message of batch.messages) {
    try {
      await parkDeadLetter(env, batch.queue, { id: message.id, body: message.body });
      message.ack();
    } catch (error) {
      console.error("dlq park failed", batch.queue, error);
      message.retry();
    }
  }
  return;
}
```

(c) wrangler.jsonc の consumers に追加(既存 2 consumer の「意図的に consumer は付けない」コメントを「Phase 10: DLQ は D1 退避 consumer が受ける(ack は durable insert 後)」へ書き換える):

```jsonc
{ "queue": "plyrs-projection-dlq", "max_batch_timeout": 0, "max_batch_size": 10, "max_retries": 10 },
{ "queue": "plyrs-modules-dlq", "max_batch_timeout": 0, "max_batch_size": 10, "max_retries": 10 },
```

(d) routes/super.ts へ追記:

```ts
  .get("/dead-letters", async (c) => {
    const rows = await drizzle(c.env.DB)
      .select()
      .from(deadLetters)
      .orderBy(desc(deadLetters.failedAt))
      .limit(200);
    return c.json({ deadLetters: rows });
  })
  .post("/dead-letters/:id/replay", async (c) => {
    const id = c.req.param("id");
    const row = (
      await drizzle(c.env.DB).select().from(deadLetters).where(eq(deadLetters.id, id)).limit(1)
    )[0];
    if (row === undefined) {
      return c.json({ error: "not_found" }, 404);
    }
    // producer binding は環境ローカル(env 分割後もこの判定は名前の前方一致で安定)
    const producer = row.queue.startsWith("plyrs-modules")
      ? c.env.MODULES_QUEUE
      : c.env.PROJECTION_QUEUE;
    await producer.send(JSON.parse(row.body));
    await drizzle(c.env.DB)
      .update(deadLetters)
      .set({ replayedAt: new Date().toISOString() })
      .where(eq(deadLetters.id, id));
    await writeAudit(c.env.DB, {
      actorId: c.get("superAdmin").adminId,
      action: "dlq.replay",
      targetType: "dead_letter",
      targetId: id,
      detail: { queue: row.queue },
    });
    return c.json({ ok: true });
  })
  .delete("/dead-letters/:id", async (c) => {
    const id = c.req.param("id");
    await drizzle(c.env.DB).delete(deadLetters).where(eq(deadLetters.id, id));
    await writeAudit(c.env.DB, {
      actorId: c.get("superAdmin").adminId,
      action: "dlq.discard",
      targetType: "dead_letter",
      targetId: id,
    });
    return c.json({ ok: true });
  })
```

(replay の `JSON.parse(row.body)` は park 時に自前で serialize した値なので信頼できる — 境界コメントを付す。producer 型は `Queue<ProjectionJob | ModuleQueueJob>` のユニオンで送る形に合わせて cast を避ける。)

- [ ] **Step 4: PASS 確認** — Run: `pnpm --filter @plyrs/api exec vitest run dead-letters` → PASS(フルスイートの [mf:warn] DLQ 移動警告は既知ノイズ)

- [ ] **Step 5: コミット**

```bash
git add apps/api/src/ops/dead-letters.ts apps/api/src/index.ts apps/api/wrangler.jsonc apps/api/src/routes/super.ts apps/api/test/dead-letters.test.ts
git commit -m "feat: DLQ の D1 退避と手動リプレイ"
```

---

### Task 11: 再投影・型再配布トリガールート

**Files:**
- Modify: `apps/api/src/routes/super.ts`(追記)
- Create: `apps/api/src/auth/super-context.ts`
- Test: `apps/api/test/super-triggers.test.ts`

**Interfaces:**
- Produces: `superAuthContext(adminId: string, tenantId: string): AuthContext`。HTTP: `POST /super/v1/tenants/:tenantId/reproject` → `{ok: true, epoch}`、`GET /super/v1/modules` → `{modules: [{moduleId, version, name, enabledTenants}]}`、`POST /super/v1/modules/:moduleId/redistribute` → 202 `{ok: true}`(§15-1 のトリガー未実装の消化)。

- [ ] **Step 1: 失敗するテストを書く**

test/super-triggers.test.ts:

```ts
describe("super operational triggers", () => {
  it("starts a reprojection with a synthetic super auth context", async () => {
    // 準備: テナント + 型 + record + publish(既存ヘルパ)→ 投影が着地するまでポーリング
    // → projected_records を直接 DELETE(乖離状態を作る)
    // → POST /super/v1/tenants/:tenantId/reproject(super cookie)→ 200 {ok: true, epoch}
    // → 投影が復元されるまでポーリング + audit 'reproject.start'
  });

  it("enqueues a module redistribute and fans out to enabled tenants", async () => {
    // 準備: tenant_modules に enabled=1 の行を direct insert(afterEach で削除 — 規律)
    // → POST /super/v1/modules/booking/redistribute → 202 + audit 'module.redistribute'
    // → 実 miniflare ブローカ経由で module_sync が各テナント DO へ届き applied version が
    //   進む(module-redistribute.test.ts の観測様式)までポーリング
    // 未知 moduleId は 404 { error: "unknown_module" }
  });
});
```

- [ ] **Step 2: FAIL 確認** — Run: `pnpm --filter @plyrs/api exec vitest run super-triggers` → FAIL

- [ ] **Step 3: 実装**

(a) apps/api/src/auth/super-context.ts:

```ts
import type { AuthContext } from "../do/authorize";

// design-spec §11.6: super は第2段認可を「飛び越える」。実装形は Worker(信頼境界)が
// owner 相当の合成 AuthContext を DO RPC へ渡すこと。この関数の呼び出し元は必ず
// writeAudit で行使を記録する(強い権限には記録を伴わせる)。
export function superAuthContext(adminId: string, tenantId: string): AuthContext {
  return { userId: `super:${adminId}`, role: "owner", tenantId };
}
```

(b) routes/super.ts へ追記:

```ts
  .post("/tenants/:tenantId/reproject", async (c) => {
    const tenantId = c.req.param("tenantId");
    const stub = c.env.TENANT_DO.get(c.env.TENANT_DO.idFromName(tenantId));
    const result = asReprojectResult(
      await stub.startReprojection(tenantId, superAuthContext(c.get("superAdmin").adminId, tenantId)),
    );
    if (!result.ok) {
      return c.json(result, 403);
    }
    await writeAudit(c.env.DB, {
      actorId: c.get("superAdmin").adminId,
      action: "reproject.start",
      targetType: "tenant",
      targetId: tenantId,
      detail: { epoch: result.epoch },
    });
    return c.json(result);
  })
  .get("/modules", async (c) => {
    const counts = await drizzle(c.env.DB)
      .select({ moduleId: tenantModules.moduleId, enabledTenants: count() })
      .from(tenantModules)
      .where(eq(tenantModules.enabled, 1))
      .groupBy(tenantModules.moduleId);
    const byId = new Map(counts.map((row) => [row.moduleId, row.enabledTenants]));
    const modules = Object.values(MODULE_REGISTRY).map((manifest) => ({
      moduleId: manifest.moduleId,
      version: manifest.version,
      name: manifest.name,
      enabledTenants: byId.get(manifest.moduleId) ?? 0,
    }));
    return c.json({ modules });
  })
  // §15-1: 型定義再配布のトリガー(機構は Phase 9 で完成済み — ここが「誰がいつ積むか」)
  .post("/modules/:moduleId/redistribute", async (c) => {
    const moduleId = c.req.param("moduleId");
    if (!(moduleId in MODULE_REGISTRY)) {
      return c.json({ error: "unknown_module" }, 404);
    }
    await c.env.MODULES_QUEUE.send({ kind: "module_redistribute", moduleId });
    await writeAudit(c.env.DB, {
      actorId: c.get("superAdmin").adminId,
      action: "module.redistribute",
      targetType: "module",
      targetId: moduleId,
    });
    return c.json({ ok: true }, 202);
  })
```

(import: `MODULE_REGISTRY` は apps/api/src/modules/registry.ts。manifest のプロパティ名(moduleId / version / name)は registry.ts の実形に合わせる。`asReprojectResult` は routes/tenant.ts が使っている既存アンラップを import。)

- [ ] **Step 4: PASS 確認** — Run: `pnpm --filter @plyrs/api exec vitest run super-triggers` → PASS

- [ ] **Step 5: api 全体 + lint の確認**

Run: `pnpm --filter @plyrs/api test && pnpm lint`
Expected: 全 green・警告 0(api 面はこのタスクで完成 — ここで一度全体を締める)

- [ ] **Step 6: コミット**

```bash
git add apps/api/src/auth/super-context.ts apps/api/src/routes/super.ts apps/api/test/super-triggers.test.ts
git commit -m "feat: 再投影・型再配布の特権トリガー"
```

---

### Task 12: admin super コンソール基盤(プロキシ + ログイン + シェル)

**Files:**
- Modify: `apps/admin/src/lib/api-paths.ts` / `apps/admin/src/server.ts` / `apps/admin/wrangler.jsonc`(vars)/ `apps/admin/src/router.tsx`(context に superApi)
- Create: `apps/admin/src/lib/super-api.ts` / `apps/admin/src/routes/super-login.tsx` / `apps/admin/src/routes/super/route.tsx`
- Test: `apps/admin/src/lib/api-paths.test.ts`(追記)/ `apps/admin/src/super-login.test.tsx`(新規)

**Interfaces:**
- Consumes: Task 6 の /super-auth 契約。
- Produces: `isApiPath` が `/super-auth`・`/super/v1` を転送対象に含む。`createSuperApi(baseFetch): SuperApi`(`get/post/patch/delete` の薄い JSON ラッパー。cookie 認証なので Authorization ヘッダなし)。RouterContext に `superApi` が増える(既存テストの createAppContext 呼び出しは変更不要の形にする)。ルート: `/super-login`(bootstrap 分岐つきログイン)/ `/super` レイアウト(me ガード + nav + ログアウト)。

- [ ] **Step 1: 失敗するテストを書く**

(a) api-paths.test.ts に追記:

```ts
it("forwards super paths", () => {
  expect(isApiPath("/super-auth/login")).toBe(true);
  expect(isApiPath("/super/v1/tenants")).toBe(true);
  expect(isApiPath("/super")).toBe(false); // ページルートは転送しない
  expect(isApiPath("/super-login")).toBe(false);
});
```

(b) super-login.test.tsx(auth-flow.test.tsx の様式 = createAppContext(stubFetch) + createMemoryHistory でルータごと描画):

```tsx
describe("super login", () => {
  it("shows the bootstrap form when not bootstrapped and reveals the totp secret", async () => {
    // stubFetch: GET /super-auth/status → {bootstrapped:false}
    // /super-login を開く → 「初期セットアップ」フォーム(email/password)
    // 送信 → POST /super-auth/bootstrap が呼ばれ、応答の totpSecret / otpauthUri が画面に表示され、
    // TOTP コード入力つきのログインフォームへ切り替わる
  });

  it("logs in with email + password + totp and navigates to /super", async () => {
    // stubFetch: status → {bootstrapped:true} / POST /super-auth/login → 200 {adminId}
    //           / GET /super-auth/me → {adminId, email}
    // フォーム送信(6 桁コード入力含む)→ router の location が /super になり
    // シェルの nav(テナント / ユーザー / DLQ / 監査ログ / モジュール)が描画される
  });

  it("redirects /super to /super-login when unauthenticated", async () => {
    // stubFetch: GET /super-auth/me → 401
    // /super を開く → /super-login へリダイレクト
  });
});
```

- [ ] **Step 2: FAIL 確認** — Run: `pnpm --filter @plyrs/admin exec vitest run super-login api-paths` → FAIL

- [ ] **Step 3: 実装**

(a) api-paths.ts:

```ts
// /super-auth・/super/v1 は api Worker の特権面。/super(ページ)や /super-login は admin の
// ルートなので転送しない — プレフィックスは正確に v1 まで含める。
const API_PREFIXES = ["/auth", "/v1", "/super-auth", "/super/v1"];
```

(b) server.ts(裁定 10 — dev 限定の公開 API 転送):

```ts
export default createServerEntry({
  fetch(request) {
    const { pathname } = new URL(request.url);
    if (isApiPath(pathname)) {
      return env.API.fetch(request);
    }
    // 裁定 10(2026-07-18): E2E がコアジャーニー(publish → 公開 read)を検証するための
    // dev 限定転送。本番は 6a 裁定どおり /public/v1 を admin から配信しない。
    if (env.DEV_PROXY_PUBLIC === "1" && (pathname === "/public/v1" || pathname.startsWith("/public/v1/"))) {
      return env.API.fetch(request);
    }
    return handler.fetch(request);
  },
});
```

apps/admin/wrangler.jsonc に `"vars": { "DEV_PROXY_PUBLIC": "0" }` を追加し、`pnpm --filter @plyrs/admin cf-typegen` で型再生成。apps/admin/.dev.vars(コミットしない)と .dev.vars.example(コミットする)に `DEV_PROXY_PUBLIC=1` を記載。

(c) lib/super-api.ts(admin-api.ts の様式に合わせた薄い JSON ラッパー。トークン管理なし):

```ts
export class SuperApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(`super api ${status}: ${code}`);
  }
}

export interface SuperApi {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
  patch<T>(path: string, body?: unknown): Promise<T>;
  delete<T>(path: string, body?: unknown): Promise<T>;
}

export function createSuperApi(baseFetch: typeof fetch = fetch): SuperApi {
  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await baseFetch(path, {
      method,
      credentials: "include",
      ...(body === undefined
        ? {}
        : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      throw new SuperApiError(response.status, payload.error ?? "unknown");
    }
    return (await response.json()) as T;
  }
  return {
    get: (path) => request("GET", path),
    post: (path, body) => request("POST", path, body),
    patch: (path, body) => request("PATCH", path, body),
    delete: (path, body) => request("DELETE", path, body),
  };
}
```

(d) router.tsx — createAppContext に `superApi: createSuperApi(fetchImpl)` を追加(既存シグネチャは維持し、内部で同じ fetchImpl から生成する — 既存テストの呼び出しを壊さない)。

(e) routes/super-login.tsx — /super-auth/status を loader(fetchQuery)で読み、bootstrapped=false なら bootstrap フォーム → 成功後に totpSecret / otpauthUri を表示して「認証アプリに登録してからコードを入力」でログインフォームへ。bootstrapped=true なら email / password / totpCode(inputMode="numeric" maxLength 6)フォーム → POST /super-auth/login → 成功で `navigate({ to: "/super" })`。エラーは既存 login.tsx のエラーバナー様式。packages/ui の TextField / Button を使用。

(f) routes/super/route.tsx — beforeLoad で `context.superApi.get("/super-auth/me")` を試し、SuperApiError(401)なら `redirect({ to: "/super-login" })`。レイアウトは既存 /t/$tenantSlug シェルの簡易版: ヘッダに「plyrs 運営コンソール」+ me の email + ログアウトボタン(POST /super-auth/logout → /super-login へ)、nav リンク(テナント `/super` / ユーザー `/super/users` / DLQ `/super/dlq` / 監査ログ `/super/audit` / モジュール `/super/modules`)、`<Outlet />`。

(g) 子ルートのプレースホルダ: routes/super/index.tsx / users.tsx / dlq.tsx / audit.tsx / modules.tsx / tenants.$tenantId.tsx を「見出しのみ」で作成(Task 13/14 が実装。ルート生成を 1 回で済ませるため骨組みはここで全部切る)。

- [ ] **Step 4: routeTree 再生成(コントローラ二段方式)**

実装サブエージェントは routeTree.gen.ts を触らず報告終了 → コントローラが `pnpm --filter @plyrs/admin build` で再生成して差分をコミットに含める。

- [ ] **Step 5: PASS 確認** — Run: `pnpm --filter @plyrs/admin test` → 全 green(新規 3 + 既存)

- [ ] **Step 6: コミット**

```bash
git add apps/admin/src/lib/api-paths.ts apps/admin/src/lib/api-paths.test.ts apps/admin/src/server.ts apps/admin/src/lib/super-api.ts apps/admin/src/router.tsx apps/admin/src/routes/super-login.tsx apps/admin/src/routes/super/ apps/admin/src/super-login.test.tsx apps/admin/src/routeTree.gen.ts apps/admin/wrangler.jsonc apps/admin/worker-configuration.d.ts apps/admin/.dev.vars.example
git commit -m "feat: 運営コンソールの基盤(ログイン + シェル)"
```

---

### Task 13: admin テナント管理画面 + self-serve 作成 UI 撤去

**Files:**
- Modify: `apps/admin/src/routes/super/index.tsx` / `apps/admin/src/routes/super/tenants.$tenantId.tsx` / `apps/admin/src/routes/super/users.tsx` / `apps/admin/src/routes/tenants.tsx`(作成フォーム撤去)
- Test: `apps/admin/src/super-tenants.test.tsx`(新規)+ 既存 auth-flow / shell テストの更新

**Interfaces:**
- Consumes: Task 7/8 の HTTP 契約(superApi 経由)。
- Produces: テナント一覧(作成・rename・削除)/ テナント詳細(メンバー一覧・membership 剥奪)/ ユーザー検索(BAN・unban)。一般側 /tenants は一覧 + 「テナントは運営者が発行します」の空状態のみ。

- [ ] **Step 1: 失敗するテストを書く**

super-tenants.test.tsx(super-login.test.tsx と同じルータ描画様式。stubFetch に /super-auth/me 200 を含めてガードを通す):

```tsx
describe("super tenant management", () => {
  it("lists tenants and creates one with an owner email", async () => {
    // GET /super/v1/tenants → 2 件 → テーブルに slug/name/memberCount
    // 作成フォーム(name/slug/ownerEmail)送信 → POST /super/v1/tenants の body を検証
    // → 成功後に一覧再取得(invalidate)
  });

  it("deletes a tenant only after slug confirmation", async () => {
    // 削除ボタン → 確認ダイアログ(slug の再入力を要求)
    // 不一致なら DELETE は飛ばない / 一致で DELETE /super/v1/tenants/:id が飛ぶ
  });

  it("shows members on the detail page and revokes a membership", async () => {
    // GET .../members → 一覧。剥奪ボタン → DELETE .../members/:userId
  });

  it("bans a user from the users page", async () => {
    // 検索入力 → GET /super/v1/users?q=… → BAN ボタン → POST .../ban
  });
});
```

既存テスト更新: auth-flow.test.tsx 等で「テナント作成フォーム」を前提にしている箇所を、一覧のみ + 空状態文言(「テナントは運営者が発行します」)のアサートへ変更。

- [ ] **Step 2: FAIL 確認** — Run: `pnpm --filter @plyrs/admin exec vitest run super-tenants auth-flow` → FAIL

- [ ] **Step 3: 実装**

- routes/super/index.tsx: React Query(`queryKey: ["super", "tenants"]` / `queryFn: () => superApi.get("/super/v1/tenants")`)で一覧テーブル(caption 付き — 6b の規約)。作成フォーム(TextField name / slug / ownerEmail(任意)+ Button)。rename はインライン編集(行の「名称変更」→ TextField + 保存)。削除は confirm ダイアログで slug 再入力一致時のみ DELETE(破壊的操作のガード)。mutation 成功時は `queryClient.invalidateQueries({ queryKey: ["super", "tenants"] })`。エラーは SuperApiError の code をバナー表示(既存様式)。
- routes/super/tenants.$tenantId.tsx: メンバー一覧(GET members)+ 各行に「剥奪」ボタン(confirm 後 DELETE)。ヘッダにテナント名 / slug。Task 14 がこのページへ health / orphan / reproject を追記する予定の見出し構造にしておく。
- routes/super/users.tsx: 検索 TextField(送信で `?q=` 再取得)+ 結果テーブル + BAN / BAN 解除ボタン(POST)。
- routes/tenants.tsx: 作成フォームと関連 mutation を削除。一覧が空のときは「テナントは運営者が発行します」を表示。

- [ ] **Step 4: routeTree 再生成(コントローラ二段)** — Task 12 と同じ(子ルートの骨組みが既にあるため差分が出ない場合はスキップ可)

- [ ] **Step 5: PASS 確認** — Run: `pnpm --filter @plyrs/admin test` → 全 green

- [ ] **Step 6: コミット**

```bash
git add apps/admin/src/routes/super/ apps/admin/src/routes/tenants.tsx apps/admin/src/super-tenants.test.tsx apps/admin/src/auth-flow.test.tsx apps/admin/src/routeTree.gen.ts
git commit -m "feat: テナント管理画面と self-serve 作成の撤去"
```

---

### Task 14: admin 運用画面(health / orphan / DLQ / audit / modules)

**Files:**
- Modify: `apps/admin/src/routes/super/tenants.$tenantId.tsx`(health / orphan / reproject 追記)/ `apps/admin/src/routes/super/dlq.tsx` / `apps/admin/src/routes/super/audit.tsx` / `apps/admin/src/routes/super/modules.tsx`
- Test: `apps/admin/src/super-ops.test.tsx`(新規)

**Interfaces:**
- Consumes: Task 9/10/11 の HTTP 契約。

- [ ] **Step 1: 失敗するテストを書く**

super-ops.test.tsx:

```tsx
describe("super operations pages", () => {
  it("runs a health check on the tenant detail page", async () => {
    // 「健全性チェックを実行」ボタン → GET .../health →
    // archivedPublished テーブル / legacyAssetType の警告表示 / legacyRichtextRecords 一覧
  });

  it("scans and deletes orphan assets", async () => {
    // 「孤児アセットを走査」→ GET .../orphan-assets → チェックボックス選択 →
    // 「選択を削除」→ DELETE body {keys} を検証
  });

  it("triggers a reprojection with confirmation", async () => {
    // 「再投影を開始」→ confirm → POST .../reproject → epoch を含む完了バナー
  });

  it("lists dead letters and replays one", async () => {
    // /super/dlq: GET /super/v1/dead-letters → テーブル(queue / failedAt / replayedAt)
    // 「再投入」→ POST replay / 「破棄」→ confirm → DELETE
  });

  it("shows the audit log", async () => {
    // /super/audit: GET /super/v1/audit-logs → action / actor / target / createdAt のテーブル
  });

  it("lists modules and redistributes type definitions", async () => {
    // /super/modules: GET /super/v1/modules → moduleId / version / enabledTenants
    // 「型定義を再配布」→ POST redistribute
  });
});
```

**注意: audit 一覧の API はまだ無い** — このタスクで routes/super.ts に追加する(api 側の小さな追記を含むタスクとする):

```ts
  .get("/audit-logs", async (c) => {
    const rows = await drizzle(c.env.DB)
      .select()
      .from(auditLogs)
      .orderBy(desc(auditLogs.createdAt))
      .limit(200);
    return c.json({ auditLogs: rows });
  })
```

対応する api テストを test/super-users.test.ts に 1 本追記(一覧が createdAt 降順で返る)。

- [ ] **Step 2: FAIL 確認** — Run: `pnpm --filter @plyrs/admin exec vitest run super-ops` → FAIL

- [ ] **Step 3: 実装** — 各ページとも React Query + superApi + packages/ui コンポーネント。破壊的操作(orphan 削除 / DLQ 破棄 / 再投影)は confirm を挟む。走査系(health / orphan)はボタン起動の `useMutation`(自動 refetch しない — DO を無駄に起こさない)。表示は既存の一覧テーブル様式(caption 付き)。

- [ ] **Step 4: PASS 確認** — Run: `pnpm --filter @plyrs/admin test && pnpm --filter @plyrs/api exec vitest run super-users` → 全 green

- [ ] **Step 5: routeTree 再生成(差分があれば・コントローラ二段)+ コミット**

```bash
git add apps/admin/src/routes/super/ apps/admin/src/super-ops.test.tsx apps/api/src/routes/super.ts apps/api/test/super-users.test.ts apps/admin/src/routeTree.gen.ts
git commit -m "feat: 運用画面(health/orphan/DLQ/audit/modules)"
```

---

### Task 15: デプロイ整備(wrangler env 分割 + GitHub Actions + 手順書)

**Files:**
- Modify: `apps/api/wrangler.jsonc` / `apps/admin/wrangler.jsonc` / `apps/api/src/index.ts`(queue 分岐の env 対応)/ `apps/api/test/dead-letters.test.ts`(追記)
- Create: `.github/workflows/deploy.yml` / `docs/deploy.md`

**Interfaces:**
- Produces: `wrangler deploy --env preview|production` 可能な設定。キュー名規約 = `plyrs-<用途>[-preview]` + DLQ は `…-dlq`(サフィックスは -dlq の**前**)。queue() の判別は `startsWith("plyrs-modules")` / `endsWith("-dlq")` に統一(トップレベル/preview/production の全キュー名で成立)。

- [ ] **Step 1: 失敗するテストを書く**

test/dead-letters.test.ts に追記:

```ts
it("parks from env-suffixed dlq names and routes suffixed module queues", async () => {
  const batch = createMessageBatch("plyrs-projection-preview-dlq", [
    { id: "msg-env", timestamp: new Date(), body: { jobType: "reproject", tenantId: "t", cursor: null, epoch: 1 }, attempts: 5 },
  ]);
  await worker.queue(batch, env, createExecutionContext());
  const row = (await drizzle(env.DB).select().from(deadLetters).where(eq(deadLetters.id, "msg-env")))[0];
  expect(row?.queue).toBe("plyrs-projection-preview");
});
```

- [ ] **Step 2: FAIL 確認** — Run: `pnpm --filter @plyrs/api exec vitest run dead-letters` → FAIL(index.ts の DLQ 分岐が既に endsWith なら park は通る — その場合このテストは Task 10 実装の回帰固定として即 green でよい。**modules 判別の `batch.queue === "plyrs-modules"` → `startsWith` 化は必ず行う**)

- [ ] **Step 3: 実装**

(a) index.ts の queue() — modules 判別を前方一致へ(コメントも更新):

```ts
if (batch.queue.startsWith("plyrs-modules")) {
  // env サフィックス(plyrs-modules-preview 等)でも module キューとして扱う(Task 15 の命名規約)
  await handleModuleJob(env, message.body as ModuleQueueJob);
} else {
  await handleProjectionJob(env, message.body as ProjectionJob, nowMs);
}
```

(b) apps/api/wrangler.jsonc に env ブロックを追加(トップレベルは dev/vitest 用としてそのまま維持。**素の `wrangler deploy`(--env なし)は禁止 — 手順書に明記**):

```jsonc
"env": {
  "preview": {
    "name": "plyrs-api-preview",
    "durable_objects": { "bindings": [{ "name": "TENANT_DO", "class_name": "TenantDO" }] },
    "d1_databases": [
      // database_id は docs/deploy.md の手順で作成後に実値へ差し替える(それまでダミー)
      { "binding": "DB", "database_name": "plyrs-control-plane-preview", "database_id": "10000000-0000-0000-0000-000000000000", "migrations_dir": "../../packages/db/drizzle-d1" },
      { "binding": "PROJECTION_DB", "database_name": "plyrs-projection-preview", "database_id": "10000000-0000-0000-0000-000000000001", "migrations_dir": "../../packages/db/drizzle-projection" },
    ],
    "kv_namespaces": [
      { "binding": "BLOCKLIST", "id": "10000000000000000000000000000000" },
      { "binding": "TENANT_SLUGS", "id": "10000000000000000000000000000001" },
    ],
    "r2_buckets": [{ "binding": "ASSETS", "bucket_name": "plyrs-assets-preview" }],
    "queues": {
      "producers": [
        { "binding": "PROJECTION_QUEUE", "queue": "plyrs-projection-preview" },
        { "binding": "MODULES_QUEUE", "queue": "plyrs-modules-preview" },
      ],
      "consumers": [
        { "queue": "plyrs-projection-preview", "max_batch_timeout": 0, "max_batch_size": 10, "max_retries": 5, "dead_letter_queue": "plyrs-projection-preview-dlq" },
        { "queue": "plyrs-modules-preview", "max_batch_timeout": 0, "max_batch_size": 10, "max_retries": 5, "dead_letter_queue": "plyrs-modules-preview-dlq" },
        { "queue": "plyrs-projection-preview-dlq", "max_batch_timeout": 0, "max_batch_size": 10, "max_retries": 10 },
        { "queue": "plyrs-modules-preview-dlq", "max_batch_timeout": 0, "max_batch_size": 10, "max_retries": 10 },
      ],
    },
    "triggers": { "crons": ["17 3 * * *"] },
    "unsafe": {
      "bindings": [
        // §15-2: namespace_id はアカウント内で一意の実値(環境ごとに別)
        { "name": "PUBLIC_WRITE_LIMITER", "type": "ratelimit", "namespace_id": "2001", "simple": { "limit": 10, "period": 60 } },
        { "name": "AUTH_LIMITER", "type": "ratelimit", "namespace_id": "2002", "simple": { "limit": 10, "period": 60 } },
      ],
    },
  },
  "production": {
    "name": "plyrs-api",
    // 構成は preview と同型。суффィックスなしの資源名 / database_id ダミーは 2000…系 /
    // ratelimit namespace_id は 3001 / 3002。全文を preview から複製して名前だけ変える。
  },
},
```

(production ブロックは preview の複製から `-preview` サフィックスを外し、ダミー ID を `20000000…` 系に、namespace_id を 3001/3002 にしたものを**全文**書く — 省略しない。)

(c) apps/admin/wrangler.jsonc:

```jsonc
"env": {
  "preview": {
    "name": "plyrs-admin-preview",
    "services": [{ "binding": "API", "service": "plyrs-api-preview" }],
    "vars": { "DEV_PROXY_PUBLIC": "0" },
  },
  "production": {
    "name": "plyrs-admin",
    "services": [{ "binding": "API", "service": "plyrs-api" }],
    "vars": { "DEV_PROXY_PUBLIC": "0" },
  },
},
```

(d) .github/workflows/deploy.yml:

```yaml
name: Deploy

on:
  push:
    branches: [main]
  workflow_dispatch:
    inputs:
      environment:
        description: "deploy target"
        required: true
        default: "production"
        type: choice
        options: [preview, production]

concurrency:
  group: deploy-${{ github.event_name == 'workflow_dispatch' && inputs.environment || 'preview' }}
  cancel-in-progress: false

jobs:
  deploy:
    runs-on: ubuntu-latest
    # GitHub の environment 保護(production に必須レビュアーを設定)は手順書の初期設定に含む
    environment: ${{ github.event_name == 'workflow_dispatch' && inputs.environment || 'preview' }}
    env:
      CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
      CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
      DEPLOY_ENV: ${{ github.event_name == 'workflow_dispatch' && inputs.environment || 'preview' }}
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - name: Apply D1 migrations
        run: |
          pnpm exec wrangler d1 migrations apply DB --remote -c apps/api/wrangler.jsonc --env "$DEPLOY_ENV"
          pnpm exec wrangler d1 migrations apply PROJECTION_DB --remote -c apps/api/wrangler.jsonc --env "$DEPLOY_ENV"
      - name: Deploy api
        run: pnpm exec wrangler deploy -c apps/api/wrangler.jsonc --env "$DEPLOY_ENV"
      - name: Build and deploy admin
        run: |
          CLOUDFLARE_ENV="$DEPLOY_ENV" pnpm --filter @plyrs/admin build
          pnpm exec wrangler deploy -c "$(find apps/admin/dist -name wrangler.json -print -quit)"
```

(admin のビルド出力に vite cloudflare plugin が解決済み wrangler.json を出す。実装時に `CLOUDFLARE_ENV=preview pnpm --filter @plyrs/admin build` を実行して dist 内の実パスを確認し、find で拾えることを検証。拾えない構成なら実パスに直す。)

(e) docs/deploy.md — 以下の章立てで手順書を書く(**§15-2 の 3 点はここで消化**):

```markdown
# デプロイ手順書(preview / production)

## 0. 前提と警告
- 素の `wrangler deploy`(--env なし)は禁止(トップレベルは dev/vitest 用のダミー ID)。
- GitHub Secrets: CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID。production environment には必須レビュアーを設定。

## 1. 初回リソース作成(環境ごと)
wrangler queues create / d1 create / kv namespace create / r2 bucket create の実コマンド一覧
(plyrs-projection[-preview], plyrs-projection[-preview]-dlq, plyrs-modules[-preview],
 plyrs-modules[-preview]-dlq, plyrs-control-plane[-preview], plyrs-projection[-preview],
 plyrs-assets[-preview], BLOCKLIST / TENANT_SLUGS 用 KV ×2)
→ 出力された ID を wrangler.jsonc の env ブロックへ転記する箇所の一覧表。
ratelimit namespace_id(2001/2002/3001/3002)がアカウント内で衝突しないことの確認。

## 2. secrets(環境ごと)
wrangler secret put JWT_SECRET --env <env> -c apps/api/wrangler.jsonc   # 32 字以上必須(短いと全 API が 500)
wrangler secret put TURNSTILE_SECRET_KEY --env <env> ...                # 公開 write 用(未設定は 503 fail-closed)
wrangler secret put AUTH_TURNSTILE_SECRET_KEY --env <env> ...           # 任意(設定時のみ signup/login で必須化)
AUTH_TURNSTILE_SITE_KEY は vars で設定(任意)。

## 3. デプロイ
main push → preview 自動 / production は Actions の workflow_dispatch。
手動時のコマンド(migrations apply → api deploy → admin build+deploy)も併記。

## 4. super 管理者の初期化
curl -X POST https://<api>/super-auth/bootstrap -H 'content-type: application/json' \
  -d '{"email":"...","password":"..."}'
→ 応答の totpSecret を認証アプリに登録(otpauthUri を手入力)。以後 bootstrap は 403。
TOTP 紛失時の復旧: DELETE FROM super_admins; を wrangler d1 execute で実行して再 bootstrap
(super_sessions も削除)。

## 5. ローカル開発の注意
apps/api/.dev.vars の JWT_SECRET は 32 字以上に更新が必要(Phase 10 から)。
apps/e2e のテストは apps/{api,admin}/.wrangler(ローカル永続化)を毎回削除する。
```

- [ ] **Step 4: 検証**

```bash
cd <worktree> && pnpm exec wrangler deploy --dry-run --outdir "$TMPDIR/api-preview" -c apps/api/wrangler.jsonc --env preview
cd <worktree> && pnpm exec wrangler deploy --dry-run --outdir "$TMPDIR/api-prod" -c apps/api/wrangler.jsonc --env production
cd <worktree> && CLOUDFLARE_ENV=preview pnpm --filter @plyrs/admin build
cd <worktree> && pnpm --filter @plyrs/api exec vitest run dead-letters
```
Expected: すべて成功(dry-run はリモート検証なしでバンドルが通ること)

- [ ] **Step 5: コミット**

```bash
git add apps/api/wrangler.jsonc apps/admin/wrangler.jsonc apps/api/src/index.ts apps/api/test/dead-letters.test.ts .github/workflows/deploy.yml docs/deploy.md
git commit -m "feat: preview/production 環境分割とデプロイ CI"
```

---

### Task 16: E2E(Playwright)基盤 + スモーク 3 本

**Files:**
- Create: `apps/e2e/package.json` / `apps/e2e/tsconfig.json` / `apps/e2e/playwright.config.ts` / `apps/e2e/global-setup.ts` / `apps/e2e/helpers/totp.ts` / `apps/e2e/tests/core-journey.spec.ts` / `apps/e2e/tests/super-console.spec.ts` / `apps/e2e/tests/two-tab-sync.spec.ts`
- Modify: `pnpm-workspace.yaml`(catalog に @playwright/test)/ `.github/workflows/ci.yml`(e2e ジョブ)/ `.gitignore`(test-results / playwright-report)

**Interfaces:**
- Consumes: dev サーバー(admin + auxiliaryWorkers の api、DEV_PROXY_PUBLIC=1)/ Task 6〜13 の HTTP・UI。
- 注意: **E2E はローカル永続化(apps/{api,admin}/.wrangler)を毎回削除する**(bootstrap の「空のときのみ」と slug 一意制約の再現性のため。開発中のローカルデータは消える — 手順書に記載済み)。

- [ ] **Step 1: パッケージ骨組み**

pnpm-workspace.yaml の catalog に `"@playwright/test": "^1.54.2"`(追加時点の最新 1.x に固定)を追記。

apps/e2e/package.json:

```json
{
  "name": "@plyrs/e2e",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "playwright test",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "@playwright/test": "catalog:",
    "@types/node": "catalog:",
    "typescript": "catalog:"
  }
}
```

apps/e2e/tsconfig.json は他パッケージの strict 設定に倣う(include: ["*.ts", "tests", "helpers"])。

apps/e2e/playwright.config.ts:

```ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  workers: 1, // 共有 dev サーバー + 共有ローカル D1 のため直列
  globalSetup: "./global-setup.ts",
  use: { baseURL: "http://localhost:5199" },
  webServer: {
    command: "pnpm --filter @plyrs/admin exec vite dev --port 5199 --strictPort",
    url: "http://localhost:5199",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
```

apps/e2e/global-setup.ts(前述の設計確定どおり):

```ts
import { existsSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export default function globalSetup(): void {
  // ローカル永続化をリセット(bootstrap 空前提・slug 一意の再現性)。開発データは消える(手順書に記載)。
  for (const dir of ["apps/admin/.wrangler", "apps/api/.wrangler"]) {
    rmSync(path.join(repoRoot, dir), { recursive: true, force: true });
  }
  const apiVars = path.join(repoRoot, "apps/api/.dev.vars");
  if (!existsSync(apiVars)) {
    writeFileSync(apiVars, "JWT_SECRET=e2e-secret-do-not-use-in-prod-0123456789\n");
  }
  const adminVars = path.join(repoRoot, "apps/admin/.dev.vars");
  if (!existsSync(adminVars)) {
    writeFileSync(adminVars, "DEV_PROXY_PUBLIC=1\n");
  }
}
```

(実装時の検証: dev サーバーの永続化パスが本当に上記 2 箇所かを、一度 dev を起動して signup → 再起動 → データ残存 → rm → 消えることで確認する。別パスだったら global-setup を実パスへ直す。)

apps/e2e/helpers/totp.ts(node:crypto 版 — api 側 totp.ts と同じ RFC 6238):

```ts
import { createHmac } from "node:crypto";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Decode(encoded: string): Buffer {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of encoded.toUpperCase().replace(/=+$/, "")) {
    const idx = ALPHABET.indexOf(char);
    if (idx === -1) throw new Error("invalid base32");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function totpCode(secretBase32: string, nowMs: number = Date.now()): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(Math.floor(nowMs / 1000 / 30)));
  const mac = createHmac("sha1", base32Decode(secretBase32)).update(message).digest();
  const offset = (mac[mac.length - 1] ?? 0) & 0x0f;
  const code =
    (((mac[offset] ?? 0) & 0x7f) << 24) |
    ((mac[offset + 1] ?? 0) << 16) |
    ((mac[offset + 2] ?? 0) << 8) |
    (mac[offset + 3] ?? 0);
  return (code % 1_000_000).toString().padStart(6, "0");
}
```

- [ ] **Step 2: スモーク 3 本を書く**

共通ヘルパ(spec 内 or helpers/setup.ts): `page.request` は browser context と cookie を共有するため、API 準備(signup / bootstrap / super login / テナント作成)は request で行い、UI 検証だけブラウザで行う。

(a) tests/super-console.spec.ts — **UI 経由の bootstrap → TOTP ログイン → テナント作成 → 監査ログ**:

```ts
import { expect, test } from "@playwright/test";
import { totpCode } from "../helpers/totp";

test("bootstrap, totp login, tenant CRUD and audit log", async ({ page }) => {
  await page.goto("/super-login");
  // 初回はセットアップフォーム
  await page.getByLabel("メールアドレス").fill("root@example.com");
  await page.getByLabel("パスワード").fill("super-password-123");
  await page.getByRole("button", { name: /セットアップ/ }).click();
  const secret = await page.getByTestId("totp-secret").innerText();
  await page.getByLabel("認証コード").fill(totpCode(secret));
  await page.getByRole("button", { name: /ログイン/ }).click();
  await expect(page).toHaveURL(/\/super$/);
  // テナント作成
  await page.getByLabel("名前").fill("Smoke Tenant");
  await page.getByLabel("slug").fill("smoke");
  await page.getByRole("button", { name: /作成/ }).click();
  await expect(page.getByRole("cell", { name: "smoke" })).toBeVisible();
  // 監査ログ
  await page.getByRole("link", { name: "監査ログ" }).click();
  await expect(page.getByRole("cell", { name: "tenant.create" })).toBeVisible();
});
```

(b) tests/core-journey.spec.ts — **signup → (super がテナント発行) → 型作成 → record → publish → 公開 API**:

```ts
import { expect, test } from "@playwright/test";
import { totpCode } from "../helpers/totp";

test("signup to published public API", async ({ page }) => {
  const email = `user+${Date.now()}@example.com`;
  const password = "user-password-123";
  // API 準備: user signup + super bootstrap/login + テナント発行(owner 任命)
  await page.request.post("/auth/signup", { data: { email, password } });
  const boot = await page.request.post("/super-auth/bootstrap", {
    data: { email: "root@example.com", password: "super-password-123" },
  });
  const { totpSecret } = (await boot.json()) as { totpSecret: string };
  await page.request.post("/super-auth/login", {
    data: { email: "root@example.com", password: "super-password-123", totpCode: totpCode(totpSecret) },
  });
  const created = await page.request.post("/super/v1/tenants", {
    data: { name: "Journey", slug: "journey", ownerEmail: email },
  });
  expect(created.status()).toBe(201);
  // UI: ログイン → テナント → 型作成 → record 作成 → publish
  await page.goto("/login");
  await page.getByLabel("メールアドレス").fill(email);
  await page.getByLabel("パスワード").fill(password);
  await page.getByRole("button", { name: /ログイン/ }).click();
  await page.getByRole("link", { name: "Journey" }).click();
  // 型ビルダーで 'article' 型(title テキストフィールド)を作成 → record 作成 → 公開
  // (セレクタは 6b/7 の admin UI の実ラベルに合わせて実装時に確定する)
  // ...
  // 公開 API(dev 限定転送): 投影は結果整合なのでポーリング
  await expect
    .poll(async () => (await page.request.get("/public/v1/journey/records/article")).status(), {
      timeout: 30_000,
    })
    .toBe(200);
});
```

(c) tests/two-tab-sync.spec.ts — **2 タブ WS 同期(手動バックログ最重要項目)**: 同一 context で page A / page B を開き、両方で同じ record の編集画面を表示 → A でフィールド編集・保存 → B に値が現れることを `expect.poll` で検証 → 逆方向も 1 回。準備(テナント・型・record)は (b) と同じ API + UI 手順を共通ヘルパ化して使う。

(スモークの UI セレクタは実装時に admin の実ラベル(6b の RTL テストが真実源)へ合わせて確定する。ラベル変更はしない — E2E がラベルに追随する。)

- [ ] **Step 3: 実行して green を確認**

```bash
cd <worktree> && pnpm install --no-frozen-lockfile   # lockfile 更新(@playwright/test 追加)
cd <worktree> && pnpm --filter @plyrs/e2e exec playwright install --with-deps chromium
cd <worktree> && pnpm --filter @plyrs/e2e test
```
Expected: 3 spec PASS(flaky なら poll タイムアウトを延ばすか、webServer 起動待ちを調整)

- [ ] **Step 4: CI 配線** — .github/workflows/ci.yml に追記:

```yaml
  e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter @plyrs/e2e exec playwright install --with-deps chromium
      - run: pnpm --filter @plyrs/e2e test
```

.gitignore に `apps/e2e/test-results/` と `apps/e2e/playwright-report/` を追記。

- [ ] **Step 5: コミット**

```bash
git add apps/e2e/ pnpm-workspace.yaml pnpm-lock.yaml .github/workflows/ci.yml .gitignore
git commit -m "test: Playwright E2E スモーク 3 本"
```

---

### Task 17: 一気通貫フローテスト + 全ゲート検証

**Files:**
- Test: `apps/api/test/super-flow.test.ts`(新規)

- [ ] **Step 1: 一気通貫フローテストを書く**

test/super-flow.test.ts — Phase 9 の module-flow.test.ts と同じ「1 本のシナリオで面を縦断する」様式:

```ts
// bootstrap → super login → テナント作成(owner 任命)→ owner が型 + record + publish
// → super: health(archived 0 件)→ record を archive → health に現れる
// → super: reproject → 投影復元 → super: BAN → owner の /auth/token が 403
// → super: テナント削除 → 公開 API が 404 / 投影・R2・control-plane が空
// 各段の応答コードと audit_logs の蓄積(create/reproject.start/user.ban/tenant.delete)を検証
```

(具体コードは既存 e2e 系テストのヘルパを組み合わせて書く。afterEach で resetSuperAdmins + dead_letters/tenant_modules の掃除。)

- [ ] **Step 2: フルゲートを回す**

```bash
cd <worktree> && pnpm test          # 全パッケージ(件数を記録 — Phase 9 時点 707)
cd <worktree> && pnpm typecheck
cd <worktree> && pnpm lint          # 警告 0
cd <worktree> && pnpm format:check
cd <worktree> && pnpm --filter @plyrs/e2e test
```
Expected: すべて green。FAIL があれば superpowers:systematic-debugging で根治(テストの期待値を安易に変えない)。

- [ ] **Step 3: コミット**

```bash
git add apps/api/test/super-flow.test.ts
git commit -m "test: 特権テナント運用の一気通貫フロー"
```

---

## Self-Review(計画作成時に実施済み)

- **仕様カバレッジ**: ロードマップ §2 Phase 10 行(特権ログイン分離 = Task 3/6、テナント CRUD = Task 7、super 権限と監査 = Task 6〜11、健全性チェック = Task 9、デプロイ整備 = Task 15、E2E = Task 16)/ §15 運用申し送り(再配布トリガー = Task 11、本番 3 点 = Task 15、拒否コード不一致 = Task 1)/ §6 裁定必須(ブロック粒度 = Task 5、セキュリティ束 = Task 4)/ §7 BAN 併呼 = Task 5 / §9〜§10 持ち越し(DLQ = Task 10、再投影トリガー = Task 11)/ §14(孤児 R2・レガシー点検 = Task 9)。仕様 7 章の archive 健全性 = Task 9。11.6 = Task 2/3/6。11.7 は Phase 9 で消化済み(本フェーズ対象外)。
- **意図的に薄い箇所**: Task 8/11/13/14/17 のテストは「同計画内の完全な同型例(Task 7 のテスト等)を様式として参照する行動列挙」で記述した。完全コード転記型のタスクではないため、実装者は各ファイル冒頭の様式指定に従うこと(タスクレビュアーはアサーションの実在を必ず確認)。
- **型整合**: superGate の Variables(Task 6)を Task 7〜14 が消費 / superLogin ヘルパ(Task 7)を 8〜11・17 が消費 / HealthReport(Task 9)を Task 14 の UI が消費 / DLQ の queue 名規約(Task 10 修正済み)と Task 15 の env 命名が整合(`…-preview-dlq` は endsWith("-dlq") と slice が両立)。
- **見送り(申し送りへ転記する事項)**: 墓標周期 GC / 投影 QPS 監視 / getPublishedPage バイト予算 / 公開 read レート制限 / passkey 格上げ / テナント slug 変更 / E2E がローカル .wrangler を消す件の persistState 分離 / QR コード表示(otpauth URI は手入力)/ dead_letters の保持期限(現状無期限)。

## 完了後(コントローラの後続作業 — 実装タスク外)

1. 最終ブランチレビュー(最上位モデル)→ 指摘対応。
2. main チェックアウト側の git status 確認(未コミット下書きの ff 阻害対策)→ ローカル ff マージ → ワークツリー削除(`git rev-parse main <branch>` の SHA 一致確認後に discard)。
3. ロードマップ §3 の Phase 10 行を「完了」へ更新 + §16 申し送り(上記「見送り」+ 実装中の発見)を追記してコミット。
4. 手動確認バックログの棚卸し: E2E 3 本が吸収した項目(2 タブ同期・公開 API 到達・特権フロー)に印を付け、残り(IME・実 Turnstile・アップロード実機等)を §16 に集約。




