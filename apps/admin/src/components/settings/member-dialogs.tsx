import * as stylex from "@stylexjs/stylex";
import { Clock, TriangleAlert } from "lucide-react";
import { ConfirmDialog } from "@plyrs/ui";
import { font, space, text } from "@plyrs/ui/semantic.stylex";
import { MEMBER_LABELS, roleLabel } from "../../lib/labels";
import { demoteBody } from "../../lib/members";
import type { Role } from "../../lib/permissions";
import { DialogNote } from "./dialog-note";

const styles = stylex.create({
  body: { display: "flex", flexDirection: "column", gap: space.sm },
  text: { margin: 0, fontSize: font.body, color: text.default },
});

export function DemoteMemberDialog({
  target,
  otherOwners,
  onConfirm,
  onCancel,
  isPending,
}: {
  target: { email: string; to: Role; isSelf: boolean } | null;
  otherOwners: string[];
  onConfirm: () => void;
  onCancel: () => void;
  isPending: boolean;
}) {
  const to = target?.to ?? "viewer";
  return (
    <ConfirmDialog
      // target が null の間(閉じている間)は title を空にしておく
      title={target === null ? "" : MEMBER_LABELS.demote.title(target.email, roleLabel(to))}
      isOpen={target !== null}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
      tone="primary"
      confirmLabel={MEMBER_LABELS.demote.confirm(roleLabel(to))}
      onConfirm={onConfirm}
      isPending={isPending}
    >
      <div {...stylex.props(styles.body)}>
        <p {...stylex.props(styles.text)}>{demoteBody(to)}</p>
        <DialogNote tone="warning" icon={Clock}>
          {MEMBER_LABELS.demote.delay}
        </DialogNote>
        {target?.isSelf === true ? (
          <DialogNote tone="warning" icon={TriangleAlert}>
            {MEMBER_LABELS.lockout(otherOwners.join("、"))}
          </DialogNote>
        ) : null}
      </div>
    </ConfirmDialog>
  );
}

export function RemoveMemberDialog({
  target,
  siteName,
  otherOwners,
  onConfirm,
  onCancel,
  isPending,
}: {
  target: { email: string; isSelf: boolean } | null;
  siteName: string;
  otherOwners: string[];
  onConfirm: () => void;
  onCancel: () => void;
  isPending: boolean;
}) {
  const labels = MEMBER_LABELS.removeDialog;
  const isSelf = target?.isSelf === true;
  const email = target?.email ?? "";
  return (
    <ConfirmDialog
      // target が null の間(閉じている間)は title を空にしておく
      title={target === null ? "" : isSelf ? labels.selfTitle : labels.title(email)}
      isOpen={target !== null}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
      tone="danger"
      confirmLabel={isSelf ? labels.selfConfirm : labels.confirm}
      onConfirm={onConfirm}
      isPending={isPending}
    >
      <div {...stylex.props(styles.body)}>
        <p {...stylex.props(styles.text)}>
          {isSelf ? labels.selfBody(email, siteName) : labels.body}
        </p>
        {isSelf ? (
          <DialogNote tone="warning" icon={TriangleAlert}>
            {MEMBER_LABELS.lockout(otherOwners.join("、"))}
          </DialogNote>
        ) : null}
      </div>
    </ConfirmDialog>
  );
}
