import {
  ASSET_TYPE_KEY,
  FIELD_DESCRIPTION_MAX_LENGTH,
  FIELD_KEY_PATTERN,
  FIELD_LABEL_MAX_LENGTH,
  SYSTEM_FIELD_KEYS,
  contentTypeDefinitionSchema,
  type ContentTypeDefinition,
  type FieldDefinition,
} from "@plyrs/metamodel";
import type { SyncRecord } from "@plyrs/sync-protocol";
import type { ContentTypeSummary } from "./admin-api";
import { ADD_FIELD_LABELS, CONTENT_TYPE_LABELS, FIELD_PANEL_LABELS } from "./labels";

// 案 E: 型設計の下書き。画面の判断はここに寄せ、部品は描くだけにする。

export type FieldKind =
  | "text"
  | "richtext"
  | "number"
  | "datetime"
  | "boolean"
  | "select"
  | "asset"
  | "reference"
  | "slug"
  | "json";
export type KindGroup = "basic" | "link" | "advanced";

export const FIELD_KINDS: readonly { kind: FieldKind; group: KindGroup }[] = [
  { kind: "text", group: "basic" },
  { kind: "richtext", group: "basic" },
  { kind: "number", group: "basic" },
  { kind: "datetime", group: "basic" },
  { kind: "boolean", group: "basic" },
  { kind: "select", group: "basic" },
  { kind: "asset", group: "link" },
  { kind: "reference", group: "link" },
  { kind: "slug", group: "link" },
  { kind: "json", group: "advanced" },
];

const SLUG_KEY = "slug";

// E12: 読む側(record-form)の判定と同じ
export function kindOf(field: FieldDefinition): FieldKind {
  switch (field.type) {
    case "text":
      return field.key === SLUG_KEY && field.config?.unique === true ? "slug" : "text";
    case "relation": {
      const allowed = field.config.allowedTypes;
      return allowed.length === 1 && allowed[0] === ASSET_TYPE_KEY ? "asset" : "reference";
    }
    default:
      return field.type;
  }
}

export interface SelectOptionDraft {
  value: string;
  label: string;
}

export interface FieldDraft {
  key: string;
  kind: FieldKind;
  label: string;
  description: string;
  required: boolean;
  /** 未保存(E16・E17) */
  isNew: boolean;
  maxLength: string;
  integer: boolean;
  options: SelectOptionDraft[];
  multiple: boolean;
  allowedTypes: string[];
  cardinality: "one" | "many";
  ordered: boolean;
  indexed: boolean;
  unique: boolean;
}

export function emptyFieldDraft(kind: FieldKind, key: string, label: string): FieldDraft {
  return {
    key: kind === "slug" ? SLUG_KEY : key,
    kind,
    label,
    description: "",
    required: false,
    isNew: true,
    maxLength: "",
    integer: false,
    options: [],
    multiple: false,
    allowedTypes: kind === "asset" ? [ASSET_TYPE_KEY] : [],
    cardinality: "one",
    ordered: false,
    indexed: false,
    unique: kind === "slug",
  };
}

export function toFieldDraft(field: FieldDefinition): FieldDraft {
  const draft: FieldDraft = {
    ...emptyFieldDraft(kindOf(field), field.key, field.label ?? ""),
    isNew: false,
    required: field.required ?? false,
    description: field.description ?? "",
  };
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
      draft.options = field.config.options.map((option) => ({
        value: option.value,
        label: option.label,
      }));
      draft.multiple = field.config.multiple ?? false;
      draft.indexed = field.config.indexed ?? false;
      break;
    case "relation":
      draft.allowedTypes = [...field.config.allowedTypes];
      draft.cardinality = field.config.cardinality;
      draft.ordered = field.config.ordered ?? false;
      break;
  }
  return draft;
}

// E13: 表示名・API 名・説明・必須・未保存かどうかを保ち、種類ごとの設定は新しい種類の既定に戻す
export function changeKind(draft: FieldDraft, kind: FieldKind): FieldDraft {
  return {
    ...emptyFieldDraft(kind, draft.key, draft.label),
    description: draft.description,
    required: draft.required,
    isNew: draft.isNew,
  };
}

// URL スラッグは API 名が slug で、他に URL スラッグが無いときだけ選べる(E13)
export function availableKinds(draft: FieldDraft, hasOtherSlug: boolean): FieldKind[] {
  return FIELD_KINDS.map((entry) => entry.kind).filter(
    (kind) => kind !== "slug" || (draft.key === SLUG_KEY && !hasOtherSlug),
  );
}

export interface TypeDraft {
  name: string;
  key: string;
  description: string;
  fields: FieldDraft[];
  titleField: string | null;
  listColumns: string[];
}

export function emptyTypeDraft(): TypeDraft {
  return { name: "", key: "", description: "", fields: [], titleField: null, listColumns: [] };
}

export function toTypeDraft(row: ContentTypeSummary): TypeDraft {
  return {
    name: row.name,
    key: row.key,
    description: row.description ?? "",
    fields: row.fields.map(toFieldDraft),
    titleField: row.titleField,
    listColumns: row.listColumns ?? [],
  };
}

// E19: titleFieldKey と同じ規則を下書きに適用する(対象はテキスト(1 行)だけ。URL スラッグは含めない)
export function effectiveTitleField(draft: TypeDraft): string | null {
  if (draft.titleField !== null) {
    const target = draft.fields.find((field) => field.key === draft.titleField);
    if (target?.kind === "text") {
      return target.key;
    }
  }
  return draft.fields.find((field) => field.kind === "text")?.key ?? null;
}

export function hasSlugField(fields: readonly FieldDraft[], exceptKey?: string): boolean {
  return fields.some((field) => field.kind === "slug" && field.key !== exceptKey);
}

// E14
export function suggestKey(label: string): string {
  const lowered = label.toLowerCase().replace(/[^a-z0-9]+/g, "_");
  const firstLetter = lowered.search(/[a-z]/);
  if (firstLetter === -1) {
    return "";
  }
  return lowered.slice(firstLetter).replace(/_+$/, "");
}

export function autoFill(prevLabel: string, prevValue: string, nextLabel: string): string {
  return prevValue === "" || prevValue === suggestKey(prevLabel)
    ? suggestKey(nextLabel)
    : prevValue;
}

export type KeyError =
  | { kind: "empty" }
  | { kind: "invalid"; example: string }
  | { kind: "duplicate"; label: string }
  | { kind: "reserved" };

const SYSTEM_KEYS: readonly string[] = SYSTEM_FIELD_KEYS;

function invalidExample(key: string): KeyError {
  return { kind: "invalid", example: suggestKey(key) || "title" };
}

// E15
export function validateFieldKey(
  key: string,
  others: readonly { key: string; label: string }[],
): KeyError | null {
  if (key === "") {
    return { kind: "empty" };
  }
  if (SYSTEM_KEYS.includes(key)) {
    return { kind: "reserved" };
  }
  if (!FIELD_KEY_PATTERN.test(key)) {
    return invalidExample(key);
  }
  const same = others.find((other) => other.key === key);
  return same === undefined ? null : { kind: "duplicate", label: same.label };
}

export function validateTypeKey(
  key: string,
  existing: readonly { key: string; name: string }[],
): KeyError | null {
  if (key === "") {
    return { kind: "empty" };
  }
  if (!FIELD_KEY_PATTERN.test(key)) {
    return invalidExample(key);
  }
  const same = existing.find((other) => other.key === key);
  return same === undefined ? null : { kind: "duplicate", label: same.name };
}

export function keyErrorMessage(error: KeyError, key = ""): string {
  const labels = CONTENT_TYPE_LABELS.keyErrors;
  switch (error.kind) {
    case "empty":
      return labels.empty;
    case "invalid":
      return labels.invalid(error.example);
    case "duplicate":
      return labels.duplicate(key, error.label);
    case "reserved":
      return labels.reserved(key);
  }
}

export interface FieldChange {
  requiredAdded: boolean;
  kindChanged: { from: FieldKind; to: FieldKind } | null;
}

// E18 の注意の元。保存済み(original あり)のフィールドだけが対象
export function fieldChange(original: FieldDefinition | undefined, draft: FieldDraft): FieldChange {
  if (original === undefined) {
    return { requiredAdded: false, kindChanged: null };
  }
  const from = kindOf(original);
  return {
    requiredAdded: original.required !== true && draft.required,
    kindChanged: from === draft.kind ? null : { from, to: draft.kind },
  };
}

function isEmptyValue(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    value === "" ||
    (Array.isArray(value) && value.length === 0)
  );
}

function liveRecords(records: readonly SyncRecord[]): SyncRecord[] {
  return records.filter((record) => record.deletedAt === null);
}

export function countEmpty(records: readonly SyncRecord[], key: string): number {
  return liveRecords(records).filter((record) => isEmptyValue(record.input[key])).length;
}

export function countFilled(records: readonly SyncRecord[], key: string): number {
  return liveRecords(records).filter((record) => !isEmptyValue(record.input[key])).length;
}

const NO_INDEXED_KINDS: readonly FieldKind[] = ["asset", "reference", "richtext", "json"];

export interface FieldDraftError {
  field: "label" | "description" | "maxLength" | "options" | "allowedTypes";
  message: string;
}

// E4: パネルの「適用」と型の「保存」が共有するフィールドの検証。key は isNew のときだけパネル側で見る
export function fieldDraftErrors(draft: FieldDraft): FieldDraftError[] {
  const P = FIELD_PANEL_LABELS;
  const errors: FieldDraftError[] = [];
  const label = draft.label.trim();
  // 表示名が空は型レベルでは許す(V4-E 以前の既存フィールドは表示名を持たない)。パネルの適用時だけ必須にする
  if (label.length > FIELD_LABEL_MAX_LENGTH) {
    errors.push({
      field: "label",
      message: ADD_FIELD_LABELS.labelTooLong(FIELD_LABEL_MAX_LENGTH),
    });
  }
  if (draft.description.trim().length > FIELD_DESCRIPTION_MAX_LENGTH) {
    errors.push({
      field: "description",
      message: P.descriptionTooLong(FIELD_DESCRIPTION_MAX_LENGTH),
    });
  }
  if (draft.kind === "text" || draft.kind === "slug") {
    const trimmed = draft.maxLength.trim();
    if (trimmed !== "") {
      const n = Number(trimmed);
      if (!Number.isInteger(n) || n <= 0) {
        errors.push({ field: "maxLength", message: P.maxLengthInvalid });
      }
    }
  }
  if (draft.kind === "select") {
    if (draft.options.length === 0) {
      errors.push({ field: "options", message: P.optionsRequired });
    }
    const seen = new Set<string>();
    for (const option of draft.options) {
      if (option.label.trim() === "") {
        errors.push({ field: "options", message: P.optionLabelEmpty });
      }
      if (option.value === "") {
        errors.push({ field: "options", message: P.optionValueEmpty });
      } else if (seen.has(option.value)) {
        errors.push({ field: "options", message: P.optionValueDuplicate(option.value) });
      } else {
        seen.add(option.value);
      }
    }
  }
  if (draft.kind === "reference" && draft.allowedTypes.length === 0) {
    errors.push({ field: "allowedTypes", message: P.allowedTypesRequired });
  }
  return errors;
}

export function fieldTags(
  draft: FieldDraft,
  titleKey: string | null,
  change: FieldChange,
): string[] {
  const tags = CONTENT_TYPE_LABELS.tags;
  const result: string[] = [];
  if (draft.required) result.push(tags.required);
  if (titleKey !== null && draft.key === titleKey) result.push(tags.title);
  if (draft.kind === "asset" || draft.kind === "reference") {
    result.push(draft.cardinality === "many" ? tags.many : tags.one);
  }
  if (draft.indexed && !NO_INDEXED_KINDS.includes(draft.kind)) result.push(tags.indexed);
  if (change.requiredAdded) result.push(tags.requiredChanged);
  if (change.kindChanged !== null) result.push(tags.kindChanged);
  if (fieldDraftErrors(draft).length > 0) result.push(tags.incomplete);
  return result;
}

export function isTypeDraftDirty(a: TypeDraft, b: TypeDraft): boolean {
  return JSON.stringify(a) !== JSON.stringify(b);
}

function compactConfig<T extends Record<string, unknown>>(config: T): T | undefined {
  const entries = Object.entries(config).filter(([, value]) => value !== undefined);
  return entries.length === 0 ? undefined : (Object.fromEntries(entries) as T);
}

function fromFieldDraft(
  draft: FieldDraft,
): { ok: true; field: unknown } | { ok: false; error: string } {
  const label = draft.label.trim();
  const description = draft.description.trim();
  const base = {
    key: draft.key,
    ...(draft.required ? { required: true } : {}),
    ...(label === "" ? {} : { label }),
    ...(description === "" ? {} : { description }),
  };
  const indexed = draft.indexed ? true : undefined;
  const unique = draft.unique ? true : undefined;
  const withConfig = (type: string, config: Record<string, unknown> | undefined) => ({
    ok: true as const,
    field: { ...base, type, ...(config ? { config } : {}) },
  });
  switch (draft.kind) {
    case "text":
    case "slug": {
      let maxLength: number | undefined;
      if (draft.maxLength.trim() !== "") {
        maxLength = Number(draft.maxLength.trim());
        if (!Number.isInteger(maxLength) || maxLength <= 0) {
          return { ok: false, error: FIELD_PANEL_LABELS.maxLengthInvalid };
        }
      }
      if (draft.kind === "slug") {
        return {
          ok: true,
          field: {
            ...base,
            key: SLUG_KEY,
            type: "text",
            config: compactConfig({ indexed, unique: true, maxLength }),
          },
        };
      }
      return withConfig("text", compactConfig({ indexed, unique, maxLength }));
    }
    case "number":
      return withConfig(
        "number",
        compactConfig({ indexed, unique, integer: draft.integer ? true : undefined }),
      );
    case "boolean":
      return withConfig("boolean", compactConfig({ indexed }));
    case "datetime":
      return withConfig("datetime", compactConfig({ indexed, unique }));
    case "json":
      return withConfig("json", undefined);
    case "richtext":
      return withConfig("richtext", undefined);
    case "select":
      return withConfig("select", {
        options: draft.options.map((option) => ({ value: option.value, label: option.label })),
        ...(draft.multiple ? { multiple: true } : {}),
        ...(indexed !== undefined ? { indexed } : {}),
      });
    case "asset":
      return withConfig("relation", {
        allowedTypes: [ASSET_TYPE_KEY],
        cardinality: draft.cardinality,
        snapshotEmbed: "value",
      });
    case "reference":
      return withConfig("relation", {
        allowedTypes: draft.allowedTypes,
        cardinality: draft.cardinality,
        ...(draft.ordered ? { ordered: true } : {}),
      });
  }
}

export type BuildDefinitionResult =
  | { ok: true; definition: ContentTypeDefinition }
  | { ok: false; errors: string[] };

// titleField / listColumns は無くなった参照を落とす(titleField は最初のテキストに戻る)。
// 描画側で検証済みの前提だが、スキーマの issue は errors に人が読める形で返す。
export function buildDefinition(args: {
  id: string;
  version: number;
  menuOrder?: number;
  draft: TypeDraft;
}): BuildDefinitionResult {
  const { draft } = args;
  const errors: string[] = [];
  const fields: unknown[] = [];
  for (const fieldDraft of draft.fields) {
    const converted = fromFieldDraft(fieldDraft);
    if (!converted.ok) {
      errors.push(converted.error);
    } else {
      fields.push(converted.field);
    }
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  const titleTarget =
    draft.titleField === null
      ? undefined
      : draft.fields.find((field) => field.key === draft.titleField && field.kind === "text");
  const listColumns = draft.listColumns.filter((key) =>
    draft.fields.some((field) => field.key === key),
  );
  const description = draft.description.trim();
  const parsed = contentTypeDefinitionSchema.safeParse({
    id: args.id,
    key: draft.key,
    name: draft.name.trim(),
    fields,
    source: "user",
    version: args.version,
    ...(description === "" ? {} : { description }),
    ...(titleTarget === undefined ? {} : { titleField: titleTarget.key }),
    ...(listColumns.length === 0 ? {} : { listColumns }),
    ...(args.menuOrder === undefined ? {} : { menuOrder: args.menuOrder }),
  });
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((issue) => {
        // zod の path は "fields.0.config.options" のように配列 index を使うため人には読みにくい。
        // path が fields.<index>.… の形なら index を該当 draft の key に差し替える。
        // issue.path は PropertyKey[](symbol を含みうる)なので String() で明示変換する。
        const [first, index, ...rest] = issue.path;
        if (first === "fields" && typeof index === "number") {
          const key = draft.fields[index]?.key ?? String(index);
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
    ...(row.description === null ? {} : { description: row.description }),
    ...(row.titleField === null ? {} : { titleField: row.titleField }),
    ...(row.listColumns === null ? {} : { listColumns: row.listColumns }),
    ...(row.menuOrder === null ? {} : { menuOrder: row.menuOrder }),
  };
}
