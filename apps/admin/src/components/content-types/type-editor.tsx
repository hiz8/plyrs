import * as stylex from "@stylexjs/stylex";
import { LayoutGrid, Plus } from "lucide-react";
import { useRef, useState } from "react";
import { CONTENT_TYPE_DESCRIPTION_MAX_LENGTH, type FieldDefinition } from "@plyrs/metamodel";
import type { SyncRecord } from "@plyrs/sync-protocol";
import { Button, EmptyState, ModalDialog, TextField } from "@plyrs/ui";
import { font, space, text } from "@plyrs/ui/semantic.stylex";
import type { ContentTypeSummary } from "../../lib/admin-api";
import {
  currentCrumb,
  homeCrumb,
  settingsContentTypesCrumb,
  settingsCrumb,
} from "../../lib/breadcrumbs";
import {
  autoFill,
  effectiveTitleField,
  emptyFieldDraft,
  fieldDraftErrors,
  hasSlugField,
  isTypeDraftDirty,
  isTypeDraftEmpty,
  keyErrorMessage,
  validateTypeKey,
  type FieldDraft,
  type TypeDraft,
} from "../../lib/content-type-form";
import { referenceCandidates } from "../../lib/content-types";
import { CONTENT_TYPE_LABELS, DIALOGS } from "../../lib/labels";
import { useLeaveGuard } from "../../lib/use-leave-guard";
import { PageBody, TenantPageHeader } from "../tenant-page-header";
import { AddFieldDialog } from "./add-field-dialog";
import { DeleteFieldDialog } from "./delete-field-dialog";
import { FieldList } from "./field-list";
import { FieldPanel } from "./field-panel";
import { ListColumnsPicker } from "./list-columns-picker";

const NARROW = "@media (max-width: 959px)";

// 本文の最大幅 880px は設定の各画面と同じ(settings-frame.tsx の SETTINGS_MAX_WIDTH。
// StyleX は別ファイルの定数を評価できないため値を書く)
const MAX_WIDTH = "880px";

const styles = stylex.create({
  body: {
    display: "flex",
    flexDirection: "column",
    gap: space.lg,
    maxWidth: MAX_WIDTH,
    fontFamily: font.family,
  },
  // 右パネル(420px)を開いている間、行の「編集」がパネルに隠れないよう右を空ける(E29)。
  // パネルの幅は部品固有の寸法(案 E 5.2)。狭い画面ではパネルが全面のシートになるので 0
  panelOpen: { paddingInlineEnd: { default: "420px", [NARROW]: 0 } },
  grid: {
    display: "grid",
    gridTemplateColumns: { default: "1fr 1fr", [NARROW]: "1fr" },
    gap: space.md,
    alignItems: "start",
  },
  fieldsHeading: {
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: space.sm,
  },
  fieldsTitle: { display: "flex", alignItems: "baseline", gap: space.sm },
  title: { fontSize: font.body, fontWeight: font.weightMedium, color: text.default },
  caption: { fontSize: font.caption, color: text.muted },
  addRow: { display: "flex", marginTop: space.sm },
});

export type TypeEditorMode = "new" | "edit" | "view";

export interface TypeEditorProps {
  slug: string;
  mode: TypeEditorMode;
  initial: TypeDraft;
  /** new は [] */
  original: readonly FieldDefinition[];
  /** h1(new は createTitle) */
  typeName: string;
  /** API 名の重複と参照の候補 */
  existingTypes: readonly ContentTypeSummary[];
  records: readonly SyncRecord[] | null;
  /** ルートが PUT・invalidate・トースト・遷移を行う */
  onSubmit: (draft: TypeDraft) => Promise<void>;
  onCancel: () => void;
  isPending: boolean;
}

// 案 E 5.2(E4・E24・E25・E29): 型の作成・編集・読み取り専用
export function TypeEditor({
  slug,
  mode,
  initial,
  original,
  typeName,
  existingTypes,
  records,
  onSubmit,
  onCancel,
  isPending,
}: TypeEditorProps) {
  const labels = CONTENT_TYPE_LABELS;
  const editor = labels.editor;
  const isNewType = mode === "new";
  const isReadOnly = mode === "view";
  const [draft, setDraft] = useState<TypeDraft>(initial);
  const [keyTouched, setKeyTouched] = useState(false);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ label: string; key: string } | null>(null);
  const [nameTouched, setNameTouched] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const panelReturnRef = useRef<HTMLElement | null>(null);
  const addButtonRef = useRef<HTMLButtonElement | null>(null);

  const titleKey = effectiveTitleField(draft);
  const editingDraft =
    editingKey === null ? null : (draft.fields.find((field) => field.key === editingKey) ?? null);
  const fieldRefs = draft.fields.map((field) => ({
    key: field.key,
    label: field.label || field.key,
  }));

  const keyError = isNewType
    ? validateTypeKey(
        draft.key,
        existingTypes.map((type) => ({ key: type.key, name: type.name })),
      )
    : null;
  const keyMessage =
    isNewType && draft.key !== "" && keyError !== null
      ? keyErrorMessage(keyError, draft.key)
      : undefined;
  const descriptionTooLong = draft.description.trim().length > CONTENT_TYPE_DESCRIPTION_MAX_LENGTH;

  const isPanelOpen = editingKey !== null;
  const isValid =
    draft.name.trim() !== "" &&
    keyError === null &&
    draft.fields.length >= 1 &&
    draft.fields.every((field) => fieldDraftErrors(field).length === 0) &&
    !descriptionTooLong &&
    !isPanelOpen;
  const canSubmit = isValid && (isNewType || isTypeDraftDirty(draft, initial)) && !isPending;

  // 閲覧は編集できないので止めない。新規は何か入力したら、編集は保存済みと違えば未保存(E26)
  const dirty = isReadOnly
    ? false
    : isNewType
      ? !isTypeDraftEmpty(draft)
      : isTypeDraftDirty(draft, initial);
  const blocker = useLeaveGuard(dirty);

  const patch = (change: Partial<TypeDraft>) => setDraft((current) => ({ ...current, ...change }));

  const nameMissing = draft.name.trim() === "";
  const showNameError = nameMissing && (nameTouched || submitAttempted);

  const onNameChange = (name: string) => {
    setNameTouched(true);
    setDraft((current) => ({
      ...current,
      name,
      key: isNewType && !keyTouched ? autoFill(current.name, current.key, name) : current.key,
    }));
  };

  const closePanel = () => setEditingKey(null);

  const applyField = (applied: FieldDraft, options: { isTitle: boolean }) => {
    const oldKey = editingKey;
    setDraft((current) => {
      const renamed = oldKey !== null && oldKey !== applied.key;
      let titleField = current.titleField;
      if (options.isTitle) {
        // 暗黙のタイトル(指定無し・最初のテキスト)は適用しても明示値に変えない
        const isImplicit =
          current.titleField === null && effectiveTitleField(current) === applied.key;
        titleField = isImplicit ? null : applied.key;
      } else if (titleField === oldKey) {
        titleField = null;
      }
      return {
        ...current,
        fields: current.fields.map((field) => (field.key === oldKey ? applied : field)),
        titleField,
        listColumns: renamed
          ? current.listColumns.map((key) => (key === oldKey ? applied.key : key))
          : current.listColumns,
      };
    });
    closePanel();
  };

  const removeField = (key: string) => {
    setDraft((current) => ({
      ...current,
      fields: current.fields.filter((field) => field.key !== key),
      titleField: current.titleField === key ? null : current.titleField,
      listColumns: current.listColumns.filter((column) => column !== key),
    }));
    setDeleteTarget(null);
    // 消した行にはフォーカスを戻せないので「フィールドを追加」へ戻す
    panelReturnRef.current = addButtonRef.current;
    closePanel();
  };

  const onPanelDelete = () => {
    if (editingDraft === null) return;
    if (editingDraft.isNew) {
      removeField(editingDraft.key);
    } else {
      setDeleteTarget({ label: editingDraft.label || editingDraft.key, key: editingDraft.key });
    }
  };

  const onReorder = (orderedKeys: string[]) =>
    setDraft((current) => ({
      ...current,
      fields: orderedKeys.flatMap((key) => current.fields.filter((field) => field.key === key)),
    }));

  const addButton = isReadOnly ? undefined : (
    <Button ref={addButtonRef} variant="secondary" icon={Plus} onPress={() => setAddOpen(true)}>
      {editor.addField}
    </Button>
  );

  return (
    <>
      <TenantPageHeader
        title={typeName}
        breadcrumbs={[
          homeCrumb(slug),
          settingsCrumb(slug),
          settingsContentTypesCrumb(slug),
          currentCrumb(isNewType ? labels.createCrumb : typeName),
        ]}
        meta={isReadOnly ? editor.viewMeta : undefined}
        secondaryActions={
          isReadOnly ? undefined : (
            <Button variant="secondary" onPress={onCancel}>
              {editor.cancel}
            </Button>
          )
        }
        primaryAction={
          isReadOnly ? undefined : (
            <Button
              variant="primary"
              isDisabled={!canSubmit}
              disabledReason={isPanelOpen ? editor.panelOpenReason : undefined}
              onPress={() => {
                setSubmitAttempted(true);
                void onSubmit(draft);
              }}
            >
              {isNewType ? editor.create : editor.save}
            </Button>
          )
        }
      />
      <PageBody>
        <div {...stylex.props(styles.body, isPanelOpen && styles.panelOpen)}>
          <div {...stylex.props(styles.grid)}>
            <TextField
              label={editor.name}
              description={editor.nameHelp}
              value={draft.name}
              onChange={onNameChange}
              isRequired={!isReadOnly}
              isReadOnly={isReadOnly}
              autoFocus={isNewType}
              isInvalid={showNameError}
              errorMessage={showNameError ? editor.nameRequired : undefined}
            />
            <TextField
              label={editor.key}
              isMonospace
              value={draft.key}
              onChange={(key) => {
                setKeyTouched(true);
                patch({ key });
              }}
              isRequired={isNewType}
              isDisabled={!isNewType}
              placeholder={isNewType ? editor.keyPlaceholder : undefined}
              description={isNewType ? editor.keyHelpNew : editor.keyHelpEdit}
              isInvalid={keyMessage !== undefined}
              errorMessage={keyMessage}
            />
          </div>
          <TextField
            label={editor.descriptionLabel}
            description={editor.descriptionHelp}
            placeholder={editor.descriptionPlaceholder}
            value={draft.description}
            onChange={(description) => patch({ description })}
            isReadOnly={isReadOnly}
            isInvalid={descriptionTooLong}
            errorMessage={descriptionTooLong ? editor.descriptionTooLong : undefined}
          />
          <section>
            <div {...stylex.props(styles.fieldsHeading)}>
              <div {...stylex.props(styles.fieldsTitle)}>
                <span {...stylex.props(styles.title)}>{editor.fields}</span>
                <span {...stylex.props(styles.caption)}>{draft.fields.length}</span>
              </div>
              <span {...stylex.props(styles.caption)}>{editor.fieldsHelp}</span>
            </div>
            {draft.fields.length === 0 ? (
              <EmptyState
                size="compact"
                icon={LayoutGrid}
                title={editor.emptyTitle}
                description={editor.emptyDescription}
                action={addButton}
              />
            ) : (
              <>
                <FieldList
                  drafts={draft.fields}
                  original={original}
                  records={records}
                  titleKey={titleKey}
                  editingKey={editingKey}
                  isReadOnly={isReadOnly}
                  onEdit={(key, trigger) => {
                    panelReturnRef.current = trigger;
                    setEditingKey(key);
                  }}
                  onReorder={onReorder}
                />
                {addButton === undefined ? null : (
                  <div {...stylex.props(styles.addRow)}>{addButton}</div>
                )}
              </>
            )}
          </section>
          <ListColumnsPicker
            fields={fieldRefs}
            value={draft.listColumns}
            onChange={(listColumns) => patch({ listColumns })}
            isReadOnly={isReadOnly}
          />
        </div>
      </PageBody>
      <FieldPanel
        draft={editingDraft}
        others={fieldRefs.filter((field) => field.key !== editingKey)}
        typeOptions={referenceCandidates(existingTypes, isNewType ? null : draft.key)}
        isTitle={editingKey !== null && titleKey === editingKey}
        isTitleImplicit={
          editingKey !== null &&
          draft.titleField === null &&
          effectiveTitleField(draft) === editingKey
        }
        isReadOnly={isReadOnly}
        returnFocusTo={panelReturnRef}
        onApply={applyField}
        onCancel={closePanel}
        onDelete={onPanelDelete}
      />
      <AddFieldDialog
        isOpen={addOpen}
        onOpenChange={setAddOpen}
        existing={fieldRefs}
        hasSlug={hasSlugField(draft.fields)}
        onAdd={({ kind, key, label }) => {
          setAddOpen(false);
          panelReturnRef.current = addButtonRef.current;
          const created = emptyFieldDraft(kind, key, label);
          setDraft((current) => ({ ...current, fields: [...current.fields, created] }));
          setEditingKey(created.key);
        }}
      />
      <DeleteFieldDialog
        target={deleteTarget}
        onConfirm={() => {
          if (deleteTarget !== null) removeField(deleteTarget.key);
        }}
        onCancel={() => setDeleteTarget(null)}
      />
      <ModalDialog
        title={DIALOGS.leave.title}
        isOpen={blocker.status === "blocked"}
        onOpenChange={(open) => {
          if (!open) blocker.reset?.();
        }}
        role="alertdialog"
        isDismissable={false}
        showCloseButton={false}
        footer={
          <>
            <Button variant="dangerLink" onPress={() => blocker.proceed?.()}>
              {DIALOGS.leave.discard}
            </Button>
            <Button autoFocus onPress={() => blocker.reset?.()}>
              {DIALOGS.leave.stay}
            </Button>
          </>
        }
      >
        <p>{DIALOGS.leaveType.body}</p>
      </ModalDialog>
    </>
  );
}
