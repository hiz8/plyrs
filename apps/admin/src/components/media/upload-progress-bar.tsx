import * as stylex from "@stylexjs/stylex";
import { Button, ProgressBar } from "@plyrs/ui";
import { space } from "@plyrs/ui/semantic.stylex";
import { MEDIA_LABELS } from "../../lib/labels";
import { bulkBarStyles } from "../bulk-bar-styles";

const styles = stylex.create({
  // 共有の root は横並び。この帯は文と進捗バーを縦に積む
  root: { flexDirection: "column", alignItems: "stretch", gap: space.sm },
  row: { display: "flex", alignItems: "center", flexWrap: "wrap", gap: space.sm },
});

export function UploadProgressBar({
  done,
  total,
  failed,
  onCancel,
}: {
  done: number;
  total: number;
  failed: number;
  onCancel: () => void;
}) {
  const { upload } = MEDIA_LABELS;
  return (
    <div role="status" aria-live="polite" {...stylex.props(bulkBarStyles.root, styles.root)}>
      <div {...stylex.props(styles.row)}>
        <span {...stylex.props(bulkBarStyles.selected)}>{upload.progressTitle}</span>
        <span>
          {upload.progress(done, total)}
          {failed > 0 && ` ・ ${upload.failedCount(failed)}`}
        </span>
        <span {...stylex.props(bulkBarStyles.spacer)}>
          <Button size="sm" variant="secondary" onPress={onCancel}>
            {upload.cancel}
          </Button>
        </span>
      </div>
      <ProgressBar
        label={upload.progressTitle}
        isLabelHidden
        value={done}
        maxValue={total}
        valueLabel={upload.progress(done, total)}
      />
    </div>
  );
}
