import {
  buildFieldValueSchema,
  LIST_COLUMNS_MAX,
  tolerantReadData,
  type ContentTypeDefinition,
  type FieldDefinition,
} from "@plyrs/metamodel";
import type { SyncRecord } from "@plyrs/sync-protocol";
import { formatDateTime } from "./datetime";
import { kindOf } from "./content-type-form";
import { LIST_LABELS } from "./labels";

// 一覧の追加列(Phase V4 持ち越し K2・K3 / 案 D 5 章 / 案 E 2.2)。純関数だけを置く

export interface ListColumn {
  key: string;
  /** 見出し = field.label ?? field.key */
  label: string;
  /** 等幅で出すか(slug。判定は content-type-form の kindOf) */
  mono: boolean;
  /** listColumnsOf の時点で解決した定義 */
  field: FieldDefinition;
}

// listColumns の順に、型に無い key を落として最大 LIST_COLUMNS_MAX 列
export function listColumnsOf(contentType: ContentTypeDefinition): ListColumn[] {
  const columns: ListColumn[] = [];
  for (const key of contentType.listColumns ?? []) {
    const field = contentType.fields.find((f) => f.key === key);
    if (field === undefined) continue;
    columns.push({ key, label: field.label ?? field.key, mono: kindOf(field) === "slug", field });
    if (columns.length >= LIST_COLUMNS_MAX) break;
  }
  return columns;
}

// K3: 種類ごとの整形。不在・不適合・一覧で表さない種類は「—」
export function cellText(field: FieldDefinition, value: unknown): string {
  const empty = LIST_LABELS.cell.empty;
  if (value === undefined || value === null) return empty;
  switch (field.type) {
    case "text":
      return typeof value === "string" && value !== "" ? value : empty;
    case "number":
      return typeof value === "number" && Number.isFinite(value)
        ? value.toLocaleString("ja-JP")
        : empty;
    case "boolean":
      return typeof value === "boolean"
        ? value
          ? LIST_LABELS.cell.yes
          : LIST_LABELS.cell.no
        : empty;
    case "datetime": {
      if (typeof value !== "string") return empty;
      return formatDateTime(new Date(value)).absolute;
    }
    case "select": {
      const picked = Array.isArray(value) ? value : [value];
      const labels = picked
        .filter((v): v is string => typeof v === "string")
        .map((v) => field.config.options.find((o) => o.value === v)?.label ?? v);
      return labels.length > 0 ? labels.join("、") : empty;
    }
    case "relation": {
      const count = Array.isArray(value) ? value.length : 1;
      return count >= 1 ? LIST_LABELS.cell.count(count) : empty;
    }
    default:
      return empty;
  }
}

// 行ごとのセル文字列(columns と同じ順)。relation は tolerantReadData が読まないので
// input を同じスキーマで検証して件数を数える
export function rowCells(
  contentType: ContentTypeDefinition,
  record: SyncRecord,
  columns: readonly ListColumn[],
): string[] {
  const { values } = tolerantReadData(contentType, record.input);
  return columns.map(({ key, field }) => {
    if (field.type === "relation") {
      const raw = record.input[key];
      return buildFieldValueSchema(field).safeParse(raw).success
        ? cellText(field, raw)
        : LIST_LABELS.cell.empty;
    }
    return cellText(field, values[key]);
  });
}
