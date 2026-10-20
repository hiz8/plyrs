import * as stylex from "@stylexjs/stylex";
import { useEffect, useImperativeHandle, useRef, useState, type ReactNode, type Ref } from "react";
import { useForm, useStore } from "@tanstack/react-form";
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
  Checkbox,
  CheckboxGroup,
  RichTextEditor,
  Select,
  TextArea,
  TextField,
  type RichTextMentionItem,
} from "@plyrs/ui";
import { border, font, radius, space, status, stroke, text } from "@plyrs/ui/semantic.stylex";
import type { AssetServices } from "../lib/asset-services";
import { RECORD_FORM_LABELS } from "../lib/labels";
import { labelForRecord } from "../lib/record-label";
import {
  asRichTextValue,
  draftValueEquals,
  fromDraftValues,
  isDraftDirty,
  relationDraftKey,
  toDraftValues,
  type DraftValues,
} from "../lib/record-form-values";
import { richTextPlainText } from "../lib/richtext-text";
import { useRecordsOfTypes } from "../lib/use-collection";
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
    gap: space.md,
    maxWidth: "640px",
    fontFamily: font.family,
  },
  banner: {
    padding: space.sm,
    borderRadius: radius.control,
    borderWidth: stroke.default,
    borderStyle: "solid",
    borderColor: status.danger,
    color: status.danger,
    fontSize: font.body,
  },
  notice: {
    padding: space.sm,
    borderRadius: radius.control,
    borderWidth: stroke.default,
    borderStyle: "solid",
    borderColor: border.default,
    color: text.muted,
    fontSize: font.body,
  },
  emptyHint: {
    padding: space.md,
    borderRadius: radius.control,
    borderWidth: stroke.default,
    borderStyle: "dashed",
    borderColor: border.default,
    color: text.muted,
    fontSize: font.body,
  },
  fieldLabel: { fontSize: font.caption, color: text.muted },
  fieldError: { fontSize: font.caption, color: status.danger },
  fieldBlock: { display: "flex", flexDirection: "column", gap: space.xs },
  fieldDescription: { margin: 0, fontSize: font.caption, color: text.muted },
  readOnlyValue: { fontSize: font.body, color: text.default },
});

// conflict ack(ok:false, code:"conflict")から競合フィールド一覧を取り出す。
// それ以外のエラーは空配列(既存のエラーバナー経路へ)。
function syncConflictFields(cause: unknown): string[] {
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
    return RECORD_FORM_LABELS.empty;
  }
  const json = JSON.stringify(value);
  return json.length <= 120 ? json : `${json.slice(0, 120)}…`;
}

/** 競合で「あとで決める」「取り込む」を選んだ。保存は完了していない(呼び出し側は通知しない) */
export class SaveDeferredError extends Error {
  constructor() {
    super("save deferred");
    this.name = "SaveDeferredError";
  }
}

/** save() の中の検証で弾かれた(エラーはフィールドに表示済み) */
export class ValidationFailedError extends Error {
  constructor() {
    super("validation failed");
    this.name = "ValidationFailedError";
  }
}

export interface RecordFormHandle {
  /** 変換と検証。エラーがあればフィールドに表示し、最初のエラーへスクロールして false */
  validate(): boolean;
  /** 検証 → onSubmit → dirty の基準を進める。競合は本文のダイアログで解決し、「残す」なら再送して成功、それ以外は SaveDeferredError を投げる。他の失敗は cause をそのまま投げる */
  save(): Promise<void>;
}

export interface RecordFormProps {
  contentType: ContentTypeDefinition;
  types: ContentTypeDefinition[];
  registry: CollectionRegistry;
  /** null = 新規作成 */
  record: SyncRecord | null;
  onSubmit: (input: Record<string, unknown>) => Promise<void>;
  /** 下書きが保存済みの姿から変わったかを通知する(変化時だけ) */
  onDirtyChange: (dirty: boolean) => void;
  /** 閲覧者向け。全フィールドを読み取り専用にし、本文のツールバーを出さない */
  isReadOnly?: boolean | undefined;
  /** アセット操作(アップロード・プレビュー)。省略時はアセット UI を出さず従来表示に落ちる */
  assets?: AssetServices | undefined;
  /** 画面側の保存ボタンから validate / save を呼ぶためのハンドル。フォームは送信ボタンを持たない */
  ref: Ref<RecordFormHandle>;
}

// "kept" = あなたの編集を残す(再送する)、"deferred" = あとで決める / 取り込む、
// "saved" = 自己競合ガードで保存済みと判明した(再送しない)
type ConflictOutcome = "kept" | "deferred" | "saved";

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
  onSubmit,
  onDirtyChange,
  isReadOnly,
  assets,
  ref,
}: RecordFormProps) {
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [conflict, setConflict] = useState<PendingConflict | null>(null);
  // 競合ダイアログの解決待ち。save() が待ち、ダイアログのボタンが解決する
  const conflictResolver = useRef<((outcome: ConflictOutcome) => void) | null>(null);
  const formElement = useRef<HTMLFormElement | null>(null);
  // validate() が false のとき、エラー表示の描画後に最初のエラーへ移るための印
  const scrollToError = useRef(false);
  const lastDirty = useRef(false);
  // 本文画像挿入: ツールバーの「画像」→ ダイアログ → insert(挿入関数は state に保持)
  const [imageInsert, setImageInsert] = useState<((item: AssetSelectItem) => void) | null>(null);
  // §12 必須②: dirty 判定の基準。マウント時のスナップショットから始め、保存成功・
  // サーバー版採用のたびに「確定した姿」へ進める。
  const [initialDraft, setInitialDraft] = useState<DraftValues>(() =>
    toDraftValues(contentType, record?.input ?? {}),
  );

  // 本文中 record 参照(@)の候補: 同期済みの全型のコレクションを束ねて購読する
  // (relation picker と同じフックを全型キーで使い回す)。自分自身への参照は候補から外す。
  const mentionSource = useRecordsOfTypes(
    registry,
    types.map((type) => type.key),
  ).toSorted((a, b) => a.id.localeCompare(b.id));
  const mentionCandidates: RichTextMentionItem[] = mentionSource
    .filter((candidate) => candidate.id !== record?.id)
    .map((candidate) => ({
      id: candidate.id,
      type: candidate.type,
      label: labelForRecord(types, candidate),
    }));

  // 送信ボタンは持たない(保存は公開ボックスからハンドル経由)。値は form が保持するだけ
  const form = useForm({ defaultValues: initialDraft });
  const values = useStore(form.store, (state) => state.values);

  const dirty = isDraftDirty(initialDraft, values);
  useEffect(() => {
    if (lastDirty.current !== dirty) {
      lastDirty.current = dirty;
      onDirtyChange(dirty);
    }
  }, [dirty, onDirtyChange]);

  // validate() が false を返した直後の描画で、最初の aria-invalid へスクロールして focus する
  useEffect(() => {
    if (!scrollToError.current) {
      return;
    }
    scrollToError.current = false;
    const target = formElement.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
    if (target === null || target === undefined) {
      return;
    }
    // jsdom には scrollIntoView が無い
    if (typeof target.scrollIntoView === "function") {
      target.scrollIntoView({ block: "center" });
    }
    target.focus();
  }, [fieldErrors]);

  // 編集(record あり)は dirty キーのみ書き戻す(§12 必須②)。新規作成は全量。
  const convert = () => {
    const value = form.state.values;
    const converted = fromDraftValues(
      contentType,
      value,
      record?.input ?? {},
      record !== null ? initialDraft : undefined,
    );
    return { value, converted };
  };

  const validate = (): boolean => {
    const { converted } = convert();
    if (!converted.ok) {
      setFieldErrors(converted.fieldErrors);
      setBanner(converted.fieldErrors[""] ?? null);
      scrollToError.current = true;
      return false;
    }
    setFieldErrors({});
    setBanner(null);
    return true;
  };

  const save = async (): Promise<void> => {
    if (conflictResolver.current !== null) {
      // 競合ダイアログの解決待ち中は新しい保存を始めない
      throw new SaveDeferredError();
    }
    if (!validate()) {
      throw new ValidationFailedError();
    }
    const { value, converted } = convert();
    if (!converted.ok) {
      throw new ValidationFailedError();
    }
    setNotice(null);
    try {
      await onSubmit(converted.input);
      // 保存成功: dirty 判定の基準を「今保存した姿」へ進める(次回以降の保存が
      // 直前保存分を再送して他者の後続変更を巻き戻すのを防ぐ)
      setInitialDraft(value);
      return;
    } catch (cause) {
      const conflictFields = syncConflictFields(cause);
      // 新規作成(record なし)の競合は突き合わせ相手が無くダイアログを出せないため、そのまま投げる
      if (conflictFields.length === 0 || record === null) {
        throw cause;
      }
      const outcome = await new Promise<ConflictOutcome>((resolve) => {
        conflictResolver.current = resolve;
        setConflict({
          fieldKeys: conflictFields,
          submittedInput: converted.input,
          submittedDraft: value,
        });
      });
      conflictResolver.current = null;
      if (outcome === "deferred") {
        throw new SaveDeferredError();
      }
      if (outcome === "saved") {
        return;
      }
      // draft は自分の版のまま。他者の変更は既に store に確定しているため、再送信の
      // baseFieldVersions は最新へ進み、今度はクリーンな上書き(手動裁定の LWW)として通る。
      await onSubmit(converted.input);
      setInitialDraft(value);
    }
  };

  useImperativeHandle(ref, () => ({ validate, save }));

  // 競合待ちの間にアンマウントされたら「あとで決める」扱いで save() を抜けさせる
  useEffect(
    () => () => {
      conflictResolver.current?.("deferred");
      conflictResolver.current = null;
    },
    [],
  );

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
      conflictResolver.current?.("saved");
    }
  }, [conflict, record]);

  const latestInput = record?.input ?? {};
  const realConflictKeys =
    conflict === null
      ? []
      : conflict.fieldKeys.filter(
          (key) => !draftValueEquals(latestInput[key], conflict.submittedInput[key]),
        );

  const adoptTheirs = () => {
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
    setNotice(RECORD_FORM_LABELS.adoptedNotice);
    // 他のフィールドに未保存の変更が残り得るため、保存は完了扱いにしない
    conflictResolver.current?.("deferred");
  };

  const keepMine = () => {
    setConflict(null);
    conflictResolver.current?.("kept");
  };

  const decideLater = () => {
    setConflict(null);
    conflictResolver.current?.("deferred");
  };

  return (
    <form
      ref={formElement}
      {...stylex.props(styles.form)}
      // isRequired を TextField に渡すと native required 属性が付き、ブラウザ(jsdom 含む)の
      // 制約検証が submit イベント自体を止めてしまう。検証は変換層(record-form-values)に
      // 一本化するため native 検証を無効化する。
      noValidate
      // 保存は公開ボックスからハンドル経由。Enter での送信はページ遷移を防ぐだけ
      onSubmit={(event) => event.preventDefault()}
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
      {conflict !== null && record !== null && realConflictKeys.length > 0 && (
        <ConflictDialog
          isOpen
          conflicts={realConflictKeys.map((key) => ({
            fieldKey: key,
            label: contentType.fields.find((entry) => entry.key === key)?.label ?? key,
            mine: conflictExcerpt(conflict.submittedInput[key]),
            theirs: conflictExcerpt(latestInput[key]),
          }))}
          theirsSavedAt={record.updatedAt}
          onKeepMine={keepMine}
          onAdoptTheirs={adoptTheirs}
          onDecideLater={decideLater}
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
              isReadOnly={isReadOnly === true}
              locked={
                contentType.key === ASSET_TYPE_KEY &&
                (ASSET_SYSTEM_MANAGED_FIELD_KEYS as readonly string[]).includes(field.key)
              }
              onRequestAssetImage={
                assets === undefined || isReadOnly === true
                  ? undefined
                  : (insert) => setImageInsert(() => insert)
              }
            />
          )}
        </form.Field>
      ))}
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

// text / json 以外の型(自前のラベルを持つ部品)に補足説明を添える。ラベルの直下ではなく部品の下に出る
function WithDescription({
  description,
  children,
}: {
  description: string | undefined;
  children: ReactNode;
}) {
  if (description === undefined) {
    return children;
  }
  return (
    <div {...stylex.props(styles.fieldBlock)}>
      {children}
      <p {...stylex.props(styles.fieldDescription)}>{description}</p>
    </div>
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
  isReadOnly,
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
  isReadOnly: boolean;
  onRequestAssetImage: ((insert: (item: AssetSelectItem) => void) => void) | undefined;
}) {
  const label = field.label ?? field.key;
  const description = field.description;
  switch (field.type) {
    case "text":
      return (
        <TextField
          label={label}
          {...(description !== undefined && { description })}
          value={typeof value === "string" ? value : ""}
          onChange={onChange}
          isRequired={field.required ?? false}
          isInvalid={error !== undefined}
          errorMessage={error}
          isDisabled={locked}
          isReadOnly={isReadOnly}
        />
      );
    case "number":
      return (
        <TextField
          label={label}
          {...(description !== undefined && { description })}
          value={typeof value === "string" ? value : ""}
          onChange={onChange}
          inputMode="numeric"
          isInvalid={error !== undefined}
          errorMessage={error}
          isDisabled={locked}
          isReadOnly={isReadOnly}
        />
      );
    case "datetime":
      return (
        <TextField
          label={label}
          value={typeof value === "string" ? value : ""}
          onChange={onChange}
          // design-spec §5: 格納は UTC ISO8601('Z' 終端)。表示層の TZ 変換は将来課題。
          // バリデーションエラーは metamodel 側の「Invalid input」のみで形式が伝わらないため、
          // placeholder と description で期待形式を補足する(バリデーション自体は変更しない)。
          // フィールド定義の description があればそちらを優先する。
          placeholder="2026-10-01T00:20:00Z"
          description={
            description ?? "UTC の Z 終端 ISO 8601 形式のみ受け付けます(例: 2026-10-01T00:20:00Z)"
          }
          isInvalid={error !== undefined}
          errorMessage={error}
          isDisabled={locked}
          isReadOnly={isReadOnly}
        />
      );
    case "boolean":
      return (
        <WithDescription description={description}>
          <Checkbox
            isSelected={value === true}
            onChange={onChange}
            isDisabled={locked}
            isReadOnly={isReadOnly}
          >
            {label}
          </Checkbox>
        </WithDescription>
      );
    case "json":
      return (
        <TextArea
          label={label}
          {...(description !== undefined && { description })}
          value={typeof value === "string" ? value : ""}
          onChange={onChange}
          isInvalid={error !== undefined}
          errorMessage={error}
          isDisabled={locked}
          isReadOnly={isReadOnly}
        />
      );
    case "select": {
      const options = field.config.options.map((option) => ({
        value: option.value,
        label: option.label,
      }));
      if (field.config.multiple === true) {
        return (
          <WithDescription description={description}>
            <CheckboxGroup
              label={label}
              options={options}
              value={Array.isArray(value) ? (value as string[]) : []}
              onChange={onChange}
              errorMessage={error}
              isReadOnly={isReadOnly}
            />
          </WithDescription>
        );
      }
      return (
        <WithDescription description={description}>
          <Select
            label={label}
            items={options}
            selectedValue={typeof value === "string" ? value : ""}
            onChange={onChange}
            placeholder={RECORD_FORM_LABELS.unset}
            errorMessage={error}
            isReadOnly={isReadOnly}
          />
        </WithDescription>
      );
    }
    case "richtext":
      return (
        <WithDescription description={description}>
          <RichTextEditor
            label={label}
            value={asRichTextValue(value)}
            onChange={onChange}
            mentionCandidates={mentionCandidates}
            errorMessage={error}
            onRequestAssetImage={onRequestAssetImage}
            resolveAssetUrl={assets?.resolveUrl}
            isReadOnly={isReadOnly}
          />
        </WithDescription>
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
          <WithDescription description={description}>
            <AssetRelationPicker
              field={field}
              value={value}
              onChange={onChange}
              error={error}
              types={types}
              registry={registry}
              assets={assets}
              isReadOnly={isReadOnly}
            />
          </WithDescription>
        );
      }
      return (
        <WithDescription description={description}>
          <RelationPicker
            field={field}
            value={value}
            onChange={onChange}
            error={error}
            types={types}
            registry={registry}
            isReadOnly={isReadOnly}
          />
        </WithDescription>
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
  isReadOnly,
}: {
  field: Extract<FieldDefinition, { type: "relation" }>;
  value: unknown;
  onChange: (next: unknown) => void;
  error: string | undefined;
  types: ContentTypeDefinition[];
  registry: CollectionRegistry;
  isReadOnly: boolean;
}) {
  const label = field.label ?? field.key;
  const candidates = useRecordsOfTypes(registry, field.config.allowedTypes).toSorted((a, b) =>
    a.id.localeCompare(b.id),
  );
  const options = candidates.map((candidate) => ({
    value: relationDraftKey({ type: candidate.type, id: candidate.id }),
    label: labelForRecord(types, candidate),
  }));
  if (isReadOnly) {
    // 閲覧者向け: ラベルと選択中の名前の文字だけ
    const selectedKeys = Array.isArray(value)
      ? (value as string[])
      : typeof value === "string"
        ? [value]
        : [];
    const names = selectedKeys
      .filter((key) => key !== "")
      .map((key) => options.find((option) => option.value === key)?.label ?? key);
    return (
      <div {...stylex.props(styles.fieldBlock)}>
        <span {...stylex.props(styles.fieldLabel)}>{label}</span>
        {names.map((name, index) => (
          <span key={`${name}-${index}`} {...stylex.props(styles.readOnlyValue)}>
            {name}
          </span>
        ))}
      </div>
    );
  }
  if (candidates.length === 0) {
    return (
      <div>
        <span {...stylex.props(styles.fieldLabel)}>{label}</span>
        <div {...stylex.props(styles.emptyHint)}>{RECORD_FORM_LABELS.noCandidates}</div>
        {error !== undefined && <span {...stylex.props(styles.fieldError)}>{error}</span>}
      </div>
    );
  }
  if (field.config.cardinality === "many") {
    return (
      <CheckboxGroup
        label={label}
        options={options}
        value={Array.isArray(value) ? (value as string[]) : []}
        onChange={onChange}
        errorMessage={error}
      />
    );
  }
  return (
    <Select
      label={label}
      items={options}
      selectedValue={typeof value === "string" ? value : ""}
      onChange={onChange}
      placeholder={RECORD_FORM_LABELS.unset}
      errorMessage={error}
    />
  );
}
