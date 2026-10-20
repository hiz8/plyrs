import * as stylex from "@stylexjs/stylex";
import { TriangleAlert } from "lucide-react";
import { ConfirmDialog } from "@plyrs/ui";
import { font, space, text } from "@plyrs/ui/semantic.stylex";
import { FIELD_PANEL_LABELS } from "../../lib/labels";
import { DialogNote } from "../settings/dialog-note";

const styles = stylex.create({
  body: { display: "flex", flexDirection: "column", gap: space.sm },
  text: { margin: 0, fontSize: font.body, color: text.default },
});

// E17: フィールドの削除確認。値はデータ上に残る(遅延適合)ので、公開 API への影響を注記する
export function DeleteFieldDialog({
  target,
  onConfirm,
  onCancel,
}: {
  target: { label: string; key: string } | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const labels = FIELD_PANEL_LABELS.deleteDialog;
  return (
    <ConfirmDialog
      // target が null の間(閉じている間)は title を空にしておく
      title={target === null ? "" : labels.title(target.label)}
      isOpen={target !== null}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
      tone="danger"
      confirmLabel={labels.confirm}
      onConfirm={onConfirm}
    >
      <div {...stylex.props(styles.body)}>
        <p {...stylex.props(styles.text)}>{target === null ? "" : labels.body(target.key)}</p>
        <DialogNote tone="warning" icon={TriangleAlert}>
          {labels.publicNote}
        </DialogNote>
      </div>
    </ConfirmDialog>
  );
}
