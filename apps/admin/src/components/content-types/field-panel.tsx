import * as stylex from "@stylexjs/stylex";
import { Plus, X } from "lucide-react";
import { useEffect, useState, type ReactNode, type RefObject } from "react";
import {
  Button,
  Checkbox,
  CheckboxGroup,
  IconButton,
  SegmentedControl,
  Select,
  SidePanel,
  TextArea,
  TextField,
} from "@plyrs/ui";
import { border, font, space, stroke, text } from "@plyrs/ui/semantic.stylex";
import { FIELD_DESCRIPTION_MAX_LENGTH, FIELD_LABEL_MAX_LENGTH } from "@plyrs/metamodel";
import {
  autoFill,
  availableKinds,
  changeKind,
  keyErrorMessage,
  validateFieldKey,
  type FieldDraft,
  type FieldKind,
} from "../../lib/content-type-form";
import { ADD_FIELD_LABELS, FIELD_KIND_LABELS, FIELD_PANEL_LABELS, TERMS } from "../../lib/labels";

const NARROW = "@media (max-width: 959px)";
const P = FIELD_PANEL_LABELS;
const SLUG_KEY = "slug";

const styles = stylex.create({
  section: { display: "flex", flexDirection: "column", gap: space.md },
  divider: {
    margin: 0,
    borderWidth: 0,
    borderTopWidth: stroke.default,
    borderTopStyle: "solid",
    borderTopColor: border.default,
  },
  setting: { display: "flex", flexDirection: "column", gap: space.xxs },
  help: {
    margin: 0,
    paddingInlineStart: space.xl,
    fontSize: font.caption,
    color: text.muted,
  },
  heading: { margin: 0, fontSize: font.label, fontWeight: font.weightBold, color: text.default },
  optionRow: {
    display: "grid",
    gridTemplateColumns: { default: "1fr 1fr auto", [NARROW]: "1fr auto" },
    gap: space.sm,
    alignItems: "start",
  },
  optionList: { display: "flex", flexDirection: "column", gap: space.sm },
  footer: { display: "flex", alignItems: "center", gap: space.sm },
  footerSpacer: { marginInlineStart: "auto", display: "flex", gap: space.sm },
});

export interface FieldPanelProps {
  /** null = 閉じる */
  draft: FieldDraft | null;
  /** 自分以外(重複の検証・slug の有無) */
  others: readonly { key: string; label: string }[];
  /** 参照できる型の候補(E22) */
  typeOptions: readonly { key: string; name: string }[];
  /** 開いた時点で titleField がこのフィールドか */
  isTitle: boolean;
  /** E9 */
  isReadOnly: boolean;
  returnFocusTo: RefObject<HTMLElement | null>;
  onApply: (draft: FieldDraft, options: { isTitle: boolean }) => void;
  onCancel: () => void;
  /** 確認は呼び出し側 */
  onDelete: () => void;
}

function Setting({ help, children }: { help?: string; children: ReactNode }) {
  return (
    <div {...stylex.props(styles.setting)}>
      {children}
      {help !== undefined && <p {...stylex.props(styles.help)}>{help}</p>}
    </div>
  );
}

function maxLengthError(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed === "") return false;
  const n = Number(trimmed);
  return !Number.isInteger(n) || n <= 0;
}

function optionErrors(options: FieldDraft["options"]): (string | null)[] {
  const seen = new Set<string>();
  return options.map((option) => {
    if (option.value === "") return P.optionValueEmpty;
    if (seen.has(option.value)) return P.optionValueDuplicate(option.value);
    seen.add(option.value);
    return null;
  });
}

// フィールドの詳細設定(E4 章、E13・E16・E19・E22・E34・E35)
export function FieldPanel({
  draft,
  others,
  typeOptions,
  isTitle,
  isReadOnly,
  returnFocusTo,
  onApply,
  onCancel,
  onDelete,
}: FieldPanelProps) {
  const [local, setLocal] = useState<FieldDraft | null>(draft);
  const [titleOn, setTitleOn] = useState(isTitle);
  const [submitted, setSubmitted] = useState(false);

  // 開く対象が変わるたびに複製と isTitle を取り直す
  useEffect(() => {
    setLocal(draft);
    setTitleOn(isTitle);
    setSubmitted(false);
  }, [draft, isTitle]);

  if (draft === null || local === null) return null;

  const patch = (change: Partial<FieldDraft>) => setLocal({ ...local, ...change });
  const kind = local.kind;
  const label = local.label.trim();
  const description = local.description.trim();
  const hasOtherSlug = others.some((other) => other.key === SLUG_KEY);
  const keyError = local.isNew ? validateFieldKey(local.key, others) : null;
  const showKeyError = submitted || local.label !== "" || local.key !== "";
  const labelError =
    label === ""
      ? ADD_FIELD_LABELS.labelRequired
      : label.length > FIELD_LABEL_MAX_LENGTH
        ? ADD_FIELD_LABELS.labelTooLong(FIELD_LABEL_MAX_LENGTH)
        : null;
  const descriptionError =
    description.length > FIELD_DESCRIPTION_MAX_LENGTH
      ? P.descriptionTooLong(FIELD_DESCRIPTION_MAX_LENGTH)
      : null;
  const hasMaxLength = kind === "text" || kind === "slug";
  const maxLengthInvalid = hasMaxLength && maxLengthError(local.maxLength);
  const optionError = kind === "select" ? optionErrors(local.options) : [];
  const optionsEmpty = kind === "select" && local.options.length === 0;
  const typesMissing = kind === "reference" && local.allowedTypes.length === 0;

  const isValid =
    labelError === null &&
    descriptionError === null &&
    keyError === null &&
    !maxLengthInvalid &&
    !optionsEmpty &&
    optionError.every((error) => error === null) &&
    !typesMissing;

  const apply = () => {
    setSubmitted(true);
    if (!isValid) return;
    onApply({ ...local, label, description }, { isTitle: titleOn && kind === "text" });
  };

  const onLabelChange = (next: string) => {
    if (local.isNew && kind !== "slug") {
      setLocal({ ...local, label: next, key: autoFill(local.label, local.key, next) });
    } else {
      patch({ label: next });
    }
  };

  const onKindChange = (value: string) => {
    const next = availableKinds(local, hasOtherSlug).find((item) => item === value);
    if (next !== undefined && next !== kind) setLocal(changeKind(local, next));
  };

  const setOption = (index: number, change: Partial<FieldDraft["options"][number]>) =>
    patch({
      options: local.options.map((option, i) => (i === index ? { ...option, ...change } : option)),
    });
  const onOptionLabelChange = (index: number, next: string) => {
    const current = local.options[index];
    if (current === undefined) return;
    setOption(index, {
      label: next,
      value: autoFill(current.label, current.value, next),
    });
  };

  const indexedCheckbox = (
    <Setting help={P.indexedHelp}>
      <Checkbox
        isSelected={local.indexed}
        onChange={(indexed) => patch({ indexed })}
        isReadOnly={isReadOnly}
      >
        {P.indexed}
      </Checkbox>
    </Setting>
  );
  const uniqueCheckbox = (
    <Setting help={P.uniqueHelp}>
      <Checkbox
        isSelected={local.unique}
        onChange={(unique) => patch({ unique })}
        isReadOnly={isReadOnly}
      >
        {P.unique}
      </Checkbox>
    </Setting>
  );
  const maxLengthField = (
    <TextField
      label={P.maxLength}
      value={local.maxLength}
      onChange={(maxLength) => patch({ maxLength })}
      inputMode="numeric"
      isMonospace
      isReadOnly={isReadOnly}
      {...(maxLengthInvalid ? { isInvalid: true, errorMessage: P.maxLengthInvalid } : {})}
    />
  );
  const cardinality = (
    <SegmentedControl
      label={P.cardinality}
      items={[
        { value: "one", label: P.one },
        { value: "many", label: P.many },
      ]}
      value={local.cardinality}
      onChange={(value) => patch({ cardinality: value === "many" ? "many" : "one" })}
      isDisabled={isReadOnly}
    />
  );

  const kindItems = availableKinds(local, hasOtherSlug).map((item: FieldKind) => ({
    value: item,
    label: FIELD_KIND_LABELS[item].name,
  }));

  const footer = isReadOnly ? (
    <div {...stylex.props(styles.footer)}>
      <div {...stylex.props(styles.footerSpacer)}>
        <Button variant="secondary" onPress={onCancel}>
          {P.close}
        </Button>
      </div>
    </div>
  ) : (
    <div {...stylex.props(styles.footer)}>
      <Button variant="dangerLink" onPress={onDelete}>
        {P.deleteField}
      </Button>
      <div {...stylex.props(styles.footerSpacer)}>
        <Button variant="secondary" onPress={onCancel}>
          {P.cancel}
        </Button>
        <Button variant="primary" onPress={apply}>
          {P.apply}
        </Button>
      </div>
    </div>
  );

  return (
    <SidePanel
      isOpen
      onClose={onCancel}
      title={local.label || local.key}
      subtitle={P.subtitle(FIELD_KIND_LABELS[kind].name)}
      returnFocusTo={returnFocusTo}
      footer={footer}
    >
      <div {...stylex.props(styles.section)}>
        <Select
          label={P.kind}
          items={kindItems}
          selectedValue={kind}
          onChange={onKindChange}
          isReadOnly={isReadOnly}
        />
        <TextField
          label={P.label}
          description={P.labelHelp}
          value={local.label}
          onChange={onLabelChange}
          isRequired
          isReadOnly={isReadOnly}
          {...(submitted && labelError !== null
            ? { isInvalid: true, errorMessage: labelError }
            : label.length > FIELD_LABEL_MAX_LENGTH && labelError !== null
              ? { isInvalid: true, errorMessage: labelError }
              : {})}
        />
        <TextField
          label={TERMS.fieldKey}
          description={local.isNew ? P.keyHelp : P.keyHelpSaved}
          value={local.key}
          onChange={(key) => patch({ key })}
          isMonospace
          isDisabled={!local.isNew || kind === "slug"}
          isReadOnly={isReadOnly}
          {...(local.isNew && showKeyError && keyError !== null
            ? { isInvalid: true, errorMessage: keyErrorMessage(keyError, local.key) }
            : {})}
        />
        <TextArea
          label={P.description}
          value={local.description}
          onChange={(value) => patch({ description: value })}
          rows={2}
          isReadOnly={isReadOnly}
          {...(descriptionError !== null
            ? { isInvalid: true, errorMessage: descriptionError }
            : {})}
        />
        <hr {...stylex.props(styles.divider)} />
        <Checkbox
          isSelected={local.required}
          onChange={(required) => patch({ required })}
          isReadOnly={isReadOnly}
        >
          {P.required}
        </Checkbox>

        {kind === "text" && (
          <>
            <Setting help={P.titleFieldHelp}>
              <Checkbox isSelected={titleOn} onChange={setTitleOn} isReadOnly={isReadOnly}>
                {P.titleField}
              </Checkbox>
            </Setting>
            {maxLengthField}
            {indexedCheckbox}
            {uniqueCheckbox}
          </>
        )}
        {kind === "slug" && (
          <>
            <Setting help={P.uniqueSlugHelp}>
              <Checkbox isSelected isDisabled onChange={() => {}}>
                {P.unique}
              </Checkbox>
            </Setting>
            {indexedCheckbox}
            {maxLengthField}
          </>
        )}
        {kind === "number" && (
          <>
            <Checkbox
              isSelected={local.integer}
              onChange={(integer) => patch({ integer })}
              isReadOnly={isReadOnly}
            >
              {P.integer}
            </Checkbox>
            {indexedCheckbox}
            {uniqueCheckbox}
          </>
        )}
        {kind === "boolean" && indexedCheckbox}
        {kind === "datetime" && (
          <>
            {indexedCheckbox}
            {uniqueCheckbox}
          </>
        )}
        {kind === "select" && (
          <>
            <h3 {...stylex.props(styles.heading)}>{P.options}</h3>
            <div {...stylex.props(styles.optionList)}>
              {local.options.map((option, index) => {
                const error = submitted ? (optionError[index] ?? null) : null;
                return (
                  <div key={index} {...stylex.props(styles.optionRow)}>
                    <TextField
                      label={`${P.optionLabel} ${index + 1}`}
                      value={option.label}
                      onChange={(next) => onOptionLabelChange(index, next)}
                      isReadOnly={isReadOnly}
                    />
                    <TextField
                      label={`${P.optionValue} ${index + 1}`}
                      value={option.value}
                      onChange={(value) => setOption(index, { value })}
                      isMonospace
                      isReadOnly={isReadOnly}
                      {...(error === null ? {} : { isInvalid: true, errorMessage: error })}
                    />
                    {!isReadOnly && (
                      <IconButton
                        icon={X}
                        label={P.removeOption(option.label)}
                        size="sm"
                        onPress={() =>
                          patch({ options: local.options.filter((_, i) => i !== index) })
                        }
                      />
                    )}
                  </div>
                );
              })}
            </div>
            {submitted && optionsEmpty && (
              <p role="alert" {...stylex.props(styles.help)}>
                {P.optionsRequired}
              </p>
            )}
            {!isReadOnly && (
              <Button
                variant="secondary"
                icon={Plus}
                onPress={() => patch({ options: [...local.options, { value: "", label: "" }] })}
              >
                {P.addOption}
              </Button>
            )}
            <Checkbox
              isSelected={local.multiple}
              onChange={(multiple) => patch({ multiple })}
              isReadOnly={isReadOnly}
            >
              {P.multiple}
            </Checkbox>
            {indexedCheckbox}
          </>
        )}
        {kind === "asset" && cardinality}
        {kind === "reference" && (
          <>
            <CheckboxGroup
              label={P.allowedTypes}
              options={typeOptions.map((type) => ({ value: type.key, label: type.name }))}
              value={local.allowedTypes}
              onChange={(allowedTypes) => patch({ allowedTypes })}
              isReadOnly={isReadOnly}
              {...(submitted && typesMissing ? { errorMessage: P.allowedTypesRequired } : {})}
            />
            {cardinality}
            <Setting help={P.orderedHelp}>
              <Checkbox
                isSelected={local.ordered}
                onChange={(ordered) => patch({ ordered })}
                isReadOnly={isReadOnly}
              >
                {P.ordered}
              </Checkbox>
            </Setting>
          </>
        )}
      </div>
    </SidePanel>
  );
}
