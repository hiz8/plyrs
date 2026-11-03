// design-spec 16.1(M4-6): 操作ごとの rows read / written の計測。SqlStorage の exec を包み、返した
// カーソルを覚えておいて、操作の後で各カーソルの rowsRead / rowsWritten を合計する(カーソルの値は
// 読み進めた分だけ増えるので、合計は操作がカーソルを使い終えた後に取る)。
// Durable Objects の SQLite は rows read / written で課金されるので、書き込み 1 回の rows read が
// record 数に比例しないこと(ロードマップ 6 章)をこの値で確かめる。

export interface SqlMeterTotals {
  rowsRead: number;
  rowsWritten: number;
}

export function meterSql(sql: SqlStorage): { sql: SqlStorage; totals(): SqlMeterTotals } {
  const cursors: SqlStorageCursor<Record<string, SqlStorageValue>>[] = [];
  const metered = new Proxy(sql, {
    get(target, property, receiver) {
      if (property === "exec") {
        return (query: string, ...bindings: unknown[]) => {
          const cursor = target.exec(query, ...bindings);
          cursors.push(cursor);
          return cursor;
        };
      }
      const value: unknown = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return {
    sql: metered,
    totals: () => ({
      rowsRead: cursors.reduce((sum, cursor) => sum + cursor.rowsRead, 0),
      rowsWritten: cursors.reduce((sum, cursor) => sum + cursor.rowsWritten, 0),
    }),
  };
}
