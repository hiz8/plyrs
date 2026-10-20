import * as stylex from "@stylexjs/stylex";
import { CircleAlert, Copy } from "lucide-react";
import { useState } from "react";
import { Button, ModalDialog, TextField } from "@plyrs/ui";
import { border, font, radius, space, status, stroke, text } from "@plyrs/ui/semantic.stylex";
import { copyText } from "../../lib/clipboard";
import { DIALOGS, MEMBER_LABELS, ROLE_DESCRIPTIONS } from "../../lib/labels";
import type { Role } from "../../lib/permissions";
import { DialogNote } from "./dialog-note";
import { RoleSelect } from "./role-select";

const styles = stylex.create({
  form: { display: "flex", flexDirection: "column", gap: space.inset },
  alertBody: { display: "flex", flexDirection: "column", gap: space.sm },
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

export interface AddMemberDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (email: string, role: Role) => void;
  isPending: boolean;
  failure: AddMemberFailure;
  /** 入力を直したら、直前の失敗の表示を消す */
  onClearFailure?: () => void;
  signupUrl: string;
}

function AddMemberForm({
  onOpenChange,
  onSubmit,
  isPending,
  failure,
  onClearFailure,
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
          onChange={(value) => {
            setEmail(value);
            if (failure !== null) onClearFailure?.();
          }}
          isRequired
          autoComplete="off"
          {...(failure?.kind === "already_member"
            ? { isInvalid: true, errorMessage: MEMBER_LABELS.addDialog.alreadyMember }
            : {})}
        />
        {failure?.kind === "unregistered" ? (
          <DialogNote tone="danger" icon={CircleAlert} role="alert">
            <div {...stylex.props(styles.alertBody)}>
              <span>{MEMBER_LABELS.addDialog.unregistered}</span>
              <div {...stylex.props(styles.urlRow)}>
                <code {...stylex.props(styles.code)}>{signupUrl}</code>
                <Button
                  variant="secondary"
                  size="sm"
                  icon={Copy}
                  onPress={() => void copyText(signupUrl)}
                >
                  {MEMBER_LABELS.addDialog.copyUrl}
                </Button>
              </div>
              <span {...stylex.props(styles.hint)}>{MEMBER_LABELS.addDialog.unregisteredHint}</span>
            </div>
          </DialogNote>
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
