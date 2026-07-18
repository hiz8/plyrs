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

// §15 Minor: モジュール alarm ハンドラ呼び出しのレジストリ注入シーム。module は呼び出し側が
// 解決して渡す(本番は registry.moduleById、テストはフェイクの ModuleDefinition を直接注入できる)。
//
// Important fix(レビュー指摘): 当初はこの関数自身が try/catch していたが、それだと呼び出し元の
// TenantDO#runModuleAlarm の transactionSync クロージャが throw しなくなり、(1) ハンドラ途中までの
// 部分書き込みがそのまま commit され、(2) clearAlarm も commit 済みで ctx.schedule() に到達できない
// ため当該モジュールの alarm 再武装が永久に失われる、という regression があった。throw の隔離
// (transactionSync 全体のロールバック + 他モジュール継続)は呼び出し側の責務とし、この関数自体は
// throw を素通しする契約にする。
export function runModuleAlarmHandler(
  moduleId: string,
  module: ModuleDefinition | undefined,
  ctx: ModuleAlarmContext,
): void {
  if (module?.onAlarm === undefined) {
    return;
  }
  module.onAlarm(ctx);
}
