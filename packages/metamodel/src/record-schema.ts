import { z } from "zod";
import type { ContentTypeDefinition } from "./content-type";
import type { FieldDefinition, RelationFieldDefinition } from "./field-types";
import { uuidSchema } from "./ids";

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

// tech-selection 2.7: AST ルートに schemaVersion を刻む。doc（ProseMirror JSON）は
// この層では不透明な JSON 値。ノード構造の検証は richtext 実装フェーズで深める。
export const richTextEnvelopeSchema = z.strictObject({
  schemaVersion: z.number().int().positive(),
  doc: jsonValueSchema,
});

export const relationRefSchema = z.strictObject({
  type: z.string().min(1),
  id: uuidSchema,
});

export type RelationRef = z.infer<typeof relationRefSchema>;

export function buildFieldValueSchema(field: FieldDefinition): z.ZodType<unknown> {
  switch (field.type) {
    case "text": {
      const maxLength = field.config?.maxLength;
      return maxLength === undefined ? z.string() : z.string().max(maxLength);
    }
    case "number":
      return field.config?.integer ? z.number().int() : z.number();
    case "boolean":
      return z.boolean();
    case "datetime":
      // 既定で UTC 'Z' 終端のみ受理（オフセット付きは拒否）— design-spec §5
      return z.iso.datetime();
    case "json":
      return jsonValueSchema;
    case "select": {
      const values = field.config.options.map((option) => option.value);
      const single = z.enum(values as [string, ...string[]]);
      return field.config.multiple ? z.array(single) : single;
    }
    case "richtext":
      return richTextEnvelopeSchema;
    case "relation": {
      const ref = relationRefSchema.refine(
        (value) => field.config.allowedTypes.includes(value.type),
        { message: `relation target type must be one of: ${field.config.allowedTypes.join(", ")}` },
      );
      return field.config.cardinality === "many" ? z.array(ref) : ref;
    }
  }
}

// validate-on-write の実体。looseObject により型定義に無いキーは検証せず素通しで保持する
// （design-spec §4.2 の遅延適合: 旧型定義時代のフィールドを破棄も拒否もしない）。
export function buildRecordInputSchema(contentType: ContentTypeDefinition) {
  const shape: Record<string, z.ZodType<unknown>> = {};
  for (const field of contentType.fields) {
    const valueSchema = buildFieldValueSchema(field);
    shape[field.key] = field.required ? valueSchema : valueSchema.optional();
  }
  return z.looseObject(shape);
}

export interface SplitRecordInput {
  data: Record<string, unknown>;
  relations: Array<{ fieldKey: string; refs: RelationRef[] }>;
}

// 前提: input は buildRecordInputSchema で検証済み（キャストはこの前提に依る）。
// data には relation 以外の全キー（未知キー含む）が入り、relation は
// cardinality 'one' も含めて refs 配列に正規化する — design-spec §6「関係は data に入れない」。
export function splitRecordInput(
  contentType: ContentTypeDefinition,
  input: Record<string, unknown>,
): SplitRecordInput {
  const relationFields = new Map<string, RelationFieldDefinition>();
  for (const field of contentType.fields) {
    if (field.type === "relation") {
      relationFields.set(field.key, field);
    }
  }

  const data: Record<string, unknown> = {};
  const relations: SplitRecordInput["relations"] = [];

  for (const field of contentType.fields) {
    const relationField = relationFields.get(field.key);
    if (relationField === undefined) {
      continue;
    }
    const value = input[field.key];
    if (value === undefined) {
      continue;
    }
    const refs =
      relationField.config.cardinality === "many"
        ? (value as RelationRef[])
        : [value as RelationRef];
    relations.push({ fieldKey: field.key, refs });
  }

  for (const [key, value] of Object.entries(input)) {
    if (!relationFields.has(key)) {
      data[key] = value;
    }
  }

  return { data, relations };
}
