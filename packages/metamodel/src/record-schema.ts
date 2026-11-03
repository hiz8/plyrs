import { z } from "zod";
import type { ContentTypeDefinition } from "./content-type";
import type { FieldDefinition, RelationFieldDefinition } from "./field-types";
import { uuidSchema } from "./ids";
import { unsafeLinkHrefs } from "./link-href";

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

// tech-selection 2.7: AST ルートに schemaVersion を刻む。
// 決定 6(2026-07-17): doc は「ノード型名に依存しない構造検証」— ノード型名(heading 等)は
// 検証しない(エディタ拡張 = スキーマ進化を metamodel の変更なしに受け入れる。§4.2 の
// tolerant read と同じ思想)が、ツリー構造(type: string を持つノードの再帰)だけは強制し、
// DO 側の relations 抽出(body-relations.ts)が壊れた形の doc を受け取らないことを保証する。
export interface RichTextMark {
  type: string;
  attrs?: Record<string, JsonValue> | undefined;
}

export interface RichTextNode {
  type: string;
  content?: RichTextNode[] | undefined;
  marks?: RichTextMark[] | undefined;
  attrs?: Record<string, JsonValue> | undefined;
  text?: string | undefined;
}

// looseObject: ProseMirror が将来 JSON 表現にキーを足しても破棄も拒否もしない(遅延マイグレーション)
const richTextMarkSchema: z.ZodType<RichTextMark> = z.looseObject({
  type: z.string().min(1),
  attrs: z.record(z.string(), jsonValueSchema).optional(),
});

export const richTextNodeSchema: z.ZodType<RichTextNode> = z.lazy(() =>
  z.looseObject({
    type: z.string().min(1),
    content: z.array(richTextNodeSchema).optional(),
    marks: z.array(richTextMarkSchema).optional(),
    attrs: z.record(z.string(), jsonValueSchema).optional(),
    text: z.string().optional(),
  }),
);

export const richTextEnvelopeSchema = z.strictObject({
  schemaVersion: z.number().int().positive(),
  doc: richTextNodeSchema,
});

export type RichTextEnvelope = z.infer<typeof richTextEnvelopeSchema>;

export const relationRefSchema = z.strictObject({
  type: z.string().min(1),
  id: uuidSchema,
});

export type RelationRef = z.infer<typeof relationRefSchema>;

export function buildFieldValueSchema(field: FieldDefinition): z.ZodType<unknown> {
  const schema = buildBareFieldValueSchema(field);
  // 16.11(M2-8): フィールドの description は JSON Schema(recordInputJsonSchema)にも載せる
  return field.description === undefined ? schema : schema.describe(field.description);
}

function buildBareFieldValueSchema(field: FieldDefinition): z.ZodType<unknown> {
  switch (field.type) {
    case "text": {
      const maxLength = field.config?.maxLength;
      // G7 (2026-07-12 決定): required の text は空文字を拒否する
      let schema = field.required ? z.string().min(1) : z.string();
      if (maxLength !== undefined) {
        schema = schema.max(maxLength);
      }
      return schema;
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
      const multi = z.array(single);
      // G7: required の multiple-select は空配列を拒否する
      return field.config.multiple ? (field.required ? multi.min(1) : multi) : single;
    }
    case "richtext":
      return richTextEnvelopeSchema;
    case "relation": {
      const ref = relationRefSchema.refine(
        (value) => field.config.allowedTypes.includes(value.type),
        { message: `relation target type must be one of: ${field.config.allowedTypes.join(", ")}` },
      );
      const many = z.array(ref);
      // G7: required の many-relation は空配列を拒否する
      return field.config.cardinality === "many" ? (field.required ? many.min(1) : many) : ref;
    }
  }
}

function rejectUnsafeLinks(value: unknown, ctx: z.RefinementCtx): void {
  const parsed = richTextEnvelopeSchema.safeParse(value);
  if (!parsed.success) {
    return;
  }
  for (const href of unsafeLinkHrefs(parsed.data.doc)) {
    ctx.addIssue({
      code: "custom",
      message: `link href is not allowed (http / https / mailto / tel or a relative URL only): ${href.slice(0, 80)}`,
    });
  }
}

// validate-on-write の実体。looseObject により型定義に無いキーは検証せず素通しで保持する
// （design-spec §4.2 の遅延マイグレーション: 旧型定義時代のフィールドを破棄も拒否もしない）。
export function buildRecordInputSchema(contentType: ContentTypeDefinition) {
  const shape: Record<string, z.ZodType<unknown>> = {};
  for (const field of contentType.fields) {
    const base = buildFieldValueSchema(field);
    // リンクの scheme は書き込み時だけ検査する(tolerant read は buildFieldValueSchema を使うので、
    // 既に保存された値を読めなくはしない)
    const valueSchema = field.type === "richtext" ? base.superRefine(rejectUnsafeLinks) : base;
    shape[field.key] = field.required ? valueSchema : valueSchema.optional();
  }
  return z.looseObject(shape);
}

export type JsonSchema = Record<string, unknown>;

// 16.11(M2-8): record の input の JSON Schema。MCP の resource plyrs://types/{key}/schema で配り、
// エージェントが型の構造(フィールド・必須・説明)を 1 回の read で知るためのもの。
// 型定義に無いキーは looseObject と同じく許す(additionalProperties は zod の既定に従う)
export function recordInputJsonSchema(contentType: ContentTypeDefinition): JsonSchema {
  const schema = buildRecordInputSchema(contentType).meta({
    title: contentType.name,
    ...(contentType.description === undefined ? {} : { description: contentType.description }),
  });
  return z.toJSONSchema(schema, { io: "input", unrepresentable: "any" }) as JsonSchema;
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
