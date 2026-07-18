import type { ContentTypeDefinition } from "@plyrs/metamodel";
import type { SyncRecord } from "@plyrs/sync-protocol";

// 一覧・relation picker 共用: 最初の text フィールド値をラベルに、無ければ id 先頭 8 桁。
// record-form ⇄ asset-picker の循環 import を避けるため lib に置く(§14 Minor 消化)。
export function labelForRecord(types: ContentTypeDefinition[], record: SyncRecord): string {
  const definition = types.find((type) => type.key === record.type);
  const firstText = definition?.fields.find((field) => field.type === "text");
  if (firstText !== undefined) {
    const value = record.input[firstText.key];
    if (typeof value === "string" && value !== "") {
      return value;
    }
  }
  return record.id.slice(0, 8);
}
