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
