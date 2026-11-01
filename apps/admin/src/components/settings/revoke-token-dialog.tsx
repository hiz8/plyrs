import * as stylex from "@stylexjs/stylex";
import { ConfirmDialog } from "@plyrs/ui";
import { font, text } from "@plyrs/ui/semantic.stylex";
import type { TokenSummary } from "../../lib/admin-api";
import { TOKEN_LABELS } from "../../lib/labels";

const styles = stylex.create({
  text: { margin: 0, fontSize: font.body, color: text.default },
});

// 失効の確認(M1-4)。失効は戻せない(新しく発行し直す)
export function RevokeTokenDialog({
  target,
  onConfirm,
  onCancel,
  isPending,
}: {
  target: TokenSummary | null;
  onConfirm: () => void;
  onCancel: () => void;
  isPending: boolean;
}) {
  const labels = TOKEN_LABELS.revokeDialog;
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
      <p {...stylex.props(styles.text)}>{labels.body}</p>
    </ConfirmDialog>
  );
}
