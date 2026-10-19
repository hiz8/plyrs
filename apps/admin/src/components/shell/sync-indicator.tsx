import * as stylex from "@stylexjs/stylex";
import { TriangleAlert } from "lucide-react";
import { ICON_SIZE } from "@plyrs/ui";
import { font, radius, space, status, text } from "@plyrs/ui/semantic.stylex";
import { SYNC_INDICATOR_LABELS } from "../../lib/labels";
import type { SyncIndicatorState } from "../../lib/sync-indicator";

// a-navigation.md 3.5: 高さ 28px、点は 8px
const styles = stylex.create({
  root: {
    display: "flex",
    alignItems: "center",
    gap: space.sm,
    height: "28px",
    paddingInline: space.inset,
    fontFamily: font.family,
    fontSize: font.caption,
    color: text.muted,
  },
  dot: { width: "8px", height: "8px", flexShrink: 0, borderRadius: radius.full },
  ready: { backgroundColor: status.success },
  syncing: { backgroundColor: text.muted },
  warning: { color: status.warning, fontWeight: font.weightMedium },
  icon: { display: "inline-flex", flexShrink: 0 },
});

export function SyncIndicator({ state }: { state: SyncIndicatorState }) {
  const label = SYNC_INDICATOR_LABELS[state];
  return (
    <div role="status" {...stylex.props(styles.root, state === "disconnected" && styles.warning)}>
      {state === "disconnected" ? (
        <span {...stylex.props(styles.icon)}>
          <TriangleAlert size={ICON_SIZE.inline} aria-hidden="true" />
        </span>
      ) : (
        <span
          aria-hidden="true"
          {...stylex.props(styles.dot, state === "ready" ? styles.ready : styles.syncing)}
        />
      )}
      <span>{label}</span>
    </div>
  );
}
