import type { BeforeWriteHook } from "../do/hooks";
import { enabledModuleIds } from "./enablement";
import { moduleById } from "./registry";

// §9.4 ステップ2: 有効モジュールの同期フックだけを moduleId 昇順で合流させる。
// レジストリ(DO テーブル)に行が残っていてもコード側に定義が無ければ走らない
// (デプロイ後にモジュールを撤去したケースの安全側)。
export function moduleBeforeWriteHooks(sql: SqlStorage): BeforeWriteHook[] {
  const hooks: BeforeWriteHook[] = [];
  for (const moduleId of enabledModuleIds(sql)) {
    const hook = moduleById(moduleId)?.beforeWrite;
    if (hook !== undefined) {
      hooks.push(hook);
    }
  }
  return hooks;
}
