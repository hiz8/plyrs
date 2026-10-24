import * as stylex from "@stylexjs/stylex";
import { Button, ProgressBar, Spinner } from "@plyrs/ui";
import { accent, font, radius, space, status, stroke } from "@plyrs/ui/semantic.stylex";
import { RotateCw, Trash2 } from "lucide-react";
import { BULK_LABELS, MEDIA_LABELS } from "../../lib/labels";

// bulk-bar.tsx と同じ見た目(メニュー無し)
const styles = stylex.create({
  root: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: space.inset,
    padding: `${space.sm} ${space.inset}`,
    backgroundColor: accent.surface,
    borderWidth: stroke.default,
    borderStyle: "solid",
    borderColor: accent.default,
    borderRadius: radius.control,
    fontSize: font.body,
  },
  selected: { fontWeight: font.weightBold, color: accent.default },
  danger: { color: status.danger },
  spacer: { marginInlineStart: "auto", display: "flex", alignItems: "center", gap: space.inset },
  // 部品固有の幅(D2 L3): 進捗バーは伸ばしすぎない
  progress: { flex: 1, minWidth: 0, maxWidth: "320px" },
});

export interface MediaBulkBarProps {
  selectedCount: number;
  /** 「N 件すべてを選択」の N = 絞り込み後の件数 */
  totalCount: number;
  onSelectAll: () => void;
  onClear: () => void;
  onDelete: () => void;
  progress: { done: number; total: number; onCancel: () => void } | null;
  failure: { onRetry: () => void } | null;
}

export function MediaBulkBar({
  selectedCount,
  totalCount,
  onSelectAll,
  onClear,
  onDelete,
  progress,
  failure,
}: MediaBulkBarProps) {
  return (
    <div
      role="region"
      aria-label={MEDIA_LABELS.bulk.region}
      aria-busy={progress !== null}
      {...stylex.props(styles.root)}
    >
      {progress !== null ? (
        <>
          <span aria-hidden="true">
            <Spinner label={MEDIA_LABELS.bulk.running} />
          </span>
          <div {...stylex.props(styles.progress)}>
            <ProgressBar
              label={MEDIA_LABELS.bulk.running}
              isLabelHidden
              value={progress.done}
              maxValue={progress.total}
              valueLabel={BULK_LABELS.progress(progress.done, progress.total)}
            />
          </div>
          <Button size="sm" variant="secondary" onPress={progress.onCancel}>
            {BULK_LABELS.cancel}
          </Button>
        </>
      ) : (
        <>
          <span {...stylex.props(styles.selected)}>{BULK_LABELS.selected(selectedCount)}</span>
          <Button size="sm" variant="secondary" icon={Trash2} onPress={onDelete}>
            <span {...stylex.props(styles.danger)}>{MEDIA_LABELS.bulk.delete}</span>
          </Button>
          {failure !== null && (
            <Button size="sm" variant="secondary" icon={RotateCw} onPress={failure.onRetry}>
              {MEDIA_LABELS.bulk.retry}
            </Button>
          )}
          <div {...stylex.props(styles.spacer)}>
            <Button variant="link" size="sm" onPress={onSelectAll}>
              {MEDIA_LABELS.bulk.selectAll(totalCount)}
            </Button>
            <Button variant="link" size="sm" onPress={onClear}>
              {MEDIA_LABELS.bulk.clear}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
