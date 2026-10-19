import * as stylex from "@stylexjs/stylex";
import { Menu } from "lucide-react";
import { IconButton } from "@plyrs/ui";
import { bg, border, font, radius, space, status, stroke, text } from "@plyrs/ui/semantic.stylex";
import { NAV_LABELS, SYNC_INDICATOR_LABELS } from "../../lib/labels";
import type { SyncIndicatorState } from "../../lib/sync-indicator";

// a-navigation.md 3.4: 狭い画面だけに出る高さ 48px の上部バー。同期の点は 8px(3.5 と同じ)
const styles = stylex.create({
  root: {
    display: "flex",
    alignItems: "center",
    gap: space.sm,
    height: "48px",
    flex: "none",
    paddingInline: space.sm,
    boxSizing: "border-box",
    backgroundColor: bg.surface,
    borderBottomWidth: stroke.default,
    borderBottomStyle: "solid",
    borderBottomColor: border.default,
    fontFamily: font.family,
  },
  brand: { fontSize: font.caption, fontWeight: 600, color: text.muted },
  name: {
    flex: 1,
    minWidth: 0,
    fontSize: font.label,
    fontWeight: 600,
    color: text.default,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  dot: { width: "8px", height: "8px", flexShrink: 0, borderRadius: radius.full },
  ready: { backgroundColor: status.success },
  syncing: { backgroundColor: text.muted },
  disconnected: { backgroundColor: status.warning },
});

export interface TopBarProps {
  tenantName: string;
  syncState: SyncIndicatorState;
  isMenuOpen: boolean;
  onToggleMenu: () => void;
}

export function TopBar({ tenantName, syncState, isMenuOpen, onToggleMenu }: TopBarProps) {
  return (
    <header {...stylex.props(styles.root)}>
      <IconButton
        icon={Menu}
        label={isMenuOpen ? NAV_LABELS.closeMenu : NAV_LABELS.openMenu}
        aria-expanded={isMenuOpen}
        onPress={onToggleMenu}
      />
      <span {...stylex.props(styles.brand)}>plyrs</span>
      <span {...stylex.props(styles.name)}>{tenantName}</span>
      <span
        title={SYNC_INDICATOR_LABELS[syncState]}
        {...stylex.props(styles.dot, styles[syncState])}
      />
    </header>
  );
}
