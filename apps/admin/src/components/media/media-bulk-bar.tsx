import * as stylex from "@stylexjs/stylex";
import { Button, ProgressBar, Spinner } from "@plyrs/ui";
import { status } from "@plyrs/ui/semantic.stylex";
import { RotateCw, Trash2 } from "lucide-react";
import { BULK_LABELS, MEDIA_LABELS } from "../../lib/labels";
import { bulkBarStyles } from "../bulk-bar-styles";

const styles = stylex.create({
  danger: { color: status.danger },
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
      {...stylex.props(bulkBarStyles.root)}
    >
      {progress !== null ? (
        <>
          <span aria-hidden="true">
            <Spinner label={MEDIA_LABELS.bulk.running} />
          </span>
          <div {...stylex.props(bulkBarStyles.progress)}>
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
          <span {...stylex.props(bulkBarStyles.selected)}>
            {BULK_LABELS.selected(selectedCount)}
          </span>
          <Button size="sm" variant="secondary" icon={Trash2} onPress={onDelete}>
            <span {...stylex.props(styles.danger)}>{MEDIA_LABELS.bulk.delete}</span>
          </Button>
          {failure !== null && (
            <Button size="sm" variant="secondary" icon={RotateCw} onPress={failure.onRetry}>
              {MEDIA_LABELS.bulk.retry}
            </Button>
          )}
          <div {...stylex.props(bulkBarStyles.spacer)}>
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
