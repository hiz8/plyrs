import {
  contentTypeDefinitionSchema,
  type ContentTypeDefinition,
  type FieldDefinition,
} from "@plyrs/metamodel";
import type { z } from "zod";
import { applyIndexDdl } from "./index-ddl";

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
  | {
      ok: false;
      code: "validation_failed" | "id_mismatch" | "key_mismatch" | "forbidden";
      message: string;
    };

interface RawContentTypeRow extends Record<string, SqlStorageValue> {
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

function rowToContentTypeRow(row: RawContentTypeRow): ContentTypeRow {
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

export function loadContentTypeByKey(sql: SqlStorage, key: string): ContentTypeRow | null {
  const row = sql
    .exec<RawContentTypeRow>("SELECT * FROM content_types WHERE key = ?", key)
    .toArray()[0];
  return row === undefined ? null : rowToContentTypeRow(row);
}

// Finding 3（important）: 再投影の終端 sweep がカタログ（projection_fields）を content_types から
// 作り直せるように、全 content_types 行をロードする。getProjectionPayload / getPublishedPage
// （do/publish.ts）と同じ「DO の SQLite を読むだけの素朴な関数」という様式に合わせる。
export function loadAllContentTypeRows(sql: SqlStorage): ContentTypeRow[] {
  return sql
    .exec<RawContentTypeRow>("SELECT * FROM content_types ORDER BY key ASC")
    .toArray()
    .map(rowToContentTypeRow);
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
  options: { allowSystem?: boolean } = {},
): RegisterContentTypeResult {
  const parsed = contentTypeDefinitionSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: "validation_failed", message: issuesToMessage(parsed.error.issues) };
  }
  const def = parsed.data;
  const prev = loadContentTypeByKey(sql, def.key);
  // Phase 8: システム型はコード配布(ensureAssetContentType)だけが書ける。クライアント経由の
  // 登録・変更を許すと、r2_key 等のシステム管理フィールド定義を挿げ替えて配信を壊せてしまう
  // (フィールド値の防御 = assetGuardHook とは別レイヤーの、型定義そのものの防御)。
  if (options.allowSystem !== true && (def.source === "system" || prev?.source === "system")) {
    return {
      ok: false,
      code: "forbidden",
      message: "system content types are managed by the platform",
    };
  }
  if (prev !== null && prev.id !== def.id) {
    return {
      ok: false,
      code: "id_mismatch",
      message: `type key '${def.key}' is already registered with a different id`,
    };
  }
  const existingKeyForId = sql
    .exec<{ key: string }>("SELECT key FROM content_types WHERE id = ?", def.id)
    .toArray()[0];
  if (existingKeyForId !== undefined && existingKeyForId.key !== def.key) {
    return {
      ok: false,
      code: "key_mismatch",
      message: `type id '${def.id}' is already registered under key '${existingKeyForId.key}' (renaming type keys is not supported)`,
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
  applyIndexDdl(sql, def.key, prev?.fields ?? null, def.fields);
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
