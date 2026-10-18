import { titleFieldKey, type ContentTypeDefinition } from "@plyrs/metamodel";
import type { SyncRecord } from "@plyrs/sync-protocol";

// 一覧・relation picker 共用: タイトルのフィールド(案 E 2.2 の titleField、未指定なら最初の
// text フィールド)の値をラベルに、無ければ id 先頭 8 桁。
// record-form ⇄ asset-picker の循環 import を避けるため lib に置く(§14 Minor 消化)。
export function labelForRecord(types: ContentTypeDefinition[], record: SyncRecord): string {
  const definition = types.find((type) => type.key === record.type);
  const titleKey = definition === undefined ? undefined : titleFieldKey(definition);
  if (titleKey !== undefined) {
    const value = record.input[titleKey];
    if (typeof value === "string" && value !== "") {
      return value;
    }
  }
  return record.id.slice(0, 8);
}
