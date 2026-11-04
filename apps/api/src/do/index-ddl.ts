import type { FieldDefinition } from "@plyrs/metamodel";

export interface IndexedColumn {
  fieldKey: string;
  columnType: "TEXT" | "NUMERIC" | "INTEGER";
}

// 単一値フィールドのみ専用カラムへ切り出す。multiple select は行分割が必要なため対象外（design-spec §12.2 の
// projection_index が公開側で担う）。json / richtext / relation はそもそも indexed を持てない。
export function indexedColumns(fields: FieldDefinition[]): IndexedColumn[] {
  const out: IndexedColumn[] = [];
  for (const field of fields) {
    switch (field.type) {
      case "text":
      case "datetime":
        if (field.config?.indexed === true) {
          out.push({ fieldKey: field.key, columnType: "TEXT" });
        }
        break;
      case "number":
        if (field.config?.indexed === true) {
          out.push({ fieldKey: field.key, columnType: "NUMERIC" });
        }
        break;
      case "boolean":
        if (field.config?.indexed === true) {
          out.push({ fieldKey: field.key, columnType: "INTEGER" });
        }
        break;
      case "select":
        if (field.config.indexed === true && field.config.multiple !== true) {
          out.push({ fieldKey: field.key, columnType: "TEXT" });
        }
        break;
      default:
        break;
    }
  }
  return out;
}

// 決定 54(M5a-2): DO 内に生成カラム + 部分インデックスを持つフィールド = indexedColumns ∪ unique
// (text / number / datetime)。unique の重複検査をこのカラムで引くため、indexed でなくても持つ。
// 絞り込みの可否は従来どおり indexedColumns が決める(公開 API と DO の一覧の意味は変えない)。
// カラムの型は indexed のときと同じなので、unique だけ → indexed も付ける、の変更では差が出ない
export function lookupColumns(fields: FieldDefinition[]): IndexedColumn[] {
  const out = indexedColumns(fields);
  const seen = new Set(out.map((col) => col.fieldKey));
  for (const field of fields) {
    if (seen.has(field.key)) {
      continue;
    }
    if ((field.type === "text" || field.type === "datetime") && field.config?.unique === true) {
      out.push({ fieldKey: field.key, columnType: "TEXT" });
    } else if (field.type === "number" && field.config?.unique === true) {
      out.push({ fieldKey: field.key, columnType: "NUMERIC" });
    }
  }
  return out;
}

// do_config のキー。'1' = 既存テナントの unique のフィールドに引き当て用カラムを足し終えた
export const LOOKUP_COLUMNS_FLAG = "lookup_columns_v1";
// alarms.ts の種別。足りないカラムを 1 歩に 1 つずつ足す
export const LOOKUP_COLUMNS_ALARM = "lookup_columns";
export const LOOKUP_COLUMNS_STEP_DELAY_MS = 1_000;

export function sanitizeTypeKey(typeKey: string): string {
  return typeKey.replace(/\./g, "__");
}

export function generatedColumnName(typeKey: string, fieldKey: string): string {
  return `g_${sanitizeTypeKey(typeKey)}_${fieldKey}`;
}

export interface IndexDdlDiff {
  add: IndexedColumn[];
  drop: IndexedColumn[];
}

export function computeIndexDdlDiff(
  prev: FieldDefinition[] | null,
  next: FieldDefinition[],
): IndexDdlDiff {
  const prevCols = new Map(lookupColumns(prev ?? []).map((col) => [col.fieldKey, col]));
  const nextCols = new Map(lookupColumns(next).map((col) => [col.fieldKey, col]));
  const add: IndexedColumn[] = [];
  const drop: IndexedColumn[] = [];
  for (const [key, col] of nextCols) {
    const before = prevCols.get(key);
    if (before === undefined) {
      add.push(col);
    } else if (before.columnType !== col.columnType) {
      drop.push(before);
      add.push(col);
    }
  }
  for (const [key, col] of prevCols) {
    if (!nextCols.has(key)) {
      drop.push(col);
    }
  }
  return { add, drop };
}

// records の生成カラム(g_ で始まる)の名前。PRAGMA table_xinfo は生成カラムも返す(table_info は返さない)
export function existingGeneratedColumns(sql: SqlStorage): Set<string> {
  return new Set(
    sql
      .exec<{ name: string }>("SELECT name FROM pragma_table_xinfo('records')")
      .toArray()
      .map((row) => row.name)
      .filter((name) => name.startsWith("g_")),
  );
}

function addColumn(sql: SqlStorage, typeKey: string, col: IndexedColumn): void {
  const name = generatedColumnName(typeKey, col.fieldKey);
  sql.exec(
    `ALTER TABLE records ADD COLUMN ${name} ${col.columnType} GENERATED ALWAYS AS (json_extract(data, '$.${col.fieldKey}')) VIRTUAL`,
  );
  sql.exec(`CREATE INDEX IF NOT EXISTS idx_${name} ON records(${name}) WHERE type = '${typeKey}'`);
}

// key / typeKey は metamodel 検証済み: field key は /^[a-z][a-z0-9_]*$/（ドット無し）、
// type key はプラグイン型（pluginId.name の位置にドット1個のみ）を除きドット無し。
// いずれも識別子・リテラル埋め込みが安全な厳格な部分集合。
// M5a-2(決定 54): 実在するカラムを見て DDL を出す。既存テナントでは unique だけのフィールドの
// 引き当て用カラムが alarm で足されるまで無いので、無いカラムの drop と二重の add で失敗しないようにする。
// indexed のフィールドのカラムは、差に出なくても無ければ足す(一覧の絞り込みが引くので常に要る)
export function applyIndexDdl(
  sql: SqlStorage,
  typeKey: string,
  prev: FieldDefinition[] | null,
  next: FieldDefinition[],
): void {
  const { add, drop } = computeIndexDdlDiff(prev, next);
  const existing = existingGeneratedColumns(sql);
  for (const col of drop) {
    const name = generatedColumnName(typeKey, col.fieldKey);
    sql.exec(`DROP INDEX IF EXISTS idx_${name}`);
    if (existing.has(name)) {
      sql.exec(`ALTER TABLE records DROP COLUMN ${name}`);
      existing.delete(name);
    }
  }
  const adding = new Map(add.map((col) => [col.fieldKey, col]));
  for (const col of indexedColumns(next)) {
    if (!adding.has(col.fieldKey)) {
      adding.set(col.fieldKey, col);
    }
  }
  for (const col of adding.values()) {
    const name = generatedColumnName(typeKey, col.fieldKey);
    if (!existing.has(name)) {
      addColumn(sql, typeKey, col);
      existing.add(name);
    }
  }
}

// 型の定義が求める引き当て用カラムのうち、まだ無いもの(既存テナントの unique だけのフィールド)
export function missingLookupColumns(
  sql: SqlStorage,
): { typeKey: string; column: IndexedColumn }[] {
  const existing = existingGeneratedColumns(sql);
  const missing: { typeKey: string; column: IndexedColumn }[] = [];
  const rows = sql
    .exec<{ key: string; fields: string }>("SELECT key, fields FROM content_types ORDER BY key")
    .toArray();
  for (const row of rows) {
    for (const column of lookupColumns(JSON.parse(row.fields) as FieldDefinition[])) {
      if (!existing.has(generatedColumnName(row.key, column.fieldKey))) {
        missing.push({ typeKey: row.key, column });
      }
    }
  }
  return missing;
}

export function lookupColumnsReady(sql: SqlStorage): boolean {
  return (
    sql
      .exec<{ value: string }>("SELECT value FROM do_config WHERE key = ?", LOOKUP_COLUMNS_FLAG)
      .toArray()[0]?.value === "1"
  );
}

function markLookupColumnsReady(sql: SqlStorage): void {
  sql.exec("INSERT OR REPLACE INTO do_config (key, value) VALUES (?, '1')", LOOKUP_COLUMNS_FLAG);
}

// 1 歩 = 足りないカラムを 1 つだけ足す(ADD COLUMN + CREATE INDEX。部分インデックスの構築は型の
// records を走査するので 1 つずつ)。残りが無くなったら flag を立てて done
export function addLookupColumnStep(sql: SqlStorage): { added: number; done: boolean } {
  const missing = missingLookupColumns(sql);
  const first = missing[0];
  if (first !== undefined) {
    addColumn(sql, first.typeKey, first.column);
  }
  const done = missing.length <= 1;
  if (done) {
    markLookupColumnsReady(sql);
  }
  return { added: first === undefined ? 0 : 1, done };
}

// DO 起動時(migrate の直後)。DDL は流さず、足りなければ alarm に回す。true = 足し終えている
export function checkLookupColumns(sql: SqlStorage): { ready: boolean } {
  if (lookupColumnsReady(sql)) {
    return { ready: true };
  }
  if (missingLookupColumns(sql).length === 0) {
    markLookupColumnsReady(sql);
    return { ready: true };
  }
  return { ready: false };
}
