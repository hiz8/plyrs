import { useState } from "react";
import { ConfirmDialog, TextArea } from "@plyrs/ui";
import { PROPOSAL_LABELS } from "../../lib/labels";
import type { ProposalKind } from "../../lib/api-contracts";

// 16.8(M5c): 採用・却下の確認。採用は自分の名前で書き込むので説明を見せ、却下は理由を添えられる

export interface AcceptDialogProps {
  kind: ProposalKind;
  summary: string;
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  isPending: boolean;
  onConfirm: () => void;
}

export function AcceptProposalDialog({
  kind,
  summary,
  isOpen,
  onOpenChange,
  isPending,
  onConfirm,
}: AcceptDialogProps) {
  return (
    <ConfirmDialog
      title={PROPOSAL_LABELS.acceptDialog.title(kind)}
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      // 公開・削除は公開中の内容に影響する(8 章)
      tone={kind === "update" || kind === "create" ? "primary" : "danger"}
      confirmLabel={PROPOSAL_LABELS.acceptDialog.confirm}
      isPending={isPending}
      onConfirm={onConfirm}
    >
      <p>{PROPOSAL_LABELS.acceptDialog.body(summary)}</p>
    </ConfirmDialog>
  );
}

export interface RejectDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  isPending: boolean;
  onConfirm: (reason: string) => void;
}

const REASON_MAX = 500;

export function RejectProposalDialog({
  isOpen,
  onOpenChange,
  isPending,
  onConfirm,
}: RejectDialogProps) {
  const [reason, setReason] = useState("");
  const tooLong = reason.trim().length > REASON_MAX;
  return (
    <ConfirmDialog
      title={PROPOSAL_LABELS.rejectDialog.title}
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      tone="danger"
      confirmLabel={PROPOSAL_LABELS.rejectDialog.confirm}
      isPending={isPending}
      onConfirm={() => {
        if (!tooLong) onConfirm(reason.trim());
      }}
    >
      <p>{PROPOSAL_LABELS.rejectDialog.body}</p>
      <TextArea
        label={PROPOSAL_LABELS.rejectDialog.reason}
        value={reason}
        onChange={setReason}
        rows={3}
        isInvalid={tooLong}
        errorMessage={tooLong ? PROPOSAL_LABELS.rejectDialog.reasonTooLong : undefined}
      />
    </ConfirmDialog>
  );
}
