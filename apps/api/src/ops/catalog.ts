import type { z } from "zod";
import type { Operation } from "../auth/permissions";
import { READ_OPERATIONS } from "./read";

// design-spec 16.4(論点 B1): 操作カタログ。操作名・入出力の Zod・必要な Operation・説明文・
// 提供する経路を 1 か所で宣言し、MCP のツール(tools/list)・REST・将来の CLI をここから生成する。
// 実行は DO の RPC 1 本 `invoke(op, input, auth)` に集約する(操作ごとに RPC を増やすと
// rpc-unwrap.ts が対処している union の潰れが操作ごとに再発するため)。

// 経路(用語集「経路(via)」): 書き込み・読み取りがどこから来たか。トークンの種別(tokenKind)とは別
export type Via = "sync" | "mcp" | "rest";

// 名前は `Operation`(権限の語)と衝突するため OpSpec
export interface OpSpec<I extends z.ZodType = z.ZodType, O extends z.ZodType = z.ZodType> {
  name: string; // 例 "record_get"。MCP のツール名にそのまま使う
  title: string; // 人向けの短い名前(日本語)
  description: string; // ツール説明。エージェントが読む(16.11 の執筆ガイドは M2-8)
  input: I;
  output: O;
  requires: Operation; // 必要な Operation。スコープ名と同じ(16.3)
  via: readonly Via[]; // 提供する経路
  hints: { readOnly: boolean; destructive: boolean; idempotent: boolean; openWorld: false };
  // tools/list の ttlMs / cacheScope(仕様 2026-07-28)。null は付けない
  cache: { ttlMs: number; cacheScope: "public" | "private" } | null;
}

export function defineOperation<I extends z.ZodType, O extends z.ZodType>(
  spec: OpSpec<I, O>,
): OpSpec<I, O> {
  return spec;
}

// 宣言順 = tools/list の順序(決定的。Review Focus 6)。M2 以降は書き込み・履歴の操作をここに足す
export const OPERATIONS: readonly OpSpec[] = [...READ_OPERATIONS];

export function findOperation(name: string): OpSpec | undefined {
  return OPERATIONS.find((op) => op.name === name);
}
