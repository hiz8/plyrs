import type { FieldDefinition } from "@plyrs/metamodel";

export interface IndexedColumn {
  fieldKey: string;
  columnType: "TEXT" | "NUMERIC" | "INTEGER";
}

// 単一値フィールドのみ昇格。multiple select は行分割が必要なため対象外（design-spec §12.2 の
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
  const prevCols = new Map(indexedColumns(prev ?? []).map((col) => [col.fieldKey, col]));
  const nextCols = new Map(indexedColumns(next).map((col) => [col.fieldKey, col]));
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

// key / typeKey は metamodel 検証済み（/^[a-z][a-z0-9_.]*$/）のため、識別子・リテラル埋め込みが安全。
export function applyIndexDdl(
  sql: SqlStorage,
  typeKey: string,
  prev: FieldDefinition[] | null,
  next: FieldDefinition[],
): void {
  const { add, drop } = computeIndexDdlDiff(prev, next);
  for (const col of drop) {
    const name = generatedColumnName(typeKey, col.fieldKey);
    sql.exec(`DROP INDEX IF EXISTS idx_${name}`);
    sql.exec(`ALTER TABLE records DROP COLUMN ${name}`);
  }
  for (const col of add) {
    const name = generatedColumnName(typeKey, col.fieldKey);
    sql.exec(
      `ALTER TABLE records ADD COLUMN ${name} ${col.columnType} GENERATED ALWAYS AS (json_extract(data, '$.${col.fieldKey}')) VIRTUAL`,
    );
    sql.exec(`CREATE INDEX idx_${name} ON records(${name}) WHERE type = '${typeKey}'`);
  }
}
