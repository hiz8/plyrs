import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import {
  Tab,
  TabList,
  TabPanel,
  Tabs as RacTabs,
  type TabRenderProps,
} from "react-aria-components";
import { stylexRenderProps } from "./compose";
import {
  accent,
  bg,
  border,
  focus,
  font,
  radius,
  size,
  space,
  stroke,
  text,
} from "./semantic.stylex";

// D1 ボード 3d。件数は radius.badge の長方形(案 R)。件数 0 のタブは件数のバッジだけを薄く出す
// (案 D 3.2。タブ全体の opacity はコントラストを下げ、押せるのに無効に見えるため使わない。d-content-list.md 11 章)
const styles = stylex.create({
  list: {
    display: "flex",
    gap: space.xs,
    // 狭い画面ではタブの並びだけを横に流す
    overflowX: "auto",
    borderBottomWidth: stroke.default,
    borderBottomStyle: "solid",
    borderBottomColor: border.default,
    fontFamily: font.family,
  },
  tab: {
    display: "inline-flex",
    alignItems: "center",
    flexShrink: 0,
    gap: space.sm,
    height: size.rowCompact,
    paddingInline: space.inset,
    marginBottom: `calc(-1 * ${stroke.default})`,
    fontSize: font.body,
    fontWeight: font.weightMedium,
    color: text.muted,
    borderBottomWidth: stroke.focus,
    borderBottomStyle: "solid",
    borderBottomColor: "transparent",
    borderTopLeftRadius: radius.item,
    borderTopRightRadius: radius.item,
    cursor: "pointer",
    outline: "none",
    whiteSpace: "nowrap",
  },
  hovered: { backgroundColor: bg.hover },
  selected: { color: accent.default, borderBottomColor: accent.default },
  focusVisible: {
    outlineWidth: stroke.focus,
    outlineStyle: "solid",
    outlineColor: focus.ring,
    outlineOffset: `calc(-1 * ${stroke.focus})`,
  },
  count: {
    paddingInline: space.xs,
    fontSize: font.caption,
    lineHeight: font.lineHeightNormal,
    color: text.muted,
    backgroundColor: bg.surface,
    borderWidth: stroke.default,
    borderStyle: "solid",
    borderColor: border.default,
    borderRadius: radius.badge,
  },
  // 地と枠を消し、文字は text.muted のまま(コントラストを保つ)
  countEmpty: { backgroundColor: "transparent", borderColor: "transparent" },
  countSelected: {
    color: accent.default,
    backgroundColor: accent.surface,
    borderColor: "transparent",
  },
  panel: { outline: "none" },
});

export interface TabItem {
  id: string;
  label: string;
  count?: number;
}

export interface TabsProps {
  /** タブの並びの名前(例: 公開状態) */
  label: string;
  items: TabItem[];
  selectedKey: string;
  onSelectionChange: (key: string) => void;
  /** 選ばれたタブの中身。URL の状態から描く画面が多いため、id だけを渡す */
  children: (id: string) => ReactNode;
}

export function Tabs({ label, items, selectedKey, onSelectionChange, children }: TabsProps) {
  return (
    <RacTabs selectedKey={selectedKey} onSelectionChange={(key) => onSelectionChange(String(key))}>
      <TabList aria-label={label} className={stylex.props(styles.list).className ?? ""}>
        {items.map((item) => (
          <Tab
            key={item.id}
            id={item.id}
            className={stylexRenderProps<TabRenderProps>((state) => [
              styles.tab,
              state.isHovered && styles.hovered,
              state.isSelected && styles.selected,
              state.isFocusVisible && styles.focusVisible,
            ])}
          >
            {({ isSelected }) => (
              <>
                {item.label}
                {item.count !== undefined && (
                  <span
                    {...stylex.props(
                      styles.count,
                      item.count === 0 && styles.countEmpty,
                      isSelected && styles.countSelected,
                    )}
                  >
                    {item.count}
                  </span>
                )}
              </>
            )}
          </Tab>
        ))}
      </TabList>
      {items.map((item) => (
        <TabPanel key={item.id} id={item.id} className={stylex.props(styles.panel).className ?? ""}>
          {children(item.id)}
        </TabPanel>
      ))}
    </RacTabs>
  );
}
