import type { Role } from "../auth/permissions";
import { registerContentTypeCore, type ContentTypeRow } from "../do/content-types";
import type { ModuleManifest } from "./manifest";
import { moduleOperation } from "./manifest";

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

function rowToModuleRegistryRow(row: RawModuleRegistryRow): ModuleRegistryRow {
  return {
    moduleId: row.module_id,
    enabled: row.enabled === 1,
    appliedVersion: row.applied_version,
    permissions: JSON.parse(row.permissions) as StoredModulePermissions,
  };
}

export function moduleRegistryRow(sql: SqlStorage, moduleId: string): ModuleRegistryRow | null {
  const row = sql
    .exec<RawModuleRegistryRow>(
      "SELECT module_id, enabled, applied_version, permissions FROM module_registry WHERE module_id = ?",
      moduleId,
    )
    .toArray()[0];
  return row === undefined ? null : rowToModuleRegistryRow(row);
}

export function moduleRegistryRows(sql: SqlStorage): ModuleRegistryRow[] {
  return sql
    .exec<RawModuleRegistryRow>(
      "SELECT module_id, enabled, applied_version, permissions FROM module_registry ORDER BY module_id",
    )
    .toArray()
    .map(rowToModuleRegistryRow);
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
