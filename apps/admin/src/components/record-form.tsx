import * as stylex from "@stylexjs/stylex";
import { useEffect, useState } from "react";
import { useForm } from "@tanstack/react-form";
import {
  ASSET_SYSTEM_MANAGED_FIELD_KEYS,
  ASSET_TYPE_KEY,
  type ContentTypeDefinition,
  type FieldDefinition,
} from "@plyrs/metamodel";
import type { FieldConflict, SyncRecord } from "@plyrs/sync-protocol";
import { SyncRejectedError } from "@plyrs/sync-client";
import type { CollectionRegistry } from "@plyrs/sync-client/tanstack";
import {
  Button,
  Checkbox,
  CheckboxGroup,
  RichTextEditor,
  Select,
  TextArea,
  TextField,
  type RichTextMentionItem,
} from "@plyrs/ui";
import { colors, spacing, typography } from "@plyrs/ui/tokens.stylex";
import type { AssetServices } from "../lib/asset-services";
import {
  asRichTextValue,
  draftValueEquals,
  fromDraftValues,
  relationDraftKey,
  toDraftValues,
  type DraftValues,
} from "../lib/record-form-values";
import { richTextPlainText } from "../lib/richtext-text";
import { useRelationCandidates } from "../lib/use-collection";
import { AssetRelationPicker, AssetSelectDialog, type AssetSelectItem } from "./asset-picker";
import { ConflictDialog } from "./conflict-dialog";

// サーバー版採用でサーバー側に本文が無い場合に使う明示的な空ドキュメント。
// undefined のままだと RichTextEditor が「初期状態」として無視し、自分の版が表示され続ける。
// 空 envelope は fromDraftValues でキー削除に写るため保存意味論は変わらない。
const EMPTY_RICH_TEXT_DRAFT = {
  schemaVersion: 1,
  doc: { type: "doc", content: [{ type: "paragraph" }] },
};

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
  notice: {
    padding: spacing.sm,
    borderRadius: "6px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: colors.border,
    color: colors.textMuted,
    fontSize: typography.sizeMd,
  },
  emptyHint: {
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

// conflict ack(ok:false, code:"conflict")から競合フィールド一覧を取り出す。
// それ以外のエラーは空配列(既存のエラーバナー経路へ)。
export function syncConflictFields(cause: unknown): string[] {
  const isRejection =
    cause instanceof SyncRejectedError ||
    (cause instanceof Error && cause.name === "SyncRejectedError");
  if (!isRejection || (cause as { code?: string }).code !== "conflict") {
    return [];
  }
  const conflicts = (cause as { conflicts?: FieldConflict[] }).conflicts ?? [];
  return conflicts.map((conflict) => conflict.fieldKey);
}

// 競合ダイアログの抜粋。richtext 以外が競合し得る将来拡張にも壊れないようフォールバックを持つ
function conflictExcerpt(value: unknown): string {
  const envelope = asRichTextValue(value);
  if (envelope !== undefined) {
    return richTextPlainText(envelope);
  }
  if (value === undefined) {
    return "（空）";
  }
  const text = JSON.stringify(value);
  return text.length <= 120 ? text : `${text.slice(0, 120)}…`;
}

export interface RecordFormProps {
  contentType: ContentTypeDefinition;
  types: ContentTypeDefinition[];
  registry: CollectionRegistry;
  /** null = 新規作成 */
  record: SyncRecord | null;
  submitLabel: string;
  onSubmit: (input: Record<string, unknown>) => Promise<void>;
  /** アセット操作(アップロード・プレビュー)。省略時はアセット UI を出さず従来表示に落ちる */
  assets?: AssetServices | undefined;
}

interface PendingConflict {
  fieldKeys: string[];
  submittedInput: Record<string, unknown>;
  submittedDraft: DraftValues;
}

export function RecordForm({
  contentType,
  types,
  registry,
  record,
  submitLabel,
  onSubmit,
  assets,
}: RecordFormProps) {
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [conflict, setConflict] = useState<PendingConflict | null>(null);
  // 本文画像挿入: ツールバーの「画像」→ ダイアログ → insert(挿入関数は state に保持)
  const [imageInsert, setImageInsert] = useState<((item: AssetSelectItem) => void) | null>(null);
  // §12 必須②: dirty 判定の基準。マウント時のスナップショットから始め、保存成功・
  // サーバー版採用のたびに「確定した姿」へ進める。
  const [initialDraft, setInitialDraft] = useState<DraftValues>(() =>
    toDraftValues(contentType, record?.input ?? {}),
  );

  // 本文中 record 参照(@)の候補: 同期済みの全型のコレクションを束ねて購読する
  // (relation picker と同じフックを全型キーで使い回す)。自分自身への参照は候補から外す。
  const mentionSource = useRelationCandidates(
    registry,
    types.map((type) => type.key),
  );
  const mentionCandidates: RichTextMentionItem[] = mentionSource
    .filter((candidate) => candidate.id !== record?.id)
    .map((candidate) => ({
      id: candidate.id,
      type: candidate.type,
      label: labelForRecord(types, candidate),
    }));

  const form = useForm({
    defaultValues: initialDraft,
    onSubmit: async ({ value }) => {
      setBanner(null);
      setNotice(null);
      // 編集(record あり)は dirty キーのみ書き戻す(§12 必須②)。新規作成は全量。
      const converted = fromDraftValues(
        contentType,
        value,
        record?.input ?? {},
        record !== null ? initialDraft : undefined,
      );
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
        // 保存成功: dirty 判定の基準を「今保存した姿」へ進める(次回以降の保存が
        // 直前保存分を再送して他者の後続変更を巻き戻すのを防ぐ)
        setInitialDraft(value);
      } catch (cause) {
        const conflictFields = syncConflictFields(cause);
        if (conflictFields.length > 0) {
          setConflict({
            fieldKeys: conflictFields,
            submittedInput: converted.input,
            submittedDraft: value,
          });
          return;
        }
        setBanner(syncErrorMessage(cause));
      }
    },
  });

  // §8 の自己競合ガード: conflict ack は「ack 消失後の再送が、適用済みの自分自身の変更と
  // 衝突した」だけのことがある。手元 store の最新 record と突き合わせ、全競合フィールドが
  // 自分の送信値と一致していれば実質成功として静かに閉じる。
  useEffect(() => {
    if (conflict === null) {
      return;
    }
    const latest = record?.input ?? {};
    const real = conflict.fieldKeys.filter(
      (key) => !draftValueEquals(latest[key], conflict.submittedInput[key]),
    );
    if (real.length === 0) {
      setInitialDraft(conflict.submittedDraft);
      setConflict(null);
    }
  }, [conflict, record]);

  const latestInput = record?.input ?? {};
  const realConflictKeys =
    conflict === null
      ? []
      : conflict.fieldKeys.filter(
          (key) => !draftValueEquals(latestInput[key], conflict.submittedInput[key]),
        );

  const adoptServer = () => {
    if (conflict === null) {
      return;
    }
    const serverDraft = toDraftValues(contentType, record?.input ?? {});
    const adopted: DraftValues = {};
    for (const key of conflict.fieldKeys) {
      const field = contentType.fields.find((entry) => entry.key === key);
      adopted[key] =
        field?.type === "richtext" && serverDraft[key] === undefined
          ? EMPTY_RICH_TEXT_DRAFT
          : serverDraft[key];
    }
    setInitialDraft((previous) => ({ ...previous, ...adopted }));
    for (const key of conflict.fieldKeys) {
      form.setFieldValue(key, adopted[key]);
    }
    setConflict(null);
    setNotice(
      "サーバー版を反映しました。他に未保存の変更が残っている場合は改めて保存してください。",
    );
  };

  const keepMine = () => {
    setConflict(null);
    // draft は自分の版のまま。他者の変更は既に store に確定しているため、再送信の
    // baseFieldVersions は最新へ進み、今度はクリーンな上書き(手動裁定の LWW)として通る。
    void form.handleSubmit();
  };

  return (
    <form
      {...stylex.props(styles.form)}
      // isRequired を TextField に渡すと native required 属性が付き、ブラウザ(jsdom 含む)の
      // 制約検証が submit イベント自体を止めてしまい TanStack Form + zod の検証まで届かない。
      // 検証は変換層(record-form-values)に一本化するため native 検証を無効化する。
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        // 競合ダイアログ表示中は新しい送信を受け付けない(Enter キー経由の送信も含む)。
        // keepMine は form.handleSubmit() を直接呼ぶためこのガードの影響を受けない。
        if (conflict !== null) {
          return;
        }
        void form.handleSubmit();
      }}
    >
      {banner !== null && (
        <div role="alert" {...stylex.props(styles.banner)}>
          {banner}
        </div>
      )}
      {notice !== null && (
        <div role="status" {...stylex.props(styles.notice)}>
          {notice}
        </div>
      )}
      {conflict !== null && realConflictKeys.length > 0 && (
        <ConflictDialog
          conflicts={realConflictKeys.map((key) => ({
            fieldKey: key,
            mine: conflictExcerpt(conflict.submittedInput[key]),
            theirs: conflictExcerpt(latestInput[key]),
          }))}
          onKeepMine={keepMine}
          onAdoptServer={adoptServer}
        />
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
              mentionCandidates={mentionCandidates}
              assets={assets}
              locked={
                contentType.key === ASSET_TYPE_KEY &&
                (ASSET_SYSTEM_MANAGED_FIELD_KEYS as readonly string[]).includes(field.key)
              }
              onRequestAssetImage={
                assets === undefined ? undefined : (insert) => setImageInsert(() => insert)
              }
            />
          )}
        </form.Field>
      ))}
      <div {...stylex.props(styles.actions)}>
        <Button type="submit" isDisabled={conflict !== null}>
          {submitLabel}
        </Button>
      </div>
      {imageInsert !== null && assets !== undefined && (
        <AssetSelectDialog
          registry={registry}
          types={types}
          assets={assets}
          onSelect={(item) => {
            imageInsert(item);
            setImageInsert(null);
          }}
          onClose={() => setImageInsert(null)}
        />
      )}
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
  mentionCandidates,
  assets,
  locked,
  onRequestAssetImage,
}: {
  field: FieldDefinition;
  value: unknown;
  onChange: (next: unknown) => void;
  error: string | undefined;
  types: ContentTypeDefinition[];
  registry: CollectionRegistry;
  mentionCandidates: RichTextMentionItem[];
  assets: AssetServices | undefined;
  locked: boolean;
  onRequestAssetImage: ((insert: (item: AssetSelectItem) => void) => void) | undefined;
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
          isDisabled={locked}
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
          isDisabled={locked}
        />
      );
    case "datetime":
      return (
        <TextField
          label={field.key}
          value={typeof value === "string" ? value : ""}
          onChange={onChange}
          // design-spec §5: 格納は UTC ISO8601('Z' 終端)。表示層の TZ 変換は将来課題。
          isInvalid={error !== undefined}
          errorMessage={error}
          isDisabled={locked}
        />
      );
    case "boolean":
      return (
        <Checkbox isSelected={value === true} onChange={onChange} isDisabled={locked}>
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
          isDisabled={locked}
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
        <RichTextEditor
          label={field.key}
          value={asRichTextValue(value)}
          onChange={onChange}
          mentionCandidates={mentionCandidates}
          errorMessage={error}
          onRequestAssetImage={onRequestAssetImage}
          resolveAssetUrl={assets?.resolveUrl}
        />
      );
    case "relation":
      // Phase 8 裁定: メディアフィールド = allowedTypes ["asset"] の関係フィールド。
      // assets(アップロード経路)が配線されているときだけ専用 UI に切り替える。
      if (
        assets !== undefined &&
        field.config.allowedTypes.length === 1 &&
        field.config.allowedTypes[0] === ASSET_TYPE_KEY
      ) {
        return (
          <AssetRelationPicker
            field={field}
            value={value}
            onChange={onChange}
            error={error}
            types={types}
            registry={registry}
            assets={assets}
          />
        );
      }
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
        <div {...stylex.props(styles.emptyHint)}>
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
