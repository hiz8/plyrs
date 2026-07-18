import type { ModuleAlarmContext, ModuleDefinition } from "./registry";

// design-spec §9.6: モジュールの論理タイマーは `(module_id, next_fire_at)` を alarm_registry の
// kind = `module:{moduleId}` として登録する。1 モジュール 1 タイマー(record ごとに時刻を
// 持たない集約は仕様どおり)。
export const MODULE_ALARM_PREFIX = "module:";

export function moduleAlarmKind(moduleId: string): string {
  return `${MODULE_ALARM_PREFIX}${moduleId}`;
}

export function moduleIdFromAlarmKind(kind: string): string | null {
  if (!kind.startsWith(MODULE_ALARM_PREFIX)) {
    return null;
  }
  return kind.slice(MODULE_ALARM_PREFIX.length);
}

// §15 Minor: モジュール alarm ハンドラの throw 隔離。TenantDO.alarm() は 1 回の起床で複数の
// module: kind をまとめて処理しうるため、1 モジュールの onAlarm が throw すると
// (この関数でキャッチしないと)呼び出し元の for ループごと中断し、以降の due kind も
// 末尾の物理 setAlarm 再アームも走らなくなる ―― ensureAssetContentType /
// ensureEnabledModuleTypes と同じテナント全損回避の規律をここにも適用する。
// module は呼び出し側が解決して渡す(レジストリ注入シーム: 本番は registry.moduleById、
// テストはフェイクの ModuleDefinition を直接注入できる)。契約として、この関数自体は throw しない。
export function runModuleAlarmHandler(
  moduleId: string,
  module: ModuleDefinition | undefined,
  ctx: ModuleAlarmContext,
): void {
  if (module?.onAlarm === undefined) {
    return;
  }
  try {
    module.onAlarm(ctx);
  } catch (error) {
    console.error("module alarm handler failed", moduleId, error);
  }
}
