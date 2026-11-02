import {
  richTextEnvelopeSchema,
  titleFieldKey,
  type ContentTypeDefinition,
} from "@plyrs/metamodel";
import { richTextPlainText } from "@plyrs/richtext";
import { loadAllContentTypeRows, rowToDefinition } from "./content-types";
import type { RecordSummary } from "./list-records";

// 16.9(M2-9): 下書きを含む全文検索。DO-SQLite の FTS5 仮想テーブル records_fts(trigram)を
// records の派生データとして保ち、書き込み(writeRecordCore)・削除(deleteRecordCore)のたびに
// 張り直す。復元は writeRecordCore 経由なので自動で戻る。既存 record は DO 起動時の一回限りの
// 再索引(ensureSearchIndex)と super の再索引(reindexAll)で入れる。
// 公開側(公開用 DB)の全文検索は引き続き非目標(第 13 章)。

// trigram tokenizer は 3 文字未満の語に一致しないため、短い語は LIKE に落とす
export const SEARCH_MATCH_MIN_LENGTH = 3;
export const SEARCH_INDEXED_FLAG = "search_indexed";

// 索引に入れるテキスト: text フィールドの値と richtext のプレーンテキストを空白で連結する。
// json / relation / 数値 / 日時 / select は含めない(型定義に無いフィールドも含めない)
export function searchText(
  definition: ContentTypeDefinition,
  data: Record<string, unknown>,
): string {
  const parts: string[] = [];
  for (const field of definition.fields) {
    const value = data[field.key];
    if (field.type === "text" && typeof value === "string" && value !== "") {
      parts.push(value);
    } else if (field.type === "richtext") {
      const parsed = richTextEnvelopeSchema.safeParse(value);
      if (parsed.success) {
        const text = richTextPlainText(parsed.data);
        if (text !== "") {
          parts.push(text);
        }
      }
    }
  }
  return parts.join(" ");
}

export function indexRecord(sql: SqlStorage, recordId: string, type: string, text: string): void {
  sql.exec("DELETE FROM records_fts WHERE record_id = ?", recordId);
  sql.exec(
    "INSERT INTO records_fts (record_id, type, text) VALUES (?, ?, ?)",
    recordId,
    type,
    text,
  );
}

export function removeFromIndex(sql: SqlStorage, recordId: string): void {
  sql.exec("DELETE FROM records_fts WHERE record_id = ?", recordId);
}

interface IndexRow extends Record<string, SqlStorageValue> {
  id: string;
  type: string;
  data: string;
}

// 全 records(削除済みを除く)を現在の型定義で抽出し直す。型が無い record は索引から外す。
// 戻り値は索引に入れた件数
export function reindexAll(sql: SqlStorage): number {
  const definitions = new Map(
    loadAllContentTypeRows(sql).map((row) => [row.key, rowToDefinition(row)] as const),
  );
  sql.exec("DELETE FROM records_fts");
  let indexed = 0;
  const rows = sql
    .exec<IndexRow>("SELECT id, type, data FROM records WHERE deleted_at IS NULL ORDER BY seq")
    .toArray();
  for (const row of rows) {
    const definition = definitions.get(row.type);
    if (definition === undefined) {
      continue;
    }
    const data = JSON.parse(row.data) as Record<string, unknown>;
    sql.exec(
      "INSERT INTO records_fts (record_id, type, text) VALUES (?, ?, ?)",
      row.id,
      row.type,
      searchText(definition, data),
    );
    indexed += 1;
  }
  return indexed;
}

// DO 起動時の一回限りの再索引。do_config.search_indexed が無ければ全件を索引に入れて '1' を書く
// (マイグレーションは SQL だけなので型定義の解釈ができず、ここで行う)。再索引したら件数、不要なら null
export function ensureSearchIndex(sql: SqlStorage): number | null {
  const done = sql
    .exec<{ value: string }>("SELECT value FROM do_config WHERE key = ?", SEARCH_INDEXED_FLAG)
    .toArray()[0];
  if (done !== undefined) {
    return null;
  }
  const indexed = reindexAll(sql);
  sql.exec("INSERT OR REPLACE INTO do_config (key, value) VALUES (?, '1')", SEARCH_INDEXED_FLAG);
  return indexed;
}

export interface SearchQuery {
  query: string;
  type?: string;
  limit: number;
}

export type SearchHit = RecordSummary & { snippet: string };

interface SearchRow extends Record<string, SqlStorageValue> {
  id: string;
  type: string;
  status: string;
  seq: number;
  version: number;
  updated_at: string;
  data: string;
  text: string;
  snippet: string | null;
}

const SNIPPET_CONTEXT = 24;

// LIKE 経路の snippet(FTS の snippet() は MATCH の文脈でしか使えない)。最初の語の前後を切り出す
function likeSnippet(text: string, terms: string[]): string {
  const lower = text.toLowerCase();
  const first = terms[0] ?? "";
  const at = first === "" ? -1 : lower.indexOf(first.toLowerCase());
  if (at < 0) {
    return text.length > SNIPPET_CONTEXT * 2 ? `${text.slice(0, SNIPPET_CONTEXT * 2)}…` : text;
  }
  const start = Math.max(0, at - SNIPPET_CONTEXT);
  const end = Math.min(text.length, at + first.length + SNIPPET_CONTEXT);
  return `${start > 0 ? "…" : ""}${text.slice(start, at)}[${text.slice(at, at + first.length)}]${text.slice(at + first.length, end)}${end < text.length ? "…" : ""}`;
}

function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

// 語ごとに二重引用符で囲む(FTS5 の演算子・記号を文字列として扱う。内側の引用符は 2 つ重ねる)
function matchExpression(terms: string[]): string {
  return terms.map((term) => `"${term.replaceAll('"', '""')}"`).join(" ");
}

export function searchRecords(sql: SqlStorage, query: SearchQuery): { items: SearchHit[] } {
  const terms = query.query.split(/\s+/).filter((term) => term !== "");
  if (terms.length === 0) {
    return { items: [] };
  }
  const useMatch = terms.every((term) => term.length >= SEARCH_MATCH_MIN_LENGTH);
  const typeFilter = query.type === undefined ? "" : " AND f.type = ?";
  const typeBinds = query.type === undefined ? [] : [query.type];
  const columns = "r.id, r.type, r.status, r.seq, r.version, r.updated_at, r.data, f.text";
  let rows: SearchRow[];
  if (useMatch) {
    rows = sql
      .exec<SearchRow>(
        `SELECT ${columns}, snippet(records_fts, 2, '[', ']', '…', 12) AS snippet FROM records_fts f JOIN records r ON r.id = f.record_id WHERE records_fts MATCH ?${typeFilter} AND r.deleted_at IS NULL ORDER BY rank, r.updated_at DESC LIMIT ?`,
        matchExpression(terms),
        ...typeBinds,
        query.limit,
      )
      .toArray();
  } else {
    const likes = terms.map(() => "f.text LIKE ? ESCAPE '\\'").join(" AND ");
    rows = sql
      .exec<SearchRow>(
        `SELECT ${columns}, NULL AS snippet FROM records_fts f JOIN records r ON r.id = f.record_id WHERE ${likes}${typeFilter} AND r.deleted_at IS NULL ORDER BY r.updated_at DESC LIMIT ?`,
        ...terms.map((term) => `%${escapeLike(term)}%`),
        ...typeBinds,
        query.limit,
      )
      .toArray();
  }
  const titleKeys = new Map(
    loadAllContentTypeRows(sql).map(
      (row) => [row.key, titleFieldKey(rowToDefinition(row))] as const,
    ),
  );
  return {
    items: rows.map((row) => {
      const titleKey = titleKeys.get(row.type);
      const data = JSON.parse(row.data) as Record<string, unknown>;
      const title = titleKey === undefined ? undefined : data[titleKey];
      return {
        id: row.id,
        type: row.type,
        status: row.status,
        seq: row.seq,
        version: row.version,
        updatedAt: row.updated_at,
        ...(typeof title === "string" ? { title } : {}),
        snippet: row.snippet ?? likeSnippet(row.text, terms),
      };
    }),
  };
}
