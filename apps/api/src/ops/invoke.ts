import { requireOperation, type AuthContext, type McpAuth } from "../do/authorize";
import type { OpSpec } from "./catalog";
import { findOperation } from "./catalog";
import { READ_HANDLERS, type OpContext, type OpFailure } from "./read";

// 操作の失敗はここで表現し、HTTP や JSON-RPC のエラーにしない(design-spec 16.7 の「業務エラー」層)。
export type InvokeResult =
  | { ok: true; output: unknown }
  | {
      ok: false;
      code:
        | "unknown_operation"
        | "invalid_input"
        | "forbidden"
        | "insufficient_scope"
        | "not_found";
      message: string;
      issues?: unknown;
    };

export type OpHandler = (ctx: OpContext, input: never) => { ok: true; output: unknown } | OpFailure;

const HANDLERS: Readonly<Record<string, OpHandler>> = { ...READ_HANDLERS };

function hasScopes(auth: AuthContext | McpAuth): auth is McpAuth {
  return Array.isArray((auth as McpAuth).scopes);
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
  if (hasScopes(auth) && !auth.scopes.includes(spec.requires)) {
    return {
      ok: false,
      code: "insufficient_scope",
      message: `token scope does not include ${spec.requires}`,
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
