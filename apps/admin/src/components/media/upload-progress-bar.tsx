import * as stylex from "@stylexjs/stylex";
import { Button, ProgressBar } from "@plyrs/ui";
import { accent, font, radius, space, stroke } from "@plyrs/ui/semantic.stylex";
import { MEDIA_LABELS } from "../../lib/labels";

// bulk-bar.tsx と同じ地・枠・余白(M6 の上のバー)
const styles = stylex.create({
  root: {
    display: "flex",
    flexDirection: "column",
    gap: space.sm,
    padding: `${space.sm} ${space.inset}`,
    backgroundColor: accent.surface,
    borderWidth: stroke.default,
    borderStyle: "solid",
    borderColor: accent.default,
    borderRadius: radius.container,
    fontSize: font.body,
  },
  row: { display: "flex", alignItems: "center", flexWrap: "wrap", gap: space.sm },
  title: { fontWeight: font.weightBold, color: accent.default },
  spacer: { marginInlineStart: "auto" },
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
    <div role="status" aria-live="polite" {...stylex.props(styles.root)}>
      <div {...stylex.props(styles.row)}>
        <span {...stylex.props(styles.title)}>{upload.progressTitle}</span>
        <span>
          {upload.progress(done, total)}
          {failed > 0 && ` ・ ${upload.failedCount(failed)}`}
        </span>
        <span {...stylex.props(styles.spacer)}>
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
