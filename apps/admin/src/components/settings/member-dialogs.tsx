import * as stylex from "@stylexjs/stylex";
import { Banner, ConfirmDialog } from "@plyrs/ui";
import { font, space, text } from "@plyrs/ui/semantic.stylex";
import { MEMBER_LABELS, roleLabel } from "../../lib/labels";
import { demoteBody } from "../../lib/members";
import type { Role } from "../../lib/permissions";

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
        <Banner tone="warning">{MEMBER_LABELS.demote.delay}</Banner>
        {target?.isSelf === true ? (
          <Banner tone="warning">{MEMBER_LABELS.lockout(otherOwners.join("、"))}</Banner>
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
          <Banner tone="warning">{MEMBER_LABELS.lockout(otherOwners.join("、"))}</Banner>
        ) : null}
      </div>
    </ConfirmDialog>
  );
}
