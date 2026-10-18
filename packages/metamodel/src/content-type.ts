import { z } from "zod";
import { FIELD_KEY_PATTERN, fieldDefinitionSchema, fieldKeySchema } from "./field-types";
import { uuidSchema } from "./ids";

export const PLUGIN_ID_PATTERN = /^[a-z][a-z0-9_]*$/;
export const PLUGIN_TYPE_KEY_PATTERN = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;

// 案 E 2.2: 型の表示に関する任意項目。値が無いときは画面側の既定(titleField は最初の
// text フィールド、menuOrder は表示名順)に従う。
export const CONTENT_TYPE_DESCRIPTION_MAX_LENGTH = 1000;
export const LIST_COLUMNS_MAX = 3;

export const contentTypeDefinitionSchema = z
  .strictObject({
    id: uuidSchema,
    key: z.string().min(1),
    name: z.string().min(1),
    fields: z.array(fieldDefinitionSchema),
    source: z.enum(["user", "plugin", "system"]),
    pluginId: z.string().regex(PLUGIN_ID_PATTERN).optional(),
    version: z.number().int().positive(),
    description: z.string().trim().min(1).max(CONTENT_TYPE_DESCRIPTION_MAX_LENGTH).optional(),
    titleField: fieldKeySchema.optional(),
    listColumns: z.array(fieldKeySchema).max(LIST_COLUMNS_MAX).optional(),
    menuOrder: z.number().int().optional(),
  })
  .superRefine((contentType, ctx) => {
    const seen = new Set<string>();
    for (const field of contentType.fields) {
      if (seen.has(field.key)) {
        ctx.addIssue({
          code: "custom",
          path: ["fields"],
          message: `duplicate field key: ${field.key}`,
        });
      }
      seen.add(field.key);
    }

    // titleField は 1 行テキストのフィールドだけを指せる(案 E 4 章「タイトルに使う」)
    if (contentType.titleField !== undefined) {
      const target = contentType.fields.find((field) => field.key === contentType.titleField);
      if (target === undefined || target.type !== "text") {
        ctx.addIssue({
          code: "custom",
          path: ["titleField"],
          message: `titleField must reference a text field: ${contentType.titleField}`,
        });
      }
    }
    if (contentType.listColumns !== undefined) {
      const listed = new Set<string>();
      for (const [index, key] of contentType.listColumns.entries()) {
        if (listed.has(key)) {
          ctx.addIssue({
            code: "custom",
            path: ["listColumns", index],
            message: `duplicate list column: ${key}`,
          });
        } else if (!seen.has(key)) {
          ctx.addIssue({
            code: "custom",
            path: ["listColumns", index],
            message: `listColumns must reference a field: ${key}`,
          });
        }
        listed.add(key);
      }
    }

    if (contentType.source === "plugin") {
      if (contentType.pluginId === undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["pluginId"],
          message: "pluginId is required when source is 'plugin'",
        });
      } else if (
        !PLUGIN_TYPE_KEY_PATTERN.test(contentType.key) ||
        !contentType.key.startsWith(`${contentType.pluginId}.`)
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["key"],
          message: `plugin type key must be namespaced as '${contentType.pluginId}.<name>'`,
        });
      }
      return;
    }

    if (contentType.pluginId !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["pluginId"],
        message: "pluginId is only allowed when source is 'plugin'",
      });
    }
    if (!FIELD_KEY_PATTERN.test(contentType.key)) {
      ctx.addIssue({
        code: "custom",
        path: ["key"],
        message: "type key must be snake_case without dots",
      });
    }
  });

export type ContentTypeDefinition = z.infer<typeof contentTypeDefinitionSchema>;

// 案 E 2.2: タイトルとして表示するフィールドの key。titleField が指す text フィールドが無ければ
// (未指定、または tolerant read で古い定義を読んだ場合)最初の text フィールドに戻す。
export function titleFieldKey(
  definition: Pick<ContentTypeDefinition, "fields" | "titleField">,
): string | undefined {
  const fields = definition.fields;
  if (definition.titleField !== undefined) {
    const target = fields.find((field) => field.key === definition.titleField);
    if (target?.type === "text") {
      return target.key;
    }
  }
  return fields.find((field) => field.type === "text")?.key;
}
