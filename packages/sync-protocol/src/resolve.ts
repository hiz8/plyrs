import type { ContentTypeDefinition } from "@plyrs/metamodel";
import type { ClientChange, FieldConflict, SyncRecord } from "./messages";

export type SyncResolution =
  | { kind: "apply"; input: Record<string, unknown> }
  | { kind: "conflict"; conflicts: FieldConflict[] };

// design-spec §10.3: single-writer の DO がフィールド単位で裁定する。
// 別フィールドの変更は両立（マージ）、同一スカラーは LWW（後勝ち）、
// 同一リッチテキスト（AST）は検知して手動解決（§10.4）。
export function resolveSyncWrite(
  contentType: ContentTypeDefinition,
  change: ClientChange,
  current: SyncRecord | null,
): SyncResolution {
  if (current === null) {
    return { kind: "apply", input: change.input };
  }

  const fieldTypes = new Map(contentType.fields.map((field) => [field.key, field.type]));
  const conflicts: FieldConflict[] = [];

  for (const fieldKey of change.changedFields) {
    const baseVersion = change.baseFieldVersions[fieldKey] ?? 0;
    const currentVersion = current.fieldVersions[fieldKey] ?? 0;
    if (baseVersion === currentVersion) {
      continue;
    }
    // 未知フィールド（クライアントの型定義が古い等）は LWW 側に倒す — 寛容 read と同じ思想
    if (fieldTypes.get(fieldKey) === "richtext") {
      conflicts.push({ fieldKey, baseVersion, currentVersion });
    }
  }

  if (conflicts.length > 0) {
    return { kind: "conflict", conflicts };
  }

  // マージ: サーバーの現在値をベースに、クライアントが変更したキーだけ上書きする。
  // changedFields にあるが input に無いキーは「値の消去」として落とす。
  const merged: Record<string, unknown> = { ...current.input };
  for (const fieldKey of change.changedFields) {
    if (fieldKey in change.input) {
      merged[fieldKey] = change.input[fieldKey];
    } else {
      delete merged[fieldKey];
    }
  }
  return { kind: "apply", input: merged };
}
