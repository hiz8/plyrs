import type { ListQuery } from "./query";

// 一覧クエリの物理形（§12.2 / ロードマップ §9）:
// - 実体は必ず projected_records から取る。projection_index は record_id を絞る索引専用
//   （レコード復元に使わない）。フィルタは非相関 IN サブクエリ（プランナが一度だけ実体化する）。
// - ソートがシステム列（published_at）なら (tenant_id, type, published_at) 索引で完結。
//   索引フィールドのソートは projection_index を 1 回 join する（単一値フィールドのみ =
//   parseListQuery が保証するため join は行を複製しない）。
// - keyset ページネーションは (ソート値, record_id) の行値比較。LIMIT は limit+1 で
//   次ページ有無を呼び出し側が判定する。
// 列名の文字列補間は query.ts の閉じた union（value_text|value_num|value_date|published_at）
// 由来のみで、ユーザー入力は一切補間しない。

export interface BuiltQuery {
  sql: string;
  binds: (string | number)[];
}

export interface ListRow {
  record_id: string;
  type: string;
  slug: string | null;
  published_at: string;
  data: string;
  publish_seq: number;
  sort_value?: string | number;
}

export function placeholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(", ");
}

// D1 のバインド上限（100/クエリ）に対する IN 句展開の安全マージン。placeholders() と同じく
// 「バインド列を組み立てる低水準ヘルパー」としてここに置く（Phase 5c: include.ts と
// routes/public.ts に重複していた定義の共有先）。
export const D1_BIND_CHUNK_SIZE = 50;

export function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

export function buildListQuery(tenantId: string, type: string, query: ListQuery): BuiltQuery {
  const { sort, filters, cursor, limit } = query;
  const usesIndexSort = sort.column !== "published_at";
  const binds: (string | number)[] = [];

  let sql = "SELECT r.record_id, r.type, r.slug, r.published_at, r.data, r.publish_seq";
  if (usesIndexSort) {
    sql += `, s.${sort.column} AS sort_value`;
  }
  sql += " FROM projected_records r";
  if (usesIndexSort) {
    // IS NOT NULL: 型定義変更で kind が変わった直後の stale 行が NULL ソート値を運んで
    // カーソルを壊さないように（値を持つ行だけがソート対象という意味論にも一致する）
    sql +=
      " JOIN projection_index s ON s.tenant_id = r.tenant_id AND s.type = r.type" +
      ` AND s.record_id = r.record_id AND s.field_key = ? AND s.${sort.column} IS NOT NULL`;
    binds.push(sort.fieldKey);
  }
  sql += " WHERE r.tenant_id = ? AND r.type = ?";
  binds.push(tenantId, type);

  for (const filter of filters) {
    if (filter.target === "relations") {
      sql +=
        " AND r.record_id IN (SELECT source_id FROM projected_relations" +
        ` WHERE tenant_id = ? AND source_field = ? AND target_id IN (${placeholders(filter.values.length)}))`;
      binds.push(tenantId, filter.fieldKey, ...filter.values);
    } else {
      sql +=
        " AND r.record_id IN (SELECT record_id FROM projection_index" +
        ` WHERE tenant_id = ? AND type = ? AND field_key = ? AND ${filter.column} IN (${placeholders(filter.values.length)}))`;
      binds.push(tenantId, type, filter.fieldKey, ...filter.values);
    }
  }

  const sortExpr = usesIndexSort ? `s.${sort.column}` : "r.published_at";
  if (cursor !== null) {
    const op = sort.direction === "desc" ? "<" : ">";
    sql += ` AND (${sortExpr}, r.record_id) ${op} (?, ?)`;
    binds.push(cursor.k, cursor.id);
  }
  const dir = sort.direction === "desc" ? "DESC" : "ASC";
  sql += ` ORDER BY ${sortExpr} ${dir}, r.record_id ${dir} LIMIT ?`;
  binds.push(limit + 1);
  return { sql, binds };
}
