import {
  buildRecordInputSchema,
  richTextEnvelopeSchema,
  type ContentTypeDefinition,
  type RichTextEnvelope,
} from "@plyrs/metamodel";

// 動的フォームの UI 状態（draft）と records の input 形式の変換層。
// - draft: text/number/datetime/json は string、boolean は boolean、
//   multiple-select / many-relation は string[]、one-relation は合成キー string、
//   richtext は AST エンベロープそのもの(Phase 7 でエディタが編集する)。
// - 空 draft は「キーを省略」に写す（空文字列を書き込まない）。
// - baseInput の未知キーは保持(遅延適合 = design-spec §4.2)。
// - initialDraft を与えると dirty キーのみ書き戻す(§12 必須② — 2026-07-17 裁定)。
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

// richtext draft 値をエンベロープに絞る(エディタ・競合ダイアログへ渡す境界)
export function asRichTextValue(value: unknown): RichTextEnvelope | undefined {
  const parsed = richTextEnvelopeSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

// 「空」= ブロックが無い、または唯一のブロックが中身の無い段落。ユーザーが本文を全部
// 消した状態を「キー削除」に写す UI 意味論(required richtext は G7 と同様に空を拒める)。
export function isEmptyRichTextValue(value: RichTextEnvelope): boolean {
  const content = value.doc.content ?? [];
  if (content.length === 0) {
    return true;
  }
  const only = content[0];
  return (
    content.length === 1 &&
    only !== undefined &&
    only.type === "paragraph" &&
    (only.content === undefined || only.content.length === 0)
  );
}

// draft 値の同値判定。draft は JSON 直列化可能な値(文字列/boolean/配列/エンベロープ)に
// 閉じているため JSON 文字列比較で足りる(sync-client の toChange と同じ手法)。
export function draftValueEquals(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }
  const left = JSON.stringify(a);
  const right = JSON.stringify(b);
  return left !== undefined && left === right;
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
  // §12 必須②(2026-07-17 裁定): 編集モードではマウント時(または直近保存時)の draft を
  // 基準に「ユーザーが実際に変えたキーだけ」を書き戻す。untouched キーは baseInput
  // (最新 record.input)の値がそのまま残り、他編集者の変更を巻き戻さない。
  // undefined(新規作成)は従来どおり全フィールドを書く。
  initialDraft?: DraftValues,
): FromDraftResult {
  // baseInput が土台: 未知キー・型定義から消えたキー・untouched キーがここから引き継がれる
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
    if (initialDraft !== undefined && draftValueEquals(value, initialDraft[field.key])) {
      continue; // untouched: baseInput の現在値を維持(§12 必須②)
    }
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
      case "richtext": {
        const envelope = asRichTextValue(value);
        if (envelope === undefined) {
          if (value !== undefined) {
            // Value was explicitly set but is not a valid envelope → delete
            delete input[field.key];
          }
          // else: value is undefined (not edited) → preserve from baseInput
        } else if (isEmptyRichTextValue(envelope)) {
          // Value is a valid envelope but empty → delete
          delete input[field.key];
        } else {
          // Value is a valid non-empty envelope → use it
          input[field.key] = envelope;
        }
        break;
      }
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
