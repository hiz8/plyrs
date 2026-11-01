import { titleFieldKey, WORKFLOW_STATUSES, type ContentTypeDefinition } from "@plyrs/metamodel";
import { z } from "zod";
import { decodeCursor, encodeCursor } from "../public/cursor";
import {
  DEFAULT_LIMIT,
  MAX_FILTER_VALUES,
  MAX_FILTERS,
  MAX_LIMIT,
  MAX_TOTAL_FILTER_VALUES,
  parseScalarValues,
  type ScalarKind,
} from "../public/query";
import { generatedColumnName, indexedColumns } from "./index-ddl";

// design-spec 16.9(M1-2): DO の records.data(JSON)に対する一覧の実行器。文法の解釈(any-of と AND、
// 件数の上限、値の検証)は公開 API の public/query.ts と共有し、SQL の生成はここで新しく書く
// (公開側は投影 DB の索引列、こちらは DO の records の生成列)。
// フィルタとソートは「索引宣言済みフィールド(do/index-ddl.ts の生成列)+ システム列」に限る。
// json_extract のフルスキャンは許さない(未決事項「フィルタできるフィールドの範囲」の仮置き)。
// cursor は (ソートキー, seq) の keyset。削除済みは常に除き、下書きは含む。

const SYSTEM_COLUMNS = {
  status: { column: "status", kind: "text" },
  updatedAt: { column: "updated_at", kind: "date" },
  createdAt: { column: "created_at", kind: "date" },
} as const satisfies Record<string, { column: string; kind: ScalarKind }>;

const filterValueSchema = z.union([z.string(), z.number(), z.boolean()]);

export const recordListInputSchema = z.object({
  type: z.string().min(1),
  filter: z.record(z.string(), z.array(filterValueSchema).min(1).max(MAX_FILTER_VALUES)).optional(),
  sort: z
    .object({
      field: z.string().min(1),
      direction: z.enum(["asc", "desc"]),
    })
    .optional(),
  limit: z.number().int().min(1).max(MAX_LIMIT).optional(),
  cursor: z.string().min(1).optional(),
  // 重複は畳む。状態の種類数を超える配列は重複しか含みえないので受けない(バインド数の上限を守る)
  status: z
    .array(z.enum(WORKFLOW_STATUSES))
    .min(1)
    .max(WORKFLOW_STATUSES.length)
    .transform((statuses) => [...new Set(statuses)])
    .optional(),
});

export type RecordListInput = z.infer<typeof recordListInputSchema>;

export interface RecordSummary {
  id: string;
  type: string;
  status: string;
  seq: number;
  version: number;
  updatedAt: string;
  title?: string;
}

export const recordSummarySchema = z.object({
  id: z.string(),
  type: z.string(),
  status: z.enum(WORKFLOW_STATUSES),
  seq: z.number().int(),
  version: z.number().int(),
  updatedAt: z.iso.datetime(),
  title: z.string().optional(),
});

interface ColumnFilter {
  column: string; // 生成列名またはシステム列名(ユーザー入力ではなく閉じた集合から選ぶ)
  values: (string | number)[];
}

export interface RecordListQuery {
  type: string;
  titleKey: string | undefined;
  filters: ColumnFilter[];
  statuses: string[];
  sort: { column: string; direction: "asc" | "desc" };
  limit: number;
  cursor: { k: string | number; seq: number } | null;
}

export type ParseRecordListResult =
  | { ok: true; query: RecordListQuery }
  | { ok: false; code: "invalid_input"; message: string };

const KIND_BY_FIELD_TYPE: Record<string, ScalarKind> = {
  text: "text",
  select: "text",
  datetime: "date",
  number: "num",
  boolean: "bool",
};

// フィルタ・ソートに使える列を型定義から引く。型定義の生成列は index-ddl.ts と同じ規則で名付ける
function resolveColumn(
  type: ContentTypeDefinition,
  fieldKey: string,
): { column: string; kind: ScalarKind } | null {
  const system = (SYSTEM_COLUMNS as Record<string, { column: string; kind: ScalarKind }>)[fieldKey];
  if (system !== undefined) {
    return system;
  }
  const indexed = indexedColumns(type.fields).find((col) => col.fieldKey === fieldKey);
  if (indexed === undefined) {
    return null;
  }
  const field = type.fields.find((f) => f.key === fieldKey);
  const kind = field === undefined ? undefined : KIND_BY_FIELD_TYPE[field.type];
  if (kind === undefined) {
    return null;
  }
  return { column: generatedColumnName(type.key, fieldKey), kind };
}

function invalid(message: string): ParseRecordListResult {
  return { ok: false, code: "invalid_input", message };
}

// Zod の形は通った入力を、型定義に照らして列と値に解決する
export function parseRecordListInput(
  type: ContentTypeDefinition,
  input: unknown,
): ParseRecordListResult {
  const parsed = recordListInputSchema.safeParse(input);
  if (!parsed.success) {
    return invalid(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  }
  const raw = parsed.data;
  const filters: ColumnFilter[] = [];
  let totalFilterValues = 0;
  for (const [fieldKey, rawValues] of Object.entries(raw.filter ?? {})) {
    if (filters.length >= MAX_FILTERS) {
      return invalid("too many filters");
    }
    // フィルタ値の総数は公開側と同じ上限(1 クエリのバインド数を 100 未満に収める)
    totalFilterValues += rawValues.length;
    if (totalFilterValues > MAX_TOTAL_FILTER_VALUES) {
      return invalid("too many filter values");
    }
    const resolved = resolveColumn(type, fieldKey);
    if (resolved === null) {
      return invalid(`filter field is not indexed: ${fieldKey}`);
    }
    // 値の検証は公開側と共有する(文字列として受け、種別ごとに解釈する)
    const values = parseScalarValues(
      resolved.kind,
      rawValues.map((v) => String(v)),
    );
    if (values === null) {
      return invalid(`bad filter value for ${resolved.kind} field: ${fieldKey}`);
    }
    filters.push({ column: resolved.column, values });
  }
  let sort: RecordListQuery["sort"] = { column: "updated_at", direction: "desc" };
  let sortKind: ScalarKind = "date";
  if (raw.sort !== undefined) {
    const resolved = resolveColumn(type, raw.sort.field);
    if (resolved === null) {
      return invalid(`sort field is not indexed: ${raw.sort.field}`);
    }
    sort = { column: resolved.column, direction: raw.sort.direction };
    sortKind = resolved.kind;
  }
  let cursor: RecordListQuery["cursor"] = null;
  if (raw.cursor !== undefined) {
    const decoded = decodeCursor(raw.cursor);
    const seq = decoded === null ? Number.NaN : Number(decoded.id);
    if (decoded === null || decoded.k === null || !Number.isInteger(seq)) {
      return invalid("bad cursor");
    }
    const expectsNumber = sortKind === "num" || sortKind === "bool";
    if (expectsNumber ? typeof decoded.k !== "number" : typeof decoded.k !== "string") {
      return invalid("bad cursor");
    }
    cursor = { k: decoded.k, seq };
  }
  return {
    ok: true,
    query: {
      type: type.key,
      titleKey: titleFieldKey(type),
      filters,
      statuses: raw.status ?? [],
      sort,
      limit: raw.limit ?? DEFAULT_LIMIT,
      cursor,
    },
  };
}

export interface BuiltRecordListQuery {
  sql: string;
  binds: (string | number)[];
}

function placeholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(", ");
}

// 列名の補間は resolveColumn が返す閉じた集合(生成列名はフィールド key から規則で作る。key は
// metamodel 検証済みの識別子安全な文字列)からのみ。ユーザー入力の値はすべてバインドする。
export function buildListRecordsQuery(
  query: RecordListQuery,
  cursor: RecordListQuery["cursor"] = query.cursor,
): BuiltRecordListQuery {
  const binds: (string | number)[] = [];
  const titleExpr =
    query.titleKey === undefined
      ? "NULL AS title"
      : `json_extract(data, '$.${query.titleKey}') AS title`;
  let sql = `SELECT id, type, status, seq, version, updated_at, ${titleExpr} FROM records WHERE type = ? AND deleted_at IS NULL`;
  binds.push(query.type);
  if (query.statuses.length > 0) {
    sql += ` AND status IN (${placeholders(query.statuses.length)})`;
    binds.push(...query.statuses);
  }
  for (const filter of query.filters) {
    sql += ` AND ${filter.column} IN (${placeholders(filter.values.length)})`;
    binds.push(...filter.values);
  }
  // ソートキーが NULL の行(値を持たない record)は順序を定義できないので対象外(公開側と同じ意味論)
  if (query.sort.column.startsWith("g_")) {
    sql += ` AND ${query.sort.column} IS NOT NULL`;
  }
  if (cursor !== null) {
    const op = query.sort.direction === "desc" ? "<" : ">";
    sql += ` AND (${query.sort.column}, seq) ${op} (?, ?)`;
    binds.push(cursor.k, cursor.seq);
  }
  const dir = query.sort.direction === "desc" ? "DESC" : "ASC";
  sql += ` ORDER BY ${query.sort.column} ${dir}, seq ${dir} LIMIT ?`;
  binds.push(query.limit + 1);
  return { sql, binds };
}

interface ListRow extends Record<string, SqlStorageValue> {
  id: string;
  type: string;
  status: string;
  seq: number;
  version: number;
  updated_at: string;
  title: SqlStorageValue;
  sort_value: SqlStorageValue;
}

export function listRecords(
  sql: SqlStorage,
  query: RecordListQuery,
): { items: RecordSummary[]; nextCursor: string | null } {
  const built = buildListRecordsQuery(query);
  // 次ページの cursor に使うソートキーも一緒に読む
  const withSort = built.sql.replace(
    "SELECT id,",
    `SELECT ${query.sort.column} AS sort_value, id,`,
  );
  const rows = sql.exec<ListRow>(withSort, ...built.binds).toArray();
  const hasMore = rows.length > query.limit;
  const page = hasMore ? rows.slice(0, query.limit) : rows;
  const items = page.map((row) => ({
    id: row.id,
    type: row.type,
    status: row.status,
    seq: row.seq,
    version: row.version,
    updatedAt: row.updated_at,
    ...(typeof row.title === "string" ? { title: row.title } : {}),
  }));
  const last = page[page.length - 1];
  const sortValue = last?.sort_value;
  const nextCursor =
    hasMore &&
    last !== undefined &&
    (typeof sortValue === "string" || typeof sortValue === "number")
      ? encodeCursor({ k: sortValue, id: String(last.seq) })
      : null;
  return { items, nextCursor };
}
