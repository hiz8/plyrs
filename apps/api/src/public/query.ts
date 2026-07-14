import type { Catalog } from "./catalog";
import { decodeCursor } from "./cursor";

// §12.4 のクエリ語彙（裁定 2026-07-14: filter[] ブラケット記法）。
// - filter[field]=v は同一キー繰り返しで any-of、異なるフィールド間で AND。
// - フィルタ/ソートは索引宣言済みフィールド（カタログに載っているもの）に限る。
// - ソートは単一値フィールドのみ（複数値は行分割で順序が未定義 → 400）。
// - 予約パラメータ以外は 400（無制限クエリを許さない・キャッシュキーの分裂を防ぐ）。

export interface ScalarFilter {
  target: "index";
  fieldKey: string;
  column: "value_text" | "value_num" | "value_date";
  values: (string | number)[];
}

export interface RelationFilter {
  target: "relations";
  fieldKey: string;
  values: string[];
}

export type ListFilter = ScalarFilter | RelationFilter;

export interface ListSort {
  fieldKey: string;
  // published_at はシステム列（projected_records）、それ以外は projection_index の型別カラム
  column: "published_at" | "value_text" | "value_num" | "value_date";
  direction: "asc" | "desc";
}

export interface ListCursor {
  k: string | number;
  id: string;
}

export interface ListQuery {
  filters: ListFilter[];
  sort: ListSort;
  limit: number;
  cursor: ListCursor | null;
  include: string[];
}

export type ParseResult = { ok: true; query: ListQuery } | { ok: false; error: string };

export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;
const MAX_FILTERS = 8;
const MAX_FILTER_VALUES = 20;
const MAX_INCLUDE_FIELDS = 5;

const FILTER_KEY_PATTERN = /^filter\[([a-z][a-z0-9_]*)\]$/u;
const SORT_PATTERN = /^(-?)([a-z][a-z0-9_]*)$/u;
const RESERVED_PARAMS = new Set(["sort", "limit", "cursor", "include"]);

const COLUMN_BY_KIND = {
  text: "value_text",
  num: "value_num",
  bool: "value_num",
  date: "value_date",
} as const;

type ScalarKind = keyof typeof COLUMN_BY_KIND;

function parseScalarValues(kind: ScalarKind, raw: string[]): (string | number)[] | null {
  switch (kind) {
    case "num": {
      const values = raw.map((value) => Number(value));
      return values.every((value) => Number.isFinite(value)) && raw.every((v) => v.trim() !== "")
        ? values
        : null;
    }
    case "bool": {
      const values: number[] = [];
      for (const value of raw) {
        if (value === "true") {
          values.push(1);
        } else if (value === "false") {
          values.push(0);
        } else {
          return null;
        }
      }
      return values;
    }
    default:
      return raw;
  }
}

export function parseInclude(
  raw: string,
  catalog: Catalog,
): { ok: true; include: string[] } | { ok: false; error: string } {
  const keys = raw
    .split(",")
    .map((key) => key.trim())
    .filter((key) => key.length > 0);
  if (keys.length === 0 || keys.length > MAX_INCLUDE_FIELDS) {
    return { ok: false, error: "bad include" };
  }
  for (const key of keys) {
    const entry = catalog.get(key);
    if (entry === undefined || entry.kind !== "relation") {
      return { ok: false, error: `include field is not a relation: ${key}` };
    }
  }
  return { ok: true, include: [...new Set(keys)].sort() };
}

export function parseListQuery(params: Record<string, string[]>, catalog: Catalog): ParseResult {
  const filters: ListFilter[] = [];
  let sortParam: string | null = null;
  let limitParam: string | null = null;
  let cursorParam: string | null = null;
  let includeParam: string | null = null;

  for (const [key, rawValues] of Object.entries(params)) {
    const filterMatch = FILTER_KEY_PATTERN.exec(key);
    if (filterMatch !== null) {
      const fieldKey = filterMatch[1] ?? "";
      const entry = catalog.get(fieldKey);
      if (entry === undefined) {
        return { ok: false, error: `filter field is not indexed: ${fieldKey}` };
      }
      if (rawValues.length === 0 || rawValues.length > MAX_FILTER_VALUES) {
        return { ok: false, error: `bad filter value count: ${fieldKey}` };
      }
      if (filters.length >= MAX_FILTERS) {
        return { ok: false, error: "too many filters" };
      }
      if (entry.kind === "relation") {
        filters.push({ target: "relations", fieldKey, values: rawValues });
      } else {
        const values = parseScalarValues(entry.kind, rawValues);
        if (values === null) {
          return { ok: false, error: `bad filter value for ${entry.kind} field: ${fieldKey}` };
        }
        filters.push({ target: "index", fieldKey, column: COLUMN_BY_KIND[entry.kind], values });
      }
      continue;
    }
    if (!RESERVED_PARAMS.has(key)) {
      return { ok: false, error: `unknown query param: ${key}` };
    }
    const single = rawValues.length === 1 ? rawValues[0] : undefined;
    if (single === undefined) {
      return { ok: false, error: `query param must appear once: ${key}` };
    }
    if (key === "sort") {
      sortParam = single;
    } else if (key === "limit") {
      limitParam = single;
    } else if (key === "cursor") {
      cursorParam = single;
    } else {
      includeParam = single;
    }
  }

  // sort。カタログ優先: ユーザーが published_at という索引フィールドを宣言していたら
  // そちら（projection_index）を使い、無ければシステム列 projected_records.published_at。
  // 既定ソート（sort 未指定）は常にシステム列（カタログの有無に依存させない）。
  let sort: ListSort = { fieldKey: "published_at", column: "published_at", direction: "desc" };
  if (sortParam !== null) {
    const match = SORT_PATTERN.exec(sortParam);
    if (match === null) {
      return { ok: false, error: `bad sort: ${sortParam}` };
    }
    const direction: "asc" | "desc" = match[1] === "-" ? "desc" : "asc";
    const fieldKey = match[2] ?? "";
    const entry = catalog.get(fieldKey);
    if (entry !== undefined) {
      if (entry.kind === "relation") {
        return { ok: false, error: `sort field is not sortable: ${fieldKey}` };
      }
      if (entry.multi) {
        return { ok: false, error: `sort field is multi-valued: ${fieldKey}` };
      }
      sort = { fieldKey, column: COLUMN_BY_KIND[entry.kind], direction };
    } else if (fieldKey === "published_at") {
      sort = { fieldKey, column: "published_at", direction };
    } else {
      return { ok: false, error: `sort field is not indexed: ${fieldKey}` };
    }
  }

  let limit = DEFAULT_LIMIT;
  if (limitParam !== null) {
    if (!/^\d{1,3}$/u.test(limitParam)) {
      return { ok: false, error: `bad limit: ${limitParam}` };
    }
    limit = Number(limitParam);
    if (limit < 1 || limit > MAX_LIMIT) {
      return { ok: false, error: `bad limit: ${limitParam}` };
    }
  }

  let cursor: ListCursor | null = null;
  if (cursorParam !== null) {
    const decoded = decodeCursor(cursorParam);
    if (decoded === null || decoded.k === null) {
      return { ok: false, error: "bad cursor" };
    }
    const expectsNumber = sort.column === "value_num";
    if (expectsNumber ? typeof decoded.k !== "number" : typeof decoded.k !== "string") {
      return { ok: false, error: "bad cursor" };
    }
    cursor = { k: decoded.k, id: decoded.id };
  }

  let include: string[] = [];
  if (includeParam !== null) {
    const result = parseInclude(includeParam, catalog);
    if (!result.ok) {
      return result;
    }
    include = result.include;
  }

  return { ok: true, query: { filters, sort, limit, cursor, include } };
}
