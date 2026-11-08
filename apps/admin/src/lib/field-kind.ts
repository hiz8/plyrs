import { ASSET_TYPE_KEY, type FieldDefinition } from "@plyrs/metamodel";

// フィールドの種類(画面上の分類)。型の編集画面と一覧の列の両方が使うので、どの機能にも属さない場所に置く

export type FieldKind =
  | "text"
  | "richtext"
  | "number"
  | "datetime"
  | "boolean"
  | "select"
  | "asset"
  | "reference"
  | "slug"
  | "json";
export const SLUG_KEY = "slug";

// E12: 読む側(record-form)の判定と同じ
export function kindOf(field: FieldDefinition): FieldKind {
  switch (field.type) {
    case "text":
      return field.key === SLUG_KEY && field.config?.unique === true ? "slug" : "text";
    case "relation": {
      const allowed = field.config.allowedTypes;
      return allowed.length === 1 && allowed[0] === ASSET_TYPE_KEY ? "asset" : "reference";
    }
    default:
      return field.type;
  }
}
