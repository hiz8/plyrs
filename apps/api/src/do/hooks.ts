import type { ContentTypeRow } from "./content-types";
import type { RecordSnapshot, WriteErrorCode } from "./types";

// design-spec §9.3: DO 内同期バリデーションフック。書き込みを拒否できる。
// 認可第2段（Phase 3）・モジュールフック（Phase 9）も同じパイプラインに乗る。
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
