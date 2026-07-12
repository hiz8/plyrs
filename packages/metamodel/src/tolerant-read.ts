import type { ContentTypeDefinition } from "./content-type";
import { buildFieldValueSchema } from "./record-schema";

export interface TolerantReadResult {
  values: Record<string, unknown>;
  unknownKeys: string[];
  invalidKeys: string[];
}

// design-spec §4.2 寛容 read: records が最新の型定義に適合している保証はない前提で読む。
// 欠損・不適合は不在扱い（破棄はしない — raw は呼び出し元が保持）、未知キーは報告のみ。
export function tolerantReadData(
  contentType: ContentTypeDefinition,
  raw: Record<string, unknown>,
): TolerantReadResult {
  const values: Record<string, unknown> = {};
  const invalidKeys: string[] = [];
  const definedKeys = new Set<string>();

  for (const field of contentType.fields) {
    definedKeys.add(field.key);
    if (field.type === "relation") {
      continue;
    }
    const rawValue = raw[field.key];
    if (rawValue === undefined) {
      continue;
    }
    const result = buildFieldValueSchema(field).safeParse(rawValue);
    if (result.success) {
      values[field.key] = result.data;
    } else {
      invalidKeys.push(field.key);
    }
  }

  const unknownKeys = Object.keys(raw).filter((key) => !definedKeys.has(key));
  return { values, unknownKeys, invalidKeys };
}
