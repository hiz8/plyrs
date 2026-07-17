import * as stylex from "@stylexjs/stylex";
import { useState } from "react";
import { v7 as uuidv7 } from "uuid";
import type { ContentTypeDefinition, FieldDefinition } from "@plyrs/metamodel";
import { Button, Checkbox, Select, TextArea, TextField } from "@plyrs/ui";
import { colors, spacing, typography } from "@plyrs/ui/tokens.stylex";
import type { ContentTypeSummary } from "../lib/admin-api";
import {
  buildDefinition,
  emptyFieldDraft,
  toFieldDraft,
  type FieldDraft,
} from "../lib/content-type-form";

const styles = stylex.create({
  form: {
    display: "flex",
    flexDirection: "column",
    gap: spacing.md,
    maxWidth: "720px",
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
    whiteSpace: "pre-wrap",
  },
  warning: {
    padding: spacing.sm,
    borderRadius: "6px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: colors.border,
    backgroundColor: colors.surface,
    color: colors.textMuted,
    fontSize: typography.sizeSm,
  },
  fieldCard: {
    display: "flex",
    flexDirection: "column",
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: "6px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: colors.border,
  },
  fieldRow: { display: "flex", gap: spacing.md, flexWrap: "wrap", alignItems: "flex-end" },
  actions: { display: "flex", gap: spacing.sm },
});

const FIELD_TYPES: { value: FieldDefinition["type"]; label: string }[] = [
  { value: "text", label: "text" },
  { value: "number", label: "number" },
  { value: "boolean", label: "boolean" },
  { value: "datetime", label: "datetime" },
  { value: "json", label: "json" },
  { value: "select", label: "select" },
  { value: "richtext", label: "richtext" },
  { value: "relation", label: "relation" },
];

export interface ContentTypeFormProps {
  /** null = 新規作成 */
  existing: ContentTypeSummary | null;
  onSubmit: (definition: ContentTypeDefinition) => Promise<void>;
}

export function ContentTypeForm({ existing, onSubmit }: ContentTypeFormProps) {
  const [key, setKey] = useState(existing?.key ?? "");
  const [name, setName] = useState(existing?.name ?? "");
  const [drafts, setDrafts] = useState<FieldDraft[]>(
    existing === null ? [] : existing.fields.map(toFieldDraft),
  );
  const [errors, setErrors] = useState<string[]>([]);

  function updateDraft(index: number, patch: Partial<FieldDraft>) {
    setDrafts((current) =>
      current.map((draft, i) => (i === index ? { ...draft, ...patch } : draft)),
    );
  }

  async function handleSubmit() {
    const result = buildDefinition({
      // 裁定 3: key は id に対して不変(key_mismatch 409)。id は新規のみクライアント生成。
      id: existing?.id ?? uuidv7(),
      key,
      name,
      drafts,
      // version はサーバー管理(registerContentTypeCore が prev.version + 1 を採る)。
      // スキーマが positive int を要求するため現行値(新規は 1)を運ぶだけ。
      version: existing?.version ?? 1,
    });
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors([]);
    try {
      await onSubmit(result.definition);
    } catch (cause) {
      setErrors([cause instanceof Error ? cause.message : String(cause)]);
    }
  }

  return (
    <div {...stylex.props(styles.form)}>
      {errors.length > 0 && (
        <div role="alert" {...stylex.props(styles.banner)}>
          {errors.join("\n")}
        </div>
      )}
      {existing !== null && (
        <p {...stylex.props(styles.warning)}>
          既存のレコードは自動では追従しません(読み取りは寛容・書き込み時に現行定義で検証 =
          遅延適合)。フィールドの削除・型変更は値を移行しません。key の変更は削除 + 追加として
          扱われます。
        </p>
      )}
      <TextField label="key" value={key} onChange={setKey} isDisabled={existing !== null} />
      <TextField label="表示名" value={name} onChange={setName} />
      {drafts.map((draft, index) => (
        <FieldDraftCard
          key={index}
          draft={draft}
          onChange={(patch) => updateDraft(index, patch)}
          onRemove={() => setDrafts((current) => current.filter((_, i) => i !== index))}
        />
      ))}
      <div {...stylex.props(styles.actions)}>
        <Button
          variant="secondary"
          onPress={() => setDrafts((current) => [...current, emptyFieldDraft()])}
        >
          フィールドを追加
        </Button>
        <Button onPress={() => void handleSubmit()}>保存</Button>
      </div>
    </div>
  );
}

function FieldDraftCard({
  draft,
  onChange,
  onRemove,
}: {
  draft: FieldDraft;
  onChange: (patch: Partial<FieldDraft>) => void;
  onRemove: () => void;
}) {
  const indexable = ["text", "number", "boolean", "datetime", "select"].includes(draft.type);
  const uniqueable = ["text", "number", "datetime"].includes(draft.type);
  return (
    <div {...stylex.props(styles.fieldCard)}>
      <div {...stylex.props(styles.fieldRow)}>
        <TextField
          label="フィールド key"
          value={draft.key}
          onChange={(next) => onChange({ key: next })}
        />
        <Select
          label="型"
          items={FIELD_TYPES}
          selectedValue={draft.type}
          onChange={(next) => onChange({ type: next as FieldDraft["type"] })}
        />
        <Checkbox isSelected={draft.required} onChange={(next) => onChange({ required: next })}>
          必須
        </Checkbox>
        {indexable && (
          <Checkbox isSelected={draft.indexed} onChange={(next) => onChange({ indexed: next })}>
            indexed
          </Checkbox>
        )}
        {uniqueable && (
          <Checkbox isSelected={draft.unique} onChange={(next) => onChange({ unique: next })}>
            unique
          </Checkbox>
        )}
        <Button variant="secondary" onPress={onRemove}>
          削除
        </Button>
      </div>
      {draft.type === "text" && (
        <TextField
          label="maxLength"
          value={draft.maxLength}
          onChange={(next) => onChange({ maxLength: next })}
        />
      )}
      {draft.type === "number" && (
        <Checkbox isSelected={draft.integer} onChange={(next) => onChange({ integer: next })}>
          整数のみ
        </Checkbox>
      )}
      {draft.type === "select" && (
        <>
          <TextArea
            label="選択肢(1 行 1 件、value=ラベル)"
            value={draft.optionsText}
            onChange={(next) => onChange({ optionsText: next })}
            rows={4}
          />
          <Checkbox isSelected={draft.multiple} onChange={(next) => onChange({ multiple: next })}>
            複数選択
          </Checkbox>
        </>
      )}
      {draft.type === "relation" && (
        <div {...stylex.props(styles.fieldRow)}>
          <TextField
            label="許可する型(カンマ区切り)"
            value={draft.allowedTypes}
            onChange={(next) => onChange({ allowedTypes: next })}
          />
          <Select
            label="カーディナリティ"
            items={[
              { value: "one", label: "one" },
              { value: "many", label: "many" },
            ]}
            selectedValue={draft.cardinality}
            onChange={(next) => onChange({ cardinality: next as "one" | "many" })}
          />
          <Checkbox isSelected={draft.ordered} onChange={(next) => onChange({ ordered: next })}>
            順序を保持
          </Checkbox>
        </div>
      )}
    </div>
  );
}
