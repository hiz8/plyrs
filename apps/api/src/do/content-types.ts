import {
  contentTypeDefinitionSchema,
  type ContentTypeDefinition,
  type FieldDefinition,
} from "@plyrs/metamodel";
import type { z } from "zod";

interface SqlStorage {
  exec<T extends Record<string, any>>(
    query: string,
    ...bindings: any[]
  ): { toArray(): T[]; one(): T | undefined };
}

export interface ContentTypeRow {
  id: string;
  key: string;
  name: string;
  fields: FieldDefinition[];
  source: "user" | "plugin" | "system";
  pluginId: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export type RegisterContentTypeResult =
  | { ok: true; contentType: ContentTypeRow }
  | { ok: false; code: "validation_failed" | "id_mismatch"; message: string };

interface RawContentTypeRow extends Record<string, any> {
  id: string;
  key: string;
  name: string;
  fields: string;
  source: string;
  plugin_id: string | null;
  created_at: string;
  updated_at: string;
  version: number;
}

export function issuesToMessage(issues: z.core.$ZodIssue[]): string {
  return issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
}

export function loadContentTypeByKey(sql: SqlStorage, key: string): ContentTypeRow | null {
  const row = sql
    .exec<RawContentTypeRow>("SELECT * FROM content_types WHERE key = ?", key)
    .toArray()[0];
  if (row === undefined) {
    return null;
  }
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    fields: JSON.parse(row.fields) as FieldDefinition[],
    source: row.source as ContentTypeRow["source"],
    pluginId: row.plugin_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: row.version,
  };
}

export function rowToDefinition(row: ContentTypeRow): ContentTypeDefinition {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    fields: row.fields,
    source: row.source,
    pluginId: row.pluginId ?? undefined,
    version: row.version,
  };
}

export function registerContentTypeCore(
  sql: SqlStorage,
  input: unknown,
  now: string,
): RegisterContentTypeResult {
  const parsed = contentTypeDefinitionSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: "validation_failed", message: issuesToMessage(parsed.error.issues) };
  }
  const def = parsed.data;
  const prev = loadContentTypeByKey(sql, def.key);
  if (prev !== null && prev.id !== def.id) {
    return {
      ok: false,
      code: "id_mismatch",
      message: `type key '${def.key}' is already registered with a different id`,
    };
  }
  // version はサーバー管理（入力の version は無視する）
  const version = prev === null ? 1 : prev.version + 1;
  const fieldsJson = JSON.stringify(def.fields);
  if (prev === null) {
    sql.exec(
      "INSERT INTO content_types (id, key, name, fields, source, plugin_id, created_at, updated_at, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      def.id,
      def.key,
      def.name,
      fieldsJson,
      def.source,
      def.pluginId ?? null,
      now,
      now,
      version,
    );
  } else {
    sql.exec(
      "UPDATE content_types SET name = ?, fields = ?, source = ?, plugin_id = ?, updated_at = ?, version = ? WHERE id = ?",
      def.name,
      fieldsJson,
      def.source,
      def.pluginId ?? null,
      now,
      version,
      def.id,
    );
  }
  return {
    ok: true,
    contentType: {
      id: def.id,
      key: def.key,
      name: def.name,
      fields: def.fields,
      source: def.source,
      pluginId: def.pluginId ?? null,
      createdAt: prev?.createdAt ?? now,
      updatedAt: now,
      version,
    },
  };
}
