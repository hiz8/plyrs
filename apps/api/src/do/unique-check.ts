import type { BeforeWriteHook } from "./hooks";
import { generatedColumnName, indexedColumns } from "./index-ddl";

// design-spec §5・33: unique はシステム定義 beforeWrite フックとして強制する。
// unique を持てるのは text / number / datetime のみ（G7 と同日の決定）。
// M4-6(ロードマップ 6 章): indexed のフィールドは生成カラムの部分インデックス
// (idx_g_<type>_<field>、WHERE type = '<type>')で引く。部分インデックスの条件はリテラルでないと
// SQLite が使わないので、型の key はリテラルで埋め込む(key は metamodel 検証済みで安全。index-ddl.ts)。
// M5a-2(決定 54): unique のフィールドは indexed でなくても引き当て用の生成カラムを持つ(lookupColumns)。
// 既存テナントでは alarm で足し終えるまでカラムが無いので、indexed でなく ctx.lookupReady が偽なら従来どおり
// 型の record を走査する。比較は生成カラムの affinity(TEXT / NUMERIC)に従う(数値と数字の文字列など、
// json_extract より厳しくなる場合がある。design-spec §5)
function clashQuery(typeKey: string, fieldKey: string, useColumn: boolean): string {
  return useColumn
    ? `SELECT id FROM records WHERE type = '${typeKey}' AND ${generatedColumnName(typeKey, fieldKey)} = ? AND deleted_at IS NULL AND id <> ? LIMIT 1`
    : `SELECT id FROM records WHERE type = '${typeKey}' AND json_extract(data, '$.${fieldKey}') = ? AND deleted_at IS NULL AND id <> ? LIMIT 1`;
}

export const uniqueCheckHook: BeforeWriteHook = (ctx) => {
  const indexed = new Set(indexedColumns(ctx.contentType.fields).map((col) => col.fieldKey));
  for (const field of ctx.contentType.fields) {
    if (field.type !== "text" && field.type !== "number" && field.type !== "datetime") {
      continue;
    }
    if (field.config?.unique !== true) {
      continue;
    }
    const value = ctx.data[field.key];
    if (value === undefined) {
      continue;
    }
    const clash = ctx.sql
      .exec<{ id: string }>(
        clashQuery(ctx.contentType.key, field.key, ctx.lookupReady || indexed.has(field.key)),
        value as string | number,
        ctx.recordId,
      )
      .toArray()[0];
    if (clash !== undefined) {
      return {
        code: "unique_violation",
        message: `field '${field.key}' must be unique within type '${ctx.contentType.key}' (conflicts with record ${clash.id})`,
      };
    }
  }
  return null;
};
