import * as stylex from "@stylexjs/stylex";
import { CircleAlert, Copy } from "lucide-react";
import { useState } from "react";
import { Button, ICON_SIZE, ModalDialog, TextField, toaster } from "@plyrs/ui";
import { border, font, radius, space, status, stroke, text } from "@plyrs/ui/semantic.stylex";
import { DIALOGS, MEMBER_LABELS, ROLE_DESCRIPTIONS, SETTINGS_LABELS } from "../../lib/labels";
import type { Role } from "../../lib/permissions";
import { RoleSelect } from "./role-select";

const styles = stylex.create({
  form: { display: "flex", flexDirection: "column", gap: space.inset },
  alertBox: {
    display: "flex",
    flexDirection: "column",
    gap: space.sm,
    padding: space.inset,
    backgroundColor: status.dangerSurface,
    borderRadius: radius.container,
    fontSize: font.caption,
    color: text.default,
  },
  alertHead: { display: "flex", alignItems: "flex-start", gap: space.sm },
  alertIcon: { color: status.danger, display: "inline-flex", flexShrink: 0 },
  urlRow: { display: "flex", alignItems: "center", gap: space.sm, minWidth: 0 },
  code: {
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    paddingBlock: space.xs,
    paddingInline: space.sm,
    fontFamily: font.familyMono,
    borderWidth: stroke.default,
    borderStyle: "solid",
    borderColor: border.default,
    borderRadius: radius.item,
  },
  hint: { color: text.muted },
  description: { margin: 0, fontSize: font.caption, color: text.muted },
  failure: { margin: 0, fontSize: font.body, color: status.danger },
});

export type AddMemberFailure =
  | { kind: "unregistered" }
  | { kind: "already_member" }
  | { kind: "other"; message: string }
  | null;

async function copy(value: string): Promise<void> {
  try {
    if (navigator.clipboard === undefined) {
      throw new Error("clipboard unavailable");
    }
    await navigator.clipboard.writeText(value);
    toaster.success(SETTINGS_LABELS.publicApi.copied);
  } catch {
    toaster.error(SETTINGS_LABELS.publicApi.copyFailed);
  }
}

export interface AddMemberDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (email: string, role: Role) => void;
  isPending: boolean;
  failure: AddMemberFailure;
  signupUrl: string;
}

function AddMemberForm({
  onOpenChange,
  onSubmit,
  isPending,
  failure,
  signupUrl,
}: Omit<AddMemberDialogProps, "isOpen">) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("editor");
  const canSubmit = email.trim() !== "";
  const submit = () => {
    if (canSubmit && !isPending) onSubmit(email.trim(), role);
  };
  return (
    <ModalDialog
      title={MEMBER_LABELS.addDialog.title}
      isOpen
      onOpenChange={onOpenChange}
      footer={
        <>
          <Button variant="secondary" onPress={() => onOpenChange(false)}>
            {DIALOGS.cancel}
          </Button>
          <Button variant="primary" isDisabled={!canSubmit || isPending} onPress={submit}>
            {MEMBER_LABELS.addDialog.submit}
          </Button>
        </>
      }
    >
      <form
        {...stylex.props(styles.form)}
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <TextField
          label={MEMBER_LABELS.addDialog.email}
          type="email"
          description={MEMBER_LABELS.addDialog.emailHelp}
          value={email}
          onChange={setEmail}
          isRequired
          autoComplete="off"
          {...(failure?.kind === "already_member"
            ? { isInvalid: true, errorMessage: MEMBER_LABELS.addDialog.alreadyMember }
            : {})}
        />
        {failure?.kind === "unregistered" ? (
          <div role="alert" {...stylex.props(styles.alertBox)}>
            <div {...stylex.props(styles.alertHead)}>
              <span {...stylex.props(styles.alertIcon)}>
                <CircleAlert size={ICON_SIZE.inline} aria-hidden="true" />
              </span>
              <span>{MEMBER_LABELS.addDialog.unregistered}</span>
            </div>
            <div {...stylex.props(styles.urlRow)}>
              <code {...stylex.props(styles.code)}>{signupUrl}</code>
              <Button
                variant="secondary"
                size="sm"
                icon={Copy}
                onPress={() => void copy(signupUrl)}
              >
                {MEMBER_LABELS.addDialog.copyUrl}
              </Button>
            </div>
            <span {...stylex.props(styles.hint)}>{MEMBER_LABELS.addDialog.unregisteredHint}</span>
          </div>
        ) : null}
        <RoleSelect label={MEMBER_LABELS.addDialog.role} value={role} onChange={setRole} />
        <p {...stylex.props(styles.description)}>{ROLE_DESCRIPTIONS[role]}</p>
        {failure?.kind === "other" ? (
          <p role="alert" {...stylex.props(styles.failure)}>
            {failure.message}
          </p>
        ) : null}
      </form>
    </ModalDialog>
  );
}

// メンバーの追加(G14)。閉じると描き直すので、開くたびに入力が初期化される
export function AddMemberDialog({ isOpen, ...rest }: AddMemberDialogProps) {
  if (!isOpen) return null;
  return <AddMemberForm {...rest} />;
}
