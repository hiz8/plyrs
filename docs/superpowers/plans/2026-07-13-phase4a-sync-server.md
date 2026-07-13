# Phase 4a: 同期プロトコル（サーバー側） 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** テナント DO の WebSocket（Hibernation API）同期サーバーを実装する — 認証付き upgrade、ブートストラップ + seq チェックポイント差分（トゥームストーン込み）、content_types 配信、フィールド単位の競合裁定つき push、他接続へのブロードキャスト、トークン失効・BAN による切断。クライアントエンジン（4b）が接続すれば動く状態にする。

**Architecture:** `packages/sync-protocol` にワイヤ形式（メッセージ型 + Zod スキーマ）と競合裁定の純関数を置き、サーバー・クライアント（4b）で共有する。DO 側は `apps/api/src/sync/` に「SQL を受け取る純関数のコア」を置き、`TenantDO` の WS ハンドラ（`fetch` / `webSocketMessage` / `webSocketClose`）は配線に徹する（Phase 2/3 で確立した形の踏襲）。同期の record 表現は relations を統合した `input` 形式にし、Phase 2 申し送りの「snapshot に relations が無い継ぎ目」をここで解消する。

**Tech Stack:** WebSocket Hibernation API（`acceptWebSocket` / `serializeAttachment` / `setWebSocketAutoResponse`）/ Zod v4 / @cloudflare/vitest-pool-workers 0.18（WS テストは `--no-isolate --max-workers=1` 必須）

## Global Constraints

- **WS + DO のテストはストレージ分離と両立しない**（Cloudflare 公式 Known issues）。`apps/api/package.json` の test script を `vitest run --no-isolate --max-workers=1` にする。既存テストは DO 名ランダム化・email/slug ユニーク化済みで共有ストレージ下でも独立して通る（Task 1 の Step 1 で baseline を実測確認する）
- **Hibernation API 必須**（design-spec §3 のコスト制約）: `this.ctx.acceptWebSocket(server, tags)` を使い、`server.accept()` は**呼ばない**（呼ぶとハイバネーションが無効化される）。keepalive は `setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"))`（DO を起こさない）
- **プラットフォーム制限**（実測確認済みの値）: tag は 1 ソケット 10 個・各 256 文字以内。`serializeAttachment` は 16,384 バイト・structured-clone 可能な値のみ。`WebSocketRequestResponsePair` の各文字列は 2,048 文字以内
- **WS 認証は Sec-WebSocket-Protocol でトークンを搬送**（ブラウザは WS に Authorization ヘッダを付けられない — Phase 3 申し送り）: クライアントは `["plyrs-sync", "token.<jwt>"]` を提示。101 応答は `Sec-WebSocket-Protocol: plyrs-sync` を**必ずエコー**する（提示外の値を返すとブラウザが接続を失敗させる）
- **信頼境界は Worker**（design-spec §2）: Worker が JWT を検証し、検証済み claims を内部ヘッダ `x-plyrs-auth` で DO に渡す。DO は Worker binding 経由でしか到達不能なため、このヘッダは偽造されない。DO は `x-plyrs-auth` が無ければ 401
- **トークン失効の扱い**（Phase 3 申し送り）: claims は `serializeAttachment` に載せる（`exp` 込み）。`webSocketMessage` の入口で `exp` を検査し、期限切れなら `close(4001, "token_expired")`。BAN は `disconnectUser(userId)` RPC で tag `user:<userId>` のソケットを `close(4003, "blocked")`
- **クローズコード**: 4001 = token_expired / 4002 = protocol_error / 4003 = blocked（RFC 6455 のアプリ定義域 4000-4999）
- **seq の意味論**（Phase 2 申し送りの精査結果）: ロールバックで欠番になった seq は再利用されうるが、**永続化された seq は `MAX(seq)` に含まれるため再発番されない**。よって「クライアントが持つ checkpoint より大きい seq」で差分を取る方式は安全。**ブロードキャストは必ずコミット後に行う**（未コミットの seq をクライアントに見せない）
- **content_types は seq を消費しない**（Phase 2 申し送り）→ 別チャネル: `welcome` で全量配信し、`registerContentType` 成功時に `content-types` メッセージで全接続へ再配信する
- **同期の record 表現は relations 統合**: `SyncRecord.input` は `writeRecord` の入力と同じ形（data のキー + relation フィールドのキー）。Phase 2 申し送りの「read-modify-write で optional relation が消える継ぎ目」をこの形で解消する
- 新規依存は catalog 経由（このフェーズでは新規ランタイム依存なし。`@plyrs/sync-protocol` は zod + `@plyrs/metamodel` のみに依存）
- `@ts-expect-error` 禁止。RPC 型崩壊は `src/rpc-unwrap.ts` の型付きアンラップのみ。**bare `git stash` / `git stash pop` 禁止**（stash スタックはワークツリー間で共有）
- 各タスクのコミット前に `pnpm format` と ルート `pnpm lint`（警告ゼロ）。コミット後ツリーで `pnpm format:check` exit 0
- TDD 必須（RED を確認してから GREEN）。実装者の typecheck / lint 主張はコントローラが抜き打ち検証する

**既知の注意（実装者向け）:**

1. テストで DO への WS を開くと、返る `Response.webSocket` の**クライアント端は自動 accept されない** — `socket.accept()` を明示的に呼ぶ（ブラウザの WebSocket と違う）。
2. `evictDurableObject(stub, { webSockets: "hibernate" })`（`cloudflare:test`）でハイバネーションを実測できる。復帰後もソケットは生き、次のメッセージで DO が起きる（constructor が再実行される）。
3. `stub.fetch()` に任意ヘッダが通るかは公式 fixture で未検証（調査で UNCONFIRMED）。Task 3 のスモークが最初に確認する — 通らなければ BLOCKED で報告（内部ヘッダ以外の搬送手段はコントローラが判断する）。

## ファイル構成（4a で確定する形）

```
packages/sync-protocol/
  package.json / tsconfig.json / vitest.config.ts
  src/messages.ts        # ワイヤ形式（型 + Zod スキーマ + SYNC_SUBPROTOCOL / CLOSE_CODES）
  src/messages.test.ts
  src/resolve.ts         # 競合裁定の純関数（resolveSyncWrite）
  src/resolve.test.ts
  src/index.ts
apps/api/
  package.json           # test script に --no-isolate --max-workers=1
  src/sync/records.ts    # SQL コア: loadSyncRecord / loadSyncRecordsSince / buildSyncInput
  src/sync/session.ts    # SocketAuth 型 + attachment の読み書き + 期限判定
  src/sync/handlers.ts   # hello / push のハンドラコア（SqlStorage + deps を受ける純関数寄り）
  src/tenant-do.ts       # fetch(upgrade) / webSocketMessage / webSocketClose / disconnectUser / broadcast
  src/middleware/tenant-gate.ts  # 検証コアを authenticateTenantToken として抽出（ミドルウェアは薄い呼び出しに）
  src/routes/tenant.ts   # GET /:tenantId/sync（upgrade 経路）
  test/sync-connect.test.ts   # upgrade / 認証失敗 / subprotocol エコー
  test/sync-bootstrap.test.ts # hello → welcome + sync（checkpoint / tombstone / content_types）
  test/sync-push.test.ts      # push 裁定・適用・ack・broadcast
  test/sync-lifecycle.test.ts # 失効 close / disconnectUser / hibernation 復帰
  test/ws-helpers.ts          # openSync / nextMessage / collect のテストユーティリティ
```

---

### Task 1: sync-protocol パッケージ（ワイヤ形式）+ WS テスト設定

**Files:**
- Modify: `apps/api/package.json`（test script）
- Create: `packages/sync-protocol/package.json` / `tsconfig.json` / `vitest.config.ts`
- Create: `packages/sync-protocol/src/messages.ts` / `src/index.ts`
- Test: `packages/sync-protocol/src/messages.test.ts`

**Interfaces:**
- Consumes: `@plyrs/metamodel`（`WORKFLOW_STATUSES` / `WorkflowStatus` / `ContentTypeDefinition` / `uuidSchema`）、zod
- Produces（`@plyrs/sync-protocol`):
  - `SYNC_SUBPROTOCOL = "plyrs-sync"` / `TOKEN_PROTOCOL_PREFIX = "token."` / `PROTOCOL_VERSION = 1`
  - `CLOSE_CODES = { tokenExpired: 4001, protocolError: 4002, blocked: 4003 }`
  - `interface SyncRecord { id; type; input: Record<string, unknown>; fieldVersions: Record<string, number>; status: WorkflowStatus; seq: number; version: number; deletedAt: string | null; updatedAt: string; updatedBy: string }`
  - `interface ClientChange { changeId: string; recordId: string; typeKey: string; op: "upsert" | "delete"; input: Record<string, unknown>; changedFields: string[]; baseFieldVersions: Record<string, number>; status?: WorkflowStatus }`
  - `type ClientMessage = { type: "hello"; checkpoint: number } | { type: "push"; changes: ClientChange[] }`
  - `type ServerMessage = { type: "welcome"; protocolVersion: number; contentTypes: ContentTypeDefinition[]; serverSeq: number } | { type: "sync"; records: SyncRecord[]; serverSeq: number; complete: boolean } | { type: "ack"; changeId: string; result: AckResult } | { type: "change"; record: SyncRecord } | { type: "content-types"; contentTypes: ContentTypeDefinition[] } | { type: "error"; code: string; message: string }`
  - `type AckResult = { ok: true; record: SyncRecord } | { ok: false; code: string; message: string; conflicts?: FieldConflict[] }`
  - `interface FieldConflict { fieldKey: string; baseVersion: number; currentVersion: number }`
  - `clientMessageSchema`（Zod）/ `parseClientMessage(raw: string): ClientMessage | null`（不正は null、throw しない）

- [ ] **Step 1: WS テスト設定を変え、既存テストが共有ストレージで通ることを確認する**

`apps/api/package.json` の `scripts.test` を置換:

```json
    "test": "vitest run --no-isolate --max-workers=1",
```

（理由: WebSocket + Durable Objects はテストファイル単位のストレージ分離と両立しない — Cloudflare 公式の既知の制限。既存テストは DO 名ランダム化・email/slug ユニーク化により共有ストレージでも独立して通る）

Run: `pnpm --filter @plyrs/api test`
Expected: 既存 78 件が全 PASS（1件でも落ちたら、その原因をコントローラに BLOCKED で報告 — 共有ストレージ下での衝突は設計判断が要る）

- [ ] **Step 2: パッケージ設定3ファイルを書く**

`packages/sync-protocol/package.json`:

```json
{
  "name": "@plyrs/sync-protocol",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@plyrs/metamodel": "workspace:*",
    "zod": "catalog:"
  },
  "devDependencies": {
    "@types/node": "catalog:",
    "typescript": "catalog:",
    "vitest": "catalog:"
  }
}
```

`packages/sync-protocol/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src", "vitest.config.ts"]
}
```

`packages/sync-protocol/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
  },
});
```

- [ ] **Step 3: 失敗するテストを書く**

`packages/sync-protocol/src/messages.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { CLOSE_CODES, parseClientMessage, SYNC_SUBPROTOCOL } from "./messages";

const UUID = "018f2b6a-7a0a-7000-8000-000000000001";

describe("wire constants", () => {
  it("pins the subprotocol and close codes", () => {
    expect(SYNC_SUBPROTOCOL).toBe("plyrs-sync");
    expect(CLOSE_CODES).toEqual({ tokenExpired: 4001, protocolError: 4002, blocked: 4003 });
  });
});

describe("parseClientMessage", () => {
  it("parses a hello message", () => {
    expect(parseClientMessage(JSON.stringify({ type: "hello", checkpoint: 42 }))).toEqual({
      type: "hello",
      checkpoint: 42,
    });
  });

  it("parses a push message with an upsert change", () => {
    const change = {
      changeId: UUID,
      recordId: UUID,
      typeKey: "article",
      op: "upsert",
      input: { title: "hi" },
      changedFields: ["title"],
      baseFieldVersions: { title: 1 },
      status: "draft",
    };
    const parsed = parseClientMessage(JSON.stringify({ type: "push", changes: [change] }));
    expect(parsed).toEqual({ type: "push", changes: [change] });
  });

  it("parses a delete change without input fields", () => {
    const parsed = parseClientMessage(
      JSON.stringify({
        type: "push",
        changes: [
          {
            changeId: UUID,
            recordId: UUID,
            typeKey: "article",
            op: "delete",
            input: {},
            changedFields: [],
            baseFieldVersions: {},
          },
        ],
      }),
    );
    expect(parsed?.type).toBe("push");
  });

  it("returns null (never throws) for malformed input", () => {
    expect(parseClientMessage("{not json")).toBeNull();
    expect(parseClientMessage(JSON.stringify({ type: "nope" }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ type: "hello", checkpoint: -1 }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ type: "hello" }))).toBeNull();
    expect(
      parseClientMessage(
        JSON.stringify({
          type: "push",
          changes: [{ changeId: "not-a-uuid", recordId: UUID, typeKey: "a", op: "upsert", input: {}, changedFields: [], baseFieldVersions: {} }],
        }),
      ),
    ).toBeNull();
    expect(
      parseClientMessage(
        JSON.stringify({
          type: "push",
          changes: [{ changeId: UUID, recordId: UUID, typeKey: "a", op: "purge", input: {}, changedFields: [], baseFieldVersions: {} }],
        }),
      ),
    ).toBeNull();
  });

  it("rejects a push with an oversized change batch", () => {
    const change = {
      changeId: UUID,
      recordId: UUID,
      typeKey: "article",
      op: "upsert" as const,
      input: {},
      changedFields: [],
      baseFieldVersions: {},
    };
    const changes = Array.from({ length: 101 }, () => change);
    expect(parseClientMessage(JSON.stringify({ type: "push", changes }))).toBeNull();
  });
});
```

- [ ] **Step 4: テストが失敗することを確認**

Run: `pnpm install && pnpm --filter @plyrs/sync-protocol test`
Expected: FAIL — `Cannot find module './messages'`

- [ ] **Step 5: messages.ts と index.ts を書く**

`packages/sync-protocol/src/messages.ts`:

```ts
import { uuidSchema, WORKFLOW_STATUSES, type ContentTypeDefinition, type WorkflowStatus } from "@plyrs/metamodel";
import { z } from "zod";

export const PROTOCOL_VERSION = 1;

// ブラウザの WebSocket は Authorization ヘッダを付けられないため、
// トークンは Sec-WebSocket-Protocol で搬送する（["plyrs-sync", "token.<jwt>"]）。
export const SYNC_SUBPROTOCOL = "plyrs-sync";
export const TOKEN_PROTOCOL_PREFIX = "token.";

// RFC 6455 のアプリ定義クローズコード域（4000-4999）
export const CLOSE_CODES = {
  tokenExpired: 4001,
  protocolError: 4002,
  blocked: 4003,
} as const;

export const MAX_CHANGES_PER_PUSH = 100;

// 同期の record 表現: relations を統合した「writeRecord の input 形式」を運ぶ。
// deletedAt !== null はトゥームストーン（input は {}）。
export interface SyncRecord {
  id: string;
  type: string;
  input: Record<string, unknown>;
  fieldVersions: Record<string, number>;
  status: WorkflowStatus;
  seq: number;
  version: number;
  deletedAt: string | null;
  updatedAt: string;
  updatedBy: string;
}

export interface FieldConflict {
  fieldKey: string;
  baseVersion: number;
  currentVersion: number;
}

export type AckResult =
  | { ok: true; record: SyncRecord }
  | { ok: false; code: string; message: string; conflicts?: FieldConflict[] };

export type ServerMessage =
  | {
      type: "welcome";
      protocolVersion: number;
      contentTypes: ContentTypeDefinition[];
      serverSeq: number;
    }
  | { type: "sync"; records: SyncRecord[]; serverSeq: number; complete: boolean }
  | { type: "ack"; changeId: string; result: AckResult }
  | { type: "change"; record: SyncRecord }
  | { type: "content-types"; contentTypes: ContentTypeDefinition[] }
  | { type: "error"; code: string; message: string };

const clientChangeSchema = z.strictObject({
  changeId: uuidSchema,
  recordId: uuidSchema,
  typeKey: z.string().min(1),
  op: z.enum(["upsert", "delete"]),
  input: z.record(z.string(), z.unknown()),
  changedFields: z.array(z.string()),
  baseFieldVersions: z.record(z.string(), z.number().int().nonnegative()),
  status: z.enum(WORKFLOW_STATUSES).optional(),
});

export type ClientChange = z.infer<typeof clientChangeSchema>;

export const clientMessageSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("hello"), checkpoint: z.number().int().nonnegative() }),
  z.strictObject({
    type: z.literal("push"),
    changes: z.array(clientChangeSchema).min(1).max(MAX_CHANGES_PER_PUSH),
  }),
]);

export type ClientMessage = z.infer<typeof clientMessageSchema>;

// 不正な入力で throw しない（WS の入口で例外を投げると接続ごと落ちるため）
export function parseClientMessage(raw: string): ClientMessage | null {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = clientMessageSchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}
```

`packages/sync-protocol/src/index.ts`:

```ts
export {
  CLOSE_CODES,
  clientMessageSchema,
  MAX_CHANGES_PER_PUSH,
  parseClientMessage,
  PROTOCOL_VERSION,
  SYNC_SUBPROTOCOL,
  TOKEN_PROTOCOL_PREFIX,
  type AckResult,
  type ClientChange,
  type ClientMessage,
  type FieldConflict,
  type ServerMessage,
  type SyncRecord,
} from "./messages";
```

- [ ] **Step 6: テストが通ることを確認**

Run: `pnpm --filter @plyrs/sync-protocol test` → PASS（7件）
Run: `pnpm --filter @plyrs/sync-protocol typecheck` → エラーなし

- [ ] **Step 7: フォーマット・lint・コミット**

```bash
pnpm format && pnpm lint
git add pnpm-lock.yaml apps/api/package.json packages/sync-protocol
git commit -m "feat: add sync-protocol wire format and enable WS-compatible test isolation"
```

---

### Task 2: 競合裁定の純関数（resolveSyncWrite）

**Files:**
- Create: `packages/sync-protocol/src/resolve.ts`
- Modify: `packages/sync-protocol/src/index.ts`（再エクスポート）
- Test: `packages/sync-protocol/src/resolve.test.ts`

**Interfaces:**
- Consumes: `ClientChange` / `SyncRecord` / `FieldConflict`（Task 1）、`FieldDefinition` / `ContentTypeDefinition`（metamodel）
- Produces:
  - `type SyncResolution = { kind: "apply"; input: Record<string, unknown> } | { kind: "conflict"; conflicts: FieldConflict[] }`
  - `resolveSyncWrite(contentType: ContentTypeDefinition, change: ClientChange, current: SyncRecord | null): SyncResolution`

裁定規則（design-spec §10.3）:

- 新規（`current === null`）→ そのまま適用
- `change.changedFields` の各フィールドについて `base = change.baseFieldVersions[key] ?? 0`、`current.fieldVersions[key] ?? 0` を比較
  - 一致 → 競合なし（クライアントは最新を見て編集した）
  - 不一致（サーバーが先に進んでいる） → **richtext なら競合**（手動解決、design-spec §10.3-10.4）／**それ以外は LWW で incoming 採用**
- 競合が1つでもあれば全体を `conflict` で返す（部分適用しない — ack が単純になる）
- 適用時の input は**マージ結果**: サーバーの現在 input をベースに `changedFields` のキーだけ incoming の値で上書きする（別フィールドの変更は両立 = design-spec §10.3）。`changedFields` に載っているが incoming の input に無いキーは「削除（値の消去）」として扱い、マージ結果からも落とす

- [ ] **Step 1: 失敗するテストを書く**

`packages/sync-protocol/src/resolve.test.ts`:

```ts
import type { ContentTypeDefinition } from "@plyrs/metamodel";
import { describe, expect, it } from "vitest";
import type { ClientChange, SyncRecord } from "./messages";
import { resolveSyncWrite } from "./resolve";

const UUID = (n: number) => `018f2b6a-7a0a-7000-8000-00000000000${n}`;

const articleType: ContentTypeDefinition = {
  id: UUID(1),
  key: "article",
  name: "記事",
  source: "user",
  version: 1,
  fields: [
    { key: "title", type: "text", required: true },
    { key: "subtitle", type: "text" },
    { key: "body", type: "richtext" },
    { key: "authors", type: "relation", config: { allowedTypes: ["author"], cardinality: "many" } },
  ],
};

function current(overrides: Partial<SyncRecord> = {}): SyncRecord {
  return {
    id: UUID(2),
    type: "article",
    input: { title: "server title", subtitle: "server subtitle", body: { schemaVersion: 1, doc: {} } },
    fieldVersions: { title: 2, subtitle: 1, body: 1 },
    status: "draft",
    seq: 5,
    version: 3,
    deletedAt: null,
    updatedAt: "2026-07-13T00:00:00Z",
    updatedBy: "server-user",
    ...overrides,
  };
}

function change(overrides: Partial<ClientChange> = {}): ClientChange {
  return {
    changeId: UUID(3),
    recordId: UUID(2),
    typeKey: "article",
    op: "upsert",
    input: { title: "client title" },
    changedFields: ["title"],
    baseFieldVersions: { title: 2 },
    ...overrides,
  };
}

describe("resolveSyncWrite", () => {
  it("applies a create (no current record) verbatim", () => {
    const result = resolveSyncWrite(articleType, change({ input: { title: "new" } }), null);
    expect(result).toEqual({ kind: "apply", input: { title: "new" } });
  });

  it("applies a non-conflicting edit and merges untouched server fields", () => {
    const result = resolveSyncWrite(articleType, change(), current());
    expect(result).toEqual({
      kind: "apply",
      input: {
        title: "client title",
        subtitle: "server subtitle",
        body: { schemaVersion: 1, doc: {} },
      },
    });
  });

  it("merges concurrent edits to different fields (design-spec §10.3)", () => {
    const result = resolveSyncWrite(
      articleType,
      change({
        input: { subtitle: "client subtitle" },
        changedFields: ["subtitle"],
        baseFieldVersions: { subtitle: 1 },
      }),
      current({ fieldVersions: { title: 9, subtitle: 1, body: 1 } }),
    );
    expect(result).toEqual({
      kind: "apply",
      input: {
        title: "server title",
        subtitle: "client subtitle",
        body: { schemaVersion: 1, doc: {} },
      },
    });
  });

  it("resolves a stale scalar edit as last-write-wins", () => {
    const result = resolveSyncWrite(
      articleType,
      change({ baseFieldVersions: { title: 1 } }),
      current({ fieldVersions: { title: 7, subtitle: 1, body: 1 } }),
    );
    expect(result.kind).toBe("apply");
    if (result.kind === "apply") {
      expect(result.input["title"]).toBe("client title");
    }
  });

  it("reports a stale richtext edit as a conflict for manual resolution", () => {
    const result = resolveSyncWrite(
      articleType,
      change({
        input: { body: { schemaVersion: 1, doc: { edited: true } } },
        changedFields: ["body"],
        baseFieldVersions: { body: 1 },
      }),
      current({ fieldVersions: { title: 2, subtitle: 1, body: 4 } }),
    );
    expect(result).toEqual({
      kind: "conflict",
      conflicts: [{ fieldKey: "body", baseVersion: 1, currentVersion: 4 }],
    });
  });

  it("applies a richtext edit when the base version is current", () => {
    const result = resolveSyncWrite(
      articleType,
      change({
        input: { body: { schemaVersion: 1, doc: { edited: true } } },
        changedFields: ["body"],
        baseFieldVersions: { body: 1 },
      }),
      current(),
    );
    expect(result.kind).toBe("apply");
  });

  it("treats a changed field absent from input as a clear", () => {
    const result = resolveSyncWrite(
      articleType,
      change({ input: {}, changedFields: ["subtitle"], baseFieldVersions: { subtitle: 1 } }),
      current(),
    );
    expect(result.kind).toBe("apply");
    if (result.kind === "apply") {
      expect("subtitle" in result.input).toBe(false);
      expect(result.input["title"]).toBe("server title");
    }
  });

  it("reports every conflicting richtext field at once", () => {
    const twoBodies: ContentTypeDefinition = {
      ...articleType,
      fields: [
        { key: "body", type: "richtext" },
        { key: "notes", type: "richtext" },
      ],
    };
    const result = resolveSyncWrite(
      twoBodies,
      change({
        input: { body: {}, notes: {} },
        changedFields: ["body", "notes"],
        baseFieldVersions: { body: 1, notes: 1 },
      }),
      current({ fieldVersions: { body: 2, notes: 3 } }),
    );
    expect(result).toEqual({
      kind: "conflict",
      conflicts: [
        { fieldKey: "body", baseVersion: 1, currentVersion: 2 },
        { fieldKey: "notes", baseVersion: 1, currentVersion: 3 },
      ],
    });
  });

  it("ignores unknown changed fields (tolerant of stale client type definitions)", () => {
    const result = resolveSyncWrite(
      articleType,
      change({
        input: { legacy: "x" },
        changedFields: ["legacy"],
        baseFieldVersions: { legacy: 1 },
      }),
      current({ fieldVersions: { legacy: 5 } }),
    );
    expect(result.kind).toBe("apply");
    if (result.kind === "apply") {
      expect(result.input["legacy"]).toBe("x");
    }
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm --filter @plyrs/sync-protocol test`
Expected: FAIL — `Cannot find module './resolve'`

- [ ] **Step 3: 実装を書く**

`packages/sync-protocol/src/resolve.ts`:

```ts
import type { ContentTypeDefinition } from "@plyrs/metamodel";
import type { ClientChange, FieldConflict, SyncRecord } from "./messages";

export type SyncResolution =
  | { kind: "apply"; input: Record<string, unknown> }
  | { kind: "conflict"; conflicts: FieldConflict[] };

// design-spec §10.3: single-writer の DO がフィールド単位で裁定する。
// 別フィールドの変更は両立（マージ）、同一スカラーは LWW（後勝ち）、
// 同一リッチテキスト（AST）は検知して手動解決（§10.4）。
export function resolveSyncWrite(
  contentType: ContentTypeDefinition,
  change: ClientChange,
  current: SyncRecord | null,
): SyncResolution {
  if (current === null) {
    return { kind: "apply", input: change.input };
  }

  const fieldTypes = new Map(contentType.fields.map((field) => [field.key, field.type]));
  const conflicts: FieldConflict[] = [];

  for (const fieldKey of change.changedFields) {
    const baseVersion = change.baseFieldVersions[fieldKey] ?? 0;
    const currentVersion = current.fieldVersions[fieldKey] ?? 0;
    if (baseVersion === currentVersion) {
      continue;
    }
    // 未知フィールド（クライアントの型定義が古い等）は LWW 側に倒す — 寛容 read と同じ思想
    if (fieldTypes.get(fieldKey) === "richtext") {
      conflicts.push({ fieldKey, baseVersion, currentVersion });
    }
  }

  if (conflicts.length > 0) {
    return { kind: "conflict", conflicts };
  }

  // マージ: サーバーの現在値をベースに、クライアントが変更したキーだけ上書きする。
  // changedFields にあるが input に無いキーは「値の消去」として落とす。
  const merged: Record<string, unknown> = { ...current.input };
  for (const fieldKey of change.changedFields) {
    if (fieldKey in change.input) {
      merged[fieldKey] = change.input[fieldKey];
    } else {
      delete merged[fieldKey];
    }
  }
  return { kind: "apply", input: merged };
}
```

`packages/sync-protocol/src/index.ts` に追記（既存 export ブロックは維持）:

```ts
export { resolveSyncWrite, type SyncResolution } from "./resolve";
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm --filter @plyrs/sync-protocol test` → PASS（16件）
Run: `pnpm --filter @plyrs/sync-protocol typecheck` → エラーなし

- [ ] **Step 5: フォーマット・lint・コミット**

```bash
pnpm format && pnpm lint
git add packages/sync-protocol/src/resolve.ts packages/sync-protocol/src/resolve.test.ts packages/sync-protocol/src/index.ts
git commit -m "feat: add field-level sync conflict resolution"
```

---

### Task 3: WS upgrade 経路（認証 + acceptWebSocket）

**Files:**
- Modify: `apps/api/package.json`（`@plyrs/sync-protocol` 依存）
- Modify: `apps/api/src/middleware/tenant-gate.ts`（検証コアを関数として抽出）
- Create: `apps/api/src/sync/session.ts`
- Modify: `apps/api/src/tenant-do.ts`（`fetch` override + `webSocketClose` + auto-response）
- Modify: `apps/api/src/routes/tenant.ts`（`GET /:tenantId/sync`）
- Create: `apps/api/test/ws-helpers.ts`
- Test: `apps/api/test/sync-connect.test.ts`

**Interfaces:**
- Consumes: `verifyTenantToken` / `isBlocked`（Phase 3）、`SYNC_SUBPROTOCOL` / `TOKEN_PROTOCOL_PREFIX`（Task 1）
- Produces:
  - `apps/api/src/middleware/tenant-gate.ts`: `type GateFailure = { code: "unauthenticated" | "wrong_tenant" | "blocked"; status: 401 | 403 }`、`authenticateTenantToken(env: Env, tenantId: string, token: string): Promise<{ ok: true; auth: SocketAuth } | { ok: false; failure: GateFailure }>`（既存 `tenantGate` ミドルウェアはこの関数を呼ぶ薄い殻に書き換える。`GateVariables` は不変）
  - `apps/api/src/sync/session.ts`: `interface SocketAuth { userId: string; role: Role; tenantId: string; exp: number }`、`AUTH_HEADER = "x-plyrs-auth"`、`readSocketAuth(ws: WebSocket): SocketAuth | null`、`isTokenExpired(auth: SocketAuth, nowMs: number): boolean`、`extractTokenProtocol(header: string | undefined): string | null`
  - TenantDO: `override fetch(request)` が WS upgrade を受理（tag `user:<userId>`、attachment に SocketAuth）、`webSocketClose` 実装、constructor で `setWebSocketAutoResponse`
  - `apps/api/test/ws-helpers.ts`: `openSyncSocket(stub, auth): Promise<WebSocket>`、`nextMessage(ws): Promise<ServerMessage>`、`nextMessages(ws, n): Promise<ServerMessage[]>`、`closeInfo(ws): Promise<{ code: number; reason: string }>`

`verifyTenantToken` は `TenantClaims`（userId/tenantId/role）を返すが `exp` を返さない。**このタスクで `jwt.ts` を拡張する**: `verifyTenantToken` の戻り値に `exp: number` を追加する（`payload.exp` は jose が検証済み。型は `number | undefined` なので `typeof exp !== "number"` なら null を返す）。`TenantClaims` に `exp: number` を追加し、既存の呼び出し側（`tenantGate`）とテスト（`test/jwt-blocklist.test.ts` の `toEqual(CLAIMS)`）を追随させる — 該当テストは `expect(result).toMatchObject(CLAIMS)` + `expect(result?.exp).toBeGreaterThan(0)` に書き換える。

- [ ] **Step 1: テストユーティリティを書く**

`apps/api/test/ws-helpers.ts`:

```ts
import type { ServerMessage } from "@plyrs/sync-protocol";
import { SYNC_SUBPROTOCOL } from "@plyrs/sync-protocol";

// vitest-pool-workers: stub.fetch が返す Response.webSocket のクライアント端は
// 自動 accept されない（ブラウザの WebSocket と違う）。明示的に accept する。
export async function openSyncSocket(
  stub: { fetch: (input: RequestInfo, init?: RequestInit) => Promise<Response> },
  bearer: string,
): Promise<{ socket: WebSocket; response: Response }> {
  const response = await stub.fetch("https://do/sync", {
    headers: {
      upgrade: "websocket",
      "sec-websocket-protocol": `${SYNC_SUBPROTOCOL}, token.${bearer}`,
    },
  });
  const socket = response.webSocket;
  if (socket === null) {
    return { socket: undefined as unknown as WebSocket, response };
  }
  socket.accept();
  return { socket, response };
}

export function nextMessage(socket: WebSocket, timeoutMs = 5000): Promise<ServerMessage> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timed out waiting for a message")), timeoutMs);
    socket.addEventListener(
      "message",
      (event: MessageEvent) => {
        clearTimeout(timer);
        const data = typeof event.data === "string" ? event.data : "";
        resolve(JSON.parse(data) as ServerMessage);
      },
      { once: true },
    );
  });
}

export async function nextMessages(socket: WebSocket, count: number): Promise<ServerMessage[]> {
  const messages: ServerMessage[] = [];
  for (let i = 0; i < count; i += 1) {
    messages.push(await nextMessage(socket));
  }
  return messages;
}

export function closeInfo(
  socket: WebSocket,
  timeoutMs = 5000,
): Promise<{ code: number; reason: string }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timed out waiting for close")), timeoutMs);
    socket.addEventListener(
      "close",
      (event: CloseEvent) => {
        clearTimeout(timer);
        resolve({ code: event.code, reason: event.reason });
      },
      { once: true },
    );
  });
}
```

- [ ] **Step 2: 失敗するテストを書く**

`apps/api/test/sync-connect.test.ts`:

```ts
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { SYNC_SUBPROTOCOL } from "@plyrs/sync-protocol";
import app from "../src/index";
import { signTenantToken } from "../src/auth/jwt";
import { blockUser } from "../src/auth/blocklist";
import { openSyncSocket } from "./ws-helpers";

const TENANT = "018f2b6a-7a0a-7000-8000-0000000000a1";
const OTHER_TENANT = "018f2b6a-7a0a-7000-8000-0000000000a2";

async function tokenFor(userId: string, tenantId = TENANT, role = "editor" as const) {
  return signTenantToken(env.JWT_SECRET, { userId, tenantId, role });
}

function stub(tenantId: string) {
  return env.TENANT_DO.get(env.TENANT_DO.idFromName(tenantId));
}

describe("sync WebSocket upgrade", () => {
  it("accepts an authenticated upgrade and echoes the subprotocol", async () => {
    const token = await tokenFor("018f2b6a-7a0a-7000-8000-0000000000b1");
    const res = await app.request(
      `/v1/t/${TENANT}/sync`,
      {
        headers: {
          upgrade: "websocket",
          "sec-websocket-protocol": `${SYNC_SUBPROTOCOL}, token.${token}`,
        },
      },
      env,
    );
    expect(res.status).toBe(101);
    expect(res.headers.get("sec-websocket-protocol")).toBe(SYNC_SUBPROTOCOL);
    expect(res.webSocket).not.toBeNull();
    res.webSocket?.accept();
    res.webSocket?.close(1000, "done");
  });

  it("rejects a non-upgrade request to the sync path", async () => {
    const token = await tokenFor("018f2b6a-7a0a-7000-8000-0000000000b2");
    const res = await app.request(
      `/v1/t/${TENANT}/sync`,
      { headers: { "sec-websocket-protocol": `${SYNC_SUBPROTOCOL}, token.${token}` } },
      env,
    );
    expect(res.status).toBe(426);
  });

  it("rejects an upgrade with no token, a bogus token, or a wrong-tenant token", async () => {
    const noToken = await app.request(
      `/v1/t/${TENANT}/sync`,
      { headers: { upgrade: "websocket", "sec-websocket-protocol": SYNC_SUBPROTOCOL } },
      env,
    );
    expect(noToken.status).toBe(401);

    const bogus = await app.request(
      `/v1/t/${TENANT}/sync`,
      {
        headers: {
          upgrade: "websocket",
          "sec-websocket-protocol": `${SYNC_SUBPROTOCOL}, token.not-a-jwt`,
        },
      },
      env,
    );
    expect(bogus.status).toBe(401);

    const otherTenant = await tokenFor("018f2b6a-7a0a-7000-8000-0000000000b3", OTHER_TENANT);
    const wrongTenant = await app.request(
      `/v1/t/${TENANT}/sync`,
      {
        headers: {
          upgrade: "websocket",
          "sec-websocket-protocol": `${SYNC_SUBPROTOCOL}, token.${otherTenant}`,
        },
      },
      env,
    );
    expect(wrongTenant.status).toBe(403);
  });

  it("rejects an upgrade from a blocked user", async () => {
    const userId = "018f2b6a-7a0a-7000-8000-0000000000b4";
    await blockUser(env.BLOCKLIST, userId);
    const token = await tokenFor(userId);
    const res = await app.request(
      `/v1/t/${TENANT}/sync`,
      {
        headers: {
          upgrade: "websocket",
          "sec-websocket-protocol": `${SYNC_SUBPROTOCOL}, token.${token}`,
        },
      },
      env,
    );
    expect(res.status).toBe(403);
  });

  it("rejects a direct DO upgrade with no verified auth header (worker is the trust boundary)", async () => {
    const res = await stub(TENANT).fetch("https://do/sync", {
      headers: { upgrade: "websocket" },
    });
    expect(res.status).toBe(401);
  });

  it("tags the socket by user so it can be addressed later", async () => {
    const userId = "018f2b6a-7a0a-7000-8000-0000000000b5";
    const token = await tokenFor(userId);
    const target = stub(`${TENANT}-tagged`);
    const opened = await openSyncSocket(target, token);
    expect(opened.response.status).toBe(101);
    expect(await target.countSockets(`user:${userId}`)).toBe(1);
    opened.socket.close(1000, "done");
  });
});
```

（`openSyncSocket` は DO stub に直接 upgrade するため、DO が `x-plyrs-auth` を要求する形だと 401 になる。**したがって `openSyncSocket` は `x-plyrs-auth` ヘッダを自前で組み立てる** — 下の Step 3 で ws-helpers を修正する）

- [ ] **Step 3: ws-helpers を DO 直結用に直す**

`apps/api/test/ws-helpers.ts` の `openSyncSocket` を次に置換（Worker 経由の経路は `app.request` で別途テストするため、ヘルパーは DO 直結・検証済みヘッダ注入とする）:

```ts
import type { SocketAuth } from "../src/sync/session";
import { AUTH_HEADER } from "../src/sync/session";
import { SYNC_SUBPROTOCOL } from "@plyrs/sync-protocol";

export async function openSyncSocket(
  stub: { fetch: (input: RequestInfo, init?: RequestInit) => Promise<Response> },
  auth: SocketAuth,
): Promise<{ socket: WebSocket; response: Response }> {
  const response = await stub.fetch("https://do/sync", {
    headers: {
      upgrade: "websocket",
      "sec-websocket-protocol": SYNC_SUBPROTOCOL,
      [AUTH_HEADER]: JSON.stringify(auth),
    },
  });
  const socket = response.webSocket;
  if (socket === null) {
    throw new Error(`upgrade failed: ${response.status}`);
  }
  socket.accept();
  return { socket, response };
}
```

`test/sync-connect.test.ts` の最後の2ケースを、この形に合わせて次に置換:

```ts
  it("rejects a direct DO upgrade with no verified auth header (worker is the trust boundary)", async () => {
    const res = await stub(TENANT).fetch("https://do/sync", {
      headers: { upgrade: "websocket" },
    });
    expect(res.status).toBe(401);
  });

  it("tags the socket by user so it can be addressed later", async () => {
    const userId = "018f2b6a-7a0a-7000-8000-0000000000b5";
    const target = stub(`${TENANT}-tagged`);
    const { socket } = await openSyncSocket(target, {
      userId,
      role: "editor",
      tenantId: TENANT,
      exp: Math.floor(Date.now() / 1000) + 900,
    });
    expect(await target.countSockets(`user:${userId}`)).toBe(1);
    socket.close(1000, "done");
  });
```

- [ ] **Step 4: テストが失敗することを確認**

Run: `pnpm --filter @plyrs/api test`
Expected: FAIL — `/v1/t/:tenantId/sync` が 404、`src/sync/session` の解決エラー

- [ ] **Step 5: session.ts と jwt の exp 露出を書く**

`apps/api/src/sync/session.ts`:

```ts
import type { Role } from "../auth/permissions";
import { TOKEN_PROTOCOL_PREFIX } from "@plyrs/sync-protocol";

// Worker（信頼境界）が検証した claims を DO に渡す内部ヘッダ。
// DO は Worker binding 経由でしか到達できないため、この値は偽造されない。
export const AUTH_HEADER = "x-plyrs-auth";

export interface SocketAuth {
  userId: string;
  role: Role;
  tenantId: string;
  exp: number; // JWT の exp（秒）。ハイバネーション越しに attachment で持ち回る
}

export function extractTokenProtocol(header: string | undefined): string | null {
  if (header === undefined) {
    return null;
  }
  for (const raw of header.split(",")) {
    const value = raw.trim();
    if (value.startsWith(TOKEN_PROTOCOL_PREFIX)) {
      const token = value.slice(TOKEN_PROTOCOL_PREFIX.length);
      return token.length > 0 ? token : null;
    }
  }
  return null;
}

export function readSocketAuth(ws: WebSocket): SocketAuth | null {
  const attachment = ws.deserializeAttachment();
  return attachment === null ? null : (attachment as SocketAuth);
}

export function isTokenExpired(auth: SocketAuth, nowMs: number): boolean {
  return auth.exp * 1000 <= nowMs;
}
```

`apps/api/src/auth/jwt.ts` — `TenantClaims` に `exp` を足し、`verifyTenantToken` で取り出す:

```ts
export interface TenantClaims {
  userId: string;
  tenantId: string;
  role: Role;
  exp: number;
}
```

`verifyTenantToken` の検証部を次に置換（`signTenantToken` は不変。引数は `Omit<TenantClaims, "exp">`）:

```ts
export async function signTenantToken(
  secret: string,
  claims: Omit<TenantClaims, "exp">,
): Promise<string> {
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
    const { payload } = await jwtVerify(token, secretKey(secret), {
      clockTolerance: 5,
      algorithms: ["HS256"],
    });
    const sub = payload.sub;
    const tid = payload["tid"];
    const role = payload["role"];
    const exp = payload.exp;
    if (
      typeof sub !== "string" ||
      typeof tid !== "string" ||
      !isRole(role) ||
      typeof exp !== "number"
    ) {
      return null;
    }
    return { userId: sub, tenantId: tid, role, exp };
  } catch {
    return null;
  }
}
```

`apps/api/test/jwt-blocklist.test.ts` の「round-trips claims」ケースを追随（他ケースは不変）:

```ts
  it("round-trips claims", async () => {
    const token = await signTenantToken(env.JWT_SECRET, CLAIMS);
    expect(TOKEN_TTL).toBe(900);
    const verified = await verifyTenantToken(env.JWT_SECRET, token);
    expect(verified).toMatchObject(CLAIMS);
    expect(verified?.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });
```

- [ ] **Step 6: ゲートの検証コアを抽出する**

`apps/api/src/middleware/tenant-gate.ts` を全置換:

```ts
import { createMiddleware } from "hono/factory";
import { isBlocked } from "../auth/blocklist";
import { verifyTenantToken } from "../auth/jwt";
import type { AuthContext } from "../do/authorize";
import type { SocketAuth } from "../sync/session";

export type GateVariables = { auth: AuthContext & { tenantId: string } };

export interface GateFailure {
  code: "unauthenticated" | "wrong_tenant" | "blocked";
  status: 401 | 403;
}

// design-spec §11.5 第1段: JWT 署名検証 + tenant 照合 + ブロックリスト照会のみ
// （D1 を引かない）。通らなければ DO を起こさない。HTTP ミドルウェアと WS upgrade の
// 両方がこのコアを使う（トークンの搬送手段だけが違う）。
export async function authenticateTenantToken(
  env: Env,
  tenantId: string,
  token: string,
): Promise<{ ok: true; auth: SocketAuth } | { ok: false; failure: GateFailure }> {
  const claims = await verifyTenantToken(env.JWT_SECRET, token);
  if (claims === null) {
    return { ok: false, failure: { code: "unauthenticated", status: 401 } };
  }
  if (claims.tenantId !== tenantId) {
    return { ok: false, failure: { code: "wrong_tenant", status: 403 } };
  }
  if (await isBlocked(env.BLOCKLIST, claims.userId)) {
    return { ok: false, failure: { code: "blocked", status: 403 } };
  }
  return {
    ok: true,
    auth: {
      userId: claims.userId,
      role: claims.role,
      tenantId: claims.tenantId,
      exp: claims.exp,
    },
  };
}

export const tenantGate = createMiddleware<{ Bindings: Env; Variables: GateVariables }>(
  async (c, next) => {
    const header = c.req.header("authorization") ?? "";
    if (!header.startsWith("Bearer ")) {
      return c.json({ error: "unauthenticated" }, 401);
    }
    const result = await authenticateTenantToken(
      c.env,
      c.req.param("tenantId"),
      header.slice("Bearer ".length),
    );
    if (!result.ok) {
      return c.json({ error: result.failure.code }, result.failure.status);
    }
    c.set("auth", {
      userId: result.auth.userId,
      role: result.auth.role,
      tenantId: result.auth.tenantId,
    });
    await next();
  },
);
```

- [ ] **Step 7: DO に WS upgrade を実装する**

`apps/api/src/tenant-do.ts` — import 追記:

```ts
import { CLOSE_CODES, SYNC_SUBPROTOCOL } from "@plyrs/sync-protocol";
import { AUTH_HEADER, readSocketAuth, type SocketAuth } from "./sync/session";
```

constructor の `blockConcurrencyWhile` ブロックの**後**に1行追加:

```ts
    // ping/pong を DO を起こさずに返す（design-spec §3 のハイバネーション前提）
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
```

クラスにメソッドを追加（既存 RPC 群の後）:

```ts
  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return new Response("expected websocket upgrade", { status: 426 });
    }
    const rawAuth = request.headers.get(AUTH_HEADER);
    if (rawAuth === null) {
      return new Response("unauthenticated", { status: 401 });
    }
    let auth: SocketAuth;
    try {
      auth = JSON.parse(rawAuth) as SocketAuth;
    } catch {
      return new Response("bad auth header", { status: 400 });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    // Hibernation API: server.accept() は呼ばない（呼ぶとハイバネーションが無効化される）
    this.ctx.acceptWebSocket(server, [`user:${auth.userId}`]);
    server.serializeAttachment(auth);

    return new Response(null, {
      status: 101,
      webSocket: client,
      // 提示された値のいずれかを必ずエコーする（さもないとブラウザが接続を失敗させる）
      headers: { "sec-websocket-protocol": SYNC_SUBPROTOCOL },
    });
  }

  override async webSocketClose(ws: WebSocket): Promise<void> {
    // compat date 2026-07-12 では close ハンドシェイクは runtime が完了済み。ここは掃除のみ。
    await Promise.resolve();
    ws.close();
  }

  // テスト用（tag によるソケット計数）。Phase 10 の運用画面でも使える。
  countSockets(tag: string): number {
    return this.ctx.getWebSockets(tag).length;
  }

  // Phase 3 申し送り: 確立済みソケットは BAN 後も生き続けるため、明示的に切る経路を持つ。
  disconnectUser(userId: string): number {
    const sockets = this.ctx.getWebSockets(`user:${userId}`);
    for (const socket of sockets) {
      socket.close(CLOSE_CODES.blocked, "blocked");
    }
    return sockets.length;
  }
```

- [ ] **Step 8: Worker 側 upgrade ルートを書く**

`apps/api/src/routes/tenant.ts` — import 追記:

```ts
import { authenticateTenantToken } from "../middleware/tenant-gate";
import { AUTH_HEADER, extractTokenProtocol } from "../sync/session";
```

`tenantRoutes` の `.use("/:tenantId/*", tenantGate)` の**前**に sync ルートを置く（このルートは Bearer ヘッダを持たないため、ミドルウェアの適用外にする必要がある）:

```ts
export const tenantRoutes = new Hono<GateEnv>()
  // WS upgrade は Authorization ヘッダを持てないため tenantGate の外に置き、
  // 同じ検証コア（authenticateTenantToken）を subprotocol のトークンで呼ぶ。
  .get("/:tenantId/sync", async (c) => {
    if (c.req.header("upgrade")?.toLowerCase() !== "websocket") {
      return c.json({ error: "expected_websocket" }, 426);
    }
    const token = extractTokenProtocol(c.req.header("sec-websocket-protocol"));
    if (token === null) {
      return c.json({ error: "unauthenticated" }, 401);
    }
    const result = await authenticateTenantToken(c.env, c.req.param("tenantId"), token);
    if (!result.ok) {
      return c.json({ error: result.failure.code }, result.failure.status);
    }
    const forwarded = new Request(c.req.raw, { headers: new Headers(c.req.raw.headers) });
    forwarded.headers.set(AUTH_HEADER, JSON.stringify(result.auth));
    return stubFor(c).fetch(forwarded);
  })
  .use("/:tenantId/*", tenantGate)
  // …既存の5ルートはそのまま続く
```

`apps/api/package.json` の `dependencies` に追記:

```json
    "@plyrs/sync-protocol": "workspace:*",
```

- [ ] **Step 9: テストが通ることを確認**

Run: `pnpm install && pnpm --filter @plyrs/api test` → 全 PASS（既存 78 + 新規 6 = 84件目安）
Run: `pnpm --filter @plyrs/api typecheck` → エラーなし

`stub.fetch()` に `x-plyrs-auth` / `sec-websocket-protocol` が通らずテストが落ちる場合は、**BLOCKED で報告**（既知の注意3）。

- [ ] **Step 10: フォーマット・lint・コミット**

```bash
pnpm format && pnpm lint
git add pnpm-lock.yaml apps/api/package.json apps/api/src apps/api/test
git commit -m "feat: accept authenticated sync WebSocket upgrades on the tenant DO"
```

---

### Task 4: ブートストラップ（hello → welcome + sync）

**Files:**
- Create: `apps/api/src/sync/records.ts`
- Create: `apps/api/src/sync/handlers.ts`
- Modify: `apps/api/src/tenant-do.ts`（`webSocketMessage`）
- Test: `apps/api/test/sync-bootstrap.test.ts`

**Interfaces:**
- Consumes: `SyncRecord` / `ServerMessage` / `parseClientMessage` / `PROTOCOL_VERSION` / `CLOSE_CODES`（Task 1）、`loadContentTypeByKey` / `rowToDefinition`（Phase 2）、`loadRecord` / `loadRelationRefs`（Phase 2 の `src/do/write-record.ts`）
- Produces:
  - `src/sync/records.ts`: `SYNC_PAGE_SIZE = 100`、`buildSyncInput(data: Record<string, unknown>, relations: Map<string, RelationRef[]>, contentType: ContentTypeDefinition | null): Record<string, unknown>`、`loadSyncRecord(sql: SqlStorage, id: string): SyncRecord | null`、`loadSyncRecordsSince(sql: SqlStorage, checkpoint: number, limit: number): SyncRecord[]`、`loadAllContentTypes(sql: SqlStorage): ContentTypeDefinition[]`、`currentServerSeq(sql: SqlStorage): number`
  - `src/sync/handlers.ts`: `handleHello(sql: SqlStorage, checkpoint: number): ServerMessage[]`（welcome + sync ページ列を返す）
  - TenantDO: `override webSocketMessage(ws, message)` が hello を処理し、`ping` は auto-response が処理するため到達しない

`buildSyncInput` の規則: relation フィールドは `cardinality === "one"` なら単一 ref（無ければキーごと省略）、`"many"` なら配列（空なら空配列）。型定義が無い（未知型）場合は relations をキー単位の配列として載せる。

- [ ] **Step 1: 失敗するテストを書く**

`apps/api/test/sync-bootstrap.test.ts`:

```ts
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { ServerMessage, SyncRecord } from "@plyrs/sync-protocol";
import { articleType, auth, uuid, validArticleInput } from "./fixtures";
import { asWriteResult } from "./rpc-unwrap";
import { nextMessage, nextMessages, openSyncSocket } from "./ws-helpers";

const TENANT = "018f2b6a-7a0a-7000-8000-0000000000c1";

function freshStub() {
  return env.TENANT_DO.get(env.TENANT_DO.idFromName(crypto.randomUUID()));
}

function socketAuth(userId = "editor-1") {
  return {
    userId,
    role: "editor" as const,
    tenantId: TENANT,
    exp: Math.floor(Date.now() / 1000) + 900,
  };
}

function recordsOf(message: ServerMessage): SyncRecord[] {
  return message.type === "sync" ? message.records : [];
}

describe("sync bootstrap", () => {
  let stub: ReturnType<typeof freshStub>;

  beforeEach(async () => {
    stub = freshStub();
    await stub.registerContentType(articleType(), auth("admin"));
  });

  it("sends welcome with content types, then the full record set", async () => {
    const write = asWriteResult(
      await stub.writeRecord(
        "article",
        { recordId: uuid(80), input: validArticleInput() },
        auth("editor-1"),
      ),
    );
    expect(write.ok).toBe(true);

    const { socket } = await openSyncSocket(stub, socketAuth());
    socket.send(JSON.stringify({ type: "hello", checkpoint: 0 }));
    const [welcome, sync] = await nextMessages(socket, 2);

    expect(welcome).toMatchObject({ type: "welcome", protocolVersion: 1 });
    if (welcome.type === "welcome") {
      expect(welcome.contentTypes.map((type) => type.key)).toEqual(["article"]);
      expect(welcome.serverSeq).toBeGreaterThan(0);
    }

    expect(sync).toMatchObject({ type: "sync", complete: true });
    const records = recordsOf(sync);
    expect(records).toHaveLength(1);
    expect(records[0]?.id).toBe(uuid(80));
    // relations が input に統合されている（Phase 2 申し送りの継ぎ目の解消）
    expect(records[0]?.input["authors"]).toEqual(validArticleInput()["authors"]);
    expect(records[0]?.input["hero"]).toEqual(validArticleInput()["hero"]);
    expect(records[0]?.input["title"]).toBe("こんにちは");
    expect(records[0]?.fieldVersions["title"]).toBe(1);
    socket.close(1000, "done");
  });

  it("returns only records past the checkpoint", async () => {
    await stub.writeRecord(
      "article",
      { recordId: uuid(81), input: validArticleInput() },
      auth("editor-1"),
    );
    const second = asWriteResult(
      await stub.writeRecord(
        "article",
        { recordId: uuid(82), input: { ...validArticleInput(), slug: "second" } },
        auth("editor-1"),
      ),
    );
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    const checkpoint = second.record.seq - 1;

    const { socket } = await openSyncSocket(stub, socketAuth());
    socket.send(JSON.stringify({ type: "hello", checkpoint }));
    const [, sync] = await nextMessages(socket, 2);
    const records = recordsOf(sync);
    expect(records.map((record) => record.id)).toEqual([uuid(82)]);
    socket.close(1000, "done");
  });

  it("delivers tombstones for records deleted after the checkpoint", async () => {
    await stub.writeRecord(
      "article",
      { recordId: uuid(83), input: validArticleInput() },
      auth("editor-1"),
    );
    const deleted = await stub.deleteRecord(uuid(83), auth("editor-1"));
    expect(deleted.ok).toBe(true);

    const { socket } = await openSyncSocket(stub, socketAuth());
    socket.send(JSON.stringify({ type: "hello", checkpoint: 0 }));
    const [, sync] = await nextMessages(socket, 2);
    const records = recordsOf(sync);
    expect(records).toHaveLength(1);
    expect(records[0]?.id).toBe(uuid(83));
    expect(records[0]?.deletedAt).not.toBeNull();
    expect(records[0]?.input).toEqual({});
    socket.close(1000, "done");
  });

  it("closes the socket on a malformed message", async () => {
    const { socket } = await openSyncSocket(stub, socketAuth());
    const closed = new Promise<{ code: number }>((resolve) => {
      socket.addEventListener("close", (event: CloseEvent) => resolve({ code: event.code }), {
        once: true,
      });
    });
    socket.send("{not json");
    expect((await closed).code).toBe(4002);
  });

  it("answers a second hello with a fresh snapshot (idempotent)", async () => {
    const { socket } = await openSyncSocket(stub, socketAuth());
    socket.send(JSON.stringify({ type: "hello", checkpoint: 0 }));
    await nextMessages(socket, 2);
    socket.send(JSON.stringify({ type: "hello", checkpoint: 0 }));
    const welcome = await nextMessage(socket);
    expect(welcome.type).toBe("welcome");
    socket.close(1000, "done");
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm --filter @plyrs/api test`
Expected: FAIL — hello を送っても応答が来ない（`webSocketMessage` 未実装でタイムアウト）

- [ ] **Step 3: records.ts を書く**

`apps/api/src/sync/records.ts`:

```ts
import type { ContentTypeDefinition, RelationRef, WorkflowStatus } from "@plyrs/metamodel";
import type { SyncRecord } from "@plyrs/sync-protocol";
import { loadContentTypeByKey, rowToDefinition } from "../do/content-types";
import { loadRelationRefs } from "../do/write-record";

export const SYNC_PAGE_SIZE = 100;

interface RawSyncRow extends Record<string, SqlStorageValue> {
  id: string;
  type: string;
  data: string;
  field_versions: string;
  status: string;
  seq: number;
  deleted_at: string | null;
  updated_at: string;
  updated_by: string;
  version: number;
}

interface RawContentTypeRow extends Record<string, SqlStorageValue> {
  id: string;
  key: string;
  name: string;
  fields: string;
  source: string;
  plugin_id: string | null;
  version: number;
}

// 同期の record 表現は relations を統合した「writeRecord の input 形式」。
// これにより getRecord → 編集 → writeRecord の read-modify-write で
// optional relation が無言でクリアされる継ぎ目（Phase 2 申し送り）が消える。
export function buildSyncInput(
  data: Record<string, unknown>,
  relations: Map<string, RelationRef[]>,
  contentType: ContentTypeDefinition | null,
): Record<string, unknown> {
  const input: Record<string, unknown> = { ...data };
  const cardinality = new Map<string, "one" | "many">();
  for (const field of contentType?.fields ?? []) {
    if (field.type === "relation") {
      cardinality.set(field.key, field.config.cardinality);
    }
  }
  for (const [fieldKey, refs] of relations) {
    if (cardinality.get(fieldKey) === "one") {
      const first = refs[0];
      if (first !== undefined) {
        input[fieldKey] = first;
      }
      continue;
    }
    input[fieldKey] = refs;
  }
  return input;
}

function rowToSyncRecord(sql: SqlStorage, row: RawSyncRow): SyncRecord {
  const deletedAt = row.deleted_at;
  const base = {
    id: row.id,
    type: row.type,
    fieldVersions: JSON.parse(row.field_versions) as Record<string, number>,
    status: row.status as WorkflowStatus,
    seq: row.seq,
    version: row.version,
    deletedAt,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  };
  if (deletedAt !== null) {
    // トゥームストーンは中身を運ばない（relations も削除済み）
    return { ...base, input: {} };
  }
  const contentTypeRow = loadContentTypeByKey(sql, row.type);
  const definition = contentTypeRow === null ? null : rowToDefinition(contentTypeRow);
  const relations = loadRelationRefs(sql, row.id);
  const data = JSON.parse(row.data) as Record<string, unknown>;
  return { ...base, input: buildSyncInput(data, relations, definition) };
}

export function loadSyncRecord(sql: SqlStorage, id: string): SyncRecord | null {
  const row = sql.exec<RawSyncRow>("SELECT * FROM records WHERE id = ?", id).toArray()[0];
  return row === undefined ? null : rowToSyncRecord(sql, row);
}

export function loadSyncRecordsSince(
  sql: SqlStorage,
  checkpoint: number,
  limit: number,
): SyncRecord[] {
  const rows = sql
    .exec<RawSyncRow>(
      "SELECT * FROM records WHERE seq > ? ORDER BY seq ASC LIMIT ?",
      checkpoint,
      limit,
    )
    .toArray();
  return rows.map((row) => rowToSyncRecord(sql, row));
}

export function loadAllContentTypes(sql: SqlStorage): ContentTypeDefinition[] {
  const rows = sql
    .exec<RawContentTypeRow>("SELECT * FROM content_types ORDER BY key ASC")
    .toArray();
  return rows.map((row) =>
    rowToDefinition({
      id: row.id,
      key: row.key,
      name: row.name,
      fields: JSON.parse(row.fields),
      source: row.source as "user" | "plugin" | "system",
      pluginId: row.plugin_id,
      createdAt: "",
      updatedAt: "",
      version: row.version,
    }),
  );
}

export function currentServerSeq(sql: SqlStorage): number {
  const row = sql
    .exec<{ max_seq: number | null }>("SELECT MAX(seq) AS max_seq FROM records")
    .one();
  return row.max_seq ?? 0;
}
```

- [ ] **Step 4: handlers.ts を書く**

`apps/api/src/sync/handlers.ts`:

```ts
import { PROTOCOL_VERSION, type ServerMessage } from "@plyrs/sync-protocol";
import {
  currentServerSeq,
  loadAllContentTypes,
  loadSyncRecordsSince,
  SYNC_PAGE_SIZE,
} from "./records";

// G1: content_types は seq を消費しない別チャネル。welcome で全量を配る。
// G2: records は seq チェックポイントの差分（トゥームストーン込み）をページで配る。
export function handleHello(sql: SqlStorage, checkpoint: number): ServerMessage[] {
  const serverSeq = currentServerSeq(sql);
  const messages: ServerMessage[] = [
    {
      type: "welcome",
      protocolVersion: PROTOCOL_VERSION,
      contentTypes: loadAllContentTypes(sql),
      serverSeq,
    },
  ];

  let cursor = checkpoint;
  for (;;) {
    const records = loadSyncRecordsSince(sql, cursor, SYNC_PAGE_SIZE);
    const complete = records.length < SYNC_PAGE_SIZE;
    messages.push({ type: "sync", records, serverSeq, complete });
    if (complete) {
      return messages;
    }
    const last = records[records.length - 1];
    if (last === undefined) {
      return messages;
    }
    cursor = last.seq;
  }
}
```

- [ ] **Step 5: TenantDO に webSocketMessage を実装する**

`apps/api/src/tenant-do.ts` — import 追記:

```ts
import { CLOSE_CODES, parseClientMessage, type ServerMessage } from "@plyrs/sync-protocol";
import { handleHello } from "./sync/handlers";
import { isTokenExpired, readSocketAuth } from "./sync/session";
```

クラスにメソッドを追加:

```ts
  private send(ws: WebSocket, message: ServerMessage): void {
    ws.send(JSON.stringify(message));
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    await Promise.resolve();
    const auth = readSocketAuth(ws);
    if (auth === null) {
      ws.close(CLOSE_CODES.protocolError, "no_session");
      return;
    }
    // Phase 3 申し送り: 15分 JWT はソケット確立後に切れる。メッセージ処理の入口で検査する。
    if (isTokenExpired(auth, Date.now())) {
      ws.close(CLOSE_CODES.tokenExpired, "token_expired");
      return;
    }
    if (typeof message !== "string") {
      ws.close(CLOSE_CODES.protocolError, "binary_unsupported");
      return;
    }
    const parsed = parseClientMessage(message);
    if (parsed === null) {
      ws.close(CLOSE_CODES.protocolError, "malformed_message");
      return;
    }
    if (parsed.type === "hello") {
      for (const outgoing of handleHello(this.ctx.storage.sql, parsed.checkpoint)) {
        this.send(ws, outgoing);
      }
    }
  }
```

（`push` の処理は次のタスク。現時点で `push` を受けても何も返さないが、Task 5 で実装する）

- [ ] **Step 6: テストが通ることを確認**

Run: `pnpm --filter @plyrs/api test` → 全 PASS（89件目安）
Run: `pnpm --filter @plyrs/api typecheck` → エラーなし

- [ ] **Step 7: フォーマット・lint・コミット**

```bash
pnpm format && pnpm lint
git add apps/api/src/sync apps/api/src/tenant-do.ts apps/api/test/sync-bootstrap.test.ts
git commit -m "feat: serve sync bootstrap with checkpoint diffs and content types"
```

---

### Task 5: push（裁定・適用・ack・ブロードキャスト）

**Files:**
- Modify: `apps/api/src/sync/handlers.ts`（`handlePush`）
- Modify: `apps/api/src/tenant-do.ts`（push の配線 + broadcast）
- Test: `apps/api/test/sync-push.test.ts`

**Interfaces:**
- Consumes: `resolveSyncWrite`（Task 2）、`loadSyncRecord`（Task 4）、`writeRecordCore` / `deleteRecordCore` / `loadContentTypeByKey` / `rowToDefinition`（Phase 2）、`requireOperation` / `AuthContext`（Phase 3）
- Produces:
  - `src/sync/handlers.ts`: `interface PushDeps { sql: SqlStorage; nextSeq: () => number; now: () => string; newRelationId: () => string }`、`interface PushOutcome { acks: ServerMessage[]; broadcasts: ServerMessage[] }`、`handlePush(deps: PushDeps, changes: ClientChange[], auth: AuthContext): PushOutcome`
  - TenantDO: `webSocketMessage` の push 分岐 + `private broadcast(exclude: WebSocket, message: ServerMessage): void`

`handlePush` の各 change の処理:

1. 認可（第2段）: `op === "delete"` なら `record:delete`、それ以外は `record:write`。拒否なら ack `{ ok:false, code:"forbidden" }`
2. 型解決: `loadContentTypeByKey`。無ければ ack `{ ok:false, code:"unknown_type" }`
3. delete: `deleteRecordCore` を呼ぶ。成功なら再読込した SyncRecord で ack + broadcast
4. upsert: `loadSyncRecord` → `resolveSyncWrite` → `conflict` なら ack `{ ok:false, code:"conflict", conflicts }`（書き込まない）。`apply` なら `writeRecordCore` に merged input を渡す
5. `writeRecordCore` が `ok:false` を返したらそのまま ack に載せる（validation_failed / unique_violation 等）
6. 成功時は `loadSyncRecord` で読み直した SyncRecord を ack と broadcast に載せる（relations 統合済みの姿を返す）

**変異は DO 側で `transactionSync` に包む**（TenantDO の push 分岐でラップする）。ブロードキャストは**トランザクションの外**（コミット後）で行う — Global Constraints の「未コミットの seq を見せない」。

- [ ] **Step 1: 失敗するテストを書く**

`apps/api/test/sync-push.test.ts`:

```ts
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { ClientChange, ServerMessage } from "@plyrs/sync-protocol";
import { articleType, auth, uuid, validArticleInput } from "./fixtures";
import { asRecordSnapshot } from "./rpc-unwrap";
import { nextMessage, nextMessages, openSyncSocket } from "./ws-helpers";

const TENANT = "018f2b6a-7a0a-7000-8000-0000000000d1";

function freshStub() {
  return env.TENANT_DO.get(env.TENANT_DO.idFromName(crypto.randomUUID()));
}

function socketAuth(userId: string, role: "owner" | "editor" | "viewer" = "editor") {
  return { userId, role, tenantId: TENANT, exp: Math.floor(Date.now() / 1000) + 900 };
}

function change(overrides: Partial<ClientChange> = {}): ClientChange {
  return {
    changeId: crypto.randomUUID(),
    recordId: uuid(90),
    typeKey: "article",
    op: "upsert",
    input: validArticleInput(),
    changedFields: Object.keys(validArticleInput()),
    baseFieldVersions: {},
    ...overrides,
  };
}

async function hello(socket: WebSocket): Promise<void> {
  socket.send(JSON.stringify({ type: "hello", checkpoint: 0 }));
  await nextMessages(socket, 2);
}

function ackOf(message: ServerMessage) {
  return message.type === "ack" ? message.result : null;
}

describe("sync push", () => {
  let stub: ReturnType<typeof freshStub>;

  beforeEach(async () => {
    stub = freshStub();
    await stub.registerContentType(articleType(), auth("admin"));
  });

  it("applies a create and acks with the stored record", async () => {
    const { socket } = await openSyncSocket(stub, socketAuth("editor-1"));
    await hello(socket);

    const pushed = change();
    socket.send(JSON.stringify({ type: "push", changes: [pushed] }));
    const ack = await nextMessage(socket);

    expect(ack).toMatchObject({ type: "ack", changeId: pushed.changeId });
    const result = ackOf(ack);
    expect(result?.ok).toBe(true);
    if (result?.ok) {
      expect(result.record.id).toBe(uuid(90));
      expect(result.record.seq).toBeGreaterThan(0);
      expect(result.record.input["authors"]).toEqual(validArticleInput()["authors"]);
      expect(result.record.updatedBy).toBe("editor-1");
    }
    expect(asRecordSnapshot(await stub.getRecord(uuid(90)))).not.toBeNull();
    socket.close(1000, "done");
  });

  it("merges a concurrent edit to a different field", async () => {
    const { socket } = await openSyncSocket(stub, socketAuth("editor-1"));
    await hello(socket);
    socket.send(JSON.stringify({ type: "push", changes: [change()] }));
    await nextMessage(socket);

    // サーバー側で title を先に進める（別クライアント相当）
    await stub.writeRecord(
      "article",
      { recordId: uuid(90), input: { ...validArticleInput(), title: "server wins" } },
      auth("editor-2"),
    );

    const stale = change({
      input: { ...validArticleInput(), slug: "client-slug" },
      changedFields: ["slug"],
      baseFieldVersions: { slug: 1 },
    });
    socket.send(JSON.stringify({ type: "push", changes: [stale] }));
    const ack = await nextMessage(socket);
    const result = ackOf(ack);
    expect(result?.ok).toBe(true);
    if (result?.ok) {
      expect(result.record.input["slug"]).toBe("client-slug");
      expect(result.record.input["title"]).toBe("server wins");
    }
    socket.close(1000, "done");
  });

  it("rejects a stale richtext edit as a conflict without writing", async () => {
    const { socket } = await openSyncSocket(stub, socketAuth("editor-1"));
    await hello(socket);
    socket.send(JSON.stringify({ type: "push", changes: [change()] }));
    await nextMessage(socket);

    await stub.writeRecord(
      "article",
      {
        recordId: uuid(90),
        input: { ...validArticleInput(), body: { schemaVersion: 1, doc: { server: true } } },
      },
      auth("editor-2"),
    );

    const stale = change({
      input: { ...validArticleInput(), body: { schemaVersion: 1, doc: { client: true } } },
      changedFields: ["body"],
      baseFieldVersions: { body: 1 },
    });
    socket.send(JSON.stringify({ type: "push", changes: [stale] }));
    const result = ackOf(await nextMessage(socket));
    expect(result?.ok).toBe(false);
    if (result?.ok === false) {
      expect(result.code).toBe("conflict");
      expect(result.conflicts?.[0]?.fieldKey).toBe("body");
    }
    const stored = asRecordSnapshot(await stub.getRecord(uuid(90)));
    expect(stored?.data["body"]).toEqual({ schemaVersion: 1, doc: { server: true } });
    socket.close(1000, "done");
  });

  it("acks a delete and broadcasts the tombstone", async () => {
    const writer = await openSyncSocket(stub, socketAuth("editor-1"));
    const watcher = await openSyncSocket(stub, socketAuth("editor-2"));
    await hello(writer.socket);
    await hello(watcher.socket);

    writer.socket.send(JSON.stringify({ type: "push", changes: [change()] }));
    await nextMessage(writer.socket);
    await nextMessage(watcher.socket); // change broadcast

    const removal = change({ op: "delete", input: {}, changedFields: [], baseFieldVersions: {} });
    writer.socket.send(JSON.stringify({ type: "push", changes: [removal] }));
    const ack = await nextMessage(writer.socket);
    const broadcast = await nextMessage(watcher.socket);

    const result = ackOf(ack);
    expect(result?.ok).toBe(true);
    if (result?.ok) {
      expect(result.record.deletedAt).not.toBeNull();
    }
    expect(broadcast.type).toBe("change");
    if (broadcast.type === "change") {
      expect(broadcast.record.deletedAt).not.toBeNull();
    }
    writer.socket.close(1000, "done");
    watcher.socket.close(1000, "done");
  });

  it("broadcasts an applied change to other sockets but not the sender", async () => {
    const writer = await openSyncSocket(stub, socketAuth("editor-1"));
    const watcher = await openSyncSocket(stub, socketAuth("editor-2"));
    await hello(writer.socket);
    await hello(watcher.socket);

    const pushed = change();
    writer.socket.send(JSON.stringify({ type: "push", changes: [pushed] }));
    const [ack] = await nextMessages(writer.socket, 1);
    const broadcast = await nextMessage(watcher.socket);

    expect(ack.type).toBe("ack");
    expect(broadcast.type).toBe("change");
    if (broadcast.type === "change") {
      expect(broadcast.record.id).toBe(uuid(90));
    }
    writer.socket.close(1000, "done");
    watcher.socket.close(1000, "done");
  });

  it("denies a viewer's push with forbidden and writes nothing", async () => {
    const { socket } = await openSyncSocket(stub, socketAuth("mallory", "viewer"));
    await hello(socket);
    socket.send(JSON.stringify({ type: "push", changes: [change({ recordId: uuid(91) })] }));
    const result = ackOf(await nextMessage(socket));
    expect(result?.ok).toBe(false);
    if (result?.ok === false) {
      expect(result.code).toBe("forbidden");
    }
    expect(asRecordSnapshot(await stub.getRecord(uuid(91)))).toBeNull();
    socket.close(1000, "done");
  });

  it("acks each change in a batch independently", async () => {
    const { socket } = await openSyncSocket(stub, socketAuth("editor-1"));
    await hello(socket);
    const good = change({ recordId: uuid(92) });
    const bad = change({ recordId: uuid(93), typeKey: "no_such_type" });
    socket.send(JSON.stringify({ type: "push", changes: [good, bad] }));
    const [first, second] = await nextMessages(socket, 2);

    expect(ackOf(first)?.ok).toBe(true);
    const secondResult = ackOf(second);
    expect(secondResult?.ok).toBe(false);
    if (secondResult?.ok === false) {
      expect(secondResult.code).toBe("unknown_type");
    }
    socket.close(1000, "done");
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm --filter @plyrs/api test`
Expected: FAIL — push を送っても ack が来ない（タイムアウト）

- [ ] **Step 3: handlePush を書く**

`apps/api/src/sync/handlers.ts` — import を追記:

```ts
import { resolveSyncWrite, type ClientChange, type ServerMessage } from "@plyrs/sync-protocol";
import { requireOperation, type AuthContext } from "../do/authorize";
import { loadContentTypeByKey, rowToDefinition } from "../do/content-types";
import { deleteRecordCore } from "../do/delete-record";
import { writeRecordCore } from "../do/write-record";
import { currentServerSeq, loadAllContentTypes, loadSyncRecord, loadSyncRecordsSince, SYNC_PAGE_SIZE } from "./records";
```

ファイル末尾に追記:

```ts
export interface PushDeps {
  sql: SqlStorage;
  nextSeq: () => number;
  now: () => string;
  newRelationId: () => string;
}

export interface PushOutcome {
  acks: ServerMessage[];
  broadcasts: ServerMessage[];
}

// 第2段認可は RPC 入口と同じく「先頭」で判定する（Phase 2 申し送りの内容確認オラクル対策）。
export function handlePush(
  deps: PushDeps,
  changes: ClientChange[],
  auth: AuthContext,
): PushOutcome {
  const acks: ServerMessage[] = [];
  const broadcasts: ServerMessage[] = [];

  for (const change of changes) {
    const operation = change.op === "delete" ? "record:delete" : "record:write";
    const denial = requireOperation(auth, operation);
    if (denial !== null) {
      acks.push({
        type: "ack",
        changeId: change.changeId,
        result: { ok: false, code: denial.code, message: denial.message },
      });
      continue;
    }

    const contentTypeRow = loadContentTypeByKey(deps.sql, change.typeKey);
    if (contentTypeRow === null) {
      acks.push({
        type: "ack",
        changeId: change.changeId,
        result: {
          ok: false,
          code: "unknown_type",
          message: `unknown content type: ${change.typeKey}`,
        },
      });
      continue;
    }

    if (change.op === "delete") {
      const deleted = deleteRecordCore(
        { sql: deps.sql, nextSeq: deps.nextSeq, now: deps.now },
        change.recordId,
        auth.userId,
      );
      if (!deleted.ok) {
        acks.push({
          type: "ack",
          changeId: change.changeId,
          result: { ok: false, code: deleted.code, message: deleted.message },
        });
        continue;
      }
      const tombstone = loadSyncRecord(deps.sql, change.recordId);
      if (tombstone !== null) {
        acks.push({ type: "ack", changeId: change.changeId, result: { ok: true, record: tombstone } });
        broadcasts.push({ type: "change", record: tombstone });
      }
      continue;
    }

    const current = loadSyncRecord(deps.sql, change.recordId);
    const resolution = resolveSyncWrite(rowToDefinition(contentTypeRow), change, current);
    if (resolution.kind === "conflict") {
      acks.push({
        type: "ack",
        changeId: change.changeId,
        result: {
          ok: false,
          code: "conflict",
          message: "manual resolution required for rich text fields",
          conflicts: resolution.conflicts,
        },
      });
      continue;
    }

    const written = writeRecordCore(deps, contentTypeRow, {
      recordId: change.recordId,
      input: resolution.input,
      actor: auth.userId,
      ...(change.status === undefined ? {} : { status: change.status }),
    });
    if (!written.ok) {
      acks.push({
        type: "ack",
        changeId: change.changeId,
        result: { ok: false, code: written.code, message: written.message },
      });
      continue;
    }

    const stored = loadSyncRecord(deps.sql, change.recordId);
    if (stored !== null) {
      acks.push({ type: "ack", changeId: change.changeId, result: { ok: true, record: stored } });
      if (written.applied) {
        broadcasts.push({ type: "change", record: stored });
      }
    }
  }

  return { acks, broadcasts };
}
```

- [ ] **Step 4: TenantDO に push を配線する**

`apps/api/src/tenant-do.ts` — import に `handlePush` を足し、クラスに broadcast を追加:

```ts
  private broadcast(exclude: WebSocket, message: ServerMessage): void {
    const payload = JSON.stringify(message);
    for (const socket of this.ctx.getWebSockets()) {
      if (socket === exclude) {
        continue;
      }
      // クローズ進行中のソケットに送ると例外になりうるため防御的に読み飛ばす
      if (socket.readyState !== WebSocket.READY_STATE_OPEN) {
        continue;
      }
      socket.send(payload);
    }
  }
```

`webSocketMessage` の hello 分岐の後に push 分岐を追加:

```ts
    if (parsed.type === "push") {
      // 変異はトランザクション内。ブロードキャストはコミット後（未コミットの seq を見せない）。
      const outcome = this.ctx.storage.transactionSync(() =>
        handlePush(
          {
            sql: this.ctx.storage.sql,
            nextSeq: () => ++this.seq,
            now: () => new Date().toISOString(),
            newRelationId: () => uuidv7(),
          },
          parsed.changes,
          { userId: auth.userId, role: auth.role },
        ),
      );
      for (const ack of outcome.acks) {
        this.send(ws, ack);
      }
      for (const message of outcome.broadcasts) {
        this.broadcast(ws, message);
      }
    }
```

- [ ] **Step 5: テストが通ることを確認**

Run: `pnpm --filter @plyrs/api test` → 全 PASS（96件目安）
Run: `pnpm --filter @plyrs/api typecheck` → エラーなし

- [ ] **Step 6: フォーマット・lint・コミット**

```bash
pnpm format && pnpm lint
git add apps/api/src/sync/handlers.ts apps/api/src/tenant-do.ts apps/api/test/sync-push.test.ts
git commit -m "feat: resolve, apply and broadcast client pushes over the sync socket"
```

---

### Task 6: ライフサイクル（失効・BAN 切断・型再配信・ハイバネーション）

**Files:**
- Modify: `apps/api/src/tenant-do.ts`（`registerContentType` 後の型再配信）
- Test: `apps/api/test/sync-lifecycle.test.ts`

**Interfaces:**
- Consumes: `CLOSE_CODES`（Task 1）、`loadAllContentTypes`（Task 4）、`disconnectUser` / `countSockets`（Task 3）
- Produces: TenantDO の `registerContentType` が成功時に全接続へ `content-types` メッセージをブロードキャストする（`broadcastAll` を private に追加）

- [ ] **Step 1: 失敗するテストを書く**

`apps/api/test/sync-lifecycle.test.ts`:

```ts
import { evictDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { articleType, auth, uuid, validArticleInput } from "./fixtures";
import { closeInfo, nextMessage, nextMessages, openSyncSocket } from "./ws-helpers";

const TENANT = "018f2b6a-7a0a-7000-8000-0000000000e1";

function freshStub() {
  return env.TENANT_DO.get(env.TENANT_DO.idFromName(crypto.randomUUID()));
}

function socketAuth(userId: string, expSeconds: number) {
  return { userId, role: "editor" as const, tenantId: TENANT, exp: expSeconds };
}

function future() {
  return Math.floor(Date.now() / 1000) + 900;
}

describe("sync lifecycle", () => {
  let stub: ReturnType<typeof freshStub>;

  beforeEach(async () => {
    stub = freshStub();
    await stub.registerContentType(articleType(), auth("admin"));
  });

  it("closes a socket whose token expired after connecting (Phase 3 handoff)", async () => {
    const expired = Math.floor(Date.now() / 1000) - 60;
    const { socket } = await openSyncSocket(stub, socketAuth("editor-1", expired));
    const closed = closeInfo(socket);
    socket.send(JSON.stringify({ type: "hello", checkpoint: 0 }));
    expect((await closed).code).toBe(4001);
  });

  it("disconnects an established socket when the user is banned", async () => {
    const userId = "018f2b6a-7a0a-7000-8000-0000000000e2";
    const { socket } = await openSyncSocket(stub, socketAuth(userId, future()));
    socket.send(JSON.stringify({ type: "hello", checkpoint: 0 }));
    await nextMessages(socket, 2);

    const closed = closeInfo(socket);
    expect(await stub.disconnectUser(userId)).toBe(1);
    const info = await closed;
    expect(info.code).toBe(4003);
    expect(info.reason).toBe("blocked");
    expect(await stub.countSockets(`user:${userId}`)).toBe(0);
  });

  it("re-delivers content types to open sockets when a type is registered", async () => {
    const { socket } = await openSyncSocket(stub, socketAuth("editor-1", future()));
    socket.send(JSON.stringify({ type: "hello", checkpoint: 0 }));
    await nextMessages(socket, 2);

    const noteType = {
      ...articleType(),
      id: uuid(70),
      key: "note",
      fields: [{ key: "title", type: "text" as const, required: true }],
    };
    const registered = await stub.registerContentType(noteType, auth("admin"));
    expect(registered.ok).toBe(true);

    const message = await nextMessage(socket);
    expect(message.type).toBe("content-types");
    if (message.type === "content-types") {
      expect(message.contentTypes.map((type) => type.key).sort()).toEqual(["article", "note"]);
    }
    socket.close(1000, "done");
  });

  it("survives hibernation: the socket stays usable and auth is restored from the attachment", async () => {
    const { socket } = await openSyncSocket(stub, socketAuth("editor-1", future()));
    socket.send(JSON.stringify({ type: "hello", checkpoint: 0 }));
    await nextMessages(socket, 2);

    await evictDurableObject(stub, { webSockets: "hibernate" });

    socket.send(
      JSON.stringify({
        type: "push",
        changes: [
          {
            changeId: crypto.randomUUID(),
            recordId: uuid(95),
            typeKey: "article",
            op: "upsert",
            input: validArticleInput(),
            changedFields: Object.keys(validArticleInput()),
            baseFieldVersions: {},
          },
        ],
      }),
    );
    const ack = await nextMessage(socket);
    expect(ack.type).toBe("ack");
    if (ack.type === "ack" && ack.result.ok) {
      expect(ack.result.record.updatedBy).toBe("editor-1");
      // seq はハイバネーション復帰後も単調に続く（constructor が MAX(seq) から復元）
      expect(ack.result.record.seq).toBeGreaterThan(0);
    }
    socket.close(1000, "done");
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm --filter @plyrs/api test`
Expected: FAIL — 「型登録時の再配信」ケースがタイムアウト（他3ケースは Task 3/4 の実装で通る想定）

- [ ] **Step 3: 型再配信を実装する**

`apps/api/src/tenant-do.ts` — `broadcastAll` を private に追加:

```ts
  private broadcastAll(message: ServerMessage): void {
    const payload = JSON.stringify(message);
    for (const socket of this.ctx.getWebSockets()) {
      if (socket.readyState !== WebSocket.READY_STATE_OPEN) {
        continue;
      }
      socket.send(payload);
    }
  }
```

`registerContentType` を次に置換（第2段認可の位置は不変）:

```ts
  registerContentType(input: unknown, auth: AuthContext): RegisterContentTypeResult {
    const denial = requireOperation(auth, "type:manage");
    if (denial !== null) {
      return denial;
    }
    const now = new Date().toISOString();
    const result = this.ctx.storage.transactionSync(() =>
      registerContentTypeCore(this.ctx.storage.sql, input, now),
    );
    if (result.ok) {
      // G1: content_types は seq を消費しない別チャネル。変更をコミット後に全接続へ配る。
      this.broadcastAll({
        type: "content-types",
        contentTypes: loadAllContentTypes(this.ctx.storage.sql),
      });
    }
    return result;
  }
```

import に `loadAllContentTypes` を追加（`./sync/records` から）。

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm --filter @plyrs/api test` → 全 PASS（100件目安）
Run: `pnpm --filter @plyrs/api typecheck` → エラーなし

- [ ] **Step 5: フォーマット・lint・コミット**

```bash
pnpm format && pnpm lint
git add apps/api/src/tenant-do.ts apps/api/test/sync-lifecycle.test.ts
git commit -m "feat: handle token expiry, bans and type redelivery on live sockets"
```

---

### Task 7: 全体整合の最終確認

**Files:**
- Modify: なし（確認のみ。差分が出た場合のみ修正をコミット）

- [ ] **Step 1: ルート全チェック**

Run: `pnpm lint && pnpm format:check && pnpm typecheck && pnpm test`
Expected: すべて exit 0・警告ゼロ。metamodel 46 / db 4 / sync-protocol 16 / api 100目安、全 PASS

- [ ] **Step 2: クリーンツリー確認**

Run: `git status --short --untracked-files=no`
Expected: 出力なし

- [ ] **Step 3: 差分が出た場合のみ**

修正し、内容に応じた `chore:`/`fix:` コミットを作る（対象パスのみ `git add`）。

---

## Self-Review 結果

- **Spec coverage:** ロードマップ Phase 4 行のサーバー側 — `packages/sync-protocol`（メッセージ型 = Task 1、field_versions 競合判定の純関数 = Task 2）、DO 側 WebSocket Hibernation エンドポイント（Task 3）、ブートストラップ + seq チェックポイント + トゥームストーン配信 = G2（Task 4）、content_types メタコレクション配信 = G1（Task 4 の welcome + Task 6 の再配信）。§6 の Phase 4 申し送り — WS トークン搬送（Task 3、subprotocol）、確立済みソケットのブロック切断（Task 3 の `disconnectUser` + Task 6 のテスト）、JWT 15分失効の接続中処理（Task 3 の attachment + Task 4 の入口検査 + Task 6 のテスト）、seq 再利用の安全性（Global Constraints で精査・明文化）、content_types 別チャネル（Task 4/6）、RecordSnapshot に relations が無い継ぎ目（Task 4 の `buildSyncInput` で解消）。**クライアントエンジン（partysocket + tanstack-db）は 4b の別計画**（ユーザー決定: 4a → 4b 順次完遂）。
- **Placeholder scan:** TBD/TODO なし。条件付き指示は既知の注意1-3のみ（具体的対処・BLOCKED 条件つき）。
- **Type consistency:** `SyncRecord` / `ClientChange` / `ServerMessage` / `AckResult` / `FieldConflict`（Task 1）↔ Task 2 の `resolveSyncWrite` ↔ Task 4/5 の handlers ↔ テスト、`SocketAuth` / `AUTH_HEADER`（Task 3）↔ ws-helpers ↔ DO の fetch、`PushDeps`（Task 5）↔ `writeRecordCore` の `WriteDeps`（同形）、`TenantClaims.exp` 追加（Task 3）↔ `authenticateTenantToken` ↔ 既存 jwt テストの追随 — 整合を確認済み。
- **実行者への注意:** Task 3 の Step 2 で書くテストは Step 3 で一部書き換わる（DO 直結ヘルパーへの移行）。順序どおり進めれば矛盾しない。テスト件数は目安であり、全件 PASS が基準。
