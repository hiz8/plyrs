# Phase 3: コントロールプレーン + 認証 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 中央 D1 のコントロールプレーン（tenants / users / memberships / sessions）、PBKDF2 パスワード認証、セッション + 短命 JWT（G5 リフレッシュ）、KV ブロックリスト、Worker 入口の第1段ゲート、DO 内 RPC 入口の第2段認可（型×操作、デフォルトロール）を実装し、HTTP 経由のエンドツーエンド認証済み書き込みを成立させる。

**Architecture:** 認証プリミティブ（password / session / jwt / blocklist / permissions）は `apps/api/src/auth/` の小さな純関数群。HTTP 層は Hono（`/auth/*` = セッション確立、`/v1/t/:tenantId/*` = tenantGate ミドルウェアで JWT 検証後 DO へルーティング）。第2段認可は Phase 2 申し送りどおり **DO の RPC 入口（no-op 判定・検証より前）** で `requireOperation` により判定し、DO の mutation RPC は `auth: AuthContext` を受け取る破壊的変更を行う。コントロールプレーン スキーマは `packages/db` に同居（DO 用と同じ Drizzle 語彙、別マイグレーションセット）。

**Tech Stack:** Hono 4.12 / jose 6.2 / @hono/zod-validator 0.8 / WebCrypto PBKDF2 / drizzle-orm(d1) / D1 + KV（vitest-pool-workers 0.18 でローカル検証）

## Global Constraints

- 新規依存は catalog 経由: `hono ^4.12.29` / `jose ^6.2.3` / `"@hono/zod-validator" ^0.8.0`（zod v4 対応は peerDeps で確認済み）
- **vitest-pool-workers の D1 パターン（0.18 現行）**: `readD1Migrations` は **`"@cloudflare/vitest-pool-workers"` 直下**から import（`/config` サブパスは廃止）。`applyD1Migrations` は `"cloudflare:test"`、`env` は `"cloudflare:workers"`。適用は setup ファイル（`test/apply-migrations.ts`）で行い、migrations は vitest.config の `miniflare.bindings.TEST_MIGRATIONS` で渡す
- wrangler.jsonc のローカル用 ID はプレースホルダ: D1 `database_id: "00000000-0000-0000-0000-000000000000"` / KV `id: "00000000000000000000000000000000"`（Cloudflare 公式 fixture と同じ流儀）
- **PBKDF2 は 100,000 iterations 固定**（workerd 本番の反復回数上限 = workerd#1346、2026-06 時点で未解除）。OWASP 2025 推奨 600k に**プラットフォーム制約で届かない**ことをコードコメントに明記する。比較は `crypto.subtle.timingSafeEqual`（workerd 拡張）
- JWT: HS256、**15分**、クレームは `sub`（userId）/ `tid`（tenantId）/ `role` のみ（design-spec §11.4「粗い身分証」）。秘密鍵は `env.JWT_SECRET`（テストは wrangler.jsonc の `vars`、本番は `wrangler secret`）
- セッション: 不透明トークン（32byte ランダム、base64url）を **SHA-256 ハッシュで D1 保存**、30日有効、失効列 `revoked_at`。cookie 名 `plyrs_session`、`httpOnly + Secure + SameSite=Strict + Path=/`
- **第1段（Worker）**: JWT 署名検証 + `:tenantId` 照合 + KV ブロックリスト照会**のみ**（D1 を引かない — design-spec §11.5）。**第2段（DO）**: RPC 入口・no-op 判定より前で型×操作判定（Phase 2 申し送りの「内容確認オラクル」対策）
- **DO RPC の破壊的変更**: mutation 系（registerContentType / writeRecord / deleteRecord）は `auth: AuthContext`（`{ userId, role }`）を末尾引数に取り、actor は `auth.userId` 由来。`WriteRecordInput = Omit<WriteRecordParams, "actor">` を RPC 契約とする。既存テストは掃引更新
- **読み取り（getRecord / getContentType）は Phase 3 では DO 内非ガード**: 全デフォルトロールが `record:read` を持つため判定が空虚。膜は Worker ゲート（メンバーのみ到達）。モジュール権限で read 制限が入る Phase 9 で再訪 — この決定を authorize.ts のコメントに明記
- デフォルトロール権限（design-spec §11.3・§11.5、コードに焼く）: owner = type:manage + record:write/delete/read、editor = record:write/delete/read、viewer = record:read
- `HookRejection.code` は `Extract<WriteErrorCode, "unique_violation">` に変更（Phase 2 申し送りの手動同期解消）
- Zod v4 記法: `z.email()` / `z.uuid()`（`z.string().email()` は使わない）
- D1/KV のストレージ分離は**テストファイル単位**。同一ファイル内のテストは email / slug / tenantId をテストごとにユニーク化する
- Hono のテストは `app.request(path, init, env)`（`SELF.fetch` は廃止済み）
- `@ts-expect-error` 禁止。RPC 型崩壊（`Record<string, unknown>` × `Rpc.Serializable`）への対処は rpc-unwrap パターンのみ（Task 8 で `src/rpc-unwrap.ts` へ移設し、ルートとテストで共用）
- 各タスクのコミット前に **`pnpm format` と ルート `pnpm lint`（警告ゼロ）** を必ず実行（Phase 2 の教訓: パッケージ内テストだけ回して lint 債務を溜めない）。コミット後ツリーで `pnpm format:check` exit 0
- TDD 必須（RED を確認してから GREEN）。実装者の typecheck / lint 主張はコントローラが抜き打ち検証する

**既知の注意（実装者向け）:**

1. `crypto.subtle.timingSafeEqual` が tsc で未解決の場合のみ、`(crypto.subtle as SubtleCrypto & { timingSafeEqual(a: ArrayBuffer, b: ArrayBuffer): boolean }).timingSafeEqual(...)` 形のローカル型補強を password.ts 内に置いてよい（報告に明記）
2. `D1Migration` 型は `cloudflare:test` の型空間にある。`env.d.ts` では `TEST_MIGRATIONS: import("cloudflare:test").D1Migration[]` で参照し、テスト専用バインディングである旨コメントする
3. PBKDF2 テストは1件あたり数十ms（100k iterations）。テスト数は最小限に保つ

## ファイル構成（このフェーズで確定する形）

```
packages/db/
  drizzle-d1.config.ts        # D1 用 drizzle-kit 設定（out ./drizzle-d1、generate 専用）
  drizzle-d1/                 # 生成 SQL（コミット。テストの applyD1Migrations が読む）
  src/control-plane.ts        # tenants / users / memberships / sessions
  src/control-plane.test.ts
apps/api/
  wrangler.jsonc              # DB(D1) / BLOCKLIST(KV) / vars.JWT_SECRET を追記
  vitest.config.ts            # readD1Migrations + TEST_MIGRATIONS + setupFiles
  env.d.ts                    # Env 拡張
  test/apply-migrations.ts    # setup: applyD1Migrations
  src/auth/password.ts        # PBKDF2 hash/verify
  src/auth/session.ts         # createSession / lookupSession / revokeSession
  src/auth/jwt.ts             # signTenantToken / verifyTenantToken
  src/auth/blocklist.ts       # isBlocked / blockUser / unblockUser
  src/auth/permissions.ts     # Role / Operation / can / isRole
  src/do/authorize.ts         # AuthContext / requireOperation（第2段）
  src/rpc-unwrap.ts           # (Task 8) RPC 型アンラップ — ルート/テスト共用
  src/middleware/tenant-gate.ts # 第1段ゲート
  src/routes/auth.ts          # /auth/signup|login|logout|token
  src/routes/tenants.ts       # POST /v1/tenants（テナント作成 + owner membership）
  src/routes/tenant.ts        # /v1/t/:tenantId/*（ゲート済み DO プロキシ）
  src/index.ts                # Hono app 組み立て（501 fetch を置換）
  test/password.test.ts / session.test.ts / jwt-blocklist.test.ts
  test/authz.test.ts          # DO 第2段の権限テスト
  src/do/hooks.test.ts        # 短絡ユニットテスト
  test/auth-routes.test.ts / gate.test.ts
```

---

### Task 1: コントロールプレーン D1 スキーマ（packages/db）

**Files:**
- Create: `packages/db/src/control-plane.ts`
- Create: `packages/db/drizzle-d1.config.ts`
- Modify: `packages/db/package.json`（exports / script 追記）
- Test: `packages/db/src/control-plane.test.ts`

**Interfaces:**
- Consumes: 既存の drizzle-orm catalog 依存
- Produces: `@plyrs/db/control-plane` から `tenants` / `users` / `memberships` / `sessions`（sqliteTable）。`packages/db/drizzle-d1/*.sql`（apps/api のテストが `readD1Migrations` で読む）。列は snake_case、TS プロパティは camelCase（既存 schema.ts と同じ流儀）

- [ ] **Step 1: 失敗するテストを書く**

`packages/db/src/control-plane.test.ts`:

```ts
import { getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { memberships, sessions, tenants, users } from "./control-plane";

describe("@plyrs/db control plane schema", () => {
  it("defines the four control-plane tables (design-spec §2)", () => {
    expect(getTableName(tenants)).toBe("tenants");
    expect(getTableName(users)).toBe("users");
    expect(getTableName(memberships)).toBe("memberships");
    expect(getTableName(sessions)).toBe("sessions");
  });

  it("gives sessions the revocation and expiry columns (design-spec §11.2)", () => {
    expect(sessions.tokenHash).toBeDefined();
    expect(sessions.expiresAt).toBeDefined();
    expect(sessions.revokedAt).toBeDefined();
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm --filter @plyrs/db test`
Expected: FAIL — `Cannot find module './control-plane'`

- [ ] **Step 3: スキーマと設定を書く**

`packages/db/src/control-plane.ts`:

```ts
import { index, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

// design-spec §2: コントロールプレーン（ID・認可）。テナントデータ本体（DO）の外側の中央 D1。
// 「テナントのデータを開いてよいか」を、そのデータを開かずに判定するための真実源。

export const tenants = sqliteTable(
  "tenants",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [uniqueIndex("idx_tenants_slug").on(table.slug)],
);

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [uniqueIndex("idx_users_email").on(table.email)],
);

// design-spec §2: 二層化により (user_id, tenant_id, role) の素直な形
export const memberships = sqliteTable(
  "memberships",
  {
    userId: text("user_id").notNull(),
    tenantId: text("tenant_id").notNull(),
    role: text("role").notNull(), // 'owner' | 'editor' | 'viewer'（apps/api 側 permissions.ts が真実源）
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.tenantId] }),
    index("idx_memberships_tenant").on(table.tenantId),
  ],
);

// design-spec §11.2: セッションの真実源は中央 D1。トークンは平文を保存せずハッシュのみ。
export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    tokenHash: text("token_hash").notNull(),
    userId: text("user_id").notNull(),
    expiresAt: text("expires_at").notNull(),
    createdAt: text("created_at").notNull(),
    revokedAt: text("revoked_at"),
  },
  (table) => [
    uniqueIndex("idx_sessions_token_hash").on(table.tokenHash),
    index("idx_sessions_user").on(table.userId),
  ],
);
```

`packages/db/drizzle-d1.config.ts`:

```ts
import { defineConfig } from "drizzle-kit";

// D1（コントロールプレーン）用。generate 専用 — 適用はテストの applyD1Migrations /
// 本番の `wrangler d1 migrations apply`。接続を要する push/migrate は使わないため
// driver / dbCredentials は不要。
export default defineConfig({
  out: "./drizzle-d1",
  schema: "./src/control-plane.ts",
  dialect: "sqlite",
});
```

`packages/db/package.json` — `exports` と `scripts` に追記（既存キーは維持）:

```json
  "exports": {
    ".": "./src/index.ts",
    "./control-plane": "./src/control-plane.ts",
    "./migrations": "./drizzle/migrations.js"
  },
```

```json
    "generate:d1": "drizzle-kit generate --config drizzle-d1.config.ts",
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm --filter @plyrs/db test` → PASS（4件）
Run: `pnpm --filter @plyrs/db typecheck` → エラーなし

- [ ] **Step 5: D1 マイグレーションを生成**

Run: `pnpm --filter @plyrs/db generate:d1`
Expected: `packages/db/drizzle-d1/` に `0000_*.sql` と `meta/` が生成される（`ls packages/db/drizzle-d1` で確認）。SQL に4テーブルの CREATE TABLE と索引が含まれることを目視確認

- [ ] **Step 6: フォーマット・lint・コミット**

```bash
pnpm format && pnpm lint
git add packages/db
git commit -m "feat: add control-plane D1 schema with dedicated migration set"
```

---

### Task 2: apps/api の D1 / KV / JWT_SECRET 配線とスモーク

**Files:**
- Modify: `pnpm-workspace.yaml`（catalog 追記）
- Modify: `apps/api/package.json`（hono / jose / @hono/zod-validator 依存追加）
- Modify: `apps/api/wrangler.jsonc`（d1_databases / kv_namespaces / vars）
- Modify: `apps/api/vitest.config.ts`（readD1Migrations + setupFiles）
- Modify: `apps/api/env.d.ts`（Env 拡張）
- Create: `apps/api/test/apply-migrations.ts`
- Test: `apps/api/test/control-plane-smoke.test.ts`

**Interfaces:**
- Consumes: `packages/db/drizzle-d1/*.sql`（Task 1）
- Produces: テストから使える `env.DB`（マイグレーション適用済み D1）/ `env.BLOCKLIST`（KV）/ `env.JWT_SECRET`。以降の全タスクがこの基盤に乗る

- [ ] **Step 1: catalog と依存を追記**

`pnpm-workspace.yaml` の `catalog:` に追記:

```yaml
  hono: "^4.12.29"
  jose: "^6.2.3"
  "@hono/zod-validator": "^0.8.0"
```

`apps/api/package.json` の `dependencies` に追記:

```json
    "@hono/zod-validator": "catalog:",
    "hono": "catalog:",
    "jose": "catalog:",
```

- [ ] **Step 2: wrangler.jsonc にバインディングを追記**

`apps/api/wrangler.jsonc` — 既存キーを維持し、以下を追加（ID はローカル用プレースホルダ）:

```jsonc
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "plyrs-control-plane",
      "database_id": "00000000-0000-0000-0000-000000000000",
    },
  ],
  "kv_namespaces": [{ "binding": "BLOCKLIST", "id": "00000000000000000000000000000000" }],
  "vars": { "JWT_SECRET": "test-secret-do-not-use-in-prod" },
```

（本番の `JWT_SECRET` は `wrangler secret put JWT_SECRET` で上書きする — デプロイ整備は Phase 10）

- [ ] **Step 3: vitest.config と setup ファイルを書く**

`apps/api/vitest.config.ts` を全置換:

```ts
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(async () => {
  const migrations = await readD1Migrations(path.join(here, "../../packages/db/drizzle-d1"));
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: { bindings: { TEST_MIGRATIONS: migrations } },
      }),
    ],
    test: {
      include: ["test/**/*.test.ts", "src/**/*.test.ts"],
      setupFiles: ["./test/apply-migrations.ts"],
    },
  };
});
```

`apps/api/test/apply-migrations.ts`:

```ts
import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";

// setup はテストファイルごとのストレージ分離の外で複数回走りうるが、
// applyD1Migrations は未適用分だけを適用するため冪等で安全。
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
```

`apps/api/env.d.ts` — `Env` を拡張（既存の TENANT_DO 行と ProvidedEnv 節は維持）:

```ts
interface Env {
  TENANT_DO: DurableObjectNamespace<import("./src/tenant-do").TenantDO>;
  DB: D1Database;
  BLOCKLIST: KVNamespace;
  JWT_SECRET: string;
  // テスト専用: vitest.config の miniflare.bindings が注入する（本番には存在しない）
  TEST_MIGRATIONS: import("cloudflare:test").D1Migration[];
}
```

- [ ] **Step 4: 失敗するスモークテストを書く**

`apps/api/test/control-plane-smoke.test.ts`:

```ts
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

describe("control plane bindings smoke", () => {
  it("has the four migrated control-plane tables in D1", async () => {
    const { results } = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE '\\_%' ESCAPE '\\' AND name NOT LIKE 'd1_%' ORDER BY name",
    ).all<{ name: string }>();
    const names = results.map((row) => row.name);
    expect(names).toEqual(expect.arrayContaining(["memberships", "sessions", "tenants", "users"]));
  });

  it("reads and writes the blocklist KV namespace", async () => {
    await env.BLOCKLIST.put("smoke", "1");
    expect(await env.BLOCKLIST.get("smoke")).toBe("1");
  });

  it("exposes the test JWT secret", () => {
    expect(env.JWT_SECRET.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 5: RED → install → GREEN**

Run: `pnpm --filter @plyrs/api test`（install 前）
Expected: FAIL（設定変更前なら D1 バインディング不在 / TEST_MIGRATIONS 不在系のエラー）

Run: `pnpm install && pnpm --filter @plyrs/api test`
Expected: 全 PASS（既存 43 + 新規 3 = 46件）
Run: `pnpm --filter @plyrs/api typecheck` → エラーなし

- [ ] **Step 6: フォーマット・lint・コミット**

```bash
pnpm format && pnpm lint
git add pnpm-workspace.yaml pnpm-lock.yaml apps/api/package.json apps/api/wrangler.jsonc apps/api/vitest.config.ts apps/api/env.d.ts apps/api/test/apply-migrations.ts apps/api/test/control-plane-smoke.test.ts
git commit -m "feat: wire D1 control plane, blocklist KV and JWT secret into apps/api"
```

---

### Task 3: パスワードハッシュ（WebCrypto PBKDF2）

**Files:**
- Create: `apps/api/src/auth/password.ts`
- Test: `apps/api/test/password.test.ts`

**Interfaces:**
- Consumes: workerd の WebCrypto（`crypto.subtle.importKey` / `deriveBits` / `timingSafeEqual`）
- Produces: `hashPassword(password: string): Promise<string>`（格納形式 `pbkdf2-sha256$<iterations>$<saltB64>$<hashB64>`）、`verifyPassword(password: string, stored: string): Promise<boolean>`

- [ ] **Step 1: 失敗するテストを書く**

`apps/api/test/password.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../src/auth/password";

describe("password hashing (PBKDF2)", () => {
  it("verifies a correct password and rejects a wrong one", async () => {
    const stored = await hashPassword("correct horse battery staple");
    expect(stored.startsWith("pbkdf2-sha256$100000$")).toBe(true);
    expect(await verifyPassword("correct horse battery staple", stored)).toBe(true);
    expect(await verifyPassword("Tr0ub4dor&3", stored)).toBe(false);
  });

  it("salts every hash (same password, different digests)", async () => {
    const a = await hashPassword("same-password");
    const b = await hashPassword("same-password");
    expect(a).not.toBe(b);
  });

  it("rejects malformed or tampered stored values without throwing", async () => {
    expect(await verifyPassword("x", "not-a-hash")).toBe(false);
    expect(await verifyPassword("x", "pbkdf2-sha256$999999999$AAAA$BBBB")).toBe(false);
    const stored = await hashPassword("x");
    const tampered = `${stored.slice(0, -4)}AAAA`;
    expect(await verifyPassword("x", tampered)).toBe(false);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm --filter @plyrs/api test`
Expected: FAIL — `../src/auth/password` の解決エラー

- [ ] **Step 3: 実装を書く**

`apps/api/src/auth/password.ts`:

```ts
// workerd は PBKDF2 の反復回数を本番で 100,000 に上限している（workerd#1346、2026-06 時点で未解除）。
// OWASP 2025 推奨（PBKDF2-SHA256 600k）にはプラットフォーム制約で届かない。
// この差分は passkey への第一認証格上げ（tech-selection 2.9）で解消する方針。
const ITERATIONS = 100_000;
const SALT_BYTES = 16;
const KEY_BITS = 256;
const PREFIX = "pbkdf2-sha256";

function toBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function fromBase64(value: string): Uint8Array | null {
  try {
    return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt as BufferSource, iterations, hash: "SHA-256" },
    keyMaterial,
    KEY_BITS,
  );
  return new Uint8Array(bits);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await derive(password, salt, ITERATIONS);
  return `${PREFIX}$${ITERATIONS}$${toBase64(salt)}$${toBase64(hash)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== PREFIX) {
    return false;
  }
  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > ITERATIONS) {
    return false;
  }
  const salt = fromBase64(parts[2] ?? "");
  const expected = fromBase64(parts[3] ?? "");
  if (salt === null || expected === null || salt.length !== SALT_BYTES) {
    return false;
  }
  const actual = await derive(password, salt, iterations);
  if (expected.byteLength !== actual.byteLength) {
    return false;
  }
  // timingSafeEqual は workerd/Node の非標準拡張（ブラウザ非互換）— design 上 Workers 専用コード
  return crypto.subtle.timingSafeEqual(
    actual.buffer as ArrayBuffer,
    expected.buffer as ArrayBuffer,
  );
}
```

（`timingSafeEqual` が tsc で未解決の場合のみ、Global Constraints の既知の注意1のローカル型補強を使い、報告に明記）

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm --filter @plyrs/api test` → 全 PASS（49件）
Run: `pnpm --filter @plyrs/api typecheck` → エラーなし

- [ ] **Step 5: フォーマット・lint・コミット**

```bash
pnpm format && pnpm lint
git add apps/api/src/auth/password.ts apps/api/test/password.test.ts
git commit -m "feat: add PBKDF2 password hashing at the workerd iteration ceiling"
```

---

### Task 4: セッション（D1 真実源・ハッシュ保存）

**Files:**
- Create: `apps/api/src/auth/session.ts`
- Test: `apps/api/test/session.test.ts`

**Interfaces:**
- Consumes: `@plyrs/db/control-plane` の `sessions`、drizzle-orm/d1、`uuid` の `v7`
- Produces: `SESSION_COOKIE = "plyrs_session"`、`createSession(d1: D1Database, userId: string, now: Date): Promise<{ token: string; expiresAt: string }>`、`lookupSession(d1: D1Database, token: string, now: Date): Promise<{ userId: string } | null>`、`revokeSession(d1: D1Database, token: string, now: Date): Promise<void>`

- [ ] **Step 1: 失敗するテストを書く**

`apps/api/test/session.test.ts`:

```ts
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { createSession, lookupSession, revokeSession } from "../src/auth/session";

const NOW = new Date("2026-07-13T00:00:00Z");
const DAY = 86_400_000;

describe("sessions (D1-backed)", () => {
  it("creates a session and looks it up by opaque token", async () => {
    const { token, expiresAt } = await createSession(env.DB, "user-1", NOW);
    expect(token.length).toBeGreaterThanOrEqual(43); // 32byte base64url
    expect(expiresAt).toBe(new Date(NOW.getTime() + 30 * DAY).toISOString());
    expect(await lookupSession(env.DB, token, NOW)).toEqual({ userId: "user-1" });
  });

  it("stores only a hash of the token (raw token absent from D1)", async () => {
    const { token } = await createSession(env.DB, "user-2", NOW);
    const { results } = await env.DB.prepare("SELECT token_hash FROM sessions").all<{
      token_hash: string;
    }>();
    expect(results.some((row) => row.token_hash === token)).toBe(false);
    expect(results.every((row) => /^[0-9a-f]{64}$/.test(row.token_hash))).toBe(true);
  });

  it("returns null for unknown, expired, and revoked tokens", async () => {
    expect(await lookupSession(env.DB, "no-such-token", NOW)).toBeNull();

    const { token: expired } = await createSession(env.DB, "user-3", NOW);
    expect(await lookupSession(env.DB, expired, new Date(NOW.getTime() + 31 * DAY))).toBeNull();

    const { token: revoked } = await createSession(env.DB, "user-4", NOW);
    await revokeSession(env.DB, revoked, NOW);
    expect(await lookupSession(env.DB, revoked, NOW)).toBeNull();
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm --filter @plyrs/api test`
Expected: FAIL — `../src/auth/session` の解決エラー

- [ ] **Step 3: 実装を書く**

`apps/api/src/auth/session.ts`:

```ts
import { and, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { sessions } from "@plyrs/db/control-plane";
import { v7 as uuidv7 } from "uuid";

// design-spec §11.2: セッションの真実源は中央 D1。トークンは 32byte 不透明値を
// base64url で配り、D1 には SHA-256 ハッシュのみ保存（D1 流出時もセッション奪取不能）。
const SESSION_TTL_DAYS = 30;

export const SESSION_COOKIE = "plyrs_session";

function toBase64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function createSession(
  d1: D1Database,
  userId: string,
  now: Date,
): Promise<{ token: string; expiresAt: string }> {
  const raw = crypto.getRandomValues(new Uint8Array(32));
  const token = toBase64Url(raw);
  const expiresAt = new Date(now.getTime() + SESSION_TTL_DAYS * 86_400_000).toISOString();
  await drizzle(d1).insert(sessions).values({
    id: uuidv7(),
    tokenHash: await sha256Hex(token),
    userId,
    expiresAt,
    createdAt: now.toISOString(),
  });
  return { token, expiresAt };
}

export async function lookupSession(
  d1: D1Database,
  token: string,
  now: Date,
): Promise<{ userId: string } | null> {
  const rows = await drizzle(d1)
    .select({ userId: sessions.userId, expiresAt: sessions.expiresAt })
    .from(sessions)
    .where(and(eq(sessions.tokenHash, await sha256Hex(token)), isNull(sessions.revokedAt)))
    .limit(1);
  const row = rows[0];
  if (row === undefined || row.expiresAt <= now.toISOString()) {
    return null;
  }
  return { userId: row.userId };
}

export async function revokeSession(d1: D1Database, token: string, now: Date): Promise<void> {
  await drizzle(d1)
    .update(sessions)
    .set({ revokedAt: now.toISOString() })
    .where(eq(sessions.tokenHash, await sha256Hex(token)));
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm --filter @plyrs/api test` → 全 PASS（52件）

- [ ] **Step 5: フォーマット・lint・コミット**

```bash
pnpm format && pnpm lint
git add apps/api/src/auth/session.ts apps/api/test/session.test.ts
git commit -m "feat: add hashed opaque sessions backed by the control-plane D1"
```

---

### Task 5: permissions / JWT / ブロックリスト

**Files:**
- Create: `apps/api/src/auth/permissions.ts`
- Create: `apps/api/src/auth/jwt.ts`
- Create: `apps/api/src/auth/blocklist.ts`
- Test: `apps/api/test/jwt-blocklist.test.ts`
- Test: `apps/api/src/auth/permissions.test.ts`

**Interfaces:**
- Consumes: `jose`（SignJWT / jwtVerify）、`env.JWT_SECRET`、`env.BLOCKLIST`
- Produces:
  - `ROLES` / `type Role = "owner" | "editor" | "viewer"` / `type Operation = "type:manage" | "record:write" | "record:delete" | "record:read"` / `can(role, operation): boolean` / `isRole(value): value is Role`
  - `interface TenantClaims { userId: string; tenantId: string; role: Role }`、`signTenantToken(secret: string, claims: TenantClaims): Promise<string>`、`verifyTenantToken(secret: string, token: string): Promise<TenantClaims | null>`、`TOKEN_TTL`（秒 = 900）
  - `isBlocked(kv: KVNamespace, userId: string): Promise<boolean>` / `blockUser` / `unblockUser`

- [ ] **Step 1: 失敗するテストを書く**

`apps/api/src/auth/permissions.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { can, isRole } from "./permissions";

describe("default role permissions (design-spec §11.3/§11.5)", () => {
  it("bakes the owner/editor/viewer matrix", () => {
    expect(can("owner", "type:manage")).toBe(true);
    expect(can("owner", "record:delete")).toBe(true);
    expect(can("editor", "record:write")).toBe(true);
    expect(can("editor", "record:delete")).toBe(true);
    expect(can("editor", "type:manage")).toBe(false);
    expect(can("viewer", "record:read")).toBe(true);
    expect(can("viewer", "record:write")).toBe(false);
    expect(can("viewer", "record:delete")).toBe(false);
    expect(can("viewer", "type:manage")).toBe(false);
  });

  it("guards role strings from untrusted sources", () => {
    expect(isRole("owner")).toBe(true);
    expect(isRole("admin")).toBe(false);
    expect(isRole(42)).toBe(false);
  });
});
```

`apps/api/test/jwt-blocklist.test.ts`:

```ts
import { env } from "cloudflare:workers";
import { SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import { blockUser, isBlocked, unblockUser } from "../src/auth/blocklist";
import { signTenantToken, TOKEN_TTL, verifyTenantToken } from "../src/auth/jwt";

const CLAIMS = {
  userId: "018f2b6a-7a0a-7000-8000-000000000001",
  tenantId: "018f2b6a-7a0a-7000-8000-000000000002",
  role: "editor",
} as const;

describe("tenant JWT (HS256, 15min)", () => {
  it("round-trips claims", async () => {
    const token = await signTenantToken(env.JWT_SECRET, CLAIMS);
    expect(TOKEN_TTL).toBe(900);
    expect(await verifyTenantToken(env.JWT_SECRET, token)).toEqual(CLAIMS);
  });

  it("rejects a wrong secret and a tampered token", async () => {
    const token = await signTenantToken(env.JWT_SECRET, CLAIMS);
    expect(await verifyTenantToken("other-secret", token)).toBeNull();
    expect(await verifyTenantToken(env.JWT_SECRET, `${token}x`)).toBeNull();
  });

  it("rejects an expired token", async () => {
    const expired = await new SignJWT({ tid: CLAIMS.tenantId, role: CLAIMS.role })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(CLAIMS.userId)
      .setIssuedAt(Math.floor(Date.now() / 1000) - 7200)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 3600)
      .sign(new TextEncoder().encode(env.JWT_SECRET));
    expect(await verifyTenantToken(env.JWT_SECRET, expired)).toBeNull();
  });

  it("rejects structurally valid JWTs with missing or bogus claims", async () => {
    const missingTid = await new SignJWT({ role: "editor" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(CLAIMS.userId)
      .setIssuedAt()
      .setExpirationTime("15m")
      .sign(new TextEncoder().encode(env.JWT_SECRET));
    expect(await verifyTenantToken(env.JWT_SECRET, missingTid)).toBeNull();

    const bogusRole = await new SignJWT({ tid: CLAIMS.tenantId, role: "superuser" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(CLAIMS.userId)
      .setIssuedAt()
      .setExpirationTime("15m")
      .sign(new TextEncoder().encode(env.JWT_SECRET));
    expect(await verifyTenantToken(env.JWT_SECRET, bogusRole)).toBeNull();
  });
});

describe("blocklist (KV)", () => {
  it("blocks and unblocks a user", async () => {
    expect(await isBlocked(env.BLOCKLIST, "user-b")).toBe(false);
    await blockUser(env.BLOCKLIST, "user-b");
    expect(await isBlocked(env.BLOCKLIST, "user-b")).toBe(true);
    await unblockUser(env.BLOCKLIST, "user-b");
    expect(await isBlocked(env.BLOCKLIST, "user-b")).toBe(false);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm --filter @plyrs/api test`
Expected: FAIL — 解決エラー（permissions / jwt / blocklist）

- [ ] **Step 3: 実装を書く**

`apps/api/src/auth/permissions.ts`:

```ts
export const ROLES = ["owner", "editor", "viewer"] as const;

export type Role = (typeof ROLES)[number];

export type Operation = "type:manage" | "record:write" | "record:delete" | "record:read";

// design-spec §11.5: デフォルトロールの権限展開表はコードに焼く（アプリと共にデプロイ）。
// モジュール宣言権限（Phase 9）は有効化時に DO の config へ書き込まれ、同じ判定面に加わる。
const ROLE_PERMISSIONS: Record<Role, readonly Operation[]> = {
  owner: ["type:manage", "record:write", "record:delete", "record:read"],
  editor: ["record:write", "record:delete", "record:read"],
  viewer: ["record:read"],
};

export function can(role: Role, operation: Operation): boolean {
  return ROLE_PERMISSIONS[role].includes(operation);
}

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}
```

`apps/api/src/auth/jwt.ts`:

```ts
import { SignJWT, jwtVerify } from "jose";
import { isRole, type Role } from "./permissions";

// design-spec §11.2/§11.4: 短命 JWT（15分）は「粗い身分証」。載せるのは
// sub（userId）/ tid（tenantId）/ role のみ。型×操作の展開はサーバー側（DO）で行う。
const TOKEN_TTL_SECONDS = 15 * 60;

export const TOKEN_TTL = TOKEN_TTL_SECONDS;

export interface TenantClaims {
  userId: string;
  tenantId: string;
  role: Role;
}

function secretKey(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

export async function signTenantToken(secret: string, claims: TenantClaims): Promise<string> {
  return new SignJWT({ tid: claims.tenantId, role: claims.role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.userId)
    .setIssuedAt()
    .setExpirationTime(`${TOKEN_TTL_SECONDS}s`)
    .sign(secretKey(secret));
}

export async function verifyTenantToken(
  secret: string,
  token: string,
): Promise<TenantClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey(secret), { clockTolerance: 5 });
    const sub = payload.sub;
    const tid = payload["tid"];
    const role = payload["role"];
    if (typeof sub !== "string" || typeof tid !== "string" || !isRole(role)) {
      return null;
    }
    return { userId: sub, tenantId: tid, role };
  } catch {
    return null;
  }
}
```

`apps/api/src/auth/blocklist.ts`:

```ts
// design-spec §11.2: 権限剥奪・BAN の即時失効はブロックリスト照会で効かせる。
// 更新は失効イベント時のみ（稀）、読みは毎リクエスト（KV はエッジで安価）。
function keyFor(userId: string): string {
  return `blocked:user:${userId}`;
}

export async function isBlocked(kv: KVNamespace, userId: string): Promise<boolean> {
  return (await kv.get(keyFor(userId))) !== null;
}

export async function blockUser(kv: KVNamespace, userId: string): Promise<void> {
  await kv.put(keyFor(userId), "1");
}

export async function unblockUser(kv: KVNamespace, userId: string): Promise<void> {
  await kv.delete(keyFor(userId));
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm --filter @plyrs/api test` → 全 PASS（59件）
Run: `pnpm --filter @plyrs/api typecheck` → エラーなし

- [ ] **Step 5: フォーマット・lint・コミット**

```bash
pnpm format && pnpm lint
git add apps/api/src/auth/permissions.ts apps/api/src/auth/jwt.ts apps/api/src/auth/blocklist.ts apps/api/test/jwt-blocklist.test.ts apps/api/src/auth/permissions.test.ts
git commit -m "feat: add role permissions, tenant JWTs and the KV blocklist"
```

---

### Task 6: DO 第2段認可（RPC 入口・破壊的変更）

**Files:**
- Create: `apps/api/src/do/authorize.ts`
- Modify: `apps/api/src/do/types.ts`（`forbidden` 追加 / `WriteRecordInput` 追加）
- Modify: `apps/api/src/do/hooks.ts`（`HookRejection.code` を Extract に）
- Modify: `apps/api/src/do/content-types.ts`（Result union に `forbidden`）
- Modify: `apps/api/src/do/delete-record.ts`（Result union に `forbidden`）
- Modify: `apps/api/src/tenant-do.ts`（mutation RPC に `auth` 引数）
- Modify: `apps/api/test/fixtures.ts`（auth ヘルパー）
- Modify: `apps/api/test/content-types.test.ts` / `test/index-ddl.test.ts` / `test/write-record.test.ts` / `test/unique.test.ts` / `test/delete.test.ts`（呼び出し掃引）
- Test: `apps/api/test/authz.test.ts`
- Test: `apps/api/src/do/hooks.test.ts`

**Interfaces:**
- Consumes: `can` / `Operation` / `Role`（Task 5）
- Produces:
  - `interface AuthContext { userId: string; role: Role }`、`requireOperation(auth: AuthContext, operation: Operation): { ok: false; code: "forbidden"; message: string } | null`
  - RPC 新契約: `registerContentType(input: unknown, auth: AuthContext)`、`writeRecord(typeKey: string, params: WriteRecordInput, auth: AuthContext)`（`WriteRecordInput = Omit<WriteRecordParams, "actor">`）、`deleteRecord(recordId: string, auth: AuthContext)`
  - fixtures: `auth(userId: string, role?: Role): AuthContext`（既定 "owner"）

- [ ] **Step 1: 失敗するテストを書く（新規2ファイル）**

`apps/api/src/do/hooks.test.ts`（Phase 2 申し送り: 短絡動作のユニットテスト）:

```ts
import { describe, expect, it } from "vitest";
import { runBeforeWriteHooks, type BeforeWriteContext, type BeforeWriteHook } from "./hooks";

const ctx = {} as BeforeWriteContext; // ダミーフックは ctx を参照しない

describe("runBeforeWriteHooks", () => {
  it("short-circuits on the first rejection (later hooks not invoked)", () => {
    let secondCalled = false;
    const first: BeforeWriteHook = () => ({ code: "unique_violation", message: "stop" });
    const second: BeforeWriteHook = () => {
      secondCalled = true;
      return null;
    };
    const rejection = runBeforeWriteHooks([first, second], ctx);
    expect(rejection).toEqual({ code: "unique_violation", message: "stop" });
    expect(secondCalled).toBe(false);
  });

  it("runs all hooks when none reject", () => {
    let calls = 0;
    const hook: BeforeWriteHook = () => {
      calls += 1;
      return null;
    };
    expect(runBeforeWriteHooks([hook, hook, hook], ctx)).toBeNull();
    expect(calls).toBe(3);
  });
});
```

`apps/api/test/authz.test.ts`:

```ts
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { articleType, auth, uuid, validArticleInput } from "./fixtures";
import { asRecordSnapshot, asWriteResult } from "./rpc-unwrap";

function freshStub() {
  return env.TENANT_DO.get(env.TENANT_DO.idFromName(crypto.randomUUID()));
}

describe("stage-2 authorization at the DO RPC entry", () => {
  let stub: ReturnType<typeof freshStub>;

  beforeEach(async () => {
    stub = freshStub();
    const registered = await stub.registerContentType(articleType(), auth("admin"));
    expect(registered.ok).toBe(true);
  });

  it("denies record writes to viewers and persists nothing", async () => {
    const result = asWriteResult(
      await stub.writeRecord(
        "article",
        { recordId: uuid(60), input: validArticleInput() },
        auth("mallory", "viewer"),
      ),
    );
    expect(result).toMatchObject({ ok: false, code: "forbidden" });
    expect(asRecordSnapshot(await stub.getRecord(uuid(60)))).toBeNull();
  });

  it("denies type management to editors but allows record writes", async () => {
    const denied = await stub.registerContentType(articleType(), auth("eve", "editor"));
    expect(denied).toMatchObject({ ok: false, code: "forbidden" });

    const written = asWriteResult(
      await stub.writeRecord(
        "article",
        { recordId: uuid(61), input: validArticleInput() },
        auth("eve", "editor"),
      ),
    );
    expect(written.ok).toBe(true);
    if (written.ok) {
      expect(written.record.createdBy).toBe("eve");
    }
  });

  it("denies deletion to viewers and allows it to editors", async () => {
    await stub.writeRecord(
      "article",
      { recordId: uuid(62), input: validArticleInput() },
      auth("eve", "editor"),
    );
    expect(await stub.deleteRecord(uuid(62), auth("mallory", "viewer"))).toMatchObject({
      ok: false,
      code: "forbidden",
    });
    const deleted = await stub.deleteRecord(uuid(62), auth("eve", "editor"));
    expect(deleted.ok).toBe(true);
  });

  it("lets owners do everything", async () => {
    const written = asWriteResult(
      await stub.writeRecord(
        "article",
        { recordId: uuid(63), input: validArticleInput() },
        auth("root", "owner"),
      ),
    );
    expect(written.ok).toBe(true);
    expect(await stub.deleteRecord(uuid(63), auth("root", "owner"))).toMatchObject({ ok: true });
  });
});
```

`apps/api/test/fixtures.ts` に追記:

```ts
import type { AuthContext } from "../src/do/authorize";
import type { Role } from "../src/auth/permissions";

export function auth(userId: string, role: Role = "owner"): AuthContext {
  return { userId, role };
}
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm --filter @plyrs/api test`
Expected: FAIL — `../src/do/authorize` 解決エラー / RPC 引数不一致

- [ ] **Step 3: authorize.ts と型変更を実装**

`apps/api/src/do/authorize.ts`:

```ts
import { can, type Operation, type Role } from "../auth/permissions";

export interface AuthContext {
  userId: string;
  role: Role;
}

// design-spec §11.5 第2段（型×操作）。Phase 2 申し送りにより beforeWrite パイプライン
// ではなく RPC 入口（no-op 判定・検証より前）で判定する — no-op 経路が
// 「現在値を正確に当てた書き込み」の内容確認オラクルになるのを防ぐ。
//
// 読み取り（getRecord / getContentType）は Phase 3 時点では非ガード:
// 全デフォルトロールが record:read を持ち判定が空虚なため。Worker ゲートが
// メンバーのみを到達させる。モジュール権限で read 制限が入る Phase 9 で再訪。
export function requireOperation(
  auth: AuthContext,
  operation: Operation,
): { ok: false; code: "forbidden"; message: string } | null {
  if (can(auth.role, operation)) {
    return null;
  }
  return {
    ok: false,
    code: "forbidden",
    message: `role '${auth.role}' cannot perform ${operation}`,
  };
}
```

`apps/api/src/do/types.ts` — `WriteErrorCode` に `"forbidden"` を追加し、RPC 入力型を追加:

```ts
export type WriteErrorCode =
  | "unknown_type"
  | "validation_failed"
  | "invalid_status"
  | "record_deleted"
  | "unique_violation"
  | "forbidden";

// RPC 契約: actor はクライアント申告ではなく auth.userId 由来（サーバー側で合成）
export type WriteRecordInput = Omit<WriteRecordParams, "actor">;
```

`apps/api/src/do/hooks.ts` — HookRejection を Extract 化（import 追加とともに）:

```ts
import type { RecordSnapshot, WriteErrorCode } from "./types";

export type HookRejection = {
  code: Extract<WriteErrorCode, "unique_violation">;
  message: string;
};
```

`apps/api/src/do/content-types.ts` — Result union に forbidden を追加:

```ts
export type RegisterContentTypeResult =
  | { ok: true; contentType: ContentTypeRow }
  | {
      ok: false;
      code: "validation_failed" | "id_mismatch" | "key_mismatch" | "forbidden";
      message: string;
    };
```

`apps/api/src/do/delete-record.ts` — 同様に:

```ts
export type DeleteRecordResult =
  | { ok: true; record: RecordSnapshot }
  | { ok: false; code: "not_found" | "already_deleted" | "forbidden"; message: string };
```

- [ ] **Step 4: TenantDO の mutation RPC を書き換える**

`apps/api/src/tenant-do.ts` — import 追記:

```ts
import { requireOperation, type AuthContext } from "./do/authorize";
import type { RecordSnapshot, WriteRecordInput, WriteRecordResult } from "./do/types";
```

3メソッドを次の形に置換（第2段判定は必ず**先頭**）:

```ts
  registerContentType(input: unknown, auth: AuthContext): RegisterContentTypeResult {
    const denial = requireOperation(auth, "type:manage");
    if (denial !== null) {
      return denial;
    }
    const now = new Date().toISOString();
    return this.ctx.storage.transactionSync(() =>
      registerContentTypeCore(this.ctx.storage.sql, input, now),
    );
  }

  writeRecord(typeKey: string, params: WriteRecordInput, auth: AuthContext): WriteRecordResult {
    const denial = requireOperation(auth, "record:write");
    if (denial !== null) {
      return denial;
    }
    const contentType = loadContentTypeByKey(this.ctx.storage.sql, typeKey);
    if (contentType === null) {
      return { ok: false, code: "unknown_type", message: `unknown content type: ${typeKey}` };
    }
    return this.ctx.storage.transactionSync(() =>
      writeRecordCore(
        {
          sql: this.ctx.storage.sql,
          nextSeq: () => ++this.seq,
          now: () => new Date().toISOString(),
          newRelationId: () => uuidv7(),
        },
        contentType,
        { ...params, actor: auth.userId },
      ),
    );
  }

  deleteRecord(recordId: string, auth: AuthContext): DeleteRecordResult {
    const denial = requireOperation(auth, "record:delete");
    if (denial !== null) {
      return denial;
    }
    return this.ctx.storage.transactionSync(() =>
      deleteRecordCore(
        {
          sql: this.ctx.storage.sql,
          nextSeq: () => ++this.seq,
          now: () => new Date().toISOString(),
        },
        recordId,
        auth.userId,
      ),
    );
  }
```

- [ ] **Step 5: 既存テストを新契約へ掃引**

機械的変換規則（5ファイル: content-types / index-ddl / write-record / unique / delete）:

- `stub.registerContentType(X)` → `stub.registerContentType(X, auth("admin"))`
- `stub.writeRecord(T, { recordId, input, actor: "N" })` → `stub.writeRecord(T, { recordId, input }, auth("N"))`（`status` があれば params に残す）
- `stub.deleteRecord(id, "N")` → `stub.deleteRecord(id, auth("N"))`
- 各ファイルの fixtures import に `auth` を追加

`createdBy` / `updatedBy` のアサーションは actor = auth.userId のため**そのまま成立**する。

- [ ] **Step 6: テストが通ることを確認**

Run: `pnpm --filter @plyrs/api test` → 全 PASS（新規 6 + 既存掃引後、65件目安）
Run: `pnpm --filter @plyrs/api typecheck` → エラーなし（actor を params に残した呼び出しは型エラーになるので掃引漏れが機械検出される）

- [ ] **Step 7: フォーマット・lint・コミット**

```bash
pnpm format && pnpm lint
git add apps/api/src/do apps/api/src/tenant-do.ts apps/api/test
git commit -m "feat: enforce stage-2 authorization at the TenantDO RPC entry"
```

---

### Task 7: 認証ルート（signup / login / logout / token）+ テナント作成

**Files:**
- Create: `apps/api/src/routes/auth.ts`
- Create: `apps/api/src/routes/tenants.ts`
- Modify: `apps/api/src/index.ts`（Hono app 化 — 501 fetch を置換）
- Test: `apps/api/test/auth-routes.test.ts`

**Interfaces:**
- Consumes: password / session / jwt / blocklist（Task 3-5）、`@plyrs/db/control-plane`
- Produces:
  - `POST /auth/signup {email,password}` → 201 `{userId}` + セッション cookie / 409 `{error:"email_taken"}`
  - `POST /auth/login` → 200 `{userId}` + cookie / 401 `{error:"invalid_credentials"}`
  - `POST /auth/logout` → 200、セッション失効 + cookie 削除
  - `POST /auth/token {tenantId}` → 200 `{token, expiresIn: 900}` / 401 `{error:"unauthenticated"}` / 403 `{error:"blocked"|"not_a_member"}`（G5: セッション cookie からの短命 JWT 再発行）
  - `POST /v1/tenants {name, slug}` → 201 `{tenantId}`（作成者が owner membership を得る）/ 409 `{error:"slug_taken"}`
  - `apps/api/src/index.ts` は Hono app を default export（`TenantDO` export は維持）

- [ ] **Step 1: 失敗するテストを書く**

`apps/api/test/auth-routes.test.ts`:

```ts
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import app from "../src/index";
import { blockUser } from "../src/auth/blocklist";
import { verifyTenantToken } from "../src/auth/jwt";

// D1/KV の分離はファイル単位のため、email / slug はテストごとにユニーク化する
let n = 0;
function unique(prefix: string): string {
  n += 1;
  return `${prefix}${n}`;
}

function json(body: unknown, cookie?: string): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  };
}

function cookieFrom(res: Response): string {
  return (res.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
}

async function signupAndLogin(): Promise<{ userId: string; cookie: string }> {
  const email = `${unique("user")}@example.com`;
  const res = await app.request("/auth/signup", json({ email, password: "hunter2hunter2" }), env);
  expect(res.status).toBe(201);
  const { userId } = (await res.json()) as { userId: string };
  return { userId, cookie: cookieFrom(res) };
}

describe("auth routes", () => {
  it("signs up, sets a session cookie, and rejects duplicate emails", async () => {
    const email = `${unique("dup")}@example.com`;
    const first = await app.request("/auth/signup", json({ email, password: "hunter2hunter2" }), env);
    expect(first.status).toBe(201);
    const setCookie = first.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("plyrs_session=");
    expect(setCookie).toContain("HttpOnly");
    const second = await app.request("/auth/signup", json({ email, password: "hunter2hunter2" }), env);
    expect(second.status).toBe(409);
  });

  it("logs in with correct credentials and rejects wrong ones", async () => {
    const email = `${unique("login")}@example.com`;
    await app.request("/auth/signup", json({ email, password: "hunter2hunter2" }), env);
    const ok = await app.request("/auth/login", json({ email, password: "hunter2hunter2" }), env);
    expect(ok.status).toBe(200);
    const bad = await app.request("/auth/login", json({ email, password: "wrong-password" }), env);
    expect(bad.status).toBe(401);
  });

  it("rejects malformed bodies via validation", async () => {
    const res = await app.request(
      "/auth/signup",
      json({ email: "not-an-email", password: "short" }),
      env,
    );
    expect(res.status).toBe(400);
  });

  it("revokes the session on logout", async () => {
    const { cookie } = await signupAndLogin();
    const out = await app.request("/auth/logout", json({}, cookie), env);
    expect(out.status).toBe(200);
    const denied = await app.request(
      "/auth/token",
      json({ tenantId: crypto.randomUUID() }, cookie),
      env,
    );
    expect(denied.status).toBe(401);
  });

  it("creates a tenant with an owner membership and unique slug", async () => {
    const { cookie } = await signupAndLogin();
    const slug = unique("blog-");
    const created = await app.request("/v1/tenants", json({ name: "Blog", slug }, cookie), env);
    expect(created.status).toBe(201);
    const dup = await app.request("/v1/tenants", json({ name: "Blog2", slug }, cookie), env);
    expect(dup.status).toBe(409);
    const anon = await app.request("/v1/tenants", json({ name: "X", slug: unique("s-") }), env);
    expect(anon.status).toBe(401);
  });

  it("issues a 15-minute tenant JWT to members only (G5)", async () => {
    const { userId, cookie } = await signupAndLogin();
    const created = await app.request(
      "/v1/tenants",
      json({ name: "T", slug: unique("t-") }, cookie),
      env,
    );
    const { tenantId } = (await created.json()) as { tenantId: string };

    const issued = await app.request("/auth/token", json({ tenantId }, cookie), env);
    expect(issued.status).toBe(200);
    const { token, expiresIn } = (await issued.json()) as { token: string; expiresIn: number };
    expect(expiresIn).toBe(900);
    expect(await verifyTenantToken(env.JWT_SECRET, token)).toEqual({
      userId,
      tenantId,
      role: "owner",
    });

    const outsider = await signupAndLogin();
    const denied = await app.request("/auth/token", json({ tenantId }, outsider.cookie), env);
    expect(denied.status).toBe(403);
  });

  it("refuses tokens to blocked users (design-spec §11.2)", async () => {
    const { userId, cookie } = await signupAndLogin();
    const created = await app.request(
      "/v1/tenants",
      json({ name: "B", slug: unique("b-") }, cookie),
      env,
    );
    const { tenantId } = (await created.json()) as { tenantId: string };
    await blockUser(env.BLOCKLIST, userId);
    const denied = await app.request("/auth/token", json({ tenantId }, cookie), env);
    expect(denied.status).toBe(403);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm --filter @plyrs/api test`
Expected: FAIL — `/auth/signup` が 501（旧 fetch）を返す

- [ ] **Step 3: ルートと index.ts を書く**

`apps/api/src/routes/auth.ts`:

```ts
import { zValidator } from "@hono/zod-validator";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { memberships, users } from "@plyrs/db/control-plane";
import { isBlocked } from "../auth/blocklist";
import { signTenantToken, TOKEN_TTL } from "../auth/jwt";
import { hashPassword, verifyPassword } from "../auth/password";
import { isRole } from "../auth/permissions";
import { createSession, lookupSession, revokeSession, SESSION_COOKIE } from "../auth/session";

const credentialsSchema = z.object({
  email: z.email().max(254),
  password: z.string().min(12).max(128),
});

const SESSION_COOKIE_OPTIONS = {
  path: "/",
  httpOnly: true,
  secure: true,
  sameSite: "Strict",
  maxAge: 30 * 86_400,
} as const;

export const authRoutes = new Hono<{ Bindings: Env }>()
  .post("/signup", zValidator("json", credentialsSchema), async (c) => {
    const { email, password } = c.req.valid("json");
    const db = drizzle(c.env.DB);
    const existing = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    if (existing.length > 0) {
      return c.json({ error: "email_taken" }, 409);
    }
    const now = new Date();
    const userId = uuidv7();
    await db.insert(users).values({
      id: userId,
      email,
      passwordHash: await hashPassword(password),
      createdAt: now.toISOString(),
    });
    const { token } = await createSession(c.env.DB, userId, now);
    setCookie(c, SESSION_COOKIE, token, SESSION_COOKIE_OPTIONS);
    return c.json({ userId }, 201);
  })
  .post("/login", zValidator("json", credentialsSchema), async (c) => {
    const { email, password } = c.req.valid("json");
    const row = (
      await drizzle(c.env.DB).select().from(users).where(eq(users.email, email)).limit(1)
    )[0];
    if (row === undefined || !(await verifyPassword(password, row.passwordHash))) {
      return c.json({ error: "invalid_credentials" }, 401);
    }
    const now = new Date();
    const { token } = await createSession(c.env.DB, row.id, now);
    setCookie(c, SESSION_COOKIE, token, SESSION_COOKIE_OPTIONS);
    return c.json({ userId: row.id });
  })
  .post("/logout", async (c) => {
    const token = getCookie(c, SESSION_COOKIE);
    if (token !== undefined) {
      await revokeSession(c.env.DB, token, new Date());
    }
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    return c.json({ ok: true });
  })
  // G5: セッション cookie（D1 真実源）を提示して短命 JWT を再発行する
  .post("/token", zValidator("json", z.object({ tenantId: z.uuid() })), async (c) => {
    const token = getCookie(c, SESSION_COOKIE);
    const session = token === undefined ? null : await lookupSession(c.env.DB, token, new Date());
    if (session === null) {
      return c.json({ error: "unauthenticated" }, 401);
    }
    if (await isBlocked(c.env.BLOCKLIST, session.userId)) {
      return c.json({ error: "blocked" }, 403);
    }
    const { tenantId } = c.req.valid("json");
    const membership = (
      await drizzle(c.env.DB)
        .select({ role: memberships.role })
        .from(memberships)
        .where(and(eq(memberships.userId, session.userId), eq(memberships.tenantId, tenantId)))
        .limit(1)
    )[0];
    if (membership === undefined || !isRole(membership.role)) {
      return c.json({ error: "not_a_member" }, 403);
    }
    const jwt = await signTenantToken(c.env.JWT_SECRET, {
      userId: session.userId,
      tenantId,
      role: membership.role,
    });
    return c.json({ token: jwt, expiresIn: TOKEN_TTL });
  });
```

`apps/api/src/routes/tenants.ts`:

```ts
import { zValidator } from "@hono/zod-validator";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { memberships, tenants } from "@plyrs/db/control-plane";
import { lookupSession, SESSION_COOKIE } from "../auth/session";

const createTenantSchema = z.object({
  name: z.string().min(1).max(100),
  slug: z
    .string()
    .regex(/^[a-z][a-z0-9-]*$/)
    .max(63),
});

// 注: テナント作成の特権ゲート（design-spec §11.6）は Phase 10 の管轄。
// 現段階ではログイン済みユーザーなら誰でも作成でき、作成者が owner になる。
export const tenantAdminRoutes = new Hono<{ Bindings: Env }>().post(
  "/",
  zValidator("json", createTenantSchema),
  async (c) => {
    const token = getCookie(c, SESSION_COOKIE);
    const session = token === undefined ? null : await lookupSession(c.env.DB, token, new Date());
    if (session === null) {
      return c.json({ error: "unauthenticated" }, 401);
    }
    const { name, slug } = c.req.valid("json");
    const db = drizzle(c.env.DB);
    const dup = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, slug)).limit(1);
    if (dup.length > 0) {
      return c.json({ error: "slug_taken" }, 409);
    }
    const now = new Date().toISOString();
    const tenantId = uuidv7();
    await db.insert(tenants).values({ id: tenantId, slug, name, createdAt: now });
    await db
      .insert(memberships)
      .values({ userId: session.userId, tenantId, role: "owner", createdAt: now });
    return c.json({ tenantId }, 201);
  },
);
```

`apps/api/src/index.ts` を全置換:

```ts
import { Hono } from "hono";
import { authRoutes } from "./routes/auth";
import { tenantAdminRoutes } from "./routes/tenants";

export { TenantDO } from "./tenant-do";

const app = new Hono<{ Bindings: Env }>();
app.route("/auth", authRoutes);
app.route("/v1/tenants", tenantAdminRoutes);
app.notFound((c) => c.json({ error: "not_found" }, 404));

export default app satisfies ExportedHandler<Env>;
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm --filter @plyrs/api test` → 全 PASS（72件目安）
Run: `pnpm --filter @plyrs/api typecheck` → エラーなし

- [ ] **Step 5: フォーマット・lint・コミット**

```bash
pnpm format && pnpm lint
git add apps/api/src/routes apps/api/src/index.ts apps/api/test/auth-routes.test.ts
git commit -m "feat: add session auth routes, tenant creation and G5 token refresh"
```

---

### Task 8: 第1段ゲートとテナント配下ルート（エンドツーエンド）

**Files:**
- Create: `apps/api/src/rpc-unwrap.ts`（test/rpc-unwrap.ts の中身を移設・拡張）
- Modify: `apps/api/test/rpc-unwrap.ts`（`export * from "../src/rpc-unwrap";` の1行に）
- Create: `apps/api/src/middleware/tenant-gate.ts`
- Create: `apps/api/src/routes/tenant.ts`
- Modify: `apps/api/src/index.ts`（`/v1/t` ルート追加）
- Test: `apps/api/test/gate.test.ts`

**Interfaces:**
- Consumes: `verifyTenantToken` / `isBlocked`（Task 5）、`AuthContext`（Task 6）、TenantDO の新 RPC 契約（Task 6）
- Produces:
  - `apps/api/src/rpc-unwrap.ts`: `asWriteResult` / `asRecordSnapshot` / `asDeleteResult` / `asRegisterResult(value): RegisterContentTypeResult` / `asContentTypeRow(value): ContentTypeRow | null`
  - `tenantGate`（Hono ミドルウェア）: `Authorization: Bearer` 検証 → `tid === :tenantId` 照合 → KV ブロックリスト → `c.set("auth", { userId, role, tenantId })`。`type GateVariables = { auth: AuthContext & { tenantId: string } }`
  - HTTP API: `PUT /v1/t/:tenantId/content-types`、`GET /v1/t/:tenantId/content-types/:key`、`PUT /v1/t/:tenantId/records/:typeKey/:recordId`、`GET /v1/t/:tenantId/records/:recordId`、`DELETE /v1/t/:tenantId/records/:recordId`
  - エラーコード → HTTP status: forbidden 403 / unknown_type・not_found 404 / unique_violation・id_mismatch・key_mismatch 409 / record_deleted・already_deleted 410 / それ以外の ok:false 400

- [ ] **Step 1: rpc-unwrap を src へ移設**

`apps/api/src/rpc-unwrap.ts`:

```ts
import type { ContentTypeRow, RegisterContentTypeResult } from "./do/content-types";
import type { DeleteRecordResult } from "./do/delete-record";
import type { RecordSnapshot, WriteRecordResult } from "./do/types";

// Cloudflare の Rpc.Result 型は Record<string, unknown>（RecordSnapshot.data）を
// Serializable と証明できず、ok:true 側の union 枝を never に潰す（実行時の直列化は正しい）。
// RPC 戻り値を実型へ戻す唯一の境界。@ts-expect-error での抑止は禁止。
export function asWriteResult(value: unknown): WriteRecordResult {
  return value as WriteRecordResult;
}

export function asRecordSnapshot(value: unknown): RecordSnapshot | null {
  return value as RecordSnapshot | null;
}

export function asDeleteResult(value: unknown): DeleteRecordResult {
  return value as DeleteRecordResult;
}

export function asRegisterResult(value: unknown): RegisterContentTypeResult {
  return value as RegisterContentTypeResult;
}

export function asContentTypeRow(value: unknown): ContentTypeRow | null {
  return value as ContentTypeRow | null;
}
```

`apps/api/test/rpc-unwrap.ts` を全置換:

```ts
export * from "../src/rpc-unwrap";
```

- [ ] **Step 2: 失敗するテストを書く**

`apps/api/test/gate.test.ts`:

```ts
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/d1";
import { memberships } from "@plyrs/db/control-plane";
import app from "../src/index";
import { blockUser } from "../src/auth/blocklist";
import { articleType, uuid, validArticleInput } from "./fixtures";

let n = 0;
function unique(prefix: string): string {
  n += 1;
  return `${prefix}${n}`;
}

function json(body: unknown, headers: Record<string, string> = {}): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  };
}

async function bootstrapTenant(): Promise<{
  tenantId: string;
  userId: string;
  bearer: string;
  cookie: string;
}> {
  const email = `${unique("owner")}@example.com`;
  const signup = await app.request(
    "/auth/signup",
    json({ email, password: "hunter2hunter2" }),
    env,
  );
  const { userId } = (await signup.json()) as { userId: string };
  const cookie = (signup.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  const created = await app.request(
    "/v1/tenants",
    json({ name: "T", slug: unique("t-") }, { cookie }),
    env,
  );
  const { tenantId } = (await created.json()) as { tenantId: string };
  const issued = await app.request("/auth/token", json({ tenantId }, { cookie }), env);
  const { token } = (await issued.json()) as { token: string };
  return { tenantId, userId, bearer: `Bearer ${token}`, cookie };
}

async function grantMembership(userId: string, tenantId: string, role: string): Promise<void> {
  await drizzle(env.DB)
    .insert(memberships)
    .values({ userId, tenantId, role, createdAt: new Date().toISOString() });
}

describe("tenant gate + gated DO routes (end to end)", () => {
  it("walks the full journey: type registration, record write, read", async () => {
    const { tenantId, bearer } = await bootstrapTenant();

    const typeRes = await app.request(`/v1/t/${tenantId}/content-types`, {
      method: "PUT",
      headers: { "content-type": "application/json", authorization: bearer },
      body: JSON.stringify(articleType()),
    }, env);
    expect(typeRes.status).toBe(200);

    const recordId = uuid(70);
    const writeRes = await app.request(`/v1/t/${tenantId}/records/article/${recordId}`, {
      method: "PUT",
      headers: { "content-type": "application/json", authorization: bearer },
      body: JSON.stringify({ input: validArticleInput() }),
    }, env);
    expect(writeRes.status).toBe(200);

    const readRes = await app.request(`/v1/t/${tenantId}/records/${recordId}`, {
      headers: { authorization: bearer },
    }, env);
    expect(readRes.status).toBe(200);
    const record = (await readRes.json()) as { type: string; data: Record<string, unknown> };
    expect(record.type).toBe("article");
    expect(record.data["title"]).toBe("こんにちは");
  });

  it("maps DO domain errors to HTTP statuses", async () => {
    const { tenantId, bearer } = await bootstrapTenant();
    const missingType = await app.request(`/v1/t/${tenantId}/records/nope/${uuid(71)}`, {
      method: "PUT",
      headers: { "content-type": "application/json", authorization: bearer },
      body: JSON.stringify({ input: {} }),
    }, env);
    expect(missingType.status).toBe(404);
    const missingRecord = await app.request(`/v1/t/${tenantId}/records/${uuid(72)}`, {
      headers: { authorization: bearer },
    }, env);
    expect(missingRecord.status).toBe(404);
  });

  it("rejects requests without a token, with a wrong-tenant token, and from blocked users", async () => {
    const a = await bootstrapTenant();
    const b = await bootstrapTenant();

    expect(
      (await app.request(`/v1/t/${a.tenantId}/records/${uuid(73)}`, {}, env)).status,
    ).toBe(401);

    const crossTenant = await app.request(`/v1/t/${a.tenantId}/records/${uuid(73)}`, {
      headers: { authorization: b.bearer },
    }, env);
    expect(crossTenant.status).toBe(403);

    await blockUser(env.BLOCKLIST, a.userId);
    const blocked = await app.request(`/v1/t/${a.tenantId}/records/${uuid(73)}`, {
      headers: { authorization: a.bearer },
    }, env);
    expect(blocked.status).toBe(403);
  });

  it("propagates stage-2 denial for viewers as 403 (defense in depth)", async () => {
    const owner = await bootstrapTenant();
    const viewer = await bootstrapTenant(); // 別テナントの owner だが、owner.tenantId では viewer
    await grantMembership(viewer.userId, owner.tenantId, "viewer");
    const issued = await app.request(
      "/auth/token",
      json({ tenantId: owner.tenantId }, { cookie: viewer.cookie }),
      env,
    );
    const { token } = (await issued.json()) as { token: string };

    await app.request(`/v1/t/${owner.tenantId}/content-types`, {
      method: "PUT",
      headers: { "content-type": "application/json", authorization: owner.bearer },
      body: JSON.stringify(articleType()),
    }, env);

    const denied = await app.request(`/v1/t/${owner.tenantId}/records/article/${uuid(74)}`, {
      method: "PUT",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ input: validArticleInput() }),
    }, env);
    expect(denied.status).toBe(403);
  });
});
```

- [ ] **Step 3: テストが失敗することを確認**

Run: `pnpm --filter @plyrs/api test`
Expected: FAIL — `/v1/t/...` が 404（ルート未定義）

- [ ] **Step 4: ゲートとルートを書く**

`apps/api/src/middleware/tenant-gate.ts`:

```ts
import { createMiddleware } from "hono/factory";
import { isBlocked } from "../auth/blocklist";
import { verifyTenantToken } from "../auth/jwt";
import type { AuthContext } from "../do/authorize";

export type GateVariables = { auth: AuthContext & { tenantId: string } };

// design-spec §11.5 第1段: JWT 署名検証 + tenant 照合のみで DO への到達を判定する
// （D1 を引かない）。§11.2 のブロックリスト照会（KV）もここ。通らなければ DO を起こさない。
export const tenantGate = createMiddleware<{ Bindings: Env; Variables: GateVariables }>(
  async (c, next) => {
    const header = c.req.header("authorization") ?? "";
    if (!header.startsWith("Bearer ")) {
      return c.json({ error: "unauthenticated" }, 401);
    }
    const claims = await verifyTenantToken(c.env.JWT_SECRET, header.slice("Bearer ".length));
    if (claims === null) {
      return c.json({ error: "unauthenticated" }, 401);
    }
    if (claims.tenantId !== c.req.param("tenantId")) {
      return c.json({ error: "wrong_tenant" }, 403);
    }
    if (await isBlocked(c.env.BLOCKLIST, claims.userId)) {
      return c.json({ error: "blocked" }, 403);
    }
    c.set("auth", { userId: claims.userId, role: claims.role, tenantId: claims.tenantId });
    await next();
  },
);
```

`apps/api/src/routes/tenant.ts`:

```ts
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";
import { WORKFLOW_STATUSES } from "@plyrs/metamodel";
import { tenantGate, type GateVariables } from "../middleware/tenant-gate";
import {
  asContentTypeRow,
  asDeleteResult,
  asRecordSnapshot,
  asRegisterResult,
  asWriteResult,
} from "../rpc-unwrap";

const ERROR_STATUS: Record<string, ContentfulStatusCode> = {
  forbidden: 403,
  unknown_type: 404,
  not_found: 404,
  unique_violation: 409,
  id_mismatch: 409,
  key_mismatch: 409,
  record_deleted: 410,
  already_deleted: 410,
};

function statusFor(code: string): ContentfulStatusCode {
  return ERROR_STATUS[code] ?? 400;
}

const writeBodySchema = z.object({
  input: z.record(z.string(), z.unknown()),
  status: z.enum(WORKFLOW_STATUSES).optional(),
});

type GateEnv = { Bindings: Env; Variables: GateVariables };

function stubFor(c: { env: Env; req: { param: (key: "tenantId") => string } }) {
  // design-spec §2: テナント = 1 DO。tenantId がそのまま DO 名（＝物理分離の境界）
  const id = c.env.TENANT_DO.idFromName(c.req.param("tenantId"));
  return c.env.TENANT_DO.get(id);
}

export const tenantRoutes = new Hono<GateEnv>()
  .use("/:tenantId/*", tenantGate)
  .put("/:tenantId/content-types", async (c) => {
    const result = asRegisterResult(
      await stubFor(c).registerContentType(await c.req.json(), c.get("auth")),
    );
    return result.ok ? c.json(result) : c.json(result, statusFor(result.code));
  })
  .get("/:tenantId/content-types/:key", async (c) => {
    const row = asContentTypeRow(await stubFor(c).getContentType(c.req.param("key")));
    return row === null ? c.json({ error: "not_found" }, 404) : c.json(row);
  })
  .put(
    "/:tenantId/records/:typeKey/:recordId",
    zValidator("json", writeBodySchema),
    async (c) => {
      const { input, status } = c.req.valid("json");
      const result = asWriteResult(
        await stubFor(c).writeRecord(
          c.req.param("typeKey"),
          { recordId: c.req.param("recordId"), input, ...(status ? { status } : {}) },
          c.get("auth"),
        ),
      );
      return result.ok ? c.json(result) : c.json(result, statusFor(result.code));
    },
  )
  .get("/:tenantId/records/:recordId", async (c) => {
    const record = asRecordSnapshot(await stubFor(c).getRecord(c.req.param("recordId")));
    return record === null ? c.json({ error: "not_found" }, 404) : c.json(record);
  })
  .delete("/:tenantId/records/:recordId", async (c) => {
    const result = asDeleteResult(
      await stubFor(c).deleteRecord(c.req.param("recordId"), c.get("auth")),
    );
    return result.ok ? c.json(result) : c.json(result, statusFor(result.code));
  });
```

`apps/api/src/index.ts` — import と route を追加:

```ts
import { tenantRoutes } from "./routes/tenant";
```

```ts
app.route("/v1/t", tenantRoutes);
```

- [ ] **Step 5: テストが通ることを確認**

Run: `pnpm --filter @plyrs/api test` → 全 PASS（76件目安）
Run: `pnpm --filter @plyrs/api typecheck` → エラーなし

- [ ] **Step 6: フォーマット・lint・コミット**

```bash
pnpm format && pnpm lint
git add apps/api/src/rpc-unwrap.ts apps/api/test/rpc-unwrap.ts apps/api/src/middleware apps/api/src/routes/tenant.ts apps/api/src/index.ts apps/api/test/gate.test.ts
git commit -m "feat: add the stage-1 tenant gate and gated DO proxy routes"
```

---

### Task 9: 全体整合の最終確認

**Files:**
- Modify: なし（確認のみ。差分が出た場合のみ修正をコミット）

- [ ] **Step 1: ルート全チェック**

Run: `pnpm lint && pnpm format:check && pnpm typecheck && pnpm test`
Expected: すべて exit 0・警告ゼロ。metamodel 46 / db 4 / api 76目安、全 PASS

- [ ] **Step 2: クリーンツリー確認**

Run: `git status --short --untracked-files=no`
Expected: 出力なし

- [ ] **Step 3: 差分が出た場合のみ**

修正し、内容に応じた `chore:`/`fix:` コミットを作る（対象パスのみ `git add`）。

---

## Self-Review 結果

- **Spec coverage:** ロードマップ Phase 3 行 — D1 スキーマ（Task 1）、signup/login + PBKDF2（Task 3・7）、jose 短命 JWT（Task 5）、KV ブロックリスト（Task 5・7・8）、Worker 入口ゲート → DO ルーティング（Task 8）、第2段認可 + デフォルトロール焼き込み（Task 5・6）、JWT リフレッシュ G5（Task 7 `/auth/token`）。§5 申し送り — 認可は no-op より前の RPC 入口（Task 6）、deleteRecord の認可（Task 6。モジュール beforeDelete フック自体は Phase 9 の汎用化で）、短絡テスト（Task 6 hooks.test.ts）、Extract 化（Task 6）。すべて対応。
- **Placeholder scan:** TBD/TODO なし。条件付き指示は既知の注意1-3のみ（具体的対処付き）。
- **Type consistency:** `AuthContext`（Task 6 authorize.ts）↔ fixtures.auth ↔ tenant-gate の GateVariables、`WriteRecordInput`（types.ts）↔ TenantDO ↔ routes/tenant.ts、`SESSION_COOKIE`（Task 4）↔ Task 7/8、`TOKEN_TTL = 900` ↔ auth-routes テスト、`RegisterContentTypeResult` の forbidden 追加 ↔ asRegisterResult — 整合を確認済み。
- **設計メモ:** パスワード最小長は signup/login の zod で 12 文字（PBKDF2 天井 100k の補償として NIST 最小 8 より強め）。`/auth/token` は毎回 D1 でセッション + membership を引く（15分キャッシュとしての JWT がその後の高頻度アクセスを担う — design-spec §11.2 の「D1 を引かない」は第1段ゲートの性質であり token 再発行時ではない）。
