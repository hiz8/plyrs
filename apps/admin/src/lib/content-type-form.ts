import {
  contentTypeDefinitionSchema,
  type ContentTypeDefinition,
  type FieldDefinition,
} from "@plyrs/metamodel";
import type { ContentTypeSummary } from "./admin-api";

// content_type ビルダーの UI 状態。すべての型のノブを 1 つの平坦な構造で持ち、
// type に応じて必要なものだけ FieldDefinition の config へ写す。
export interface FieldDraft {
  key: string;
  type: FieldDefinition["type"];
  required: boolean;
  maxLength: string;
  integer: boolean;
  /** 1 行 1 選択肢。"value=ラベル"(ラベル省略時は value がラベル) */
  optionsText: string;
  multiple: boolean;
  /** カンマ区切りの type key */
  allowedTypes: string;
  cardinality: "one" | "many";
  ordered: boolean;
  indexed: boolean;
  unique: boolean;
}

export function emptyFieldDraft(): FieldDraft {
  return {
    key: "",
    type: "text",
    required: false,
    maxLength: "",
    integer: false,
    optionsText: "",
    multiple: false,
    allowedTypes: "",
    cardinality: "one",
    ordered: false,
    indexed: false,
    unique: false,
  };
}

export function toFieldDraft(field: FieldDefinition): FieldDraft {
  const draft = emptyFieldDraft();
  draft.key = field.key;
  draft.type = field.type;
  draft.required = field.required ?? false;
  switch (field.type) {
    case "text":
      draft.maxLength = field.config?.maxLength === undefined ? "" : String(field.config.maxLength);
      draft.indexed = field.config?.indexed ?? false;
      draft.unique = field.config?.unique ?? false;
      break;
    case "number":
      draft.integer = field.config?.integer ?? false;
      draft.indexed = field.config?.indexed ?? false;
      draft.unique = field.config?.unique ?? false;
      break;
    case "boolean":
      draft.indexed = field.config?.indexed ?? false;
      break;
    case "datetime":
      draft.indexed = field.config?.indexed ?? false;
      draft.unique = field.config?.unique ?? false;
      break;
    case "json":
    case "richtext":
      break;
    case "select":
      draft.optionsText = field.config.options
        .map((option) =>
          option.label === option.value ? option.value : `${option.value}=${option.label}`,
        )
        .join("\n");
      draft.multiple = field.config.multiple ?? false;
      draft.indexed = field.config.indexed ?? false;
      break;
    case "relation":
      draft.allowedTypes = field.config.allowedTypes.join(", ");
      draft.cardinality = field.config.cardinality;
      draft.ordered = field.config.ordered ?? false;
      break;
  }
  return draft;
}

function compactConfig<T extends Record<string, unknown>>(config: T): T | undefined {
  const entries = Object.entries(config).filter(([, value]) => value !== undefined);
  return entries.length === 0 ? undefined : (Object.fromEntries(entries) as T);
}

function fromFieldDraft(
  draft: FieldDraft,
): { ok: true; field: unknown } | { ok: false; error: string } {
  const base = {
    key: draft.key,
    ...(draft.required ? { required: true } : {}),
  };
  const indexed = draft.indexed ? true : undefined;
  const unique = draft.unique ? true : undefined;
  switch (draft.type) {
    case "text": {
      let maxLength: number | undefined;
      if (draft.maxLength.trim() !== "") {
        maxLength = Number(draft.maxLength.trim());
        if (!Number.isInteger(maxLength) || maxLength <= 0) {
          return { ok: false, error: `${draft.key}: maxLength は正の整数で指定してください` };
        }
      }
      const config = compactConfig({ indexed, unique, maxLength });
      return { ok: true, field: { ...base, type: "text", ...(config ? { config } : {}) } };
    }
    case "number": {
      const config = compactConfig({ indexed, unique, integer: draft.integer ? true : undefined });
      return { ok: true, field: { ...base, type: "number", ...(config ? { config } : {}) } };
    }
    case "boolean": {
      const config = compactConfig({ indexed });
      return { ok: true, field: { ...base, type: "boolean", ...(config ? { config } : {}) } };
    }
    case "datetime": {
      const config = compactConfig({ indexed, unique });
      return { ok: true, field: { ...base, type: "datetime", ...(config ? { config } : {}) } };
    }
    case "json":
      return { ok: true, field: { ...base, type: "json" } };
    case "richtext":
      return { ok: true, field: { ...base, type: "richtext" } };
    case "select": {
      const options = draft.optionsText
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line !== "")
        .map((line) => {
          const eq = line.indexOf("=");
          return eq === -1
            ? { value: line, label: line }
            : { value: line.slice(0, eq).trim(), label: line.slice(eq + 1).trim() };
        });
      const config = {
        options,
        ...(draft.multiple ? { multiple: true } : {}),
        ...(indexed !== undefined ? { indexed } : {}),
      };
      return { ok: true, field: { ...base, type: "select", config } };
    }
    case "relation": {
      const allowedTypes = draft.allowedTypes
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry) => entry !== "");
      const config = {
        allowedTypes,
        cardinality: draft.cardinality,
        ...(draft.ordered ? { ordered: true } : {}),
      };
      return { ok: true, field: { ...base, type: "relation", config } };
    }
  }
}

export type BuildDefinitionResult =
  | { ok: true; definition: ContentTypeDefinition }
  | { ok: false; errors: string[] };

export function buildDefinition(args: {
  id: string;
  key: string;
  name: string;
  drafts: FieldDraft[];
  version: number;
}): BuildDefinitionResult {
  const errors: string[] = [];
  const fields: unknown[] = [];
  for (const draft of args.drafts) {
    const converted = fromFieldDraft(draft);
    if (!converted.ok) {
      errors.push(converted.error);
    } else {
      fields.push(converted.field);
    }
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  const parsed = contentTypeDefinitionSchema.safeParse({
    id: args.id,
    key: args.key,
    name: args.name,
    fields,
    source: "user",
    version: args.version,
  });
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((issue) => {
        // zod の path は "fields.0.config.options" のように配列 index を使うため人には読みにくい。
        // path が fields.<index>.… の形なら index を該当 draft の key に差し替える(round-trip
        // テストは「tags」のようなフィールド key がエラー文言に出ることを期待する)。issue.path は
        // PropertyKey[]（symbol を含みうる）なので String() で明示変換する(テンプレートリテラル
        // に symbol を直接埋め込むと例外になる)。
        const [first, index, ...rest] = issue.path;
        if (first === "fields" && typeof index === "number") {
          const key = args.drafts[index]?.key ?? String(index);
          return `${[key, ...rest.map(String)].join(".")}: ${issue.message}`;
        }
        return `${issue.path.map(String).join(".")}: ${issue.message}`;
      }),
    };
  }
  return { ok: true, definition: parsed.data };
}

// ContentTypeSummary(HTTP 応答)→ contentTypeDefinitionSchema 入力(pluginId: null は落とす)
export function summaryToDefinition(row: ContentTypeSummary): ContentTypeDefinition {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    fields: row.fields,
    source: row.source,
    ...(row.pluginId === null ? {} : { pluginId: row.pluginId }),
    version: row.version,
  };
}
