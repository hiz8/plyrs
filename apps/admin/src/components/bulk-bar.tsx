import * as stylex from "@stylexjs/stylex";
import { WORKFLOW_STATUSES, type WorkflowStatus } from "@plyrs/metamodel";
import {
  Button,
  Menu,
  MenuItem,
  MenuSection,
  MenuSeparator,
  ProgressBar,
  Spinner,
} from "@plyrs/ui";
import { accent, font, radius, space, stroke, text } from "@plyrs/ui/semantic.stylex";
import { CircleOff, Globe, RotateCw, Trash2 } from "lucide-react";
import { BULK_LABELS, WORKFLOW_STATUS_LABELS } from "../lib/labels";
import type { BulkKind } from "../lib/use-bulk-action";

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
  note: { color: text.muted },
  spacer: { marginInlineStart: "auto", display: "flex", alignItems: "center", gap: space.inset },
  // 部品固有の幅(D2 L3): 進捗バーは伸ばしすぎない
  progress: { flex: 1, minWidth: 0, maxWidth: "320px" },
});

export type BulkMenuAction =
  | { kind: "publish" }
  | { kind: "unpublish" }
  | { kind: "status"; status: WorkflowStatus }
  | { kind: "delete" };

export interface BulkBarProps {
  selectedCount: number;
  /** 表示中のページの件数(「このページの N 件を選択」) */
  pageCount: number;
  onSelectPage: () => void;
  onClear: () => void;
  onAction: (action: BulkMenuAction) => void;
  progress: { kind: BulkKind; done: number; total: number; onCancel: () => void } | null;
  failure: { kind: BulkKind; onRetry: () => void } | null;
}

function isWorkflowStatus(value: string): value is WorkflowStatus {
  return (WORKFLOW_STATUSES as readonly string[]).includes(value);
}

export function BulkBar({
  selectedCount,
  pageCount,
  onSelectPage,
  onClear,
  onAction,
  progress,
  failure,
}: BulkBarProps) {
  const handleAction = (id: string) => {
    if (id.startsWith("status:")) {
      const status = id.slice("status:".length);
      if (isWorkflowStatus(status)) onAction({ kind: "status", status });
      return;
    }
    if (id === "publish" || id === "unpublish" || id === "delete") onAction({ kind: id });
  };
  return (
    <div
      role="region"
      aria-label={BULK_LABELS.region}
      aria-busy={progress !== null}
      {...stylex.props(styles.root)}
    >
      {progress !== null ? (
        <>
          <Spinner label={BULK_LABELS.running[progress.kind]} />
          <div {...stylex.props(styles.progress)}>
            <ProgressBar
              label={BULK_LABELS.running[progress.kind]}
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
          {failure !== null && <span {...stylex.props(styles.note)}>{BULK_LABELS.failedNote}</span>}
          <Menu
            label={BULK_LABELS.menu}
            onAction={handleAction}
            trigger={
              <Button size="sm" variant="secondary">
                {BULK_LABELS.menu}
              </Button>
            }
          >
            <MenuItem id="publish" icon={Globe}>
              {BULK_LABELS.actions.publish}
            </MenuItem>
            <MenuItem id="unpublish" icon={CircleOff}>
              {BULK_LABELS.actions.unpublish}
            </MenuItem>
            <MenuSection title={BULK_LABELS.actions.status}>
              {WORKFLOW_STATUSES.map((s) => (
                <MenuItem key={s} id={`status:${s}`}>
                  {WORKFLOW_STATUS_LABELS[s]}
                </MenuItem>
              ))}
            </MenuSection>
            <MenuSeparator />
            <MenuItem id="delete" tone="danger" icon={Trash2}>
              {BULK_LABELS.actions.delete}
            </MenuItem>
          </Menu>
          {failure !== null && (
            <Button size="sm" variant="secondary" icon={RotateCw} onPress={failure.onRetry}>
              {BULK_LABELS.retry[failure.kind]}
            </Button>
          )}
          <div {...stylex.props(styles.spacer)}>
            {failure === null && (
              <Button variant="link" size="sm" onPress={onSelectPage}>
                {BULK_LABELS.selectPage(pageCount)}
              </Button>
            )}
            <Button variant="link" size="sm" onPress={onClear}>
              {BULK_LABELS.clear}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
