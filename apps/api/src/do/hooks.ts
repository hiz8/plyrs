import type { RelationRef } from "@plyrs/metamodel";
import type { ContentTypeRow } from "./content-types";
import type { ModuleRejectionCode, RecordSnapshot, WriteErrorCode } from "./types";

// design-spec §9.3: DO 内同期バリデーションフック。書き込みを拒否できる。
// モジュールフック（Phase 9）はこのパイプラインに乗る。認可第2段は RPC 入口（authorize.ts）
// — no-op 判定より前に走らせるため、このパイプラインには乗せない（Phase 2 申し送り）。
export interface BeforeWriteContext {
  contentType: ContentTypeRow;
  recordId: string;
  data: Record<string, unknown>;
  prev: RecordSnapshot | null;
  sql: SqlStorage;
  // Phase 8: サーバー内部の書き込み(アップロード API 経由の createAssetRecord)は true。
  // クライアント由来(同期 push / HTTP writeRecord)は false — assetGuardHook が参照する。
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
