import { z } from "zod";
import { SYSTEM_FIELD_KEYS } from "./system-fields";

export const FIELD_KEY_PATTERN = /^[a-z][a-z0-9_]*$/;

export const fieldKeySchema = z
  .string()
  .regex(FIELD_KEY_PATTERN, "field key must be snake_case starting with a letter")
  .refine((key) => !(SYSTEM_FIELD_KEYS as readonly string[]).includes(key), {
    message: "field key collides with a reserved system field",
  });

const indexableConfig = {
  indexed: z.boolean().optional(),
  unique: z.boolean().optional(),
} as const;

const baseFieldShape = {
  key: fieldKeySchema,
  required: z.boolean().optional(),
} as const;

export const textFieldSchema = z.strictObject({
  ...baseFieldShape,
  type: z.literal("text"),
  config: z
    .strictObject({ ...indexableConfig, maxLength: z.number().int().positive().optional() })
    .optional(),
});

export const numberFieldSchema = z.strictObject({
  ...baseFieldShape,
  type: z.literal("number"),
  config: z.strictObject({ ...indexableConfig, integer: z.boolean().optional() }).optional(),
});

export const booleanFieldSchema = z.strictObject({
  ...baseFieldShape,
  type: z.literal("boolean"),
  config: z.strictObject({ indexed: z.boolean().optional() }).optional(),
});

export const datetimeFieldSchema = z.strictObject({
  ...baseFieldShape,
  type: z.literal("datetime"),
  config: z.strictObject({ ...indexableConfig }).optional(),
});

// json は不透明な脱出ハッチ（design-spec §5): indexed / unique を認めない
export const jsonFieldSchema = z.strictObject({
  ...baseFieldShape,
  type: z.literal("json"),
  config: z.strictObject({}).optional(),
});

export const selectFieldSchema = z
  .strictObject({
    ...baseFieldShape,
    type: z.literal("select"),
    config: z.strictObject({
      options: z
        .array(z.strictObject({ value: z.string().min(1), label: z.string().min(1) }))
        .min(1),
      multiple: z.boolean().optional(),
      indexed: z.boolean().optional(),
    }),
  })
  .superRefine((field, ctx) => {
    const values = field.config.options.map((option) => option.value);
    if (new Set(values).size !== values.length) {
      ctx.addIssue({
        code: "custom",
        path: ["config", "options"],
        message: "select option values must be unique",
      });
    }
  });

export const richtextFieldSchema = z.strictObject({
  ...baseFieldShape,
  type: z.literal("richtext"),
  config: z.strictObject({}).optional(),
});

export const relationFieldSchema = z.strictObject({
  ...baseFieldShape,
  type: z.literal("relation"),
  config: z.strictObject({
    allowedTypes: z.array(z.string().min(1)).min(1),
    cardinality: z.enum(["one", "many"]),
    ordered: z.boolean().optional(),
    snapshotEmbed: z.enum(["id", "value"]).optional(),
  }),
});

export const fieldDefinitionSchema = z.discriminatedUnion("type", [
  textFieldSchema,
  numberFieldSchema,
  booleanFieldSchema,
  datetimeFieldSchema,
  jsonFieldSchema,
  selectFieldSchema,
  richtextFieldSchema,
  relationFieldSchema,
]);

export type FieldDefinition = z.infer<typeof fieldDefinitionSchema>;
export type RelationFieldDefinition = z.infer<typeof relationFieldSchema>;
