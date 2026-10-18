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
  // 案 E 2.2: 表示用の任意項目(null は未指定)
  description: string | null;
  titleField: string | null;
  listColumns: string[] | null;
  menuOrder: number | null;
}

export type RegisterContentTypeResult =
  | { ok: true; contentType: ContentTypeRow; applied: boolean }
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
  description: string | null;
  title_field: string | null;
  list_columns: string | null;
  menu_order: number | null;
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
    description: row.description,
    titleField: row.title_field,
    listColumns: row.list_columns === null ? null : (JSON.parse(row.list_columns) as string[]),
    menuOrder: row.menu_order,
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
    // 未指定の項目はキーごと省く(strictObject の再検証と、定義同士の比較を素直にするため)
    ...(row.description === null ? {} : { description: row.description }),
    ...(row.titleField === null ? {} : { titleField: row.titleField }),
    ...(row.listColumns === null ? {} : { listColumns: row.listColumns }),
    ...(row.menuOrder === null ? {} : { menuOrder: row.menuOrder }),
  };
}

// 表示用の任意項目を DB の列の値へ(未指定は NULL)
function displayColumns(def: ContentTypeDefinition) {
  return {
    description: def.description ?? null,
    titleField: def.titleField ?? null,
    listColumns: def.listColumns ?? null,
    menuOrder: def.menuOrder ?? null,
  };
}

export function registerContentTypeCore(
  sql: SqlStorage,
  input: unknown,
  now: string,
  options: { allowSystem?: boolean; allowPlugin?: boolean } = {},
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
  // Phase 9: プラグイン名前空間はモジュールシステム専有(§4.1)。クライアント経由の登録を
  // 許すと、モジュール有効化時の固定 ID と衝突して enable が type_conflict で恒久失敗する。
  if (options.allowPlugin !== true && (def.source === "plugin" || prev?.source === "plugin")) {
    return {
      ok: false,
      code: "forbidden",
      message: "plugin content types are managed by modules",
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
  // §5 軽微の消化: 同一定義の再登録は no-op(version を進めない)。ensure-asset-type.ts と
  // 同じく、比較は zod 正規化後の値同士で行う(parsed.data は正規化済み・DB の prev.fields も
  // 保存時に正規化済み)。冪等マニフェスト再配信(Phase 9)が「再適用で version が動かない」
  // ことに依存する。
  const display = displayColumns(def);
  if (
    prev !== null &&
    prev.name === def.name &&
    prev.source === def.source &&
    prev.pluginId === (def.pluginId ?? null) &&
    JSON.stringify(prev.fields) === JSON.stringify(def.fields) &&
    prev.description === display.description &&
    prev.titleField === display.titleField &&
    JSON.stringify(prev.listColumns) === JSON.stringify(display.listColumns) &&
    prev.menuOrder === display.menuOrder
  ) {
    return { ok: true, contentType: prev, applied: false };
  }
  // version はサーバー管理（入力の version は無視する）
  const version = prev === null ? 1 : prev.version + 1;
  const fieldsJson = JSON.stringify(def.fields);
  const listColumnsJson = display.listColumns === null ? null : JSON.stringify(display.listColumns);
  if (prev === null) {
    sql.exec(
      "INSERT INTO content_types (id, key, name, fields, source, plugin_id, created_at, updated_at, version, description, title_field, list_columns, menu_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      def.id,
      def.key,
      def.name,
      fieldsJson,
      def.source,
      def.pluginId ?? null,
      now,
      now,
      version,
      display.description,
      display.titleField,
      listColumnsJson,
      display.menuOrder,
    );
  } else {
    sql.exec(
      "UPDATE content_types SET name = ?, fields = ?, source = ?, plugin_id = ?, updated_at = ?, version = ?, description = ?, title_field = ?, list_columns = ?, menu_order = ? WHERE id = ?",
      def.name,
      fieldsJson,
      def.source,
      def.pluginId ?? null,
      now,
      version,
      display.description,
      display.titleField,
      listColumnsJson,
      display.menuOrder,
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
      ...display,
    },
    applied: true,
  };
}

export type DeleteContentTypeResult =
  | { ok: true; key: string }
  | { ok: false; code: "not_found" | "forbidden" | "type_not_empty"; message: string };

// 案 E 5.4: コンテンツが 0 件の型だけを削除できる(コンテンツごと消す操作は設けない)。
// 削除済みのコンテンツ(トゥームストーン)は同期の削除伝搬に要るため残し、件数にも数えない。
// 公開版は削除時に cascadeUnpublish で消えるが、念のため残っていれば拒否する。
// 他の型の relation が allowedTypes でこの key を指していても、関係はソフト参照のため妨げない。
export function deleteContentTypeCore(sql: SqlStorage, key: string): DeleteContentTypeResult {
  const prev = loadContentTypeByKey(sql, key);
  if (prev === null) {
    return { ok: false, code: "not_found", message: `content type not found: ${key}` };
  }
  if (prev.source !== "user") {
    return {
      ok: false,
      code: "forbidden",
      message:
        prev.source === "system"
          ? "system content types are managed by the platform"
          : "plugin content types are managed by modules",
    };
  }
  const live = sql
    .exec<{ count: number }>(
      "SELECT COUNT(*) AS count FROM records WHERE type = ? AND deleted_at IS NULL",
      key,
    )
    .one().count;
  const published = sql
    .exec<{ count: number }>(
      "SELECT COUNT(*) AS count FROM published_snapshots WHERE type = ?",
      key,
    )
    .one().count;
  if (live > 0 || published > 0) {
    return {
      ok: false,
      code: "type_not_empty",
      message: `content type '${key}' still has ${live} records (${published} published)`,
    };
  }
  // 型ごとに作った生成列とインデックスを片付けてから行を消す
  applyIndexDdl(sql, key, prev.fields, []);
  sql.exec("DELETE FROM content_types WHERE id = ?", prev.id);
  return { ok: true, key };
}
