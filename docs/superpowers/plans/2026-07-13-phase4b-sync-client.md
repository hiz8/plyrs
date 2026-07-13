# Phase 4b: クライアント同期エンジン 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `packages/sync-client` を作り、Phase 4a の DO 同期サーバーに繋ぐローカルファースト・クライアントエンジンを実装する — 接続ライフサイクル（トークン失効での再接続込み）、ブートストラップとチェックポイント再開、冪等なストア適用、楽観的書き込みのアウトボックスと ack 照合、競合の提示。その上に薄い tanstack-db アダプタ（content_types からの実行時コレクション生成）を載せる。

**Architecture:** エンジンコアは **tanstack-db にも partysocket にも非依存**で、自前の `WebSocketLike` インターフェースと `connect: () => Promise<WebSocketLike>` ファクトリだけに依存する。これにより (a) フェイクソケットで決定論的にユニットテストでき、(b) **同じコード経路**を vitest-pool-workers 上の実 DO に繋いで統合テストできる。tanstack-db（BETA 0.6.x）への結線は `src/tanstack.ts` 1ファイルに隔離し、破壊的変更の影響範囲を閉じる。partysocket はブラウザ用トランスポート実装としてのみ使う（コンストラクタ注入を要求するため実 DO テストでは使わない）。

**Tech Stack:** TypeScript（strict）/ @tanstack/db 0.6.14（BETA・exact pin）/ partysocket 1.3.0 / Vitest（Node 環境: コア、workers 環境: 統合）/ @plyrs/sync-protocol / @plyrs/metamodel

## Global Constraints

- 新規依存は catalog 経由: `"@tanstack/db": "0.6.14"`（**exact pin** — BETA のためマイナー更新で破壊的変更あり）、`partysocket: "^1.3.0"`
- **エンジンコアは `@tanstack/db` と `partysocket` を import しない**（`src/engine.ts` / `src/outbox.ts` / `src/store.ts` は両方に非依存であることをテストで固定する）
- トランスポート抽象は自前: `interface WebSocketLike { readyState: number; send(data: string): void; close(code?: number, reason?: string): void; addEventListener(...): void; removeEventListener(...): void }`。エンジンは `connect: () => Promise<WebSocketLike>` を受け取る
- **ワイヤ契約（Phase 4a 申し送り、ロードマップ §7）を厳守**:
  - 重複配信あり → **`record.seq` が大きい方を採用**して冪等に適用する（同一 id で seq が小さい/等しい着信は無視）
  - checkpoint は `sync` の `complete: true` を受けてから `serverSeq` へ前進させる
  - `welcome.serverSeq < 手元 checkpoint` はサーバーリセットの兆候 → **checkpoint 0 で全再同期**にフォールバック
  - ソケット内のトークン更新は無い。**close 4001（token_expired）→ 新トークン取得 → checkpoint 付き hello で再接続**。自動再接続は 4001 では抑止し、明示的に再接続する
  - close 4003（blocked）は**再接続しない**（ユーザーに提示して終端）
  - keepalive は `KEEPALIVE_PING` を送るだけ（サーバーは DO を起こさず `KEEPALIVE_PONG` を自動応答）。**pong はプロトコルメッセージではない**ので JSON パースの対象外にする
  - conflict ack にサーバー現在値は入らない（`conflicts` のフィールド一覧のみ）
  - 空の many-relation は**キーごと省略**されて届く（`[]` ではない）
  - push は1バッチ最大 `MAX_CHANGES_PER_PUSH`（100）件
- **楽観的更新の確定は「ハンドラの Promise 解決」で起こる**（tanstack-db の仕様。同期ストリームのエコーを待たない）→ アダプタは **ack の確定レコードを `begin/write/commit` で同期状態にマージしてから resolve する**（さもないと UI がちらつく）
- tanstack-db の `sync` 設定は `rowUpdateMode: "full"`（`SyncRecord` は常に全状態）。`markReady()` の呼び忘れは live query が永久に待つ silent failure なので、必ず初回 `sync{complete:true}` で呼ぶ
- ack 失敗は**ハンドラで throw**（`code` / `conflicts` を載せた `SyncRejectedError`）→ tanstack-db が楽観的オーバーレイを自動ロールバックする
- 永続化は自前のインターフェース `SyncStorage`（checkpoint + アウトボックス）。**4b ではメモリ実装のみ**（ブラウザ実装＝IndexedDB/localStorage は Phase 6 の管理画面で）
- `@ts-expect-error` 禁止。**bare `git stash` / `git stash pop` 禁止**（stash スタックはワークツリー間で共有）
- 各タスクのコミット前に `pnpm format` と ルート `pnpm lint`（警告ゼロ）。コミット後ツリーで `pnpm format:check` exit 0
- TDD 必須（RED を確認してから GREEN）。実装者の typecheck / lint 主張はコントローラが抜き打ち検証する

**既知の注意（実装者向け）:**

1. `packages/sync-client` のテストは **Node 環境**（`vitest run`、既定）。DOM は不要（フェイクソケットは `EventTarget` ベースで自作する）。
2. 実 DO との統合テストは **`apps/api` 側**に置く（そちらは既に `--no-isolate --max-workers=1` で動く WS テスト環境が整っている）。`apps/api` が `@plyrs/sync-client` を devDependency として持つ形にする。
3. tanstack-db のコレクションは React 非依存で実行時に何個でも作れる（`createCollection` は素の関数）。

## ファイル構成（4b で確定する形）

```
packages/sync-client/
  package.json / tsconfig.json / vitest.config.ts
  src/transport.ts     # WebSocketLike / ConnectFn / SOCKET_STATE
  src/storage.ts       # SyncStorage インターフェース + MemorySyncStorage
  src/store.ts         # RecordStore: 冪等適用（seq 比較）・型別の索引・購読
  src/store.test.ts
  src/outbox.ts        # PendingChange の管理（changeId → 解決/棄却の Promise）
  src/outbox.test.ts
  src/engine.ts        # SyncEngine: 接続・hello/sync・push・ack・再接続・失効処理
  src/engine.test.ts   # フェイクソケットで駆動
  src/errors.ts        # SyncRejectedError
  src/tanstack.ts      # tanstack-db アダプタ（隔離）
  src/tanstack.test.ts
  src/browser.ts       # partysocket による ConnectFn（ブラウザ用）
  src/index.ts
apps/api/
  test/sync-client-e2e.test.ts  # 実 DO × 実エンジン（同じ WebSocketLike 経路）
```

---

### Task 1: パッケージ雛形 + トランスポート抽象 + ストレージ

**Files:**
- Modify: `pnpm-workspace.yaml`（catalog 追記）
- Create: `packages/sync-client/package.json` / `tsconfig.json` / `vitest.config.ts`
- Create: `packages/sync-client/src/transport.ts` / `src/storage.ts` / `src/errors.ts` / `src/index.ts`
- Test: `packages/sync-client/src/storage.test.ts`

**Interfaces:**
- Consumes: `@plyrs/sync-protocol`（`ClientChange` 等）
- Produces:
  - `src/transport.ts`: `SOCKET_OPEN = 1`、`interface WebSocketLike { readonly readyState: number; send(data: string): void; close(code?: number, reason?: string): void; addEventListener(type: "message" | "open" | "close" | "error", listener: (event: any) => void): void; removeEventListener(type: string, listener: (event: any) => void): void }`、`type ConnectFn = () => Promise<WebSocketLike>`
  - `src/storage.ts`: `interface SyncStorage { loadCheckpoint(): Promise<number>; saveCheckpoint(seq: number): Promise<void>; loadOutbox(): Promise<ClientChange[]>; saveOutbox(changes: ClientChange[]): Promise<void> }`、`class MemorySyncStorage implements SyncStorage`
  - `src/errors.ts`: `class SyncRejectedError extends Error { readonly code: string; readonly conflicts: FieldConflict[] }`

- [ ] **Step 1: catalog に依存を追記**

`pnpm-workspace.yaml` の `catalog:` に追記（既存エントリは維持）:

```yaml
  "@tanstack/db": "0.6.14"
  partysocket: "^1.3.0"
```

（`@tanstack/db` は BETA のため exact pin）

- [ ] **Step 2: パッケージ設定3ファイルを書く**

`packages/sync-client/package.json`:

```json
{
  "name": "@plyrs/sync-client",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./browser": "./src/browser.ts"
  },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@plyrs/metamodel": "workspace:*",
    "@plyrs/sync-protocol": "workspace:*",
    "@tanstack/db": "catalog:",
    "partysocket": "catalog:",
    "uuid": "catalog:"
  },
  "devDependencies": {
    "@types/node": "catalog:",
    "typescript": "catalog:",
    "vitest": "catalog:"
  }
}
```

`packages/sync-client/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src", "vitest.config.ts"]
}
```

`packages/sync-client/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
  },
});
```

- [ ] **Step 3: 失敗するテストを書く**

`packages/sync-client/src/storage.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { SyncRejectedError } from "./errors";
import { MemorySyncStorage } from "./storage";

const CHANGE = {
  changeId: "018f2b6a-7a0a-7000-8000-000000000001",
  recordId: "018f2b6a-7a0a-7000-8000-000000000002",
  typeKey: "article",
  op: "upsert" as const,
  input: { title: "hi" },
  changedFields: ["title"],
  baseFieldVersions: { title: 1 },
};

describe("MemorySyncStorage", () => {
  it("starts at checkpoint 0 with an empty outbox", async () => {
    const storage = new MemorySyncStorage();
    expect(await storage.loadCheckpoint()).toBe(0);
    expect(await storage.loadOutbox()).toEqual([]);
  });

  it("round-trips the checkpoint and the outbox", async () => {
    const storage = new MemorySyncStorage();
    await storage.saveCheckpoint(42);
    await storage.saveOutbox([CHANGE]);
    expect(await storage.loadCheckpoint()).toBe(42);
    expect(await storage.loadOutbox()).toEqual([CHANGE]);
  });

  it("returns a defensive copy of the outbox", async () => {
    const storage = new MemorySyncStorage();
    await storage.saveOutbox([CHANGE]);
    const loaded = await storage.loadOutbox();
    loaded.push({ ...CHANGE, changeId: "018f2b6a-7a0a-7000-8000-000000000003" });
    expect(await storage.loadOutbox()).toHaveLength(1);
  });
});

describe("SyncRejectedError", () => {
  it("carries the ack's code and conflicts", () => {
    const error = new SyncRejectedError("conflict", "manual resolution required", [
      { fieldKey: "body", baseVersion: 1, currentVersion: 4 },
    ]);
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe("conflict");
    expect(error.conflicts[0]?.fieldKey).toBe("body");
    expect(error.message).toBe("manual resolution required");
  });
});
```

- [ ] **Step 4: テストが失敗することを確認**

Run: `pnpm install && pnpm --filter @plyrs/sync-client test`
Expected: FAIL — `Cannot find module './errors'` / `'./storage'`

- [ ] **Step 5: 実装を書く**

`packages/sync-client/src/transport.ts`:

```ts
// エンジンは partysocket にも DOM の WebSocket にも依存しない。
// ブラウザでは partysocket（src/browser.ts）、テストではフェイクや
// workerd の実ソケットを同じ形で差し込む。
export const SOCKET_OPEN = 1;

export interface WebSocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(
    type: "message" | "open" | "close" | "error",
    listener: (event: SocketEvent) => void,
  ): void;
  removeEventListener(
    type: "message" | "open" | "close" | "error",
    listener: (event: SocketEvent) => void,
  ): void;
}

export interface SocketEvent {
  data?: unknown;
  code?: number;
  reason?: string;
}

export type ConnectFn = () => Promise<WebSocketLike>;
```

`packages/sync-client/src/errors.ts`:

```ts
import type { FieldConflict } from "@plyrs/sync-protocol";

// ack {ok:false} をハンドラから throw して tanstack-db の楽観的オーバーレイを
// ロールバックさせるためのエラー。code / conflicts を UI に運ぶ。
export class SyncRejectedError extends Error {
  readonly code: string;
  readonly conflicts: FieldConflict[];

  constructor(code: string, message: string, conflicts: FieldConflict[] = []) {
    super(message);
    this.name = "SyncRejectedError";
    this.code = code;
    this.conflicts = conflicts;
  }
}
```

`packages/sync-client/src/storage.ts`:

```ts
import type { ClientChange } from "@plyrs/sync-protocol";

// 永続化の抽象。4b ではメモリ実装のみ（ブラウザの IndexedDB/localStorage 実装は
// Phase 6 の管理画面で足す）。永続化するのは checkpoint と未 ack のアウトボックス。
export interface SyncStorage {
  loadCheckpoint(): Promise<number>;
  saveCheckpoint(seq: number): Promise<void>;
  loadOutbox(): Promise<ClientChange[]>;
  saveOutbox(changes: ClientChange[]): Promise<void>;
}

export class MemorySyncStorage implements SyncStorage {
  private checkpoint = 0;
  private outbox: ClientChange[] = [];

  async loadCheckpoint(): Promise<number> {
    return this.checkpoint;
  }

  async saveCheckpoint(seq: number): Promise<void> {
    this.checkpoint = seq;
  }

  async loadOutbox(): Promise<ClientChange[]> {
    return [...this.outbox];
  }

  async saveOutbox(changes: ClientChange[]): Promise<void> {
    this.outbox = [...changes];
  }
}
```

`packages/sync-client/src/index.ts`:

```ts
export { SyncRejectedError } from "./errors";
export { MemorySyncStorage, type SyncStorage } from "./storage";
export { SOCKET_OPEN, type ConnectFn, type SocketEvent, type WebSocketLike } from "./transport";
```

- [ ] **Step 6: テストが通ることを確認**

Run: `pnpm --filter @plyrs/sync-client test` → PASS（4件）
Run: `pnpm --filter @plyrs/sync-client typecheck` → エラーなし

- [ ] **Step 7: フォーマット・lint・コミット**

```bash
pnpm format && pnpm lint
git add pnpm-workspace.yaml pnpm-lock.yaml packages/sync-client
git commit -m "feat: scaffold sync-client with transport and storage abstractions"
```

---

### Task 2: RecordStore（冪等適用）

**Files:**
- Create: `packages/sync-client/src/store.ts`
- Modify: `packages/sync-client/src/index.ts`
- Test: `packages/sync-client/src/store.test.ts`

**Interfaces:**
- Consumes: `SyncRecord`（sync-protocol）
- Produces:
  - `type StoreChange = { kind: "upsert"; record: SyncRecord } | { kind: "delete"; recordId: string; typeKey: string }`
  - `class RecordStore`:
    - `apply(record: SyncRecord): StoreChange | null` — **seq が現在値以下なら null（無視）**。トゥームストーン（`deletedAt !== null`）は delete を返し、レコードを保持しない（`seq` だけ覚える）
    - `get(recordId: string): SyncRecord | undefined`
    - `listByType(typeKey: string): SyncRecord[]`（seq 昇順）
    - `seqOf(recordId: string): number`（未知は 0）
    - `clear(): void`（サーバーリセット時の全再同期用）

トゥームストーンの `seq` は保持する必要がある（同じ id の古い `change` が後から届いても復活させないため）。

- [ ] **Step 1: 失敗するテストを書く**

`packages/sync-client/src/store.test.ts`:

```ts
import type { SyncRecord } from "@plyrs/sync-protocol";
import { describe, expect, it } from "vitest";
import { RecordStore } from "./store";

function record(overrides: Partial<SyncRecord> = {}): SyncRecord {
  return {
    id: "r1",
    type: "article",
    input: { title: "hello" },
    fieldVersions: { title: 1 },
    status: "draft",
    seq: 1,
    version: 1,
    deletedAt: null,
    updatedAt: "2026-07-13T00:00:00Z",
    updatedBy: "u1",
    ...overrides,
  };
}

describe("RecordStore", () => {
  it("applies a new record and exposes it", () => {
    const store = new RecordStore();
    expect(store.apply(record())).toEqual({ kind: "upsert", record: record() });
    expect(store.get("r1")?.input["title"]).toBe("hello");
    expect(store.listByType("article")).toHaveLength(1);
    expect(store.seqOf("r1")).toBe(1);
  });

  it("ignores a duplicate or older delivery (idempotent by seq)", () => {
    const store = new RecordStore();
    store.apply(record({ seq: 5, input: { title: "new" } }));
    expect(store.apply(record({ seq: 5, input: { title: "stale" } }))).toBeNull();
    expect(store.apply(record({ seq: 3, input: { title: "older" } }))).toBeNull();
    expect(store.get("r1")?.input["title"]).toBe("new");
  });

  it("applies a newer delivery over an older one", () => {
    const store = new RecordStore();
    store.apply(record({ seq: 2, input: { title: "old" } }));
    const change = store.apply(record({ seq: 7, input: { title: "newer" } }));
    expect(change).toMatchObject({ kind: "upsert" });
    expect(store.get("r1")?.input["title"]).toBe("newer");
    expect(store.seqOf("r1")).toBe(7);
  });

  it("removes a record on a tombstone and remembers its seq", () => {
    const store = new RecordStore();
    store.apply(record({ seq: 2 }));
    const change = store.apply(record({ seq: 4, deletedAt: "2026-07-13T01:00:00Z", input: {} }));
    expect(change).toEqual({ kind: "delete", recordId: "r1", typeKey: "article" });
    expect(store.get("r1")).toBeUndefined();
    expect(store.listByType("article")).toHaveLength(0);
    expect(store.seqOf("r1")).toBe(4);
  });

  it("does not resurrect a deleted record from an older delivery", () => {
    const store = new RecordStore();
    store.apply(record({ seq: 4, deletedAt: "2026-07-13T01:00:00Z", input: {} }));
    expect(store.apply(record({ seq: 3, input: { title: "zombie" } }))).toBeNull();
    expect(store.get("r1")).toBeUndefined();
  });

  it("lists by type in seq order and clears everything", () => {
    const store = new RecordStore();
    store.apply(record({ id: "b", seq: 9 }));
    store.apply(record({ id: "a", seq: 4 }));
    store.apply(record({ id: "n", type: "note", seq: 6 }));
    expect(store.listByType("article").map((entry) => entry.id)).toEqual(["a", "b"]);
    expect(store.listByType("note").map((entry) => entry.id)).toEqual(["n"]);

    store.clear();
    expect(store.listByType("article")).toHaveLength(0);
    expect(store.seqOf("a")).toBe(0);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm --filter @plyrs/sync-client test`
Expected: FAIL — `Cannot find module './store'`

- [ ] **Step 3: 実装を書く**

`packages/sync-client/src/store.ts`:

```ts
import type { SyncRecord } from "@plyrs/sync-protocol";

export type StoreChange =
  | { kind: "upsert"; record: SyncRecord }
  | { kind: "delete"; recordId: string; typeKey: string };

// ロードマップ §7 の契約: 同じ record が重複配信されうる（upgrade 〜 hello の間に
// 他クライアントの push があると change が welcome より先に届き、bootstrap にも再登場する）。
// record は全状態なので「id ごとに seq が大きい方を採用」で収束する。
export class RecordStore {
  private readonly records = new Map<string, SyncRecord>();
  // トゥームストーンの seq も覚える（消えた record を古い配信で復活させないため）
  private readonly seqs = new Map<string, number>();

  apply(record: SyncRecord): StoreChange | null {
    const knownSeq = this.seqs.get(record.id) ?? 0;
    if (record.seq <= knownSeq) {
      return null;
    }
    this.seqs.set(record.id, record.seq);

    if (record.deletedAt !== null) {
      const previous = this.records.get(record.id);
      this.records.delete(record.id);
      return {
        kind: "delete",
        recordId: record.id,
        typeKey: previous?.type ?? record.type,
      };
    }

    this.records.set(record.id, record);
    return { kind: "upsert", record };
  }

  get(recordId: string): SyncRecord | undefined {
    return this.records.get(recordId);
  }

  listByType(typeKey: string): SyncRecord[] {
    return [...this.records.values()]
      .filter((record) => record.type === typeKey)
      .sort((left, right) => left.seq - right.seq);
  }

  seqOf(recordId: string): number {
    return this.seqs.get(recordId) ?? 0;
  }

  clear(): void {
    this.records.clear();
    this.seqs.clear();
  }
}
```

`packages/sync-client/src/index.ts` に追記:

```ts
export { RecordStore, type StoreChange } from "./store";
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm --filter @plyrs/sync-client test` → PASS（10件）

- [ ] **Step 5: フォーマット・lint・コミット**

```bash
pnpm format && pnpm lint
git add packages/sync-client/src/store.ts packages/sync-client/src/store.test.ts packages/sync-client/src/index.ts
git commit -m "feat: add the idempotent record store keyed by seq"
```

---

### Task 3: Outbox（未 ack 変更の管理）

**Files:**
- Create: `packages/sync-client/src/outbox.ts`
- Modify: `packages/sync-client/src/index.ts`
- Test: `packages/sync-client/src/outbox.test.ts`

**Interfaces:**
- Consumes: `ClientChange` / `AckResult`（sync-protocol）、`SyncRejectedError`（Task 1）、`SyncStorage`（Task 1）
- Produces:
  - `class Outbox`:
    - `constructor(storage: SyncStorage)`
    - `hydrate(): Promise<ClientChange[]>` — 永続化から復元して未送信一覧を返す
    - `enqueue(change: ClientChange): Promise<Promise<SyncRecord>>` — 外側の Promise は永続化完了、内側は ack 待ち（成功で確定レコード、失敗で `SyncRejectedError` reject）
    - `settle(changeId: string, result: AckResult): Promise<void>` — ack を受けて内側 Promise を解決/棄却し、永続化から除く
    - `pending(): ClientChange[]` — 再接続時に再送する未 ack の一覧（enqueue 順）
    - `failAll(error: Error): Promise<void>` — 接続が終端した（BAN 等）ときに全 pending を棄却する

再送は「同じ changeId で再送する」= サーバー側は同じ record に対する upsert として再裁定する（冪等ではないが、`baseFieldVersions` 由来の裁定で収束する）。

- [ ] **Step 1: 失敗するテストを書く**

`packages/sync-client/src/outbox.test.ts`:

```ts
import type { ClientChange, SyncRecord } from "@plyrs/sync-protocol";
import { describe, expect, it } from "vitest";
import { SyncRejectedError } from "./errors";
import { Outbox } from "./outbox";
import { MemorySyncStorage } from "./storage";

function change(id: string): ClientChange {
  return {
    changeId: id,
    recordId: "r1",
    typeKey: "article",
    op: "upsert",
    input: { title: "hi" },
    changedFields: ["title"],
    baseFieldVersions: {},
  };
}

function record(): SyncRecord {
  return {
    id: "r1",
    type: "article",
    input: { title: "hi" },
    fieldVersions: { title: 1 },
    status: "draft",
    seq: 3,
    version: 1,
    deletedAt: null,
    updatedAt: "2026-07-13T00:00:00Z",
    updatedBy: "u1",
  };
}

describe("Outbox", () => {
  it("resolves the pending promise with the acked record", async () => {
    const outbox = new Outbox(new MemorySyncStorage());
    const acked = await outbox.enqueue(change("c1"));
    expect(outbox.pending().map((entry) => entry.changeId)).toEqual(["c1"]);

    await outbox.settle("c1", { ok: true, record: record() });
    expect(await acked).toEqual(record());
    expect(outbox.pending()).toEqual([]);
  });

  it("rejects with SyncRejectedError carrying the conflicts", async () => {
    const outbox = new Outbox(new MemorySyncStorage());
    const acked = await outbox.enqueue(change("c2"));
    await outbox.settle("c2", {
      ok: false,
      code: "conflict",
      message: "manual resolution required",
      conflicts: [{ fieldKey: "body", baseVersion: 1, currentVersion: 4 }],
    });

    await expect(acked).rejects.toBeInstanceOf(SyncRejectedError);
    await expect(acked).rejects.toMatchObject({ code: "conflict" });
    expect(outbox.pending()).toEqual([]);
  });

  it("persists pending changes and restores them on hydrate", async () => {
    const storage = new MemorySyncStorage();
    const outbox = new Outbox(storage);
    await outbox.enqueue(change("c3"));
    expect(await storage.loadOutbox()).toHaveLength(1);

    const revived = new Outbox(storage);
    const restored = await revived.hydrate();
    expect(restored.map((entry) => entry.changeId)).toEqual(["c3"]);
    expect(revived.pending().map((entry) => entry.changeId)).toEqual(["c3"]);
  });

  it("ignores an ack for an unknown changeId", async () => {
    const outbox = new Outbox(new MemorySyncStorage());
    await expect(outbox.settle("nope", { ok: true, record: record() })).resolves.toBeUndefined();
  });

  it("fails every pending change when the connection is terminated", async () => {
    const outbox = new Outbox(new MemorySyncStorage());
    const first = await outbox.enqueue(change("c4"));
    const second = await outbox.enqueue(change("c5"));

    await outbox.failAll(new Error("blocked"));
    await expect(first).rejects.toThrow("blocked");
    await expect(second).rejects.toThrow("blocked");
    expect(outbox.pending()).toEqual([]);
  });

  it("keeps enqueue order for redelivery", async () => {
    const outbox = new Outbox(new MemorySyncStorage());
    await outbox.enqueue(change("c6"));
    await outbox.enqueue(change("c7"));
    expect(outbox.pending().map((entry) => entry.changeId)).toEqual(["c6", "c7"]);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm --filter @plyrs/sync-client test`
Expected: FAIL — `Cannot find module './outbox'`

- [ ] **Step 3: 実装を書く**

`packages/sync-client/src/outbox.ts`:

```ts
import type { AckResult, ClientChange, SyncRecord } from "@plyrs/sync-protocol";
import { SyncRejectedError } from "./errors";
import type { SyncStorage } from "./storage";

interface PendingEntry {
  change: ClientChange;
  resolve: (record: SyncRecord) => void;
  reject: (error: Error) => void;
}

// 未 ack の変更を保持する。永続化するのは変更そのものだけ（Promise は再起動で失われるが、
// リロード後の再送は hydrate() が返す一覧をエンジンが送り直すことで担保する）。
export class Outbox {
  private readonly entries = new Map<string, PendingEntry>();

  constructor(private readonly storage: SyncStorage) {}

  async hydrate(): Promise<ClientChange[]> {
    const restored = await this.storage.loadOutbox();
    for (const change of restored) {
      if (!this.entries.has(change.changeId)) {
        // リロード後の再送分は待ち手がいないので、解決先は捨てる（UI は再同期で追随する）
        this.entries.set(change.changeId, {
          change,
          resolve: () => undefined,
          reject: () => undefined,
        });
      }
    }
    return restored;
  }

  async enqueue(change: ClientChange): Promise<Promise<SyncRecord>> {
    let resolve!: (record: SyncRecord) => void;
    let reject!: (error: Error) => void;
    const acked = new Promise<SyncRecord>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    // 未処理の rejection で落ちないよう、待ち手が付くまでの間を無害化する
    acked.catch(() => undefined);

    this.entries.set(change.changeId, { change, resolve, reject });
    await this.persist();
    return acked;
  }

  async settle(changeId: string, result: AckResult): Promise<void> {
    const entry = this.entries.get(changeId);
    if (entry === undefined) {
      return;
    }
    this.entries.delete(changeId);
    await this.persist();

    if (result.ok) {
      entry.resolve(result.record);
      return;
    }
    entry.reject(new SyncRejectedError(result.code, result.message, result.conflicts ?? []));
  }

  pending(): ClientChange[] {
    return [...this.entries.values()].map((entry) => entry.change);
  }

  async failAll(error: Error): Promise<void> {
    const entries = [...this.entries.values()];
    this.entries.clear();
    await this.persist();
    for (const entry of entries) {
      entry.reject(error);
    }
  }

  private async persist(): Promise<void> {
    await this.storage.saveOutbox(this.pending());
  }
}
```

`packages/sync-client/src/index.ts` に追記:

```ts
export { Outbox } from "./outbox";
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm --filter @plyrs/sync-client test` → PASS（16件）

- [ ] **Step 5: フォーマット・lint・コミット**

```bash
pnpm format && pnpm lint
git add packages/sync-client/src/outbox.ts packages/sync-client/src/outbox.test.ts packages/sync-client/src/index.ts
git commit -m "feat: add the outbox for pending optimistic changes"
```

---

### Task 4: SyncEngine（接続・ブートストラップ・push・ack）

**Files:**
- Create: `packages/sync-client/src/engine.ts`
- Modify: `packages/sync-client/src/index.ts`
- Test: `packages/sync-client/src/engine.test.ts`（フェイクソケットで駆動）

**Interfaces:**
- Consumes: `ConnectFn` / `WebSocketLike` / `SOCKET_OPEN`（Task 1）、`RecordStore` / `StoreChange`（Task 2）、`Outbox`（Task 3）、`SyncStorage`、sync-protocol の型と定数
- Produces:
  - `interface SyncEngineOptions { connect: ConnectFn; storage?: SyncStorage; onStoreChange?: (change: StoreChange) => void; onContentTypes?: (types: ContentTypeDefinition[]) => void; onReady?: () => void; onStatus?: (status: SyncStatus) => void; refreshToken?: () => Promise<void>; now?: () => number }`
  - `type SyncStatus = "idle" | "connecting" | "syncing" | "ready" | "closed"`
  - `class SyncEngine`:
    - `start(): Promise<void>` — 接続 → hydrate → hello（checkpoint）
    - `push(change: ClientChange): Promise<SyncRecord>` — アウトボックスに積み、接続中なら即送信。ack で解決/棄却
    - `stop(): Promise<void>`
    - `store: RecordStore`（読み取り用）
    - `status: SyncStatus`
    - `checkpoint: number`

**エンジンの規約（ロードマップ §7 の契約の実装）:**

- `welcome` 受信時: `serverSeq < checkpoint` なら **store.clear() + checkpoint=0 で hello を送り直す**（サーバーリセット検知）
- `sync` 受信時: records を store に適用（冪等）。`complete: true` で checkpoint を `serverSeq` へ前進 → 永続化 → `onReady()` を1回だけ呼ぶ → **アウトボックスの pending を再送**
- `change` 受信時: store に適用（冪等）
- `ack` 受信時: `outbox.settle`
- `content-types` / `welcome`: `onContentTypes`
- close 4001: **再接続する**（`refreshToken()` を呼んでから）
- close 4003: **再接続しない**。`outbox.failAll` して status を "closed"
- それ以外の close: 再接続する（バックオフは `connect` 実装側の責務。エンジンは即時再試行を1回だけ行い、失敗したら status を "closed" にする — ブラウザでは partysocket が再接続を担うため、エンジンは「切れたら connect をもう一度呼ぶ」だけでよい）
- 受信メッセージが `KEEPALIVE_PONG` そのものなら**無視**（JSON ではない）

- [ ] **Step 1: 失敗するテストを書く**

`packages/sync-client/src/engine.test.ts`:

```ts
import type { ContentTypeDefinition } from "@plyrs/metamodel";
import type { ClientChange, ServerMessage, SyncRecord } from "@plyrs/sync-protocol";
import { CLOSE_CODES, KEEPALIVE_PONG } from "@plyrs/sync-protocol";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SyncEngine } from "./engine";
import { MemorySyncStorage } from "./storage";
import type { SocketEvent, WebSocketLike } from "./transport";

class FakeSocket implements WebSocketLike {
  readyState = 1;
  readonly sent: string[] = [];
  private readonly listeners = new Map<string, ((event: SocketEvent) => void)[]>();

  send(data: string): void {
    this.sent.push(data);
  }

  close(code = 1000, reason = ""): void {
    this.readyState = 3;
    this.emit("close", { code, reason });
  }

  addEventListener(type: string, listener: (event: SocketEvent) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  removeEventListener(type: string, listener: (event: SocketEvent) => void): void {
    this.listeners.set(
      type,
      (this.listeners.get(type) ?? []).filter((entry) => entry !== listener),
    );
  }

  emit(type: string, event: SocketEvent): void {
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
    updatedAt: "2026-07-13T00:00:00Z",
    updatedBy: "u1",
    ...overrides,
  };
}

function change(id = "c1"): ClientChange {
  return {
    changeId: id,
    recordId: "r1",
    typeKey: "article",
    op: "upsert",
    input: { title: "hello" },
    changedFields: ["title"],
    baseFieldVersions: {},
  };
}

describe("SyncEngine", () => {
  let socket: FakeSocket;
  let storage: MemorySyncStorage;

  beforeEach(() => {
    socket = new FakeSocket();
    storage = new MemorySyncStorage();
  });

  function engine(overrides: Partial<ConstructorParameters<typeof SyncEngine>[0]> = {}) {
    return new SyncEngine({
      connect: async () => socket,
      storage,
      ...overrides,
    });
  }

  async function bootstrap(target: SyncEngine): Promise<void> {
    await target.start();
    socket.deliver({
      type: "welcome",
      protocolVersion: 1,
      contentTypes: [articleType],
      serverSeq: 3,
    });
    socket.deliver({ type: "sync", records: [record()], serverSeq: 3, complete: true });
    await vi.waitFor(() => expect(target.status).toBe("ready"));
  }

  it("sends hello with the stored checkpoint and applies the bootstrap", async () => {
    await storage.saveCheckpoint(2);
    const onContentTypes = vi.fn();
    const onReady = vi.fn();
    const target = engine({ onContentTypes, onReady });

    await target.start();
    expect(socket.parsed()[0]).toEqual({ type: "hello", checkpoint: 2 });

    socket.deliver({
      type: "welcome",
      protocolVersion: 1,
      contentTypes: [articleType],
      serverSeq: 3,
    });
    socket.deliver({ type: "sync", records: [record()], serverSeq: 3, complete: true });

    await vi.waitFor(() => expect(target.status).toBe("ready"));
    expect(onContentTypes).toHaveBeenCalledWith([articleType]);
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(target.store.get("r1")?.input["title"]).toBe("hello");
    expect(target.checkpoint).toBe(3);
    expect(await storage.loadCheckpoint()).toBe(3);
  });

  it("does not advance the checkpoint until complete is true", async () => {
    const target = engine();
    await target.start();
    socket.deliver({
      type: "welcome",
      protocolVersion: 1,
      contentTypes: [articleType],
      serverSeq: 9,
    });
    socket.deliver({ type: "sync", records: [record({ seq: 4 })], serverSeq: 9, complete: false });
    expect(target.checkpoint).toBe(0);

    socket.deliver({ type: "sync", records: [record({ id: "r2", seq: 9 })], serverSeq: 9, complete: true });
    await vi.waitFor(() => expect(target.checkpoint).toBe(9));
  });

  it("resets to a full resync when the server's seq is behind the checkpoint", async () => {
    await storage.saveCheckpoint(50);
    const target = engine();
    await target.start();
    target.store.apply(record({ seq: 40 }));

    socket.deliver({
      type: "welcome",
      protocolVersion: 1,
      contentTypes: [articleType],
      serverSeq: 5,
    });

    await vi.waitFor(() => expect(socket.parsed()).toContainEqual({ type: "hello", checkpoint: 0 }));
    expect(target.store.get("r1")).toBeUndefined();
    expect(target.checkpoint).toBe(0);
  });

  it("applies broadcast changes idempotently", async () => {
    const onStoreChange = vi.fn();
    const target = engine({ onStoreChange });
    await bootstrap(target);
    onStoreChange.mockClear();

    socket.deliver({ type: "change", record: record({ seq: 8, input: { title: "updated" } }) });
    expect(target.store.get("r1")?.input["title"]).toBe("updated");
    expect(onStoreChange).toHaveBeenCalledTimes(1);

    // 重複配信（同じ seq）は無視される
    socket.deliver({ type: "change", record: record({ seq: 8, input: { title: "updated" } }) });
    expect(onStoreChange).toHaveBeenCalledTimes(1);
  });

  it("resolves a push when the ack arrives", async () => {
    const target = engine();
    await bootstrap(target);

    const pushed = target.push(change());
    await vi.waitFor(() =>
      expect(socket.parsed()).toContainEqual({ type: "push", changes: [change()] }),
    );

    socket.deliver({
      type: "ack",
      changeId: "c1",
      result: { ok: true, record: record({ seq: 11, input: { title: "confirmed" } }) },
    });
    const confirmed = await pushed;
    expect(confirmed.seq).toBe(11);
    expect(target.store.get("r1")?.input["title"]).toBe("confirmed");
  });

  it("rejects a push with a conflict ack", async () => {
    const target = engine();
    await bootstrap(target);

    const pushed = target.push(change("c2"));
    socket.deliver({
      type: "ack",
      changeId: "c2",
      result: {
        ok: false,
        code: "conflict",
        message: "manual resolution required",
        conflicts: [{ fieldKey: "body", baseVersion: 1, currentVersion: 4 }],
      },
    });
    await expect(pushed).rejects.toMatchObject({ code: "conflict" });
  });

  it("redelivers pending changes after a reconnect", async () => {
    const target = engine();
    await bootstrap(target);
    const pushed = target.push(change("c3"));
    await vi.waitFor(() => expect(socket.sent.length).toBeGreaterThan(1));

    const next = new FakeSocket();
    socket.close(1006, "network");
    // 再接続後のソケットに差し替わる
    (target as unknown as { options: { connect: () => Promise<WebSocketLike> } }).options.connect =
      async () => next;

    await vi.waitFor(() => expect(next.parsed()[0]).toEqual({ type: "hello", checkpoint: 3 }));
    next.deliver({ type: "welcome", protocolVersion: 1, contentTypes: [articleType], serverSeq: 3 });
    next.deliver({ type: "sync", records: [], serverSeq: 3, complete: true });

    await vi.waitFor(() =>
      expect(next.parsed()).toContainEqual({ type: "push", changes: [change("c3")] }),
    );
    next.deliver({ type: "ack", changeId: "c3", result: { ok: true, record: record({ seq: 12 }) } });
    await expect(pushed).resolves.toMatchObject({ seq: 12 });
  });

  it("refreshes the token and reconnects on close 4001", async () => {
    const refreshToken = vi.fn(async () => undefined);
    const target = engine({ refreshToken });
    await bootstrap(target);

    const next = new FakeSocket();
    (target as unknown as { options: { connect: () => Promise<WebSocketLike> } }).options.connect =
      async () => next;
    socket.close(CLOSE_CODES.tokenExpired, "token_expired");

    await vi.waitFor(() => expect(refreshToken).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(next.parsed()[0]).toEqual({ type: "hello", checkpoint: 3 }));
  });

  it("terminates without reconnecting when blocked (4003)", async () => {
    const target = engine();
    await bootstrap(target);
    const pushed = target.push(change("c4"));

    socket.close(CLOSE_CODES.blocked, "blocked");

    await vi.waitFor(() => expect(target.status).toBe("closed"));
    await expect(pushed).rejects.toThrow(/blocked/);
  });

  it("ignores keepalive pongs", async () => {
    const target = engine();
    await bootstrap(target);
    expect(() => socket.emit("message", { data: KEEPALIVE_PONG })).not.toThrow();
    expect(target.status).toBe("ready");
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm --filter @plyrs/sync-client test`
Expected: FAIL — `Cannot find module './engine'`

- [ ] **Step 3: 実装を書く**

`packages/sync-client/src/engine.ts`:

```ts
import type { ContentTypeDefinition } from "@plyrs/metamodel";
import type { ClientChange, ServerMessage, SyncRecord } from "@plyrs/sync-protocol";
import { CLOSE_CODES, KEEPALIVE_PONG, MAX_CHANGES_PER_PUSH } from "@plyrs/sync-protocol";
import { Outbox } from "./outbox";
import { MemorySyncStorage, type SyncStorage } from "./storage";
import { RecordStore, type StoreChange } from "./store";
import { SOCKET_OPEN, type ConnectFn, type SocketEvent, type WebSocketLike } from "./transport";

export type SyncStatus = "idle" | "connecting" | "syncing" | "ready" | "closed";

export interface SyncEngineOptions {
  connect: ConnectFn;
  storage?: SyncStorage;
  onStoreChange?: (change: StoreChange) => void;
  onContentTypes?: (types: ContentTypeDefinition[]) => void;
  onReady?: () => void;
  onStatus?: (status: SyncStatus) => void;
  refreshToken?: () => Promise<void>;
}

export class SyncEngine {
  readonly store = new RecordStore();

  private readonly options: SyncEngineOptions;
  private readonly storage: SyncStorage;
  private readonly outbox: Outbox;
  private socket: WebSocketLike | null = null;
  private currentStatus: SyncStatus = "idle";
  private currentCheckpoint = 0;
  private readySent = false;
  private stopped = false;

  constructor(options: SyncEngineOptions) {
    this.options = options;
    this.storage = options.storage ?? new MemorySyncStorage();
    this.outbox = new Outbox(this.storage);
  }

  get status(): SyncStatus {
    return this.currentStatus;
  }

  get checkpoint(): number {
    return this.currentCheckpoint;
  }

  async start(): Promise<void> {
    this.stopped = false;
    this.currentCheckpoint = await this.storage.loadCheckpoint();
    await this.outbox.hydrate();
    await this.open();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.socket?.close(1000, "client_stop");
    this.socket = null;
    this.setStatus("closed");
  }

  async push(change: ClientChange): Promise<SyncRecord> {
    const acked = await this.outbox.enqueue(change);
    this.flush();
    return acked;
  }

  private async open(): Promise<void> {
    this.setStatus("connecting");
    this.readySent = false;
    const socket = await this.options.connect();
    this.socket = socket;
    socket.addEventListener("message", this.onMessage);
    socket.addEventListener("close", this.onClose);
    this.setStatus("syncing");
    this.sendHello();
  }

  private sendHello(): void {
    this.send({ type: "hello", checkpoint: this.currentCheckpoint });
  }

  private readonly onMessage = (event: SocketEvent): void => {
    const raw = event.data;
    if (typeof raw !== "string" || raw === KEEPALIVE_PONG) {
      return;
    }
    let message: ServerMessage;
    try {
      message = JSON.parse(raw) as ServerMessage;
    } catch {
      return;
    }
    void this.handle(message);
  };

  private async handle(message: ServerMessage): Promise<void> {
    switch (message.type) {
      case "welcome": {
        this.options.onContentTypes?.(message.contentTypes);
        // ロードマップ §7: serverSeq が手元 checkpoint より小さい = サーバーリセット
        if (message.serverSeq < this.currentCheckpoint) {
          this.store.clear();
          this.currentCheckpoint = 0;
          await this.storage.saveCheckpoint(0);
          this.sendHello();
        }
        return;
      }
      case "sync": {
        for (const record of message.records) {
          this.applyRecord(record);
        }
        // ロードマップ §7: complete を受けてから checkpoint を前進させる
        if (message.complete) {
          this.currentCheckpoint = message.serverSeq;
          await this.storage.saveCheckpoint(message.serverSeq);
          this.setStatus("ready");
          if (!this.readySent) {
            this.readySent = true;
            this.options.onReady?.();
          }
          this.flush();
        }
        return;
      }
      case "change": {
        this.applyRecord(message.record);
        return;
      }
      case "content-types": {
        this.options.onContentTypes?.(message.contentTypes);
        return;
      }
      case "ack": {
        if (message.result.ok) {
          this.applyRecord(message.result.record);
        }
        await this.outbox.settle(message.changeId, message.result);
        return;
      }
      case "error": {
        return;
      }
    }
  }

  private applyRecord(record: SyncRecord): void {
    const change = this.store.apply(record);
    if (change !== null) {
      this.options.onStoreChange?.(change);
    }
  }

  private readonly onClose = (event: SocketEvent): void => {
    this.socket = null;
    if (this.stopped) {
      return;
    }
    const code = event.code ?? 1006;
    if (code === CLOSE_CODES.blocked) {
      void this.terminate(new Error("blocked by the server"));
      return;
    }
    void this.reconnect(code);
  };

  private async terminate(error: Error): Promise<void> {
    this.setStatus("closed");
    await this.outbox.failAll(error);
  }

  private async reconnect(code: number): Promise<void> {
    if (code === CLOSE_CODES.tokenExpired) {
      // ソケット内のトークン更新は無い。新トークンを取ってから張り直す。
      await this.options.refreshToken?.();
    }
    if (this.stopped) {
      return;
    }
    try {
      await this.open();
    } catch (error) {
      await this.terminate(error instanceof Error ? error : new Error("reconnect failed"));
    }
  }

  private flush(): void {
    const pending = this.outbox.pending();
    if (pending.length === 0 || this.socket === null || this.socket.readyState !== SOCKET_OPEN) {
      return;
    }
    for (let index = 0; index < pending.length; index += MAX_CHANGES_PER_PUSH) {
      this.send({ type: "push", changes: pending.slice(index, index + MAX_CHANGES_PER_PUSH) });
    }
  }

  private send(message: { type: "hello"; checkpoint: number } | { type: "push"; changes: ClientChange[] }): void {
    if (this.socket === null || this.socket.readyState !== SOCKET_OPEN) {
      return;
    }
    this.socket.send(JSON.stringify(message));
  }

  private setStatus(status: SyncStatus): void {
    if (this.currentStatus === status) {
      return;
    }
    this.currentStatus = status;
    this.options.onStatus?.(status);
  }
}
```

`packages/sync-client/src/index.ts` に追記:

```ts
export { SyncEngine, type SyncEngineOptions, type SyncStatus } from "./engine";
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm --filter @plyrs/sync-client test` → PASS（26件）
Run: `pnpm --filter @plyrs/sync-client typecheck` → エラーなし

- [ ] **Step 5: コア非依存を固定するテストを足す**

`packages/sync-client/src/engine.test.ts` の末尾に追記:

```ts
describe("engine core independence", () => {
  it("does not import @tanstack/db or partysocket", async () => {
    const { readFile } = await import("node:fs/promises");
    for (const file of ["engine.ts", "store.ts", "outbox.ts", "storage.ts", "transport.ts"]) {
      const source = await readFile(new URL(file, import.meta.url), "utf8");
      expect(source).not.toContain("@tanstack/db");
      expect(source).not.toContain("partysocket");
    }
  });
});
```

Run: `pnpm --filter @plyrs/sync-client test` → PASS（27件）

- [ ] **Step 6: フォーマット・lint・コミット**

```bash
pnpm format && pnpm lint
git add packages/sync-client/src/engine.ts packages/sync-client/src/engine.test.ts packages/sync-client/src/index.ts
git commit -m "feat: add the sync engine with checkpoint resume and ack reconciliation"
```

---

### Task 5: tanstack-db アダプタ（実行時コレクション生成）

**Files:**
- Create: `packages/sync-client/src/tanstack.ts`
- Modify: `packages/sync-client/src/index.ts`
- Test: `packages/sync-client/src/tanstack.test.ts`

**Interfaces:**
- Consumes: `SyncEngine` / `StoreChange`（Task 2/4）、`ContentTypeDefinition`（metamodel）、`@tanstack/db` の `createCollection`
- Produces:
  - `class CollectionRegistry`:
    - `constructor(engine: SyncEngine)`
    - `sync(types: ContentTypeDefinition[]): void` — 受け取った content_types に対応するコレクションを生成/更新する（既存キーは維持）
    - `get(typeKey: string): Collection | undefined`
    - `keys(): string[]`
    - `applyStoreChange(change: StoreChange): void` — エンジンの `onStoreChange` から呼ぶ（`begin/write/commit` で同期状態を更新）
    - `markReady(): void` — エンジンの `onReady` から呼ぶ（**呼ばないと live query が永久に待つ**）

**設計の要点（調査結果の反映）:**

- `rowUpdateMode: "full"`（`SyncRecord` は常に全状態）
- **楽観的更新の確定はハンドラの Promise 解決で起こる**。`onInsert` / `onUpdate` / `onDelete` は `engine.push(...)` の ack を待ち、**確定レコードを `begin/write/commit` で同期状態にマージしてから resolve** する（ちらつき防止）
- ack 失敗（`SyncRejectedError`）はハンドラから throw → tanstack-db が楽観的オーバーレイを自動ロールバック
- コレクションの行は `SyncRecord`（`getKey: (row) => row.id`）

- [ ] **Step 1: 失敗するテストを書く**

`packages/sync-client/src/tanstack.test.ts`:

```ts
import type { ContentTypeDefinition } from "@plyrs/metamodel";
import type { SyncRecord } from "@plyrs/sync-protocol";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SyncEngine } from "./engine";
import { MemorySyncStorage } from "./storage";
import { CollectionRegistry } from "./tanstack";
import type { SocketEvent, WebSocketLike } from "./transport";

class SilentSocket implements WebSocketLike {
  readyState = 1;
  readonly sent: string[] = [];
  private readonly listeners = new Map<string, ((event: SocketEvent) => void)[]>();
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.readyState = 3;
  }
  addEventListener(type: string, listener: (event: SocketEvent) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  removeEventListener(): void {
    return;
  }
  emit(type: string, event: SocketEvent): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }
}

const articleType: ContentTypeDefinition = {
  id: "018f2b6a-7a0a-7000-8000-000000000001",
  key: "article",
  name: "記事",
  source: "user",
  version: 1,
  fields: [{ key: "title", type: "text", required: true }],
};

const noteType: ContentTypeDefinition = {
  ...articleType,
  id: "018f2b6a-7a0a-7000-8000-000000000002",
  key: "note",
  name: "ノート",
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
    updatedAt: "2026-07-13T00:00:00Z",
    updatedBy: "u1",
    ...overrides,
  };
}

describe("CollectionRegistry", () => {
  let socket: SilentSocket;
  let engine: SyncEngine;
  let registry: CollectionRegistry;

  beforeEach(async () => {
    socket = new SilentSocket();
    engine = new SyncEngine({ connect: async () => socket, storage: new MemorySyncStorage() });
    registry = new CollectionRegistry(engine);
    await engine.start();
  });

  it("creates one collection per content type at runtime", () => {
    registry.sync([articleType, noteType]);
    expect(registry.keys().sort()).toEqual(["article", "note"]);
    expect(registry.get("article")).toBeDefined();
    expect(registry.get("nope")).toBeUndefined();
  });

  it("keeps the existing collection when a type is re-delivered", () => {
    registry.sync([articleType]);
    const first = registry.get("article");
    registry.sync([articleType, noteType]);
    expect(registry.get("article")).toBe(first);
  });

  it("writes synced records into the collection and marks it ready", () => {
    registry.sync([articleType]);
    registry.markReady();
    registry.applyStoreChange({ kind: "upsert", record: record() });

    const collection = registry.get("article");
    expect(collection?.get("r1")?.input["title"]).toBe("hello");
    expect(collection?.status).not.toBe("loading");
  });

  it("removes a record from the collection on a tombstone", () => {
    registry.sync([articleType]);
    registry.markReady();
    registry.applyStoreChange({ kind: "upsert", record: record() });
    registry.applyStoreChange({ kind: "delete", recordId: "r1", typeKey: "article" });
    expect(registry.get("article")?.get("r1")).toBeUndefined();
  });

  it("ignores store changes for an unknown type", () => {
    registry.sync([articleType]);
    expect(() =>
      registry.applyStoreChange({ kind: "upsert", record: record({ type: "unknown" }) }),
    ).not.toThrow();
  });

  it("pushes an optimistic insert and merges the acked record before resolving", async () => {
    registry.sync([articleType]);
    registry.markReady();
    const pushSpy = vi.spyOn(engine, "push");

    const collection = registry.get("article");
    const tx = collection?.insert(record({ id: "new", input: { title: "draft" } }));

    await vi.waitFor(() => expect(pushSpy).toHaveBeenCalledTimes(1));
    const pushed = pushSpy.mock.calls[0]?.[0];
    expect(pushed?.typeKey).toBe("article");
    expect(pushed?.recordId).toBe("new");
    expect(pushed?.op).toBe("upsert");

    // ack が返ると確定レコードが同期状態にマージされ、Promise が解決する
    socket.emit("message", {
      data: JSON.stringify({
        type: "ack",
        changeId: pushed?.changeId,
        result: { ok: true, record: record({ id: "new", seq: 7, input: { title: "confirmed" } }) },
      }),
    });

    await tx?.isPersisted.promise;
    expect(collection?.get("new")?.input["title"]).toBe("confirmed");
  });

  it("rolls back the optimistic overlay when the server rejects the change", async () => {
    registry.sync([articleType]);
    registry.markReady();
    const pushSpy = vi.spyOn(engine, "push");

    const collection = registry.get("article");
    const tx = collection?.insert(record({ id: "bad", input: { title: "" } }));
    await vi.waitFor(() => expect(pushSpy).toHaveBeenCalledTimes(1));
    const changeId = pushSpy.mock.calls[0]?.[0]?.changeId;

    socket.emit("message", {
      data: JSON.stringify({
        type: "ack",
        changeId,
        result: { ok: false, code: "validation_failed", message: "title: required" },
      }),
    });

    await expect(tx?.isPersisted.promise).rejects.toBeDefined();
    expect(collection?.get("bad")).toBeUndefined();
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm --filter @plyrs/sync-client test`
Expected: FAIL — `Cannot find module './tanstack'`

- [ ] **Step 3: 実装を書く**

`packages/sync-client/src/tanstack.ts`:

```ts
import type { ContentTypeDefinition } from "@plyrs/metamodel";
import type { ClientChange, SyncRecord } from "@plyrs/sync-protocol";
import { createCollection, type Collection } from "@tanstack/db";
import { v7 as uuidv7 } from "uuid";
import type { SyncEngine } from "./engine";
import type { StoreChange } from "./store";

// @tanstack/db は BETA（0.6.x）。破壊的変更の影響をこの1ファイルに閉じ込める。
// エンジンコア（engine/store/outbox）は tanstack-db に一切依存しない。

interface SyncHandles {
  begin: () => void;
  write: (message: { type: "insert" | "update" | "delete"; value: SyncRecord }) => void;
  commit: () => void;
  markReady: () => void;
}

interface Entry {
  collection: Collection<SyncRecord, string>;
  handles: SyncHandles | null;
}

function toChange(
  typeKey: string,
  record: SyncRecord,
  op: ClientChange["op"],
  previous: SyncRecord | undefined,
): ClientChange {
  const changedFields =
    op === "delete"
      ? []
      : [...new Set([...Object.keys(record.input), ...Object.keys(previous?.input ?? {})])].filter(
          (key) => JSON.stringify(record.input[key]) !== JSON.stringify(previous?.input[key]),
        );
  const baseFieldVersions: Record<string, number> = {};
  for (const key of changedFields) {
    const version = previous?.fieldVersions[key];
    if (version !== undefined) {
      baseFieldVersions[key] = version;
    }
  }
  return {
    changeId: uuidv7(),
    recordId: record.id,
    typeKey,
    op,
    input: op === "delete" ? {} : record.input,
    changedFields,
    baseFieldVersions,
    status: record.status,
  };
}

export class CollectionRegistry {
  private readonly entries = new Map<string, Entry>();
  private ready = false;

  constructor(private readonly engine: SyncEngine) {}

  sync(types: ContentTypeDefinition[]): void {
    for (const type of types) {
      if (this.entries.has(type.key)) {
        continue;
      }
      this.entries.set(type.key, this.createEntry(type.key));
    }
  }

  get(typeKey: string): Collection<SyncRecord, string> | undefined {
    return this.entries.get(typeKey)?.collection;
  }

  keys(): string[] {
    return [...this.entries.keys()];
  }

  markReady(): void {
    this.ready = true;
    for (const entry of this.entries.values()) {
      entry.handles?.markReady();
    }
  }

  applyStoreChange(change: StoreChange): void {
    const typeKey = change.kind === "upsert" ? change.record.type : change.typeKey;
    const entry = this.entries.get(typeKey);
    const handles = entry?.handles;
    if (entry === undefined || handles === null || handles === undefined) {
      return;
    }
    handles.begin();
    if (change.kind === "upsert") {
      const exists = entry.collection.get(change.record.id) !== undefined;
      handles.write({ type: exists ? "update" : "insert", value: change.record });
    } else {
      const existing = entry.collection.get(change.recordId);
      if (existing !== undefined) {
        handles.write({ type: "delete", value: existing });
      }
    }
    handles.commit();
  }

  private createEntry(typeKey: string): Entry {
    const entry: Entry = { collection: undefined as unknown as Collection<SyncRecord, string>, handles: null };

    const push = async (record: SyncRecord, op: ClientChange["op"]): Promise<void> => {
      const previous = this.engine.store.get(record.id);
      const change = toChange(typeKey, record, op, previous);
      // 楽観的オーバーレイはハンドラの解決で落ちるため、確定レコードを
      // 同期状態にマージしてから resolve する（ちらつき防止）。
      // ack が {ok:false} なら SyncRejectedError が throw され、tanstack-db が自動ロールバックする。
      const confirmed = await this.engine.push(change);
      this.applyStoreChange(
        confirmed.deletedAt === null
          ? { kind: "upsert", record: confirmed }
          : { kind: "delete", recordId: confirmed.id, typeKey },
      );
    };

    entry.collection = createCollection<SyncRecord, string>({
      getKey: (row) => row.id,
      sync: {
        rowUpdateMode: "full",
        sync: (handles: SyncHandles) => {
          entry.handles = handles;
          if (this.ready) {
            handles.markReady();
          }
          return () => {
            entry.handles = null;
          };
        },
      },
      onInsert: async ({ transaction }) => {
        for (const mutation of transaction.mutations) {
          await push(mutation.modified as SyncRecord, "upsert");
        }
      },
      onUpdate: async ({ transaction }) => {
        for (const mutation of transaction.mutations) {
          await push(mutation.modified as SyncRecord, "upsert");
        }
      },
      onDelete: async ({ transaction }) => {
        for (const mutation of transaction.mutations) {
          await push(mutation.original as SyncRecord, "delete");
        }
      },
    });

    return entry;
  }
}
```

`packages/sync-client/src/index.ts` に追記:

```ts
export { CollectionRegistry } from "./tanstack";
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm --filter @plyrs/sync-client test` → PASS（34件）
Run: `pnpm --filter @plyrs/sync-client typecheck` → エラーなし

**tanstack-db の実 API がこの形（`createCollection` の `sync.sync(handles)` / `onInsert({transaction})` / `Collection.get` / `transaction.isPersisted.promise` / `collection.status`）と食い違う場合**: 型エラーの実物を見て最小限に合わせる（`@ts-expect-error` は禁止）。BETA ゆえの差異は想定内なので、**合わせた内容を報告に明記**すること。API が根本的に違って接続できない場合は BLOCKED で報告。

- [ ] **Step 5: フォーマット・lint・コミット**

```bash
pnpm format && pnpm lint
git add packages/sync-client/src/tanstack.ts packages/sync-client/src/tanstack.test.ts packages/sync-client/src/index.ts
git commit -m "feat: add the tanstack-db adapter with runtime collections"
```

---

### Task 6: ブラウザトランスポート（partysocket）

**Files:**
- Create: `packages/sync-client/src/browser.ts`
- Test: `packages/sync-client/src/browser.test.ts`

**Interfaces:**
- Consumes: `ConnectFn` / `WebSocketLike`（Task 1）、`SYNC_SUBPROTOCOL` / `TOKEN_PROTOCOL_PREFIX` / `CLOSE_CODES` / `KEEPALIVE_PING`（sync-protocol）、partysocket の `WebSocket`
- Produces:
  - `interface BrowserTransportOptions { url: string; getToken: () => Promise<string>; keepaliveMs?: number; WebSocketImpl?: typeof PartySocketWebSocket }`
  - `createBrowserConnect(options: BrowserTransportOptions): ConnectFn`

**規約:**

- `protocols` は**非同期プロバイダ**にする（`async () => [SYNC_SUBPROTOCOL, TOKEN_PROTOCOL_PREFIX + await getToken()]`）— 再接続のたびに最新トークンが載る
- `shouldReconnectOnClose: (event) => event.code !== CLOSE_CODES.tokenExpired && event.code !== CLOSE_CODES.blocked` — **4001/4003 では partysocket の自動再接続を止め、エンジンの再接続ロジックに任せる**（4001 は refreshToken 後に張り直し、4003 は終端）
- keepalive: partysocket にハートビートは無い。**エンジン用に `keepaliveMs`（既定 30000）ごとに `KEEPALIVE_PING` を送る**インターバルを張り、close で止める（サーバーは auto-response で DO を起こさずに応答する）
- `maxEnqueuedMessages: 0`（未接続時のバッファはアウトボックスが担うため、partysocket 側では持たない）

- [ ] **Step 1: 失敗するテストを書く**

`packages/sync-client/src/browser.test.ts`:

```ts
import { CLOSE_CODES, KEEPALIVE_PING, SYNC_SUBPROTOCOL } from "@plyrs/sync-protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBrowserConnect } from "./browser";

interface FakeInstance {
  url: string;
  protocols: unknown;
  options: Record<string, unknown>;
  sent: string[];
  listeners: Map<string, ((event: unknown) => void)[]>;
  readyState: number;
  send(data: string): void;
  close(): void;
  addEventListener(type: string, listener: (event: unknown) => void): void;
  removeEventListener(type: string, listener: (event: unknown) => void): void;
  emit(type: string, event: unknown): void;
}

const instances: FakeInstance[] = [];

function FakeWebSocket(this: FakeInstance, url: string, protocols: unknown, options: Record<string, unknown>) {
  this.url = url;
  this.protocols = protocols;
  this.options = options;
  this.sent = [];
  this.listeners = new Map();
  this.readyState = 1;
  this.send = (data: string) => this.sent.push(data);
  this.close = () => {
    this.readyState = 3;
    this.emit("close", { code: 1000 });
  };
  this.addEventListener = (type: string, listener: (event: unknown) => void) => {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  };
  this.removeEventListener = () => undefined;
  this.emit = (type: string, event: unknown) => {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  };
  instances.push(this);
  // 接続確立を即時に通知する
  queueMicrotask(() => this.emit("open", {}));
}

afterEach(() => {
  instances.length = 0;
  vi.useRealTimers();
});

describe("createBrowserConnect", () => {
  it("offers the sync subprotocol with a freshly fetched token", async () => {
    const getToken = vi.fn(async () => "jwt-1");
    const connect = createBrowserConnect({
      url: "wss://api.example/v1/t/t1/sync",
      getToken,
      WebSocketImpl: FakeWebSocket as never,
    });

    await connect();
    const created = instances[0];
    expect(created?.url).toBe("wss://api.example/v1/t/t1/sync");
    const protocols = await (created?.protocols as () => Promise<string[]>)();
    expect(protocols).toEqual([SYNC_SUBPROTOCOL, "token.jwt-1"]);
    expect(getToken).toHaveBeenCalled();
  });

  it("blocks partysocket's auto-reconnect on 4001 and 4003", async () => {
    const connect = createBrowserConnect({
      url: "wss://api.example/sync",
      getToken: async () => "jwt",
      WebSocketImpl: FakeWebSocket as never,
    });
    await connect();
    const shouldReconnect = instances[0]?.options["shouldReconnectOnClose"] as (
      event: { code: number },
    ) => boolean;

    expect(shouldReconnect({ code: CLOSE_CODES.tokenExpired })).toBe(false);
    expect(shouldReconnect({ code: CLOSE_CODES.blocked })).toBe(false);
    expect(shouldReconnect({ code: 1006 })).toBe(true);
  });

  it("sends keepalive pings and stops on close", async () => {
    vi.useFakeTimers();
    const connect = createBrowserConnect({
      url: "wss://api.example/sync",
      getToken: async () => "jwt",
      keepaliveMs: 1000,
      WebSocketImpl: FakeWebSocket as never,
    });
    const socket = await connect();
    const created = instances[0];

    vi.advanceTimersByTime(2500);
    expect(created?.sent.filter((entry) => entry === KEEPALIVE_PING)).toHaveLength(2);

    socket.close();
    vi.advanceTimersByTime(5000);
    expect(created?.sent.filter((entry) => entry === KEEPALIVE_PING)).toHaveLength(2);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm --filter @plyrs/sync-client test`
Expected: FAIL — `Cannot find module './browser'`

- [ ] **Step 3: 実装を書く**

`packages/sync-client/src/browser.ts`:

```ts
import {
  CLOSE_CODES,
  KEEPALIVE_PING,
  SYNC_SUBPROTOCOL,
  TOKEN_PROTOCOL_PREFIX,
} from "@plyrs/sync-protocol";
import { WebSocket as ReconnectingWebSocket } from "partysocket";
import type { ConnectFn, WebSocketLike } from "./transport";

const DEFAULT_KEEPALIVE_MS = 30_000;

export interface BrowserTransportOptions {
  url: string;
  getToken: () => Promise<string>;
  keepaliveMs?: number;
  // テスト用の差し替え口（本番は partysocket）
  WebSocketImpl?: typeof ReconnectingWebSocket;
}

// ブラウザ用トランスポート。トークンは Sec-WebSocket-Protocol で運ぶ（WS に
// Authorization ヘッダを付けられないため）。再接続のたびに最新トークンを載せる。
export function createBrowserConnect(options: BrowserTransportOptions): ConnectFn {
  const Impl = options.WebSocketImpl ?? ReconnectingWebSocket;
  const keepaliveMs = options.keepaliveMs ?? DEFAULT_KEEPALIVE_MS;

  return async () => {
    const socket = new Impl(
      options.url,
      async () => [SYNC_SUBPROTOCOL, `${TOKEN_PROTOCOL_PREFIX}${await options.getToken()}`],
      {
        // 4001（失効）/ 4003（BAN）はエンジンが処理する。partysocket の自動再接続は止める。
        shouldReconnectOnClose: (event: { code: number }) =>
          event.code !== CLOSE_CODES.tokenExpired && event.code !== CLOSE_CODES.blocked,
        // 未接続時のバッファはアウトボックスが持つ
        maxEnqueuedMessages: 0,
      },
    ) as unknown as WebSocketLike & { addEventListener: WebSocketLike["addEventListener"] };

    // partysocket にハートビートは無い。サーバーは auto-response で DO を起こさず pong を返す。
    const timer = setInterval(() => {
      socket.send(KEEPALIVE_PING);
    }, keepaliveMs);
    socket.addEventListener("close", () => clearInterval(timer));

    return socket;
  };
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm --filter @plyrs/sync-client test` → PASS（37件）
Run: `pnpm --filter @plyrs/sync-client typecheck` → エラーなし

partysocket の型と `WebSocketLike` が食い違う場合は、`browser.ts` 内に最小限の橋渡しを書く（`@ts-expect-error` は禁止）。内容は報告に明記。

- [ ] **Step 5: フォーマット・lint・コミット**

```bash
pnpm format && pnpm lint
git add packages/sync-client/src/browser.ts packages/sync-client/src/browser.test.ts
git commit -m "feat: add the partysocket browser transport with keepalive"
```

---

### Task 7: 実 DO とのエンドツーエンド統合テスト

**Files:**
- Modify: `apps/api/package.json`（`@plyrs/sync-client` を devDependency に追加）
- Test: `apps/api/test/sync-client-e2e.test.ts`

**Interfaces:**
- Consumes: `SyncEngine` / `MemorySyncStorage`（sync-client）、`openSyncSocket`（既存の `apps/api/test/ws-helpers.ts`）、TenantDO
- Produces: エンジンコアが**実 DO**と本当に会話できることの証明（フェイクではない）

`ConnectFn` は `openSyncSocket` が返す workerd の実ソケットをそのまま返す（`WebSocketLike` を構造的に満たす）。partysocket は使わない（コンストラクタ注入を要求するため）。

- [ ] **Step 1: 依存を追加**

`apps/api/package.json` の `devDependencies` に追記:

```json
    "@plyrs/sync-client": "workspace:*",
```

- [ ] **Step 2: 失敗するテストを書く**

`apps/api/test/sync-client-e2e.test.ts`:

```ts
import { env } from "cloudflare:workers";
import { MemorySyncStorage, SyncEngine } from "@plyrs/sync-client";
import type { ClientChange } from "@plyrs/sync-protocol";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { articleType, auth, uuid, validArticleInput } from "./fixtures";
import { openSyncSocket } from "./ws-helpers";

const TENANT = "018f2b6a-7a0a-7000-8000-0000000000f1";

function freshStub() {
  return env.TENANT_DO.get(env.TENANT_DO.idFromName(crypto.randomUUID()));
}

function socketAuth(userId: string) {
  return {
    userId,
    role: "editor" as const,
    tenantId: TENANT,
    exp: Math.floor(Date.now() / 1000) + 900,
  };
}

function change(recordId: string, overrides: Partial<ClientChange> = {}): ClientChange {
  return {
    changeId: crypto.randomUUID(),
    recordId,
    typeKey: "article",
    op: "upsert",
    input: validArticleInput(),
    changedFields: Object.keys(validArticleInput()),
    baseFieldVersions: {},
    ...overrides,
  };
}

describe("sync client against the real DO", () => {
  let stub: ReturnType<typeof freshStub>;

  beforeEach(async () => {
    stub = freshStub();
    await stub.registerContentType(articleType(), auth("admin"));
  });

  function engineFor(userId: string) {
    return new SyncEngine({
      connect: async () => {
        const { socket } = await openSyncSocket(stub, socketAuth(userId));
        return socket;
      },
      storage: new MemorySyncStorage(),
    });
  }

  it("bootstraps from the server and receives the content types", async () => {
    await stub.writeRecord(
      "article",
      { recordId: uuid(60), input: validArticleInput() },
      auth("seed"),
    );

    const types: string[] = [];
    const engine = new SyncEngine({
      connect: async () => (await openSyncSocket(stub, socketAuth("editor-1"))).socket,
      storage: new MemorySyncStorage(),
      onContentTypes: (received) => types.push(...received.map((type) => type.key)),
    });

    await engine.start();
    await vi.waitFor(() => expect(engine.status).toBe("ready"), { timeout: 5000 });

    expect(types).toContain("article");
    expect(engine.store.get(uuid(60))?.input["title"]).toBe("こんにちは");
    // relations が input に統合されて届く
    expect(engine.store.get(uuid(60))?.input["authors"]).toEqual(validArticleInput()["authors"]);
    expect(engine.checkpoint).toBeGreaterThan(0);
    await engine.stop();
  });

  it("pushes a record and resolves with the server's confirmed version", async () => {
    const engine = engineFor("editor-1");
    await engine.start();
    await vi.waitFor(() => expect(engine.status).toBe("ready"), { timeout: 5000 });

    const confirmed = await engine.push(change(uuid(61)));
    expect(confirmed.id).toBe(uuid(61));
    expect(confirmed.seq).toBeGreaterThan(0);
    expect(confirmed.updatedBy).toBe("editor-1");
    expect(engine.store.get(uuid(61))?.input["title"]).toBe("こんにちは");
    await engine.stop();
  });

  it("rejects a push the server refuses (validation)", async () => {
    const engine = engineFor("editor-1");
    await engine.start();
    await vi.waitFor(() => expect(engine.status).toBe("ready"), { timeout: 5000 });

    const invalid = change(uuid(62), {
      input: { ...validArticleInput(), title: "" },
      changedFields: ["title"],
    });
    await expect(engine.push(invalid)).rejects.toMatchObject({ code: "validation_failed" });
    await engine.stop();
  });

  it("receives another client's change over the socket", async () => {
    const engine = engineFor("editor-1");
    await engine.start();
    await vi.waitFor(() => expect(engine.status).toBe("ready"), { timeout: 5000 });

    await stub.writeRecord(
      "article",
      { recordId: uuid(63), input: { ...validArticleInput(), slug: "other" } },
      auth("editor-2"),
    );

    await vi.waitFor(() => expect(engine.store.get(uuid(63))).toBeDefined(), { timeout: 5000 });
    expect(engine.store.get(uuid(63))?.updatedBy).toBe("editor-2");
    await engine.stop();
  });

  it("resumes from its checkpoint on reconnect and only receives the delta", async () => {
    const storage = new MemorySyncStorage();
    const first = new SyncEngine({
      connect: async () => (await openSyncSocket(stub, socketAuth("editor-1"))).socket,
      storage,
    });
    await first.start();
    await vi.waitFor(() => expect(first.status).toBe("ready"), { timeout: 5000 });
    await first.push(change(uuid(64)));
    const checkpoint = first.checkpoint;
    await first.stop();

    // 切断中にサーバー側で1件増える
    await stub.writeRecord(
      "article",
      { recordId: uuid(65), input: { ...validArticleInput(), slug: "while-away" } },
      auth("editor-2"),
    );

    const resumed = new SyncEngine({
      connect: async () => (await openSyncSocket(stub, socketAuth("editor-1"))).socket,
      storage,
    });
    await resumed.start();
    await vi.waitFor(() => expect(resumed.status).toBe("ready"), { timeout: 5000 });

    // checkpoint 以降だけが届く（切断中の変更は入り、以前の record は届かない）
    expect(resumed.checkpoint).toBeGreaterThan(checkpoint);
    expect(resumed.store.get(uuid(65))).toBeDefined();
    expect(resumed.store.get(uuid(64))).toBeUndefined();
    await resumed.stop();
  });
});
```

- [ ] **Step 3: テストが失敗することを確認**

Run: `pnpm install && pnpm --filter @plyrs/api test`
Expected: FAIL — `@plyrs/sync-client` の解決エラー（install 前）か、エンジンが実ソケットで期待どおり動かない箇所

- [ ] **Step 4: GREEN にする**

実装の修正が必要なら **sync-client 側**を直す（テストを緩めない）。実 DO との差異（メッセージ順序・タイミング）が原因なら、エンジンのイベント処理を直す。

Run: `pnpm --filter @plyrs/api test` → 全 PASS（既存 103 + 新規 5 = 108件目安）
Run: `pnpm --filter @plyrs/api typecheck` → エラーなし

- [ ] **Step 5: フォーマット・lint・コミット**

```bash
pnpm format && pnpm lint
git add pnpm-lock.yaml apps/api/package.json apps/api/test/sync-client-e2e.test.ts packages/sync-client
git commit -m "test: verify the sync client against the real tenant DO"
```

---

### Task 8: 全体整合の最終確認

**Files:**
- Modify: なし（確認のみ。差分が出た場合のみ修正をコミット）

- [ ] **Step 1: ルート全チェック**

Run: `pnpm lint && pnpm format:check && pnpm typecheck && pnpm test`
Expected: すべて exit 0・警告ゼロ。metamodel 46 / db 4 / sync-protocol 15 / sync-client 37目安 / api 108目安、全 PASS

- [ ] **Step 2: クリーンツリー確認**

Run: `git status --short --untracked-files=no`
Expected: 出力なし

- [ ] **Step 3: 差分が出た場合のみ**

修正し、内容に応じた `chore:`/`fix:` コミットを作る（対象パスのみ `git add`）。

---

## Self-Review 結果

- **Spec coverage:** ロードマップ Phase 4 行のクライアント側 — partysocket（Task 6）、tanstack-db コレクションの実行時生成（Task 5）、同期エンジン（Task 4）。§7 の 4b 向けワイヤ契約 — 重複配信の冪等適用（Task 2 の RecordStore、seq 比較）、checkpoint 前進規則（Task 4、`complete: true` 後に前進）、サーバーリセット検知（Task 4、`serverSeq < checkpoint` で全再同期）、4001 → refreshToken → checkpoint 付き再接続（Task 4・6）、4003 → 終端（Task 4・6）、keepalive 定数（Task 6）、conflict ack の提示（Task 1 の `SyncRejectedError` + Task 5 のロールバック）、空 many-relation のキー省略（`input` をそのまま扱うため自然に満たす）、`MAX_CHANGES_PER_PUSH`（Task 4 の flush でバッチ分割）。永続化はインターフェース + メモリ実装（Global Constraints で Phase 6 送りを明記）。
- **Placeholder scan:** TBD/TODO なし。BETA 由来の API 差異は Task 5/6 に具体的な対処（最小限の追随・報告義務・BLOCKED 条件）を明記。
- **Type consistency:** `WebSocketLike` / `ConnectFn` / `SocketEvent`（Task 1）↔ Task 4 のエンジン ↔ Task 6 のブラウザ実装 ↔ Task 7 の workerd 実ソケット、`StoreChange`（Task 2）↔ Task 4 の `onStoreChange` ↔ Task 5 の `applyStoreChange`、`SyncStorage`（Task 1）↔ Task 3 の Outbox ↔ Task 4、`SyncRejectedError`（Task 1）↔ Task 3 ↔ Task 5 のロールバック — 整合を確認済み。
- **実行者への注意:** テスト件数は目安。全件 PASS が基準。Task 5/6 は BETA/外部ライブラリの実 API に合わせる裁量を明示的に与えている（ただし `@ts-expect-error` 禁止・報告義務あり）。
