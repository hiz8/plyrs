# Phase 9: モジュールシステム Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ファーストパーティ機能モジュールをメタモデル上に疎結合に載せる仕組み(design-spec §9)を完成させ、実証として予約モジュール(booking)で「型登録 → 同期フック → 非同期イベント → alarm → モジュール権限 → 公開 write(論点W)」の全機構を一気通貫で動かす。

**Architecture:** モジュール = api Worker 内の TS オブジェクト(`ModuleDefinition`)で、純データのマニフェスト(zod 検証済み JSON 相当: moduleId / version / contentTypes[] / permissions[] / typeWriteGuards / publicWriteTypes)とフック実装関数を束ねてコード内静的レジストリ `MODULE_REGISTRY` に登録する(G6 裁定)。テナントごとの有効化状態・適用済みマニフェスト version・権限展開表は DO 内の新テーブル `module_registry` に持つ(§9.5/§11.5)。beforeWrite は既存フックパイプラインへ有効モジュール分を合流、afterWrite/afterPublish は新テーブル `module_events` + 新キュー `plyrs-modules` の outbox 様式(§12.3 と同型)で at-least-once 配送。alarm は既存 `alarm_registry` の kind に `module:{id}` を追加し、物理 setAlarm は常にレジストリ全体の minDueAt 経路一本に集約(§9 申し送りの effectiveNow 制約)。型定義再配布は Queues の `module_sync`/`module_redistribute` ジョブ + DO 起床時の遅延再適用(§4.2)。公開 write は `/public/v1/:tenantSlug/modules/:moduleId/:endpoint` に Rate Limiting バインディング + Turnstile siteverify を第1段として置き、DO 側 `modulePublicWrite` がマニフェストの `publicWriteTypes` 宣言で第2段を締める(§11.7)。

**Tech Stack:** Cloudflare Queues(新キュー plyrs-modules + DLQ)、Workers Rate Limiting バインディング(unsafe/ratelimit)、Turnstile siteverify(fetch)、Drizzle(DO migration 0003 + control-plane D1 migration)、Hono、zod、Vitest + pool-workers(fetchMock / createMessageBatch / runDurableObjectAlarm)、TanStack Start/Query + react-aria-components + StyleX(admin)。

## 裁定事項(2026-07-18 ユーザー確定・全タスクの前提)

1. **実証モジュール = 予約(booking)**。論点W(公開 write + Turnstile + Rate Limiting)を本フェーズで消化。メール配信モジュールは作らない。
2. **G6 マニフェスト形式 = コード内静的レジストリ**。マニフェストは zod 検証つき純データ、フック実装と同じ TS ファイル群に同居。control-plane D1 での動的管理はしない(有効化状態のミラー `tenant_modules` のみ D1 に持つ — 再配布の宛先列挙用)。
3. **冒頭掃除 = 実害系 + Phase 9 隣接の 5 件のみ**(Task 1, 2, 3)。a11y 束・UI 挙動系・その他テスト追加系の §14 Minor 残り 6 件は Phase 10 へ。
4. **管理画面(面3)= 有効化トグルのみ**(Task 14)。予約 record は plugin 型として既存の汎用 content-types / records UI にそのまま載る。論点P の独自ルート(/modules/{id}/*)と unpublish 前 usage 警告 UI は Phase 10 へ。

## 設計確定事項(コントローラ裁定・計画作成時)

- **モジュール権限の展開**(§11.5): マニフェストの `permissions: [{key, roles}]` を有効化時に `module_registry.permissions`(JSON)へ書き込む。操作キーは `${moduleId}:${key}`(例 `booking:manage`)。`typeWriteGuards: {typeKey: permKey}` で「この型への認証済み書き込みはこの権限が必要」を宣言し、writeRecord / push / delete の RPC 入口で判定(既存の requireOperation と同じ場所)。**無効モジュールの型はガード非適用**(§9.5「コードが走らない」の帰結。申し送りに記録)。
- **booking の権限は `manage` = owner のみ**。editor は booking.resource / booking.slot は書けるが booking.reservation / booking.notification は書けない(デフォルト RBAC より狭める実証)。
- **モジュールフックの拒否コードは `${moduleId}:${reason}` の名前空間必須**(例 `booking:slot_full`)。`HookRejection.code` / `WriteRecordResult` の失敗 code をテンプレートリテラル型 `` `${string}:${string}` `` で拡張(ロードマップ §7 の「AckResult.code は string のまま」の受け皿を実装)。
- **イベント連鎖は 1 段まで**: `emitModuleEvents` は actor が `module:` 接頭辞の書き込み(イベント consumer / alarm ハンドラ由来)ではイベントを積まない。無限ループの構造的防止。
- **公開 write は新規作成のみ**: recordId はサーバー生成(route 側 uuidv7)。`modulePublicWrite` は既存 record への上書きを拒否する(§11.7 の濫用防止)。
- **濫用防止層は fail-closed**: TURNSTILE_SECRET_KEY 未設定・Rate Limiting バインディング不在の公開 write は 503(JWT_SECRET と同じ思想)。
- **source='plugin' 型のクライアント登録は閉じる**: プラグイン名前空間はモジュールシステム専有(§4.1「越境登録を拒否」)。registerContentTypeCore に `allowPlugin` オプションを追加し、RPC/HTTP 経由は拒否(system ガードと同型)。
- **型定義再配布のトリガー UI/API は Phase 10**(特権テナントの責務)。Phase 9 は機構(ジョブ 2 種 + DO 遅延再適用)を実装し、テストでキュー直接投入により実証する。
- **sync-protocol は変更しない**(AckResult.code は既に string。ACK_ERROR_CODES の拡張も不要 — モジュールコードはクライアントでは「その他エラー」として message 表示に落ちる)。

## Global Constraints

- コミット件名は **50 字以内**(フックには実体が無いためコントローラが手動検査する)。
- `@ts-expect-error` / `any` **禁止**。やむを得ない境界 cast は具体型 + 理由コメント(rpc-unwrap 様式)。
- bare `git stash` / `git stash pop` 禁止。`git add` は**明示パスのみ**(`git add -A` / `git add .` 禁止)。
- コミット前に **`pnpm format` をルートで実行**する(計画スニペットは oxfmt 整形済みとは限らない)。
- リンターは oxlint、フォーマッターは oxfmt。`pnpm lint` / `pnpm format:check`(ルート)で警告 0 を維持。
- apps/api は `"lib": ["ES2023"]`(DOM 型混入禁止)。
- **本フェーズは新規 npm 依存なし**(zod / hono / uuid / drizzle は導入済み。lockfile は変わらない)。
- **route のテストファイルを `apps/admin/src/routes/` に置かない**(ルート生成器がルートとして解釈する)。
- **Task 14 は新規ルートを足す** → `apps/admin/src/routeTree.gen.ts` の再生成が必要。`pnpm --filter @plyrs/admin build` は sandbox の EROFS で落ちるため、実装者はルートファイル作成後に **STATUS: NEEDS_CONTEXT で停止**し、コントローラが sandbox 無効で build → 実装者が再開してコミットする(二段方式)。
- **Task 5 の migration は drizzle-kit で実生成**(手書き SQL 禁止): `pnpm --filter @plyrs/db generate`(DO)/ `pnpm --filter @plyrs/db generate:d1`(control-plane)。
- `pnpm --filter X test -- <pattern>` はフィルタにならない。絞り込みは `pnpm --filter X exec vitest run <pattern>`。
- テスト実行はワークスペースルートから。**実出力をレポートに貼る**(要約・改変は重大違反)。
- vitest 末尾の「something prevents Vite server from exiting」は既知ノイズ(exit 0 なら無視)。
- **alarm の物理 setAlarm を新設コードから直接呼ばない**。必ず「registerAlarm → setAlarm(レジストリ全体の min)」の経路(armSweep 様式)に載せる(ロードマップ §9 の effectiveNow 制約)。
- モジュールフックの拒否コードは `${moduleId}:${reason}` 名前空間必須。システム語彙(WriteErrorCode)との衝突禁止。
- UI 文言は日本語。
- 公開 read API のクエリ語彙は本フェーズで**広げない**(バインド予算の回帰テスト更新不要。公開 write は新ルートで別系統)。

## File Structure(このフェーズで触るファイルの全体像)

```
apps/api/
  src/routes/tenant.ts                   # 掃除(Task 1) + modules 管理ルート(Task 11)
  src/auth/permissions.ts                # Operation に module:manage(Task 6)
  src/do/content-types.ts                # 同一定義 no-op + applied フラグ + allowPlugin(Task 3, 6)
  src/do/ensure-asset-type.ts            # (変更なし。no-op 検出の早期 return は既存のまま)
  src/do/hooks.ts                        # HookRejection 拡張 / relations / scheduleModuleAlarm(Task 7)
  src/do/types.ts                        # ModuleRejectionCode(Task 7)
  src/do/write-record.ts                 # モジュールフック合流 + イベント emit + seam(Task 7, 9)
  src/do/publish.ts                      # afterPublish emit(Task 9)
  src/do/alarms.ts                       # (変更なし — 既に汎用)
  src/modules/manifest.ts                # 新規: moduleManifestSchema(Task 4)
  src/modules/manifest.test.ts           # 新規(Task 4)
  src/modules/registry.ts                # 新規: ModuleDefinition + MODULE_REGISTRY(Task 4)
  src/modules/enablement.ts              # 新規: module_registry 読み書き + ガード(Task 6)
  src/modules/module-alarms.ts           # 新規: module:{id} kind ヘルパー(Task 8)
  src/modules/hooks.ts                   # 新規: 有効モジュールの beforeWrite 合流(Task 7)
  src/modules/events.ts                  # 新規: emit / drain / ジョブ型 / consumer(Task 9, 13)
  src/modules/turnstile.ts               # 新規: verifyTurnstile(Task 12)
  src/modules/booking/manifest.ts        # 新規: 型定義 4 種 + マニフェスト(Task 4)
  src/modules/booking/module.ts          # 新規: フック/イベント/alarm/公開エンドポイント(Task 10, 12)
  src/tenant-do.ts                       # enable/disable/list/apply/moduleWrite/modulePublicWrite RPC、
                                         # alarm ディスパッチ、write/push 経路の配線(Task 6, 8, 9, 12, 13)
  src/sync/handlers.ts                   # push 経路のモジュールガード + deps 透過(Task 6, 9)
  src/rpc-unwrap.ts                      # asModuleSummaries / asEnableModuleResult(Task 6)
  src/routes/public-write.ts             # 新規: 公開 write ルート(Task 12)
  src/index.ts                           # publicWriteRoutes マウント + modules キュー consumer(Task 9, 12)
  wrangler.jsonc                         # MODULES_QUEUE / plyrs-modules / unsafe ratelimit(Task 9, 12)
  env.d.ts                               # MODULES_QUEUE / TURNSTILE_SECRET_KEY / PUBLIC_WRITE_LIMITER(Task 9, 12)
  vitest.config.ts                       # TURNSTILE_SECRET_KEY テストバインディング(Task 12)
  test/asset-type.test.ts                # skip 分岐の実コンストラクタ経路化(Task 1)
  test/content-type-noop.test.ts         # 新規(Task 3)
  test/module-enablement.test.ts         # 新規(Task 6)
  test/module-hooks.test.ts              # 新規(Task 7)
  test/module-alarms.test.ts             # 新規(Task 8)
  test/module-events.test.ts             # 新規(Task 9)
  test/booking-module.test.ts            # 新規(Task 10)
  test/module-routes.test.ts             # 新規(Task 11)
  test/public-write.test.ts              # 新規(Task 12)
  test/module-redistribute.test.ts       # 新規(Task 13)
  test/module-flow.test.ts               # 新規: 一気通貫(Task 15)
packages/db/
  src/schema.ts                          # module_registry + module_events(Task 5)
  src/control-plane.ts                   # tenant_modules(Task 5)
  drizzle/0003_*.sql                     # 生成(Task 5)
  drizzle-d1/000X_*.sql                  # 生成(Task 5)
apps/admin/
  src/lib/record-label.ts                # 新規: labelForRecord 移設(Task 2)
  src/components/record-form.tsx         # labelForRecord 削除 + import(Task 2)
  src/components/asset-picker.tsx        # import 差し替え(Task 2)
  src/routes/t/$tenantSlug/records/$typeKey/index.tsx  # import 差し替え(Task 2)
  src/routes/t/$tenantSlug/assets/index.tsx            # import 差し替え(Task 2)
  src/lib/admin-api.ts                   # listModules / setModuleEnabled(Task 14)
  src/lib/queries.ts                     # modulesQueryOptions(Task 14)
  src/routes/t/$tenantSlug/modules/index.tsx  # 新規: 有効化トグルページ(Task 14)
  src/router.tsx                         # nav:item core.modules(Task 14)
  src/modules-page.test.tsx              # 新規(Task 14)
  src/routeTree.gen.ts                   # 再生成(Task 14・二段方式)
```

**タスク依存関係:** 1・2・3 は独立(並行可)。4 → 5 → 6 → 7 → 8 → 9 → 10 の順で積む。11 は 6 の後、12 は 10 の後、13 は 11 の後、14 は 11 の後、15 は最後。

---

### Task 1: 冒頭掃除(api 3 件)

§14 Minor のうち実害系 2 件 + Phase 9 の冪等マニフェスト適用の様式を先行整備する 1 件。

**Files:**
- Modify: `apps/api/src/routes/tenant.ts:79-130`(upload ルート)
- Modify: `apps/api/test/asset-type.test.ts:70-100`
- Test: `apps/api/test/asset-upload.test.ts`(追記)

**Interfaces:**
- Consumes: `can(role, operation)`(apps/api/src/auth/permissions.ts)、`evictDurableObject`(cloudflare:test)
- Produces: 変更なし(挙動修正のみ)

- [ ] **Step 1: viewer アップロード拒否の失敗テストを書く**

`apps/api/test/asset-upload.test.ts` に追記(既存の upload テスト様式に合わせて。R2 に put が走らないことまで検証):

```ts
it("viewer のアップロードは R2 put の前に 403 で拒否される", async () => {
  const tenantId = "asset-upload-viewer";
  const viewerToken = await tokenFor(tenantId, "viewer"); // 既存ヘルパーが無ければ本ファイルの owner トークン取得様式を role 違いで複製
  const res = await app.request(
    `/v1/t/${tenantId}/assets?filename=a.png`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${viewerToken}`, "content-type": "image/png" },
      body: new Uint8Array([1, 2, 3]),
    },
    env,
  );
  expect(res.status).toBe(403);
  // R2 に孤児バイナリが作られていない(put 自体が走っていない)
  const listed = await env.ASSETS.list({ prefix: `${tenantId}/` });
  expect(listed.objects.length).toBe(0);
});
```

注: 既存テストファイルのトークン取得・テナント準備の様式(signup → token)をそのまま使うこと。ヘルパー名が違う場合は実在のものに合わせる。

- [ ] **Step 2: テストが FAIL することを確認**

Run: `pnpm --filter @plyrs/api exec vitest run test/asset-upload.test.ts`
Expected: FAIL(現状は R2 put 後に DO が forbidden を返し、best-effort delete が走るため list が 0 でも 403 は返る — ただし delete 失敗時に孤児が残る競合窓がある。put が走らないことのアサートで FAIL する。もし delete が成功して 0 件になり緑になる場合は、`env.ASSETS.put` を観測するモックではなく、`c.env.ASSETS.delete` を一時的に throw させる手段が無いため、**アサートを「role 検証が put より前」の実装確認に頼らず、Step 3 実装後に GREEN になる形として、先に実装の無い状態で `403` + `orphan R2 object` の console.error が出ない**ことを確認する形でよい。判断に迷ったら実装を先にせず SUSPEND してレビュアーに相談)

- [ ] **Step 3: upload ルートに role 前置チェックを実装**

`apps/api/src/routes/tenant.ts` の upload ルート。`import { can } from "../auth/permissions";` を追加し、`const contentType = ...` の前(body 読み込みの直後、R2 put より前)に挿入:

```ts
// §14 Minor 消化: R2 put の前に役割を検証する(viewer の put → best-effort delete という
// 無駄な往復と、delete 失敗時の孤児バイナリを構造的に無くす)。DO 側の requireOperation は
// 防御の二層目としてそのまま残る。
if (!can(c.get("auth").role, "record:write")) {
  return c.json(
    { ok: false, code: "forbidden", message: "role cannot upload assets" },
    403,
  );
}
```

あわせて同ルートの content_type 切り詰めの定数流用を修正。`MAX_ASSET_FILENAME_LENGTH` の隣に追加し、slice を差し替え:

```ts
const MAX_ASSET_CONTENT_TYPE_LENGTH = 256; // asset 型の content_type フィールド maxLength と一致
```

```ts
content_type: contentType.slice(0, MAX_ASSET_CONTENT_TYPE_LENGTH),
```

- [ ] **Step 4: テストが PASS することを確認**

Run: `pnpm --filter @plyrs/api exec vitest run test/asset-upload.test.ts`
Expected: PASS(全既存テスト含む)

- [ ] **Step 5: ensure skip 分岐テストを実コンストラクタ経路に変更**

`apps/api/test/asset-type.test.ts` の skip 分岐テスト(70-100 行)を、直接呼び出しから「DO 退避 → 再構築」経路に変更する。import に `evictDurableObject` を追加し、describe 全体を置換:

```ts
describe("ensureAssetContentType の skip 分岐 (Phase 8 以前から key='asset' を持つテナント)", () => {
  // legacy 状態(key='asset' がユーザー型)は公開 API からは作れないため、構築済み DO の
  // content_types 行を直接書き換えて模擬する。Phase 8 では ensureAssetContentType を実引数で
  // 直接呼んでいたが、それでは「constructor の blockConcurrencyWhile が本当にこの分岐を通り、
  // throw せず起動が成立する」ことを担保しない。evictDurableObject + ping で実コンストラクタを
  // 再走行させる(sweeper.test.ts の再起動再現と同じ様式)。
  it("既存のユーザー型を上書きせず、DO は throw せずに再起動できる", async () => {
    const tenant = stub("asset-type-skip-legacy");
    await tenant.ping(); // 先に system 型の自動登録を完了させる

    const legacyId = "00000000-0000-7000-8000-0000000000aa";
    await runInDurableObject(tenant, async (_instance, state) => {
      state.storage.sql.exec(
        "UPDATE content_types SET id = ?, name = 'legacy', source = 'user', fields = '[]' WHERE key = 'asset'",
        legacyId,
      );
    });

    // インスタンスを破棄し、次の RPC で constructor(ensureAssetContentType 込み)を再走行させる
    await evictDurableObject(tenant);
    expect(await tenant.ping()).toBe("pong"); // throw せず起動できる(テナント全損しない)

    const row = asContentTypeRow(await tenant.getContentType(ASSET_TYPE_KEY));
    // 既存のユーザー型がそのまま残っている(system 型に上書きされていない)
    expect(row?.id).toBe(legacyId);
    expect(row?.source).toBe("user");
  });
});
```

`ensureAssetContentType` の import が未使用になったら削除する。

- [ ] **Step 6: テストが PASS することを確認**

Run: `pnpm --filter @plyrs/api exec vitest run test/asset-type.test.ts`
Expected: PASS(3 describe すべて)

- [ ] **Step 7: コミット**

```bash
pnpm format
git add apps/api/src/routes/tenant.ts apps/api/test/asset-type.test.ts apps/api/test/asset-upload.test.ts
git commit -m "fix: upload の役割前置と ensure skip の実経路化"
```

---

### Task 2: 冒頭掃除(admin: labelForRecord の循環解消)

record-form ⇄ asset-picker のモジュール循環(§14 Minor)を、共有関数の lib 抽出で解消する。

**Files:**
- Create: `apps/admin/src/lib/record-label.ts`
- Modify: `apps/admin/src/components/record-form.tsx`(labelForRecord 削除・import 追加)
- Modify: `apps/admin/src/components/asset-picker.tsx` / `apps/admin/src/routes/t/$tenantSlug/records/$typeKey/index.tsx` / `apps/admin/src/routes/t/$tenantSlug/assets/index.tsx`(import 差し替え)

**Interfaces:**
- Produces: `labelForRecord(types: ContentTypeDefinition[], record: SyncRecord): string`(`../lib/record-label` から export。実装は既存と同一)

- [ ] **Step 1: lib へ移設**

`apps/admin/src/lib/record-label.ts` を新規作成(record-form.tsx の既存実装をそのまま移す):

```ts
import type { ContentTypeDefinition } from "@plyrs/metamodel";
import type { SyncRecord } from "@plyrs/sync-protocol";

// 一覧・relation picker 共用: 最初の text フィールド値をラベルに、無ければ id 先頭 8 桁。
// record-form ⇄ asset-picker の循環 import を避けるため lib に置く(§14 Minor 消化)。
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
```

注: `SyncRecord` の import 元は record-form.tsx の既存 import と同じにする(`@plyrs/sync-protocol` でなければ実在の側に合わせる)。record-form.tsx から `labelForRecord` の定義を削除し、`import { labelForRecord } from "../lib/record-label";` を追加(record-form 内部の 2 使用箇所のため)。他 3 ファイルの import を `components/record-form` から `lib/record-label` の相対パスへ差し替える。

- [ ] **Step 2: 既存テストが PASS することを確認(挙動不変のリファクタ)**

Run: `pnpm --filter @plyrs/admin test`
Expected: PASS(128 tests。移設のみで挙動は変わらない)

- [ ] **Step 3: typecheck / lint**

Run: `pnpm typecheck && pnpm lint`
Expected: エラー 0・警告 0

- [ ] **Step 4: コミット**

```bash
pnpm format
git add apps/admin/src/lib/record-label.ts apps/admin/src/components/record-form.tsx apps/admin/src/components/asset-picker.tsx 'apps/admin/src/routes/t/$tenantSlug/records/$typeKey/index.tsx' 'apps/admin/src/routes/t/$tenantSlug/assets/index.tsx'
git commit -m "refactor: labelForRecord を lib へ抽出し循環を解消"
```

---

### Task 3: content_type 同一定義再登録の no-op 検出(§5 軽微の消化)

同一定義の再登録で version が +1 され続ける問題を解消する。Phase 9 の冪等マニフェスト再配信(Task 6/13 の applyModuleTypes)が「再適用しても version が動かない」ために必須の前提。

**Files:**
- Modify: `apps/api/src/do/content-types.ts`
- Test: `apps/api/test/content-type-noop.test.ts`(新規)

**Interfaces:**
- Consumes: `registerContentTypeCore(sql, input, now, options)`(既存)
- Produces: `RegisterContentTypeResult` の ok 枝に **`applied: boolean`** を追加。`{ ok: true; contentType: ContentTypeRow; applied: boolean }`。no-op のとき `applied: false` で既存行をそのまま返す(version 不変)。TenantDO.registerContentType は `applied: false` のときブロードキャストしない。

- [ ] **Step 1: 失敗テストを書く**

`apps/api/test/content-type-noop.test.ts` を新規作成:

```ts
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { asRegisterResult } from "../src/rpc-unwrap";
import type { AuthContext } from "../src/do/authorize";

const OWNER: AuthContext = { userId: "u-owner", role: "owner" };

function stub(name: string) {
  return env.TENANT_DO.get(env.TENANT_DO.idFromName(name));
}

function articleType() {
  return {
    id: "00000000-0000-7000-8000-00000000c001",
    key: "article",
    name: "記事",
    source: "user",
    version: 1,
    fields: [
      { key: "title", type: "text", required: true, config: { maxLength: 200 } },
      { key: "body", type: "richtext" },
    ],
  };
}

describe("同一定義の再登録は no-op (§5 軽微の消化 / 冪等マニフェスト再配信の前提)", () => {
  it("同一定義の再登録で version が進まず applied: false が返る", async () => {
    const tenant = stub("ct-noop-1");
    const first = asRegisterResult(await tenant.registerContentType(articleType(), OWNER));
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.applied).toBe(true);
    expect(first.contentType.version).toBe(1);

    const second = asRegisterResult(await tenant.registerContentType(articleType(), OWNER));
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.applied).toBe(false);
    expect(second.contentType.version).toBe(1); // 進まない
  });

  it("定義が実際に変わったときは従来どおり version が進む", async () => {
    const tenant = stub("ct-noop-2");
    await tenant.registerContentType(articleType(), OWNER);
    const changed = {
      ...articleType(),
      fields: [...articleType().fields, { key: "summary", type: "text" }],
    };
    const result = asRegisterResult(await tenant.registerContentType(changed, OWNER));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.applied).toBe(true);
    expect(result.contentType.version).toBe(2);
  });

  it("プロパティ記述順だけが違う同一定義も no-op になる(zod 正規化後比較)", async () => {
    const tenant = stub("ct-noop-3");
    await tenant.registerContentType(articleType(), OWNER);
    const reordered = {
      ...articleType(),
      fields: [
        { config: { maxLength: 200 }, required: true, type: "text", key: "title" },
        { type: "richtext", key: "body" },
      ],
    };
    const result = asRegisterResult(await tenant.registerContentType(reordered, OWNER));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.applied).toBe(false);
  });
});
```

- [ ] **Step 2: FAIL を確認**

Run: `pnpm --filter @plyrs/api exec vitest run test/content-type-noop.test.ts`
Expected: FAIL(`applied` が存在しない / version が 2 になる)

- [ ] **Step 3: registerContentTypeCore に no-op 検出を実装**

`apps/api/src/do/content-types.ts`:

1. 結果型を拡張:

```ts
export type RegisterContentTypeResult =
  | { ok: true; contentType: ContentTypeRow; applied: boolean }
  | {
      ok: false;
      code: "validation_failed" | "id_mismatch" | "key_mismatch" | "forbidden";
      message: string;
    };
```

2. `registerContentTypeCore` の key_mismatch ガードの直後・version 採番の前に挿入:

```ts
  // §5 軽微の消化: 同一定義の再登録は no-op(version を進めない)。ensure-asset-type.ts と
  // 同じく、比較は zod 正規化後の値同士で行う(parsed.data は正規化済み・DB の prev.fields も
  // 保存時に正規化済み)。冪等マニフェスト再配信(Phase 9)が「再適用で version が動かない」
  // ことに依存する。
  if (
    prev !== null &&
    prev.name === def.name &&
    prev.source === def.source &&
    prev.pluginId === (def.pluginId ?? null) &&
    JSON.stringify(prev.fields) === JSON.stringify(def.fields)
  ) {
    return { ok: true, contentType: prev, applied: false };
  }
```

3. 既存の成功 return に `applied: true` を追加。

4. `apps/api/src/tenant-do.ts` の `registerContentType` のブロードキャスト条件を `if (result.ok && result.applied)` に変更(no-op で全接続に型カタログを配り直さない)。

- [ ] **Step 4: PASS + 全体回帰を確認**

Run: `pnpm --filter @plyrs/api exec vitest run test/content-type-noop.test.ts && pnpm --filter @plyrs/api test`
Expected: 新規 3 テスト PASS。既存テストで「再登録で version +1」を assert しているものがあれば、それは**別定義への変更を意図したテストか確認の上**、同一定義再登録を前提にしていた場合のみ新挙動(不変)へ更新する。`pnpm typecheck` も実行(RegisterContentTypeResult の構造変化が admin 側 putContentType の型と両立することを確認 — admin は `{ok: true, contentType}` を構造的に読むだけなので追加フィールドは無害)。

- [ ] **Step 5: コミット**

```bash
pnpm format
git add apps/api/src/do/content-types.ts apps/api/src/tenant-do.ts apps/api/test/content-type-noop.test.ts
git commit -m "feat: 同一定義の content_type 再登録を no-op 化"
```

---

### Task 4: モジュールマニフェスト形式(G6)+ 静的レジストリ + booking マニフェスト

マニフェストの zod スキーマ、コード内静的レジストリの器、booking モジュールの純データ部分(型定義 4 種 + 権限宣言)を作る。**このタスクにフック実装は含めない**(booking/module.ts は Task 10)。

**Files:**
- Create: `apps/api/src/modules/manifest.ts`
- Create: `apps/api/src/modules/manifest.test.ts`
- Create: `apps/api/src/modules/registry.ts`
- Create: `apps/api/src/modules/booking/manifest.ts`

**Interfaces:**
- Consumes: `contentTypeDefinitionSchema`, `PLUGIN_ID_PATTERN`, `FIELD_KEY_PATTERN`(@plyrs/metamodel)、`ROLES`, `Role`(../auth/permissions)
- Produces:
  - `moduleManifestSchema` / `type ModuleManifest`
  - `moduleOperation(moduleId: string, permKey: string): string`(= `` `${moduleId}:${permKey}` ``)
  - `type ModuleDefinition`(manifest + 任意の beforeWrite / events / onAlarm / publicEndpoints — 後続タスクが型の中身を使う)
  - `MODULE_REGISTRY: Record<string, ModuleDefinition>` / `moduleById(id: string): ModuleDefinition | undefined` / `moduleCatalog(): ModuleDefinition[]`
  - `BOOKING_MODULE_ID = "booking"` / `BOOKING_MANIFEST: ModuleManifest` / 型キー定数 `BOOKING_RESOURCE_KEY = "booking.resource"`, `BOOKING_SLOT_KEY = "booking.slot"`, `BOOKING_RESERVATION_KEY = "booking.reservation"`, `BOOKING_NOTIFICATION_KEY = "booking.notification"`

- [ ] **Step 1: マニフェストスキーマの失敗テストを書く**

`apps/api/src/modules/manifest.test.ts`(pool-workers 環境だが純関数テスト):

```ts
import { describe, expect, it } from "vitest";
import { moduleManifestSchema, moduleOperation } from "./manifest";
import { BOOKING_MANIFEST } from "./booking/manifest";

function minimalManifest() {
  return {
    moduleId: "demo",
    version: 1,
    name: "デモ",
    contentTypes: [
      {
        id: "00000000-0000-7000-8000-00000000d001",
        key: "demo.item",
        name: "アイテム",
        source: "plugin",
        pluginId: "demo",
        version: 1,
        fields: [{ key: "title", type: "text", required: true }],
      },
    ],
    permissions: [{ key: "manage", roles: ["owner"] }],
    typeWriteGuards: { "demo.item": "manage" },
    publicWriteTypes: ["demo.item"],
  };
}

describe("moduleManifestSchema", () => {
  it("整合したマニフェストを受理する", () => {
    expect(moduleManifestSchema.safeParse(minimalManifest()).success).toBe(true);
  });

  it("moduleId と一致しない pluginId の型を拒否する", () => {
    const bad = minimalManifest();
    bad.contentTypes[0].pluginId = "other";
    bad.contentTypes[0].key = "other.item";
    expect(moduleManifestSchema.safeParse(bad).success).toBe(false);
  });

  it("source が plugin でない型を拒否する", () => {
    const bad = minimalManifest();
    bad.contentTypes[0].source = "user";
    delete (bad.contentTypes[0] as Record<string, unknown>).pluginId;
    bad.contentTypes[0].key = "item";
    expect(moduleManifestSchema.safeParse(bad).success).toBe(false);
  });

  it("マニフェスト外の型を指す typeWriteGuards / publicWriteTypes を拒否する", () => {
    const badGuard = { ...minimalManifest(), typeWriteGuards: { "demo.ghost": "manage" } };
    expect(moduleManifestSchema.safeParse(badGuard).success).toBe(false);
    const badPublic = { ...minimalManifest(), publicWriteTypes: ["demo.ghost"] };
    expect(moduleManifestSchema.safeParse(badPublic).success).toBe(false);
  });

  it("未宣言の権限キーを指す typeWriteGuards を拒否する", () => {
    const bad = { ...minimalManifest(), typeWriteGuards: { "demo.item": "ghost" } };
    expect(moduleManifestSchema.safeParse(bad).success).toBe(false);
  });

  it("moduleOperation は名前空間つき操作キーを作る", () => {
    expect(moduleOperation("booking", "manage")).toBe("booking:manage");
  });
});

describe("BOOKING_MANIFEST", () => {
  it("スキーマ検証を通る(4 型・manage 権限・reservation の公開 write 宣言)", () => {
    const parsed = moduleManifestSchema.safeParse(BOOKING_MANIFEST);
    expect(parsed.success).toBe(true);
    expect(BOOKING_MANIFEST.contentTypes.map((t) => t.key)).toEqual([
      "booking.resource",
      "booking.slot",
      "booking.reservation",
      "booking.notification",
    ]);
    expect(BOOKING_MANIFEST.publicWriteTypes).toEqual(["booking.reservation"]);
    expect(BOOKING_MANIFEST.typeWriteGuards).toEqual({
      "booking.reservation": "manage",
      "booking.notification": "manage",
    });
  });
});
```

- [ ] **Step 2: FAIL を確認**

Run: `pnpm --filter @plyrs/api exec vitest run src/modules/manifest.test.ts`
Expected: FAIL(モジュールが存在しない)

- [ ] **Step 3: manifest.ts を実装**

`apps/api/src/modules/manifest.ts`:

```ts
import { contentTypeDefinitionSchema, FIELD_KEY_PATTERN, PLUGIN_ID_PATTERN } from "@plyrs/metamodel";
import { z } from "zod";
import { ROLES } from "../auth/permissions";

// design-spec §4.2 / G6(2026-07-18 裁定): モジュールマニフェスト = zod 検証つき純データ。
// フック実装(コード)とはファイルを分け、マニフェストだけで「型・権限・公開 write の宣言」が
// 完結する。version はマニフェスト全体の版(型定義再配布の冪等判定に使う)。
export const moduleManifestSchema = z
  .strictObject({
    moduleId: z.string().regex(PLUGIN_ID_PATTERN),
    version: z.number().int().positive(),
    name: z.string().min(1),
    contentTypes: z.array(contentTypeDefinitionSchema),
    // 操作キーは `${moduleId}:${key}` に展開される(§11.3 のモジュール独自権限)
    permissions: z.array(
      z.strictObject({
        key: z.string().regex(FIELD_KEY_PATTERN),
        roles: z.array(z.enum(ROLES)).min(1),
      }),
    ),
    // 「この型への認証済み書き込みはこの権限が必要」(§11.5 の型×操作の一部をモジュールが狭める)
    typeWriteGuards: z.record(z.string(), z.string().regex(FIELD_KEY_PATTERN)),
    // §11.7 第2段: 公開 write エンドポイントが作成してよい型の許可リスト
    publicWriteTypes: z.array(z.string()),
  })
  .superRefine((manifest, ctx) => {
    const typeKeys = new Set(manifest.contentTypes.map((ct) => ct.key));
    for (const ct of manifest.contentTypes) {
      if (ct.source !== "plugin" || ct.pluginId !== manifest.moduleId) {
        ctx.addIssue({
          code: "custom",
          path: ["contentTypes"],
          message: `type '${ct.key}' must be source 'plugin' owned by '${manifest.moduleId}'`,
        });
      }
    }
    const permKeys = new Set<string>();
    for (const perm of manifest.permissions) {
      if (permKeys.has(perm.key)) {
        ctx.addIssue({ code: "custom", path: ["permissions"], message: `duplicate permission key: ${perm.key}` });
      }
      permKeys.add(perm.key);
    }
    for (const [typeKey, permKey] of Object.entries(manifest.typeWriteGuards)) {
      if (!typeKeys.has(typeKey)) {
        ctx.addIssue({ code: "custom", path: ["typeWriteGuards"], message: `unknown type: ${typeKey}` });
      }
      if (!permKeys.has(permKey)) {
        ctx.addIssue({ code: "custom", path: ["typeWriteGuards"], message: `unknown permission: ${permKey}` });
      }
    }
    for (const typeKey of manifest.publicWriteTypes) {
      if (!typeKeys.has(typeKey)) {
        ctx.addIssue({ code: "custom", path: ["publicWriteTypes"], message: `unknown type: ${typeKey}` });
      }
    }
  });

export type ModuleManifest = z.infer<typeof moduleManifestSchema>;

export function moduleOperation(moduleId: string, permKey: string): string {
  return `${moduleId}:${permKey}`;
}
```

- [ ] **Step 4: registry.ts を実装**

`apps/api/src/modules/registry.ts`:

```ts
import type { z } from "zod";
import type { BeforeWriteHook } from "../do/hooks";
import type { WriteRecordInput, WriteRecordResult } from "../do/types";
import type { ModuleManifest } from "./manifest";
import { bookingModule } from "./booking/module";

// design-spec §9.1: ファーストパーティ・サンドボックスなし。モジュール = このレジストリに
// 静的登録された TS オブジェクト(G6 裁定: コード内静的レジストリ)。有効化していない
// モジュールのフック・イベント・alarm・公開エンドポイントは一切走らない(§9.5)。

export type ModuleEventName = "afterWrite" | "afterPublish";

// Queues consumer 側でイベントを処理する文脈(§9.3 非同期副作用フック)。
// writeRecord は DO の moduleWrite RPC 経由のシステム書き込み(actor = module:{id})。
export interface ModuleEventContext {
  env: Env;
  tenantId: string;
  recordId: string;
  typeKey: string;
  newId(): string;
  writeRecord(typeKey: string, params: WriteRecordInput): Promise<WriteRecordResult>;
}

// DO 内 alarm ハンドラの文脈(§9.6)。schedule はレジストリ登録のみ
// (物理 setAlarm は TenantDO.alarm() 末尾の minDueAt 経路が一本で担う — §9 申し送りの制約)。
export interface ModuleAlarmContext {
  sql: SqlStorage;
  now: number; // effectiveNow(epoch ms)
  schedule(dueAtMs: number): void;
  writeRecord(typeKey: string, params: WriteRecordInput): WriteRecordResult;
}

// §11.7: 公開 write エンドポイント宣言。recordId はサーバー生成(buildWrite の ids.newId)。
export interface PublicWriteEndpoint {
  typeKey: string;
  inputSchema: z.ZodType<Record<string, unknown>>;
  buildWrite(input: Record<string, unknown>, ids: { newId(): string }): WriteRecordInput;
}

export interface ModuleDefinition {
  manifest: ModuleManifest;
  beforeWrite?: BeforeWriteHook;
  events?: Partial<
    Record<ModuleEventName, { types: readonly string[]; handle(ctx: ModuleEventContext): Promise<void> }>
  >;
  onAlarm?(ctx: ModuleAlarmContext): void;
  publicEndpoints?: Record<string, PublicWriteEndpoint>;
}

export const MODULE_REGISTRY: Record<string, ModuleDefinition> = {
  [bookingModule.manifest.moduleId]: bookingModule,
};

export function moduleById(id: string): ModuleDefinition | undefined {
  return MODULE_REGISTRY[id];
}

export function moduleCatalog(): ModuleDefinition[] {
  return Object.values(MODULE_REGISTRY).toSorted((a, b) =>
    a.manifest.moduleId.localeCompare(b.manifest.moduleId),
  );
}
```

注: この時点で `bookingModule` が必要になるため、Task 10 までの仮実装として `apps/api/src/modules/booking/module.ts` に **マニフェストのみのモジュール** を先に置く:

```ts
import type { ModuleDefinition } from "../registry";
import { BOOKING_MANIFEST } from "./manifest";

// フック・イベント・alarm・公開エンドポイントは Task 10 / 12 で実装する。
export const bookingModule: ModuleDefinition = {
  manifest: BOOKING_MANIFEST,
};
```

- [ ] **Step 5: booking/manifest.ts を実装**

`apps/api/src/modules/booking/manifest.ts`:

```ts
import type { ContentTypeDefinition } from "@plyrs/metamodel";
import type { ModuleManifest } from "../manifest";

// design-spec §9.8: 予約 = resource / slot / reservation の型合成 + 状態スカラー。
// 「属性を持つ関係のコンテンツ型化」の実例。notification は確認メール送信の代替
// (面4 の外部送信は非目標のまま)で、afterWrite イベントの冪等消化を担う。
export const BOOKING_MODULE_ID = "booking";

export const BOOKING_RESOURCE_KEY = "booking.resource";
export const BOOKING_SLOT_KEY = "booking.slot";
export const BOOKING_RESERVATION_KEY = "booking.reservation";
export const BOOKING_NOTIFICATION_KEY = "booking.notification";

// 全テナント共通の固定 ID(asset 型と同じ予約値方式。uuidSchema を満たす hex のみ)
const RESOURCE_TYPE_ID = "00000000-0000-7000-8000-00000b00c001";
const SLOT_TYPE_ID = "00000000-0000-7000-8000-00000b00c002";
const RESERVATION_TYPE_ID = "00000000-0000-7000-8000-00000b00c003";
const NOTIFICATION_TYPE_ID = "00000000-0000-7000-8000-00000b00c004";

export const BOOKING_RESERVATION_STATES = ["pending", "confirmed", "cancelled"] as const;

const contentTypes: ContentTypeDefinition[] = [
  {
    id: RESOURCE_TYPE_ID,
    key: BOOKING_RESOURCE_KEY,
    name: "予約リソース",
    source: "plugin",
    pluginId: BOOKING_MODULE_ID,
    version: 1,
    fields: [{ key: "name", type: "text", required: true, config: { maxLength: 200 } }],
  },
  {
    id: SLOT_TYPE_ID,
    key: BOOKING_SLOT_KEY,
    name: "予約枠",
    source: "plugin",
    pluginId: BOOKING_MODULE_ID,
    version: 1,
    fields: [
      {
        key: "resource",
        type: "relation",
        required: true,
        config: { allowedTypes: [BOOKING_RESOURCE_KEY], cardinality: "one" },
      },
      { key: "starts_at", type: "datetime", required: true, config: { indexed: true } },
      { key: "ends_at", type: "datetime", required: true },
      { key: "capacity", type: "number", required: true, config: { integer: true } },
    ],
  },
  {
    id: RESERVATION_TYPE_ID,
    key: BOOKING_RESERVATION_KEY,
    name: "予約",
    source: "plugin",
    pluginId: BOOKING_MODULE_ID,
    version: 1,
    fields: [
      {
        key: "slot",
        type: "relation",
        required: true,
        config: { allowedTypes: [BOOKING_SLOT_KEY], cardinality: "one" },
      },
      { key: "name", type: "text", required: true, config: { maxLength: 200 } },
      { key: "email", type: "text", required: true, config: { maxLength: 320 } },
      {
        key: "state",
        type: "select",
        required: true,
        config: {
          options: [
            { value: "pending", label: "仮予約" },
            { value: "confirmed", label: "確定" },
            { value: "cancelled", label: "取消" },
          ],
          indexed: true,
        },
      },
    ],
  },
  {
    id: NOTIFICATION_TYPE_ID,
    key: BOOKING_NOTIFICATION_KEY,
    name: "予約通知",
    source: "plugin",
    pluginId: BOOKING_MODULE_ID,
    version: 1,
    fields: [
      // afterWrite の at-least-once 配送を冪等に畳む鍵(unique 制約 → 二重配送は unique_violation)
      { key: "reservation_id", type: "text", required: true, config: { maxLength: 64, unique: true } },
      { key: "kind", type: "text", required: true, config: { maxLength: 64 } },
    ],
  },
];

export const BOOKING_MANIFEST: ModuleManifest = {
  moduleId: BOOKING_MODULE_ID,
  version: 1,
  name: "予約",
  contentTypes,
  // manage = owner のみ(editor のデフォルト record:write より狭める実証 — 2026-07-18 設計確定)
  permissions: [{ key: "manage", roles: ["owner"] }],
  typeWriteGuards: {
    [BOOKING_RESERVATION_KEY]: "manage",
    [BOOKING_NOTIFICATION_KEY]: "manage",
  },
  publicWriteTypes: [BOOKING_RESERVATION_KEY],
};
```

- [ ] **Step 6: PASS を確認**

Run: `pnpm --filter @plyrs/api exec vitest run src/modules/manifest.test.ts`
Expected: PASS(7 tests)。`pnpm typecheck` も通ること。

- [ ] **Step 7: コミット**

```bash
pnpm format
git add apps/api/src/modules/manifest.ts apps/api/src/modules/manifest.test.ts apps/api/src/modules/registry.ts apps/api/src/modules/booking/manifest.ts apps/api/src/modules/booking/module.ts
git commit -m "feat: モジュールマニフェストと静的レジストリ(G6)"
```

---

### Task 5: DB migration(module_registry / module_events / tenant_modules)

DO 内の有効化レジストリ・モジュールイベント outbox と、control-plane D1 の有効化ミラーを drizzle-kit で実生成する。

**Files:**
- Modify: `packages/db/src/schema.ts`
- Modify: `packages/db/src/control-plane.ts`
- Create(生成): `packages/db/drizzle/0003_*.sql` + meta / `packages/db/drizzle-d1/000X_*.sql`

**Interfaces:**
- Produces: テーブル `module_registry(module_id PK, enabled, applied_version, permissions, updated_at)` / `module_events(id PK, module_id, event, record_id, type, enqueued_at, sent)` / D1 `tenant_modules(tenant_id, module_id, enabled, updated_at)` PK(tenant_id, module_id)

- [ ] **Step 1: schema.ts にテーブルを追加**

`packages/db/src/schema.ts` 末尾に追加:

```ts
// design-spec §9.5 / §11.5: テナントごとのモジュール有効化レジストリ。適用済みマニフェスト
// version(§4.2 の冪等再配布の適用状態)と、有効化時に展開した権限宣言(JSON:
// { grants: {opKey: roles[]}, typeWriteGuards: {typeKey: opKey} })も同居させる。
export const moduleRegistry = sqliteTable("module_registry", {
  moduleId: text("module_id").primaryKey(),
  enabled: integer("enabled").notNull().default(0), // 0 | 1
  appliedVersion: integer("applied_version").notNull().default(0),
  permissions: text("permissions").notNull().default("{}"),
  updatedAt: text("updated_at").notNull(),
});

// design-spec §9.3 / §9.4 ステップ5: afterWrite / afterPublish イベントの outbox。
// コミットと同一トランザクションで積み、Queues(plyrs-modules)へ排出する(§12.3 と同型)。
export const moduleEvents = sqliteTable(
  "module_events",
  {
    id: text("id").primaryKey(), // uuidv7
    moduleId: text("module_id").notNull(),
    event: text("event").notNull(), // 'afterWrite' | 'afterPublish'
    recordId: text("record_id").notNull(),
    type: text("type").notNull(),
    enqueuedAt: text("enqueued_at").notNull(),
    sent: integer("sent").notNull().default(0),
  },
  (table) => [index("idx_module_events_unsent").on(table.sent, table.enqueuedAt)],
);
```

- [ ] **Step 2: control-plane.ts にミラーを追加**

`packages/db/src/control-plane.ts` 末尾に追加:

```ts
// Phase 9: モジュール有効化の control-plane ミラー。真実源は各テナント DO の module_registry
// で、この表は型定義再配布(§4.2 の Queues 配信)が「どのテナントに配るか」を DO を起こさずに
// 列挙するための派生。enable/disable の HTTP ルートが best-effort で書く(失敗しても DO 側の
// 起床時遅延適用が安全網)。
export const tenantModules = sqliteTable(
  "tenant_modules",
  {
    tenantId: text("tenant_id").notNull(),
    moduleId: text("module_id").notNull(),
    enabled: integer("enabled").notNull().default(0),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.moduleId] }),
    index("idx_tenant_modules_module").on(table.moduleId, table.enabled),
  ],
);
```

`integer` の import が control-plane.ts に無ければ追加する。

- [ ] **Step 3: migration を実生成し内容を確認**

Run: `pnpm --filter @plyrs/db generate && pnpm --filter @plyrs/db generate:d1`
Expected: `drizzle/0003_*.sql`(CREATE TABLE module_registry / module_events + index)と `drizzle-d1/` の新番号 SQL(CREATE TABLE tenant_modules)が生成される。**生成された SQL を必ず cat してレポートに貼る**。既存テーブルへの ALTER や DROP が混ざっていないこと(§5 の records 再ビルド禁止規約)。

- [ ] **Step 4: テストが PASS することを確認**

Run: `pnpm --filter @plyrs/db test && pnpm --filter @plyrs/api test`
Expected: PASS(api 側は JIT migration が新テーブルを適用して従来テストが緑のまま。D1 側は readD1Migrations が新 SQL を拾う)

- [ ] **Step 5: コミット**

```bash
pnpm format
git add packages/db/src/schema.ts packages/db/src/control-plane.ts packages/db/drizzle packages/db/drizzle-d1
git commit -m "feat: モジュール有効化と events の migration"
```

---

### Task 6: DO 有効化レジストリ(enable / disable / list)+ 権限展開 + 書き込みガード

§9.5 の有効化レジストリと §11.5 のモジュール権限展開を DO に実装する。プラグイン型のクライアント登録も閉じる。

**Files:**
- Create: `apps/api/src/modules/enablement.ts`
- Modify: `apps/api/src/auth/permissions.ts`(Operation + owner へ `module:manage`)
- Modify: `apps/api/src/do/content-types.ts`(`allowPlugin` オプション)
- Modify: `apps/api/src/tenant-do.ts`(enableModule / disableModule / listModules RPC + writeRecord / deleteRecord のガード)
- Modify: `apps/api/src/sync/handlers.ts`(push 経路のガード)
- Modify: `apps/api/src/rpc-unwrap.ts`
- Test: `apps/api/test/module-enablement.test.ts`(新規)

**Interfaces:**
- Produces(enablement.ts):
  - `interface StoredModulePermissions { grants: Record<string, readonly Role[]>; typeWriteGuards: Record<string, string> }`
  - `permissionsFromManifest(manifest: ModuleManifest): StoredModulePermissions`
  - `interface ModuleRegistryRow { moduleId: string; enabled: boolean; appliedVersion: number; permissions: StoredModulePermissions }`
  - `moduleRegistryRow(sql, moduleId): ModuleRegistryRow | null` / `moduleRegistryRows(sql): ModuleRegistryRow[]`
  - `isModuleEnabled(sql, moduleId): boolean` / `enabledModuleIds(sql): string[]`
  - `upsertModuleEnablement(sql, args: { moduleId: string; enabled: boolean; appliedVersion: number; permissions: StoredModulePermissions; now: string }): void`
  - `applyModuleTypes(sql, manifest: ModuleManifest, now: string): boolean`(1 型でも applied なら true。失敗は throw)
  - `moduleWriteDenial(sql, contentType: ContentTypeRow, role: Role): { code: "forbidden"; message: string } | null`
- Produces(TenantDO):
  - `interface ModuleSummary { moduleId: string; name: string; version: number; enabled: boolean; appliedVersion: number }`
  - `enableModule(tenantId: string, moduleId: string, auth: AuthContext): EnableModuleResult`(`{ ok: true; module: ModuleSummary } | { ok: false; code: "forbidden" | "unknown_module" | "type_conflict"; message: string }`)
  - `disableModule(tenantId, moduleId, auth): EnableModuleResult` / `listModules(): ModuleSummary[]`
- Produces(rpc-unwrap): `asModuleSummaries` / `asEnableModuleResult`

- [ ] **Step 1: 失敗テストを書く**

`apps/api/test/module-enablement.test.ts`:

```ts
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { BOOKING_MANIFEST, BOOKING_RESERVATION_KEY, BOOKING_RESOURCE_KEY } from "../src/modules/booking/manifest";
import { asContentTypeRow, asEnableModuleResult, asModuleSummaries, asWriteResult } from "../src/rpc-unwrap";
import type { AuthContext } from "../src/do/authorize";

const OWNER: AuthContext = { userId: "u-owner", role: "owner", tenantId: "t-mod" };
const EDITOR: AuthContext = { userId: "u-editor", role: "editor", tenantId: "t-mod" };

function stub(name: string) {
  return env.TENANT_DO.get(env.TENANT_DO.idFromName(name));
}

function uuid(n: number): string {
  return `00000000-0000-7000-8000-${String(n).padStart(12, "0")}`;
}

describe("モジュール有効化レジストリ (design-spec §9.5)", () => {
  it("enable で booking の 4 型が登録され applied version が刻まれる", async () => {
    const tenant = stub("mod-enable-1");
    const result = asEnableModuleResult(await tenant.enableModule("t-mod", "booking", OWNER));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.module).toEqual({
      moduleId: "booking",
      name: "予約",
      version: BOOKING_MANIFEST.version,
      enabled: true,
      appliedVersion: BOOKING_MANIFEST.version,
    });
    const row = asContentTypeRow(await tenant.getContentType(BOOKING_RESOURCE_KEY));
    expect(row?.source).toBe("plugin");
    expect(row?.pluginId).toBe("booking");
  });

  it("enable は冪等(再 enable で型 version が進まない)", async () => {
    const tenant = stub("mod-enable-2");
    await tenant.enableModule("t-mod", "booking", OWNER);
    const before = asContentTypeRow(await tenant.getContentType(BOOKING_RESOURCE_KEY));
    await tenant.enableModule("t-mod", "booking", OWNER);
    const after = asContentTypeRow(await tenant.getContentType(BOOKING_RESOURCE_KEY));
    expect(after?.version).toBe(before?.version);
  });

  it("editor は enable できない(module:manage は owner のみ)", async () => {
    const tenant = stub("mod-enable-3");
    const result = asEnableModuleResult(await tenant.enableModule("t-mod", "booking", EDITOR));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("forbidden");
  });

  it("未知のモジュールは unknown_module", async () => {
    const tenant = stub("mod-enable-4");
    const result = asEnableModuleResult(await tenant.enableModule("t-mod", "ghost", OWNER));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("unknown_module");
  });

  it("listModules はカタログ + 有効化状態を返す(未有効時 enabled: false)", async () => {
    const tenant = stub("mod-enable-5");
    const before = asModuleSummaries(await tenant.listModules());
    expect(before).toEqual([
      { moduleId: "booking", name: "予約", version: 1, enabled: false, appliedVersion: 0 },
    ]);
    await tenant.enableModule("t-mod", "booking", OWNER);
    await tenant.disableModule("t-mod", "booking", OWNER);
    const after = asModuleSummaries(await tenant.listModules());
    expect(after[0]).toMatchObject({ enabled: false, appliedVersion: 1 }); // 型は残る(§9.5)
  });
});

describe("モジュール権限の書き込みガード (design-spec §11.5)", () => {
  it("editor は booking.resource を書けるが booking.reservation は forbidden", async () => {
    const tenant = stub("mod-guard-1");
    await tenant.enableModule("t-mod", "booking", OWNER);
    const resource = asWriteResult(
      await tenant.writeRecord(
        BOOKING_RESOURCE_KEY,
        { recordId: uuid(1), input: { name: "会議室A" } },
        EDITOR,
      ),
    );
    expect(resource.ok).toBe(true);
    const reservation = asWriteResult(
      await tenant.writeRecord(
        BOOKING_RESERVATION_KEY,
        { recordId: uuid(2), input: { name: "x", email: "x@example.com", state: "pending", slot: { type: "booking.slot", id: uuid(9) } } },
        EDITOR,
      ),
    );
    expect(reservation.ok).toBe(false);
    if (reservation.ok) return;
    expect(reservation.code).toBe("forbidden");
  });

  it("モジュールを無効化するとガードは適用されない(§9.5: コードが走らない)", async () => {
    const tenant = stub("mod-guard-2");
    await tenant.enableModule("t-mod", "booking", OWNER);
    await tenant.disableModule("t-mod", "booking", OWNER);
    const result = asWriteResult(
      await tenant.writeRecord(
        BOOKING_RESOURCE_KEY,
        { recordId: uuid(3), input: { name: "残存型への書き込み" } },
        EDITOR,
      ),
    );
    expect(result.ok).toBe(true);
  });
});

describe("plugin 型のクライアント登録は閉じる (§4.1 越境登録の拒否)", () => {
  it("registerContentType RPC は source='plugin' を forbidden で拒否する", async () => {
    const tenant = stub("mod-plugin-closed");
    const result = await tenant.registerContentType(
      {
        id: uuid(100),
        key: "ghost.item",
        name: "偽プラグイン型",
        source: "plugin",
        pluginId: "ghost",
        version: 1,
        fields: [],
      },
      OWNER,
    );
    expect((result as { ok: boolean }).ok).toBe(false);
    expect((result as { code: string }).code).toBe("forbidden");
  });
});
```

注: `AuthContext` に `tenantId` を渡している(Step 3 で optional フィールドとして追加する)。booking.reservation の書き込みは slot が dangling でも通る(ソフト参照)— Task 10 で空き枠フックが入ると `booking:unknown_slot` になるため、**このテストの reservation ケースは Task 10 で期待値を更新することをテスト内コメントに書いておく**(ガードは requireOperation と同じ入口で走り、フックより先に落ちるので実際には変わらない — editor は forbidden のまま)。

- [ ] **Step 2: FAIL を確認**

Run: `pnpm --filter @plyrs/api exec vitest run test/module-enablement.test.ts`
Expected: FAIL(RPC が存在しない)

- [ ] **Step 3: 実装**

(a) `apps/api/src/auth/permissions.ts`: `Operation` に `"module:manage"` を追加し、`ROLE_PERMISSIONS.owner` にのみ足す。

(b) `apps/api/src/do/authorize.ts`: `AuthContext` に optional フィールドを追加:

```ts
export interface AuthContext {
  userId: string;
  role: Role;
  // テナント境界を跨いで運ばれる場合のみ存在(HTTP ゲート / WS ソケット auth 由来)。
  // Phase 9: module_events の排出先(do_config.tenant_id)を write 経路でも刻むために使う。
  tenantId?: string;
}
```

(c) `apps/api/src/do/content-types.ts`: `registerContentTypeCore` の options を `{ allowSystem?: boolean; allowPlugin?: boolean }` に広げ、system ガードの直後に追加:

```ts
  // Phase 9: プラグイン名前空間はモジュールシステム専有(§4.1)。クライアント経由の登録を
  // 許すと、モジュール有効化時の固定 ID と衝突して enable が type_conflict で恒久失敗する。
  if (options.allowPlugin !== true && (def.source === "plugin" || prev?.source === "plugin")) {
    return {
      ok: false,
      code: "forbidden",
      message: "plugin content types are managed by modules",
    };
  }
```

(d) `apps/api/src/modules/enablement.ts`:

```ts
import type { Role } from "../auth/permissions";
import { registerContentTypeCore, type ContentTypeRow } from "../do/content-types";
import type { ModuleManifest } from "./manifest";
import { moduleOperation } from "./manifest";

export interface StoredModulePermissions {
  grants: Record<string, readonly Role[]>;
  typeWriteGuards: Record<string, string>;
}

// §11.5: 有効化時にマニフェストの権限宣言を DO ローカルへ展開する(判定時に外部照会しない)
export function permissionsFromManifest(manifest: ModuleManifest): StoredModulePermissions {
  const grants: Record<string, readonly Role[]> = {};
  for (const perm of manifest.permissions) {
    grants[moduleOperation(manifest.moduleId, perm.key)] = perm.roles;
  }
  const typeWriteGuards: Record<string, string> = {};
  for (const [typeKey, permKey] of Object.entries(manifest.typeWriteGuards)) {
    typeWriteGuards[typeKey] = moduleOperation(manifest.moduleId, permKey);
  }
  return { grants, typeWriteGuards };
}

export interface ModuleRegistryRow {
  moduleId: string;
  enabled: boolean;
  appliedVersion: number;
  permissions: StoredModulePermissions;
}

interface RawModuleRegistryRow extends Record<string, SqlStorageValue> {
  module_id: string;
  enabled: number;
  applied_version: number;
  permissions: string;
}

function rowToModuleRegistryRow(row: RawModuleRegistryRow): ModuleRegistryRow {
  return {
    moduleId: row.module_id,
    enabled: row.enabled === 1,
    appliedVersion: row.applied_version,
    permissions: JSON.parse(row.permissions) as StoredModulePermissions,
  };
}

export function moduleRegistryRow(sql: SqlStorage, moduleId: string): ModuleRegistryRow | null {
  const row = sql
    .exec<RawModuleRegistryRow>(
      "SELECT module_id, enabled, applied_version, permissions FROM module_registry WHERE module_id = ?",
      moduleId,
    )
    .toArray()[0];
  return row === undefined ? null : rowToModuleRegistryRow(row);
}

export function moduleRegistryRows(sql: SqlStorage): ModuleRegistryRow[] {
  return sql
    .exec<RawModuleRegistryRow>(
      "SELECT module_id, enabled, applied_version, permissions FROM module_registry ORDER BY module_id",
    )
    .toArray()
    .map(rowToModuleRegistryRow);
}

export function isModuleEnabled(sql: SqlStorage, moduleId: string): boolean {
  return moduleRegistryRow(sql, moduleId)?.enabled === true;
}

export function enabledModuleIds(sql: SqlStorage): string[] {
  return sql
    .exec<{ module_id: string }>(
      "SELECT module_id FROM module_registry WHERE enabled = 1 ORDER BY module_id",
    )
    .toArray()
    .map((row) => row.module_id);
}

export function upsertModuleEnablement(
  sql: SqlStorage,
  args: {
    moduleId: string;
    enabled: boolean;
    appliedVersion: number;
    permissions: StoredModulePermissions;
    now: string;
  },
): void {
  sql.exec(
    "INSERT INTO module_registry (module_id, enabled, applied_version, permissions, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(module_id) DO UPDATE SET enabled = excluded.enabled, applied_version = excluded.applied_version, permissions = excluded.permissions, updated_at = excluded.updated_at",
    args.moduleId,
    args.enabled ? 1 : 0,
    args.appliedVersion,
    JSON.stringify(args.permissions),
    args.now,
  );
}

// §4.2: マニフェストの型定義を冪等適用する。同一定義は Task 3 の no-op 検出で version が
// 動かない。失敗(id_mismatch 等)は呼び出し側でロールバックさせるため throw する。
export function applyModuleTypes(sql: SqlStorage, manifest: ModuleManifest, now: string): boolean {
  let changed = false;
  for (const def of manifest.contentTypes) {
    const result = registerContentTypeCore(sql, def, now, { allowPlugin: true });
    if (!result.ok) {
      throw new Error(`module type registration failed for '${def.key}': ${result.message}`);
    }
    if (result.applied) {
      changed = true;
    }
  }
  return changed;
}

// §11.5: 型×操作ガード。無効モジュールの型はガード非適用(§9.5 コードが走らない、の帰結)。
export function moduleWriteDenial(
  sql: SqlStorage,
  contentType: ContentTypeRow,
  role: Role,
): { code: "forbidden"; message: string } | null {
  if (contentType.source !== "plugin" || contentType.pluginId === null) {
    return null;
  }
  const row = moduleRegistryRow(sql, contentType.pluginId);
  if (row === null || !row.enabled) {
    return null;
  }
  const guardOp = row.permissions.typeWriteGuards[contentType.key];
  if (guardOp === undefined) {
    return null;
  }
  const allowed = row.permissions.grants[guardOp] ?? [];
  if (allowed.includes(role)) {
    return null;
  }
  return {
    code: "forbidden",
    message: `role '${role}' cannot write ${contentType.key} (requires ${guardOp})`,
  };
}
```

(e) `apps/api/src/tenant-do.ts` に RPC を追加(import: `moduleById`, `moduleCatalog` from "./modules/registry"、enablement の各関数、`BOOKING` は不要):

```ts
  // design-spec §9.5: 有効化はテナントごと。型適用(§4.2)と権限展開(§11.5)を同一
  // トランザクションで行い、applied version を刻む。
  enableModule(tenantId: string, moduleId: string, auth: AuthContext): EnableModuleResult {
    return this.setModuleEnabled(tenantId, moduleId, auth, true);
  }

  disableModule(tenantId: string, moduleId: string, auth: AuthContext): EnableModuleResult {
    return this.setModuleEnabled(tenantId, moduleId, auth, false);
  }

  private setModuleEnabled(
    tenantId: string,
    moduleId: string,
    auth: AuthContext,
    enabled: boolean,
  ): EnableModuleResult {
    const denial = requireOperation(auth, "module:manage");
    if (denial !== null) {
      return denial;
    }
    const module = moduleById(moduleId);
    if (module === undefined) {
      return { ok: false, code: "unknown_module", message: `unknown module: ${moduleId}` };
    }
    const now = new Date().toISOString();
    let typesChanged = false;
    try {
      this.ctx.storage.transactionSync(() => {
        this.rememberTenant(tenantId);
        if (enabled) {
          typesChanged = applyModuleTypes(this.ctx.storage.sql, module.manifest, now);
        }
        // disable でも権限・applied version は最新へ更新して残す(型は残る = §9.5)
        upsertModuleEnablement(this.ctx.storage.sql, {
          moduleId,
          enabled,
          appliedVersion: enabled
            ? module.manifest.version
            : (moduleRegistryRow(this.ctx.storage.sql, moduleId)?.appliedVersion ?? 0),
          permissions: permissionsFromManifest(module.manifest),
          now,
        });
      });
    } catch (error) {
      // ユーザー型が plugin キーを先取りしていた等。トランザクションはロールバック済み。
      return { ok: false, code: "type_conflict", message: String(error) };
    }
    if (typesChanged) {
      this.broadcastAll({
        type: "content-types",
        contentTypes: loadAllContentTypes(this.ctx.storage.sql),
      });
    }
    return { ok: true, module: this.moduleSummary(moduleId) };
  }

  private moduleSummary(moduleId: string): ModuleSummary {
    const module = moduleById(moduleId);
    const row = moduleRegistryRow(this.ctx.storage.sql, moduleId);
    return {
      moduleId,
      name: module?.manifest.name ?? moduleId,
      version: module?.manifest.version ?? 0,
      enabled: row?.enabled ?? false,
      appliedVersion: row?.appliedVersion ?? 0,
    };
  }

  listModules(): ModuleSummary[] {
    return moduleCatalog().map((module) => this.moduleSummary(module.manifest.moduleId));
  }
```

型定義(tenant-do.ts のトップレベル、または enablement.ts に置いて import):

```ts
export interface ModuleSummary {
  moduleId: string;
  name: string;
  version: number;
  enabled: boolean;
  appliedVersion: number;
}

export type EnableModuleResult =
  | { ok: true; module: ModuleSummary }
  | { ok: false; code: "forbidden" | "unknown_module" | "type_conflict"; message: string };
```

(f) 書き込みガードの配線。`apps/api/src/tenant-do.ts` の `writeRecord`: `loadContentTypeByKey` の直後に:

```ts
    const moduleDenial = moduleWriteDenial(this.ctx.storage.sql, contentType, auth.role);
    if (moduleDenial !== null) {
      return { ok: false, ...moduleDenial };
    }
```

`deleteRecord`: `requireOperation` の直後に(record が無ければ core に任せる):

```ts
    // §11.5: モジュール型の削除も write ガードに従う(型は record から引く)
    const target = loadRecord(this.ctx.storage.sql, recordId);
    if (target !== null) {
      const targetType = loadContentTypeByKey(this.ctx.storage.sql, target.type);
      if (targetType !== null) {
        const moduleDenial = moduleWriteDenial(this.ctx.storage.sql, targetType, auth.role);
        if (moduleDenial !== null) {
          return { ok: false, ...moduleDenial };
        }
      }
    }
```

`apps/api/src/sync/handlers.ts` の `handlePush`: `loadContentTypeByKey` 成功の直後(delete 分岐より前)に:

```ts
    // §11.5: モジュール権限ガードは requireOperation と同じ「先頭」(no-op 判定・検証より前)
    const moduleDenial = moduleWriteDenial(deps.sql, contentTypeRow, auth.role);
    if (moduleDenial !== null) {
      acks.push({
        type: "ack",
        changeId: change.changeId,
        result: { ok: false, code: moduleDenial.code, message: moduleDenial.message },
      });
      continue;
    }
```

(g) `apps/api/src/rpc-unwrap.ts` に追加:

```ts
export function asModuleSummaries(value: unknown): ModuleSummary[] {
  return value as ModuleSummary[];
}

export function asEnableModuleResult(value: unknown): EnableModuleResult {
  return value as EnableModuleResult;
}
```

- [ ] **Step 4: PASS + 回帰を確認**

Run: `pnpm --filter @plyrs/api exec vitest run test/module-enablement.test.ts && pnpm --filter @plyrs/api test && pnpm typecheck`
Expected: 新規テスト PASS・既存回帰 0(既存テストで source='plugin' を RPC 登録しているものがあれば allowPlugin の意図と突き合わせて更新)

- [ ] **Step 5: コミット**

```bash
pnpm format
git add apps/api/src/modules/enablement.ts apps/api/src/auth/permissions.ts apps/api/src/do/authorize.ts apps/api/src/do/content-types.ts apps/api/src/tenant-do.ts apps/api/src/sync/handlers.ts apps/api/src/rpc-unwrap.ts apps/api/test/module-enablement.test.ts
git commit -m "feat: モジュール有効化レジストリと権限ガード"
```

---

### Task 7: beforeWrite モジュールフックの合流 + フック文脈の拡張

既存フックパイプラインに有効モジュールの beforeWrite を合流させる。フック文脈に relation 書き込み内容と alarm 予約 seam を加え、拒否コードの名前空間拡張を型で固定する。

**Files:**
- Modify: `apps/api/src/do/types.ts`(ModuleRejectionCode)
- Modify: `apps/api/src/do/hooks.ts`(BeforeWriteContext / HookRejection)
- Modify: `apps/api/src/do/write-record.ts`(合流 + WriteDeps seam)
- Create: `apps/api/src/modules/hooks.ts`
- Test: `apps/api/test/module-hooks.test.ts`(新規)+ 既存 `apps/api/src/do/hooks.test.ts` の文脈更新

**Interfaces:**
- Produces:
  - `type ModuleRejectionCode = \`${string}:${string}\``(do/types.ts)。`WriteRecordResult` の失敗枝を `code: WriteErrorCode | ModuleRejectionCode` に拡張
  - `HookRejection.code: Extract<WriteErrorCode, "unique_violation" | "forbidden"> | ModuleRejectionCode`
  - `BeforeWriteContext` に追加: `relations: ReadonlyMap<string, readonly RelationRef[]>`(この書き込みが確定させる relation 全量)/ `scheduleModuleAlarm?: (moduleId: string, dueAtMs: number) => void`
  - `WriteDeps` に追加(いずれも optional): `newEventId?: () => string` / `scheduleModuleAlarm?: (moduleId: string, dueAtMs: number) => void`(newEventId の使用は Task 9)
  - `moduleBeforeWriteHooks(sql: SqlStorage): BeforeWriteHook[]`(modules/hooks.ts — 有効モジュールの beforeWrite を moduleId 昇順で返す)

- [ ] **Step 1: 失敗テストを書く**

`apps/api/test/module-hooks.test.ts`。モジュールフックが「有効時のみ走る・拒否コードが ack/RPC にそのまま出る」ことを、booking にフックが入る前でも検証できるよう、`moduleBeforeWriteHooks` の単体 + 配線の 2 層で書く:

```ts
import { env, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { moduleBeforeWriteHooks } from "../src/modules/hooks";
import { upsertModuleEnablement } from "../src/modules/enablement";
import type { AuthContext } from "../src/do/authorize";

const OWNER: AuthContext = { userId: "u-owner", role: "owner", tenantId: "t-hooks" };

function stub(name: string) {
  return env.TENANT_DO.get(env.TENANT_DO.idFromName(name));
}

describe("moduleBeforeWriteHooks (design-spec §9.3 / §9.4 ステップ2)", () => {
  it("無効モジュールのフックは返さない・有効化で返す", async () => {
    const tenant = stub("mod-hooks-1");
    await tenant.ping();
    await runInDurableObject(tenant, async (_instance, state) => {
      const sql = state.storage.sql;
      expect(moduleBeforeWriteHooks(sql)).toEqual([]); // booking 未有効
      upsertModuleEnablement(sql, {
        moduleId: "booking",
        enabled: true,
        appliedVersion: 1,
        permissions: { grants: {}, typeWriteGuards: {} },
        now: new Date().toISOString(),
      });
      // Task 10 で bookingModule.beforeWrite が入るまでは 0 本のまま(定義が無いフックは合流しない)
      const hooks = moduleBeforeWriteHooks(sql);
      expect(Array.isArray(hooks)).toBe(true);
    });
  });

  it("レジストリに行があってもコード側に定義が無い moduleId は無視する", async () => {
    const tenant = stub("mod-hooks-2");
    await tenant.ping();
    await runInDurableObject(tenant, async (_instance, state) => {
      upsertModuleEnablement(state.storage.sql, {
        moduleId: "ghost",
        enabled: true,
        appliedVersion: 1,
        permissions: { grants: {}, typeWriteGuards: {} },
        now: new Date().toISOString(),
      });
      expect(moduleBeforeWriteHooks(state.storage.sql)).toEqual([]);
    });
  });
});
```

さらに `apps/api/src/do/hooks.test.ts` の既存テストが `BeforeWriteContext` を組み立てていれば、`relations: new Map()` を追加して更新する(Step 3 の型変更に追従)。

- [ ] **Step 2: FAIL を確認**

Run: `pnpm --filter @plyrs/api exec vitest run test/module-hooks.test.ts`
Expected: FAIL(modules/hooks.ts が存在しない)

- [ ] **Step 3: 実装**

(a) `apps/api/src/do/types.ts`:

```ts
// Phase 9: モジュールフックの拒否コードは `${moduleId}:${reason}` の名前空間必須
// (例 'booking:slot_full')。システム語彙(WriteErrorCode)と構造的に衝突しない。
// AckResult.code が string のまま保たれてきた理由の実装(ロードマップ §7)。
export type ModuleRejectionCode = `${string}:${string}`;

export type WriteRecordResult =
  | { ok: true; record: RecordSnapshot; changedFields: string[]; applied: boolean }
  | { ok: false; code: WriteErrorCode | ModuleRejectionCode; message: string };
```

(b) `apps/api/src/do/hooks.ts`:

```ts
import type { RelationRef } from "@plyrs/metamodel";
import type { ContentTypeRow } from "./content-types";
import type { ModuleRejectionCode, RecordSnapshot, WriteErrorCode } from "./types";

export interface BeforeWriteContext {
  contentType: ContentTypeRow;
  recordId: string;
  data: Record<string, unknown>;
  prev: RecordSnapshot | null;
  sql: SqlStorage;
  systemWrite: boolean;
  // Phase 9: この書き込みが確定させる relation 全量(フィールドキー → refs)。
  // data には relation が入らない(§6)ため、関係を検証するフック(予約の空き枠等)はこちらを見る。
  relations: ReadonlyMap<string, readonly RelationRef[]>;
  // Phase 9: モジュール alarm の予約(§9.6)。レジストリ登録のみで、物理 setAlarm は
  // TenantDO 側の minDueAt 経路が一本で担う(§9 申し送りの effectiveNow 制約)。
  scheduleModuleAlarm?: (moduleId: string, dueAtMs: number) => void;
}

export type HookRejection = {
  code: Extract<WriteErrorCode, "unique_violation" | "forbidden"> | ModuleRejectionCode;
  message: string;
};
```

(`BeforeWriteHook` / `runBeforeWriteHooks` は変更なし)

(c) `apps/api/src/modules/hooks.ts`:

```ts
import type { BeforeWriteHook } from "../do/hooks";
import { enabledModuleIds } from "./enablement";
import { moduleById } from "./registry";

// §9.4 ステップ2: 有効モジュールの同期フックだけを moduleId 昇順で合流させる。
// レジストリ(DO テーブル)に行が残っていてもコード側に定義が無ければ走らない
// (デプロイ後にモジュールを撤去したケースの安全側)。
export function moduleBeforeWriteHooks(sql: SqlStorage): BeforeWriteHook[] {
  const hooks: BeforeWriteHook[] = [];
  for (const moduleId of enabledModuleIds(sql)) {
    const hook = moduleById(moduleId)?.beforeWrite;
    if (hook !== undefined) {
      hooks.push(hook);
    }
  }
  return hooks;
}
```

(d) `apps/api/src/do/write-record.ts`:

- `WriteDeps` に `newEventId?: () => string;` と `scheduleModuleAlarm?: (moduleId: string, dueAtMs: number) => void;` を追加。
- `import { moduleBeforeWriteHooks } from "../modules/hooks";` を追加。
- フック実行箇所を差し替え:

```ts
  const relationState = new Map<string, readonly RelationRef[]>(
    change.relationWrites.map((write) => [write.fieldKey, write.refs]),
  );
  const rejection = runBeforeWriteHooks(
    [...systemBeforeWriteHooks, ...moduleBeforeWriteHooks(deps.sql)],
    {
      contentType,
      recordId: params.recordId,
      data: change.data,
      prev,
      sql: deps.sql,
      systemWrite: options.systemWrite === true,
      relations: relationState,
      scheduleModuleAlarm: deps.scheduleModuleAlarm,
    },
  );
```

- [ ] **Step 4: PASS + 回帰を確認**

Run: `pnpm --filter @plyrs/api exec vitest run test/module-hooks.test.ts && pnpm --filter @plyrs/api test && pnpm typecheck`
Expected: PASS。既存 hooks.test.ts / unique-check / asset-guard のテストが relations 追加に追従して緑。

- [ ] **Step 5: コミット**

```bash
pnpm format
git add apps/api/src/do/types.ts apps/api/src/do/hooks.ts apps/api/src/do/hooks.test.ts apps/api/src/do/write-record.ts apps/api/src/modules/hooks.ts apps/api/test/module-hooks.test.ts
git commit -m "feat: モジュール beforeWrite の合流と文脈拡張"
```

---

### Task 8: alarm 多重化のモジュール向け汎用化(§9.6)

`alarm_registry` の kind に `module:{moduleId}` を導入し、TenantDO.alarm() のディスパッチを拡張する。**物理 setAlarm は既存の「registerAlarm → setAlarm(min)」経路と alarm() 末尾の再アームだけ**が行う(§9 申し送りの effectiveNow 制約を保つ)。

**Files:**
- Create: `apps/api/src/modules/module-alarms.ts`
- Modify: `apps/api/src/tenant-do.ts`(alarm() ディスパッチ + runModuleAlarm)
- Test: `apps/api/test/module-alarms.test.ts`(新規)

**Interfaces:**
- Produces(module-alarms.ts): `MODULE_ALARM_PREFIX = "module:"` / `moduleAlarmKind(moduleId: string): string` / `moduleIdFromAlarmKind(kind: string): string | null`
- Produces(TenantDO): `alarm()` が `module:{id}` kind を有効モジュールの `onAlarm(ctx)` にディスパッチ。ctx は `ModuleAlarmContext`(Task 4 定義)。alarm 内の書き込みは actor `module:{id}` で行われ、applied な record は commit 後に `change` ブロードキャストされる

- [ ] **Step 1: 失敗テストを書く**

`apps/api/test/module-alarms.test.ts`。booking の onAlarm 実装(Task 10)に依存せず汎用機構を検証するため、レジストリへ直接 kind を登録し、`MODULE_REGISTRY` に無い moduleId の掃除・無効モジュールのスキップを見る:

```ts
import { env, runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { moduleAlarmKind, moduleIdFromAlarmKind } from "../src/modules/module-alarms";
import { registerAlarm } from "../src/do/alarms";
import { upsertModuleEnablement } from "../src/modules/enablement";

function stub(name: string) {
  return env.TENANT_DO.get(env.TENANT_DO.idFromName(name));
}

describe("module alarm kind ヘルパー", () => {
  it("kind の往復変換", () => {
    expect(moduleAlarmKind("booking")).toBe("module:booking");
    expect(moduleIdFromAlarmKind("module:booking")).toBe("booking");
    expect(moduleIdFromAlarmKind("outbox_sweep")).toBeNull();
    expect(moduleIdFromAlarmKind("module_events_sweep")).toBeNull();
  });
});

describe("TenantDO.alarm() のモジュールディスパッチ (design-spec §9.6)", () => {
  it("未知モジュールの kind はレジストリから掃除され、永久起床ループにならない", async () => {
    const tenant = stub("mod-alarm-unknown");
    await tenant.ping();
    await runInDurableObject(tenant, async (_instance, state) => {
      registerAlarm(state.storage.sql, moduleAlarmKind("ghost"), Date.now() - 1_000);
      await state.storage.setAlarm(Date.now() - 1_000);
    });
    const ran = await runDurableObjectAlarm(tenant);
    expect(ran).toBe(true);
    await runInDurableObject(tenant, async (_instance, state) => {
      const rows = state.storage.sql
        .exec<{ kind: string }>("SELECT kind FROM alarm_registry")
        .toArray();
      expect(rows).toEqual([]); // 掃除済み
      expect(await state.storage.getAlarm()).toBeNull(); // 張り直し無し
    });
  });

  it("無効モジュールの kind も消化される(ハンドラは走らない)", async () => {
    const tenant = stub("mod-alarm-disabled");
    await tenant.ping();
    await runInDurableObject(tenant, async (_instance, state) => {
      // booking はコード上存在するが、このテナントでは無効のまま
      upsertModuleEnablement(state.storage.sql, {
        moduleId: "booking",
        enabled: false,
        appliedVersion: 0,
        permissions: { grants: {}, typeWriteGuards: {} },
        now: new Date().toISOString(),
      });
      registerAlarm(state.storage.sql, moduleAlarmKind("booking"), Date.now() - 1_000);
      await state.storage.setAlarm(Date.now() - 1_000);
    });
    const ran = await runDurableObjectAlarm(tenant);
    expect(ran).toBe(true);
    await runInDurableObject(tenant, async (_instance, state) => {
      const rows = state.storage.sql
        .exec<{ kind: string }>("SELECT kind FROM alarm_registry")
        .toArray();
      expect(rows).toEqual([]);
    });
  });
});
```

- [ ] **Step 2: FAIL を確認**

Run: `pnpm --filter @plyrs/api exec vitest run test/module-alarms.test.ts`
Expected: FAIL(module-alarms.ts が存在しない / alarm() が未知 kind を放置してループする)

- [ ] **Step 3: 実装**

(a) `apps/api/src/modules/module-alarms.ts`:

```ts
// design-spec §9.6: モジュールの論理タイマーは `(module_id, next_fire_at)` を alarm_registry の
// kind = `module:{moduleId}` として登録する。1 モジュール 1 タイマー(record ごとに時刻を
// 持たない集約は仕様どおり)。
export const MODULE_ALARM_PREFIX = "module:";

export function moduleAlarmKind(moduleId: string): string {
  return `${MODULE_ALARM_PREFIX}${moduleId}`;
}

export function moduleIdFromAlarmKind(kind: string): string | null {
  if (!kind.startsWith(MODULE_ALARM_PREFIX)) {
    return null;
  }
  return kind.slice(MODULE_ALARM_PREFIX.length);
}
```

(b) `apps/api/src/tenant-do.ts` の `alarm()` を差し替え:

```ts
  override async alarm(): Promise<void> {
    // 物理アラームは複数の論理タイマーを多重化しているため、alarmInfo を見ても「どの kind が
    // 起きたか」は分からない ―― 到来した kind の判定は常にレジストリ(due_at)を見て行う。
    const now = effectiveNow(this.ctx.storage.sql);
    for (const kind of dueKinds(this.ctx.storage.sql, now)) {
      if (kind === OUTBOX_SWEEP) {
        await this.sweepOutbox();
        continue;
      }
      const moduleId = moduleIdFromAlarmKind(kind);
      if (moduleId !== null) {
        this.runModuleAlarm(moduleId, now);
        continue;
      }
      // 未知 kind を放置すると「常に最早 due が過去」の永久起床ループになる。消して記録する。
      console.error("unknown alarm kind purged", kind);
      clearAlarm(this.ctx.storage.sql, kind);
    }
    const min = minDueAt(this.ctx.storage.sql);
    if (min !== null) {
      await this.ctx.storage.setAlarm(min);
    }
  }

  // §9.6: モジュール alarm のディスパッチ。ハンドラはトランザクション内で走り、
  // schedule はレジストリ登録のみ(物理再アームは alarm() 末尾の minDueAt 経路が担う —
  // §9 申し送り: モジュールに ctx.storage.setAlarm を触らせない)。
  private runModuleAlarm(moduleId: string, nowMs: number): void {
    const written: string[] = [];
    this.ctx.storage.transactionSync(() => {
      const sql = this.ctx.storage.sql;
      // 消してから走らせる(MIN() 意味論の registerAlarm では過去 due を前倒しできない —
      // sweepOutbox と同じ理由)。ハンドラが schedule() すれば次回が入り直す。
      clearAlarm(sql, moduleAlarmKind(moduleId));
      const module = moduleById(moduleId);
      if (module?.onAlarm === undefined || !isModuleEnabled(sql, moduleId)) {
        return;
      }
      module.onAlarm({
        sql,
        now: nowMs,
        schedule: (dueAtMs) => {
          registerAlarm(sql, moduleAlarmKind(moduleId), dueAtMs);
        },
        writeRecord: (typeKey, params) => {
          const contentType = loadContentTypeByKey(sql, typeKey);
          if (contentType === null) {
            return { ok: false, code: "unknown_type", message: `unknown content type: ${typeKey}` };
          }
          const result = writeRecordCore(
            {
              sql,
              nextSeq: () => ++this.seq,
              now: () => new Date().toISOString(),
              newRelationId: () => uuidv7(),
              newEventId: () => uuidv7(),
            },
            contentType,
            { ...params, actor: `module:${moduleId}` },
          );
          if (result.ok && result.applied) {
            written.push(params.recordId);
          }
          return result;
        },
      });
    });
    // コミット後に同期チャネルへ配る(writeRecord RPC と同じ契約)
    for (const recordId of written) {
      const stored = loadSyncRecord(this.ctx.storage.sql, recordId);
      if (stored !== null) {
        this.broadcastAll({ type: "change", record: stored });
      }
    }
  }
```

import に `moduleIdFromAlarmKind`, `moduleAlarmKind`(./modules/module-alarms)、`isModuleEnabled`(./modules/enablement)、`writeRecordCore` は既存 import に含まれているか確認して追加。

- [ ] **Step 4: PASS + 回帰(sweeper.test.ts が最重要)を確認**

Run: `pnpm --filter @plyrs/api exec vitest run test/module-alarms.test.ts test/sweeper.test.ts && pnpm --filter @plyrs/api test`
Expected: PASS(sweeper の既存挙動が不変であること)

- [ ] **Step 5: コミット**

```bash
pnpm format
git add apps/api/src/modules/module-alarms.ts apps/api/src/tenant-do.ts apps/api/test/module-alarms.test.ts
git commit -m "feat: alarm 多重化をモジュール kind へ汎用化"
```

---

### Task 9: モジュールイベント(afterWrite / afterPublish)+ plyrs-modules キュー + moduleWrite RPC

§9.4 ステップ 5-6 を汎用実装する。emit(トランザクション内)→ module_events → sweep/drain → Queues → consumer ディスパッチ → moduleWrite(DO への冪等な書き戻し)。

**Files:**
- Create: `apps/api/src/modules/events.ts`
- Modify: `apps/api/src/do/write-record.ts`(afterWrite emit)
- Modify: `apps/api/src/do/publish.ts`(afterPublish emit)
- Modify: `apps/api/src/tenant-do.ts`(writeRecord/createAssetRecord/push の配線 + sweepModuleEvents + drainModuleEvents + moduleWrite RPC)
- Modify: `apps/api/src/index.ts`(queue ハンドラ分岐)
- Modify: `apps/api/wrangler.jsonc` / `apps/api/env.d.ts`(MODULES_QUEUE)
- Test: `apps/api/test/module-events.test.ts`(新規)

**Interfaces:**
- Produces(events.ts):
  - `MODULE_EVENTS_SWEEP = "module_events_sweep"`
  - `emitModuleEvents(sql, newEventId: () => string, now: string, event: ModuleEventName, typeKey: string, recordId: string, actor: string, registry?): number`(actor が `module:` / `public:` 由来でも `module:` のみ抑止。挿入行数を返す)
  - `unsentModuleEvents(sql, limit): ModuleEventRow[]` / `markModuleEventSent(sql, id)` / `countUnsentModuleEvents(sql): number` / `purgeSentModuleEvents(sql)`
  - `type ModuleQueueJob = ModuleEventJob | ModuleSyncJob | ModuleRedistributeJob`(`kind: "module_event" | "module_sync" | "module_redistribute"`。sync/redistribute の中身は Task 13)
  - `handleModuleJob(env: Env, job: ModuleQueueJob, registry?): Promise<void>`
- Produces(TenantDO): `moduleWrite(tenantId: string, moduleId: string, typeKey: string, params: WriteRecordInput): Promise<WriteRecordResult>`(module 有効 + 型が `${moduleId}.` 名前空間のときだけ。actor `module:{moduleId}`、systemWrite: true)
- Consumes: Task 5 の module_events テーブル、Task 7 の `WriteDeps.newEventId`
- **`writeRecord` / `createAssetRecord` RPC は async 化**(戻り値 Promise。RPC 越しには従来から await されるため呼び出し側は不変)

- [ ] **Step 1: 失敗テストを書く**

`apps/api/test/module-events.test.ts`。emit の純関数層 + DO 配線層 + consumer 層。booking の events 実装(Task 10)に依存しないよう、emit/consumer はフェイクレジストリを注入する:

```ts
import { env, runInDurableObject } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import {
  countUnsentModuleEvents,
  emitModuleEvents,
  handleModuleJob,
  type ModuleQueueJob,
} from "../src/modules/events";
import { upsertModuleEnablement } from "../src/modules/enablement";
import type { ModuleDefinition } from "../src/modules/registry";
import { BOOKING_MANIFEST } from "../src/modules/booking/manifest";
import { asWriteResult } from "../src/rpc-unwrap";
import type { AuthContext } from "../src/do/authorize";

const OWNER: AuthContext = { userId: "u-owner", role: "owner", tenantId: "t-events" };

function stub(name: string) {
  return env.TENANT_DO.get(env.TENANT_DO.idFromName(name));
}

function uuid(n: number): string {
  return `00000000-0000-7000-8000-${String(n).padStart(12, "0")}`;
}

// 検証用フェイク: demo モジュールが demo.item の afterWrite / afterPublish を購読する
function fakeRegistry(handle = vi.fn(async () => {})): Record<string, ModuleDefinition> {
  return {
    demo: {
      manifest: { ...BOOKING_MANIFEST, moduleId: "demo", name: "デモ" },
      events: {
        afterWrite: { types: ["demo.item"], handle },
        afterPublish: { types: ["demo.item"], handle },
      },
    },
  };
}

describe("emitModuleEvents (design-spec §9.4 ステップ5)", () => {
  it("有効な購読モジュールにだけ行を積む・module: actor では積まない", async () => {
    const tenant = stub("mod-events-emit");
    await tenant.ping();
    await runInDurableObject(tenant, async (_instance, state) => {
      const sql = state.storage.sql;
      const registry = fakeRegistry();
      let n = 0;
      const newId = () => uuid(500 + ++n);
      const now = new Date().toISOString();
      // 未有効 → 0 行
      expect(emitModuleEvents(sql, newId, now, "afterWrite", "demo.item", uuid(1), "u1", registry)).toBe(0);
      upsertModuleEnablement(sql, {
        moduleId: "demo",
        enabled: true,
        appliedVersion: 1,
        permissions: { grants: {}, typeWriteGuards: {} },
        now,
      });
      // 有効 + 購読型 → 1 行
      expect(emitModuleEvents(sql, newId, now, "afterWrite", "demo.item", uuid(1), "u1", registry)).toBe(1);
      // 購読していない型 → 0 行
      expect(emitModuleEvents(sql, newId, now, "afterWrite", "other", uuid(1), "u1", registry)).toBe(0);
      // イベント連鎖は 1 段まで: module actor の書き込みは積まない
      expect(emitModuleEvents(sql, newId, now, "afterWrite", "demo.item", uuid(1), "module:demo", registry)).toBe(0);
      expect(countUnsentModuleEvents(sql)).toBe(1);
    });
  });
});

describe("handleModuleJob (consumer)", () => {
  it("購読ハンドラへディスパッチする", async () => {
    const handle = vi.fn(async () => {});
    const job: ModuleQueueJob = {
      kind: "module_event",
      eventId: uuid(600),
      tenantId: "t-events",
      moduleId: "demo",
      event: "afterWrite",
      recordId: uuid(1),
      typeKey: "demo.item",
    };
    await handleModuleJob(env, job, fakeRegistry(handle));
    expect(handle).toHaveBeenCalledTimes(1);
  });

  it("購読が消えた後の残メッセージは黙って ack(何もしない)", async () => {
    const job: ModuleQueueJob = {
      kind: "module_event",
      eventId: uuid(601),
      tenantId: "t-events",
      moduleId: "ghost",
      event: "afterWrite",
      recordId: uuid(1),
      typeKey: "demo.item",
    };
    await expect(handleModuleJob(env, job, fakeRegistry())).resolves.toBeUndefined();
  });
});

describe("moduleWrite RPC (§9.3 非同期副作用の書き戻し)", () => {
  it("有効モジュールは自分の名前空間の型だけ書ける", async () => {
    const tenant = stub("mod-events-write");
    await tenant.enableModule("t-events", "booking", OWNER);
    const ok = asWriteResult(
      await tenant.moduleWrite("t-events", "booking", "booking.resource", {
        recordId: uuid(10),
        input: { name: "リソース" },
      }),
    );
    expect(ok.ok).toBe(true);
    const crossNamespace = asWriteResult(
      await tenant.moduleWrite("t-events", "booking", "asset", {
        recordId: uuid(11),
        input: {},
      }),
    );
    expect(crossNamespace.ok).toBe(false);
    const disabled = asWriteResult(
      await stub("mod-events-write-2").moduleWrite("t-events", "booking", "booking.resource", {
        recordId: uuid(12),
        input: { name: "x" },
      }),
    );
    expect(disabled.ok).toBe(false);
  });
});
```

- [ ] **Step 2: FAIL を確認**

Run: `pnpm --filter @plyrs/api exec vitest run test/module-events.test.ts`
Expected: FAIL(events.ts が存在しない)

- [ ] **Step 3: events.ts を実装**

`apps/api/src/modules/events.ts`:

```ts
import { v7 as uuidv7 } from "uuid";
import { asWriteResult } from "../rpc-unwrap";
import { enabledModuleIds } from "./enablement";
import { MODULE_REGISTRY, moduleById, type ModuleDefinition, type ModuleEventName } from "./registry";

// §9.6 の多重化 kind(outbox_sweep と同格のシステム kind)
export const MODULE_EVENTS_SWEEP = "module_events_sweep";

export interface ModuleEventRow {
  id: string;
  moduleId: string;
  event: ModuleEventName;
  recordId: string;
  typeKey: string;
}

export interface ModuleEventJob {
  kind: "module_event";
  eventId: string;
  tenantId: string;
  moduleId: string;
  event: ModuleEventName;
  recordId: string;
  typeKey: string;
}

// Task 13 で実装(型だけ先に確定): §4.2 の型定義再配布
export interface ModuleSyncJob {
  kind: "module_sync";
  tenantId: string;
  moduleId: string;
}

export interface ModuleRedistributeJob {
  kind: "module_redistribute";
  moduleId: string;
}

export type ModuleQueueJob = ModuleEventJob | ModuleSyncJob | ModuleRedistributeJob;

// §9.4 ステップ5: コミットと同一トランザクションで積む(呼び出し元が transactionSync 内で呼ぶ)。
// actor が module: のとき積まない = イベント連鎖は 1 段まで(2026-07-18 設計確定。無限ループの
// 構造的防止)。public:{id} の公開 write は通常どおり積む。
export function emitModuleEvents(
  sql: SqlStorage,
  newEventId: () => string,
  now: string,
  event: ModuleEventName,
  typeKey: string,
  recordId: string,
  actor: string,
  registry: Record<string, ModuleDefinition> = MODULE_REGISTRY,
): number {
  if (actor.startsWith("module:")) {
    return 0;
  }
  let inserted = 0;
  for (const moduleId of enabledModuleIds(sql)) {
    const subscription = registry[moduleId]?.events?.[event];
    if (subscription === undefined || !subscription.types.includes(typeKey)) {
      continue;
    }
    sql.exec(
      "INSERT INTO module_events (id, module_id, event, record_id, type, enqueued_at, sent) VALUES (?, ?, ?, ?, ?, ?, 0)",
      newEventId(),
      moduleId,
      event,
      recordId,
      typeKey,
      now,
    );
    inserted += 1;
  }
  return inserted;
}

interface RawModuleEventRow extends Record<string, SqlStorageValue> {
  id: string;
  module_id: string;
  event: string;
  record_id: string;
  type: string;
}

export function unsentModuleEvents(sql: SqlStorage, limit: number): ModuleEventRow[] {
  return sql
    .exec<RawModuleEventRow>(
      "SELECT id, module_id, event, record_id, type FROM module_events WHERE sent = 0 ORDER BY rowid LIMIT ?",
      limit,
    )
    .toArray()
    .map((row) => ({
      id: row.id,
      moduleId: row.module_id,
      event: row.event as ModuleEventName,
      recordId: row.record_id,
      typeKey: row.type,
    }));
}

export function markModuleEventSent(sql: SqlStorage, id: string): void {
  sql.exec("UPDATE module_events SET sent = 1 WHERE id = ?", id);
}

export function countUnsentModuleEvents(sql: SqlStorage): number {
  return sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM module_events WHERE sent = 0").one().n;
}

export function purgeSentModuleEvents(sql: SqlStorage): void {
  sql.exec("DELETE FROM module_events WHERE sent = 1");
}

// §9.4 ステップ6: consumer のディスパッチ。at-least-once なのでハンドラは冪等必須(§9.3)。
// throw は index.ts が retry() に写す。
export async function handleModuleJob(
  env: Env,
  job: ModuleQueueJob,
  registry: Record<string, ModuleDefinition> = MODULE_REGISTRY,
): Promise<void> {
  switch (job.kind) {
    case "module_event": {
      const subscription = registry[job.moduleId]?.events?.[job.event];
      if (subscription === undefined || !subscription.types.includes(job.typeKey)) {
        return; // 購読が消えた後の残メッセージは黙って ack
      }
      const doStub = env.TENANT_DO.get(env.TENANT_DO.idFromName(job.tenantId));
      await subscription.handle({
        env,
        tenantId: job.tenantId,
        recordId: job.recordId,
        typeKey: job.typeKey,
        newId: () => uuidv7(),
        writeRecord: async (typeKey, params) =>
          asWriteResult(await doStub.moduleWrite(job.tenantId, job.moduleId, typeKey, params)),
      });
      return;
    }
    case "module_sync":
    case "module_redistribute": {
      const { handleModuleSyncJob } = await import("./redistribute");
      await handleModuleSyncJob(env, job);
      return;
    }
  }
}
```

注: `./redistribute` は Task 13 で作る。それまで module_sync/module_redistribute のケースが必要になるのは Task 13 のテストだけなので、**このタスクでは仮ファイル** `apps/api/src/modules/redistribute.ts` を置く:

```ts
import type { ModuleRedistributeJob, ModuleSyncJob } from "./events";

// Task 13 で実装する(§4.2 の Queues 再配布)。それまでは到達しない。
export async function handleModuleSyncJob(
  _env: Env,
  job: ModuleSyncJob | ModuleRedistributeJob,
): Promise<void> {
  throw new Error(`module sync not implemented yet: ${job.kind}`);
}
```

`moduleById` が未使用なら import から外す(lint 警告 0 維持)。

- [ ] **Step 4: DO 側の emit / drain / moduleWrite を配線**

(a) `apps/api/src/do/write-record.ts` — `writeRecordCore` の成功 return 直前(record 構築の前後どちらでも可、必ず relations 再投影の後)に:

```ts
  // §9.4 ステップ5: afterWrite はコミットと同一トランザクションで積む(排出は呼び出し元)。
  if (deps.newEventId !== undefined) {
    emitModuleEvents(deps.sql, deps.newEventId, now, "afterWrite", contentType.key, params.recordId, params.actor);
  }
```

(b) `apps/api/src/do/publish.ts` — `publishRecordCore` の snapshot 書き込み + outbox enqueue の後(同一トランザクション内)に同様の emit を追加。`publishRecordCore` の deps には `newId` があるため:

```ts
  emitModuleEvents(deps.sql, deps.newId, deps.now(), "afterPublish", record.type, recordId, actor);
```

(`actor` は publishRecordCore が受け取る userId 引数。実際のシグネチャ・変数名は実装時に publish.ts の実物に合わせる。unpublish には emit しない — スコープは afterWrite / afterPublish の 2 種)

(c) `apps/api/src/tenant-do.ts`:

- `writeRecord` を async 化し、seam と drain を配線(createAssetRecord も同型に):

```ts
  async writeRecord(
    typeKey: string,
    params: WriteRecordInput,
    auth: AuthContext,
  ): Promise<WriteRecordResult> {
    const denial = requireOperation(auth, "record:write");
    if (denial !== null) {
      return denial;
    }
    const contentType = loadContentTypeByKey(this.ctx.storage.sql, typeKey);
    if (contentType === null) {
      return { ok: false, code: "unknown_type", message: `unknown content type: ${typeKey}` };
    }
    const moduleDenial = moduleWriteDenial(this.ctx.storage.sql, contentType, auth.role);
    if (moduleDenial !== null) {
      return { ok: false, ...moduleDenial };
    }
    const armed: Promise<void>[] = [];
    const result = this.ctx.storage.transactionSync(() => {
      const inner = writeRecordCore(
        {
          sql: this.ctx.storage.sql,
          nextSeq: () => ++this.seq,
          now: () => new Date().toISOString(),
          newRelationId: () => uuidv7(),
          newEventId: () => uuidv7(),
          scheduleModuleAlarm: (moduleId, dueAt) => {
            const min = registerAlarm(this.ctx.storage.sql, moduleAlarmKind(moduleId), dueAt);
            armed.push(this.ctx.storage.setAlarm(min));
          },
        },
        contentType,
        { ...params, actor: auth.userId },
      );
      // module_events の宛先(do_config.tenant_id)は write 経路でも刻む(§14 の push 教訓と同型:
      // 実際に積まれた時だけ)。auth.tenantId は HTTP ゲート由来のときのみ存在する。
      if (countUnsentModuleEvents(this.ctx.storage.sql) > 0 && auth.tenantId !== undefined) {
        this.rememberTenant(auth.tenantId);
        armed.push(this.armModuleEventsSweep(Date.now() + SWEEP_DELAY_MS));
      }
      return inner;
    });
    await Promise.all(armed);
    if (result.ok && result.applied) {
      const stored = loadSyncRecord(this.ctx.storage.sql, params.recordId);
      if (stored !== null) {
        this.broadcastAll({ type: "change", record: stored });
      }
      await this.drainModuleEvents();
    }
    return result;
  }
```

- `armModuleEventsSweep` / `sweepModuleEvents` / `drainModuleEvents`(armSweep / sweepOutbox / drainOutbox と同型):

```ts
  private armModuleEventsSweep(dueAt: number): Promise<void> {
    const min = registerAlarm(this.ctx.storage.sql, MODULE_EVENTS_SWEEP, dueAt);
    return this.ctx.storage.setAlarm(min);
  }

  // drainOutbox と同じ契約: コミット済みイベントのベストエフォート排出。失敗は sweeper が拾う。
  private async drainModuleEvents(): Promise<void> {
    const tenantId = this.tenantId();
    if (tenantId === null) {
      console.error("module events drain skipped: tenant id is unknown");
      return;
    }
    for (const row of unsentModuleEvents(this.ctx.storage.sql, 50)) {
      const job: ModuleEventJob = {
        kind: "module_event",
        eventId: row.id,
        tenantId,
        moduleId: row.moduleId,
        event: row.event,
        recordId: row.recordId,
        typeKey: row.typeKey,
      };
      try {
        await this.env.MODULES_QUEUE.send(job);
        markModuleEventSent(this.ctx.storage.sql, row.id);
      } catch (error) {
        console.error("module event send failed", row.id, error);
        return;
      }
    }
  }

  private async sweepModuleEvents(): Promise<void> {
    await this.drainModuleEvents();
    clearAlarm(this.ctx.storage.sql, MODULE_EVENTS_SWEEP);
    if (countUnsentModuleEvents(this.ctx.storage.sql) > 0) {
      registerAlarm(this.ctx.storage.sql, MODULE_EVENTS_SWEEP, Date.now() + SWEEP_RETRY_MS);
      return;
    }
    purgeSentModuleEvents(this.ctx.storage.sql);
  }
```

- `alarm()` のディスパッチに分岐を追加(Task 8 の for ループ内、OUTBOX_SWEEP の隣): `if (kind === MODULE_EVENTS_SWEEP) { await this.sweepModuleEvents(); continue; }`
- `moduleWrite` RPC:

```ts
  // §9.3: 非同期副作用フック(consumer)からの書き戻し経路。モジュールは自分の名前空間の型
  // だけを書ける。actor は module:{id} — emitModuleEvents がこれを見て連鎖を 1 段で止める。
  async moduleWrite(
    tenantId: string,
    moduleId: string,
    typeKey: string,
    params: WriteRecordInput,
  ): Promise<WriteRecordResult> {
    if (moduleById(moduleId) === undefined || !isModuleEnabled(this.ctx.storage.sql, moduleId)) {
      return { ok: false, code: "forbidden", message: `module is not enabled: ${moduleId}` };
    }
    if (!typeKey.startsWith(`${moduleId}.`)) {
      return { ok: false, code: "forbidden", message: `type '${typeKey}' is outside module namespace` };
    }
    const contentType = loadContentTypeByKey(this.ctx.storage.sql, typeKey);
    if (contentType === null) {
      return { ok: false, code: "unknown_type", message: `unknown content type: ${typeKey}` };
    }
    const armed: Promise<void>[] = [];
    const result = this.ctx.storage.transactionSync(() => {
      this.rememberTenant(tenantId);
      return writeRecordCore(
        {
          sql: this.ctx.storage.sql,
          nextSeq: () => ++this.seq,
          now: () => new Date().toISOString(),
          newRelationId: () => uuidv7(),
          newEventId: () => uuidv7(),
          scheduleModuleAlarm: (id, dueAt) => {
            const min = registerAlarm(this.ctx.storage.sql, moduleAlarmKind(id), dueAt);
            armed.push(this.ctx.storage.setAlarm(min));
          },
        },
        contentType,
        { ...params, actor: `module:${moduleId}` },
        { systemWrite: true },
      );
    });
    await Promise.all(armed);
    if (result.ok && result.applied) {
      const stored = loadSyncRecord(this.ctx.storage.sql, params.recordId);
      if (stored !== null) {
        this.broadcastAll({ type: "change", record: stored });
      }
    }
    return result;
  }
```

- push 経路(`webSocketMessage`)の deps に `newEventId: () => uuidv7()` と `scheduleModuleAlarm`(writeRecord と同じ実装。既存の `armed` 単一変数を `Promise<void>[]` に改める)を追加し、txn 内の outbox 条件の隣に:

```ts
          if (countUnsentModuleEvents(this.ctx.storage.sql) > 0) {
            this.rememberTenant(auth.tenantId);
            armed.push(this.armModuleEventsSweep(Date.now() + SWEEP_DELAY_MS));
          }
```

(SocketAuth は tenantId を常に持つ)。コミット後の drain も outbox と同様に追加: `await this.drainModuleEvents();`(module events を積んだときのみ)。publish/unpublish/delete の各 RPC も、`countUnsentModuleEvents > 0` のとき `armModuleEventsSweep` + `drainModuleEvents` を同型で足す(afterPublish の排出経路)。

(d) `apps/api/src/index.ts` — queue ハンドラを分岐:

```ts
  async queue(batch: MessageBatch<ProjectionJob | ModuleQueueJob>, env: Env, _ctx: ExecutionContext): Promise<void> {
    const nowMs = Date.now();
    for (const message of batch.messages) {
      try {
        if (batch.queue === "plyrs-modules") {
          // batch.queue で判別済み。メッセージ型はキューごとに閉じている(境界 cast)。
          await handleModuleJob(env, message.body as ModuleQueueJob);
        } else {
          await handleProjectionJob(env, message.body as ProjectionJob, nowMs);
        }
        message.ack();
      } catch (error) {
        console.error("queue job failed", batch.queue, message.body, error);
        message.retry();
      }
    }
  },
```

(e) `apps/api/wrangler.jsonc` — producers に `{ "binding": "MODULES_QUEUE", "queue": "plyrs-modules" }`、consumers に:

```jsonc
      {
        "queue": "plyrs-modules",
        "max_batch_timeout": 0,
        "max_batch_size": 10,
        "max_retries": 5,
        // projection と同じ方針: リトライ枯渇分は park させ運用者が手動確認(consumer は付けない)
        "dead_letter_queue": "plyrs-modules-dlq",
      },
```

(f) `apps/api/env.d.ts` — `MODULES_QUEUE: Queue<import("./src/modules/events").ModuleQueueJob>;`

- [ ] **Step 5: PASS + 回帰を確認**

Run: `pnpm --filter @plyrs/api exec vitest run test/module-events.test.ts && pnpm --filter @plyrs/api test && pnpm typecheck`
Expected: PASS(writeRecord async 化の影響で `.ok` を同期参照している**テスト外の呼び出し**が無いこと — RPC 経由は全て await 済み。push・publish 系の既存テストが全緑)

- [ ] **Step 6: コミット**

```bash
pnpm format
git add apps/api/src/modules/events.ts apps/api/src/modules/redistribute.ts apps/api/src/do/write-record.ts apps/api/src/do/publish.ts apps/api/src/tenant-do.ts apps/api/src/index.ts apps/api/wrangler.jsonc apps/api/env.d.ts apps/api/test/module-events.test.ts
git commit -m "feat: モジュールイベント配送と plyrs-modules キュー"
```

---

### Task 10: booking モジュール本体(空き枠フック / 確認通知 / 仮予約失効 alarm)

Task 4 の骨格 `bookingModule` に実装を入れ、DO レベルの統合テストで §9.8 のシナリオを固定する。

**Files:**
- Modify: `apps/api/src/modules/booking/module.ts`(全面実装)
- Test: `apps/api/test/booking-module.test.ts`(新規)

**Interfaces:**
- Consumes: Task 7 の `BeforeWriteContext.relations` / `scheduleModuleAlarm`、Task 8 の `ModuleAlarmContext`、Task 9 の `ModuleEventContext` / `moduleWrite`
- Produces: `bookingModule: ModuleDefinition`(beforeWrite + events.afterWrite + onAlarm。publicEndpoints は Task 12 で追加)/ `BOOKING_PENDING_TTL_MS = 15 * 60_000`

- [ ] **Step 1: 失敗テストを書く**

`apps/api/test/booking-module.test.ts`:

```ts
import { env, runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { BOOKING_PENDING_TTL_MS, bookingModule } from "../src/modules/booking/module";
import { moduleAlarmKind } from "../src/modules/module-alarms";
import { handleModuleJob, type ModuleQueueJob } from "../src/modules/events";
import { asRecordSnapshot, asWriteResult } from "../src/rpc-unwrap";
import type { AuthContext } from "../src/do/authorize";

const TENANT = "t-booking";
const OWNER: AuthContext = { userId: "u-owner", role: "owner", tenantId: TENANT };

function stub(name: string) {
  return env.TENANT_DO.get(env.TENANT_DO.idFromName(name));
}

function uuid(n: number): string {
  return `00000000-0000-7000-8000-${String(n).padStart(12, "0")}`;
}

async function setupSlot(tenant: ReturnType<typeof stub>, capacity: number) {
  await tenant.enableModule(TENANT, "booking", OWNER);
  await tenant.writeRecord("booking.resource", { recordId: uuid(1), input: { name: "会議室" } }, OWNER);
  await tenant.writeRecord(
    "booking.slot",
    {
      recordId: uuid(2),
      input: {
        resource: { type: "booking.resource", id: uuid(1) },
        starts_at: "2026-08-01T10:00:00Z",
        ends_at: "2026-08-01T11:00:00Z",
        capacity,
      },
    },
    OWNER,
  );
}

function reservationInput(n: number, state = "pending") {
  return {
    recordId: uuid(100 + n),
    input: {
      slot: { type: "booking.slot", id: uuid(2) },
      name: `予約者${n}`,
      email: `r${n}@example.com`,
      state,
    },
  };
}

describe("空き枠検証フック (design-spec §9.3 / §9.8)", () => {
  it("capacity を超える予約は booking:slot_full で拒否される", async () => {
    const tenant = stub("booking-capacity");
    await setupSlot(tenant, 1);
    const first = asWriteResult(await tenant.writeRecord("booking.reservation", reservationInput(1), OWNER));
    expect(first.ok).toBe(true);
    const second = asWriteResult(await tenant.writeRecord("booking.reservation", reservationInput(2), OWNER));
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.code).toBe("booking:slot_full");
  });

  it("cancelled への更新は枠を消費しない(取消 → 新規予約が通る)", async () => {
    const tenant = stub("booking-cancel");
    await setupSlot(tenant, 1);
    await tenant.writeRecord("booking.reservation", reservationInput(1), OWNER);
    const cancel = asWriteResult(
      await tenant.writeRecord(
        "booking.reservation",
        { ...reservationInput(1), input: { ...reservationInput(1).input, state: "cancelled" } },
        OWNER,
      ),
    );
    expect(cancel.ok).toBe(true);
    const next = asWriteResult(await tenant.writeRecord("booking.reservation", reservationInput(2), OWNER));
    expect(next.ok).toBe(true);
  });

  it("存在しない slot への予約は booking:unknown_slot", async () => {
    const tenant = stub("booking-ghost-slot");
    await setupSlot(tenant, 1);
    const result = asWriteResult(
      await tenant.writeRecord(
        "booking.reservation",
        {
          recordId: uuid(150),
          input: { slot: { type: "booking.slot", id: uuid(99) }, name: "x", email: "x@example.com", state: "pending" },
        },
        OWNER,
      ),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("booking:unknown_slot");
  });
});

describe("確認通知イベント (§9.3 非同期副作用・冪等)", () => {
  it("afterWrite イベントの消化で booking.notification が作られ、再配達は no-op", async () => {
    const tenant = stub("booking-notify");
    await setupSlot(tenant, 2);
    await tenant.writeRecord("booking.reservation", reservationInput(1), OWNER);
    const job: ModuleQueueJob = {
      kind: "module_event",
      eventId: uuid(700),
      tenantId: "booking-notify", // DO 名 = idFromName の引数と一致させる(moduleWrite の宛先)
      moduleId: "booking",
      event: "afterWrite",
      recordId: uuid(101),
      typeKey: "booking.reservation",
    };
    await handleModuleJob(env, job);
    await handleModuleJob(env, job); // at-least-once の再配達
    await runInDurableObject(tenant, async (_instance, state) => {
      const rows = state.storage.sql
        .exec<{ n: number }>(
          "SELECT COUNT(*) AS n FROM records WHERE type = 'booking.notification' AND deleted_at IS NULL",
        )
        .one();
      expect(rows.n).toBe(1); // unique(reservation_id) が二重送信を防ぐ
    });
  });
});

describe("仮予約の失効 alarm (§9.6 / §9.8)", () => {
  it("TTL を過ぎた pending が alarm で cancelled になり、枠が解放される", async () => {
    const tenant = stub("booking-expire");
    await setupSlot(tenant, 1);
    await tenant.writeRecord("booking.reservation", reservationInput(1), OWNER);
    // 予約書き込みが module:booking の alarm を張っている
    await runInDurableObject(tenant, async (_instance, state) => {
      const row = state.storage.sql
        .exec<{ due_at: number }>("SELECT due_at FROM alarm_registry WHERE kind = ?", moduleAlarmKind("booking"))
        .toArray()[0];
      expect(row).toBeDefined();
      // updated_at を TTL より過去へ倒して失効条件を成立させ、due を現在へ前倒しする
      const past = new Date(Date.now() - BOOKING_PENDING_TTL_MS - 60_000).toISOString();
      state.storage.sql.exec("UPDATE records SET updated_at = ? WHERE id = ?", past, uuid(101));
      state.storage.sql.exec("UPDATE alarm_registry SET due_at = ? WHERE kind = ?", Date.now() - 1_000, moduleAlarmKind("booking"));
      await state.storage.setAlarm(Date.now() - 1_000);
    });
    const ran = await runDurableObjectAlarm(tenant);
    expect(ran).toBe(true);
    const expired = asRecordSnapshot(await tenant.getRecord(uuid(101)));
    expect(expired?.data["state"]).toBe("cancelled");
    // 枠が解放されている
    const next = asWriteResult(await tenant.writeRecord("booking.reservation", reservationInput(2), OWNER));
    expect(next.ok).toBe(true);
  });
});
```

注: Task 6 のテストコメント(reservation の editor forbidden)はこのタスク後も不変(ガードはフックより先)。`bookingModule` の import はフック実装の存在確認を型で兼ねる(未使用なら import しない)。

- [ ] **Step 2: FAIL を確認**

Run: `pnpm --filter @plyrs/api exec vitest run test/booking-module.test.ts`
Expected: FAIL(フック未実装のため slot_full にならない等)

- [ ] **Step 3: booking/module.ts を実装**

```ts
import type { BeforeWriteHook } from "../../do/hooks";
import type { ModuleAlarmContext, ModuleDefinition, ModuleEventContext } from "../registry";
import { loadRelationRefs } from "../../do/write-record";
import {
  BOOKING_MANIFEST,
  BOOKING_MODULE_ID,
  BOOKING_NOTIFICATION_KEY,
  BOOKING_RESERVATION_KEY,
  BOOKING_SLOT_KEY,
} from "./manifest";

// 仮予約(pending)の保持時間。過ぎると alarm が cancelled へ倒し枠を解放する(§9.8)。
export const BOOKING_PENDING_TTL_MS = 15 * 60_000;

// §9.3 同期バリデーションフック: single-writer の DO 内で空き枠を検証するため
// 「検証と書き込みが競合なく原子的」。
const beforeWrite: BeforeWriteHook = (ctx) => {
  if (ctx.contentType.key !== BOOKING_RESERVATION_KEY) {
    return null;
  }
  if (ctx.data["state"] === "cancelled") {
    return null; // 取消は枠を消費しない
  }
  const slotRef = (ctx.relations.get("slot") ?? [])[0];
  if (slotRef === undefined) {
    return null; // required 違反は metamodel の検証が先に落とす(防御的な素通し)
  }
  const slotRow = ctx.sql
    .exec<{ data: string }>(
      "SELECT data FROM records WHERE id = ? AND type = ? AND deleted_at IS NULL",
      slotRef.id,
      BOOKING_SLOT_KEY,
    )
    .toArray()[0];
  if (slotRow === undefined) {
    // ソフト参照(§5)の一般則に対し、予約だけは実在する枠を要求する(モジュールの業務制約)
    return { code: "booking:unknown_slot", message: `slot not found: ${slotRef.id}` };
  }
  const capacityRaw = (JSON.parse(slotRow.data) as Record<string, unknown>)["capacity"];
  const capacity = typeof capacityRaw === "number" ? capacityRaw : 0;
  const taken = ctx.sql
    .exec<{ n: number }>(
      "SELECT COUNT(*) AS n FROM relations rel JOIN records r ON r.id = rel.source_id WHERE rel.source_field = 'slot' AND rel.origin = 'field' AND rel.target_id = ? AND r.type = ? AND r.deleted_at IS NULL AND r.id != ? AND json_extract(r.data, '$.state') != 'cancelled'",
      slotRef.id,
      BOOKING_RESERVATION_KEY,
      ctx.recordId,
    )
    .one().n;
  if (taken >= capacity) {
    return { code: "booking:slot_full", message: `slot is fully booked (capacity ${capacity})` };
  }
  // 新規 pending は失効タイマーを予約(物理 setAlarm は minDueAt 経路 = TenantDO 側が担う)
  if (ctx.prev === null && ctx.data["state"] === "pending") {
    ctx.scheduleModuleAlarm?.(BOOKING_MODULE_ID, Date.now() + BOOKING_PENDING_TTL_MS);
  }
  return null;
};

// §9.3 非同期副作用: 確認メール送信の代替(面4 の外部送信は非目標)。at-least-once の再配達は
// booking.notification の unique(reservation_id) が unique_violation で畳む = 冪等。
async function handleAfterWrite(ctx: ModuleEventContext): Promise<void> {
  const result = await ctx.writeRecord(BOOKING_NOTIFICATION_KEY, {
    recordId: ctx.newId(),
    input: { reservation_id: ctx.recordId, kind: "reservation_written" },
  });
  if (!result.ok && result.code !== "unique_violation") {
    throw new Error(`booking notification failed: ${result.message}`); // retry へ
  }
}

// §9.6: 仮予約の失効。TTL を過ぎた pending を cancelled に倒す。書き込みは全置換(§8 の
// ワイヤ契約)なので、data 全キー + relation 全量を復元して state だけ差し替える。
function onAlarm(ctx: ModuleAlarmContext): void {
  const cutoff = new Date(ctx.now - BOOKING_PENDING_TTL_MS).toISOString();
  const stale = ctx.sql
    .exec<{ id: string; data: string; status: string }>(
      "SELECT id, data, status FROM records WHERE type = ? AND deleted_at IS NULL AND json_extract(data, '$.state') = 'pending' AND updated_at <= ?",
      BOOKING_RESERVATION_KEY,
      cutoff,
    )
    .toArray();
  for (const row of stale) {
    const data = JSON.parse(row.data) as Record<string, unknown>;
    const slotRefs = loadRelationRefs(ctx.sql, row.id).get("slot") ?? [];
    const input: Record<string, unknown> = { ...data, state: "cancelled" };
    if (slotRefs[0] !== undefined) {
      input["slot"] = slotRefs[0];
    }
    const result = ctx.writeRecord(BOOKING_RESERVATION_KEY, { recordId: row.id, input });
    if (!result.ok) {
      console.error("booking expire failed", row.id, result.message);
    }
  }
  // まだ pending が残っていれば、最も古い updated_at + TTL で次回を張る
  const oldest = ctx.sql
    .exec<{ min_updated: string | null }>(
      "SELECT MIN(updated_at) AS min_updated FROM records WHERE type = ? AND deleted_at IS NULL AND json_extract(data, '$.state') = 'pending'",
      BOOKING_RESERVATION_KEY,
    )
    .one().min_updated;
  if (oldest !== null) {
    ctx.schedule(new Date(oldest).getTime() + BOOKING_PENDING_TTL_MS);
  }
}

export const bookingModule: ModuleDefinition = {
  manifest: BOOKING_MANIFEST,
  beforeWrite,
  events: {
    afterWrite: { types: [BOOKING_RESERVATION_KEY], handle: handleAfterWrite },
  },
  onAlarm,
};
```

- [ ] **Step 4: PASS + 回帰を確認**

Run: `pnpm --filter @plyrs/api exec vitest run test/booking-module.test.ts && pnpm --filter @plyrs/api test`
Expected: PASS(module-hooks / module-enablement のテストで booking フックが増えた影響があれば期待値を確認して更新 — moduleBeforeWriteHooks が 1 本返るようになる)

- [ ] **Step 5: コミット**

```bash
pnpm format
git add apps/api/src/modules/booking/module.ts apps/api/test/booking-module.test.ts
git commit -m "feat: 予約モジュール(空き枠・通知・失効)"
```

---

### Task 11: モジュール管理 HTTP ルート + control-plane ミラー

tenantGate 配下に modules の管理 API を追加し、enable/disable を D1 `tenant_modules` へミラーする(Task 13 の再配布が宛先列挙に使う)。

**Files:**
- Modify: `apps/api/src/routes/tenant.ts`
- Test: `apps/api/test/module-routes.test.ts`(新規)

**Interfaces:**
- Produces(HTTP 契約 — admin の Task 14 が使う):
  - `GET /v1/t/:tenantId/modules` → `{ modules: ModuleSummary[] }`(読み取りは role 不問 — 既存規律)
  - `POST /v1/t/:tenantId/modules/:moduleId/enable` → `{ ok: true, module } | { ok: false, code, message }`(403/404/409)
  - `POST /v1/t/:tenantId/modules/:moduleId/disable` → 同上

- [ ] **Step 1: 失敗テストを書く**

`apps/api/test/module-routes.test.ts`(gate.test.ts の HTTP フロー様式: signup → tenant 作成 → token → 叩く。既存ヘルパーがあれば流用):

```ts
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/d1";
import { memberships } from "@plyrs/db/control-plane";
import { app } from "../src/index";

// gate.test.ts の bootstrapTenant / grantMembership 様式(共有ストレージ対策のランダム接頭辞込み)
const RUN_ID = crypto.randomUUID().slice(0, 8);
let n = 0;
function unique(prefix: string): string {
  n += 1;
  return `${prefix}${RUN_ID}-${n}`;
}

function json(body: unknown, headers: Record<string, string> = {}): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  };
}

async function setupTenant(): Promise<{ tenantId: string; ownerToken: string; viewerToken: string }> {
  const signup = await app.request(
    "/auth/signup",
    json({ email: `${unique("owner")}@example.com`, password: "hunter2hunter2" }),
    env,
  );
  const cookie = (signup.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  const created = await app.request("/v1/tenants", json({ name: "T", slug: unique("t-") }, { cookie }), env);
  const { tenantId } = (await created.json()) as { tenantId: string };
  const issued = await app.request("/auth/token", json({ tenantId }, { cookie }), env);
  const { token: ownerToken } = (await issued.json()) as { token: string };

  const viewerSignup = await app.request(
    "/auth/signup",
    json({ email: `${unique("viewer")}@example.com`, password: "hunter2hunter2" }),
    env,
  );
  const { userId: viewerId } = (await viewerSignup.json()) as { userId: string };
  const viewerCookie = (viewerSignup.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  await drizzle(env.DB)
    .insert(memberships)
    .values({ userId: viewerId, tenantId, role: "viewer", createdAt: new Date().toISOString() });
  const viewerIssued = await app.request("/auth/token", json({ tenantId }, { cookie: viewerCookie }), env);
  const { token: viewerToken } = (await viewerIssued.json()) as { token: string };
  return { tenantId, ownerToken, viewerToken };
}

describe("モジュール管理 API", () => {
  it("enable → 一覧 → disable が HTTP で一巡し、D1 ミラーが更新される", async () => {
    const { tenantId, ownerToken } = await setupTenant();
    const enable = await app.request(
      `/v1/t/${tenantId}/modules/booking/enable`,
      { method: "POST", headers: { authorization: `Bearer ${ownerToken}` } },
      env,
    );
    expect(enable.status).toBe(200);
    const list = await app.request(
      `/v1/t/${tenantId}/modules`,
      { headers: { authorization: `Bearer ${ownerToken}` } },
      env,
    );
    const { modules } = (await list.json()) as { modules: { moduleId: string; enabled: boolean }[] };
    expect(modules).toEqual([
      expect.objectContaining({ moduleId: "booking", enabled: true, appliedVersion: 1 }),
    ]);
    const mirror = await env.DB.prepare(
      "SELECT enabled FROM tenant_modules WHERE tenant_id = ? AND module_id = 'booking'",
    )
      .bind(tenantId)
      .first<{ enabled: number }>();
    expect(mirror?.enabled).toBe(1);

    const disable = await app.request(
      `/v1/t/${tenantId}/modules/booking/disable`,
      { method: "POST", headers: { authorization: `Bearer ${ownerToken}` } },
      env,
    );
    expect(disable.status).toBe(200);
    const mirrorAfter = await env.DB.prepare(
      "SELECT enabled FROM tenant_modules WHERE tenant_id = ? AND module_id = 'booking'",
    )
      .bind(tenantId)
      .first<{ enabled: number }>();
    expect(mirrorAfter?.enabled).toBe(0);
  });

  it("viewer の enable は 403、未知モジュールは 404", async () => {
    const { tenantId, ownerToken, viewerToken } = await setupTenant();
    const forbidden = await app.request(
      `/v1/t/${tenantId}/modules/booking/enable`,
      { method: "POST", headers: { authorization: `Bearer ${viewerToken}` } },
      env,
    );
    expect(forbidden.status).toBe(403);
    const unknown = await app.request(
      `/v1/t/${tenantId}/modules/ghost/enable`,
      { method: "POST", headers: { authorization: `Bearer ${ownerToken}` } },
      env,
    );
    expect(unknown.status).toBe(404);
  });
});
```

- [ ] **Step 2: FAIL を確認**

Run: `pnpm --filter @plyrs/api exec vitest run test/module-routes.test.ts`
Expected: FAIL(404 — ルートが無い)

- [ ] **Step 3: ルートを実装**

`apps/api/src/routes/tenant.ts`(tenantGate 配下、content-types ルート群の隣)。`ERROR_STATUS` に `unknown_module: 404, type_conflict: 409` を追加し、enable / disable は publish / unpublish ルートと同じ様式で素直に 2 ルート書く:

```ts
  .get("/:tenantId/modules", async (c) => {
    const modules = asModuleSummaries(await stubFor(c).listModules());
    return c.json({ modules });
  })
  .post("/:tenantId/modules/:moduleId/enable", async (c) => {
    const tenantId = c.req.param("tenantId");
    const result = asEnableModuleResult(
      await stubFor(c).enableModule(tenantId, c.req.param("moduleId"), c.get("auth")),
    );
    if (result.ok) {
      await mirrorTenantModule(c.env, tenantId, result.module.moduleId, true);
      return c.json(result);
    }
    return c.json(result, statusFor(result.code));
  })
  .post("/:tenantId/modules/:moduleId/disable", async (c) => {
    const tenantId = c.req.param("tenantId");
    const result = asEnableModuleResult(
      await stubFor(c).disableModule(tenantId, c.req.param("moduleId"), c.get("auth")),
    );
    if (result.ok) {
      await mirrorTenantModule(c.env, tenantId, result.module.moduleId, false);
      return c.json(result);
    }
    return c.json(result, statusFor(result.code));
  })
```

ミラー関数(同ファイル):

```ts
// Phase 9: 有効化状態の control-plane ミラー(真実源は DO)。再配布(§4.2)の宛先列挙用。
// best-effort — 失敗しても DO 側は確定しており、起床時の遅延適用が安全網になる。
async function mirrorTenantModule(
  env: Env,
  tenantId: string,
  moduleId: string,
  enabled: boolean,
): Promise<void> {
  try {
    await env.DB.prepare(
      "INSERT INTO tenant_modules (tenant_id, module_id, enabled, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(tenant_id, module_id) DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at",
    )
      .bind(tenantId, moduleId, enabled ? 1 : 0, new Date().toISOString())
      .run();
  } catch (error) {
    console.error("tenant_modules mirror failed", tenantId, moduleId, error);
  }
}
```

import に `asEnableModuleResult`, `asModuleSummaries` を追加。

- [ ] **Step 4: PASS を確認**

Run: `pnpm --filter @plyrs/api exec vitest run test/module-routes.test.ts && pnpm --filter @plyrs/api test`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
pnpm format
git add apps/api/src/routes/tenant.ts apps/api/test/module-routes.test.ts
git commit -m "feat: モジュール管理 API と D1 ミラー"
```

---

### Task 12: 公開 write(論点W): Turnstile + Rate Limiting + modulePublicWrite

§11.7 を実装する。公開経路の write は「レート制限 → 入力検証 → テナント解決 → Turnstile → DO(第2段 = publicWriteTypes 宣言)」の順で守り、fail-closed にする。

**Files:**
- Create: `apps/api/src/modules/turnstile.ts`
- Modify: `apps/api/src/modules/booking/module.ts`(publicEndpoints 追加)
- Modify: `apps/api/src/tenant-do.ts`(modulePublicWrite RPC)
- Create: `apps/api/src/routes/public-write.ts`
- Modify: `apps/api/src/index.ts`(マウント)
- Modify: `apps/api/wrangler.jsonc` / `apps/api/env.d.ts` / `apps/api/vitest.config.ts`
- Test: `apps/api/test/public-write.test.ts`(新規)

**Interfaces:**
- Produces:
  - `verifyTurnstile(secret: string, token: string, remoteIp: string | null): Promise<boolean>`(turnstile.ts)
  - TenantDO `modulePublicWrite(tenantId: string, moduleId: string, typeKey: string, params: WriteRecordInput): Promise<WriteRecordResult>`(module 有効 + manifest.publicWriteTypes 宣言 + **新規作成のみ**。actor `public:{moduleId}`。beforeWrite フックは通る = 空き枠検証が効く)
  - HTTP `POST /public/v1/:tenantSlug/modules/:moduleId/:endpoint`。body は `{ turnstileToken: string, input: {...} }`。201 で `{ ok: true, recordId }`
  - Env: `TURNSTILE_SECRET_KEY: string`(secret。テストは vitest.config、dev は .dev.vars、本番は wrangler secret — JWT_SECRET と同じ扱い)/ `PUBLIC_WRITE_LIMITER?: { limit(options: { key: string }): Promise<{ success: boolean }> }`
- Consumes: `resolveTenantId`(src/public/tenant-resolver — 公開 read と同じ解決器)

- [ ] **Step 1: 失敗テストを書く**

`apps/api/test/public-write.test.ts`。Turnstile は pool-workers の `fetchMock`(cloudflare:test)で siteverify をモックし、Rate Limiter は `app.request` の env 差し替えでフェイクを注入する:

```ts
import { fetchMock } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { app } from "../src/index";
import type { AuthContext } from "../src/do/authorize";

const TENANT_ID = "t-pubwrite";
const TENANT_SLUG = "pubwrite";
const OWNER: AuthContext = { userId: "u-owner", role: "owner", tenantId: TENANT_ID };

function uuid(n: number): string {
  return `00000000-0000-7000-8000-${String(n).padStart(12, "0")}`;
}

function fakeLimiter(succeed: boolean): { limit(options: { key: string }): Promise<{ success: boolean }> } {
  return { limit: async () => ({ success: succeed }) };
}

function testEnv(limiterSucceeds = true): Env {
  return { ...env, PUBLIC_WRITE_LIMITER: fakeLimiter(limiterSucceeds) };
}

function mockSiteverify(success: boolean): void {
  fetchMock
    .get("https://challenges.cloudflare.com")
    .intercept({ path: "/turnstile/v0/siteverify", method: "POST" })
    .reply(200, JSON.stringify({ success }));
}

function reservationBody(turnstileToken = "tok"): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      turnstileToken,
      input: { slot: uuid(2), name: "公開予約者", email: "guest@example.com" },
    }),
  };
}

async function seedTenantAndSlot(): Promise<void> {
  await env.DB.prepare("INSERT OR REPLACE INTO tenants (id, slug, name, created_at) VALUES (?, ?, ?, ?)")
    .bind(TENANT_ID, TENANT_SLUG, "公開予約テナント", new Date().toISOString())
    .run();
  const tenant = env.TENANT_DO.get(env.TENANT_DO.idFromName(TENANT_ID));
  await tenant.enableModule(TENANT_ID, "booking", OWNER);
  await tenant.writeRecord("booking.resource", { recordId: uuid(1), input: { name: "会議室" } }, OWNER);
  await tenant.writeRecord(
    "booking.slot",
    {
      recordId: uuid(2),
      input: {
        resource: { type: "booking.resource", id: uuid(1) },
        starts_at: "2026-08-01T10:00:00Z",
        ends_at: "2026-08-01T11:00:00Z",
        capacity: 1,
      },
    },
    OWNER,
  );
}

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});

afterEach(() => {
  fetchMock.assertNoPendingInterceptors();
});

describe("公開 write (design-spec §11.7 = 論点W)", () => {
  it("Turnstile を通過した予約が 201 で作成される", async () => {
    await seedTenantAndSlot();
    mockSiteverify(true);
    const res = await app.request(
      `/public/v1/${TENANT_SLUG}/modules/booking/reservations`,
      reservationBody(),
      testEnv(),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { ok: true; recordId: string };
    expect(body.ok).toBe(true);
    // DO に pending 予約が作られている(actor は public:booking)
    const tenant = env.TENANT_DO.get(env.TENANT_DO.idFromName(TENANT_ID));
    const record = await tenant.getRecord(body.recordId);
    expect((record as { data: Record<string, unknown> }).data["state"]).toBe("pending");
    expect((record as { createdBy: string }).createdBy).toBe("public:booking");
  });

  it("Turnstile 失敗は 403、siteverify にはリクエストが飛ぶ", async () => {
    await seedTenantAndSlot();
    mockSiteverify(false);
    const res = await app.request(
      `/public/v1/${TENANT_SLUG}/modules/booking/reservations`,
      reservationBody(),
      testEnv(),
    );
    expect(res.status).toBe(403);
  });

  it("レート制限超過は 429(Turnstile まで到達しない)", async () => {
    await seedTenantAndSlot();
    const res = await app.request(
      `/public/v1/${TENANT_SLUG}/modules/booking/reservations`,
      reservationBody(),
      testEnv(false),
    );
    expect(res.status).toBe(429);
  });

  it("満席の枠は booking:slot_full の 409(第2段のフックが公開経路にも効く)", async () => {
    await seedTenantAndSlot();
    mockSiteverify(true);
    const first = await app.request(
      `/public/v1/${TENANT_SLUG}/modules/booking/reservations`,
      reservationBody(),
      testEnv(),
    );
    expect(first.status).toBe(201);
    mockSiteverify(true);
    const second = await app.request(
      `/public/v1/${TENANT_SLUG}/modules/booking/reservations`,
      reservationBody(),
      testEnv(),
    );
    expect(second.status).toBe(409);
    expect(((await second.json()) as { code: string }).code).toBe("booking:slot_full");
  });

  it("入力検証エラーは Turnstile 前に 400(siteverify を浪費しない)", async () => {
    await seedTenantAndSlot();
    const res = await app.request(
      `/public/v1/${TENANT_SLUG}/modules/booking/reservations`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ turnstileToken: "tok", input: { slot: "not-a-uuid" } }),
      },
      testEnv(),
    );
    expect(res.status).toBe(400);
  });

  it("未知エンドポイント・未有効モジュール・未構成は閉じる", async () => {
    await seedTenantAndSlot();
    const unknown = await app.request(
      `/public/v1/${TENANT_SLUG}/modules/booking/ghost`,
      reservationBody(),
      testEnv(),
    );
    expect(unknown.status).toBe(404);
    // 濫用防止層の未構成は fail-closed(503)
    const bare = { ...env, PUBLIC_WRITE_LIMITER: undefined } as unknown as Env;
    const misconfigured = await app.request(
      `/public/v1/${TENANT_SLUG}/modules/booking/reservations`,
      reservationBody(),
      bare,
    );
    expect(misconfigured.status).toBe(503);
  });
});
```

注: 既存の公開 read テストが素の `env` で動くため、fetchMock の `disableNetConnect` はこのファイル内に閉じる(pool-workers はテストファイルごとに fetchMock 状態が独立)。slot が埋まった状態のリセットは各 it の DO 名を分けたければ TENANT_ID/SLUG を it ごとの suffix にしてよい(共有ストレージ対策 — gate.test.ts の unique 様式)。

- [ ] **Step 2: FAIL を確認**

Run: `pnpm --filter @plyrs/api exec vitest run test/public-write.test.ts`
Expected: FAIL(404 — ルートが無い)

- [ ] **Step 3: 実装**

(a) `apps/api/src/modules/turnstile.ts`:

```ts
// 論点W: 公開 write の bot 対策。Cloudflare Turnstile の siteverify を叩く。
// dev は Turnstile のダミーシークレット(常に成功: 1x0000000000000000000000000000000AA)を
// .dev.vars に置く。テストは fetchMock でこの URL をモックする。
export const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export async function verifyTurnstile(
  secret: string,
  token: string,
  remoteIp: string | null,
): Promise<boolean> {
  const body = new URLSearchParams({ secret, response: token });
  if (remoteIp !== null) {
    body.set("remoteip", remoteIp);
  }
  try {
    const response = await fetch(TURNSTILE_VERIFY_URL, { method: "POST", body });
    if (!response.ok) {
      return false;
    }
    const result = (await response.json()) as { success?: boolean };
    return result.success === true;
  } catch (error) {
    // 検証系の障害は拒否側に倒す(fail-closed)
    console.error("turnstile verify failed", error);
    return false;
  }
}
```

(b) `apps/api/src/modules/booking/module.ts` に公開エンドポイント宣言を追加(`bookingModule` に `publicEndpoints`):

```ts
import { uuidSchema } from "@plyrs/metamodel";
import { z } from "zod";
```

```ts
// §9.7 / §11.7: モジュールが明示的に公開した write エンドポイントだけが DO に到達する。
// recordId はサーバー生成 — 公開経路から既存 record を指すことはできない。
const reservationEndpoint = {
  typeKey: BOOKING_RESERVATION_KEY,
  inputSchema: z.strictObject({
    slot: uuidSchema,
    name: z.string().min(1).max(200),
    email: z.string().min(3).max(320),
  }) as z.ZodType<Record<string, unknown>>,
  buildWrite(input: Record<string, unknown>, ids: { newId(): string }) {
    return {
      recordId: ids.newId(),
      input: {
        slot: { type: BOOKING_SLOT_KEY, id: input["slot"] },
        name: input["name"],
        email: input["email"],
        state: "pending",
      },
    };
  },
};
```

```ts
export const bookingModule: ModuleDefinition = {
  manifest: BOOKING_MANIFEST,
  beforeWrite,
  events: {
    afterWrite: { types: [BOOKING_RESERVATION_KEY], handle: handleAfterWrite },
  },
  onAlarm,
  publicEndpoints: { reservations: reservationEndpoint },
};
```

(strictObject → `z.ZodType<Record<string, unknown>>` の cast が oxlint/tsc で通らない場合は `inputSchema` の型を `PublicWriteEndpoint` 側で `z.ZodType<Record<string, unknown>>` から `z.ZodTypeAny` 相当の具体形に調整してよい — その場合は registry.ts の型も同時に直し、理由コメントを残す)

(c) `apps/api/src/tenant-do.ts` に `modulePublicWrite` RPC(moduleWrite の隣):

```ts
  // §11.7 第2段: 公開エンドポイントはマニフェストの publicWriteTypes 宣言の型だけを、
  // 新規作成に限って書ける。beforeWrite フック(空き枠検証)は通常どおり通る。
  async modulePublicWrite(
    tenantId: string,
    moduleId: string,
    typeKey: string,
    params: WriteRecordInput,
  ): Promise<WriteRecordResult> {
    const module = moduleById(moduleId);
    if (module === undefined || !isModuleEnabled(this.ctx.storage.sql, moduleId)) {
      return { ok: false, code: "forbidden", message: `module is not enabled: ${moduleId}` };
    }
    if (!module.manifest.publicWriteTypes.includes(typeKey)) {
      return { ok: false, code: "forbidden", message: `public write is not declared for '${typeKey}'` };
    }
    const contentType = loadContentTypeByKey(this.ctx.storage.sql, typeKey);
    if (contentType === null) {
      return { ok: false, code: "unknown_type", message: `unknown content type: ${typeKey}` };
    }
    if (loadRecord(this.ctx.storage.sql, params.recordId) !== null) {
      return { ok: false, code: "forbidden", message: "public write cannot modify existing records" };
    }
    const armed: Promise<void>[] = [];
    const result = this.ctx.storage.transactionSync(() => {
      this.rememberTenant(tenantId);
      const inner = writeRecordCore(
        {
          sql: this.ctx.storage.sql,
          nextSeq: () => ++this.seq,
          now: () => new Date().toISOString(),
          newRelationId: () => uuidv7(),
          newEventId: () => uuidv7(),
          scheduleModuleAlarm: (id, dueAt) => {
            const min = registerAlarm(this.ctx.storage.sql, moduleAlarmKind(id), dueAt);
            armed.push(this.ctx.storage.setAlarm(min));
          },
        },
        contentType,
        { ...params, actor: `public:${moduleId}` },
      );
      if (inner.ok && inner.applied && countUnsentModuleEvents(this.ctx.storage.sql) > 0) {
        armed.push(this.armModuleEventsSweep(Date.now() + SWEEP_DELAY_MS));
      }
      return inner;
    });
    await Promise.all(armed);
    if (result.ok && result.applied) {
      const stored = loadSyncRecord(this.ctx.storage.sql, params.recordId);
      if (stored !== null) {
        this.broadcastAll({ type: "change", record: stored });
      }
      await this.drainModuleEvents();
    }
    return result;
  }
```

(d) `apps/api/src/routes/public-write.ts`:

```ts
import { Hono } from "hono";
import { cors } from "hono/cors";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { issuesToMessage } from "../do/content-types";
import { moduleById } from "../modules/registry";
import { verifyTurnstile } from "../modules/turnstile";
import { resolveTenantId } from "../public/tenant-resolver";
import { asWriteResult } from "../rpc-unwrap";

// design-spec §11.7(論点W): 公開 write は第1段(メンバーシップゲート)を持たない代わりに
// 濫用防止層(レート制限 → 入力検証 → Turnstile)を第1段の位置に置く。第2段は DO の
// modulePublicWrite(publicWriteTypes 宣言)。順序の意図: レート制限が最安・最前、
// 入力検証は Turnstile より前(siteverify の外部呼び出しをゴミ入力に浪費しない)。
const publicWriteBodySchema = z.object({
  turnstileToken: z.string().min(1),
  input: z.record(z.string(), z.unknown()),
});

export const publicWriteRoutes = new Hono<{ Bindings: Env }>()
  .use(
    "/*",
    cors({ origin: "*", allowMethods: ["POST", "OPTIONS"], allowHeaders: ["content-type"] }),
  )
  .post("/:tenantSlug/modules/:moduleId/:endpoint", async (c) => {
    const module = moduleById(c.req.param("moduleId"));
    const endpoint = module?.publicEndpoints?.[c.req.param("endpoint")];
    if (module === undefined || endpoint === undefined) {
      return c.json({ error: "not_found" }, 404);
    }
    const limiter = c.env.PUBLIC_WRITE_LIMITER;
    const secret = c.env.TURNSTILE_SECRET_KEY;
    if (limiter === undefined || secret === undefined || secret === "") {
      // 濫用防止層が構成されていない公開 write は開かない(JWT_SECRET と同じ fail-closed 思想)
      return c.json({ error: "misconfigured" }, 503);
    }
    const tenantId = await resolveTenantId(c.env, c.req.param("tenantSlug"));
    if (tenantId === null) {
      return c.json({ error: "unknown_tenant" }, 404);
    }
    const ip = c.req.header("cf-connecting-ip") ?? "unknown";
    const { success: withinLimit } = await limiter.limit({ key: `pubwrite:${tenantId}:${ip}` });
    if (!withinLimit) {
      return c.json({ error: "rate_limited" }, 429);
    }
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return c.json({ error: "invalid_json" }, 400);
    }
    const body = publicWriteBodySchema.safeParse(raw);
    if (!body.success) {
      return c.json({ error: "invalid_body" }, 400);
    }
    const input = endpoint.inputSchema.safeParse(body.data.input);
    if (!input.success) {
      return c.json({ error: "validation_failed", message: issuesToMessage(input.error.issues) }, 400);
    }
    const human = await verifyTurnstile(secret, body.data.turnstileToken, c.req.header("cf-connecting-ip") ?? null);
    if (!human) {
      return c.json({ error: "turnstile_failed" }, 403);
    }
    const write = endpoint.buildWrite(input.data, { newId: () => uuidv7() });
    const stub = c.env.TENANT_DO.get(c.env.TENANT_DO.idFromName(tenantId));
    const result = asWriteResult(
      await stub.modulePublicWrite(tenantId, module.manifest.moduleId, endpoint.typeKey, write),
    );
    if (!result.ok) {
      // モジュール名前空間コード(例 booking:slot_full)は業務上の競合 = 409。
      // システム語彙は管理 API と同じ対応(forbidden 403 / validation 400)に落とす。
      const status = result.code.includes(":") ? 409 : result.code === "forbidden" ? 403 : 400;
      return c.json({ ok: false, code: result.code, message: result.message }, status);
    }
    return c.json({ ok: true, recordId: result.record.id }, 201);
  });
```

(e) `apps/api/src/index.ts`: `app.route("/public/v1", publicRoutes);` の**前**に `app.route("/public/v1", publicWriteRoutes);` を追加(メソッドが違うため衝突しない。POST の 404 を read 側の notFound に食わせない順序)。

(f) `apps/api/wrangler.jsonc` に追加:

```jsonc
  "unsafe": {
    "bindings": [
      // 論点W: 公開 write のレート制限。simple.limit/period はテナント×IP キーに対する値。
      // period は 10 か 60 のみ許容(プラットフォーム制約)。
      { "name": "PUBLIC_WRITE_LIMITER", "type": "ratelimit", "namespace_id": "1001", "simple": { "limit": 10, "period": 60 } },
    ],
  },
```

**コンティンジェンシー**: この unsafe binding で `vitest`(pool-workers/miniflare)の起動が失敗する場合は、wrangler.jsonc から外して「本番/preview のデプロイ設定にのみ手動追加する」方針に切り替え、STATUS レポートに実エラーを貼って申し送り対象として記録する(コードは env optional + fail-closed なので他タスクに影響しない)。

(g) `apps/api/env.d.ts` に追加:

```ts
  // 論点W: 公開 write の濫用防止。Turnstile secret は JWT_SECRET と同じ扱い
  // (テスト = vitest.config、dev = .dev.vars、本番 = wrangler secret)。
  TURNSTILE_SECRET_KEY: string;
  // Rate Limiting binding(open beta)。型は wrangler 生成に依存せず構造で持つ。
  // 未構成は公開 write ルートが 503 で閉じる(fail-closed)。
  PUBLIC_WRITE_LIMITER?: { limit(options: { key: string }): Promise<{ success: boolean }> };
```

(h) `apps/api/vitest.config.ts` の miniflare.bindings に `TURNSTILE_SECRET_KEY: "test-turnstile-secret"` を追加。

- [ ] **Step 4: PASS + 回帰を確認**

Run: `pnpm --filter @plyrs/api exec vitest run test/public-write.test.ts && pnpm --filter @plyrs/api test && pnpm typecheck`
Expected: PASS(公開 read の既存テストが fetchMock の影響を受けないこと)

- [ ] **Step 5: コミット**

```bash
pnpm format
git add apps/api/src/modules/turnstile.ts apps/api/src/modules/booking/module.ts apps/api/src/tenant-do.ts apps/api/src/routes/public-write.ts apps/api/src/index.ts apps/api/wrangler.jsonc apps/api/env.d.ts apps/api/vitest.config.ts apps/api/test/public-write.test.ts
git commit -m "feat: 公開 write と Turnstile / レート制限(論点W)"
```

---

### Task 13: Queues による型定義再配布(§4.2)+ DO 起床時の遅延再適用

モジュール更新(マニフェスト version 上げ)を有効化テナントへ配る機構。トリガー UI は Phase 10(特権テナント)へ送り、本タスクは機構とテストを完成させる。

**Files:**
- Modify: `apps/api/src/modules/redistribute.ts`(Task 9 の仮実装を置換)
- Modify: `apps/api/src/tenant-do.ts`(applyModuleManifest RPC + constructor 遅延再適用)
- Modify: `apps/api/src/modules/enablement.ts`(ensureEnabledModuleTypes)
- Test: `apps/api/test/module-redistribute.test.ts`(新規)

**Interfaces:**
- Produces:
  - `handleModuleSyncJob(env, job: ModuleSyncJob | ModuleRedistributeJob, registry?): Promise<void>`(redistribute: D1 `tenant_modules` から enabled=1 を列挙し `module_sync` を送出 / sync: DO の applyModuleManifest を呼ぶ)
  - TenantDO `applyModuleManifest(moduleId: string): { ok: true; applied: boolean } | { ok: false; code: "unknown_module"; message: string }`(無効テナントでは `applied: false` の no-op)
  - `ensureEnabledModuleTypes(sql, now: string): boolean`(enablement.ts — 有効モジュールで appliedVersion !== コード版 version のものへ applyModuleTypes + 行更新。constructor から呼ぶ)

- [ ] **Step 1: 失敗テストを書く**

`apps/api/test/module-redistribute.test.ts`。コード側マニフェストの version は動かせないため、DO の `applied_version` を直接下げて「古い適用状態」を模擬する:

```ts
import { env, runInDurableObject, evictDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { handleModuleJob, type ModuleQueueJob } from "../src/modules/events";
import { asModuleSummaries } from "../src/rpc-unwrap";
import type { AuthContext } from "../src/do/authorize";

function stub(name: string) {
  return env.TENANT_DO.get(env.TENANT_DO.idFromName(name));
}

function owner(tenantId: string): AuthContext {
  return { userId: "u-owner", role: "owner", tenantId };
}

async function markStale(tenant: ReturnType<typeof stub>): Promise<void> {
  await runInDurableObject(tenant, async (_instance, state) => {
    state.storage.sql.exec("UPDATE module_registry SET applied_version = 0 WHERE module_id = 'booking'");
  });
}

describe("型定義再配布 (design-spec §4.2)", () => {
  it("module_sync ジョブが applied_version を現行へ引き上げる", async () => {
    const tenantId = "redis-sync-1";
    const tenant = stub(tenantId);
    await tenant.enableModule(tenantId, "booking", owner(tenantId));
    await markStale(tenant);
    const job: ModuleQueueJob = { kind: "module_sync", tenantId, moduleId: "booking" };
    await handleModuleJob(env, job);
    const modules = asModuleSummaries(await tenant.listModules());
    expect(modules[0]).toMatchObject({ moduleId: "booking", appliedVersion: 1 });
  });

  it("module_redistribute が D1 ミラーの有効テナントへ module_sync をファンアウトする", async () => {
    const now = new Date().toISOString();
    await env.DB.prepare(
      "INSERT OR REPLACE INTO tenant_modules (tenant_id, module_id, enabled, updated_at) VALUES ('redis-fan-1', 'booking', 1, ?), ('redis-fan-2', 'booking', 0, ?)",
    )
      .bind(now, now)
      .run();
    const sent: ModuleQueueJob[] = [];
    const fanoutEnv = {
      ...env,
      MODULES_QUEUE: { send: async (job: ModuleQueueJob) => void sent.push(job) },
    } as unknown as Env; // テスト専用: send だけ観測するフェイク(境界 cast)
    await handleModuleJob(fanoutEnv, { kind: "module_redistribute", moduleId: "booking" });
    expect(sent).toEqual([{ kind: "module_sync", tenantId: "redis-fan-1", moduleId: "booking" }]);
  });

  it("無効テナントへの module_sync は no-op(型を勝手に足さない)", async () => {
    const tenantId = "redis-sync-disabled";
    const tenant = stub(tenantId);
    await tenant.ping();
    await handleModuleJob(env, { kind: "module_sync", tenantId, moduleId: "booking" });
    const modules = asModuleSummaries(await tenant.listModules());
    expect(modules[0]).toMatchObject({ enabled: false, appliedVersion: 0 });
  });

  it("DO 起床時の遅延再適用が applied_version を追い付かせる(Queues を待たない安全網)", async () => {
    const tenantId = "redis-lazy";
    const tenant = stub(tenantId);
    await tenant.enableModule(tenantId, "booking", owner(tenantId));
    await markStale(tenant);
    await evictDurableObject(tenant);
    await tenant.ping(); // constructor の ensureEnabledModuleTypes が走る
    const modules = asModuleSummaries(await tenant.listModules());
    expect(modules[0]).toMatchObject({ appliedVersion: 1 });
  });
});
```

- [ ] **Step 2: FAIL を確認**

Run: `pnpm --filter @plyrs/api exec vitest run test/module-redistribute.test.ts`
Expected: FAIL(redistribute.ts が throw する / applyModuleManifest が無い)

- [ ] **Step 3: 実装**

(a) `apps/api/src/modules/enablement.ts` に追加:

```ts
import { MODULE_REGISTRY, type ModuleDefinition } from "./registry";
```

```ts
// §4.2 の安全網: DO が起きたとき、有効モジュールの適用済み version がコード側と違えば
// その場で追い付かせる(Queues の再配布を待たない。ensureAssetContentType と同じ思想)。
export function ensureEnabledModuleTypes(
  sql: SqlStorage,
  now: string,
  registry: Record<string, ModuleDefinition> = MODULE_REGISTRY,
): boolean {
  let changed = false;
  for (const row of moduleRegistryRows(sql)) {
    if (!row.enabled) {
      continue;
    }
    const module = registry[row.moduleId];
    if (module === undefined || module.manifest.version === row.appliedVersion) {
      continue;
    }
    if (applyModuleTypes(sql, module.manifest, now)) {
      changed = true;
    }
    upsertModuleEnablement(sql, {
      moduleId: row.moduleId,
      enabled: true,
      appliedVersion: module.manifest.version,
      permissions: permissionsFromManifest(module.manifest),
      now,
    });
  }
  return changed;
}
```

(循環 import に注意: registry.ts は enablement.ts を import していないので、enablement → registry の import は安全。もし将来循環が生じたら registry を引数で受ける形へ寄せる — 既に registry パラメータで注入可能にしてある)

(b) `apps/api/src/tenant-do.ts`:

- constructor の `blockConcurrencyWhile` 内、`ensureAssetContentType` の直後に:

```ts
      const moduleTypesChanged = ensureEnabledModuleTypes(ctx.storage.sql, new Date().toISOString());
      if (assetTypeChanged || moduleTypesChanged) {
        this.broadcastAll({
          type: "content-types",
          contentTypes: loadAllContentTypes(ctx.storage.sql),
        });
      }
```

(既存の `if (assetTypeChanged)` ブロードキャストをこの合流形に置き換える)

- `applyModuleManifest` RPC:

```ts
  // §4.2: Queues 再配布の着地点。冪等(同一定義は Task 3 の no-op + applied_version 一致で
  // 何もしない)。無効テナントには型を足さない。
  applyModuleManifest(moduleId: string): { ok: true; applied: boolean } | { ok: false; code: "unknown_module"; message: string } {
    const module = moduleById(moduleId);
    if (module === undefined) {
      return { ok: false, code: "unknown_module", message: `unknown module: ${moduleId}` };
    }
    if (!isModuleEnabled(this.ctx.storage.sql, moduleId)) {
      return { ok: true, applied: false };
    }
    const now = new Date().toISOString();
    let changed = false;
    this.ctx.storage.transactionSync(() => {
      changed = applyModuleTypes(this.ctx.storage.sql, module.manifest, now);
      upsertModuleEnablement(this.ctx.storage.sql, {
        moduleId,
        enabled: true,
        appliedVersion: module.manifest.version,
        permissions: permissionsFromManifest(module.manifest),
        now,
      });
    });
    if (changed) {
      this.broadcastAll({
        type: "content-types",
        contentTypes: loadAllContentTypes(this.ctx.storage.sql),
      });
    }
    return { ok: true, applied: changed };
  }
```

(c) `apps/api/src/modules/redistribute.ts` を本実装へ置換:

```ts
import type { ModuleRedistributeJob, ModuleSyncJob } from "./events";

// design-spec §4.2: モジュール更新時、コントロールプレーンが有効化テナントごとに
// マイグレーションジョブを Queues で配信する。redistribute は D1 ミラー(tenant_modules)から
// 宛先を列挙して module_sync をファンアウトし、sync は各テナント DO へ冪等適用する。
// トリガー(誰がいつ redistribute を積むか)は Phase 10 の特権テナント運用面の責務。
export async function handleModuleSyncJob(
  env: Env,
  job: ModuleSyncJob | ModuleRedistributeJob,
): Promise<void> {
  if (job.kind === "module_sync") {
    const stub = env.TENANT_DO.get(env.TENANT_DO.idFromName(job.tenantId));
    const result = (await stub.applyModuleManifest(job.moduleId)) as
      | { ok: true; applied: boolean }
      | { ok: false; code: string; message: string }; // RPC 境界の型戻し(rpc-unwrap 様式)
    if (!result.ok) {
      throw new Error(`module sync failed: ${result.message}`); // retry へ
    }
    return;
  }
  const rows = await env.DB.prepare(
    "SELECT tenant_id FROM tenant_modules WHERE module_id = ? AND enabled = 1",
  )
    .bind(job.moduleId)
    .all<{ tenant_id: string }>();
  for (const row of rows.results) {
    await env.MODULES_QUEUE.send({ kind: "module_sync", tenantId: row.tenant_id, moduleId: job.moduleId });
  }
}
```

(events.ts の dynamic import は静的 import に変えてよい — Task 9 で仮実装だった循環回避が不要になったら整理し、`handleModuleJob` の `case "module_sync": case "module_redistribute":` から直接呼ぶ)

- [ ] **Step 4: PASS + 回帰を確認**

Run: `pnpm --filter @plyrs/api exec vitest run test/module-redistribute.test.ts && pnpm --filter @plyrs/api test && pnpm typecheck`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
pnpm format
git add apps/api/src/modules/redistribute.ts apps/api/src/modules/events.ts apps/api/src/modules/enablement.ts apps/api/src/tenant-do.ts apps/api/test/module-redistribute.test.ts
git commit -m "feat: Queues 型定義再配布と起床時遅延適用"
```

---

### Task 14: admin モジュール設定ページ(有効化トグル)

裁定 4: 設定ページ 1 枚。モジュール一覧・有効/無効トグル・適用済み version 表示。nav:item はコアと同じ register 経路(ドッグフーディング)。

**Files:**
- Modify: `apps/admin/src/lib/admin-api.ts`
- Modify: `apps/admin/src/lib/queries.ts`
- Create: `apps/admin/src/routes/t/$tenantSlug/modules/index.tsx`
- Modify: `apps/admin/src/router.tsx`(nav:item)
- Create: `apps/admin/src/modules-page.test.tsx`
- Regenerate: `apps/admin/src/routeTree.gen.ts`(二段方式)

**Interfaces:**
- Consumes: Task 11 の HTTP 契約
- Produces(admin-api): `interface ModuleSummary { moduleId: string; name: string; version: number; enabled: boolean; appliedVersion: number }` / `listModules(tenantId): Promise<ModuleSummary[]>` / `setModuleEnabled(tenantId, moduleId, enabled): Promise<ModuleSummary>`

- [ ] **Step 1: 失敗テストを書く**

`apps/admin/src/modules-page.test.tsx`(shell.test.tsx の renderAt / authedRoutes 様式に合わせる。以下は骨子 — stubFetch / jsonResponse / renderAt はテストファイル内へ shell.test.tsx から同型で写す):

```tsx
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
// renderAt / jsonResponse / authedRoutes 相当は shell.test.tsx と同じ実装をこのファイルに置く
// (共有ヘルパー化はしない — 既存 2 ファイルの様式に従う)

const bookingModule = {
  moduleId: "booking",
  name: "予約",
  version: 1,
  enabled: false,
  appliedVersion: 0,
};

describe("モジュール設定ページ", () => {
  it("一覧が表示され、トグルで enable が呼ばれて再取得される", async () => {
    const listHandler = vi
      .fn()
      .mockReturnValueOnce(jsonResponse(200, { modules: [bookingModule] }))
      .mockReturnValue(
        jsonResponse(200, { modules: [{ ...bookingModule, enabled: true, appliedVersion: 1 }] }),
      );
    const enableHandler = vi.fn(() =>
      jsonResponse(200, { ok: true, module: { ...bookingModule, enabled: true, appliedVersion: 1 } }),
    );
    renderAt("/t/blog/modules", {
      ...authedRoutes(),
      "/v1/t/t1/modules": listHandler,
      "/v1/t/t1/modules/booking/enable": enableHandler,
    });
    expect(await screen.findByText("予約")).toBeInTheDocument();
    expect(screen.getByText("無効")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "有効化" }));
    await waitFor(() => expect(enableHandler).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("有効")).toBeInTheDocument();
    expect(screen.getByText(/適用済み v1/)).toBeInTheDocument();
  });

  it("ナビに「モジュール」項目が出る", async () => {
    renderAt("/t/blog/modules", {
      ...authedRoutes(),
      "/v1/t/t1/modules": vi.fn(() => jsonResponse(200, { modules: [bookingModule] })),
    });
    expect(await screen.findByRole("link", { name: "モジュール" })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 実装(ルート以外)**

(a) `apps/admin/src/lib/admin-api.ts` に追加(既存の requestJson 様式):

```ts
// apps/api の ModuleSummary と構造一致(HTTP 契約)
export interface ModuleSummary {
  moduleId: string;
  name: string;
  version: number;
  enabled: boolean;
  appliedVersion: number;
}
```

return オブジェクトへ:

```ts
    async listModules(tenantId: string): Promise<ModuleSummary[]> {
      const { modules } = await requestJson<{ modules: ModuleSummary[] }>(tenantId, "/modules");
      return modules;
    },
    async setModuleEnabled(
      tenantId: string,
      moduleId: string,
      enabled: boolean,
    ): Promise<ModuleSummary> {
      const { module } = await requestJson<{ ok: true; module: ModuleSummary }>(
        tenantId,
        `/modules/${moduleId}/${enabled ? "enable" : "disable"}`,
        { method: "POST" },
      );
      return module;
    },
```

(b) `apps/admin/src/lib/queries.ts` に追加:

```ts
export function modulesQueryOptions(adminApi: AdminApi, tenantId: string) {
  return queryOptions({
    queryKey: ["modules", tenantId],
    queryFn: () => adminApi.listModules(tenantId),
    // トグル直後の状態を確実に映す(設定ページは低頻度アクセスなのでキャッシュ不要)
    staleTime: 0,
  });
}
```

(c) `apps/admin/src/routes/t/$tenantSlug/modules/index.tsx`(assets/index.tsx のテーブル様式):

```tsx
import { createFileRoute } from "@tanstack/react-router";
import * as stylex from "@stylexjs/stylex";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@plyrs/ui";
import { colors, spacing, typography } from "@plyrs/ui/tokens.stylex";
import { modulesQueryOptions } from "../../../../lib/queries";

const styles = stylex.create({
  title: { fontSize: typography.sizeXl, marginTop: 0 },
  table: { borderCollapse: "collapse", width: "100%", fontSize: typography.sizeMd },
  cell: {
    textAlign: "left",
    padding: spacing.sm,
    borderBottomWidth: "1px",
    borderBottomStyle: "solid",
    borderBottomColor: colors.border,
    verticalAlign: "middle",
  },
  muted: { color: colors.textMuted },
  error: { color: colors.danger, fontSize: typography.sizeMd },
});

export const Route = createFileRoute("/t/$tenantSlug/modules/")({
  component: ModulesPage,
});

function ModulesPage() {
  const { tenant, adminApi } = Route.useRouteContext();
  const queryClient = useQueryClient();
  const modules = useQuery(modulesQueryOptions(adminApi, tenant.id));
  const toggle = useMutation({
    mutationFn: ({ moduleId, enabled }: { moduleId: string; enabled: boolean }) =>
      adminApi.setModuleEnabled(tenant.id, moduleId, enabled),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["modules", tenant.id] }),
  });

  return (
    <section>
      <h2 {...stylex.props(styles.title)}>モジュール</h2>
      {modules.isError ? <p {...stylex.props(styles.error)}>モジュール一覧を取得できませんでした</p> : null}
      {modules.isPending ? <p {...stylex.props(styles.muted)}>読み込み中…</p> : null}
      {modules.data ? (
        <table {...stylex.props(styles.table)}>
          <caption {...stylex.props(styles.muted)}>
            有効化したモジュールだけがこのテナントで動作します
          </caption>
          <thead>
            <tr>
              <th {...stylex.props(styles.cell)}>名前</th>
              <th {...stylex.props(styles.cell)}>状態</th>
              <th {...stylex.props(styles.cell)}>バージョン</th>
              <th {...stylex.props(styles.cell)}>操作</th>
            </tr>
          </thead>
          <tbody>
            {modules.data.map((module) => (
              <tr key={module.moduleId}>
                <td {...stylex.props(styles.cell)}>
                  {module.name} <span {...stylex.props(styles.muted)}>({module.moduleId})</span>
                </td>
                <td {...stylex.props(styles.cell)}>{module.enabled ? "有効" : "無効"}</td>
                <td {...stylex.props(styles.cell)}>
                  v{module.version}(適用済み v{module.appliedVersion})
                </td>
                <td {...stylex.props(styles.cell)}>
                  <Button
                    isDisabled={toggle.isPending}
                    onPress={() =>
                      toggle.mutate({ moduleId: module.moduleId, enabled: !module.enabled })
                    }
                  >
                    {module.enabled ? "無効化" : "有効化"}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {toggle.isError ? <p {...stylex.props(styles.error)}>操作に失敗しました(権限を確認してください)</p> : null}
    </section>
  );
}
```

(`Route.useRouteContext()` の `tenant` は `/t/$tenantSlug` の beforeLoad が context にマージ済み — §11 の配線契約。`Button` の props 名(isDisabled/onPress)は packages/ui の実物に合わせる)

(d) `apps/admin/src/router.tsx` の `createAppContext` に追加(assets の隣):

```ts
  slots.register("nav:item", {
    id: "core.modules",
    label: "モジュール",
    to: "/t/$tenantSlug/modules",
    order: 2,
  });
```

- [ ] **Step 3: routeTree 再生成(二段方式)**

ルートファイル作成後、**STATUS: NEEDS_CONTEXT で停止**し、コントローラが sandbox 無効で `pnpm --filter @plyrs/admin build` を実行して `routeTree.gen.ts` を再生成する。再開後に差分を確認してから次の Step へ。

- [ ] **Step 4: PASS を確認**

Run: `pnpm --filter @plyrs/admin exec vitest run src/modules-page.test.tsx && pnpm --filter @plyrs/admin test && pnpm typecheck`
Expected: PASS(全 admin テスト緑)

- [ ] **Step 5: コミット**

```bash
pnpm format
git add apps/admin/src/lib/admin-api.ts apps/admin/src/lib/queries.ts 'apps/admin/src/routes/t/$tenantSlug/modules/index.tsx' apps/admin/src/router.tsx apps/admin/src/modules-page.test.tsx apps/admin/src/routeTree.gen.ts
git commit -m "feat: モジュール有効化トグルの管理ページ"
```

---

### Task 15: 一気通貫フローテスト + 全ゲート検証

Phase 9 の全機構を 1 本のワイヤレベルテストで結合検証し、全パッケージのゲートを確認する。

**Files:**
- Test: `apps/api/test/module-flow.test.ts`(新規)

**Interfaces:**
- Consumes: これまでの全タスクの成果物(新規 export なし)

- [ ] **Step 1: 一気通貫テストを書く**

`apps/api/test/module-flow.test.ts`。シナリオ: HTTP enable → 公開 write(Turnstile モック)→ module_events の実 drain 分を手動配達(public-helpers.ts の createMessageBatch + worker.queue 様式で plyrs-modules キューへ)→ notification 生成 → 満席拒否 → alarm 失効 → 公開 write が再び通る。骨子:

```ts
import { fetchMock } from "cloudflare:test";
import { env, createMessageBatch, getQueueResult } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import worker, { app } from "../src/index";
import type { ModuleQueueJob } from "../src/modules/events";

// Task 11 の setupTenant 様式で owner トークンとテナントを作り、tenants.slug を控える。
// Task 12 の mockSiteverify / fakeLimiter / reservationBody をこのファイルにも置く。
// 手動配達ヘルパー(public-helpers.ts の deliverJobs と同型・キュー名だけ plyrs-modules):
async function deliverModuleJobs(jobs: ModuleQueueJob[]): Promise<void> {
  const batch = createMessageBatch(
    "plyrs-modules",
    jobs.map((job, i) => ({ id: `msg-${i}`, timestamp: new Date(), body: job, attempts: 1 })),
  );
  const ctx = createExecutionContext(); // cloudflare:test
  await worker.queue(batch, env, ctx);
  await getQueueResult(batch, ctx);
}

it("enable → 公開予約 → 通知 → 満席 → 失効 → 再予約が一巡する", async () => {
  // 1. HTTP で enable(Task 11 の様式)
  // 2. owner が resource / slot(capacity 1)を HTTP PUT で作成
  // 3. 公開 write(Turnstile モック + fakeLimiter)→ 201。予約 recordId を得る
  // 4. DO の pendingModuleEvents 相当を確認する代わりに、drain 済みイベントを再現:
  //    module_event ジョブを deliverModuleJobs で配達 → booking.notification が 1 件
  //    (実運用では drainModuleEvents が send 済み。テストブローカは自動 consume しないため
  //     公開 write の結果から job を組み立てて配達する — public-helpers の既知の制約と同じ)
  // 5. 公開 write 2 件目 → 409 booking:slot_full
  // 6. runInDurableObject で updated_at と alarm due を過去へ倒し、runDurableObjectAlarm
  //    → state=cancelled
  // 7. 公開 write 3 件目 → 201(枠が解放されている)
});
```

コメントの手順 1〜7 を**すべて実コードにする**(Task 10 / 11 / 12 のテストからの組み立て転用で完結する。ヘルパー import が cloudflare:test に無い名前(createExecutionContext 等)は public-helpers.ts の実装に合わせる)。

- [ ] **Step 2: PASS を確認**

Run: `pnpm --filter @plyrs/api exec vitest run test/module-flow.test.ts`
Expected: PASS

- [ ] **Step 3: 全ゲートを実行**

Run(ワークスペースルート):

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm format:check
```

Expected: 全パッケージ green(653 + 本フェーズ追加分)・型エラー 0・lint 警告 0・format clean。**各コマンドの実出力(テスト数内訳含む)をレポートに貼る。**

- [ ] **Step 4: コミット**

```bash
pnpm format
git add apps/api/test/module-flow.test.ts
git commit -m "test: モジュールシステムの一気通貫フロー"
```

---

## Self-Review(計画作成時に実施済み)

1. **スコープ照合**(ロードマップ §2 Phase 9 行): マニフェスト形式 G6 = Task 4 / 有効化レジストリ + applied version = Task 5, 6 / フック配送の汎用化 beforeWrite = Task 7・afterWrite/afterPublish = Task 9 / alarm 汎用化 = Task 8 / 権限宣言の DO 展開 = Task 6 / Queues 型定義再配布 = Task 13 / 実証(予約 + 論点W)= Task 10, 12 / §5 軽微 no-op = Task 3 / §14 掃除 = Task 1, 2 / UI = Task 14。afterPublish のワイヤレベル消化は emit(publishRecordCore)+ consumer の単体レベル(booking は購読しない)— 申し送りに記録する。
2. **effectiveNow 制約**(§9 申し送り): 物理 setAlarm の呼び出し箇所は (a) armSweep / armModuleEventsSweep / scheduleModuleAlarm 実装(いずれも registerAlarm の戻り値 = レジストリ全体 min)、(b) alarm() 末尾の minDueAt、(c) constructor の保険 — すべて min 経路。モジュールコードは sql しか触れないため構造的に setAlarm 不可。
3. **型整合の確認**: `ModuleSummary` / `EnableModuleResult`(Task 6 定義 → 11/13/14 が使用)、`ModuleQueueJob`(Task 9 定義 → 12/13/15)、`BeforeWriteContext.relations`(Task 7 → 10)、`WriteDeps.newEventId / scheduleModuleAlarm`(Task 7 定義 → 9 で配線 → 10/12 が利用)、`applied`(Task 3 → 6 の applyModuleTypes)。
4. **既知のリスクと逃げ道**: unsafe ratelimit binding の miniflare 互換(Task 12 にコンティンジェンシー明記)/ writeRecord async 化の呼び出し側影響(RPC 越しは全 await 済み — Task 9 Step 5 で全回帰)/ 既存テストの BeforeWriteContext 形状変更(Task 7 Step 4)。
5. **実装者への注意**: 計画中のコードスニペットは既存ファイルの実物(変数名・import)と突き合わせて適用すること。特に publish.ts の emit 挿入位置(Task 9 (b))と push 経路の armed 配列化(Task 9 (c))は現物合わせが必要。挙動の判断に迷ったら SUSPEND してコントローラに確認。

## 完了後(コントローラの後続作業 — 実装タスク外)

1. superpowers:requesting-code-review で最終ブランチレビュー(最上位モデル)。
2. superpowers:finishing-a-development-branch → ローカルマージ(PR 不使用)→ ワークツリー削除。
3. ロードマップ更新コミット: §3 の Phase 9 行(完了日)+ §15「Phase 9 完了時の申し送り」追記(afterPublish の実購読モジュール不在 / 無効モジュール型のガード非適用 / 再配布トリガーは Phase 10 / ratelimit binding の本番構成 / TURNSTILE_SECRET_KEY の secret 登録 / booking.notification の掃除方針など、実装中に確定した事項を反映)。



