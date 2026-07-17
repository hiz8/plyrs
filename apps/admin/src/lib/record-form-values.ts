import { buildRecordInputSchema, type ContentTypeDefinition } from "@plyrs/metamodel";

// 動的フォームの UI 状態（draft）と records の input 形式の変換層。
// - draft: text/number/datetime/json は string、boolean は boolean、
//   multiple-select / many-relation は string[]、one-relation は合成キー string、
//   richtext は不透明値（編集しない — 裁定 1）。
// - 空 draft は「キーを省略」に写す（空文字列を書き込まない）。
// - baseInput の未知キー・richtext は保持(遅延適合 = design-spec §4.2)。
export type DraftValues = Record<string, unknown>;

// type key(snake_case)にも UUID にも現れない Unit Separator(U+001F)を区切りに使う
const RELATION_KEY_SEPARATOR = "\u001f";

export function relationDraftKey(ref: { type: string; id: string }): string {
  return `${ref.type}${RELATION_KEY_SEPARATOR}${ref.id}`;
}

export function parseRelationDraftKey(key: string): { type: string; id: string } | null {
  const index = key.indexOf(RELATION_KEY_SEPARATOR);
  if (index <= 0 || index === key.length - 1) {
    return null;
  }
  return { type: key.slice(0, index), id: key.slice(index + 1) };
}

function isRelationRef(value: unknown): value is { type: string; id: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { type?: unknown }).type === "string" &&
    typeof (value as { id?: unknown }).id === "string"
  );
}

export function toDraftValues(
  contentType: ContentTypeDefinition,
  input: Record<string, unknown>,
): DraftValues {
  const draft: DraftValues = {};
  for (const field of contentType.fields) {
    const value = input[field.key];
    switch (field.type) {
      case "text":
      case "datetime":
        draft[field.key] = typeof value === "string" ? value : "";
        break;
      case "number":
        draft[field.key] = typeof value === "number" ? String(value) : "";
        break;
      case "boolean":
        draft[field.key] = value === true;
        break;
      case "json":
        draft[field.key] = value === undefined ? "" : JSON.stringify(value, null, 2);
        break;
      case "select":
        if (field.config.multiple === true) {
          draft[field.key] = Array.isArray(value)
            ? value.filter((entry): entry is string => typeof entry === "string")
            : [];
        } else {
          draft[field.key] = typeof value === "string" ? value : "";
        }
        break;
      case "richtext":
        draft[field.key] = value;
        break;
      case "relation":
        if (field.config.cardinality === "many") {
          draft[field.key] = Array.isArray(value)
            ? value.filter(isRelationRef).map(relationDraftKey)
            : [];
        } else {
          draft[field.key] = isRelationRef(value) ? relationDraftKey(value) : "";
        }
        break;
    }
  }
  return draft;
}

export type FromDraftResult =
  | { ok: true; input: Record<string, unknown> }
  | { ok: false; fieldErrors: Record<string, string> };

export function fromDraftValues(
  contentType: ContentTypeDefinition,
  draft: DraftValues,
  baseInput: Record<string, unknown>,
): FromDraftResult {
  // baseInput が土台: 未知キー・型定義から消えたキー・richtext がここから引き継がれる
  const input: Record<string, unknown> = { ...baseInput };
  const fieldErrors: Record<string, string> = {};

  const setOrOmit = (key: string, value: unknown, empty: boolean) => {
    if (empty) {
      delete input[key];
    } else {
      input[key] = value;
    }
  };

  for (const field of contentType.fields) {
    const value = draft[field.key];
    switch (field.type) {
      case "text":
      case "datetime": {
        const text = typeof value === "string" ? value : "";
        setOrOmit(field.key, text, text === "");
        break;
      }
      case "number": {
        const text = typeof value === "string" ? value.trim() : "";
        if (text === "") {
          delete input[field.key];
          break;
        }
        const parsed = Number(text);
        if (Number.isNaN(parsed)) {
          fieldErrors[field.key] = "数値として解釈できません";
          break;
        }
        input[field.key] = parsed;
        break;
      }
      case "boolean":
        input[field.key] = value === true;
        break;
      case "json": {
        const text = typeof value === "string" ? value.trim() : "";
        if (text === "") {
          delete input[field.key];
          break;
        }
        try {
          input[field.key] = JSON.parse(text) as unknown;
        } catch {
          fieldErrors[field.key] = "JSON として解釈できません";
        }
        break;
      }
      case "select": {
        if (field.config.multiple === true) {
          const values = Array.isArray(value)
            ? value.filter((entry): entry is string => typeof entry === "string")
            : [];
          setOrOmit(field.key, values, values.length === 0);
        } else {
          const text = typeof value === "string" ? value : "";
          setOrOmit(field.key, text, text === "");
        }
        break;
      }
      case "richtext":
        // 裁定 1: richtext は編集しない。baseInput の値がそのまま残る。
        break;
      case "relation": {
        if (field.config.cardinality === "many") {
          const keys = Array.isArray(value) ? value : [];
          const refs = keys
            .map((key) => (typeof key === "string" ? parseRelationDraftKey(key) : null))
            .filter((ref): ref is { type: string; id: string } => ref !== null);
          setOrOmit(field.key, refs, refs.length === 0);
        } else {
          const ref =
            typeof value === "string" && value !== "" ? parseRelationDraftKey(value) : null;
          setOrOmit(field.key, ref, ref === null);
        }
        break;
      }
    }
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, fieldErrors };
  }

  const parsed = buildRecordInputSchema(contentType).safeParse(input);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "");
      if (key !== "" && fieldErrors[key] === undefined) {
        fieldErrors[key] = issue.message;
      }
    }
    return {
      ok: false,
      fieldErrors:
        Object.keys(fieldErrors).length > 0 ? fieldErrors : { "": "入力を検証できませんでした" },
    };
  }
  return { ok: true, input: parsed.data as Record<string, unknown> };
}
