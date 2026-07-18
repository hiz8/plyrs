import type { Role } from "../auth/permissions";
import { registerContentTypeCore, type ContentTypeRow } from "../do/content-types";
import type { ModuleManifest } from "./manifest";
import { moduleOperation } from "./manifest";
import { MODULE_REGISTRY, type ModuleDefinition } from "./registry";

export interface StoredModulePermissions {
  grants: Record<string, readonly Role[]>;
  typeWriteGuards: Record<string, string>;
}

// §11.5: 有効化時にマニフェストの権限宣言を DO ローカルへ展開する(判定時に外部照会しない)
export function permissionsFromManifest(manifest: ModuleManifest): StoredModulePermissions {
  const grants: Record<string, readonly Role[]> = {};
  for (const perm of manifest.permissions) {
    grants[moduleOperation(manifest.moduleId, perm.key)] = perm.roles;
  }
  const typeWriteGuards: Record<string, string> = {};
  for (const [typeKey, permKey] of Object.entries(manifest.typeWriteGuards)) {
    typeWriteGuards[typeKey] = moduleOperation(manifest.moduleId, permKey);
  }
  return { grants, typeWriteGuards };
}

export interface ModuleRegistryRow {
  moduleId: string;
  enabled: boolean;
  appliedVersion: number;
  permissions: StoredModulePermissions;
}

interface RawModuleRegistryRow extends Record<string, SqlStorageValue> {
  module_id: string;
  enabled: number;
  applied_version: number;
  permissions: string;
}

// grants / typeWriteGuards が両方ともオブジェクト(null は除く)であることまで見る形状検証
// (レビュー Minor: 値の型までは見ていなかった)。
function hasValidPermissionsShape(value: unknown): value is StoredModulePermissions {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  if (!("grants" in value) || !("typeWriteGuards" in value)) {
    return false;
  }
  return (
    typeof value.grants === "object" &&
    value.grants !== null &&
    typeof value.typeWriteGuards === "object" &&
    value.typeWriteGuards !== null
  );
}

// §15 Minor: JSON.parse 無防御対策。壊れた permissions 行(手動編集・移行漏れ等)が
// 1 テナントの RPC(listModules/getContentType 経由の moduleWriteDenial 等)を丸ごと
// throw させないよう保護する。
//
// ユーザー裁定(2026-07-18): パース失敗・想定外シェイプのフォールバックは「権限なし」への
// fail-open ではなく、MODULE_REGISTRY(コード内静的マニフェスト = 権限の真実源)から
// permissionsFromManifest で再導出する。DB 行が壊れていてもガードの実効性を保つため。
// moduleId が registry に無ければ(未知モジュール行)安全側で空 grants を返す。
function safeParsePermissions(
  raw: string,
  moduleId: string,
  registry: Record<string, ModuleDefinition>,
): StoredModulePermissions {
  const reDeriveOrEmpty = (): StoredModulePermissions => {
    const module = registry[moduleId];
    return module === undefined
      ? { grants: {}, typeWriteGuards: {} }
      : permissionsFromManifest(module.manifest);
  };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    console.error(
      `module_registry: failed to parse permissions for '${moduleId}', re-deriving from manifest`,
      error,
    );
    return reDeriveOrEmpty();
  }
  if (!hasValidPermissionsShape(parsed)) {
    console.error(
      `module_registry: permissions for '${moduleId}' has an unexpected shape, re-deriving from manifest`,
    );
    return reDeriveOrEmpty();
  }
  return parsed;
}

function rowToModuleRegistryRow(
  row: RawModuleRegistryRow,
  registry: Record<string, ModuleDefinition>,
): ModuleRegistryRow {
  return {
    moduleId: row.module_id,
    enabled: row.enabled === 1,
    appliedVersion: row.applied_version,
    permissions: safeParsePermissions(row.permissions, row.module_id, registry),
  };
}

export function moduleRegistryRow(
  sql: SqlStorage,
  moduleId: string,
  registry: Record<string, ModuleDefinition> = MODULE_REGISTRY,
): ModuleRegistryRow | null {
  const row = sql
    .exec<RawModuleRegistryRow>(
      "SELECT module_id, enabled, applied_version, permissions FROM module_registry WHERE module_id = ?",
      moduleId,
    )
    .toArray()[0];
  return row === undefined ? null : rowToModuleRegistryRow(row, registry);
}

export function moduleRegistryRows(
  sql: SqlStorage,
  registry: Record<string, ModuleDefinition> = MODULE_REGISTRY,
): ModuleRegistryRow[] {
  return sql
    .exec<RawModuleRegistryRow>(
      "SELECT module_id, enabled, applied_version, permissions FROM module_registry ORDER BY module_id",
    )
    .toArray()
    .map((row) => rowToModuleRegistryRow(row, registry));
}

export function isModuleEnabled(sql: SqlStorage, moduleId: string): boolean {
  return moduleRegistryRow(sql, moduleId)?.enabled === true;
}

export function enabledModuleIds(sql: SqlStorage): string[] {
  return sql
    .exec<{ module_id: string }>(
      "SELECT module_id FROM module_registry WHERE enabled = 1 ORDER BY module_id",
    )
    .toArray()
    .map((row) => row.module_id);
}

export function upsertModuleEnablement(
  sql: SqlStorage,
  args: {
    moduleId: string;
    enabled: boolean;
    appliedVersion: number;
    permissions: StoredModulePermissions;
    now: string;
  },
): void {
  sql.exec(
    "INSERT INTO module_registry (module_id, enabled, applied_version, permissions, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(module_id) DO UPDATE SET enabled = excluded.enabled, applied_version = excluded.applied_version, permissions = excluded.permissions, updated_at = excluded.updated_at",
    args.moduleId,
    args.enabled ? 1 : 0,
    args.appliedVersion,
    JSON.stringify(args.permissions),
    args.now,
  );
}

// §4.2: マニフェストの型定義を冪等適用する。同一定義は Task 3 の no-op 検出で version が
// 動かない。失敗(id_mismatch 等)は呼び出し側でロールバックさせるため throw する。
export function applyModuleTypes(sql: SqlStorage, manifest: ModuleManifest, now: string): boolean {
  let changed = false;
  for (const def of manifest.contentTypes) {
    const result = registerContentTypeCore(sql, def, now, { allowPlugin: true });
    if (!result.ok) {
      throw new Error(`module type registration failed for '${def.key}': ${result.message}`);
    }
    if (result.applied) {
      changed = true;
    }
  }
  return changed;
}

// §4.2 の安全網: DO が起きたとき、有効モジュールの適用済み version がコード側と違えば
// その場で追い付かせる(Queues の再配布を待たない。ensureAssetContentType と同じ思想)。
// Important fix（レビュー指摘）: これは blockConcurrencyWhile(constructor) 内で呼ばれる。
// applyModuleTypes は将来のマニフェスト version bump で legacy 型と衝突する等の理由で
// throw しうるが、ここで捕捉しないと有効化済み全テナントの DO が起床のたびに throw する
// = テナント全損になる。enable 経路(try/catch → type_conflict)や ensureAssetContentType
// (skip + console.error)と同じ防御をモジュール単位で入れる: 失敗したモジュールは
// console.error してスキップし(applied_version を進めない)、他モジュールと DO 起動は継続する。
export function ensureEnabledModuleTypes(
  sql: SqlStorage,
  now: string,
  registry: Record<string, ModuleDefinition> = MODULE_REGISTRY,
): boolean {
  let changed = false;
  for (const row of moduleRegistryRows(sql, registry)) {
    if (!row.enabled) {
      continue;
    }
    const module = registry[row.moduleId];
    if (module === undefined || module.manifest.version === row.appliedVersion) {
      continue;
    }
    try {
      if (applyModuleTypes(sql, module.manifest, now)) {
        changed = true;
      }
      upsertModuleEnablement(sql, {
        moduleId: row.moduleId,
        enabled: true,
        appliedVersion: module.manifest.version,
        permissions: permissionsFromManifest(module.manifest),
        now,
      });
    } catch (error) {
      console.error(`ensureEnabledModuleTypes: failed to apply module '${row.moduleId}'`, error);
    }
  }
  return changed;
}

// §11.5: 型×操作ガード。無効モジュールの型はガード非適用(§9.5 コードが走らない、の帰結)。
export function moduleWriteDenial(
  sql: SqlStorage,
  contentType: ContentTypeRow,
  role: Role,
): { code: "forbidden"; message: string } | null {
  if (contentType.source !== "plugin" || contentType.pluginId === null) {
    return null;
  }
  const row = moduleRegistryRow(sql, contentType.pluginId);
  if (row === null || !row.enabled) {
    return null;
  }
  const guardOp = row.permissions.typeWriteGuards[contentType.key];
  if (guardOp === undefined) {
    return null;
  }
  const allowed = row.permissions.grants[guardOp] ?? [];
  if (allowed.includes(role)) {
    return null;
  }
  return {
    code: "forbidden",
    message: `role '${role}' cannot write ${contentType.key} (requires ${guardOp})`,
  };
}

// design-spec §9.5: TenantDO の enableModule/disableModule/listModules RPC の戻り値型。
// rpc-unwrap.ts ↔ tenant-do.ts の import 循環を避けるため、tenant-do.ts ではなくここに置く。
export interface ModuleSummary {
  moduleId: string;
  name: string;
  version: number;
  enabled: boolean;
  appliedVersion: number;
}

export type EnableModuleResult =
  | { ok: true; module: ModuleSummary }
  | { ok: false; code: "forbidden" | "unknown_module" | "type_conflict"; message: string };
