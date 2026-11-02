import { HISTORY_OPERATIONS } from "./history";
import { READ_OPERATIONS } from "./read";
import { SEARCH_OPERATIONS } from "./search";
import { WRITE_OPERATIONS } from "./write";
import type { OpSpec } from "./spec";

export { defineOperation, type OpSpec, type Via } from "./spec";

// design-spec 16.4(論点 B1): 操作カタログ。操作名・入出力の Zod・必要な Operation・説明文・
// 提供する経路を 1 か所で宣言し、MCP のツール(tools/list)・REST・将来の CLI をここから生成する。
// 実行は DO の RPC 1 本 `invoke(op, input, auth)` に集約する(操作ごとに RPC を増やすと
// rpc-unwrap.ts が対処している union の潰れが操作ごとに再発するため)。
// 型と defineOperation は spec.ts にある(操作モジュールはそちらだけを import する)。

// 宣言順 = tools/list の順序(決定的。Review Focus 6)。M2 以降は書き込み・履歴の操作をここに足す
export const OPERATIONS: readonly OpSpec[] = [
  ...READ_OPERATIONS,
  ...SEARCH_OPERATIONS,
  ...HISTORY_OPERATIONS,
  ...WRITE_OPERATIONS,
];

export function findOperation(name: string): OpSpec | undefined {
  return OPERATIONS.find((op) => op.name === name);
}
