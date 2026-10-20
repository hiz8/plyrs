import * as stylex from "@stylexjs/stylex";
import {
  AtSign,
  Braces,
  Calendar,
  ChevronLeft,
  Hash,
  Image,
  Link,
  List,
  Pilcrow,
  SquareCheck,
  Type,
  type LucideIcon,
} from "lucide-react";
import { useId, useState } from "react";
import { Button, ICON_SIZE, ModalDialog, TextField } from "@plyrs/ui";
import { border, font, space, stroke, text } from "@plyrs/ui/semantic.stylex";
import { FIELD_LABEL_MAX_LENGTH } from "@plyrs/metamodel";
import {
  FIELD_KINDS,
  autoFill,
  keyErrorMessage,
  validateFieldKey,
  type FieldKind,
  type KindGroup,
} from "../../lib/content-type-form";
import { ADD_FIELD_LABELS, FIELD_KIND_LABELS, TERMS } from "../../lib/labels";

const NARROW = "@media (max-width: 959px)";

const KIND_ICONS: Record<FieldKind, LucideIcon> = {
  text: Type,
  richtext: Pilcrow,
  number: Hash,
  datetime: Calendar,
  boolean: SquareCheck,
  select: List,
  asset: Image,
  reference: Link,
  slug: AtSign,
  json: Braces,
};

const SLUG_KEY = "slug";
const GROUPS: readonly KindGroup[] = ["basic", "link"];

const styles = stylex.create({
  body: { display: "flex", flexDirection: "column", gap: space.md },
  steps: { margin: 0, fontSize: font.caption, color: text.muted },
  stepCurrent: { fontWeight: font.weightBold, color: text.default },
  group: { display: "flex", flexDirection: "column", gap: space.sm },
  groupHeading: {
    margin: 0,
    fontSize: font.caption,
    fontWeight: font.weightBold,
    color: text.muted,
  },
  grid: {
    display: "grid",
    gridTemplateColumns: { default: "repeat(3, 1fr)", [NARROW]: "1fr" },
    gap: space.sm,
  },
  advanced: {
    display: "flex",
    flexDirection: "column",
    gap: space.sm,
    paddingBlockStart: space.md,
    borderTopWidth: stroke.default,
    borderTopStyle: "solid",
    borderTopColor: border.default,
    opacity: 0.7,
  },
  cardContent: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: space.xs,
  },
  cardContentRow: { flexDirection: "row", alignItems: "center", gap: space.sm },
  cardName: { fontSize: font.body, fontWeight: font.weightMedium, color: text.default },
  cardDescription: { fontSize: font.caption, fontWeight: "normal", color: text.muted },
  form: { display: "flex", flexDirection: "column", gap: space.inset },
  backWrap: { marginInlineEnd: "auto" },
});

export interface AddFieldDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  /** 重複の検証 */
  existing: readonly { key: string; label: string }[];
  /** URL スラッグのカードを無効にする */
  hasSlug: boolean;
  /** 呼び出し側が閉じる */
  onAdd: (input: { kind: FieldKind; key: string; label: string }) => void;
}

function KindCard({
  kind,
  isSelected,
  isRow,
  disabledReason,
  onSelect,
}: {
  kind: FieldKind;
  isSelected: boolean;
  isRow?: boolean;
  disabledReason?: string;
  onSelect: () => void;
}) {
  const Icon = KIND_ICONS[kind];
  const labels = FIELD_KIND_LABELS[kind];
  return (
    <Button
      variant="card"
      aria-pressed={isSelected}
      onPress={onSelect}
      {...(disabledReason === undefined ? {} : { disabledReason })}
    >
      <span {...stylex.props(styles.cardContent, isRow === true && styles.cardContentRow)}>
        <Icon size={ICON_SIZE.inline} aria-hidden="true" />
        <span {...stylex.props(styles.cardName)}>{labels.name}</span>
        <span {...stylex.props(styles.cardDescription)}>{labels.description}</span>
      </span>
    </Button>
  );
}

function AddFieldForm({
  onOpenChange,
  existing,
  hasSlug,
  onAdd,
}: Omit<AddFieldDialogProps, "isOpen">) {
  const formId = useId();
  const [step, setStep] = useState<1 | 2>(1);
  const [kind, setKind] = useState<FieldKind | null>(null);
  // 2 段目の入力の持ち主の種類。種類が変わったときだけ入力を初期化する
  const [initializedFor, setInitializedFor] = useState<FieldKind | null>(null);
  const [label, setLabel] = useState("");
  const [key, setKey] = useState("");

  const isSlug = kind === "slug";
  const keyError = validateFieldKey(key, existing);
  const showKeyError = label !== "" || key !== "";
  const trimmed = label.trim();
  const labelTooLong = trimmed.length > FIELD_LABEL_MAX_LENGTH;
  const canAdd = kind !== null && trimmed !== "" && !labelTooLong && keyError === null;

  const goNext = () => {
    if (kind === null) return;
    if (initializedFor !== kind) {
      setLabel(kind === "slug" ? FIELD_KIND_LABELS.slug.name : "");
      setKey(kind === "slug" ? SLUG_KEY : "");
      setInitializedFor(kind);
    }
    setStep(2);
  };
  const submit = () => {
    if (kind !== null && canAdd) onAdd({ kind, key, label: trimmed });
  };
  const onLabelChange = (next: string) => {
    if (!isSlug) setKey(autoFill(label, key, next));
    setLabel(next);
  };

  const cancelButton = (
    <Button variant="secondary" onPress={() => onOpenChange(false)}>
      {ADD_FIELD_LABELS.cancel}
    </Button>
  );
  const footer =
    step === 1 ? (
      <>
        {cancelButton}
        <Button variant="primary" isDisabled={kind === null} onPress={goNext}>
          {ADD_FIELD_LABELS.next}
        </Button>
      </>
    ) : (
      <>
        <div {...stylex.props(styles.backWrap)}>
          <Button variant="link" icon={ChevronLeft} onPress={() => setStep(1)}>
            {ADD_FIELD_LABELS.back}
          </Button>
        </div>
        {cancelButton}
        <Button variant="primary" type="submit" form={formId} isDisabled={!canAdd}>
          {ADD_FIELD_LABELS.add}
        </Button>
      </>
    );

  return (
    <ModalDialog
      title={ADD_FIELD_LABELS.title}
      isOpen
      onOpenChange={onOpenChange}
      size="lg"
      footer={footer}
    >
      <div {...stylex.props(styles.body)}>
        <p {...stylex.props(styles.steps)}>
          <span {...stylex.props(step === 1 && styles.stepCurrent)}>
            {step === 2 && kind !== null
              ? ADD_FIELD_LABELS.step1Done(FIELD_KIND_LABELS[kind].name)
              : ADD_FIELD_LABELS.step1}
          </span>
          {ADD_FIELD_LABELS.stepArrow}
          <span {...stylex.props(step === 2 && styles.stepCurrent)}>{ADD_FIELD_LABELS.step2}</span>
        </p>
        {step === 1 ? (
          <>
            {GROUPS.map((group) => (
              <div key={group} {...stylex.props(styles.group)}>
                <h3 {...stylex.props(styles.groupHeading)}>{ADD_FIELD_LABELS.groups[group]}</h3>
                <div {...stylex.props(styles.grid)}>
                  {FIELD_KINDS.filter((item) => item.group === group).map((item) => (
                    <KindCard
                      key={item.kind}
                      kind={item.kind}
                      isSelected={kind === item.kind}
                      onSelect={() => setKind(item.kind)}
                      {...(item.kind === "slug" && hasSlug
                        ? { disabledReason: ADD_FIELD_LABELS.slugTaken }
                        : {})}
                    />
                  ))}
                </div>
              </div>
            ))}
            <div {...stylex.props(styles.advanced)}>
              <h3 {...stylex.props(styles.groupHeading)}>{ADD_FIELD_LABELS.groups.advanced}</h3>
              {FIELD_KINDS.filter((item) => item.group === "advanced").map((item) => (
                <KindCard
                  key={item.kind}
                  kind={item.kind}
                  isRow
                  isSelected={kind === item.kind}
                  onSelect={() => setKind(item.kind)}
                />
              ))}
            </div>
          </>
        ) : (
          <form
            id={formId}
            {...stylex.props(styles.form)}
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            <TextField
              label={ADD_FIELD_LABELS.label}
              description={ADD_FIELD_LABELS.labelHelp}
              value={label}
              onChange={onLabelChange}
              isRequired
              autoFocus
              {...(labelTooLong
                ? {
                    isInvalid: true,
                    errorMessage: ADD_FIELD_LABELS.labelTooLong(FIELD_LABEL_MAX_LENGTH),
                  }
                : {})}
            />
            <TextField
              label={TERMS.fieldKey}
              description={ADD_FIELD_LABELS.keyHelp}
              placeholder={ADD_FIELD_LABELS.keyPlaceholder}
              value={key}
              onChange={setKey}
              isMonospace
              isRequired
              isDisabled={isSlug}
              {...(showKeyError && keyError !== null
                ? { isInvalid: true, errorMessage: keyErrorMessage(keyError, key) }
                : {})}
            />
          </form>
        )}
      </div>
    </ModalDialog>
  );
}

// フィールドの追加(E13・E14・E15・E33)。閉じると描き直すので、開くたびに 1 段目・選択なし・入力空に戻る
export function AddFieldDialog({ isOpen, ...rest }: AddFieldDialogProps) {
  if (!isOpen) return null;
  return <AddFieldForm {...rest} />;
}
