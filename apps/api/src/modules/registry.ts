import type { z } from "zod";
import type { BeforeWriteHook } from "../do/hooks";
import type { WriteRecordInput, WriteRecordResult } from "../do/types";
import { moduleManifestSchema, type ModuleManifest } from "./manifest";
import { bookingModule } from "./booking/module";

// design-spec §9.1: ファーストパーティ・サンドボックスなし。モジュール = このレジストリに
// 静的登録された TS オブジェクト(G6 裁定: コード内静的レジストリ)。有効化していない
// モジュールのフック・イベント・alarm・公開エンドポイントは一切走らない(§9.5)。

export type ModuleEventName = "afterWrite" | "afterPublish";

// Queues consumer 側でイベントを処理する文脈(§9.3 非同期副作用フック)。
// writeRecord は DO の moduleWrite RPC 経由のシステム書き込み(actor = module:{id})。
export interface ModuleEventContext {
  env: Env;
  tenantId: string;
  recordId: string;
  typeKey: string;
  newId(): string;
  writeRecord(typeKey: string, params: WriteRecordInput): Promise<WriteRecordResult>;
}

// DO 内 alarm ハンドラの文脈(§9.6)。schedule はレジストリ登録のみ
// (物理 setAlarm は TenantDO.alarm() 末尾の minDueAt 経路が一本で担う — §9 申し送りの制約)。
export interface ModuleAlarmContext {
  sql: SqlStorage;
  now: number; // effectiveNow(epoch ms)
  schedule(dueAtMs: number): void;
  writeRecord(typeKey: string, params: WriteRecordInput): WriteRecordResult;
}

// §11.7: 公開 write エンドポイント宣言。recordId はサーバー生成(buildWrite の ids.newId)。
export interface PublicWriteEndpoint {
  typeKey: string;
  inputSchema: z.ZodType<Record<string, unknown>>;
  buildWrite(input: Record<string, unknown>, ids: { newId(): string }): WriteRecordInput;
}

export interface ModuleDefinition {
  manifest: ModuleManifest;
  beforeWrite?: BeforeWriteHook;
  events?: Partial<
    Record<
      ModuleEventName,
      { types: readonly string[]; handle(ctx: ModuleEventContext): Promise<void> }
    >
  >;
  onAlarm?(ctx: ModuleAlarmContext): void;
  publicEndpoints?: Record<string, PublicWriteEndpoint>;
}

// マニフェストは TS リテラルなので、型参照の整合(navTypes・typeWriteGuards・publicWriteTypes が
// 自モジュールの型を指すか)は typecheck では保証されない。登録時に一度スキーマを通し、
// 不整合なら Worker の起動時に落とす(黙ってナビから型が消える等を防ぐ)。登録するのは
// 検証済みの元オブジェクトそのもの(テストが vi.spyOn で差し替える同一参照を保つ)。
export function buildModuleRegistry(
  modules: readonly ModuleDefinition[],
): Record<string, ModuleDefinition> {
  const registry: Record<string, ModuleDefinition> = {};
  for (const definition of modules) {
    const parsed = moduleManifestSchema.safeParse(definition.manifest);
    if (!parsed.success) {
      throw new Error(
        `invalid module manifest '${definition.manifest.moduleId}': ${parsed.error.message}`,
      );
    }
    const { moduleId } = parsed.data;
    if (moduleId in registry) {
      throw new Error(`duplicate module id: ${moduleId}`);
    }
    registry[moduleId] = definition;
  }
  return registry;
}

export const MODULE_REGISTRY: Record<string, ModuleDefinition> = buildModuleRegistry([
  bookingModule,
]);

export function moduleById(id: string): ModuleDefinition | undefined {
  return MODULE_REGISTRY[id];
}

export function moduleCatalog(): ModuleDefinition[] {
  return Object.values(MODULE_REGISTRY).toSorted((a, b) =>
    a.manifest.moduleId.localeCompare(b.manifest.moduleId),
  );
}
