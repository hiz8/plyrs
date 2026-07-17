# Phase 6b: コンテンツモデリングと record 編集 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 管理画面に content_type ビルダー・メタモデル駆動の動的フォーム・同期エンジン接続の record 一覧/編集・publish/status 操作(スロット実配線)を追加し、Phase 6 を完結させる。

**Architecture:** `/t/$tenantSlug` レイアウトで SyncEngine + CollectionRegistry を確立し(§8 の配線 5 点をここで消化)、record 系ルートは React context 経由でコレクションを購読する。record 編集は TanStack Form + metamodel の Zod スキーマで駆動し、publish/unpublish/公開状態は新設の HTTP API(`GET .../publication`)+ Hono RPC で行う。publish/status 操作 UI はコア自身が `record-editor:toolbar` / `record-editor:panel` スロットに登録する(ドッグフーディング)。

**Tech Stack:** TanStack Start/Router/Query/Form、@tanstack/db 0.6.14(既存 pin)、@plyrs/sync-client、react-aria-components + StyleX、Zod v4、Vitest + RTL(jsdom)、@cloudflare/vitest-pool-workers(api 側)。

## 裁定事項(2026-07-17 確定・全タスクの前提)

1. **richtext の暫定表現** = 読み取り専用プレースホルダー。値は input に透過保持(changedFields に載らない → 競合も発生しない)。
2. **relation 編集 UI** = 同期コレクション駆動の picker(one=単一選択 / many=複数選択・順序は選択順)。asset 型は特別扱いなし(未知型は候補 0 件に自然退化)。
3. **content_type ビルダー** = 新規作成 + 既存型の編集(PUT upsert、version はサーバー管理で自動 +1)。key は id に対して変更不可(key_mismatch 409)。破壊的変更は警告文言のみ(遅延適合 = design-spec §4.2)。
4. **同期接続ライフサイクル** = `/t/$tenantSlug` レイアウトで確立。mount で start() / unmount・テナント切替・logout で stop() / `online` イベントと再接続ボタンで start() 再呼び出し(§8 契約 3)。
5. **publish / status 操作の配置** = コアが `record-editor:toolbar`(操作)と `record-editor:panel`(公開状態表示)にスロット自己登録。
6. **スカラー競合の UI** = 最小(SyncRejectedError のエラーバナーのみ)。conflict ack は richtext のみで 6b UI からは発生しない(resolve.ts で確認済み)。本文競合 UI は Phase 7。

**6a Minor の消化判断: 全部消化する**(7 件すべて 5〜30 分粒度。Task 1 = api 側 3 件、Task 2 = admin 側 4 件)。

## Global Constraints

- コミット件名は **50 字以内**(verify-commit-message.sh が機械拒否)。
- `@ts-expect-error` / `any` **禁止**。RPC 境界などやむを得ない cast は rpc-unwrap 様式(文書化されたキャスト関数 or コメント付き `as 具体型`)。
- bare `git stash` / `git stash pop` **禁止**(共有スタック)。
- node_modules へのシンボリックリンク作成禁止。sandbox 制限に当たったら回避せず停止して報告。
- リンターは oxlint、フォーマッターは oxfmt。`pnpm lint` / `pnpm format:check`(ルート)で検証。警告 0 を維持。
- apps/api は `"lib": ["ES2023"]`(DOM 型混入禁止)。admin は tsconfig.json + tsconfig.worker.json の 2 本。
- **route のテストファイルを `apps/admin/src/routes/` に置かない**(ルート生成器がルートとして解釈する)。ルートテストは `apps/admin/src/*.test.tsx` に置く。
- ルートを追加したら `pnpm --filter @plyrs/admin build` で `routeTree.gen.ts` を再生成してからコミット(build は sandbox の EROFS で落ちるため **コントローラが sandbox 無効で実行**する。実装サブエージェントは routeTree 再生成が必要になったらコントローラへ依頼する)。
- `CI=true` の pnpm install は auto-frozen。**lockfile 更新を伴うタスク(Task 6)は `pnpm install --no-frozen-lockfile`**。
- テスト実行はワークスペースルートから `pnpm --filter <pkg> test`。実出力をレポートに貼る(要約だけは不可)。
- vitest 末尾の「something prevents Vite server from exiting」は @stylexjs/unplugin + vitest 4 の既知ノイズ(exit 0 なら無視)。
- 日付・コピーライトの類は書かない。UI 文言は日本語。

## File Structure(このフェーズで触るファイルの全体像)

```
pnpm-workspace.yaml                                   # catalog に @tanstack/react-form 追加 (Task 6)
apps/api/
  src/do/publish.ts                                   # loadPublicationState 追加 (Task 3)
  src/tenant-do.ts                                    # getPublication RPC 追加 (Task 3)
  src/rpc-unwrap.ts                                   # asPublicationState 追加 (Task 3)
  src/routes/tenant.ts                                # GET .../publication 追加 (Task 3)
  src/public/query.test.ts                            # describe 再配置 (Task 1)
  test/rpc-unwrap.ts                                  # asPublicationState 追加 (Task 3)
  test/publish.test.ts                                # publication state テスト (Task 3)
  test/content-types-list.test.ts                     # HTTP publication テスト追記 (Task 3)
  test/public-cache-order.test.ts                     # sort=/include= 単独ウォームヒット (Task 1)
  test/auth-routes.test.ts                            # name アサート (Task 1)
apps/admin/
  package.json                                        # 依存追加 (Task 6)
  src/server.ts                                       # isApiPath を api-paths へ移動 (Task 2)
  src/router.tsx                                      # defaultErrorComponent / SyncFactory / slot 登録 (Task 2, 6, 11)
  src/routeTree.gen.ts                                # 生成物(Task 9, 10 でルート追加後に再生成)
  src/lib/api-paths.ts                                # 新規: isApiPath 純関数 (Task 2)
  src/lib/api-paths.test.ts                           # 新規 (Task 2)
  src/lib/api-client.ts                               # throwApiError の code/message 拡張 (Task 4)
  src/lib/token-manager.ts                            # forceRefresh (Task 4)
  src/lib/token-manager.test.ts                       # forceRefresh テスト (Task 4)
  src/lib/admin-api.ts                                # 書き込みメソッド + 401 リトライ (Task 4)
  src/lib/admin-api.test.ts                           # 追記 (Task 4)
  src/lib/queries.ts                                  # publicationQueryOptions (Task 4)
  src/lib/sync.ts                                     # 新規: createTenantSync(配線 5 点) (Task 6)
  src/lib/sync.test.ts                                # 新規 (Task 6)
  src/lib/sync-context.tsx                            # 新規: Provider + hooks (Task 6)
  src/lib/use-collection.ts                           # 新規: useCollectionRows / useRelationCandidates (Task 6)
  src/lib/record-form-values.ts                       # 新規: draft ⇄ input 変換 (Task 7)
  src/lib/record-form-values.test.ts                  # 新規 (Task 7)
  src/lib/content-type-form.ts                        # 新規: FieldDraft ⇄ FieldDefinition 変換 (Task 9)
  src/lib/content-type-form.test.ts                   # 新規 (Task 9)
  src/components/error-screen.tsx                     # 新規 (Task 2)
  src/components/record-form.tsx                      # 新規: 動的フォーム (Task 8)
  src/components/record-form.test.tsx                 # 新規 (Task 8)
  src/components/content-type-form.tsx                # 新規: ビルダー UI (Task 9)
  src/components/publish-toolbar.tsx                  # 新規: toolbar スロット (Task 11)
  src/components/status-control.tsx                   # 新規: toolbar スロット (Task 11)
  src/components/publication-panel.tsx                # 新規: panel スロット (Task 11)
  src/test-utils/fake-socket.ts                       # 新規: テスト用 WS フェイク (Task 6)
  src/routes/t/$tenantSlug/route.tsx                  # Sync provider + インジケータ (Task 6)
  src/routes/t/$tenantSlug/content-types.tsx          # → content-types/index.tsx へ再編 (Task 9)
  src/routes/t/$tenantSlug/content-types/index.tsx    # 一覧 + リンク + caption (Task 2 で caption、Task 9 で移動)
  src/routes/t/$tenantSlug/content-types/new.tsx      # 新規 (Task 9)
  src/routes/t/$tenantSlug/content-types/$typeKey.edit.tsx  # 新規 (Task 9)
  src/routes/t/$tenantSlug/records/$typeKey/index.tsx # 新規: record 一覧 (Task 10)
  src/routes/t/$tenantSlug/records/$typeKey/new.tsx   # 新規 (Task 10)
  src/routes/t/$tenantSlug/records/$typeKey/$recordId.tsx  # 新規: エディタ (Task 10)
  src/shell.test.tsx                                  # renderAt 拡張 + errorComponent テスト (Task 2, 6)
  src/content-type-builder.test.tsx                   # 新規: ビルダーのルートテスト (Task 9)
  src/records-flow.test.tsx                           # 新規: record CRUD のルートテスト (Task 10)
  src/publish-slots.test.tsx                          # 新規: publish/status スロットテスト (Task 11)
packages/ui/
  src/index.ts                                        # 新部品 export (Task 5)
  src/checkbox.tsx / checkbox-group.tsx / select.tsx / text-area.tsx  # 新規 (Task 5)
  src/checkbox.test.tsx / select.test.tsx / text-area.test.tsx        # 新規 (Task 5)
  src/slots.ts                                        # nav:item 契約の文書化 (Task 12)
docs/superpowers/plans/2026-07-12-implementation-roadmap.md  # §3 行更新(計画コミット時)・申し送り(マージ後)
```

**タスク依存関係:** Task 1, 2, 3, 5 は独立。Task 4 は 3 の型(PublicationState)を参照。Task 6 は 4 に依存(token-manager)。Task 7 は独立(metamodel のみ)。Task 8 は 5, 6, 7 に依存。Task 9 は 4, 5 に依存。Task 10 は 8 に依存。Task 11 は 4, 10 に依存。Task 12 は最後。

---

### Task 1: api 側 Minor 消化(6a 申し送りの回帰テスト 3 件)

**Files:**
- Modify: `apps/api/test/public-cache-order.test.ts`(sort= / include= 単独のウォームヒット 2 テスト追加)
- Modify: `apps/api/src/public/query.test.ts`(buildListQuery のバインド予算テストを専用 describe へ移動)
- Modify: `apps/api/test/auth-routes.test.ts`(/auth/tenants の name アサート追加)

**Interfaces:**
- Consumes: 既存の `app.request` / `seedTenant` / `poisonedProjectionDb` ヘルパー(public-cache-order.test.ts 内)
- Produces: なし(テストのみ)

- [ ] **Step 1: sort= 単独・include= 単独(一覧)のウォームヒットテストを追加**

`apps/api/test/public-cache-order.test.ts` の describe 内、既存の「serves a warm filtered list」テストの直後に追加:

```ts
  it("serves a warm sorted list (sort= only) from cache without touching the projection DB", async () => {
    const slug = `cache-order-sort-${RUN_ID}`;
    const tenantId = await seedTenant(slug);
    const recordId = crypto.randomUUID();
    await env.PROJECTION_DB.prepare(
      "INSERT INTO projection_fields (tenant_id, type, field_key, kind, multi, projected_at) VALUES (?1, 'post', 'title', 'text', 0, 0)",
    )
      .bind(tenantId)
      .run();
    await env.PROJECTION_DB.prepare(
      "INSERT INTO projected_records (tenant_id, record_id, type, slug, published_at, data, source_version, publish_seq, projected_at) VALUES (?1, ?2, 'post', NULL, '2026-07-16T00:00:00.000Z', ?3, 1, 1, 0)",
    )
      .bind(tenantId, recordId, JSON.stringify({ title: "t" }))
      .run();
    await env.PROJECTION_DB.prepare(
      "INSERT INTO projection_index (tenant_id, type, field_key, value_text, record_id) VALUES (?1, 'post', 'title', 't', ?2)",
    )
      .bind(tenantId, recordId)
      .run();
    const url = `/public/v1/${slug}/records/post?sort=-title`;
    const cold = await app.request(url, {}, env);
    expect(cold.status).toBe(200);
    const warm = await app.request(url, {}, { ...env, PROJECTION_DB: poisonedProjectionDb() });
    expect(warm.status).toBe(200);
    const warmBody = (await warm.json()) as { items: unknown[] };
    expect(warmBody.items.length).toBe(1);
  });

  it("serves a warm list with include (include= only) from cache without touching the projection DB", async () => {
    const slug = `cache-order-list-include-${RUN_ID}`;
    const tenantId = await seedTenant(slug);
    const postId = crypto.randomUUID();
    const authorId = crypto.randomUUID();
    await env.PROJECTION_DB.prepare(
      "INSERT INTO projection_fields (tenant_id, type, field_key, kind, multi, projected_at) VALUES (?1, 'post', 'authors', 'relation', 1, 0)",
    )
      .bind(tenantId)
      .run();
    await env.PROJECTION_DB.prepare(
      "INSERT INTO projected_records (tenant_id, record_id, type, slug, published_at, data, source_version, publish_seq, projected_at) VALUES (?1, ?2, 'post', NULL, '2026-07-16T00:00:00.000Z', ?3, 1, 1, 0)",
    )
      .bind(tenantId, postId, JSON.stringify({ title: "t" }))
      .run();
    await env.PROJECTION_DB.prepare(
      "INSERT INTO projected_records (tenant_id, record_id, type, slug, published_at, data, source_version, publish_seq, projected_at) VALUES (?1, ?2, 'author', NULL, '2026-07-16T00:00:00.000Z', ?3, 1, 1, 0)",
    )
      .bind(tenantId, authorId, JSON.stringify({ name: "a" }))
      .run();
    await env.PROJECTION_DB.prepare(
      "INSERT INTO projected_relations (tenant_id, source_id, source_field, target_type, target_id, ordinal, origin) VALUES (?1, ?2, 'authors', 'author', ?3, 0, 'field')",
    )
      .bind(tenantId, postId, authorId)
      .run();
    const url = `/public/v1/${slug}/records/post?include=authors`;
    const cold = await app.request(url, {}, env);
    expect(cold.status).toBe(200);
    const warm = await app.request(url, {}, { ...env, PROJECTION_DB: poisonedProjectionDb() });
    expect(warm.status).toBe(200);
  });
```

- [ ] **Step 2: テスト実行(新規 2 件が green であることを確認)**

Run: `pnpm --filter @plyrs/api test -- test/public-cache-order.test.ts`
Expected: PASS(7 tests。既存 5 + 新規 2)

- [ ] **Step 3: query.test.ts の describe 再配置**

`apps/api/src/public/query.test.ts` で、`describe("parseListQuery: MAX_TOTAL_FILTER_VALUES（D1 バインド予算、Finding 1）", ...)` の中にある 3 本目のテスト `it("keeps buildListQuery's bind count within D1's 100/query cap for the worst allowed query", ...)` を、**そのままの本文で**新しい describe に切り出す。移動後の形:

```ts
// (既存の describe は 2 本の parseListQuery テストだけになる)
describe("parseListQuery: MAX_TOTAL_FILTER_VALUES（D1 バインド予算、Finding 1）", () => {
  it("rejects when the total filter value count exceeds the D1 bind budget (60)", () => {
    /* 既存本文のまま */
  });
  it("accepts exactly the total filter value budget (60)", () => {
    /* 既存本文のまま */
  });
});

// buildListQuery を検証するテストは buildListQuery の describe に置く（6a 最終レビュー Minor）
describe("buildListQuery: D1 バインド予算（Finding 1）", () => {
  it("keeps the bind count within D1's 100/query cap for the worst allowed query", () => {
    /* 既存本文のまま移動（it 名の先頭 "keeps buildListQuery's" は "keeps the" に変更） */
  });
});
```

- [ ] **Step 4: /auth/tenants の name アサート追加**

`apps/api/test/auth-routes.test.ts` の `it("lists the session user's tenants with roles (Phase 6a)")` 内、`expect(tenants.map((t) => t.slug)).toStrictEqual([slugA, slugB]);` の直後に 1 行追加:

```ts
    expect(tenants.map((t) => t.name)).toStrictEqual(["A", "B"]);
```

(slug 昇順 = slugA("a-…") が先で、その name は "A"。)

- [ ] **Step 5: api 全テスト + lint/format 実行**

Run: `pnpm --filter @plyrs/api test && pnpm lint && pnpm format:check`
Expected: 282 tests green(279 + 3)、lint 警告 0、format clean

- [ ] **Step 6: Commit**

```bash
git add apps/api/test/public-cache-order.test.ts apps/api/src/public/query.test.ts apps/api/test/auth-routes.test.ts
git commit -m "test: cover phase 6a minor gaps in api tests"
```

---

### Task 2: admin 側 Minor 消化(errorComponent / isApiPath / 再 export 削除 / caption)

**Files:**
- Create: `apps/admin/src/lib/api-paths.ts`
- Create: `apps/admin/src/lib/api-paths.test.ts`
- Create: `apps/admin/src/components/error-screen.tsx`
- Modify: `apps/admin/src/server.ts`(isApiPath を import に置換)
- Modify: `apps/admin/src/router.tsx`(defaultErrorComponent)
- Modify: `apps/admin/src/lib/admin-api.ts`(未使用の `export type { ApiClient }` を削除)
- Modify: `apps/admin/src/routes/t/$tenantSlug/content-types.tsx`(table caption)
- Modify: `apps/admin/src/shell.test.tsx`(errorComponent テスト追加)

**Interfaces:**
- Consumes: `ApiError`(`./lib/api-client`)
- Produces: `isApiPath(pathname: string): boolean`(`lib/api-paths.ts`)、`ErrorScreen({ error }: { error: unknown })`(`components/error-screen.tsx`。TanStack Router の errorComponent 契約 = props に `error` を受ける)

- [ ] **Step 1: isApiPath の失敗するテストを書く**

`apps/admin/src/lib/api-paths.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { isApiPath } from "./api-paths";

describe("isApiPath", () => {
  it("matches exact prefixes and their subpaths", () => {
    expect(isApiPath("/auth")).toBe(true);
    expect(isApiPath("/auth/token")).toBe(true);
    expect(isApiPath("/v1")).toBe(true);
    expect(isApiPath("/v1/t/t1/sync")).toBe(true);
  });

  it("does not match lookalike prefixes or app routes", () => {
    expect(isApiPath("/authx")).toBe(false);
    expect(isApiPath("/v10/records")).toBe(false);
    expect(isApiPath("/")).toBe(false);
    expect(isApiPath("/t/blog/content-types")).toBe(false);
    // /public/v1 はヘッドレス契約 = api Worker の直接責務（プロキシしない）
    expect(isApiPath("/public/v1/blog/records/post")).toBe(false);
  });
});
```

- [ ] **Step 2: テストが FAIL することを確認**

Run: `pnpm --filter @plyrs/admin test -- src/lib/api-paths.test.ts`
Expected: FAIL(`Cannot find module './api-paths'` 相当)

- [ ] **Step 3: api-paths.ts を作成し server.ts から参照する**

`apps/admin/src/lib/api-paths.ts`:

```ts
// 2026-07-16 裁定: /auth・/v1 は service binding で api Worker へ転送する same-origin
// プロキシ。/public/v1 は転送しない（ヘッドレス契約 = api Worker の直接の責務）。
// server.ts は cloudflare:workers を import するため vitest で直接テストできない —
// 判定だけこの純関数に切り出す（6a 最終レビュー Minor の消化）。
const API_PREFIXES = ["/auth", "/v1"];

export function isApiPath(pathname: string): boolean {
  return API_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}
```

`apps/admin/src/server.ts` を次の形に変更(コメントの転送方針 2 行は api-paths.ts へ移ったので削る):

```ts
import handler, { createServerEntry } from "@tanstack/react-start/server-entry";
import { env } from "cloudflare:workers";
import { isApiPath } from "./lib/api-paths";

// WebSocket（/v1/t/:tenantId/sync）の upgrade もこの転送に乗る。
export default createServerEntry({
  fetch(request) {
    const { pathname } = new URL(request.url);
    if (isApiPath(pathname)) {
      return env.API.fetch(request);
    }
    return handler.fetch(request);
  },
});
```

- [ ] **Step 4: テストが PASS することを確認**

Run: `pnpm --filter @plyrs/admin test -- src/lib/api-paths.test.ts`
Expected: PASS(2 tests)

- [ ] **Step 5: ErrorScreen コンポーネントを作成**

`apps/admin/src/components/error-screen.tsx`:

```tsx
import * as stylex from "@stylexjs/stylex";
import { Button } from "@plyrs/ui";
import { colors, spacing, typography } from "@plyrs/ui/tokens.stylex";
import { ApiError } from "../lib/api-client";

const styles = stylex.create({
  screen: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: spacing.md,
    padding: spacing.xl,
    fontFamily: typography.fontFamily,
    color: colors.text,
  },
  title: { fontSize: typography.sizeXl, margin: 0 },
  detail: { color: colors.textMuted, margin: 0 },
});

// TanStack Router の errorComponent 契約: 捕捉した error を props で受ける。
// blocked 403 や 5xx が Router 既定の素の表示に落ちないための最終防衛線（6a Minor）。
export function ErrorScreen({ error }: { error: unknown }) {
  const detail =
    error instanceof ApiError
      ? `${error.status}: ${error.code}`
      : error instanceof Error
        ? error.message
        : String(error);
  return (
    <div {...stylex.props(styles.screen)} role="alert">
      <h1 {...stylex.props(styles.title)}>エラーが発生しました</h1>
      <p {...stylex.props(styles.detail)}>{detail}</p>
      <Button onPress={() => window.location.reload()}>再読み込み</Button>
    </div>
  );
}
```

- [ ] **Step 6: router.tsx に defaultErrorComponent を配線 + admin-api の再 export 削除 + caption 追加**

`apps/admin/src/router.tsx` の `createRouter` 呼び出しに 1 行追加:

```ts
import { ErrorScreen } from "./components/error-screen";
// ...getRouter 内:
  return createRouter({
    routeTree,
    context: options?.context ?? createAppContext(),
    defaultPreload: "intent",
    defaultErrorComponent: ErrorScreen,
    ...(options?.history ? { history: options.history } : {}),
  });
```

`apps/admin/src/lib/admin-api.ts` 末尾の 2 行を削除(router.tsx は api-client から直接 import しており未使用):

```ts
// 削除する 2 行:
// ApiClient は router context の組み立て（Task 12）で token-manager と束ねる
export type { ApiClient };
```

あわせて先頭の import を `import { throwApiError } from "./api-client";` に変更(型 import の `type ApiClient` を外す)。

`apps/admin/src/routes/t/$tenantSlug/content-types.tsx` の `<table>` 直下に caption を追加し、styles に `caption` を足す:

```tsx
// styles に追加:
  caption: {
    captionSide: "top",
    textAlign: "left",
    color: colors.textMuted,
    fontSize: typography.sizeSm,
    paddingBottom: spacing.xs,
  },
// table 内:
        <table {...stylex.props(styles.table)}>
          <caption {...stylex.props(styles.caption)}>登録済みコンテンツタイプの一覧</caption>
          <thead>
```

- [ ] **Step 7: errorComponent のルートテストを追加**

`apps/admin/src/shell.test.tsx` の describe 末尾にテスト追加:

```tsx
  it("shows the error screen when a loader fails with a server error", async () => {
    renderAt(
      "/t/blog/content-types",
      authedRoutes({
        "/v1/t/t1/content-types": vi.fn(() => jsonResponse(500, { error: "boom" })),
      }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("エラーが発生しました");
    expect(screen.getByText("500: boom")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "再読み込み" })).toBeInTheDocument();
  });
```

- [ ] **Step 8: admin 全テスト + typecheck + lint 実行**

Run: `pnpm --filter @plyrs/admin test && pnpm --filter @plyrs/admin typecheck && pnpm lint && pnpm format:check`
Expected: 29 tests green(26 + api-paths 2 + errorComponent 1)、typecheck / lint / format clean

- [ ] **Step 9: Commit**

```bash
git add apps/admin/src/lib/api-paths.ts apps/admin/src/lib/api-paths.test.ts apps/admin/src/components/error-screen.tsx apps/admin/src/server.ts apps/admin/src/router.tsx apps/admin/src/lib/admin-api.ts apps/admin/src/routes/t/\$tenantSlug/content-types.tsx apps/admin/src/shell.test.tsx
git commit -m "fix: add root error screen and admin minors"
```

---

### Task 3: 公開状態の読み取り API(DO RPC + HTTP + rpc-unwrap)

record の公開状態(published_snapshots の有無)は現状クライアントから読めない。公開状態パネル・archive 警告(design-spec §7)のために read API を新設する。

**Files:**
- Modify: `apps/api/src/do/publish.ts`(`PublicationState` 型 + `loadPublicationState`)
- Modify: `apps/api/src/tenant-do.ts`(`getPublication` RPC)
- Modify: `apps/api/src/rpc-unwrap.ts`(`asPublicationState`)
- Modify: `apps/api/test/rpc-unwrap.ts`(同上。テスト側ミラー)
- Modify: `apps/api/src/routes/tenant.ts`(`GET /:tenantId/records/:recordId/publication`)
- Test: `apps/api/test/publish.test.ts`(DO 層)、`apps/api/test/content-types-list.test.ts`(HTTP 層)

**Interfaces:**
- Consumes: `published_snapshots` テーブル(既存)、`tenantGate`(既存)
- Produces:
  - `type PublicationState = { published: false } | { published: true; publishedAt: string; publishedBy: string; sourceVersion: number }`(do/publish.ts から export)
  - `TenantDO.getPublication(recordId: string): PublicationState`
  - `GET /v1/t/:tenantId/records/:recordId/publication` → 200 で PublicationState を返す(record が存在しなくても `{ published: false }`。真実源は snapshot の有無であり record の存在ではない)
  - `asPublicationState(value: unknown): PublicationState`

- [ ] **Step 1: DO 層の失敗するテストを書く**

`apps/api/test/publish.test.ts` の describe 内(beforeEach で `uuid(100)` の article が書き込み済み)に追加。import に `asPublicationState` を足す(`./rpc-unwrap` から):

```ts
  it("reports the publication state for the admin panel (Phase 6b)", async () => {
    expect(asPublicationState(await stub.getPublication(uuid(100)))).toStrictEqual({
      published: false,
    });
    const published = asPublishResult(await stub.publishRecord(TENANT, uuid(100), auth("owner1")));
    expect(published.ok).toBe(true);
    const state = asPublicationState(await stub.getPublication(uuid(100)));
    expect(state).toMatchObject({ published: true, sourceVersion: 1, publishedBy: "owner1" });
    const un = asUnpublishResult(await stub.unpublishRecord(TENANT, uuid(100), auth("owner1")));
    expect(un.ok).toBe(true);
    expect(asPublicationState(await stub.getPublication(uuid(100)))).toStrictEqual({
      published: false,
    });
  });
```

`apps/api/test/rpc-unwrap.ts` に追加(src 側と同じ形。既存関数群の隣):

```ts
export function asPublicationState(value: unknown): PublicationState {
  return value as PublicationState;
}
```

(import は `import type { PublicationState } from "../src/do/publish";`。既存 import の並びに足す。)

- [ ] **Step 2: テストが FAIL することを確認**

Run: `pnpm --filter @plyrs/api test -- test/publish.test.ts`
Expected: FAIL(`PublicationState` が未定義 / `stub.getPublication is not a function`)

- [ ] **Step 3: loadPublicationState と RPC を実装**

`apps/api/src/do/publish.ts` に追加(既存の `rowToSnapshot` 付近):

```ts
// Phase 6b: 管理画面の公開状態表示・archive 警告（design-spec §7）のための読み取り。
// 公開状態の真実源 = published_snapshots 行の有無（§7）なので、record の存在は見ない。
export type PublicationState =
  | { published: false }
  | { published: true; publishedAt: string; publishedBy: string; sourceVersion: number };

export function loadPublicationState(sql: SqlStorage, recordId: string): PublicationState {
  const row = sql
    .exec<{ published_at: string; published_by: string; source_version: number }>(
      "SELECT published_at, published_by, source_version FROM published_snapshots WHERE record_id = ?",
      recordId,
    )
    .toArray()[0];
  return row === undefined
    ? { published: false }
    : {
        published: true,
        publishedAt: row.published_at,
        publishedBy: row.published_by,
        sourceVersion: row.source_version,
      };
}
```

`apps/api/src/tenant-do.ts` に RPC を追加(`getRecord` の直後。import に `loadPublicationState` / `type PublicationState` を足す):

```ts
  // Phase 6b: 公開状態の読み取り（読み取り系は getRecord と同じく role 不問 — authorize.ts 冒頭コメント参照）
  getPublication(recordId: string): PublicationState {
    return loadPublicationState(this.ctx.storage.sql, recordId);
  }
```

`apps/api/src/rpc-unwrap.ts` に追加(import に `type PublicationState` を足す):

```ts
export function asPublicationState(value: unknown): PublicationState {
  return value as PublicationState;
}
```

- [ ] **Step 4: DO 層テストが PASS することを確認**

Run: `pnpm --filter @plyrs/api test -- test/publish.test.ts`
Expected: PASS(既存 + 新規 1)

- [ ] **Step 5: HTTP ルートの失敗するテストを書く**

`apps/api/test/content-types-list.test.ts` に describe を追加(既存の `bootstrapTenant` / `json` ヘルパーを再利用。import に `validArticleInput` を `./fixtures` から追加):

```ts
describe("GET /v1/t/:tenantId/records/:recordId/publication (Phase 6b)", () => {
  it("reflects publish and unpublish", async () => {
    const { tenantId, bearer } = await bootstrapTenant();
    await app.request(
      `/v1/t/${tenantId}/content-types`,
      {
        method: "PUT",
        headers: { "content-type": "application/json", authorization: bearer },
        body: JSON.stringify(articleType()),
      },
      env,
    );
    const recordId = crypto.randomUUID();
    const written = await app.request(
      `/v1/t/${tenantId}/records/article/${recordId}`,
      {
        method: "PUT",
        headers: { "content-type": "application/json", authorization: bearer },
        body: JSON.stringify({ input: validArticleInput() }),
      },
      env,
    );
    expect(written.status).toBe(200);

    const before = await app.request(
      `/v1/t/${tenantId}/records/${recordId}/publication`,
      { headers: { authorization: bearer } },
      env,
    );
    expect(before.status).toBe(200);
    expect(await before.json()).toStrictEqual({ published: false });

    const published = await app.request(
      `/v1/t/${tenantId}/records/${recordId}/publish`,
      { method: "POST", headers: { authorization: bearer } },
      env,
    );
    expect(published.status).toBe(200);

    const after = await app.request(
      `/v1/t/${tenantId}/records/${recordId}/publication`,
      { headers: { authorization: bearer } },
      env,
    );
    const state = (await after.json()) as { published: boolean; sourceVersion?: number };
    expect(state.published).toBe(true);
    expect(state.sourceVersion).toBe(1);
  });

  it("requires authentication", async () => {
    const { tenantId } = await bootstrapTenant();
    const res = await app.request(`/v1/t/${tenantId}/records/whatever/publication`, {}, env);
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 6: テストが FAIL することを確認**

Run: `pnpm --filter @plyrs/api test -- test/content-types-list.test.ts`
Expected: FAIL(publication GET が 404 = ルート未定義)

- [ ] **Step 7: ルートを実装**

`apps/api/src/routes/tenant.ts` の `.get("/:tenantId/records/:recordId", ...)` の**前**に追加(セグメント数が違うので順序は本質でないが、具体→汎用の並びに揃える)。import に `asPublicationState` を足す:

```ts
  .get("/:tenantId/records/:recordId/publication", async (c) => {
    const state = asPublicationState(
      await stubFor(c).getPublication(c.req.param("recordId")),
    );
    return c.json(state);
  })
```

- [ ] **Step 8: api 全テストが PASS することを確認**

Run: `pnpm --filter @plyrs/api test`
Expected: 285 tests green(282 + 3)

- [ ] **Step 9: typecheck / lint / format**

Run: `pnpm --filter @plyrs/api typecheck && pnpm lint && pnpm format:check`
Expected: clean

- [ ] **Step 10: Commit**

```bash
git add apps/api/src/do/publish.ts apps/api/src/tenant-do.ts apps/api/src/rpc-unwrap.ts apps/api/test/rpc-unwrap.ts apps/api/src/routes/tenant.ts apps/api/test/publish.test.ts apps/api/test/content-types-list.test.ts
git commit -m "feat: expose record publication state"
```

---

### Task 4: token-manager forceRefresh + admin-api の書き込みメソッド拡充

WS の 4001(トークン失効)とマージン内失効に備える forceRefresh、および 6b の全 HTTP 操作(putContentType / publish / unpublish / getPublication)をクライアントに足す。

**Files:**
- Modify: `apps/admin/src/lib/token-manager.ts`
- Modify: `apps/admin/src/lib/token-manager.test.ts`
- Modify: `apps/admin/src/lib/api-client.ts`(throwApiError が `code` / `message` フィールドも拾う)
- Modify: `apps/admin/src/lib/admin-api.ts`
- Modify: `apps/admin/src/lib/admin-api.test.ts`
- Modify: `apps/admin/src/lib/queries.ts`(publicationQueryOptions)

**Interfaces:**
- Consumes: Task 3 の HTTP 契約(`PUT /content-types` は `{ ok: true, contentType }` / 失敗時は `{ ok: false, code, message }` + 4xx、`GET .../publication` は PublicationState)
- Produces:
  - `TokenManager.getToken(tenantId: string, options?: { forceRefresh?: boolean }): Promise<string>`
  - `AdminApi.putContentType(tenantId: string, definition: ContentTypeDefinition): Promise<ContentTypeSummary>`
  - `AdminApi.publishRecord(tenantId: string, recordId: string): Promise<void>`
  - `AdminApi.unpublishRecord(tenantId: string, recordId: string): Promise<void>`
  - `AdminApi.getPublication(tenantId: string, recordId: string): Promise<PublicationState>`
  - `type PublicationState`(admin-api.ts から export。api 側と構造一致)
  - `ApiError.detail?: string`(サーバーの message。バリデーション詳細の表示用)
  - `publicationQueryOptions(adminApi, tenantId, recordId)`(queries.ts)

- [ ] **Step 1: token-manager の失敗するテストを書く**

`apps/admin/src/lib/token-manager.test.ts` に追加:

```ts
  it("forceRefresh bypasses a fresh cache entry", async () => {
    let calls = 0;
    const tokens = createTokenManager({
      issueToken: async () => {
        calls += 1;
        return { token: `t${calls}`, expiresIn: 900 };
      },
    });
    expect(await tokens.getToken("t1")).toBe("t1");
    expect(await tokens.getToken("t1")).toBe("t1"); // キャッシュヒット
    expect(await tokens.getToken("t1", { forceRefresh: true })).toBe("t2");
    expect(calls).toBe(2);
    // forceRefresh 後はキャッシュも更新されている
    expect(await tokens.getToken("t1")).toBe("t2");
  });

  it("forceRefresh reuses an inflight request instead of stacking a second one", async () => {
    let calls = 0;
    let release: (() => void) | undefined;
    const tokens = createTokenManager({
      issueToken: () =>
        new Promise((resolve) => {
          calls += 1;
          release = () => resolve({ token: `t${calls}`, expiresIn: 900 });
        }),
    });
    const first = tokens.getToken("t1");
    const second = tokens.getToken("t1", { forceRefresh: true });
    release?.();
    expect(await first).toBe("t1");
    expect(await second).toBe("t1");
    expect(calls).toBe(1);
  });
```

- [ ] **Step 2: テストが FAIL することを確認**

Run: `pnpm --filter @plyrs/admin test -- src/lib/token-manager.test.ts`
Expected: FAIL(forceRefresh がキャッシュを素通りしない)

- [ ] **Step 3: getToken に forceRefresh を実装**

`apps/admin/src/lib/token-manager.ts` の `getToken` を変更(先頭コメントにも 1 行追記):

```ts
    async getToken(tenantId: string, options?: { forceRefresh?: boolean }): Promise<string> {
      const cached = cache.get(tenantId);
      if (
        options?.forceRefresh !== true &&
        cached !== undefined &&
        cached.expiresAt - now() > REFRESH_MARGIN_MS
      ) {
        return cached.token;
      }
      // forceRefresh でも飛行中リクエストは再利用する（結果はどのみち発行直後の新トークン）
      const pending = inflight.get(tenantId);
      if (pending !== undefined) {
        return pending;
      }
      /* 以降は既存のまま */
```

ファイル冒頭コメント(3 行目付近)に追記:

```ts
// forceRefresh はマージン内でもサーバー側で失効している場合（WS 4001 / HTTP 401）の再発行用。
```

- [ ] **Step 4: テストが PASS することを確認**

Run: `pnpm --filter @plyrs/admin test -- src/lib/token-manager.test.ts`
Expected: PASS

- [ ] **Step 5: admin-api の失敗するテストを書く**

`apps/admin/src/lib/admin-api.test.ts` に追加(既存テストのヘルパー様式に合わせる。既存ファイルの fetch スタブの作り方を確認して同じ形で書くこと):

```ts
  it("puts a content type definition and returns the stored row", async () => {
    const handler = vi.fn(() =>
      jsonResponse(200, { ok: true, contentType: { id: "c1", key: "article", version: 2 } }),
    );
    const adminApi = createAdminApi(fixedTokens("jwt-1"), stubFetch({ "/v1/t/t1/content-types": handler }));
    const definition = {
      id: "c1",
      key: "article",
      name: "記事",
      fields: [],
      source: "user",
      version: 1,
    };
    const row = await adminApi.putContentType("t1", definition as never);
    expect(row).toMatchObject({ key: "article", version: 2 });
    const init = handler.mock.calls[0]?.[0] as RequestInit;
    expect(init.method).toBe("PUT");
    expect(JSON.parse(String(init.body))).toMatchObject({ key: "article" });
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer jwt-1");
  });

  it("publishes, unpublishes and reads publication state", async () => {
    const publish = vi.fn(() => jsonResponse(200, { ok: true }));
    const unpublish = vi.fn(() => jsonResponse(200, { ok: true }));
    const publication = vi.fn(() =>
      jsonResponse(200, { published: true, publishedAt: "2026-07-17T00:00:00Z", publishedBy: "u1", sourceVersion: 3 }),
    );
    const adminApi = createAdminApi(
      fixedTokens("jwt-1"),
      stubFetch({
        "/v1/t/t1/records/r1/publish": publish,
        "/v1/t/t1/records/r1/unpublish": unpublish,
        "/v1/t/t1/records/r1/publication": publication,
      }),
    );
    await adminApi.publishRecord("t1", "r1");
    await adminApi.unpublishRecord("t1", "r1");
    const state = await adminApi.getPublication("t1", "r1");
    expect((publish.mock.calls[0]?.[0] as RequestInit).method).toBe("POST");
    expect((unpublish.mock.calls[0]?.[0] as RequestInit).method).toBe("POST");
    expect(state).toMatchObject({ published: true, sourceVersion: 3 });
  });

  it("retries once with forceRefresh when the api answers 401", async () => {
    const issued: string[] = [];
    const tokens = createTokenManager({
      issueToken: async () => {
        const token = `jwt-${issued.length + 1}`;
        issued.push(token);
        return { token, expiresIn: 900 };
      },
    });
    const handler = vi.fn((init?: RequestInit) => {
      const bearer = new Headers(init?.headers).get("authorization");
      return bearer === "Bearer jwt-2"
        ? jsonResponse(200, { contentTypes: [] })
        : jsonResponse(401, { error: "token_expired" });
    });
    const adminApi = createAdminApi(tokens, stubFetch({ "/v1/t/t1/content-types": handler }));
    await expect(adminApi.listContentTypes("t1")).resolves.toStrictEqual([]);
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("carries the server error code and message on failures", async () => {
    const adminApi = createAdminApi(
      fixedTokens("jwt-1"),
      stubFetch({
        "/v1/t/t1/content-types": vi.fn(() =>
          jsonResponse(409, { ok: false, code: "id_mismatch", message: "key taken" }),
        ),
      }),
    );
    const definition = { id: "c1", key: "a", name: "A", fields: [], source: "user", version: 1 };
    // 401 リトライは 1 回だけなので 409 はそのまま ApiError になる
    const error = await adminApi.putContentType("t1", definition as never).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe("id_mismatch");
    expect((error as ApiError).detail).toBe("key taken");
  });
```

補助として同ファイルに(無ければ)ヘルパーを追加。**既存の admin-api.test.ts に同等ヘルパーが既にある場合はそれを使い、重複定義しない**:

```ts
function fixedTokens(token: string): TokenManager {
  return { getToken: async () => token, clear: () => {} } as TokenManager;
}
```

(`fixedTokens` は `getToken(tenantId, options?)` の新シグネチャに構造的整合。`createTokenManager` を使う 401 テストは実物を使う。import に `createTokenManager` / `ApiError` を追加。)

- [ ] **Step 6: テストが FAIL することを確認**

Run: `pnpm --filter @plyrs/admin test -- src/lib/admin-api.test.ts`
Expected: FAIL(putContentType 等が未定義)

- [ ] **Step 7: api-client の throwApiError 拡張と admin-api の実装**

`apps/admin/src/lib/api-client.ts` の ApiError / throwApiError を変更:

```ts
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly detail?: string,
  ) {
    super(detail === undefined ? `${status}: ${code}` : `${status}: ${code} (${detail})`);
    this.name = "ApiError";
  }
}

export async function throwApiError(response: Response): Promise<never> {
  let code = "unknown_error";
  let detail: string | undefined;
  try {
    const body = (await response.json()) as { error?: unknown; code?: unknown; message?: unknown };
    // /auth 系は { error }、DO 由来の結果は { ok: false, code, message } — 両対応で拾う
    if (typeof body.error === "string") {
      code = body.error;
    } else if (typeof body.code === "string") {
      code = body.code;
    }
    if (typeof body.message === "string") {
      detail = body.message;
    }
  } catch {
    // 本文が JSON でない（ゲートウェイ応答等）場合は unknown_error のまま
  }
  throw new ApiError(response.status, code, detail);
}
```

`apps/admin/src/lib/admin-api.ts` を全面的に次へ更新:

```ts
import type { ContentTypeDefinition, FieldDefinition } from "@plyrs/metamodel";
import { throwApiError } from "./api-client";
import type { TokenManager } from "./token-manager";

// Bearer 付きの管理 API（/v1/t/:tenantId/...）。トークンは token-manager が供給する。
// 形は apps/api の ContentTypeRow（rpc-unwrap.ts）と一致させる。
export interface ContentTypeSummary {
  id: string;
  key: string;
  name: string;
  fields: FieldDefinition[];
  source: "user" | "plugin" | "system";
  pluginId: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

// apps/api/src/do/publish.ts の PublicationState と構造一致（HTTP 契約）
export type PublicationState =
  | { published: false }
  | { published: true; publishedAt: string; publishedBy: string; sourceVersion: number };

const JSON_HEADERS = { "content-type": "application/json" } as const;

export function createAdminApi(
  tokens: TokenManager,
  fetchImpl: typeof fetch = (...args) => fetch(...args),
) {
  async function authedFetch(tenantId: string, path: string, init: RequestInit): Promise<Response> {
    const request = async (token: string) =>
      fetchImpl(`/v1/t/${tenantId}${path}`, {
        ...init,
        headers: { ...(init.headers ?? {}), authorization: `Bearer ${token}` },
      });
    const response = await request(await tokens.getToken(tenantId));
    if (response.status !== 401) {
      return response;
    }
    // マージン内でもサーバー側で失効していることがある（§11 申し送り）。1 回だけ再発行して再試行。
    return request(await tokens.getToken(tenantId, { forceRefresh: true }));
  }

  async function requestJson<T>(tenantId: string, path: string, init: RequestInit = {}): Promise<T> {
    const response = await authedFetch(tenantId, path, init);
    if (!response.ok) {
      return throwApiError(response);
    }
    return (await response.json()) as T;
  }

  return {
    async listContentTypes(tenantId: string): Promise<ContentTypeSummary[]> {
      const { contentTypes } = await requestJson<{ contentTypes: ContentTypeSummary[] }>(
        tenantId,
        "/content-types",
      );
      return contentTypes;
    },
    async putContentType(
      tenantId: string,
      definition: ContentTypeDefinition,
    ): Promise<ContentTypeSummary> {
      const result = await requestJson<{ ok: true; contentType: ContentTypeSummary }>(
        tenantId,
        "/content-types",
        { method: "PUT", headers: JSON_HEADERS, body: JSON.stringify(definition) },
      );
      return result.contentType;
    },
    async publishRecord(tenantId: string, recordId: string): Promise<void> {
      await requestJson<{ ok: true }>(tenantId, `/records/${recordId}/publish`, {
        method: "POST",
      });
    },
    async unpublishRecord(tenantId: string, recordId: string): Promise<void> {
      await requestJson<{ ok: true }>(tenantId, `/records/${recordId}/unpublish`, {
        method: "POST",
      });
    },
    getPublication(tenantId: string, recordId: string): Promise<PublicationState> {
      return requestJson<PublicationState>(tenantId, `/records/${recordId}/publication`);
    },
  };
}

export type AdminApi = ReturnType<typeof createAdminApi>;
```

`apps/admin/src/lib/queries.ts` に追加:

```ts
export function publicationQueryOptions(adminApi: AdminApi, tenantId: string, recordId: string) {
  return queryOptions({
    queryKey: ["publication", tenantId, recordId],
    queryFn: () => adminApi.getPublication(tenantId, recordId),
    staleTime: 5_000,
  });
}
```

- [ ] **Step 8: テストが PASS することを確認 + admin 全テスト**

Run: `pnpm --filter @plyrs/admin test && pnpm --filter @plyrs/admin typecheck && pnpm lint && pnpm format:check`
Expected: all green / clean(既存テストの getToken 呼び出しはシグネチャ後方互換なので壊れない)

- [ ] **Step 9: Commit**

```bash
git add apps/admin/src/lib/token-manager.ts apps/admin/src/lib/token-manager.test.ts apps/admin/src/lib/api-client.ts apps/admin/src/lib/admin-api.ts apps/admin/src/lib/admin-api.test.ts apps/admin/src/lib/queries.ts
git commit -m "feat: extend admin api client for phase 6b"
```

---

### Task 5: packages/ui のフォーム部品(Checkbox / CheckboxGroup / Select / TextArea)

動的フォームとビルダーが使う入力部品。既存 TextField / Button の様式(RAC + stylexRenderProps、className render props 合成)に厳密に合わせる。

**Files:**
- Create: `packages/ui/src/checkbox.tsx`
- Create: `packages/ui/src/checkbox-group.tsx`
- Create: `packages/ui/src/select.tsx`
- Create: `packages/ui/src/text-area.tsx`
- Create: `packages/ui/src/checkbox.test.tsx`
- Create: `packages/ui/src/select.test.tsx`
- Create: `packages/ui/src/text-area.test.tsx`
- Modify: `packages/ui/src/index.ts`

**Interfaces:**
- Consumes: `stylexRenderProps`(compose.ts)、tokens
- Produces:
  - `Checkbox({ children, isSelected, onChange, isDisabled? })`
  - `CheckboxGroup({ label, options: { value: string; label: string }[], value: string[], onChange(next: string[]), errorMessage? })`
  - `Select({ label, items: { value: string; label: string }[], selectedValue: string, onChange(value: string), placeholder?, isDisabled?, errorMessage? })` — 空選択は `selectedValue === ""`
  - `TextArea({ label, value, onChange, rows?, errorMessage?, isInvalid?, isRequired?, isDisabled? })`

- [ ] **Step 1: 失敗するテストを書く**

`packages/ui/src/checkbox.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Checkbox } from "./checkbox";
import { CheckboxGroup } from "./checkbox-group";

describe("Checkbox", () => {
  it("toggles through onChange", async () => {
    const onChange = vi.fn();
    render(
      <Checkbox isSelected={false} onChange={onChange}>
        必須
      </Checkbox>,
    );
    await userEvent.setup().click(screen.getByRole("checkbox", { name: "必須" }));
    expect(onChange).toHaveBeenCalledWith(true);
  });
});

describe("CheckboxGroup", () => {
  const options = [
    { value: "tech", label: "Tech" },
    { value: "life", label: "Life" },
  ];

  it("reflects and updates the selected values", async () => {
    const onChange = vi.fn();
    render(<CheckboxGroup label="タグ" options={options} value={["tech"]} onChange={onChange} />);
    expect(screen.getByRole("checkbox", { name: "Tech" })).toBeChecked();
    await userEvent.setup().click(screen.getByRole("checkbox", { name: "Life" }));
    expect(onChange).toHaveBeenCalledWith(["tech", "life"]);
  });

  it("shows the error message", () => {
    render(
      <CheckboxGroup label="タグ" options={options} value={[]} onChange={() => {}} errorMessage="必須です" />,
    );
    expect(screen.getByText("必須です")).toBeInTheDocument();
  });
});
```

`packages/ui/src/select.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Select } from "./select";

describe("Select", () => {
  const items = [
    { value: "draft", label: "下書き" },
    { value: "ready", label: "公開準備完了" },
  ];

  it("opens the listbox and selects an item", async () => {
    const onChange = vi.fn();
    render(
      <Select label="ステータス" items={items} selectedValue="draft" onChange={onChange} />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /ステータス/ }));
    await user.click(await screen.findByRole("option", { name: "公開準備完了" }));
    expect(onChange).toHaveBeenCalledWith("ready");
  });

  it("shows the placeholder when nothing is selected", () => {
    render(
      <Select label="型" items={items} selectedValue="" onChange={() => {}} placeholder="(未設定)" />,
    );
    expect(screen.getByRole("button", { name: /(未設定)/ })).toBeInTheDocument();
  });
});
```

`packages/ui/src/text-area.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TextArea } from "./text-area";

describe("TextArea", () => {
  it("renders a labelled textarea and propagates changes", async () => {
    const onChange = vi.fn();
    render(<TextArea label="JSON" value="" onChange={onChange} rows={4} />);
    const area = screen.getByRole("textbox", { name: "JSON" });
    await userEvent.setup().type(area, "{{");
    expect(onChange).toHaveBeenCalled();
  });

  it("shows the error message when invalid", () => {
    render(
      <TextArea label="JSON" value="x" onChange={() => {}} isInvalid errorMessage="JSON として解釈できません" />,
    );
    expect(screen.getByText("JSON として解釈できません")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: テストが FAIL することを確認**

Run: `pnpm --filter @plyrs/ui test`
Expected: FAIL(モジュール未定義)

- [ ] **Step 3: 4 部品を実装**

`packages/ui/src/checkbox.tsx`:

```tsx
import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import { Checkbox as RacCheckbox, type CheckboxRenderProps } from "react-aria-components";
import { stylexRenderProps } from "./compose";
import { colors, spacing, typography } from "./tokens.stylex";

const styles = stylex.create({
  root: {
    display: "flex",
    alignItems: "center",
    gap: spacing.xs,
    fontFamily: typography.fontFamily,
    fontSize: typography.sizeMd,
    color: colors.text,
    cursor: "pointer",
  },
  rootDisabled: { color: colors.textMuted, cursor: "not-allowed" },
});

export interface CheckboxProps {
  children: ReactNode;
  isSelected: boolean;
  onChange: (isSelected: boolean) => void;
  isDisabled?: boolean;
}

export function Checkbox({ children, isSelected, onChange, isDisabled }: CheckboxProps) {
  return (
    <RacCheckbox
      isSelected={isSelected}
      onChange={onChange}
      isDisabled={isDisabled ?? false}
      className={stylexRenderProps<CheckboxRenderProps>((state) => [
        styles.root,
        state.isDisabled && styles.rootDisabled,
      ])}
    >
      {({ isSelected: selected }) => (
        <>
          <span aria-hidden="true">{selected ? "☑" : "☐"}</span>
          {children}
        </>
      )}
    </RacCheckbox>
  );
}
```

`packages/ui/src/checkbox-group.tsx`:

```tsx
import * as stylex from "@stylexjs/stylex";
import { CheckboxGroup as RacCheckboxGroup, Label, Text } from "react-aria-components";
import { Checkbox } from "./checkbox";
import { colors, spacing, typography } from "./tokens.stylex";

const styles = stylex.create({
  group: {
    display: "flex",
    flexDirection: "column",
    gap: spacing.xs,
    fontFamily: typography.fontFamily,
  },
  label: { fontSize: typography.sizeSm, color: colors.textMuted },
  error: { fontSize: typography.sizeSm, color: colors.danger },
});

export interface CheckboxGroupProps {
  label: string;
  options: { value: string; label: string }[];
  value: string[];
  onChange: (next: string[]) => void;
  errorMessage?: string;
}

export function CheckboxGroup({ label, options, value, onChange, errorMessage }: CheckboxGroupProps) {
  return (
    <RacCheckboxGroup
      value={value}
      onChange={onChange}
      className={stylex.props(styles.group).className ?? ""}
    >
      <Label className={stylex.props(styles.label).className ?? ""}>{label}</Label>
      {options.map((option) => (
        <Checkbox
          key={option.value}
          isSelected={value.includes(option.value)}
          onChange={(selected) =>
            onChange(selected ? [...value, option.value] : value.filter((v) => v !== option.value))
          }
        >
          {option.label}
        </Checkbox>
      ))}
      {errorMessage !== undefined && (
        <Text slot="errorMessage" className={stylex.props(styles.error).className ?? ""}>
          {errorMessage}
        </Text>
      )}
    </RacCheckboxGroup>
  );
}
```

**実装注意:** RAC の CheckboxGroup 直下に自前 onChange 付き Checkbox を置くと value 管理が二重になる。上のコードは Checkbox 側 onChange で配列を自前合成しており、RacCheckboxGroup の value/onChange は a11y 属性(group 連結)のためだけに渡している。RAC の挙動と衝突してテストが落ちる場合は、RacCheckboxGroup を `<div role="group" aria-label={label}>` に落として自前合成のみにしてよい(その判断をレポートに記録)。

`packages/ui/src/select.tsx`:

```tsx
import * as stylex from "@stylexjs/stylex";
import {
  Button as RacButton,
  Label,
  ListBox,
  ListBoxItem,
  Popover,
  Select as RacSelect,
  SelectValue,
  Text,
  type ListBoxItemRenderProps,
} from "react-aria-components";
import { stylexRenderProps } from "./compose";
import { colors, spacing, typography } from "./tokens.stylex";

const styles = stylex.create({
  field: {
    display: "flex",
    flexDirection: "column",
    gap: spacing.xs,
    fontFamily: typography.fontFamily,
  },
  label: { fontSize: typography.sizeSm, color: colors.textMuted },
  trigger: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    fontSize: typography.sizeMd,
    paddingBlock: spacing.xs,
    paddingInline: spacing.sm,
    borderRadius: "6px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: colors.border,
    backgroundColor: colors.bg,
    color: colors.text,
    cursor: "pointer",
  },
  popover: {
    backgroundColor: colors.bg,
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: colors.border,
    borderRadius: "6px",
    minWidth: "180px",
  },
  item: {
    padding: spacing.sm,
    fontSize: typography.sizeMd,
    fontFamily: typography.fontFamily,
    color: colors.text,
    cursor: "pointer",
    outline: "none",
  },
  itemFocused: { backgroundColor: colors.surface },
  error: { fontSize: typography.sizeSm, color: colors.danger },
});

export interface SelectProps {
  label: string;
  items: { value: string; label: string }[];
  /** 空文字 = 未選択（placeholder 表示） */
  selectedValue: string;
  onChange: (value: string) => void;
  placeholder?: string;
  isDisabled?: boolean;
  errorMessage?: string;
}

export function Select({
  label,
  items,
  selectedValue,
  onChange,
  placeholder,
  isDisabled,
  errorMessage,
}: SelectProps) {
  return (
    <RacSelect
      selectedKey={selectedValue === "" ? null : selectedValue}
      onSelectionChange={(key) => onChange(key === null ? "" : String(key))}
      isDisabled={isDisabled ?? false}
      placeholder={placeholder ?? "選択してください"}
      className={stylex.props(styles.field).className ?? ""}
    >
      <Label className={stylex.props(styles.label).className ?? ""}>{label}</Label>
      <RacButton className={stylex.props(styles.trigger).className ?? ""}>
        <SelectValue />
        <span aria-hidden="true">▾</span>
      </RacButton>
      {errorMessage !== undefined && (
        <Text slot="errorMessage" className={stylex.props(styles.error).className ?? ""}>
          {errorMessage}
        </Text>
      )}
      <Popover className={stylex.props(styles.popover).className ?? ""}>
        <ListBox>
          {items.map((item) => (
            <ListBoxItem
              key={item.value}
              id={item.value}
              textValue={item.label}
              className={stylexRenderProps<ListBoxItemRenderProps>((state) => [
                styles.item,
                state.isFocused && styles.itemFocused,
              ])}
            >
              {item.label}
            </ListBoxItem>
          ))}
        </ListBox>
      </Popover>
    </RacSelect>
  );
}
```

`packages/ui/src/text-area.tsx`:

```tsx
import * as stylex from "@stylexjs/stylex";
import {
  FieldError,
  Label,
  TextArea as RacTextArea,
  TextField as RacTextField,
  type TextAreaRenderProps,
} from "react-aria-components";
import { stylexRenderProps } from "./compose";
import { colors, spacing, typography } from "./tokens.stylex";

const styles = stylex.create({
  field: {
    display: "flex",
    flexDirection: "column",
    gap: spacing.xs,
    fontFamily: typography.fontFamily,
  },
  label: { fontSize: typography.sizeSm, color: colors.textMuted },
  area: {
    fontSize: typography.sizeMd,
    fontFamily: typography.fontFamily,
    paddingBlock: spacing.xs,
    paddingInline: spacing.sm,
    borderRadius: "6px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: colors.border,
    backgroundColor: colors.bg,
    color: colors.text,
    outline: "none",
    resize: "vertical",
  },
  areaFocused: { borderColor: colors.focusRing },
  error: { fontSize: typography.sizeSm, color: colors.danger },
});

export interface TextAreaProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  errorMessage?: string;
  isInvalid?: boolean;
  isRequired?: boolean;
  isDisabled?: boolean;
}

export function TextArea({
  label,
  value,
  onChange,
  rows,
  errorMessage,
  isInvalid,
  isRequired,
  isDisabled,
}: TextAreaProps) {
  return (
    <RacTextField
      value={value}
      onChange={onChange}
      isInvalid={isInvalid ?? false}
      isRequired={isRequired ?? false}
      isDisabled={isDisabled ?? false}
      className={stylex.props(styles.field).className ?? ""}
    >
      <Label className={stylex.props(styles.label).className ?? ""}>{label}</Label>
      <RacTextArea
        rows={rows ?? 6}
        className={stylexRenderProps<TextAreaRenderProps>((state) => [
          styles.area,
          state.isFocused && styles.areaFocused,
        ])}
      />
      <FieldError className={stylex.props(styles.error).className ?? ""}>{errorMessage}</FieldError>
    </RacTextField>
  );
}
```

`packages/ui/src/index.ts` に export を追加:

```ts
export { Checkbox, type CheckboxProps } from "./checkbox";
export { CheckboxGroup, type CheckboxGroupProps } from "./checkbox-group";
export { Select, type SelectProps } from "./select";
export { TextArea, type TextAreaProps } from "./text-area";
```

- [ ] **Step 4: テストが PASS することを確認**

Run: `pnpm --filter @plyrs/ui test && pnpm --filter @plyrs/ui typecheck && pnpm lint && pnpm format:check`
Expected: all green(13 + 新規 6 前後)。RAC の型名(`CheckboxRenderProps` 等)が合わない場合は node_modules の react-aria-components の型定義を確認して正しい名前に直すこと(当てずっぽうで any にしない)。

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src
git commit -m "feat: add form primitives to ui package"
```

---

### Task 6: 同期エンジンの配線(ロードマップ §8 の 5 点)とテナントシェル接続

Phase 4b 申し送りの配線契約 5 点(onContentTypes → registry.sync / onReady → registry.markReady / onStoreChange → registry.applyStoreChange / onReset → registry.reset / 循環は `let registry!` 前方参照)をここで**全部**消化する。裁定 4: 接続は `/t/$tenantSlug` レイアウトで確立。

**Files:**
- Modify: `pnpm-workspace.yaml`(catalog に `"@tanstack/react-form": ^1.33.2` を追加 — Task 8 で使用。lockfile 更新をここに集約)
- Modify: `apps/admin/package.json`(dependencies に `@plyrs/sync-client`, `@plyrs/sync-protocol`, `@tanstack/db`, `@tanstack/react-form`, `uuid` を追加)
- Create: `apps/admin/src/lib/sync.ts`
- Create: `apps/admin/src/lib/sync.test.ts`
- Create: `apps/admin/src/lib/sync-context.tsx`
- Create: `apps/admin/src/lib/use-collection.ts`
- Create: `apps/admin/src/test-utils/fake-socket.ts`
- Modify: `apps/admin/src/router.tsx`(RouterContext に `sync` / createAppContext に `connect` オプション)
- Modify: `apps/admin/src/routes/t/$tenantSlug/route.tsx`(Provider + start/stop + online + インジケータ + logout stop)
- Modify: `apps/admin/src/shell.test.tsx`(renderAt に connect スタブ / インジケータのテスト)

**Interfaces:**
- Consumes: `SyncEngine` / `SyncEngineOptions` / `SyncStatus`(@plyrs/sync-client)、`CollectionRegistry`(@plyrs/sync-client/tanstack)、`createBrowserConnect`(@plyrs/sync-client/browser)、`ConnectFn`(@plyrs/sync-client)、Task 4 の `TokenManager.getToken(tenantId, { forceRefresh })`
- Produces:
  - `interface TenantSync { engine: SyncEngine; registry: CollectionRegistry; getStatus(): SyncStatus; getTypes(): ContentTypeDefinition[]; subscribe(listener: () => void): () => void; start(): void; stop(): void }`
  - `createTenantSync(options: { connect: ConnectFn; refreshToken?: () => Promise<void>; reconnectDelaysMs?: number[] }): TenantSync`
  - `type SyncFactory = (tenantId: string) => TenantSync`(router.tsx。RouterContext に `sync: SyncFactory`)
  - `createAppContext(fetchImpl?, options?: { connect?: (tenantId: string) => ConnectFn })`
  - `TenantSyncProvider` / `useTenantSync()` / `useSyncStatus(sync)` / `useSyncTypes(sync)`(sync-context.tsx)
  - `useCollectionRows(collection)` / `useRelationCandidates(registry, allowedTypes)`(use-collection.ts)
  - `FakeSocket`(test-utils/fake-socket.ts。sync-client の engine.test.ts と同形 + `parsed()` / `deliver()`)

- [ ] **Step 1: 依存を追加して install**

`pnpm-workspace.yaml` の catalog に(アルファベット順の位置へ):

```yaml
  "@tanstack/react-form": ^1.33.2
```

`apps/admin/package.json` の dependencies に追加:

```json
    "@plyrs/sync-client": "workspace:*",
    "@plyrs/sync-protocol": "workspace:*",
    "@tanstack/db": "catalog:",
    "@tanstack/react-form": "catalog:",
    "uuid": "catalog:"
```

Run: `pnpm install --no-frozen-lockfile`
Expected: lockfile 更新、エラーなし(@stylexjs/unplugin の peer 警告は既知・許容)

**注意:** `@tanstack/react-db` は追加**しない**(0.1.x は @tanstack/db 0.6.16 を固定依存に持ち、catalog の 0.6.14 と二重インスタンス化するため。React 購読は下の useCollectionRows で自前実装する)。

- [ ] **Step 2: FakeSocket テストユーティリティを作成**

`apps/admin/src/test-utils/fake-socket.ts`(packages/sync-client/src/engine.test.ts の FakeSocket と同じ挙動。routes/ 配下ではないのでルート生成に影響しない):

```ts
import type { ServerMessage } from "@plyrs/sync-protocol";
import type { WebSocketLike } from "@plyrs/sync-client";

// 実物の WebSocket は close/message をタスクとしてキューイングし、close() の同期
// コンテキスト内では発火させない（WHATWG）。フェイクもその挙動に合わせる。
export class FakeSocket implements WebSocketLike {
  readyState = 1;
  readonly sent: string[] = [];
  private readonly listeners = new Map<string, ((event: unknown) => void)[]>();

  send(data: string): void {
    this.sent.push(data);
  }

  close(code = 1000, reason = ""): void {
    this.readyState = 3;
    queueMicrotask(() => this.emit("close", { code, reason }));
  }

  addEventListener(type: string, listener: (event: unknown) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  removeEventListener(type: string, listener: (event: unknown) => void): void {
    this.listeners.set(
      type,
      (this.listeners.get(type) ?? []).filter((entry) => entry !== listener),
    );
  }

  emit(type: string, event: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }

  deliver(message: ServerMessage): void {
    this.emit("message", { data: JSON.stringify(message) });
  }

  parsed(): unknown[] {
    return this.sent.map((raw) => JSON.parse(raw));
  }
}

// 接続が確立しない ConnectFn（シェルのテスト用: status は connecting のまま止まる）
export function pendingConnect(): Promise<WebSocketLike> {
  return new Promise<WebSocketLike>(() => {});
}
```

- [ ] **Step 3: createTenantSync の失敗するテストを書く**

`apps/admin/src/lib/sync.test.ts`:

```ts
import type { ContentTypeDefinition } from "@plyrs/metamodel";
import type { SyncRecord } from "@plyrs/sync-protocol";
import { describe, expect, it, vi } from "vitest";
import { FakeSocket } from "../test-utils/fake-socket";
import { createTenantSync } from "./sync";

const articleType: ContentTypeDefinition = {
  id: "018f2b6a-7a0a-7000-8000-000000000001",
  key: "article",
  name: "記事",
  source: "user",
  version: 1,
  fields: [{ key: "title", type: "text", required: true }],
};

function record(overrides: Partial<SyncRecord> = {}): SyncRecord {
  return {
    id: "r1",
    type: "article",
    input: { title: "hello" },
    fieldVersions: { title: 1 },
    status: "draft",
    seq: 3,
    version: 1,
    deletedAt: null,
    updatedAt: "2026-07-17T00:00:00Z",
    updatedBy: "u1",
    ...overrides,
  };
}

async function readySync() {
  const socket = new FakeSocket();
  const sync = createTenantSync({ connect: async () => socket, reconnectDelaysMs: [0, 0] });
  sync.start();
  await vi.waitFor(() => expect(socket.parsed()).toContainEqual({ type: "hello", checkpoint: 0 }));
  return { socket, sync };
}

describe("createTenantSync（ロードマップ §8 配線契約 5 点）", () => {
  it("wires onContentTypes → registry.sync and exposes the types", async () => {
    const { socket, sync } = await readySync();
    socket.deliver({ type: "welcome", protocolVersion: 1, contentTypes: [articleType], serverSeq: 0 });
    await vi.waitFor(() => expect(sync.getTypes().map((t) => t.key)).toStrictEqual(["article"]));
    expect(sync.registry.get("article")).toBeDefined();
  });

  it("wires onReady/onStoreChange: synced records land in the collection", async () => {
    const { socket, sync } = await readySync();
    socket.deliver({ type: "welcome", protocolVersion: 1, contentTypes: [articleType], serverSeq: 3 });
    socket.deliver({ type: "sync", records: [record()], serverSeq: 3, complete: true });
    await vi.waitFor(() => expect(sync.getStatus()).toBe("ready"));
    expect(sync.registry.get("article")?.get("r1")?.input["title"]).toBe("hello");
  });

  it("wires onReset: a server reset truncates the collections", async () => {
    const { socket, sync } = await readySync();
    socket.deliver({ type: "welcome", protocolVersion: 1, contentTypes: [articleType], serverSeq: 3 });
    socket.deliver({ type: "sync", records: [record()], serverSeq: 3, complete: true });
    await vi.waitFor(() => expect(sync.getStatus()).toBe("ready"));
    // serverSeq < checkpoint = サーバーリセット（engine が store.clear + onReset を呼ぶ）
    socket.deliver({ type: "welcome", protocolVersion: 1, contentTypes: [articleType], serverSeq: 1 });
    await vi.waitFor(() => expect(sync.registry.get("article")?.get("r1")).toBeUndefined());
  });

  it("notifies subscribers on status changes and stops notifying after unsubscribe", async () => {
    const socket = new FakeSocket();
    const sync = createTenantSync({ connect: async () => socket, reconnectDelaysMs: [0, 0] });
    const seen: string[] = [];
    const unsubscribe = sync.subscribe(() => seen.push(sync.getStatus()));
    sync.start();
    await vi.waitFor(() => expect(seen).toContain("syncing"));
    unsubscribe();
    const count = seen.length;
    sync.stop();
    expect(seen.length).toBe(count);
  });
});
```

- [ ] **Step 4: テストが FAIL することを確認**

Run: `pnpm --filter @plyrs/admin test -- src/lib/sync.test.ts`
Expected: FAIL(`./sync` 未定義)

- [ ] **Step 5: lib/sync.ts を実装(配線 5 点の本体)**

`apps/admin/src/lib/sync.ts`:

```ts
import type { ContentTypeDefinition } from "@plyrs/metamodel";
import { SyncEngine, type ConnectFn, type SyncStatus } from "@plyrs/sync-client";
import { CollectionRegistry } from "@plyrs/sync-client/tanstack";

// ロードマップ §8「Phase 6 が守るべき配線契約（5点・全部必須）」の消化場所。
// 1. onContentTypes → registry.sync（呼ばないと live query が永久待機）
// 2. onReady → registry.markReady
// 3. onStoreChange → registry.applyStoreChange（未配線だと確定レコードがコレクションに載らない）
// 4. onReset → registry.reset（未配線だとサーバーリセット後にゴーストが残る）
// 5. engine ↔ registry の循環は `let registry!` の前方参照で解く
export interface TenantSync {
  readonly engine: SyncEngine;
  readonly registry: CollectionRegistry;
  getStatus(): SyncStatus;
  getTypes(): ContentTypeDefinition[];
  /** status / contentTypes の変化で発火（useSyncExternalStore 用） */
  subscribe(listener: () => void): () => void;
  start(): void;
  stop(): void;
}

export interface TenantSyncOptions {
  connect: ConnectFn;
  refreshToken?: () => Promise<void>;
  reconnectDelaysMs?: number[];
}

export function createTenantSync(options: TenantSyncOptions): TenantSync {
  let registry!: CollectionRegistry;
  let status: SyncStatus = "idle";
  let types: ContentTypeDefinition[] = [];
  const listeners = new Set<() => void>();
  const emit = () => {
    for (const listener of listeners) {
      listener();
    }
  };
  const engine = new SyncEngine({
    connect: options.connect,
    ...(options.refreshToken !== undefined ? { refreshToken: options.refreshToken } : {}),
    ...(options.reconnectDelaysMs !== undefined
      ? { reconnectDelaysMs: options.reconnectDelaysMs }
      : {}),
    onContentTypes: (next) => {
      types = next;
      registry.sync(next);
      emit();
    },
    onReady: () => registry.markReady(),
    onStoreChange: (change) => registry.applyStoreChange(change),
    onReset: () => registry.reset(),
    onStatus: (next) => {
      status = next;
      emit();
    },
  });
  registry = new CollectionRegistry(engine);
  return {
    engine,
    registry,
    getStatus: () => status,
    getTypes: () => types,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    // start()/stop() は fire-and-forget（engine 側が世代ガードで多重呼び出しに耐える）
    start: () => {
      void engine.start();
    },
    stop: () => {
      void engine.stop();
    },
  };
}
```

- [ ] **Step 6: テストが PASS することを確認**

Run: `pnpm --filter @plyrs/admin test -- src/lib/sync.test.ts`
Expected: PASS(4 tests)

- [ ] **Step 7: sync-context.tsx と use-collection.ts を実装**

`apps/admin/src/lib/sync-context.tsx`:

```tsx
import { createContext, useContext, useSyncExternalStore, type ReactNode } from "react";
import type { ContentTypeDefinition } from "@plyrs/metamodel";
import type { SyncStatus } from "@plyrs/sync-client";
import type { TenantSync } from "./sync";

const SyncContext = createContext<TenantSync | null>(null);

export function TenantSyncProvider({ sync, children }: { sync: TenantSync; children: ReactNode }) {
  return <SyncContext.Provider value={sync}>{children}</SyncContext.Provider>;
}

export function useTenantSync(): TenantSync {
  const sync = useContext(SyncContext);
  if (sync === null) {
    throw new Error("useTenantSync must be used under TenantSyncProvider");
  }
  return sync;
}

export function useSyncStatus(sync: TenantSync): SyncStatus {
  return useSyncExternalStore(sync.subscribe, sync.getStatus);
}

export function useSyncTypes(sync: TenantSync): ContentTypeDefinition[] {
  // getTypes はメッセージ受信時のみ参照が変わる（安定参照）ため snapshot として安全
  return useSyncExternalStore(sync.subscribe, sync.getTypes);
}
```

`apps/admin/src/lib/use-collection.ts`:

```ts
import { useEffect, useState } from "react";
import type { SyncRecord } from "@plyrs/sync-protocol";
import type { Collection } from "@tanstack/db";
import type { CollectionRegistry } from "@plyrs/sync-client/tanstack";

// @tanstack/react-db は採用しない（@tanstack/db 0.6.16 固定依存で catalog の 0.6.14 と
// 二重インスタンス化するため）。subscribeChanges + useState の素朴な購読で足りる。
// collection.toArray は楽観的オーバーレイ込みの見え方（編集の即時反映がここで効く）。
export function useCollectionRows(
  collection: Collection<SyncRecord, string> | undefined,
): SyncRecord[] {
  const [rows, setRows] = useState<SyncRecord[]>(() =>
    collection === undefined ? [] : collection.toArray,
  );
  useEffect(() => {
    if (collection === undefined) {
      setRows([]);
      return;
    }
    setRows(collection.toArray);
    const subscription = collection.subscribeChanges(() => setRows(collection.toArray));
    return () => subscription.unsubscribe();
  }, [collection]);
  return rows;
}

// relation picker の候補: allowedTypes すべてのコレクションを束ねて購読する。
// フックはループで呼べないため、複数コレクションを 1 つの effect で購読する。
export function useRelationCandidates(
  registry: CollectionRegistry,
  allowedTypes: readonly string[],
): SyncRecord[] {
  const [rows, setRows] = useState<SyncRecord[]>([]);
  // 配列の identity 揺れで effect が空回りしないよう、結合キーで依存させる
  const typesKey = allowedTypes.join("");
  useEffect(() => {
    const collections = allowedTypes
      .map((typeKey) => registry.get(typeKey))
      .filter((collection) => collection !== undefined);
    const recompute = () =>
      setRows(
        collections
          .flatMap((collection) => collection.toArray)
          .toSorted((a, b) => a.id.localeCompare(b.id)),
      );
    recompute();
    const subscriptions = collections.map((collection) =>
      collection.subscribeChanges(() => recompute()),
    );
    return () => {
      for (const subscription of subscriptions) {
        subscription.unsubscribe();
      }
    };
    // eslint 相当の依存検査は typesKey で満たす（allowedTypes は typesKey から再構成可能）
  }, [registry, typesKey]);
  return rows;
}
```

**実装注意:** `useRelationCandidates` の effect 本体で `allowedTypes` を参照しているが依存は `typesKey`。oxlint の exhaustive-deps 相当が警告する場合は effect 冒頭で `const types = typesKey.split("").filter((t) => t !== "");` と展開して `allowedTypes` への参照を消すこと(警告 0 維持)。

- [ ] **Step 8: router.tsx に SyncFactory を配線**

`apps/admin/src/router.tsx` を更新(全文):

```tsx
import { QueryClient } from "@tanstack/react-query";
import { createRouter, type RouterHistory } from "@tanstack/react-router";
import { createSlotRegistry, type SlotRegistry } from "@plyrs/ui";
import type { ConnectFn } from "@plyrs/sync-client";
import { createBrowserConnect } from "@plyrs/sync-client/browser";
import { ErrorScreen } from "./components/error-screen";
import { createAdminApi, type AdminApi } from "./lib/admin-api";
import { createApiClient, type ApiClient } from "./lib/api-client";
import { createTenantSync, type TenantSync } from "./lib/sync";
import { createTokenManager, type TokenManager } from "./lib/token-manager";
import { routeTree } from "./routeTree.gen";

export type SyncFactory = (tenantId: string) => TenantSync;

export interface RouterContext {
  queryClient: QueryClient;
  api: ApiClient;
  adminApi: AdminApi;
  tokens: TokenManager;
  slots: SlotRegistry;
  sync: SyncFactory;
}

export interface AppContextOptions {
  /** テスト用: tenantId ごとの ConnectFn を差し替える（既定はブラウザ WS） */
  connect?: (tenantId: string) => ConnectFn;
}

function browserConnect(tenantId: string, tokens: TokenManager): ConnectFn {
  // WS upgrade は admin Worker の service binding プロキシ（/v1）に乗る（server.ts 参照）
  const url = new URL(`/v1/t/${tenantId}/sync`, window.location.origin);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return createBrowserConnect({
    url: url.toString(),
    // 再接続のたびに最新トークンを載せる（60 秒マージンの先回りは token-manager が担う）
    getToken: () => tokens.getToken(tenantId),
  });
}

// 既定はグローバル fetch を束縛したラッパー（ブラウザで detached fetch を呼ぶと
// Illegal invocation になるため、素の `fetch` を既定値にしない）。テストはスタブを渡す。
export function createAppContext(
  fetchImpl: typeof fetch = (...args) => fetch(...args),
  options?: AppContextOptions,
): RouterContext {
  const api = createApiClient(fetchImpl);
  const tokens = createTokenManager({ issueToken: api.issueToken });
  const adminApi = createAdminApi(tokens, fetchImpl);
  const slots = createSlotRegistry();
  // コアのナビ項目。モジュール（Phase 9）も同じ register 経路で項目を足す（design-spec §9.9）
  slots.register("nav:item", {
    id: "core.content-types",
    label: "コンテンツタイプ",
    to: "/t/$tenantSlug/content-types",
    order: 0,
  });
  const connectFor = options?.connect ?? ((tenantId: string) => browserConnect(tenantId, tokens));
  const sync: SyncFactory = (tenantId) =>
    createTenantSync({
      connect: connectFor(tenantId),
      // 4001（トークン失効）で engine が呼ぶ。キャッシュを無視して再発行し、
      // 次の connect の getToken が新トークンを拾う。
      refreshToken: async () => {
        await tokens.getToken(tenantId, { forceRefresh: true });
      },
    });
  return { queryClient: new QueryClient(), api, adminApi, tokens, slots, sync };
}

export function getRouter(options?: { context?: RouterContext; history?: RouterHistory }) {
  return createRouter({
    routeTree,
    context: options?.context ?? createAppContext(),
    defaultPreload: "intent",
    defaultErrorComponent: ErrorScreen,
    ...(options?.history ? { history: options.history } : {}),
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
```

(Task 2 完了済み前提の defaultErrorComponent を含む。Task 11 がこのファイルにスロット登録を足す。)

- [ ] **Step 9: レイアウトに Provider・ライフサイクル・インジケータを配線**

`apps/admin/src/routes/t/$tenantSlug/route.tsx` の `ShellLayout` を更新。追加 import:

```tsx
import { useEffect, useMemo } from "react";
import type { SyncStatus } from "@plyrs/sync-client";
import { TenantSyncProvider, useSyncStatus } from "../../../lib/sync-context";
```

styles に追加:

```tsx
  headerSide: { display: "flex", alignItems: "center", gap: spacing.md },
  syncStatus: { color: colors.textMuted, fontSize: typography.sizeSm },
```

`ShellLayout` 本体を次へ変更(既存の logout / nav 部分は維持):

```tsx
const SYNC_STATUS_LABELS: Record<SyncStatus, string> = {
  idle: "待機",
  connecting: "接続中",
  syncing: "同期中",
  ready: "同期済み",
  closed: "切断",
};

function ShellLayout() {
  const { tenant, slots, api, tokens, queryClient, sync } = Route.useRouteContext();
  const { tenantSlug } = Route.useParams();
  const navigate = useNavigate();
  // 裁定 4: 接続はテナントレイアウトの寿命に一致させる。テナント切替は
  // tenant.id が変わる = useMemo が作り直し、effect cleanup が旧接続を stop する。
  const tenantSync = useMemo(() => sync(tenant.id), [sync, tenant.id]);
  const syncStatus = useSyncStatus(tenantSync);

  useEffect(() => {
    tenantSync.start();
    // §8 契約 3: バックオフ枯渇後の再開はアプリの責務。online で start() を再度呼ぶ。
    const onOnline = () => tenantSync.start();
    window.addEventListener("online", onOnline);
    return () => {
      window.removeEventListener("online", onOnline);
      tenantSync.stop();
    };
  }, [tenantSync]);

  async function logout() {
    tenantSync.stop();
    try {
      await api.logout();
    } catch {
      // サーバー側 revoke の失敗とローカル資格情報の破棄は独立の関心 — ローカルは必ず破棄する
    }
    tokens.clear();
    queryClient.clear();
    await navigate({ to: "/login" });
  }

  return (
    <div {...stylex.props(styles.shell)}>
      <nav {...stylex.props(styles.sidebar)} aria-label="メインナビゲーション">
        <span {...stylex.props(styles.brand)}>plyrs</span>
        {slots.get("nav:item").map((item) => (
          <UntypedLink
            key={item.id}
            to={item.to}
            params={{ tenantSlug }}
            className={stylex.props(styles.navLink).className ?? ""}
          >
            {item.label}
          </UntypedLink>
        ))}
      </nav>
      <div {...stylex.props(styles.main)}>
        <header {...stylex.props(styles.header)}>
          <Link to="/tenants" {...stylex.props(styles.tenantLink)}>
            {tenant.name}（テナント切替）
          </Link>
          <div {...stylex.props(styles.headerSide)}>
            <span {...stylex.props(styles.syncStatus)}>
              同期: {SYNC_STATUS_LABELS[syncStatus]}
            </span>
            {syncStatus === "closed" && (
              <Button variant="secondary" onPress={() => tenantSync.start()}>
                再接続
              </Button>
            )}
            <Button variant="secondary" onPress={() => void logout()}>
              ログアウト
            </Button>
          </div>
        </header>
        <main {...stylex.props(styles.content)}>
          <TenantSyncProvider sync={tenantSync}>
            <Outlet />
          </TenantSyncProvider>
        </main>
      </div>
    </div>
  );
}
```

- [ ] **Step 10: 既存シェルテストを connect スタブ化し、インジケータのテストを追加**

`apps/admin/src/shell.test.tsx` の `renderAt` を更新(pendingConnect を注入。jsdom から実 WebSocket を張らない):

```tsx
import { FakeSocket, pendingConnect } from "./test-utils/fake-socket";
// renderAt を差し替え:
function renderAt(
  path: string,
  routes: Record<string, Handler>,
  connect: () => Promise<import("@plyrs/sync-client").WebSocketLike> = pendingConnect,
) {
  const router = getRouter({
    context: createAppContext(stubFetch(routes), { connect: () => () => connect() }),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  render(<RouterProvider router={router} />);
  return router;
}
```

describe 末尾にテスト追加:

```tsx
  it("shows the sync status indicator while connecting", async () => {
    renderAt("/t/blog/content-types", authedRoutes());
    expect(await screen.findByText(/同期: 接続中/)).toBeInTheDocument();
  });

  it("offers a reconnect button when the sync connection is lost", async () => {
    let socket: FakeSocket | undefined;
    const connects: number[] = [];
    renderAt("/t/blog/content-types", authedRoutes(), async () => {
      connects.push(connects.length);
      socket = new FakeSocket();
      return socket;
    });
    expect(await screen.findByText(/同期: 同期中/)).toBeInTheDocument();
    // 正常クローズ → エンジンは再接続を試み、失敗が続くと closed に落ちる。
    // ここでは接続関数を 1 回で止めるため 4003（blocked）で確定拒否させる。
    socket?.emit("close", { code: 4003, reason: "blocked" });
    expect(await screen.findByRole("button", { name: "再接続" })).toBeInTheDocument();
    const before = connects.length;
    await userEvent.setup().click(screen.getByRole("button", { name: "再接続" }));
    await vi.waitFor(() => expect(connects.length).toBe(before + 1));
  });
```

(`vi` の import は既存行にある。`import { vi } from "vitest"` 済み。)

- [ ] **Step 11: admin 全テスト + typecheck / lint / format**

Run: `pnpm --filter @plyrs/admin test && pnpm --filter @plyrs/admin typecheck && pnpm lint && pnpm format:check`
Expected: all green / clean

- [ ] **Step 12: Commit**

```bash
git add pnpm-workspace.yaml pnpm-lock.yaml apps/admin/package.json apps/admin/src/lib/sync.ts apps/admin/src/lib/sync.test.ts apps/admin/src/lib/sync-context.tsx apps/admin/src/lib/use-collection.ts apps/admin/src/test-utils/fake-socket.ts apps/admin/src/router.tsx apps/admin/src/routes/t/\$tenantSlug/route.tsx apps/admin/src/shell.test.tsx
git commit -m "feat: wire sync engine into tenant shell"
```

---

### Task 7: record フォームの値変換層(draft ⇄ input)

動的フォームの状態は「draft 値」(文字列中心の UI 表現)で持ち、送信時に metamodel の input 形式へ変換して `buildRecordInputSchema` で検証する。richtext は不透明に透過(裁定 1)、未知キー・型定義から消えたキーは保持(遅延適合 = design-spec §4.2)。

**Files:**
- Create: `apps/admin/src/lib/record-form-values.ts`
- Create: `apps/admin/src/lib/record-form-values.test.ts`

**Interfaces:**
- Consumes: `ContentTypeDefinition` / `buildRecordInputSchema`(@plyrs/metamodel)
- Produces:
  - `type DraftValues = Record<string, unknown>`
  - `relationDraftKey(ref: { type: string; id: string }): string` / `parseRelationDraftKey(key: string): { type: string; id: string } | null`
  - `toDraftValues(contentType: ContentTypeDefinition, input: Record<string, unknown>): DraftValues`
  - `fromDraftValues(contentType, draft: DraftValues, baseInput: Record<string, unknown>): { ok: true; input: Record<string, unknown> } | { ok: false; fieldErrors: Record<string, string> }`

- [ ] **Step 1: 失敗するテストを書く**

`apps/admin/src/lib/record-form-values.test.ts`:

```ts
import type { ContentTypeDefinition } from "@plyrs/metamodel";
import { describe, expect, it } from "vitest";
import {
  fromDraftValues,
  parseRelationDraftKey,
  relationDraftKey,
  toDraftValues,
} from "./record-form-values";

const contentType: ContentTypeDefinition = {
  id: "018f2b6a-7a0a-7000-8000-000000000001",
  key: "article",
  name: "記事",
  source: "user",
  version: 1,
  fields: [
    { key: "title", type: "text", required: true },
    { key: "count", type: "number", config: { integer: true } },
    { key: "featured", type: "boolean" },
    { key: "published_at", type: "datetime" },
    { key: "meta", type: "json" },
    {
      key: "tags",
      type: "select",
      config: {
        options: [
          { value: "tech", label: "Tech" },
          { value: "life", label: "Life" },
        ],
        multiple: true,
      },
    },
    { key: "body", type: "richtext" },
    {
      key: "authors",
      type: "relation",
      config: { allowedTypes: ["author"], cardinality: "many", ordered: true },
    },
    {
      key: "hero",
      type: "relation",
      config: { allowedTypes: ["asset"], cardinality: "one" },
    },
  ],
};

const authorRef = { type: "author", id: "018f2b6a-7a0a-7000-8000-000000000002" };
const heroRef = { type: "asset", id: "018f2b6a-7a0a-7000-8000-000000000003" };

describe("relationDraftKey", () => {
  it("round-trips a relation ref", () => {
    expect(parseRelationDraftKey(relationDraftKey(authorRef))).toStrictEqual(authorRef);
  });

  it("rejects malformed keys", () => {
    expect(parseRelationDraftKey("no-separator")).toBeNull();
    expect(parseRelationDraftKey("id-only")).toBeNull();
  });
});

describe("toDraftValues", () => {
  it("maps input values to UI drafts per field type", () => {
    const draft = toDraftValues(contentType, {
      title: "hello",
      count: 3,
      featured: true,
      published_at: "2026-07-17T00:00:00Z",
      meta: { a: 1 },
      tags: ["tech"],
      body: { schemaVersion: 1, doc: {} },
      authors: [authorRef],
      hero: heroRef,
    });
    expect(draft["title"]).toBe("hello");
    expect(draft["count"]).toBe("3");
    expect(draft["featured"]).toBe(true);
    expect(draft["published_at"]).toBe("2026-07-17T00:00:00Z");
    expect(draft["meta"]).toBe(JSON.stringify({ a: 1 }, null, 2));
    expect(draft["tags"]).toStrictEqual(["tech"]);
    expect(draft["body"]).toStrictEqual({ schemaVersion: 1, doc: {} });
    expect(draft["authors"]).toStrictEqual([relationDraftKey(authorRef)]);
    expect(draft["hero"]).toBe(relationDraftKey(heroRef));
  });

  it("maps absent values to empty drafts", () => {
    const draft = toDraftValues(contentType, {});
    expect(draft["title"]).toBe("");
    expect(draft["count"]).toBe("");
    expect(draft["featured"]).toBe(false);
    expect(draft["meta"]).toBe("");
    expect(draft["tags"]).toStrictEqual([]);
    expect(draft["authors"]).toStrictEqual([]);
    expect(draft["hero"]).toBe("");
  });
});

describe("fromDraftValues", () => {
  const fullDraft = () =>
    toDraftValues(contentType, {
      title: "hello",
      count: 3,
      featured: false,
      tags: ["tech"],
      authors: [authorRef],
    });

  it("converts drafts back into a valid input", () => {
    const result = fromDraftValues(contentType, fullDraft(), {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.input).toStrictEqual({
      title: "hello",
      count: 3,
      featured: false,
      tags: ["tech"],
      authors: [authorRef],
    });
  });

  it("omits empty optional values instead of writing empty strings", () => {
    const result = fromDraftValues(contentType, fullDraft(), {});
    if (!result.ok) throw new Error("expected ok");
    expect("published_at" in result.input).toBe(false);
    expect("meta" in result.input).toBe(false);
    expect("hero" in result.input).toBe(false);
  });

  it("preserves unknown keys and richtext from the base input (遅延適合 §4.2)", () => {
    const base = {
      legacy_field: "keep me",
      body: { schemaVersion: 1, doc: { type: "doc" } },
    };
    const result = fromDraftValues(contentType, fullDraft(), base);
    if (!result.ok) throw new Error("expected ok");
    expect(result.input["legacy_field"]).toBe("keep me");
    expect(result.input["body"]).toStrictEqual({ schemaVersion: 1, doc: { type: "doc" } });
  });

  it("reports parse errors per field before schema validation", () => {
    const draft = { ...fullDraft(), count: "abc", meta: "{broken" };
    const result = fromDraftValues(contentType, draft, {});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.fieldErrors["count"]).toMatch(/数値/);
    expect(result.fieldErrors["meta"]).toMatch(/JSON/);
  });

  it("maps zod issues to field errors (required text)", () => {
    const draft = { ...fullDraft(), title: "" };
    const result = fromDraftValues(contentType, draft, {});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.fieldErrors["title"]).toBeDefined();
  });

  it("rejects a non-Z datetime through the schema", () => {
    const draft = { ...fullDraft(), published_at: "2026-07-17T09:00:00+09:00" };
    const result = fromDraftValues(contentType, draft, {});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.fieldErrors["published_at"]).toBeDefined();
  });
});
```

- [ ] **Step 2: テストが FAIL することを確認**

Run: `pnpm --filter @plyrs/admin test -- src/lib/record-form-values.test.ts`
Expected: FAIL(モジュール未定義)

- [ ] **Step 3: record-form-values.ts を実装**

`apps/admin/src/lib/record-form-values.ts`:

```ts
import { buildRecordInputSchema, type ContentTypeDefinition } from "@plyrs/metamodel";

// 動的フォームの UI 状態（draft）と records の input 形式の変換層。
// - draft: text/number/datetime/json は string、boolean は boolean、
//   multiple-select / many-relation は string[]、one-relation は合成キー string、
//   richtext は不透明値（編集しない — 裁定 1）。
// - 空 draft は「キーを省略」に写す（空文字列を書き込まない）。
// - baseInput の未知キー・richtext は保持（遅延適合 = design-spec §4.2）。
export type DraftValues = Record<string, unknown>;

// type key（snake_case）にも UUID にも現れない Unit Separator（U+001F）を区切りに使う
const RELATION_KEY_SEPARATOR = "\u001f";

export function relationDraftKey(ref: { type: string; id: string }): string {
  return `${ref.type}${RELATION_KEY_SEPARATOR}${ref.id}`;
}

export function parseRelationDraftKey(key: string): { type: string; id: string } | null {
  const index = key.indexOf(RELATION_KEY_SEPARATOR);
  if (index <= 0 || index === key.length - 1) {
    return null;
  }
  return { type: key.slice(0, index), id: key.slice(index + 1) };
}

function isRelationRef(value: unknown): value is { type: string; id: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { type?: unknown }).type === "string" &&
    typeof (value as { id?: unknown }).id === "string"
  );
}

export function toDraftValues(
  contentType: ContentTypeDefinition,
  input: Record<string, unknown>,
): DraftValues {
  const draft: DraftValues = {};
  for (const field of contentType.fields) {
    const value = input[field.key];
    switch (field.type) {
      case "text":
      case "datetime":
        draft[field.key] = typeof value === "string" ? value : "";
        break;
      case "number":
        draft[field.key] = typeof value === "number" ? String(value) : "";
        break;
      case "boolean":
        draft[field.key] = value === true;
        break;
      case "json":
        draft[field.key] = value === undefined ? "" : JSON.stringify(value, null, 2);
        break;
      case "select":
        if (field.config.multiple === true) {
          draft[field.key] = Array.isArray(value)
            ? value.filter((entry): entry is string => typeof entry === "string")
            : [];
        } else {
          draft[field.key] = typeof value === "string" ? value : "";
        }
        break;
      case "richtext":
        draft[field.key] = value;
        break;
      case "relation":
        if (field.config.cardinality === "many") {
          draft[field.key] = Array.isArray(value)
            ? value.filter(isRelationRef).map(relationDraftKey)
            : [];
        } else {
          draft[field.key] = isRelationRef(value) ? relationDraftKey(value) : "";
        }
        break;
    }
  }
  return draft;
}

export type FromDraftResult =
  | { ok: true; input: Record<string, unknown> }
  | { ok: false; fieldErrors: Record<string, string> };

export function fromDraftValues(
  contentType: ContentTypeDefinition,
  draft: DraftValues,
  baseInput: Record<string, unknown>,
): FromDraftResult {
  // baseInput が土台: 未知キー・型定義から消えたキー・richtext がここから引き継がれる
  const input: Record<string, unknown> = { ...baseInput };
  const fieldErrors: Record<string, string> = {};

  const setOrOmit = (key: string, value: unknown, empty: boolean) => {
    if (empty) {
      delete input[key];
    } else {
      input[key] = value;
    }
  };

  for (const field of contentType.fields) {
    const value = draft[field.key];
    switch (field.type) {
      case "text":
      case "datetime": {
        const text = typeof value === "string" ? value : "";
        setOrOmit(field.key, text, text === "");
        break;
      }
      case "number": {
        const text = typeof value === "string" ? value.trim() : "";
        if (text === "") {
          delete input[field.key];
          break;
        }
        const parsed = Number(text);
        if (Number.isNaN(parsed)) {
          fieldErrors[field.key] = "数値として解釈できません";
          break;
        }
        input[field.key] = parsed;
        break;
      }
      case "boolean":
        input[field.key] = value === true;
        break;
      case "json": {
        const text = typeof value === "string" ? value.trim() : "";
        if (text === "") {
          delete input[field.key];
          break;
        }
        try {
          input[field.key] = JSON.parse(text) as unknown;
        } catch {
          fieldErrors[field.key] = "JSON として解釈できません";
        }
        break;
      }
      case "select": {
        if (field.config.multiple === true) {
          const values = Array.isArray(value)
            ? value.filter((entry): entry is string => typeof entry === "string")
            : [];
          setOrOmit(field.key, values, values.length === 0);
        } else {
          const text = typeof value === "string" ? value : "";
          setOrOmit(field.key, text, text === "");
        }
        break;
      }
      case "richtext":
        // 裁定 1: richtext は編集しない。baseInput の値がそのまま残る。
        break;
      case "relation": {
        if (field.config.cardinality === "many") {
          const keys = Array.isArray(value) ? value : [];
          const refs = keys
            .map((key) => (typeof key === "string" ? parseRelationDraftKey(key) : null))
            .filter((ref): ref is { type: string; id: string } => ref !== null);
          setOrOmit(field.key, refs, refs.length === 0);
        } else {
          const ref =
            typeof value === "string" && value !== "" ? parseRelationDraftKey(value) : null;
          setOrOmit(field.key, ref, ref === null);
        }
        break;
      }
    }
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, fieldErrors };
  }

  const parsed = buildRecordInputSchema(contentType).safeParse(input);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "");
      if (key !== "" && fieldErrors[key] === undefined) {
        fieldErrors[key] = issue.message;
      }
    }
    return {
      ok: false,
      fieldErrors:
        Object.keys(fieldErrors).length > 0
          ? fieldErrors
          : { "": "入力を検証できませんでした" },
    };
  }
  return { ok: true, input: parsed.data };
}
```

- [ ] **Step 4: テストが PASS することを確認**

Run: `pnpm --filter @plyrs/admin test -- src/lib/record-form-values.test.ts && pnpm --filter @plyrs/admin typecheck && pnpm lint && pnpm format:check`
Expected: all green / clean

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/lib/record-form-values.ts apps/admin/src/lib/record-form-values.test.ts
git commit -m "feat: add record form value conversion"
```

---

### Task 8: メタモデル駆動の動的フォーム(RecordForm)

TanStack Form + Task 7 の変換層で、ContentTypeDefinition から record 編集フォームを組み立てる。richtext は読み取り専用プレースホルダー(裁定 1)、relation は同期コレクション駆動 picker(裁定 2)、エラーバナーは SyncRejectedError 最小表示(裁定 6)。

**Files:**
- Create: `apps/admin/src/components/record-form.tsx`
- Create: `apps/admin/src/components/record-form.test.tsx`

**Interfaces:**
- Consumes: Task 5 の UI 部品、Task 6 の `useRelationCandidates` / `CollectionRegistry`、Task 7 の変換層、`SyncRejectedError`(@plyrs/sync-client)、`useForm`(@tanstack/react-form)
- Produces:
  - `RecordForm({ contentType, types, registry, record, submitLabel, onSubmit })` — `record: SyncRecord | null`(null = 新規)。`onSubmit(input: Record<string, unknown>): Promise<void>`(throw したら syncErrorMessage でバナー表示)
  - `labelForRecord(types: ContentTypeDefinition[], record: SyncRecord): string`(export。一覧・picker 共用)
  - `syncErrorMessage(cause: unknown): string`(export)

- [ ] **Step 1: 失敗するテストを書く**

`apps/admin/src/components/record-form.test.tsx`(registry は実物を FakeSocket なしで組む — applyStoreChange で直接シードする):

```tsx
import type { ContentTypeDefinition } from "@plyrs/metamodel";
import type { SyncRecord } from "@plyrs/sync-protocol";
import { SyncEngine } from "@plyrs/sync-client";
import { CollectionRegistry } from "@plyrs/sync-client/tanstack";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { pendingConnect } from "../test-utils/fake-socket";
import { relationDraftKey } from "../lib/record-form-values";
import { RecordForm, labelForRecord, syncErrorMessage } from "./record-form";

const authorType: ContentTypeDefinition = {
  id: "018f2b6a-7a0a-7000-8000-000000000010",
  key: "author",
  name: "著者",
  source: "user",
  version: 1,
  fields: [{ key: "name", type: "text", required: true }],
};

const articleType: ContentTypeDefinition = {
  id: "018f2b6a-7a0a-7000-8000-000000000001",
  key: "article",
  name: "記事",
  source: "user",
  version: 1,
  fields: [
    { key: "title", type: "text", required: true },
    { key: "featured", type: "boolean" },
    {
      key: "category",
      type: "select",
      config: {
        options: [
          { value: "tech", label: "Tech" },
          { value: "life", label: "Life" },
        ],
      },
    },
    { key: "body", type: "richtext" },
    {
      key: "authors",
      type: "relation",
      config: { allowedTypes: ["author"], cardinality: "many", ordered: true },
    },
  ],
};

const types = [articleType, authorType];

function author(id: string, name: string): SyncRecord {
  return {
    id,
    type: "author",
    input: { name },
    fieldVersions: { name: 1 },
    status: "draft",
    seq: 1,
    version: 1,
    deletedAt: null,
    updatedAt: "2026-07-17T00:00:00Z",
    updatedBy: "u1",
  };
}

function buildRegistry(): CollectionRegistry {
  const engine = new SyncEngine({ connect: pendingConnect });
  const registry = new CollectionRegistry(engine);
  registry.sync(types);
  registry.markReady();
  registry.applyStoreChange({
    kind: "upsert",
    record: author("018f2b6a-7a0a-7000-8000-000000000011", "山田"),
  });
  return registry;
}

describe("RecordForm", () => {
  it("renders inputs per field type with a read-only richtext placeholder", () => {
    render(
      <RecordForm
        contentType={articleType}
        types={types}
        registry={buildRegistry()}
        record={null}
        submitLabel="保存"
        onSubmit={async () => {}}
      />,
    );
    expect(screen.getByRole("textbox", { name: "title" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "featured" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /category/ })).toBeInTheDocument();
    expect(screen.getByText(/リッチテキスト（Phase 7 で編集できるようになります）/)).toBeInTheDocument();
    // relation picker: 候補（山田）がチェックボックスで出る
    expect(screen.getByRole("checkbox", { name: /山田/ })).toBeInTheDocument();
  });

  it("submits the converted input", async () => {
    const onSubmit = vi.fn(async () => {});
    render(
      <RecordForm
        contentType={articleType}
        types={types}
        registry={buildRegistry()}
        record={null}
        submitLabel="保存"
        onSubmit={onSubmit}
      />,
    );
    const user = userEvent.setup();
    await user.type(screen.getByRole("textbox", { name: "title" }), "hello");
    await user.click(screen.getByRole("checkbox", { name: /山田/ }));
    await user.click(screen.getByRole("button", { name: "保存" }));
    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0]?.[0]).toStrictEqual({
      title: "hello",
      featured: false,
      authors: [{ type: "author", id: "018f2b6a-7a0a-7000-8000-000000000011" }],
    });
  });

  it("shows a field error for a required text left empty and does not submit", async () => {
    const onSubmit = vi.fn(async () => {});
    render(
      <RecordForm
        contentType={articleType}
        types={types}
        registry={buildRegistry()}
        record={null}
        submitLabel="保存"
        onSubmit={onSubmit}
      />,
    );
    await userEvent.setup().click(screen.getByRole("button", { name: "保存" }));
    expect(await screen.findAllByText(/(必須|least|small|short)/i)).not.toHaveLength(0);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("surfaces onSubmit failures as an error banner (裁定 6 最小表現)", async () => {
    const onSubmit = vi.fn(async () => {
      throw Object.assign(new Error("title: too long"), {
        name: "SyncRejectedError",
        code: "validation_failed",
        conflicts: [],
      });
    });
    render(
      <RecordForm
        contentType={articleType}
        types={types}
        registry={buildRegistry()}
        record={null}
        submitLabel="保存"
        onSubmit={onSubmit}
      />,
    );
    const user = userEvent.setup();
    await user.type(screen.getByRole("textbox", { name: "title" }), "x");
    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/保存できませんでした/);
  });
});

describe("labelForRecord", () => {
  it("uses the first text field value and falls back to the id", () => {
    expect(labelForRecord(types, author("a1", "山田"))).toBe("山田");
    const noName = author("018f2b6a-7a0a-7000-8000-000000000012", "");
    expect(labelForRecord(types, { ...noName, input: {} })).toMatch(/^018f2b6a/);
  });
});

describe("syncErrorMessage", () => {
  it("formats SyncRejectedError with its code", () => {
    const error = Object.assign(new Error("boom"), {
      name: "SyncRejectedError",
      code: "unique_violation",
      conflicts: [],
    });
    expect(syncErrorMessage(error)).toMatch(/unique_violation/);
  });

  it("falls back for unknown errors", () => {
    expect(syncErrorMessage(new Error("x"))).toMatch(/保存できませんでした/);
  });
});
```

**注意:** バナーの `role="alert"` 要素はフォーム上部に置く。「必須テキスト空」のケースは fromDraftValues → zod の `min(1)` メッセージが出る(文言は zod v4 既定。テストの正規表現が合わなければ**実際のメッセージに合わせて正規表現を直す**こと — 実装側を歪めない)。

- [ ] **Step 2: テストが FAIL することを確認**

Run: `pnpm --filter @plyrs/admin test -- src/components/record-form.test.tsx`
Expected: FAIL(モジュール未定義)

- [ ] **Step 3: RecordForm を実装**

`apps/admin/src/components/record-form.tsx`:

```tsx
import * as stylex from "@stylexjs/stylex";
import { useState } from "react";
import { useForm } from "@tanstack/react-form";
import type { ContentTypeDefinition, FieldDefinition } from "@plyrs/metamodel";
import type { SyncRecord } from "@plyrs/sync-protocol";
import { SyncRejectedError } from "@plyrs/sync-client";
import type { CollectionRegistry } from "@plyrs/sync-client/tanstack";
import { Button, Checkbox, CheckboxGroup, Select, TextArea, TextField } from "@plyrs/ui";
import { colors, spacing, typography } from "@plyrs/ui/tokens.stylex";
import {
  fromDraftValues,
  relationDraftKey,
  toDraftValues,
  type DraftValues,
} from "../lib/record-form-values";
import { useRelationCandidates } from "../lib/use-collection";

const styles = stylex.create({
  form: {
    display: "flex",
    flexDirection: "column",
    gap: spacing.md,
    maxWidth: "640px",
    fontFamily: typography.fontFamily,
  },
  banner: {
    padding: spacing.sm,
    borderRadius: "6px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: colors.danger,
    color: colors.danger,
    fontSize: typography.sizeMd,
  },
  richtext: {
    padding: spacing.md,
    borderRadius: "6px",
    borderWidth: "1px",
    borderStyle: "dashed",
    borderColor: colors.border,
    color: colors.textMuted,
    fontSize: typography.sizeMd,
  },
  fieldLabel: { fontSize: typography.sizeSm, color: colors.textMuted },
  fieldError: { fontSize: typography.sizeSm, color: colors.danger },
  actions: { display: "flex", gap: spacing.sm },
});

// 一覧・relation picker 共用: 最初の text フィールド値をラベルに、無ければ id 先頭 8 桁
export function labelForRecord(types: ContentTypeDefinition[], record: SyncRecord): string {
  const definition = types.find((type) => type.key === record.type);
  const firstText = definition?.fields.find((field) => field.type === "text");
  if (firstText !== undefined) {
    const value = record.input[firstText.key];
    if (typeof value === "string" && value !== "") {
      return value;
    }
  }
  return record.id.slice(0, 8);
}

// 裁定 6: 最小のエラーバナー文言。conflict ack は richtext のみで 6b UI からは発生しないが、
// 発生した場合も同じバナーに落ちる（本文競合の解決 UI は Phase 7）。
export function syncErrorMessage(cause: unknown): string {
  if (cause instanceof SyncRejectedError || (cause instanceof Error && cause.name === "SyncRejectedError")) {
    const code = (cause as { code?: string }).code ?? "unknown";
    return `保存できませんでした（${code}）: ${cause.message}`;
  }
  return "保存できませんでした。接続状態を確認して再試行してください。";
}

export interface RecordFormProps {
  contentType: ContentTypeDefinition;
  types: ContentTypeDefinition[];
  registry: CollectionRegistry;
  /** null = 新規作成 */
  record: SyncRecord | null;
  submitLabel: string;
  onSubmit: (input: Record<string, unknown>) => Promise<void>;
}

export function RecordForm({
  contentType,
  types,
  registry,
  record,
  submitLabel,
  onSubmit,
}: RecordFormProps) {
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<string | null>(null);
  const form = useForm({
    defaultValues: toDraftValues(contentType, record?.input ?? {}),
    onSubmit: async ({ value }) => {
      setBanner(null);
      const converted = fromDraftValues(contentType, value, record?.input ?? {});
      if (!converted.ok) {
        setFieldErrors(converted.fieldErrors);
        const formLevel = converted.fieldErrors[""];
        if (formLevel !== undefined) {
          setBanner(formLevel);
        }
        return;
      }
      setFieldErrors({});
      try {
        await onSubmit(converted.input);
      } catch (cause) {
        setBanner(syncErrorMessage(cause));
      }
    },
  });

  return (
    <form
      {...stylex.props(styles.form)}
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      {banner !== null && (
        <div role="alert" {...stylex.props(styles.banner)}>
          {banner}
        </div>
      )}
      {contentType.fields.map((field) => (
        <form.Field key={field.key} name={field.key}>
          {(api) => (
            <FieldInput
              field={field}
              value={api.state.value}
              onChange={(next) => api.handleChange(next)}
              error={fieldErrors[field.key]}
              types={types}
              registry={registry}
            />
          )}
        </form.Field>
      ))}
      <div {...stylex.props(styles.actions)}>
        <Button type="submit">{submitLabel}</Button>
      </div>
    </form>
  );
}

function FieldInput({
  field,
  value,
  onChange,
  error,
  types,
  registry,
}: {
  field: FieldDefinition;
  value: unknown;
  onChange: (next: unknown) => void;
  error: string | undefined;
  types: ContentTypeDefinition[];
  registry: CollectionRegistry;
}) {
  switch (field.type) {
    case "text":
      return (
        <TextField
          label={field.key}
          value={typeof value === "string" ? value : ""}
          onChange={onChange}
          isRequired={field.required ?? false}
          isInvalid={error !== undefined}
          errorMessage={error}
        />
      );
    case "number":
      return (
        <TextField
          label={field.key}
          value={typeof value === "string" ? value : ""}
          onChange={onChange}
          inputMode="numeric"
          isInvalid={error !== undefined}
          errorMessage={error}
        />
      );
    case "datetime":
      return (
        <TextField
          label={field.key}
          value={typeof value === "string" ? value : ""}
          onChange={onChange}
          // design-spec §5: 格納は UTC ISO8601（'Z' 終端）。表示層の TZ 変換は将来課題。
          // 6b は素の ISO 文字列入力（date-fns の picker 化は Phase 7 以降の磨き込み）。
          isInvalid={error !== undefined}
          errorMessage={error}
        />
      );
    case "boolean":
      return (
        <Checkbox isSelected={value === true} onChange={onChange}>
          {field.key}
        </Checkbox>
      );
    case "json":
      return (
        <TextArea
          label={field.key}
          value={typeof value === "string" ? value : ""}
          onChange={onChange}
          isInvalid={error !== undefined}
          errorMessage={error}
        />
      );
    case "select": {
      const options = field.config.options.map((option) => ({
        value: option.value,
        label: option.label,
      }));
      if (field.config.multiple === true) {
        return (
          <CheckboxGroup
            label={field.key}
            options={options}
            value={Array.isArray(value) ? (value as string[]) : []}
            onChange={onChange}
            errorMessage={error}
          />
        );
      }
      return (
        <Select
          label={field.key}
          items={options}
          selectedValue={typeof value === "string" ? value : ""}
          onChange={onChange}
          placeholder="(未設定)"
          errorMessage={error}
        />
      );
    }
    case "richtext":
      return (
        <div>
          <span {...stylex.props(styles.fieldLabel)}>{field.key}</span>
          <div {...stylex.props(styles.richtext)}>
            リッチテキスト（Phase 7 で編集できるようになります）
            {value !== undefined && value !== "" ? " — 既存の本文は保存時にそのまま保持されます" : ""}
          </div>
        </div>
      );
    case "relation":
      return (
        <RelationPicker
          field={field}
          value={value}
          onChange={onChange}
          error={error}
          types={types}
          registry={registry}
        />
      );
  }
}

function RelationPicker({
  field,
  value,
  onChange,
  error,
  types,
  registry,
}: {
  field: Extract<FieldDefinition, { type: "relation" }>;
  value: unknown;
  onChange: (next: unknown) => void;
  error: string | undefined;
  types: ContentTypeDefinition[];
  registry: CollectionRegistry;
}) {
  const candidates = useRelationCandidates(registry, field.config.allowedTypes);
  const options = candidates.map((candidate) => ({
    value: relationDraftKey({ type: candidate.type, id: candidate.id }),
    label: labelForRecord(types, candidate),
  }));
  if (candidates.length === 0) {
    return (
      <div>
        <span {...stylex.props(styles.fieldLabel)}>{field.key}</span>
        <div {...stylex.props(styles.richtext)}>
          参照できるレコードがありません（許可型: {field.config.allowedTypes.join(", ")}）
        </div>
        {error !== undefined && <span {...stylex.props(styles.fieldError)}>{error}</span>}
      </div>
    );
  }
  if (field.config.cardinality === "many") {
    return (
      <CheckboxGroup
        label={field.key}
        options={options}
        value={Array.isArray(value) ? (value as string[]) : []}
        onChange={onChange}
        errorMessage={error}
      />
    );
  }
  return (
    <Select
      label={field.key}
      items={options}
      selectedValue={typeof value === "string" ? value : ""}
      onChange={onChange}
      placeholder="(未設定)"
      errorMessage={error}
    />
  );
}
```

**実装注意(型):**
- `form.Field` の `name` に動的キーを渡すと TS 7.0.2 で DeepKeys が解決できない場合がある。その場合のみ `name={field.key as never}` ではなく、`DraftValues` を `Record<string, unknown>` として `useForm<DraftValues, ...>` の型引数を明示するか、`name={field.key as keyof DraftValues & string}` の**境界 cast + 理由コメント**(rpc-unwrap 様式)で解決する。`any` / `@ts-expect-error` は禁止。
- `api.handleChange` の引数型が `unknown` と合わない場合も同様に境界 cast で `onChange={(next) => api.handleChange(next as typeof api.state.value)}` 形に寄せる。
- TextField(packages/ui)に `value` / `onChange` / `isRequired` / `isInvalid` / `inputMode` を渡している。既存 TextFieldProps は RacTextFieldProps 継承なので `value` / `onChange` / `isRequired` / `isInvalid` は通るが、**`inputMode` は RAC の TextField ではなく Input 側の属性**のため通らない場合がある。通らなければ TextFieldProps に `inputMode?: "numeric"` を追加して Input へ転送する(packages/ui の変更として記録し、そのテストも button.test.tsx の様式で 1 本足す)。

- [ ] **Step 4: テストが PASS することを確認**

Run: `pnpm --filter @plyrs/admin test -- src/components/record-form.test.tsx && pnpm --filter @plyrs/admin typecheck && pnpm lint && pnpm format:check`
Expected: all green / clean

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/components/record-form.tsx apps/admin/src/components/record-form.test.tsx packages/ui/src
git commit -m "feat: add metamodel-driven record form"
```

---

### Task 9: content_type ビルダー(新規 + 既存編集)

裁定 3: 新規作成 + 既存編集。PUT は upsert、version はサーバー管理。key は新規のみ編集可。フィールドは FieldDraft の行 UI(追加/削除)で編集し、select の選択肢は「1 行 1 選択肢 `value=ラベル`」の textarea(6b の暫定 UI。行 UI 化は将来の磨き込み)。

**Files:**
- Create: `apps/admin/src/lib/content-type-form.ts`
- Create: `apps/admin/src/lib/content-type-form.test.ts`
- Create: `apps/admin/src/components/content-type-form.tsx`
- Delete/Move: `apps/admin/src/routes/t/$tenantSlug/content-types.tsx` → `apps/admin/src/routes/t/$tenantSlug/content-types/index.tsx`
- Create: `apps/admin/src/routes/t/$tenantSlug/content-types/new.tsx`
- Create: `apps/admin/src/routes/t/$tenantSlug/content-types/$typeKey.edit.tsx`
- Create: `apps/admin/src/content-type-builder.test.tsx`(ルートテスト。routes/ の外)
- Regenerate: `apps/admin/src/routeTree.gen.ts`(コントローラが `pnpm --filter @plyrs/admin build` を sandbox 無効で実行)

**Interfaces:**
- Consumes: Task 4 の `putContentType` / `ContentTypeSummary`、Task 5 の UI 部品、`fieldDefinitionSchema` / `contentTypeDefinitionSchema` / `FIELD_KEY_PATTERN`(@plyrs/metamodel)、`uuid` の v7
- Produces:
  - `interface FieldDraft { key: string; type: FieldDefinition["type"]; required: boolean; maxLength: string; integer: boolean; optionsText: string; multiple: boolean; allowedTypes: string; cardinality: "one" | "many"; ordered: boolean; indexed: boolean; unique: boolean }`(allowedTypes はカンマ区切り文字列)
  - `emptyFieldDraft(): FieldDraft` / `toFieldDraft(field: FieldDefinition): FieldDraft`
  - `buildDefinition(args: { id: string; key: string; name: string; drafts: FieldDraft[]; version: number }): { ok: true; definition: ContentTypeDefinition } | { ok: false; errors: string[] }`
  - `summaryToDefinition(row: ContentTypeSummary): ContentTypeDefinition`
  - `ContentTypeForm({ existing, existingTypes, onSubmit })` コンポーネント

- [ ] **Step 1: 変換層の失敗するテストを書く**

`apps/admin/src/lib/content-type-form.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { FieldDefinition } from "@plyrs/metamodel";
import {
  buildDefinition,
  emptyFieldDraft,
  summaryToDefinition,
  toFieldDraft,
} from "./content-type-form";

const uuid = "018f2b6a-7a0a-7000-8000-000000000001";

describe("toFieldDraft / buildDefinition round-trip", () => {
  const fields: FieldDefinition[] = [
    { key: "title", type: "text", required: true, config: { maxLength: 200, unique: true } },
    { key: "count", type: "number", config: { integer: true, indexed: true } },
    { key: "featured", type: "boolean", config: { indexed: true } },
    { key: "published_at", type: "datetime", config: { indexed: true } },
    { key: "meta", type: "json" },
    {
      key: "tags",
      type: "select",
      config: {
        options: [
          { value: "tech", label: "Tech" },
          { value: "life", label: "Life" },
        ],
        multiple: true,
        indexed: true,
      },
    },
    { key: "body", type: "richtext" },
    {
      key: "authors",
      type: "relation",
      required: true,
      config: { allowedTypes: ["author", "team"], cardinality: "many", ordered: true },
    },
  ];

  it("survives a full round-trip for every palette type", () => {
    const drafts = fields.map(toFieldDraft);
    const result = buildDefinition({ id: uuid, key: "article", name: "記事", drafts, version: 1 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.definition.fields).toStrictEqual(fields);
    expect(result.definition).toMatchObject({ id: uuid, key: "article", source: "user", version: 1 });
  });

  it("parses select options from 'value=label' lines and defaults label to value", () => {
    const draft = { ...emptyFieldDraft(), key: "tags", type: "select" as const, optionsText: "tech=Tech\nlife" };
    const result = buildDefinition({ id: uuid, key: "t", name: "T", drafts: [draft], version: 1 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const field = result.definition.fields[0];
    expect(field).toMatchObject({
      type: "select",
      config: {
        options: [
          { value: "tech", label: "Tech" },
          { value: "life", label: "life" },
        ],
      },
    });
  });

  it("rejects a select without options", () => {
    const draft = { ...emptyFieldDraft(), key: "tags", type: "select" as const, optionsText: "" };
    const result = buildDefinition({ id: uuid, key: "t", name: "T", drafts: [draft], version: 1 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(" ")).toMatch(/tags/);
  });

  it("rejects a relation without allowed types and parses comma separated types", () => {
    const missing = { ...emptyFieldDraft(), key: "rel", type: "relation" as const, allowedTypes: "" };
    expect(buildDefinition({ id: uuid, key: "t", name: "T", drafts: [missing], version: 1 }).ok).toBe(false);
    const ok = { ...emptyFieldDraft(), key: "rel", type: "relation" as const, allowedTypes: " author , asset " };
    const result = buildDefinition({ id: uuid, key: "t", name: "T", drafts: [ok], version: 1 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.definition.fields[0]).toMatchObject({
      config: { allowedTypes: ["author", "asset"], cardinality: "one" },
    });
  });

  it("rejects duplicate field keys via the content type schema", () => {
    const a = { ...emptyFieldDraft(), key: "dup" };
    const b = { ...emptyFieldDraft(), key: "dup" };
    const result = buildDefinition({ id: uuid, key: "t", name: "T", drafts: [a, b], version: 1 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(" ")).toMatch(/duplicate/);
  });

  it("rejects an invalid number in maxLength", () => {
    const draft = { ...emptyFieldDraft(), key: "title", maxLength: "abc" };
    const result = buildDefinition({ id: uuid, key: "t", name: "T", drafts: [draft], version: 1 });
    expect(result.ok).toBe(false);
  });
});

describe("summaryToDefinition", () => {
  it("drops row-only columns and null pluginId", () => {
    const definition = summaryToDefinition({
      id: uuid,
      key: "article",
      name: "記事",
      fields: [],
      source: "user",
      pluginId: null,
      createdAt: "2026-07-17T00:00:00Z",
      updatedAt: "2026-07-17T00:00:00Z",
      version: 4,
    });
    expect(definition).toStrictEqual({
      id: uuid,
      key: "article",
      name: "記事",
      fields: [],
      source: "user",
      version: 4,
    });
  });
});
```

- [ ] **Step 2: テストが FAIL することを確認**

Run: `pnpm --filter @plyrs/admin test -- src/lib/content-type-form.test.ts`
Expected: FAIL(モジュール未定義)

- [ ] **Step 3: content-type-form.ts(変換層)を実装**

`apps/admin/src/lib/content-type-form.ts`:

```ts
import {
  contentTypeDefinitionSchema,
  type ContentTypeDefinition,
  type FieldDefinition,
} from "@plyrs/metamodel";
import type { ContentTypeSummary } from "./admin-api";

// content_type ビルダーの UI 状態。すべての型のノブを 1 つの平坦な構造で持ち、
// type に応じて必要なものだけ FieldDefinition の config へ写す。
export interface FieldDraft {
  key: string;
  type: FieldDefinition["type"];
  required: boolean;
  maxLength: string;
  integer: boolean;
  /** 1 行 1 選択肢。"value=ラベル"（ラベル省略時は value がラベル） */
  optionsText: string;
  multiple: boolean;
  /** カンマ区切りの type key */
  allowedTypes: string;
  cardinality: "one" | "many";
  ordered: boolean;
  indexed: boolean;
  unique: boolean;
}

export function emptyFieldDraft(): FieldDraft {
  return {
    key: "",
    type: "text",
    required: false,
    maxLength: "",
    integer: false,
    optionsText: "",
    multiple: false,
    allowedTypes: "",
    cardinality: "one",
    ordered: false,
    indexed: false,
    unique: false,
  };
}

export function toFieldDraft(field: FieldDefinition): FieldDraft {
  const draft = emptyFieldDraft();
  draft.key = field.key;
  draft.type = field.type;
  draft.required = field.required ?? false;
  switch (field.type) {
    case "text":
      draft.maxLength = field.config?.maxLength === undefined ? "" : String(field.config.maxLength);
      draft.indexed = field.config?.indexed ?? false;
      draft.unique = field.config?.unique ?? false;
      break;
    case "number":
      draft.integer = field.config?.integer ?? false;
      draft.indexed = field.config?.indexed ?? false;
      draft.unique = field.config?.unique ?? false;
      break;
    case "boolean":
      draft.indexed = field.config?.indexed ?? false;
      break;
    case "datetime":
      draft.indexed = field.config?.indexed ?? false;
      draft.unique = field.config?.unique ?? false;
      break;
    case "json":
    case "richtext":
      break;
    case "select":
      draft.optionsText = field.config.options
        .map((option) =>
          option.label === option.value ? option.value : `${option.value}=${option.label}`,
        )
        .join("\n");
      draft.multiple = field.config.multiple ?? false;
      draft.indexed = field.config.indexed ?? false;
      break;
    case "relation":
      draft.allowedTypes = field.config.allowedTypes.join(", ");
      draft.cardinality = field.config.cardinality;
      draft.ordered = field.config.ordered ?? false;
      break;
  }
  return draft;
}

function compactConfig<T extends Record<string, unknown>>(config: T): T | undefined {
  const entries = Object.entries(config).filter(([, value]) => value !== undefined);
  return entries.length === 0 ? undefined : (Object.fromEntries(entries) as T);
}

function fromFieldDraft(draft: FieldDraft): { ok: true; field: unknown } | { ok: false; error: string } {
  const base = {
    key: draft.key,
    ...(draft.required ? { required: true } : {}),
  };
  const indexed = draft.indexed ? true : undefined;
  const unique = draft.unique ? true : undefined;
  switch (draft.type) {
    case "text": {
      let maxLength: number | undefined;
      if (draft.maxLength.trim() !== "") {
        maxLength = Number(draft.maxLength.trim());
        if (!Number.isInteger(maxLength) || maxLength <= 0) {
          return { ok: false, error: `${draft.key}: maxLength は正の整数で指定してください` };
        }
      }
      const config = compactConfig({ indexed, unique, maxLength });
      return { ok: true, field: { ...base, type: "text", ...(config ? { config } : {}) } };
    }
    case "number": {
      const config = compactConfig({ indexed, unique, integer: draft.integer ? true : undefined });
      return { ok: true, field: { ...base, type: "number", ...(config ? { config } : {}) } };
    }
    case "boolean": {
      const config = compactConfig({ indexed });
      return { ok: true, field: { ...base, type: "boolean", ...(config ? { config } : {}) } };
    }
    case "datetime": {
      const config = compactConfig({ indexed, unique });
      return { ok: true, field: { ...base, type: "datetime", ...(config ? { config } : {}) } };
    }
    case "json":
      return { ok: true, field: { ...base, type: "json" } };
    case "richtext":
      return { ok: true, field: { ...base, type: "richtext" } };
    case "select": {
      const options = draft.optionsText
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line !== "")
        .map((line) => {
          const eq = line.indexOf("=");
          return eq === -1
            ? { value: line, label: line }
            : { value: line.slice(0, eq).trim(), label: line.slice(eq + 1).trim() };
        });
      const config = {
        options,
        ...(draft.multiple ? { multiple: true } : {}),
        ...(indexed !== undefined ? { indexed } : {}),
      };
      return { ok: true, field: { ...base, type: "select", config } };
    }
    case "relation": {
      const allowedTypes = draft.allowedTypes
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry) => entry !== "");
      const config = {
        allowedTypes,
        cardinality: draft.cardinality,
        ...(draft.ordered ? { ordered: true } : {}),
      };
      return { ok: true, field: { ...base, type: "relation", config } };
    }
  }
}

export type BuildDefinitionResult =
  | { ok: true; definition: ContentTypeDefinition }
  | { ok: false; errors: string[] };

export function buildDefinition(args: {
  id: string;
  key: string;
  name: string;
  drafts: FieldDraft[];
  version: number;
}): BuildDefinitionResult {
  const errors: string[] = [];
  const fields: unknown[] = [];
  for (const draft of args.drafts) {
    const converted = fromFieldDraft(draft);
    if (!converted.ok) {
      errors.push(converted.error);
    } else {
      fields.push(converted.field);
    }
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  const parsed = contentTypeDefinitionSchema.safeParse({
    id: args.id,
    key: args.key,
    name: args.name,
    fields,
    source: "user",
    version: args.version,
  });
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
    };
  }
  return { ok: true, definition: parsed.data };
}

// ContentTypeRow（HTTP 応答）→ contentTypeDefinitionSchema 入力（pluginId: null は落とす）
export function summaryToDefinition(row: ContentTypeSummary): ContentTypeDefinition {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    fields: row.fields,
    source: row.source,
    ...(row.pluginId === null ? {} : { pluginId: row.pluginId }),
    version: row.version,
  };
}
```

(`fromFieldDraft` の戻りは `unknown` のまま `contentTypeDefinitionSchema.safeParse` に委ねる — フィールド単位の詳細検証は zod が担い、二重に型を書かない。)

- [ ] **Step 4: 変換層テストが PASS することを確認**

Run: `pnpm --filter @plyrs/admin test -- src/lib/content-type-form.test.ts`
Expected: PASS

- [ ] **Step 5: ビルダーのルートテストを書く(FAIL 確認まで)**

`apps/admin/src/content-type-builder.test.tsx`(shell.test.tsx の renderAt / authedRoutes 様式をこのファイル内に複製。connect は pendingConnect):

```tsx
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, type Mock } from "vitest";
import { createAppContext, getRouter } from "./router";
import { pendingConnect } from "./test-utils/fake-socket";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

type Handler = Mock<(init?: RequestInit) => Response>;

function stubFetch(routes: Record<string, Handler>): typeof fetch {
  return async (input, init) => {
    const path =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.pathname
          : new URL(input.url).pathname;
    const handler = routes[path];
    if (handler === undefined) {
      throw new Error(`unexpected fetch: ${path}`);
    }
    return handler(init ?? undefined);
  };
}

function renderAt(path: string, routes: Record<string, Handler>) {
  const router = getRouter({
    context: createAppContext(stubFetch(routes), { connect: () => pendingConnect }),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  render(<RouterProvider router={router} />);
  return router;
}

const blogTenant = { id: "t1", slug: "blog", name: "Blog", role: "owner" };

const articleRow = {
  id: "018f2b6a-7a0a-7000-8000-000000000001",
  key: "article",
  name: "記事",
  fields: [
    { key: "title", type: "text", required: true },
    { key: "tags", type: "select", config: { options: [{ value: "tech", label: "Tech" }], multiple: true } },
  ],
  source: "user",
  pluginId: null,
  createdAt: "2026-07-16T00:00:00Z",
  updatedAt: "2026-07-16T00:00:00Z",
  version: 2,
};

function authedRoutes(overrides: Record<string, Handler> = {}): Record<string, Handler> {
  return {
    "/auth/tenants": vi.fn(() => jsonResponse(200, { tenants: [blogTenant] })),
    "/auth/token": vi.fn(() => jsonResponse(200, { token: "jwt-abc", expiresIn: 900 })),
    "/v1/t/t1/content-types": vi.fn(() => jsonResponse(200, { contentTypes: [articleRow] })),
    ...overrides,
  };
}

describe("content_type ビルダー", () => {
  it("links from the list to the builder pages", async () => {
    renderAt("/t/blog/content-types", authedRoutes());
    expect(await screen.findByRole("link", { name: "新規コンテンツタイプ" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "編集" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "レコード" })).toBeInTheDocument();
  });

  it("creates a new content type and PUTs the definition", async () => {
    const contentTypesHandler: Handler = vi.fn((init?: RequestInit) =>
      init?.method === "PUT"
        ? jsonResponse(200, { ok: true, contentType: { ...articleRow, key: "author", version: 1 } })
        : jsonResponse(200, { contentTypes: [articleRow] }),
    );
    renderAt(
      "/t/blog/content-types/new",
      authedRoutes({ "/v1/t/t1/content-types": contentTypesHandler }),
    );
    const user = userEvent.setup();
    await user.type(await screen.findByRole("textbox", { name: "key" }), "author");
    await user.type(screen.getByRole("textbox", { name: "表示名" }), "著者");
    await user.click(screen.getByRole("button", { name: "フィールドを追加" }));
    await user.type(screen.getByRole("textbox", { name: "フィールド key" }), "name");
    await user.click(screen.getByRole("button", { name: "保存" }));

    await vi.waitFor(() => {
      const putCall = contentTypesHandler.mock.calls.find(
        (call) => (call[0] as RequestInit | undefined)?.method === "PUT",
      );
      expect(putCall).toBeDefined();
      const body = JSON.parse(String((putCall?.[0] as RequestInit).body)) as {
        key: string;
        name: string;
        source: string;
        version: number;
        fields: { key: string; type: string }[];
        id: string;
      };
      expect(body.key).toBe("author");
      expect(body.name).toBe("著者");
      expect(body.source).toBe("user");
      expect(body.version).toBe(1);
      expect(body.fields).toStrictEqual([{ key: "name", type: "text" }]);
      expect(body.id).toMatch(/^[0-9a-f]{8}-/);
    });
    // 保存後は一覧へ戻る
    expect(await screen.findByRole("heading", { name: "コンテンツタイプ" })).toBeInTheDocument();
  });

  it("prefills the edit form, disables the key, and shows the migration warning", async () => {
    renderAt("/t/blog/content-types/article/edit", authedRoutes());
    const keyInput = await screen.findByRole("textbox", { name: "key" });
    expect(keyInput).toHaveValue("article");
    expect(keyInput).toBeDisabled();
    expect(screen.getByRole("textbox", { name: "表示名" })).toHaveValue("記事");
    // 既存フィールドの draft がプリフィルされる
    expect(screen.getByDisplayValue("title")).toBeInTheDocument();
    expect(screen.getByText(/既存のレコードは自動では追従しません/)).toBeInTheDocument();
  });

  it("sends the current version on edit so the server bumps it", async () => {
    const contentTypesHandler: Handler = vi.fn((init?: RequestInit) =>
      init?.method === "PUT"
        ? jsonResponse(200, { ok: true, contentType: { ...articleRow, version: 3 } })
        : jsonResponse(200, { contentTypes: [articleRow] }),
    );
    renderAt(
      "/t/blog/content-types/article/edit",
      authedRoutes({ "/v1/t/t1/content-types": contentTypesHandler }),
    );
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "保存" }));
    await vi.waitFor(() => {
      const putCall = contentTypesHandler.mock.calls.find(
        (call) => (call[0] as RequestInit | undefined)?.method === "PUT",
      );
      const body = JSON.parse(String((putCall?.[0] as RequestInit).body)) as {
        id: string;
        version: number;
      };
      expect(body.id).toBe(articleRow.id);
      expect(body.version).toBe(2);
    });
  });

  it("shows server rejections in the banner", async () => {
    const contentTypesHandler: Handler = vi.fn((init?: RequestInit) =>
      init?.method === "PUT"
        ? jsonResponse(409, { ok: false, code: "id_mismatch", message: "key taken" })
        : jsonResponse(200, { contentTypes: [articleRow] }),
    );
    renderAt(
      "/t/blog/content-types/article/edit",
      authedRoutes({ "/v1/t/t1/content-types": contentTypesHandler }),
    );
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "保存" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/id_mismatch/);
  });
});
```

Run: `pnpm --filter @plyrs/admin test -- src/content-type-builder.test.tsx`
Expected: FAIL(ルート未定義)

- [ ] **Step 6: ビルダー UI コンポーネントを実装**

`apps/admin/src/components/content-type-form.tsx`:

```tsx
import * as stylex from "@stylexjs/stylex";
import { useState } from "react";
import { v7 as uuidv7 } from "uuid";
import type { ContentTypeDefinition, FieldDefinition } from "@plyrs/metamodel";
import { Button, Checkbox, Select, TextArea, TextField } from "@plyrs/ui";
import { colors, spacing, typography } from "@plyrs/ui/tokens.stylex";
import type { ContentTypeSummary } from "../lib/admin-api";
import {
  buildDefinition,
  emptyFieldDraft,
  toFieldDraft,
  type FieldDraft,
} from "../lib/content-type-form";

const styles = stylex.create({
  form: {
    display: "flex",
    flexDirection: "column",
    gap: spacing.md,
    maxWidth: "720px",
    fontFamily: typography.fontFamily,
  },
  banner: {
    padding: spacing.sm,
    borderRadius: "6px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: colors.danger,
    color: colors.danger,
    fontSize: typography.sizeMd,
    whiteSpace: "pre-wrap",
  },
  warning: {
    padding: spacing.sm,
    borderRadius: "6px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: colors.border,
    backgroundColor: colors.surface,
    color: colors.textMuted,
    fontSize: typography.sizeSm,
  },
  fieldCard: {
    display: "flex",
    flexDirection: "column",
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: "6px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: colors.border,
  },
  fieldRow: { display: "flex", gap: spacing.md, flexWrap: "wrap", alignItems: "flex-end" },
  actions: { display: "flex", gap: spacing.sm },
});

const FIELD_TYPES: { value: FieldDefinition["type"]; label: string }[] = [
  { value: "text", label: "text" },
  { value: "number", label: "number" },
  { value: "boolean", label: "boolean" },
  { value: "datetime", label: "datetime" },
  { value: "json", label: "json" },
  { value: "select", label: "select" },
  { value: "richtext", label: "richtext" },
  { value: "relation", label: "relation" },
];

export interface ContentTypeFormProps {
  /** null = 新規作成 */
  existing: ContentTypeSummary | null;
  onSubmit: (definition: ContentTypeDefinition) => Promise<void>;
}

export function ContentTypeForm({ existing, onSubmit }: ContentTypeFormProps) {
  const [key, setKey] = useState(existing?.key ?? "");
  const [name, setName] = useState(existing?.name ?? "");
  const [drafts, setDrafts] = useState<FieldDraft[]>(
    existing === null ? [] : existing.fields.map(toFieldDraft),
  );
  const [errors, setErrors] = useState<string[]>([]);

  function updateDraft(index: number, patch: Partial<FieldDraft>) {
    setDrafts((current) =>
      current.map((draft, i) => (i === index ? { ...draft, ...patch } : draft)),
    );
  }

  async function handleSubmit() {
    const result = buildDefinition({
      // 裁定 3: key は id に対して不変（key_mismatch 409）。id は新規のみクライアント生成。
      id: existing?.id ?? uuidv7(),
      key,
      name,
      drafts,
      // version はサーバー管理（registerContentTypeCore が prev.version + 1 を採る）。
      // スキーマが positive int を要求するため現行値（新規は 1）を運ぶだけ。
      version: existing?.version ?? 1,
    });
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors([]);
    try {
      await onSubmit(result.definition);
    } catch (cause) {
      setErrors([cause instanceof Error ? cause.message : String(cause)]);
    }
  }

  return (
    <div {...stylex.props(styles.form)}>
      {errors.length > 0 && (
        <div role="alert" {...stylex.props(styles.banner)}>
          {errors.join("\n")}
        </div>
      )}
      {existing !== null && (
        <p {...stylex.props(styles.warning)}>
          既存のレコードは自動では追従しません（読み取りは寛容・書き込み時に現行定義で検証 =
          遅延適合）。フィールドの削除・型変更は値を移行しません。key の変更は削除 + 追加として
          扱われます。
        </p>
      )}
      <TextField label="key" value={key} onChange={setKey} isDisabled={existing !== null} />
      <TextField label="表示名" value={name} onChange={setName} />
      {drafts.map((draft, index) => (
        <FieldDraftCard
          key={index}
          draft={draft}
          onChange={(patch) => updateDraft(index, patch)}
          onRemove={() => setDrafts((current) => current.filter((_, i) => i !== index))}
        />
      ))}
      <div {...stylex.props(styles.actions)}>
        <Button
          variant="secondary"
          onPress={() => setDrafts((current) => [...current, emptyFieldDraft()])}
        >
          フィールドを追加
        </Button>
        <Button onPress={() => void handleSubmit()}>保存</Button>
      </div>
    </div>
  );
}

function FieldDraftCard({
  draft,
  onChange,
  onRemove,
}: {
  draft: FieldDraft;
  onChange: (patch: Partial<FieldDraft>) => void;
  onRemove: () => void;
}) {
  const indexable = ["text", "number", "boolean", "datetime", "select"].includes(draft.type);
  const uniqueable = ["text", "number", "datetime"].includes(draft.type);
  return (
    <div {...stylex.props(styles.fieldCard)}>
      <div {...stylex.props(styles.fieldRow)}>
        <TextField
          label="フィールド key"
          value={draft.key}
          onChange={(next) => onChange({ key: next })}
        />
        <Select
          label="型"
          items={FIELD_TYPES}
          selectedValue={draft.type}
          onChange={(next) => onChange({ type: next as FieldDraft["type"] })}
        />
        <Checkbox isSelected={draft.required} onChange={(next) => onChange({ required: next })}>
          必須
        </Checkbox>
        {indexable && (
          <Checkbox isSelected={draft.indexed} onChange={(next) => onChange({ indexed: next })}>
            indexed
          </Checkbox>
        )}
        {uniqueable && (
          <Checkbox isSelected={draft.unique} onChange={(next) => onChange({ unique: next })}>
            unique
          </Checkbox>
        )}
        <Button variant="secondary" onPress={onRemove}>
          削除
        </Button>
      </div>
      {draft.type === "text" && (
        <TextField
          label="maxLength"
          value={draft.maxLength}
          onChange={(next) => onChange({ maxLength: next })}
        />
      )}
      {draft.type === "number" && (
        <Checkbox isSelected={draft.integer} onChange={(next) => onChange({ integer: next })}>
          整数のみ
        </Checkbox>
      )}
      {draft.type === "select" && (
        <>
          <TextArea
            label="選択肢（1 行 1 件、value=ラベル）"
            value={draft.optionsText}
            onChange={(next) => onChange({ optionsText: next })}
            rows={4}
          />
          <Checkbox isSelected={draft.multiple} onChange={(next) => onChange({ multiple: next })}>
            複数選択
          </Checkbox>
        </>
      )}
      {draft.type === "relation" && (
        <div {...stylex.props(styles.fieldRow)}>
          <TextField
            label="許可する型（カンマ区切り）"
            value={draft.allowedTypes}
            onChange={(next) => onChange({ allowedTypes: next })}
          />
          <Select
            label="カーディナリティ"
            items={[
              { value: "one", label: "one" },
              { value: "many", label: "many" },
            ]}
            selectedValue={draft.cardinality}
            onChange={(next) => onChange({ cardinality: next as "one" | "many" })}
          />
          <Checkbox isSelected={draft.ordered} onChange={(next) => onChange({ ordered: next })}>
            順序を保持
          </Checkbox>
        </div>
      )}
    </div>
  );
}
```

(TextField に `isDisabled` を渡す — RacTextFieldProps 継承なので通る。通らなければ Task 8 の inputMode と同様に転送を足す。)

- [ ] **Step 7: ルートを再編・追加する**

`git mv apps/admin/src/routes/t/\$tenantSlug/content-types.tsx apps/admin/src/routes/t/\$tenantSlug/content-types/index.tsx` で移動し、次の内容に更新(ルート ID が `/t/$tenantSlug/content-types/` に変わる):

```tsx
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import * as stylex from "@stylexjs/stylex";
import { colors, spacing, typography } from "@plyrs/ui/tokens.stylex";
import { contentTypesQueryOptions } from "../../../../lib/queries";

const styles = stylex.create({
  title: { fontSize: typography.sizeXl, marginTop: 0 },
  toolbar: { display: "flex", justifyContent: "flex-end", marginBottom: spacing.md },
  table: { borderCollapse: "collapse", width: "100%", fontSize: typography.sizeMd },
  caption: {
    captionSide: "top",
    textAlign: "left",
    color: colors.textMuted,
    fontSize: typography.sizeSm,
    paddingBottom: spacing.xs,
  },
  cell: {
    textAlign: "left",
    padding: spacing.sm,
    borderBottomWidth: "1px",
    borderBottomStyle: "solid",
    borderBottomColor: colors.border,
  },
  muted: { color: colors.textMuted },
  link: { color: colors.accent, marginRight: spacing.sm },
});

export const Route = createFileRoute("/t/$tenantSlug/content-types/")({
  // invalidate → 一覧へ戻る経路があるため fetchQuery（ensureQueryData は stale でも返す — §11）
  loader: ({ context }) =>
    context.queryClient.fetchQuery(
      contentTypesQueryOptions(context.adminApi, context.tenant.id),
    ),
  component: ContentTypesPage,
});

function ContentTypesPage() {
  const { adminApi, tenant } = Route.useRouteContext();
  const { tenantSlug } = Route.useParams();
  const { data: contentTypes } = useSuspenseQuery(contentTypesQueryOptions(adminApi, tenant.id));

  return (
    <>
      <h1 {...stylex.props(styles.title)}>コンテンツタイプ</h1>
      <div {...stylex.props(styles.toolbar)}>
        <Link
          to="/t/$tenantSlug/content-types/new"
          params={{ tenantSlug }}
          {...stylex.props(styles.link)}
        >
          新規コンテンツタイプ
        </Link>
      </div>
      {contentTypes.length === 0 ? (
        <p {...stylex.props(styles.muted)}>コンテンツタイプはまだありません</p>
      ) : (
        <table {...stylex.props(styles.table)}>
          <caption {...stylex.props(styles.caption)}>登録済みコンテンツタイプの一覧</caption>
          <thead>
            <tr>
              <th {...stylex.props(styles.cell)}>key</th>
              <th {...stylex.props(styles.cell)}>名前</th>
              <th {...stylex.props(styles.cell)}>フィールド数</th>
              <th {...stylex.props(styles.cell)}>source</th>
              <th {...stylex.props(styles.cell)}>version</th>
              <th {...stylex.props(styles.cell)}>操作</th>
            </tr>
          </thead>
          <tbody>
            {contentTypes.map((contentType) => (
              <tr key={contentType.id}>
                <td {...stylex.props(styles.cell)}>{contentType.key}</td>
                <td {...stylex.props(styles.cell)}>{contentType.name}</td>
                <td {...stylex.props(styles.cell)}>{contentType.fields.length}</td>
                <td {...stylex.props(styles.cell)}>{contentType.source}</td>
                <td {...stylex.props(styles.cell)}>{contentType.version}</td>
                <td {...stylex.props(styles.cell)}>
                  <Link
                    to="/t/$tenantSlug/records/$typeKey"
                    params={{ tenantSlug, typeKey: contentType.key }}
                    {...stylex.props(styles.link)}
                  >
                    レコード
                  </Link>
                  {contentType.source === "user" && (
                    <Link
                      to="/t/$tenantSlug/content-types/$typeKey/edit"
                      params={{ tenantSlug, typeKey: contentType.key }}
                      {...stylex.props(styles.link)}
                    >
                      編集
                    </Link>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
```

**注意:** 「レコード」リンク先ルートは Task 10 で作る。Task 9 の時点で routeTree に無いと typed Link が型エラーになるため、**Task 9 では records ルートのプレースホルダーを作らず、`Link` を Task 10 まで `UntypedLink` 相当にしない**。代わりに Task 9 と Task 10 の routeTree 再生成をまとめて行う場合は、この「レコード」リンクだけ Task 10 で追加してもよい(実装順の裁量。テスト `links from the list to the builder pages` の「レコード」アサートも Task 10 に移す場合はレポートに明記)。**推奨: Task 9 では「レコード」リンクとそのアサートを入れず、Task 10 で両方追加する。**

`apps/admin/src/routes/t/$tenantSlug/content-types/new.tsx`:

```tsx
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import * as stylex from "@stylexjs/stylex";
import { typography } from "@plyrs/ui/tokens.stylex";
import { ContentTypeForm } from "../../../../components/content-type-form";
import { contentTypesQueryOptions } from "../../../../lib/queries";

const styles = stylex.create({
  title: { fontSize: typography.sizeXl, marginTop: 0 },
});

export const Route = createFileRoute("/t/$tenantSlug/content-types/new")({
  component: NewContentTypePage,
});

function NewContentTypePage() {
  const { adminApi, tenant, queryClient } = Route.useRouteContext();
  const { tenantSlug } = Route.useParams();
  const navigate = useNavigate();
  return (
    <>
      <h1 {...stylex.props(styles.title)}>新規コンテンツタイプ</h1>
      <ContentTypeForm
        existing={null}
        onSubmit={async (definition) => {
          await adminApi.putContentType(tenant.id, definition);
          await queryClient.invalidateQueries({
            queryKey: contentTypesQueryOptions(adminApi, tenant.id).queryKey,
          });
          await navigate({ to: "/t/$tenantSlug/content-types", params: { tenantSlug } });
        }}
      />
    </>
  );
}
```

`apps/admin/src/routes/t/$tenantSlug/content-types/$typeKey.edit.tsx`:

```tsx
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import * as stylex from "@stylexjs/stylex";
import { colors, typography } from "@plyrs/ui/tokens.stylex";
import { ContentTypeForm } from "../../../../components/content-type-form";
import { contentTypesQueryOptions } from "../../../../lib/queries";

const styles = stylex.create({
  title: { fontSize: typography.sizeXl, marginTop: 0 },
  muted: { color: colors.textMuted },
});

export const Route = createFileRoute("/t/$tenantSlug/content-types/$typeKey/edit")({
  // 編集フォームは常に最新定義から開く（invalidate 後の stale 回避 = fetchQuery。§11）
  loader: ({ context }) =>
    context.queryClient.fetchQuery(
      contentTypesQueryOptions(context.adminApi, context.tenant.id),
    ),
  component: EditContentTypePage,
});

function EditContentTypePage() {
  const { adminApi, tenant, queryClient } = Route.useRouteContext();
  const { tenantSlug, typeKey } = Route.useParams();
  const navigate = useNavigate();
  const { data: contentTypes } = useSuspenseQuery(contentTypesQueryOptions(adminApi, tenant.id));
  const existing = contentTypes.find((contentType) => contentType.key === typeKey);
  if (existing === undefined) {
    return <p {...stylex.props(styles.muted)}>コンテンツタイプ {typeKey} が見つかりません</p>;
  }
  return (
    <>
      <h1 {...stylex.props(styles.title)}>コンテンツタイプを編集: {existing.name}</h1>
      <ContentTypeForm
        existing={existing}
        onSubmit={async (definition) => {
          await adminApi.putContentType(tenant.id, definition);
          await queryClient.invalidateQueries({
            queryKey: contentTypesQueryOptions(adminApi, tenant.id).queryKey,
          });
          await navigate({ to: "/t/$tenantSlug/content-types", params: { tenantSlug } });
        }}
      />
    </>
  );
}
```

**注意(リダイレクト先):** `/t/$tenantSlug/` の index ルート(routes/t/$tenantSlug/index.tsx)が `/t/$tenantSlug/content-types` へリダイレクトしている場合、一覧ルート ID の変更(`/content-types` → `/content-types/`)で to の文字列調整が要ることがある。typecheck が落ちたら index.tsx の `to` を `"/t/$tenantSlug/content-types"` のまま解決できる形(TanStack Router は trailing slash を吸収する)か明示的な新 ID に合わせる。

- [ ] **Step 8: routeTree 再生成(コントローラに依頼)**

コントローラが実行: `pnpm --filter @plyrs/admin build`(sandbox 無効)
Expected: `src/routeTree.gen.ts` が更新され、`/t/$tenantSlug/content-types/`・`/t/$tenantSlug/content-types/new`・`/t/$tenantSlug/content-types/$typeKey/edit` が載る

- [ ] **Step 9: ルートテストが PASS することを確認(全体)**

Run: `pnpm --filter @plyrs/admin test && pnpm --filter @plyrs/admin typecheck && pnpm lint && pnpm format:check`
Expected: all green(shell.test.tsx の既存テストも通る — 一覧 UI の変更でセルアサートが壊れた場合は文言変更に追従して直す。壊した内容はレポートに明記)

- [ ] **Step 10: Commit**

```bash
git add apps/admin/src
git commit -m "feat: add content type builder"
```

---

### Task 10: record 一覧・新規作成・エディタのルート(同期エンジン接続)

record の読み書きはすべて同期コレクション経由(ローカルファースト)。一覧は live、編集は collection.update、新規は collection.insert(ID はクライアント生成 UUIDv7)、削除は collection.delete。エディタはスロット領域(toolbar / panel)を描画する(中身の登録は Task 11)。

**Files:**
- Create: `apps/admin/src/routes/t/$tenantSlug/records/$typeKey/index.tsx`
- Create: `apps/admin/src/routes/t/$tenantSlug/records/$typeKey/new.tsx`
- Create: `apps/admin/src/routes/t/$tenantSlug/records/$typeKey/$recordId.tsx`
- Modify: `apps/admin/src/routes/t/$tenantSlug/content-types/index.tsx`(「レコード」リンク追加 — Task 9 の注意参照)
- Create: `apps/admin/src/records-flow.test.tsx`
- Regenerate: `apps/admin/src/routeTree.gen.ts`(コントローラ)

**Interfaces:**
- Consumes: Task 6 の `useTenantSync` / `useSyncStatus` / `useSyncTypes` / `useCollectionRows`、Task 8 の `RecordForm` / `labelForRecord` / `syncErrorMessage`、`SyncRecord`(@plyrs/sync-protocol)、`v7 as uuidv7`(uuid)
- Produces:
  - ルート `/t/$tenantSlug/records/$typeKey`(一覧)・`/records/$typeKey/new`・`/records/$typeKey/$recordId`(エディタ)
  - エディタはスロット描画: `slots.get("record-editor:toolbar")` を見出し下の横並びに、`slots.get("record-editor:panel")` を右カラムに `<c.render typeKey={typeKey} recordId={recordId} />` で描画(Task 11 が中身を登録)

- [ ] **Step 1: 失敗するルートテストを書く**

`apps/admin/src/records-flow.test.tsx`(FakeSocket をフルに使う。jsonResponse / stubFetch / Handler は content-type-builder.test.tsx と同形をファイル内に定義):

```tsx
import type { ContentTypeDefinition } from "@plyrs/metamodel";
import type { SyncRecord } from "@plyrs/sync-protocol";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, type Mock } from "vitest";
import { createAppContext, getRouter } from "./router";
import { FakeSocket } from "./test-utils/fake-socket";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

type Handler = Mock<(init?: RequestInit) => Response>;

function stubFetch(routes: Record<string, Handler>): typeof fetch {
  return async (input, init) => {
    const path =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.pathname
          : new URL(input.url).pathname;
    const handler = routes[path];
    if (handler === undefined) {
      throw new Error(`unexpected fetch: ${path}`);
    }
    return handler(init ?? undefined);
  };
}

const blogTenant = { id: "t1", slug: "blog", name: "Blog", role: "owner" };

function authedRoutes(overrides: Record<string, Handler> = {}): Record<string, Handler> {
  return {
    "/auth/tenants": vi.fn(() => jsonResponse(200, { tenants: [blogTenant] })),
    "/auth/token": vi.fn(() => jsonResponse(200, { token: "jwt-abc", expiresIn: 900 })),
    "/v1/t/t1/content-types": vi.fn(() => jsonResponse(200, { contentTypes: [] })),
    ...overrides,
  };
}

const articleType: ContentTypeDefinition = {
  id: "018f2b6a-7a0a-7000-8000-000000000001",
  key: "article",
  name: "記事",
  source: "user",
  version: 1,
  fields: [{ key: "title", type: "text", required: true }],
};

function article(id: string, title: string, overrides: Partial<SyncRecord> = {}): SyncRecord {
  return {
    id,
    type: "article",
    input: { title },
    fieldVersions: { title: 1 },
    status: "draft",
    seq: 2,
    version: 1,
    deletedAt: null,
    updatedAt: "2026-07-17T00:00:00Z",
    updatedBy: "u1",
    ...overrides,
  };
}

const RECORD_1 = "018f2b6a-7a0a-7000-8000-000000000101";

// ソケットを test 側で握るヘルパー。エンジンの接続確立ごとに新しい FakeSocket を返す。
function socketHarness() {
  const sockets: FakeSocket[] = [];
  const connect = async () => {
    const socket = new FakeSocket();
    sockets.push(socket);
    return socket;
  };
  return {
    sockets,
    connect,
    latest: () => sockets[sockets.length - 1],
  };
}

async function bootstrapped(socket: FakeSocket, records: SyncRecord[]) {
  await vi.waitFor(() => expect(socket.parsed()).toContainEqual({ type: "hello", checkpoint: 0 }));
  socket.deliver({
    type: "welcome",
    protocolVersion: 1,
    contentTypes: [articleType],
    serverSeq: 10,
  });
  socket.deliver({ type: "sync", records, serverSeq: 10, complete: true });
}

function renderAt(path: string, harness: ReturnType<typeof socketHarness>, routes = authedRoutes()) {
  const router = getRouter({
    context: createAppContext(stubFetch(routes), { connect: () => harness.connect }),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  render(<RouterProvider router={router} />);
  return router;
}

describe("record 一覧（/t/$tenantSlug/records/$typeKey）", () => {
  it("lists synced records with workflow status", async () => {
    const harness = socketHarness();
    renderAt("/t/blog/records/article", harness);
    await vi.waitFor(() => expect(harness.sockets.length).toBe(1));
    await bootstrapped(harness.latest(), [article(RECORD_1, "こんにちは")]);
    expect(await screen.findByRole("cell", { name: "こんにちは" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "下書き" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "新規レコード" })).toBeInTheDocument();
  });

  it("shows the syncing state until the bootstrap completes", async () => {
    const harness = socketHarness();
    renderAt("/t/blog/records/article", harness);
    expect(await screen.findByText(/同期中/)).toBeInTheDocument();
  });
});

describe("record 新規作成", () => {
  it("inserts a record through the collection and pushes it to the socket", async () => {
    const harness = socketHarness();
    renderAt("/t/blog/records/article/new", harness);
    await vi.waitFor(() => expect(harness.sockets.length).toBe(1));
    await bootstrapped(harness.latest(), []);

    const user = userEvent.setup();
    await user.type(await screen.findByRole("textbox", { name: "title" }), "新しい記事");
    await user.click(screen.getByRole("button", { name: "作成" }));

    // push が飛び、input に title が載る
    await vi.waitFor(() => {
      const push = harness
        .latest()
        .parsed()
        .find((message) => (message as { type: string }).type === "push") as
        | { changes: { recordId: string; typeKey: string; input: Record<string, unknown>; changeId: string; status?: string }[] }
        | undefined;
      expect(push).toBeDefined();
      expect(push?.changes[0]).toMatchObject({
        typeKey: "article",
        input: { title: "新しい記事" },
        status: "draft",
      });
    });

    // ack を返すと一覧へ遷移し、確定レコードが表示される
    const push = harness
      .latest()
      .parsed()
      .find((message) => (message as { type: string }).type === "push") as {
      changes: { recordId: string; changeId: string }[];
    };
    const change = push.changes[0];
    if (change === undefined) throw new Error("expected a pushed change");
    harness.latest().deliver({
      type: "ack",
      changeId: change.changeId,
      result: { ok: true, record: article(change.recordId, "新しい記事", { seq: 11, version: 1 }) },
    });
    expect(await screen.findByRole("cell", { name: "新しい記事" })).toBeInTheDocument();
  });
});

describe("record エディタ", () => {
  it("edits an existing record and pushes only the changed field", async () => {
    const harness = socketHarness();
    renderAt(`/t/blog/records/article/${RECORD_1}`, harness);
    await vi.waitFor(() => expect(harness.sockets.length).toBe(1));
    await bootstrapped(harness.latest(), [article(RECORD_1, "旧タイトル")]);

    const user = userEvent.setup();
    const input = await screen.findByRole("textbox", { name: "title" });
    await user.clear(input);
    await user.type(input, "新タイトル");
    await user.click(screen.getByRole("button", { name: "保存" }));

    await vi.waitFor(() => {
      const push = harness
        .latest()
        .parsed()
        .find((message) => (message as { type: string }).type === "push") as
        | { changes: { recordId: string; changedFields: string[]; baseFieldVersions: Record<string, number> }[] }
        | undefined;
      expect(push?.changes[0]).toMatchObject({
        recordId: RECORD_1,
        changedFields: ["title"],
        baseFieldVersions: { title: 1 },
      });
    });
  });

  it("shows a not-found message for a missing record after sync completes", async () => {
    const harness = socketHarness();
    renderAt(`/t/blog/records/article/${RECORD_1}`, harness);
    await vi.waitFor(() => expect(harness.sockets.length).toBe(1));
    await bootstrapped(harness.latest(), []);
    expect(await screen.findByText(/レコードが見つかりません/)).toBeInTheDocument();
  });

  it("deletes the record after confirmation and navigates back to the list", async () => {
    const harness = socketHarness();
    renderAt(`/t/blog/records/article/${RECORD_1}`, harness);
    await vi.waitFor(() => expect(harness.sockets.length).toBe(1));
    await bootstrapped(harness.latest(), [article(RECORD_1, "消える記事")]);

    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "削除" }));
    await user.click(await screen.findByRole("button", { name: "削除を確定" }));

    await vi.waitFor(() => {
      const push = harness
        .latest()
        .parsed()
        .find((message) => (message as { type: string }).type === "push") as
        | { changes: { op: string; recordId: string; changeId: string }[] }
        | undefined;
      expect(push?.changes[0]).toMatchObject({ op: "delete", recordId: RECORD_1 });
    });
    const push = harness
      .latest()
      .parsed()
      .find((message) => (message as { type: string }).type === "push") as {
      changes: { changeId: string }[];
    };
    const change = push.changes[0];
    if (change === undefined) throw new Error("expected a pushed change");
    harness.latest().deliver({
      type: "ack",
      changeId: change.changeId,
      result: {
        ok: true,
        record: article(RECORD_1, "", { seq: 12, deletedAt: "2026-07-17T01:00:00Z", input: {} }),
      },
    });
    expect(await screen.findByText(/レコードはまだありません/)).toBeInTheDocument();
  });

  it("shows the unknown-type message for a type that does not exist", async () => {
    const harness = socketHarness();
    renderAt("/t/blog/records/ghost", harness);
    await vi.waitFor(() => expect(harness.sockets.length).toBe(1));
    await bootstrapped(harness.latest(), []);
    expect(await screen.findByText(/未知のコンテンツタイプ/)).toBeInTheDocument();
  });
});
```

Run: `pnpm --filter @plyrs/admin test -- src/records-flow.test.tsx`
Expected: FAIL(ルート未定義)

- [ ] **Step 2: 一覧ルートを実装**

`apps/admin/src/routes/t/$tenantSlug/records/$typeKey/index.tsx`:

```tsx
import { createFileRoute, Link } from "@tanstack/react-router";
import * as stylex from "@stylexjs/stylex";
import type { WorkflowStatus } from "@plyrs/metamodel";
import { colors, spacing, typography } from "@plyrs/ui/tokens.stylex";
import { labelForRecord } from "../../../../../components/record-form";
import { useSyncStatus, useSyncTypes, useTenantSync } from "../../../../../lib/sync-context";
import { useCollectionRows } from "../../../../../lib/use-collection";

const styles = stylex.create({
  title: { fontSize: typography.sizeXl, marginTop: 0 },
  toolbar: { display: "flex", justifyContent: "flex-end", marginBottom: spacing.md },
  table: { borderCollapse: "collapse", width: "100%", fontSize: typography.sizeMd },
  cell: {
    textAlign: "left",
    padding: spacing.sm,
    borderBottomWidth: "1px",
    borderBottomStyle: "solid",
    borderBottomColor: colors.border,
  },
  muted: { color: colors.textMuted },
  link: { color: colors.accent },
});

export const STATUS_LABELS: Record<WorkflowStatus, string> = {
  draft: "下書き",
  in_review: "レビュー中",
  ready: "公開準備完了",
  archived: "アーカイブ",
};

export const Route = createFileRoute("/t/$tenantSlug/records/$typeKey/")({
  component: RecordListPage,
});

function RecordListPage() {
  const { tenantSlug, typeKey } = Route.useParams();
  const sync = useTenantSync();
  const status = useSyncStatus(sync);
  const types = useSyncTypes(sync);
  const contentType = types.find((type) => type.key === typeKey);
  const rows = useCollectionRows(sync.registry.get(typeKey));

  if (status !== "ready") {
    return <p {...stylex.props(styles.muted)}>同期中…（状態: {status}）</p>;
  }
  if (contentType === undefined) {
    return <p {...stylex.props(styles.muted)}>未知のコンテンツタイプです: {typeKey}</p>;
  }

  const sorted = rows.toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return (
    <>
      <h1 {...stylex.props(styles.title)}>{contentType.name}</h1>
      <div {...stylex.props(styles.toolbar)}>
        <Link
          to="/t/$tenantSlug/records/$typeKey/new"
          params={{ tenantSlug, typeKey }}
          {...stylex.props(styles.link)}
        >
          新規レコード
        </Link>
      </div>
      {sorted.length === 0 ? (
        <p {...stylex.props(styles.muted)}>レコードはまだありません</p>
      ) : (
        <table {...stylex.props(styles.table)}>
          <thead>
            <tr>
              <th {...stylex.props(styles.cell)}>タイトル</th>
              <th {...stylex.props(styles.cell)}>ステータス</th>
              <th {...stylex.props(styles.cell)}>更新日時</th>
              <th {...stylex.props(styles.cell)}>version</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((record) => (
              <tr key={record.id}>
                <td {...stylex.props(styles.cell)}>
                  <Link
                    to="/t/$tenantSlug/records/$typeKey/$recordId"
                    params={{ tenantSlug, typeKey, recordId: record.id }}
                    {...stylex.props(styles.link)}
                  >
                    {labelForRecord(types, record)}
                  </Link>
                </td>
                <td {...stylex.props(styles.cell)}>{STATUS_LABELS[record.status]}</td>
                <td {...stylex.props(styles.cell)}>{record.updatedAt}</td>
                <td {...stylex.props(styles.cell)}>{record.version}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
```

- [ ] **Step 3: 新規作成ルートを実装**

`apps/admin/src/routes/t/$tenantSlug/records/$typeKey/new.tsx`:

```tsx
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import * as stylex from "@stylexjs/stylex";
import { v7 as uuidv7 } from "uuid";
import type { SyncRecord } from "@plyrs/sync-protocol";
import { colors, typography } from "@plyrs/ui/tokens.stylex";
import { RecordForm } from "../../../../../components/record-form";
import { useSyncStatus, useSyncTypes, useTenantSync } from "../../../../../lib/sync-context";

const styles = stylex.create({
  title: { fontSize: typography.sizeXl, marginTop: 0 },
  muted: { color: colors.textMuted },
});

export const Route = createFileRoute("/t/$tenantSlug/records/$typeKey/new")({
  component: NewRecordPage,
});

function NewRecordPage() {
  const { tenantSlug, typeKey } = Route.useParams();
  const sync = useTenantSync();
  const status = useSyncStatus(sync);
  const types = useSyncTypes(sync);
  const navigate = useNavigate();
  const contentType = types.find((type) => type.key === typeKey);
  const collection = sync.registry.get(typeKey);

  if (status !== "ready") {
    return <p {...stylex.props(styles.muted)}>同期中…（状態: {status}）</p>;
  }
  if (contentType === undefined || collection === undefined) {
    return <p {...stylex.props(styles.muted)}>未知のコンテンツタイプです: {typeKey}</p>;
  }

  return (
    <>
      <h1 {...stylex.props(styles.title)}>{contentType.name} を作成</h1>
      <RecordForm
        contentType={contentType}
        types={types}
        registry={sync.registry}
        record={null}
        submitLabel="作成"
        onSubmit={async (input) => {
          // design-spec §5: ID はクライアント生成（UUIDv7）。updatedAt/updatedBy/seq/version は
          // サーバー権威 — ack の確定レコードで上書きされる仮値を入れる。
          const record: SyncRecord = {
            id: uuidv7(),
            type: typeKey,
            input,
            fieldVersions: {},
            status: "draft",
            seq: 0,
            version: 0,
            deletedAt: null,
            updatedAt: new Date().toISOString(),
            updatedBy: "",
          };
          const tx = collection.insert(record);
          await tx.isPersisted.promise;
          await navigate({ to: "/t/$tenantSlug/records/$typeKey", params: { tenantSlug, typeKey } });
        }}
      />
    </>
  );
}
```

- [ ] **Step 4: エディタルートを実装(スロット領域込み)**

`apps/admin/src/routes/t/$tenantSlug/records/$typeKey/$recordId.tsx`:

```tsx
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import * as stylex from "@stylexjs/stylex";
import { useState } from "react";
import { Button } from "@plyrs/ui";
import { colors, spacing, typography } from "@plyrs/ui/tokens.stylex";
import { RecordForm, syncErrorMessage } from "../../../../../components/record-form";
import { useSyncStatus, useSyncTypes, useTenantSync } from "../../../../../lib/sync-context";
import { useCollectionRows } from "../../../../../lib/use-collection";

const styles = stylex.create({
  title: { fontSize: typography.sizeXl, marginTop: 0 },
  muted: { color: colors.textMuted },
  layout: { display: "grid", gridTemplateColumns: "1fr 280px", gap: spacing.lg },
  toolbar: {
    display: "flex",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.md,
    flexWrap: "wrap",
  },
  panelColumn: { display: "flex", flexDirection: "column", gap: spacing.md },
  panel: {
    padding: spacing.md,
    borderRadius: "6px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  panelTitle: { fontSize: typography.sizeSm, color: colors.textMuted, marginTop: 0 },
  banner: { color: colors.danger, fontSize: typography.sizeMd },
  dangerZone: { display: "flex", gap: spacing.sm, marginTop: spacing.lg },
});

export const Route = createFileRoute("/t/$tenantSlug/records/$typeKey/$recordId")({
  component: RecordEditorPage,
});

function RecordEditorPage() {
  const { slots } = Route.useRouteContext();
  const { tenantSlug, typeKey, recordId } = Route.useParams();
  const sync = useTenantSync();
  const status = useSyncStatus(sync);
  const types = useSyncTypes(sync);
  const navigate = useNavigate();
  const collection = sync.registry.get(typeKey);
  const rows = useCollectionRows(collection);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  if (status !== "ready") {
    return <p {...stylex.props(styles.muted)}>同期中…（状態: {status}）</p>;
  }
  const contentType = types.find((type) => type.key === typeKey);
  if (contentType === undefined || collection === undefined) {
    return <p {...stylex.props(styles.muted)}>未知のコンテンツタイプです: {typeKey}</p>;
  }
  const record = rows.find((row) => row.id === recordId);
  if (record === undefined) {
    return <p {...stylex.props(styles.muted)}>レコードが見つかりません（削除された可能性があります）</p>;
  }

  async function deleteRecord() {
    setDeleteError(null);
    try {
      if (collection === undefined) return;
      const tx = collection.delete(recordId);
      await tx.isPersisted.promise;
      await navigate({ to: "/t/$tenantSlug/records/$typeKey", params: { tenantSlug, typeKey } });
    } catch (cause) {
      setDeleteError(syncErrorMessage(cause));
    }
  }

  return (
    <>
      <h1 {...stylex.props(styles.title)}>{contentType.name} を編集</h1>
      <div {...stylex.props(styles.toolbar)}>
        {slots.get("record-editor:toolbar").map((contribution) => (
          <contribution.render key={contribution.id} typeKey={typeKey} recordId={recordId} />
        ))}
      </div>
      <div {...stylex.props(styles.layout)}>
        <div>
          <RecordForm
            contentType={contentType}
            types={types}
            registry={sync.registry}
            record={record}
            submitLabel="保存"
            onSubmit={async (input) => {
              const tx = collection.update(recordId, (draft) => {
                draft.input = input;
              });
              await tx.isPersisted.promise;
            }}
          />
          <div {...stylex.props(styles.dangerZone)}>
            {confirmingDelete ? (
              <>
                <Button variant="secondary" onPress={() => void deleteRecord()}>
                  削除を確定
                </Button>
                <Button variant="secondary" onPress={() => setConfirmingDelete(false)}>
                  キャンセル
                </Button>
              </>
            ) : (
              <Button variant="secondary" onPress={() => setConfirmingDelete(true)}>
                削除
              </Button>
            )}
            {deleteError !== null && <span {...stylex.props(styles.banner)}>{deleteError}</span>}
          </div>
        </div>
        <aside {...stylex.props(styles.panelColumn)}>
          {slots.get("record-editor:panel").map((contribution) => (
            <section key={contribution.id} {...stylex.props(styles.panel)}>
              <h2 {...stylex.props(styles.panelTitle)}>{contribution.title}</h2>
              <contribution.render typeKey={typeKey} recordId={recordId} />
            </section>
          ))}
        </aside>
      </div>
    </>
  );
}
```

**実装注意:** `collection.update` の draft は `WritableDeep<SyncRecord>`。`draft.input = input` の代入で型が合わない場合は `draft.input = input as typeof draft.input`(境界 cast + コメント)。`deleteRecord` 内の `collection === undefined` ガードは TS の narrowing がクロージャで外れるための再チェック(実行時には到達しない)。

- [ ] **Step 5: content-types 一覧に「レコード」リンクを追加(Task 9 の注意で先送りした分)**

`apps/admin/src/routes/t/$tenantSlug/content-types/index.tsx` の操作セルに「レコード」Link を追加(Task 9 の Step 7 のコード参照)。Task 9 で先送りしたテストアサート(`links from the list to the builder pages` の「レコード」)も content-type-builder.test.tsx に足す。

- [ ] **Step 6: routeTree 再生成(コントローラに依頼)**

コントローラが実行: `pnpm --filter @plyrs/admin build`(sandbox 無効)
Expected: records 系 3 ルートが routeTree.gen.ts に載る

- [ ] **Step 7: テストが PASS することを確認**

Run: `pnpm --filter @plyrs/admin test && pnpm --filter @plyrs/admin typecheck && pnpm lint && pnpm format:check`
Expected: all green / clean

- [ ] **Step 8: Commit**

```bash
git add apps/admin/src
git commit -m "feat: add record list and editor routes"
```

---

### Task 11: publish / status 操作のスロット実配線

裁定 5: コアが `record-editor:toolbar`(publish/unpublish + status 変更)と `record-editor:panel`(公開状態)に自己登録する。archive 選択時に公開中なら警告(design-spec §7「強制 unpublish せず警告」)。viewer は操作ボタンを無効化(§11: record:publish は owner/editor のみ、record:write も viewer 不可)。

**Files:**
- Create: `apps/admin/src/components/publish-toolbar.tsx`
- Create: `apps/admin/src/components/status-control.tsx`
- Create: `apps/admin/src/components/publication-panel.tsx`
- Modify: `apps/admin/src/router.tsx`(createAppContext でスロット登録)
- Create: `apps/admin/src/publish-slots.test.tsx`

**Interfaces:**
- Consumes: Task 4 の `publishRecord` / `unpublishRecord` / `publicationQueryOptions`、Task 6 の sync hooks、Task 10 のエディタのスロット描画、`getRouteApi`(@tanstack/react-router — ルート ID `/t/$tenantSlug` の context = `{ tenant, adminApi, queryClient, ... }` を任意コンポーネントから取得する公式手段)
- Produces: スロット contribution 3 点(`core.publish` toolbar / `core.status` toolbar / `core.publication` panel)

- [ ] **Step 1: 失敗するテストを書く**

`apps/admin/src/publish-slots.test.tsx`(records-flow.test.tsx と同じヘルパー様式 + publication スタブ):

```tsx
import type { ContentTypeDefinition } from "@plyrs/metamodel";
import type { SyncRecord } from "@plyrs/sync-protocol";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, type Mock } from "vitest";
import { createAppContext, getRouter } from "./router";
import { FakeSocket } from "./test-utils/fake-socket";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

type Handler = Mock<(init?: RequestInit) => Response>;

function stubFetch(routes: Record<string, Handler>): typeof fetch {
  return async (input, init) => {
    const path =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.pathname
          : new URL(input.url).pathname;
    const handler = routes[path];
    if (handler === undefined) {
      throw new Error(`unexpected fetch: ${path}`);
    }
    return handler(init ?? undefined);
  };
}

const RECORD_1 = "018f2b6a-7a0a-7000-8000-000000000101";

const articleType: ContentTypeDefinition = {
  id: "018f2b6a-7a0a-7000-8000-000000000001",
  key: "article",
  name: "記事",
  source: "user",
  version: 1,
  fields: [{ key: "title", type: "text", required: true }],
};

function article(overrides: Partial<SyncRecord> = {}): SyncRecord {
  return {
    id: RECORD_1,
    type: "article",
    input: { title: "記事タイトル" },
    fieldVersions: { title: 1 },
    status: "draft",
    seq: 2,
    version: 3,
    deletedAt: null,
    updatedAt: "2026-07-17T00:00:00Z",
    updatedBy: "u1",
    ...overrides,
  };
}

function socketHarness() {
  const sockets: FakeSocket[] = [];
  const connect = async () => {
    const socket = new FakeSocket();
    sockets.push(socket);
    return socket;
  };
  return { sockets, connect, latest: () => sockets[sockets.length - 1] };
}

async function bootstrapped(socket: FakeSocket, records: SyncRecord[]) {
  await vi.waitFor(() => expect(socket.parsed()).toContainEqual({ type: "hello", checkpoint: 0 }));
  socket.deliver({ type: "welcome", protocolVersion: 1, contentTypes: [articleType], serverSeq: 10 });
  socket.deliver({ type: "sync", records, serverSeq: 10, complete: true });
}

function routesWith(role: string, overrides: Record<string, Handler> = {}): Record<string, Handler> {
  return {
    "/auth/tenants": vi.fn(() =>
      jsonResponse(200, { tenants: [{ id: "t1", slug: "blog", name: "Blog", role }] }),
    ),
    "/auth/token": vi.fn(() => jsonResponse(200, { token: "jwt-abc", expiresIn: 900 })),
    "/v1/t/t1/content-types": vi.fn(() => jsonResponse(200, { contentTypes: [] })),
    [`/v1/t/t1/records/${RECORD_1}/publication`]: vi.fn(() =>
      jsonResponse(200, { published: false }),
    ),
    ...overrides,
  };
}

function renderEditor(harness: ReturnType<typeof socketHarness>, routes: Record<string, Handler>) {
  const router = getRouter({
    context: createAppContext(stubFetch(routes), { connect: () => harness.connect }),
    history: createMemoryHistory({ initialEntries: [`/t/blog/records/article/${RECORD_1}`] }),
  });
  render(<RouterProvider router={router} />);
  return router;
}

describe("publish / unpublish（record-editor:toolbar スロット）", () => {
  it("publishes the record and refreshes the publication panel", async () => {
    const harness = socketHarness();
    let published = false;
    const publicationHandler: Handler = vi.fn(() =>
      published
        ? jsonResponse(200, {
            published: true,
            publishedAt: "2026-07-17T02:00:00Z",
            publishedBy: "u1",
            sourceVersion: 3,
          })
        : jsonResponse(200, { published: false }),
    );
    const publishHandler: Handler = vi.fn(() => {
      published = true;
      return jsonResponse(200, { ok: true });
    });
    renderEditor(
      harness,
      routesWith("owner", {
        [`/v1/t/t1/records/${RECORD_1}/publication`]: publicationHandler,
        [`/v1/t/t1/records/${RECORD_1}/publish`]: publishHandler,
      }),
    );
    await vi.waitFor(() => expect(harness.sockets.length).toBe(1));
    await bootstrapped(harness.latest(), [article()]);

    // panel: 未公開表示
    expect(await screen.findByText(/未公開/)).toBeInTheDocument();

    await userEvent.setup().click(await screen.findByRole("button", { name: "公開" }));
    expect(await screen.findByText(/公開中/)).toBeInTheDocument();
    expect(publishHandler).toHaveBeenCalledTimes(1);
    // 公開中は「公開を取り下げ」も出る
    expect(screen.getByRole("button", { name: "公開を取り下げ" })).toBeInTheDocument();
  });

  it("shows the stale indicator when the record changed after publish", async () => {
    const harness = socketHarness();
    renderEditor(
      harness,
      routesWith("owner", {
        [`/v1/t/t1/records/${RECORD_1}/publication`]: vi.fn(() =>
          jsonResponse(200, {
            published: true,
            publishedAt: "2026-07-17T02:00:00Z",
            publishedBy: "u1",
            sourceVersion: 1, // record.version = 3 > 1 → 未公開の変更あり
          }),
        ),
      }),
    );
    await vi.waitFor(() => expect(harness.sockets.length).toBe(1));
    await bootstrapped(harness.latest(), [article()]);
    expect(await screen.findByText(/未公開の変更があります/)).toBeInTheDocument();
  });

  it("disables publish actions for viewers", async () => {
    const harness = socketHarness();
    renderEditor(harness, routesWith("viewer"));
    await vi.waitFor(() => expect(harness.sockets.length).toBe(1));
    await bootstrapped(harness.latest(), [article()]);
    const publish = await screen.findByRole("button", { name: "公開" });
    expect(publish).toBeDisabled();
  });
});

describe("ワークフロー status 操作（record-editor:toolbar スロット）", () => {
  it("pushes a status-only change through the sync engine", async () => {
    const harness = socketHarness();
    renderEditor(harness, routesWith("owner"));
    await vi.waitFor(() => expect(harness.sockets.length).toBe(1));
    await bootstrapped(harness.latest(), [article()]);

    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /ステータス/ }));
    await user.click(await screen.findByRole("option", { name: "レビュー中" }));

    await vi.waitFor(() => {
      const push = harness
        .latest()
        .parsed()
        .find((message) => (message as { type: string }).type === "push") as
        | { changes: { recordId: string; status?: string; changedFields: string[] }[] }
        | undefined;
      expect(push?.changes[0]).toMatchObject({
        recordId: RECORD_1,
        status: "in_review",
        changedFields: [],
      });
    });
  });

  it("warns before archiving a record that is still published (design-spec §7)", async () => {
    const harness = socketHarness();
    renderEditor(
      harness,
      routesWith("owner", {
        [`/v1/t/t1/records/${RECORD_1}/publication`]: vi.fn(() =>
          jsonResponse(200, {
            published: true,
            publishedAt: "2026-07-17T02:00:00Z",
            publishedBy: "u1",
            sourceVersion: 3,
          }),
        ),
      }),
    );
    await vi.waitFor(() => expect(harness.sockets.length).toBe(1));
    await bootstrapped(harness.latest(), [article()]);

    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /ステータス/ }));
    await user.click(await screen.findByRole("option", { name: "アーカイブ" }));

    // まだ push されず、警告が出る
    expect(await screen.findByText(/まだ公開中です/)).toBeInTheDocument();
    const pushedBefore = harness
      .latest()
      .parsed()
      .filter((message) => (message as { type: string }).type === "push");
    expect(pushedBefore).toHaveLength(0);

    await user.click(screen.getByRole("button", { name: "公開したままアーカイブ" }));
    await vi.waitFor(() => {
      const push = harness
        .latest()
        .parsed()
        .find((message) => (message as { type: string }).type === "push") as
        | { changes: { status?: string }[] }
        | undefined;
      expect(push?.changes[0]).toMatchObject({ status: "archived" });
    });
  });
});
```

Run: `pnpm --filter @plyrs/admin test -- src/publish-slots.test.tsx`
Expected: FAIL(スロット未登録 = ボタンが見つからない)

- [ ] **Step 2: 3 コンポーネントを実装**

`apps/admin/src/components/publish-toolbar.tsx`:

```tsx
import * as stylex from "@stylexjs/stylex";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { Button } from "@plyrs/ui";
import { colors, spacing, typography } from "@plyrs/ui/tokens.stylex";
import { publicationQueryOptions } from "../lib/queries";

const styles = stylex.create({
  root: { display: "flex", alignItems: "center", gap: spacing.sm },
  error: { color: colors.danger, fontSize: typography.sizeSm },
});

const tenantRoute = getRouteApi("/t/$tenantSlug");

// 裁定 5: publish/unpublish はコアの record-editor:toolbar contribution。
// design-spec §11: record:publish は owner/editor（viewer は無効化。判定はサーバーが最終権威）。
export function PublishToolbar({ recordId }: { typeKey: string; recordId: string }) {
  const { tenant, adminApi, queryClient } = tenantRoute.useRouteContext();
  const publication = useQuery(publicationQueryOptions(adminApi, tenant.id, recordId));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const canPublish = tenant.role !== "viewer";

  async function run(action: "publish" | "unpublish") {
    setError(null);
    setBusy(true);
    try {
      if (action === "publish") {
        await adminApi.publishRecord(tenant.id, recordId);
      } else {
        await adminApi.unpublishRecord(tenant.id, recordId);
      }
      await queryClient.invalidateQueries({
        queryKey: publicationQueryOptions(adminApi, tenant.id, recordId).queryKey,
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div {...stylex.props(styles.root)}>
      <Button isDisabled={!canPublish || busy} onPress={() => void run("publish")}>
        公開
      </Button>
      {publication.data?.published === true && (
        <Button
          variant="secondary"
          isDisabled={!canPublish || busy}
          onPress={() => void run("unpublish")}
        >
          公開を取り下げ
        </Button>
      )}
      {error !== null && <span {...stylex.props(styles.error)}>{error}</span>}
    </div>
  );
}
```

`apps/admin/src/components/status-control.tsx`:

```tsx
import * as stylex from "@stylexjs/stylex";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { WORKFLOW_STATUSES, type WorkflowStatus } from "@plyrs/metamodel";
import { Button, Select } from "@plyrs/ui";
import { colors, spacing, typography } from "@plyrs/ui/tokens.stylex";
import { publicationQueryOptions } from "../lib/queries";
import { useTenantSync } from "../lib/sync-context";
import { useCollectionRows } from "../lib/use-collection";
import { syncErrorMessage } from "./record-form";

const styles = stylex.create({
  root: { display: "flex", alignItems: "flex-end", gap: spacing.sm, flexWrap: "wrap" },
  warning: {
    display: "flex",
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.sm,
    borderRadius: "6px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: colors.danger,
    color: colors.danger,
    fontSize: typography.sizeSm,
  },
  error: { color: colors.danger, fontSize: typography.sizeSm },
});

const STATUS_LABELS: Record<WorkflowStatus, string> = {
  draft: "下書き",
  in_review: "レビュー中",
  ready: "公開準備完了",
  archived: "アーカイブ",
};

const tenantRoute = getRouteApi("/t/$tenantSlug");

function isWorkflowStatus(value: string): value is WorkflowStatus {
  return (WORKFLOW_STATUSES as readonly string[]).includes(value);
}

// ワークフロー status は同期経路の LWW（§7: status は裁定外）— collection.update で流す。
// archive 選択時に公開中なら警告して確認を挟む（design-spec §7: 強制 unpublish はしない）。
export function StatusControl({ typeKey, recordId }: { typeKey: string; recordId: string }) {
  const { tenant, adminApi } = tenantRoute.useRouteContext();
  const sync = useTenantSync();
  const collection = sync.registry.get(typeKey);
  const rows = useCollectionRows(collection);
  const record = rows.find((row) => row.id === recordId);
  const publication = useQuery(publicationQueryOptions(adminApi, tenant.id, recordId));
  const [pendingArchive, setPendingArchive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canWrite = tenant.role !== "viewer";

  if (record === undefined || collection === undefined) {
    return null;
  }

  async function applyStatus(next: WorkflowStatus) {
    setError(null);
    try {
      if (collection === undefined) return;
      const tx = collection.update(recordId, (draft) => {
        draft.status = next;
      });
      await tx.isPersisted.promise;
    } catch (cause) {
      setError(syncErrorMessage(cause));
    }
  }

  function onSelect(value: string) {
    if (!isWorkflowStatus(value) || value === record?.status) {
      return;
    }
    if (value === "archived" && publication.data?.published === true) {
      setPendingArchive(true);
      return;
    }
    void applyStatus(value);
  }

  return (
    <div {...stylex.props(styles.root)}>
      <Select
        label="ステータス"
        items={WORKFLOW_STATUSES.map((status) => ({ value: status, label: STATUS_LABELS[status] }))}
        selectedValue={record.status}
        onChange={onSelect}
        isDisabled={!canWrite}
      />
      {pendingArchive && (
        <div {...stylex.props(styles.warning)} role="alert">
          <span>
            このレコードはまだ公開中です。アーカイブしても公開は維持されます（先に「公開を取り下げ」を推奨）。
          </span>
          <Button
            variant="secondary"
            onPress={() => {
              setPendingArchive(false);
              void applyStatus("archived");
            }}
          >
            公開したままアーカイブ
          </Button>
          <Button variant="secondary" onPress={() => setPendingArchive(false)}>
            キャンセル
          </Button>
        </div>
      )}
      {error !== null && <span {...stylex.props(styles.error)}>{error}</span>}
    </div>
  );
}
```

`apps/admin/src/components/publication-panel.tsx`:

```tsx
import * as stylex from "@stylexjs/stylex";
import { useQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { colors, typography } from "@plyrs/ui/tokens.stylex";
import { publicationQueryOptions } from "../lib/queries";
import { useTenantSync } from "../lib/sync-context";
import { useCollectionRows } from "../lib/use-collection";

const styles = stylex.create({
  body: { fontSize: typography.sizeMd, color: colors.text, margin: 0 },
  muted: { color: colors.textMuted },
  stale: { color: colors.danger },
});

const tenantRoute = getRouteApi("/t/$tenantSlug");

// 公開状態の 3 値（design-spec §7 の version 比較そのまま）:
// snapshot なし → 未公開 / version == sourceVersion → クリーン / version > sourceVersion → 要再公開
export function PublicationPanel({ typeKey, recordId }: { typeKey: string; recordId: string }) {
  const { tenant, adminApi } = tenantRoute.useRouteContext();
  const sync = useTenantSync();
  const rows = useCollectionRows(sync.registry.get(typeKey));
  const record = rows.find((row) => row.id === recordId);
  const publication = useQuery(publicationQueryOptions(adminApi, tenant.id, recordId));

  if (publication.data === undefined) {
    return <p {...stylex.props(styles.body, styles.muted)}>読み込み中…</p>;
  }
  if (!publication.data.published) {
    return <p {...stylex.props(styles.body, styles.muted)}>未公開</p>;
  }
  const stale = record !== undefined && record.version > publication.data.sourceVersion;
  return (
    <div>
      <p {...stylex.props(styles.body)}>公開中（{publication.data.publishedAt}）</p>
      {stale && (
        <p {...stylex.props(styles.body, styles.stale)}>
          公開後に編集されています — 未公開の変更があります（再公開で反映）
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 3: createAppContext でスロット登録**

`apps/admin/src/router.tsx` の `createAppContext` 内、nav:item 登録の直後に追加(import も):

```ts
import { PublicationPanel } from "./components/publication-panel";
import { PublishToolbar } from "./components/publish-toolbar";
import { StatusControl } from "./components/status-control";
// ...createAppContext 内:
  // 裁定 5（2026-07-17）: コア自身が record-editor スロットに登録する（ドッグフーディング）。
  // モジュール（Phase 9）も同じ register 経路で操作・パネルを足す。
  slots.register("record-editor:toolbar", { id: "core.publish", order: 0, render: PublishToolbar });
  slots.register("record-editor:toolbar", { id: "core.status", order: 1, render: StatusControl });
  slots.register("record-editor:panel", {
    id: "core.publication",
    title: "公開状態",
    order: 0,
    render: PublicationPanel,
  });
```

- [ ] **Step 4: テストが PASS することを確認**

Run: `pnpm --filter @plyrs/admin test && pnpm --filter @plyrs/admin typecheck && pnpm lint && pnpm format:check`
Expected: all green / clean(records-flow.test.tsx は publication クエリのスタブ不足で `unexpected fetch` になる — その場合は records-flow.test.tsx の authedRoutes に `/v1/t/t1/records/.../publication` の 200 `{ published: false }` スタブを追加して直す。これはスロット登録が既存エディタテストに publication フェッチを持ち込むためで、想定内の追従)

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src
git commit -m "feat: wire publish and status slot actions"
```

---

### Task 12: nav:item 契約の文書化 + 全ゲート実測

**Files:**
- Modify: `packages/ui/src/slots.ts`(契約 JSDoc)
- Modify: `docs/superpowers/plans/2026-07-12-implementation-roadmap.md`(§3 の 6b 行を「完了」に更新するのはマージ後。ここでは触らない)

**Interfaces:** なし(文書化 + 検証のみ)

- [ ] **Step 1: slots.ts の契約コメントを更新**

`packages/ui/src/slots.ts` の `NavItemContribution` と record-editor 2 型のコメントを次へ更新:

```ts
export interface NavItemContribution extends SlotContributionBase {
  label: string;
  /**
   * TanStack Router のルートパス（例: "/t/$tenantSlug/content-types"）。
   *
   * 契約（Phase 6a 裁定・6b 文書化）: 描画側（/t/$tenantSlug レイアウト）は
   * `params={{ tenantSlug }}` **だけ**を束縛する。つまり nav:item に載せてよいのは
   * パスパラメータが $tenantSlug のみのルートに限る。$typeKey 等の追加パラメータを
   * 持つルート（例: /t/$tenantSlug/records/$typeKey）を載せるには、contribution に
   * params を持たせるようレイアウト側の拡張が先に必要（Phase 9 のモジュール UI で再訪）。
   */
  to: string;
}

// Phase 6b で実配線済み: record 編集画面のサイドパネル（コアの core.publication が実例）。
// render は /t/$tenantSlug 配下のエディタルートでのみ描画される。ルート context
// （tenant / adminApi / queryClient）は getRouteApi("/t/$tenantSlug") で取得できる。
export interface RecordEditorPanelContribution extends SlotContributionBase {
  title: string;
  render: ComponentType<{ typeKey: string; recordId: string }>;
}

// Phase 6b で実配線済み: record 編集画面のツールバーアクション
// （コアの core.publish / core.status が実例）。
export interface RecordEditorToolbarContribution extends SlotContributionBase {
  render: ComponentType<{ typeKey: string; recordId: string }>;
}
```

ファイル冒頭コメントの「record-editor:* は Phase 6b で配線する型予約」も「record-editor:* は Phase 6b で実配線済み」に更新。

- [ ] **Step 2: 全ゲートを実測**

Run(ワークスペースルート):

```bash
pnpm -r test
pnpm -r typecheck
pnpm lint
pnpm format:check
```

Expected: 全パッケージ green(目安: 6a 時点 454 + 本フェーズ追加分)、typecheck / lint(警告 0)/ format すべて clean。**実出力をレポートに貼ること。**

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/slots.ts
git commit -m "docs: document nav item contract for slots"
```

---

## 手動確認項目(最終報告で列挙する — 自動テストで担保できない面)

1. `pnpm --filter @plyrs/admin dev` で実 WS 同期を確認: 2 つのブラウザタブで同じ record を開き、片方の編集がもう片方に反映されること(broadcast → collection 反映)。
2. content_type ビルダーで型を作成 → record 作成 → publish → `/public/v1/:slug/records/:type` で公開 API から見えること(投影 consumer 経由、数秒の結果整合)。
3. WS の再接続: dev サーバー再起動後に「再接続」ボタンで復帰すること。オフライン(DevTools)→ online イベントでの自動再開。
4. トークン失効(15 分放置 or JWT_SECRET 変更)後の 4001 → forceRefresh → 再接続。
5. 6a から持ち越しの手動確認 4 項目(ロードマップ §11 参照)は依然未実施。

## 実行メモ(コントローラ向け)

- ワークツリー作成直後: `git reset --hard main` → `CI=true pnpm install --frozen-lockfile`(sandbox 無効可)。Task 6 だけ lockfile 更新のため `pnpm install --no-frozen-lockfile`。
- `pnpm --filter @plyrs/admin build`(routeTree 再生成。Task 9 / 10)は sandbox 無効でコントローラが実行し、生成差分をタスクのコミットに含める。
- サブエージェント必須ルール(bare git stash 禁止 / any・@ts-expect-error 禁止 / 実出力貼付 / symlink 禁止 / sandbox 回避禁止)をディスパッチ文に毎回明記。
- モデル選択: Task 1・2・12 は安価モデル可。Task 3・4・5・7 は中位。Task 6・8・9・10・11 は中位〜上位(統合・判断を伴う)。タスクレビュアーは中位、最終ブランチレビューは最上位。
- レビュアーには「計画自体への異議」も拾わせる(計画コードに欠陥が混入した実例が毎フェーズある)。
- @tanstack/react-form / RAC の API 齟齬が出たら、node_modules の型定義を読んで正しい API に直す(当てずっぽう禁止)。修正内容はレポートに記録し、計画との差分として最終申し送りに含める。

## Self-Review(計画作成時に実施済み)

- **スコープ照合**: 依頼の 8 項目 — Minor 消化(Task 1, 2)/ ビルダー(Task 9)/ 動的フォーム(Task 7, 8)/ record 一覧・編集 + sync 配線 5 点(Task 6, 10)/ publish・unpublish(Task 3, 4, 11)/ status 操作 + archive 警告(Task 11)/ スロット実配線(Task 10, 11)/ nav:item 契約文書化(Task 12)— すべてタスクに割当済み。
- **配線 5 点の原文照合**: onContentTypes → registry.sync / onReady → markReady / onStoreChange → applyStoreChange / onReset → reset / `let registry!` 前方参照 — Task 6 の lib/sync.ts に全点あり、sync.test.ts が各点を個別検証。
- **型整合**: PublicationState(api / admin で構造一致)、TenantSync / SyncFactory(Task 6 定義 → Task 10, 11 消費)、FieldDraft(Task 9 内で完結)、relationDraftKey(Task 7 定義 → Task 8 消費)、labelForRecord / syncErrorMessage(Task 8 定義 → Task 10, 11 消費)、STATUS_LABELS は record 一覧(Task 10)と status-control(Task 11)で重複定義 — 意図的(パッケージ横断の共有を作らない。レビュアー指摘があれば lib へ抽出可)。
- **既知の不確実点(実装時に確認)**: (a) TanStack Form の動的 name の型解決(境界 cast の逃げ道を明記済み)。(b) RAC CheckboxGroup の value 二重管理(Task 5 に代替案明記)。(c) records-flow テストへの publication スタブ追従(Task 11 Step 4 に明記)。(d) TextField への inputMode / isDisabled 透過(Task 8 に対処明記)。




