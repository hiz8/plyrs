import { splitRecordInput, type ContentTypeDefinition, type RelationRef } from "@plyrs/metamodel";

export function jsonDeepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) {
    return true;
  }
  if (typeof a !== typeof b || a === null || b === null) {
    return false;
  }
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) {
      return false;
    }
    return a.every((value, i) => jsonDeepEqual(value, b[i]));
  }
  if (typeof a === "object") {
    if (Array.isArray(b) || typeof b !== "object") {
      return false;
    }
    const keysA = Object.keys(a);
    const keysB = Object.keys(b as object);
    if (keysA.length !== keysB.length) {
      return false;
    }
    return keysA.every(
      (key) =>
        Object.hasOwn(b as object, key) &&
        jsonDeepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
    );
  }
  return false;
}

export interface ChangeSet {
  data: Record<string, unknown>;
  relationWrites: Array<{ fieldKey: string; refs: RelationRef[] }>;
  changedFields: string[];
  dataChanged: boolean;
}

function refsEqual(a: RelationRef[], b: RelationRef[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  return a.every((ref, i) => ref.type === b[i]?.type && ref.id === b[i]?.id);
}

// record 単位の全置換（design-spec §10.2）: input が defined/unknown 両キーの真実。
// 省略された relation フィールドは [] = クリアとして扱う。
export function computeChangeSet(
  contentType: ContentTypeDefinition,
  input: Record<string, unknown>,
  prevData: Record<string, unknown> | null,
  prevRelations: Map<string, RelationRef[]>,
): ChangeSet {
  const { data, relations } = splitRecordInput(contentType, input);
  const changedFields: string[] = [];

  for (const field of contentType.fields) {
    if (field.type === "relation") {
      const nextRefs = relations.find((write) => write.fieldKey === field.key)?.refs ?? [];
      const prevRefs = prevRelations.get(field.key) ?? [];
      if (!refsEqual(prevRefs, nextRefs)) {
        changedFields.push(field.key);
      }
      continue;
    }
    const before = prevData === null ? undefined : prevData[field.key];
    if (!jsonDeepEqual(before, data[field.key])) {
      changedFields.push(field.key);
    }
  }

  const relationWrites = contentType.fields
    .filter((field) => field.type === "relation")
    .map((field) => ({
      fieldKey: field.key,
      refs: relations.find((write) => write.fieldKey === field.key)?.refs ?? [],
    }));

  const dataChanged = prevData === null ? true : !jsonDeepEqual(prevData, data);

  return {
    data,
    relationWrites,
    changedFields,
    dataChanged,
  };
}
