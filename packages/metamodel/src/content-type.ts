import { z } from "zod";
import { FIELD_KEY_PATTERN, fieldDefinitionSchema } from "./field-types";

export const PLUGIN_ID_PATTERN = /^[a-z][a-z0-9_]*$/;
export const PLUGIN_TYPE_KEY_PATTERN = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;

export const contentTypeDefinitionSchema = z
  .strictObject({
    id: z.uuid(),
    key: z.string().min(1),
    name: z.string().min(1),
    fields: z.array(fieldDefinitionSchema),
    source: z.enum(["user", "plugin", "system"]),
    pluginId: z.string().regex(PLUGIN_ID_PATTERN).optional(),
    version: z.number().int().positive(),
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
