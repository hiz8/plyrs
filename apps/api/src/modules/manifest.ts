import {
  contentTypeDefinitionSchema,
  FIELD_KEY_PATTERN,
  PLUGIN_ID_PATTERN,
} from "@plyrs/metamodel";
import { z } from "zod";
import { ROLES } from "../auth/permissions";

// design-spec §4.2 / G6(2026-07-18 裁定): モジュールマニフェスト = zod 検証つき純データ。
// フック実装(コード)とはファイルを分け、マニフェストだけで「型・権限・公開 write の宣言」が
// 完結する。version はマニフェスト全体の版(型定義再配布の冪等判定に使う)。
export const moduleManifestSchema = z
  .strictObject({
    moduleId: z.string().regex(PLUGIN_ID_PATTERN),
    version: z.number().int().positive(),
    name: z.string().min(1),
    contentTypes: z.array(contentTypeDefinitionSchema),
    // 操作キーは `${moduleId}:${key}` に展開される(§11.3 のモジュール独自権限)
    permissions: z.array(
      z.strictObject({
        key: z.string().regex(FIELD_KEY_PATTERN),
        roles: z.array(z.enum(ROLES)).min(1),
      }),
    ),
    // 「この型への認証済み書き込みはこの権限が必要」(§11.5 の型×操作の一部をモジュールが狭める)
    typeWriteGuards: z.record(z.string(), z.string().regex(FIELD_KEY_PATTERN)),
    // §11.7 第2段: 公開 write エンドポイントが作成してよい型の許可リスト
    publicWriteTypes: z.array(z.string()),
  })
  .superRefine((manifest, ctx) => {
    const typeKeys = new Set(manifest.contentTypes.map((ct) => ct.key));
    for (const ct of manifest.contentTypes) {
      if (ct.source !== "plugin" || ct.pluginId !== manifest.moduleId) {
        ctx.addIssue({
          code: "custom",
          path: ["contentTypes"],
          message: `type '${ct.key}' must be source 'plugin' owned by '${manifest.moduleId}'`,
        });
      }
    }
    const permKeys = new Set<string>();
    for (const perm of manifest.permissions) {
      if (permKeys.has(perm.key)) {
        ctx.addIssue({
          code: "custom",
          path: ["permissions"],
          message: `duplicate permission key: ${perm.key}`,
        });
      }
      permKeys.add(perm.key);
    }
    for (const [typeKey, permKey] of Object.entries(manifest.typeWriteGuards)) {
      if (!typeKeys.has(typeKey)) {
        ctx.addIssue({
          code: "custom",
          path: ["typeWriteGuards"],
          message: `unknown type: ${typeKey}`,
        });
      }
      if (!permKeys.has(permKey)) {
        ctx.addIssue({
          code: "custom",
          path: ["typeWriteGuards"],
          message: `unknown permission: ${permKey}`,
        });
      }
    }
    for (const typeKey of manifest.publicWriteTypes) {
      if (!typeKeys.has(typeKey)) {
        ctx.addIssue({
          code: "custom",
          path: ["publicWriteTypes"],
          message: `unknown type: ${typeKey}`,
        });
      }
    }
  });

export type ModuleManifest = z.infer<typeof moduleManifestSchema>;

export function moduleOperation(moduleId: string, permKey: string): string {
  return `${moduleId}:${permKey}`;
}
