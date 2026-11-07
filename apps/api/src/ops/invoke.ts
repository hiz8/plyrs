import type { Operation } from "../auth/permissions";
import { requireOperation, type AuthContext, type McpAuth } from "../do/authorize";
import { findOperation, OPERATIONS, type OpSpec } from "./catalog";
import { HISTORY_HANDLERS } from "./history";
import { PROPOSAL_HANDLERS } from "./proposals";
import { READ_HANDLERS, type OpContext, type OpFailure } from "./read";
import { SEARCH_HANDLERS } from "./search";
import { WRITE_HANDLERS } from "./write";

// 操作の失敗はここで表現し、HTTP や JSON-RPC のエラーにしない(design-spec 16.7 の「業務エラー」層)。
// code は入口の判定(unknown_operation / invalid_input / forbidden / insufficient_scope)と、各操作の
// 業務エラー(not_found / conflict / already_exists / unsupported_markdown / validation_failed /
// record_deleted / unique_violation / invalid_status / unknown_type / not_published / proposal_not_open、モジュール拒否
// `${moduleId}:${reason}`)。モジュール拒否を通すため string を含む(WriteErrorCode と同じ扱い)
export type InvokeErrorCode =
  | "unknown_operation"
  | "invalid_input"
  | "forbidden"
  | "insufficient_scope"
  | "not_found"
  | "conflict"
  | "already_exists"
  | "unsupported_markdown"
  | "validation_failed"
  | "record_deleted"
  | "unique_violation"
  | "invalid_status"
  | "unknown_type"
  | "not_published"
  // 16.8(M5c): 採用・却下済みの提案への採用・却下
  | "proposal_not_open"
  | (string & {});

// M4-6: DO の invoke が載せる計測値(操作が読み書きした行数)。Worker で実行する操作には無い
export interface InvokeMeter {
  rowsRead: number;
  rowsWritten: number;
}

export type InvokeResult =
  | { ok: true; output: unknown; meter?: InvokeMeter }
  | {
      ok: false;
      code: InvokeErrorCode;
      message: string;
      issues?: unknown;
      details?: unknown;
      meter?: InvokeMeter;
    };

export type OpHandler = (ctx: OpContext, input: never) => { ok: true; output: unknown } | OpFailure;

// 宣言(OPERATIONS)と実装(HANDLERS)は名前文字列で対応する。片方だけ足し忘れると unknown_operation
// として静かに失敗するので、モジュール読み込み時に対応を確かめる(export はテストのため)
export const HANDLERS: Readonly<Record<string, OpHandler>> = {
  ...READ_HANDLERS,
  ...SEARCH_HANDLERS,
  ...HISTORY_HANDLERS,
  ...WRITE_HANDLERS,
  ...PROPOSAL_HANDLERS,
};

// Worker で実行する操作(runsIn: "worker")は DO のハンドラを持たない。DO で呼ばれたら unknown_operation
for (const spec of OPERATIONS) {
  if (spec.runsIn !== "worker" && HANDLERS[spec.name] === undefined) {
    throw new Error(`operation ${spec.name} is declared in the catalog but has no handler`);
  }
}

export function hasScopes(auth: AuthContext | McpAuth): auth is McpAuth {
  return Array.isArray((auth as McpAuth).scopes);
}

// 16.3: MCP の認可コンテキストでスコープが足りなければ、その操作が要するスコープ。足りるか、MCP でない
// (AuthContext。スコープを持たない)なら null。MCP の入口(route.ts)、Worker の操作(worker-ops.ts)、
// DO の runOperation の 3 か所で同じ判定を使う
export function missingScope(auth: AuthContext | McpAuth, spec: OpSpec): Operation | null {
  return hasScopes(auth) && !auth.scopes.includes(spec.requires) ? spec.requires : null;
}

// 16.3: 実効権限 = スコープ ∩ ロール。スコープは権限を絞るだけで増やさない。
// (1) MCP の認可コンテキスト(scopes あり)なら spec.requires がスコープに含まれるか、
// (2) ロールで requireOperation(record:read の判定はここが最初)、(3) Zod の parse、(4) 実装。
export function runOperation(
  spec: OpSpec,
  handler: OpHandler,
  ctx: OpContext,
  input: unknown,
  auth: AuthContext | McpAuth,
): InvokeResult {
  const missing = missingScope(auth, spec);
  if (missing !== null) {
    return {
      ok: false,
      code: "insufficient_scope",
      message: `token scope does not include ${missing}`,
    };
  }
  const denial = requireOperation(auth, spec.requires);
  if (denial !== null) {
    return denial;
  }
  const parsed = spec.input.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      code: "invalid_input",
      message: "input does not match the operation schema",
      issues: parsed.error.issues,
    };
  }
  return handler(ctx, parsed.data as never);
}

// DO の invoke RPC の本体。テナント境界(auth.tenantId と DO の do_config.tenant_id)の照合は
// 呼び出し側(tenant-do.ts)が ctx.tenantId を渡し、ここで判定する(Review Focus 3)。
export function invokeOperation(
  name: string,
  ctx: OpContext,
  input: unknown,
  auth: AuthContext | McpAuth,
): InvokeResult {
  const spec = findOperation(name);
  const handler = HANDLERS[name];
  if (spec === undefined || handler === undefined) {
    return { ok: false, code: "unknown_operation", message: `unknown operation: ${name}` };
  }
  if (auth.tenantId !== undefined && ctx.tenantId !== null && auth.tenantId !== ctx.tenantId) {
    return { ok: false, code: "forbidden", message: "auth context belongs to another tenant" };
  }
  return runOperation(spec, handler, ctx, input, auth);
}
