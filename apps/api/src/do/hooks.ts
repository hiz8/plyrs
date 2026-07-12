import type { ContentTypeRow } from "./content-types";
import type { RecordSnapshot, WriteErrorCode } from "./types";

// design-spec §9.3: DO 内同期バリデーションフック。書き込みを拒否できる。
// モジュールフック（Phase 9）はこのパイプラインに乗る。認可第2段は RPC 入口（authorize.ts）
// — no-op 判定より前に走らせるため、このパイプラインには乗せない（Phase 2 申し送り）。
export interface BeforeWriteContext {
  contentType: ContentTypeRow;
  recordId: string;
  data: Record<string, unknown>;
  prev: RecordSnapshot | null;
  sql: SqlStorage;
}

export type HookRejection = {
  code: Extract<WriteErrorCode, "unique_violation">;
  message: string;
};

export type BeforeWriteHook = (ctx: BeforeWriteContext) => HookRejection | null;

export function runBeforeWriteHooks(
  hooks: readonly BeforeWriteHook[],
  ctx: BeforeWriteContext,
): HookRejection | null {
  for (const hook of hooks) {
    const rejection = hook(ctx);
    if (rejection !== null) {
      return rejection;
    }
  }
  return null;
}
