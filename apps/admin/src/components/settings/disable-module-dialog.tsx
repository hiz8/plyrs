import * as stylex from "@stylexjs/stylex";
import { ConfirmDialog } from "@plyrs/ui";
import { font, space, text } from "@plyrs/ui/semantic.stylex";
import type { ModuleSummary } from "../../lib/admin-api";
import { MODULE_LABELS } from "../../lib/labels";
import { formatCounts, type TypeCount } from "../../lib/modules";
import { DialogNote } from "./dialog-note";

const styles = stylex.create({
  body: { display: "flex", flexDirection: "column", gap: space.sm },
  text: { margin: 0, fontSize: font.body, color: text.default },
});

export function DisableModuleDialog({
  target,
  onConfirm,
  onCancel,
  isPending,
}: {
  // counts が null のときは未同期(件数を出せない)
  target: { module: ModuleSummary; counts: TypeCount[] | null } | null;
  onConfirm: () => void;
  onCancel: () => void;
  isPending: boolean;
}) {
  const labels = MODULE_LABELS.disableDialog;
  const counts = target?.counts ?? null;
  return (
    <ConfirmDialog
      // target が null の間(閉じている間)は title を空にしておく
      title={target === null ? "" : labels.title(target.module.name)}
      isOpen={target !== null}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
      tone="primary"
      confirmLabel={MODULE_LABELS.disable}
      onConfirm={onConfirm}
      isPending={isPending}
    >
      {target === null ? null : (
        <div {...stylex.props(styles.body)}>
          <p {...stylex.props(styles.text)}>{labels.body(target.module.name)}</p>
          <DialogNote tone="accent">
            {counts === null || counts.length === 0
              ? labels.keepUnknown
              : labels.keep(formatCounts(counts))}
          </DialogNote>
        </div>
      )}
    </ConfirmDialog>
  );
}
