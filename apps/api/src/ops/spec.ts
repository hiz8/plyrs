import type { z } from "zod";
import type { Operation } from "../auth/permissions";

// design-spec 16.4(論点 B1): 操作の宣言に使う型と補助関数。catalog.ts(一覧)と read.ts などの
// 操作モジュール(宣言 + 実装)の両方から参照されるので、どちらにも依存しないこのファイルに置く
// (read.ts → catalog.ts → read.ts の循環 import は評価順によって TDZ エラーになる)。

// 経路(用語集「経路(via)」)の列挙は @plyrs/sync-protocol が正本(履歴・判定モードと共通。M2-3a)
import type { Via } from "@plyrs/sync-protocol";
export type { Via };

// 名前は `Operation`(権限の語)と衝突するため OpSpec
export interface OpSpec<I extends z.ZodType = z.ZodType, O extends z.ZodType = z.ZodType> {
  name: string; // 例 "record_get"。MCP のツール名にそのまま使う
  title: string; // 人向けの短い名前(日本語)
  description: string; // ツール説明。エージェントが読む(16.11 の執筆ガイドは M2-8)
  input: I;
  output: O;
  requires: Operation; // 必要な Operation。スコープ名と同じ(16.3)
  via: readonly Via[]; // 提供する経路
  hints: { readOnly: boolean; destructive: boolean; idempotent: boolean; openWorld: boolean };
  // tools/list の ttlMs / cacheScope(仕様 2026-07-28)。null は付けない
  cache: { ttlMs: number; cacheScope: "public" | "private" } | null;
  // 公開 URL の組み立てにテナントの slug が要る操作(record_publish)。REST の入口はこのときだけ
  // D1 から slug を引く(M2-4)
  needsTenantSlug?: true;
  // DO の invoke ではなく Worker で実行する操作(M4-4 / M4-5)。非同期の処理(SHA-256・外部 fetch・R2)が
  // 要る操作で、DO の同期ハンドラを持たない。実装は mcp/worker-ops.ts
  runsIn?: "worker";
}

export function defineOperation<I extends z.ZodType, O extends z.ZodType>(
  spec: OpSpec<I, O>,
): OpSpec<I, O> {
  return spec;
}
