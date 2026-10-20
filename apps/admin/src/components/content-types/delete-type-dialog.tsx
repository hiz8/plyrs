import * as stylex from "@stylexjs/stylex";
import { TriangleAlert } from "lucide-react";
import { ConfirmDialog } from "@plyrs/ui";
import { font, space, text } from "@plyrs/ui/semantic.stylex";
import { CONTENT_TYPE_LABELS } from "../../lib/labels";
import { DialogNote } from "../settings/dialog-note";

const styles = stylex.create({
  body: { display: "flex", flexDirection: "column", gap: space.sm },
  text: { margin: 0, fontSize: font.body, color: text.default },
});

// E11: コンテンツが 0 件の型の削除確認
export function DeleteTypeDialog({
  target,
  onConfirm,
  onCancel,
  isPending,
}: {
  target: { name: string } | null;
  onConfirm: () => void;
  onCancel: () => void;
  isPending: boolean;
}) {
  const labels = CONTENT_TYPE_LABELS.deleteDialog;
  return (
    <ConfirmDialog
      // target が null の間(閉じている間)は title を空にしておく
      title={target === null ? "" : labels.title(target.name)}
      isOpen={target !== null}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
      tone="danger"
      confirmLabel={labels.confirm}
      onConfirm={onConfirm}
      isPending={isPending}
    >
      <div {...stylex.props(styles.body)}>
        <p {...stylex.props(styles.text)}>{labels.body}</p>
        <DialogNote tone="warning" icon={TriangleAlert}>
          {labels.offline}
        </DialogNote>
      </div>
    </ConfirmDialog>
  );
}
