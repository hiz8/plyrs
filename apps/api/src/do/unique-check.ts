import type { BeforeWriteHook } from "./hooks";

// design-spec §5・33: unique はシステム定義 beforeWrite フックとして強制する。
// unique を持てるのは text / number / datetime のみ（G7 と同日の裁定）。
export const uniqueCheckHook: BeforeWriteHook = (ctx) => {
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
        `SELECT id FROM records WHERE type = ? AND deleted_at IS NULL AND id <> ? AND json_extract(data, '$.${field.key}') = ? LIMIT 1`,
        ctx.contentType.key,
        ctx.recordId,
        value as string | number,
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
