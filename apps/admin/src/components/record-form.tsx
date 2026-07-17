import * as stylex from "@stylexjs/stylex";
import { useState } from "react";
import { useForm } from "@tanstack/react-form";
import type { ContentTypeDefinition, FieldDefinition } from "@plyrs/metamodel";
import type { SyncRecord } from "@plyrs/sync-protocol";
import { SyncRejectedError } from "@plyrs/sync-client";
import type { CollectionRegistry } from "@plyrs/sync-client/tanstack";
import { Button, Checkbox, CheckboxGroup, Select, TextArea, TextField } from "@plyrs/ui";
import { colors, spacing, typography } from "@plyrs/ui/tokens.stylex";
import { fromDraftValues, relationDraftKey, toDraftValues } from "../lib/record-form-values";
import { useRelationCandidates } from "../lib/use-collection";

const styles = stylex.create({
  form: {
    display: "flex",
    flexDirection: "column",
    gap: spacing.md,
    maxWidth: "640px",
    fontFamily: typography.fontFamily,
  },
  banner: {
    padding: spacing.sm,
    borderRadius: "6px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: colors.danger,
    color: colors.danger,
    fontSize: typography.sizeMd,
  },
  richtext: {
    padding: spacing.md,
    borderRadius: "6px",
    borderWidth: "1px",
    borderStyle: "dashed",
    borderColor: colors.border,
    color: colors.textMuted,
    fontSize: typography.sizeMd,
  },
  fieldLabel: { fontSize: typography.sizeSm, color: colors.textMuted },
  fieldError: { fontSize: typography.sizeSm, color: colors.danger },
  actions: { display: "flex", gap: spacing.sm },
});

// 一覧・relation picker 共用: 最初の text フィールド値をラベルに、無ければ id 先頭 8 桁
export function labelForRecord(types: ContentTypeDefinition[], record: SyncRecord): string {
  const definition = types.find((type) => type.key === record.type);
  const firstText = definition?.fields.find((field) => field.type === "text");
  if (firstText !== undefined) {
    const value = record.input[firstText.key];
    if (typeof value === "string" && value !== "") {
      return value;
    }
  }
  return record.id.slice(0, 8);
}

// 裁定 6: 最小のエラーバナー文言。conflict ack は richtext のみで 6b UI からは発生しないが、
// 発生した場合も同じバナーに落ちる(本文競合の解決 UI は Phase 7)。
export function syncErrorMessage(cause: unknown): string {
  if (
    cause instanceof SyncRejectedError ||
    (cause instanceof Error && cause.name === "SyncRejectedError")
  ) {
    const code = (cause as { code?: string }).code ?? "unknown";
    return `保存できませんでした（${code}）: ${cause.message}`;
  }
  return "保存できませんでした。接続状態を確認して再試行してください。";
}

export interface RecordFormProps {
  contentType: ContentTypeDefinition;
  types: ContentTypeDefinition[];
  registry: CollectionRegistry;
  /** null = 新規作成 */
  record: SyncRecord | null;
  submitLabel: string;
  onSubmit: (input: Record<string, unknown>) => Promise<void>;
}

export function RecordForm({
  contentType,
  types,
  registry,
  record,
  submitLabel,
  onSubmit,
}: RecordFormProps) {
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<string | null>(null);
  const form = useForm({
    defaultValues: toDraftValues(contentType, record?.input ?? {}),
    onSubmit: async ({ value }) => {
      setBanner(null);
      const converted = fromDraftValues(contentType, value, record?.input ?? {});
      if (!converted.ok) {
        setFieldErrors(converted.fieldErrors);
        const formLevel = converted.fieldErrors[""];
        if (formLevel !== undefined) {
          setBanner(formLevel);
        }
        return;
      }
      setFieldErrors({});
      try {
        await onSubmit(converted.input);
      } catch (cause) {
        setBanner(syncErrorMessage(cause));
      }
    },
  });

  return (
    <form
      {...stylex.props(styles.form)}
      // isRequired を TextField に渡すと native required 属性が付き、ブラウザ(jsdom 含む)の
      // 制約検証が submit イベント自体を止めてしまい TanStack Form + zod の検証まで届かない。
      // 検証は変換層(record-form-values)に一本化するため native 検証を無効化する。
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      {banner !== null && (
        <div role="alert" {...stylex.props(styles.banner)}>
          {banner}
        </div>
      )}
      {contentType.fields.map((field) => (
        // 動的キー: DraftValues は Record<string, unknown> のため form.Field の
        // DeepKeys<DraftValues> は string 全域に解決される。field.key は
        // ContentTypeDefinition から得た string なのでそのまま代入できる
        // (境界 cast 不要 — rpc-unwrap 様式の cast はここでは発生しない)。
        <form.Field key={field.key} name={field.key}>
          {(api) => (
            <FieldInput
              field={field}
              value={api.state.value}
              onChange={(next) => api.handleChange(next)}
              error={fieldErrors[field.key]}
              types={types}
              registry={registry}
            />
          )}
        </form.Field>
      ))}
      <div {...stylex.props(styles.actions)}>
        <Button type="submit">{submitLabel}</Button>
      </div>
    </form>
  );
}

function FieldInput({
  field,
  value,
  onChange,
  error,
  types,
  registry,
}: {
  field: FieldDefinition;
  value: unknown;
  onChange: (next: unknown) => void;
  error: string | undefined;
  types: ContentTypeDefinition[];
  registry: CollectionRegistry;
}) {
  switch (field.type) {
    case "text":
      return (
        <TextField
          label={field.key}
          value={typeof value === "string" ? value : ""}
          onChange={onChange}
          isRequired={field.required ?? false}
          isInvalid={error !== undefined}
          errorMessage={error}
        />
      );
    case "number":
      return (
        <TextField
          label={field.key}
          value={typeof value === "string" ? value : ""}
          onChange={onChange}
          inputMode="numeric"
          isInvalid={error !== undefined}
          errorMessage={error}
        />
      );
    case "datetime":
      return (
        <TextField
          label={field.key}
          value={typeof value === "string" ? value : ""}
          onChange={onChange}
          // design-spec §5: 格納は UTC ISO8601('Z' 終端)。表示層の TZ 変換は将来課題。
          // 6b は素の ISO 文字列入力(date-fns の picker 化は Phase 7 以降の磨き込み)。
          isInvalid={error !== undefined}
          errorMessage={error}
        />
      );
    case "boolean":
      return (
        <Checkbox isSelected={value === true} onChange={onChange}>
          {field.key}
        </Checkbox>
      );
    case "json":
      return (
        <TextArea
          label={field.key}
          value={typeof value === "string" ? value : ""}
          onChange={onChange}
          isInvalid={error !== undefined}
          errorMessage={error}
        />
      );
    case "select": {
      const options = field.config.options.map((option) => ({
        value: option.value,
        label: option.label,
      }));
      if (field.config.multiple === true) {
        return (
          <CheckboxGroup
            label={field.key}
            options={options}
            value={Array.isArray(value) ? (value as string[]) : []}
            onChange={onChange}
            errorMessage={error}
          />
        );
      }
      return (
        <Select
          label={field.key}
          items={options}
          selectedValue={typeof value === "string" ? value : ""}
          onChange={onChange}
          placeholder="(未設定)"
          errorMessage={error}
        />
      );
    }
    case "richtext":
      return (
        <div>
          <span {...stylex.props(styles.fieldLabel)}>{field.key}</span>
          <div {...stylex.props(styles.richtext)}>
            リッチテキスト（Phase 7 で編集できるようになります）
            {value !== undefined && value !== ""
              ? " — 既存の本文は保存時にそのまま保持されます"
              : ""}
          </div>
        </div>
      );
    case "relation":
      return (
        <RelationPicker
          field={field}
          value={value}
          onChange={onChange}
          error={error}
          types={types}
          registry={registry}
        />
      );
  }
}

function RelationPicker({
  field,
  value,
  onChange,
  error,
  types,
  registry,
}: {
  field: Extract<FieldDefinition, { type: "relation" }>;
  value: unknown;
  onChange: (next: unknown) => void;
  error: string | undefined;
  types: ContentTypeDefinition[];
  registry: CollectionRegistry;
}) {
  const candidates = useRelationCandidates(registry, field.config.allowedTypes);
  const options = candidates.map((candidate) => ({
    value: relationDraftKey({ type: candidate.type, id: candidate.id }),
    label: labelForRecord(types, candidate),
  }));
  if (candidates.length === 0) {
    return (
      <div>
        <span {...stylex.props(styles.fieldLabel)}>{field.key}</span>
        <div {...stylex.props(styles.richtext)}>
          参照できるレコードがありません（許可型: {field.config.allowedTypes.join(", ")}）
        </div>
        {error !== undefined && <span {...stylex.props(styles.fieldError)}>{error}</span>}
      </div>
    );
  }
  if (field.config.cardinality === "many") {
    return (
      <CheckboxGroup
        label={field.key}
        options={options}
        value={Array.isArray(value) ? (value as string[]) : []}
        onChange={onChange}
        errorMessage={error}
      />
    );
  }
  return (
    <Select
      label={field.key}
      items={options}
      selectedValue={typeof value === "string" ? value : ""}
      onChange={onChange}
      placeholder="(未設定)"
      errorMessage={error}
    />
  );
}
