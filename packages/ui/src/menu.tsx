import * as stylex from "@stylexjs/stylex";
import { Check, type LucideIcon } from "lucide-react";
import { useId, type ReactElement, type ReactNode } from "react";
import {
  Header,
  Menu as RacMenu,
  MenuItem as RacMenuItem,
  MenuSection as RacMenuSection,
  MenuTrigger,
  Popover,
  Separator,
  VisuallyHidden,
  type MenuItemRenderProps,
} from "react-aria-components";
import { stylexRenderProps } from "./compose";
import { ICON_SIZE } from "./icon";
import {
  accent,
  bg,
  border,
  elevation,
  focus,
  font,
  layer,
  radius,
  size,
  space,
  status,
  stroke,
  text,
} from "./semantic.stylex";

// D1 ボード 3c。アイコンは設計書 12 章の 20px(キャンバスの 16px は採らない)
const styles = stylex.create({
  popover: {
    // 部品固有の最小幅(D1 ボード 3c)
    minWidth: "200px",
    padding: space.xs,
    backgroundColor: bg.raised,
    borderWidth: stroke.default,
    borderStyle: "solid",
    borderColor: border.default,
    borderRadius: radius.container,
    boxShadow: elevation.menu,
    // react-aria の useOverlayPosition が inline の style に zIndex: 100000 を書くため、実際の重なり順は
    // その値になり、この layer.dropdown は上書きされる。将来 inline の値が外れたときの拠り所として残す
    zIndex: layer.dropdown,
    outline: "none",
  },
  menu: { outline: "none", fontFamily: font.family },
  item: {
    display: "flex",
    alignItems: "center",
    gap: space.inset,
    minHeight: size.control,
    paddingInline: space.inset,
    fontSize: font.body,
    color: text.default,
    borderRadius: radius.item,
    cursor: "pointer",
    outline: "none",
  },
  itemFocused: { backgroundColor: bg.hover },
  danger: { color: status.danger },
  current: {
    backgroundColor: accent.surface,
    color: accent.default,
    fontWeight: font.weightMedium,
  },
  // current の地が itemFocused の地を上書きするため、現在の項目へのキーボードのフォーカスは輪で示す
  currentFocusVisible: {
    outlineWidth: stroke.focus,
    outlineStyle: "solid",
    outlineColor: focus.ring,
    outlineOffset: `calc(-1 * ${stroke.focus})`,
  },
  disabled: { opacity: 0.5, cursor: "not-allowed" },
  label: {
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  header: {
    paddingTop: space.sm,
    paddingBottom: space.xs,
    paddingInline: space.inset,
    fontSize: font.caption,
    fontWeight: font.weightMedium,
    color: text.muted,
  },
  separator: {
    height: stroke.default,
    marginBlock: space.xs,
    backgroundColor: border.default,
    borderWidth: 0,
  },
});

export interface MenuProps {
  /** RAC の Button / IconButton */
  trigger: ReactElement;
  label: string;
  onAction: (id: string) => void;
  children: ReactNode;
  placement?: "bottom start" | "bottom end" | "top start" | "top end";
}

export function Menu({
  trigger,
  label,
  onAction,
  children,
  placement = "bottom start",
}: MenuProps) {
  const labelId = useId();
  return (
    <MenuTrigger>
      {trigger}
      <Popover
        placement={placement}
        offset={4}
        className={stylex.props(styles.popover).className ?? ""}
      >
        {/* MenuTrigger がトリガーの id を aria-labelledby に入れ、aria-label を上書きするため、
            メニューの名前は専用の非表示要素から与える */}
        <span id={labelId} hidden>
          {label}
        </span>
        <RacMenu
          aria-labelledby={labelId}
          onAction={(key) => onAction(String(key))}
          className={stylex.props(styles.menu).className ?? ""}
        >
          {children}
        </RacMenu>
      </Popover>
    </MenuTrigger>
  );
}

export interface MenuItemProps {
  id: string;
  children: string;
  icon?: LucideIcon;
  tone?: "danger";
  isDisabled?: boolean;
  /** サイト切替の現在のサイト(地を accent.surface にし check を付ける) */
  isCurrent?: boolean;
}

export function MenuItem({ id, children, icon: Icon, tone, isDisabled, isCurrent }: MenuItemProps) {
  return (
    <RacMenuItem
      id={id}
      textValue={children}
      isDisabled={isDisabled ?? false}
      className={stylexRenderProps<MenuItemRenderProps>((state) => [
        styles.item,
        (state.isFocused || state.isHovered) && styles.itemFocused,
        tone === "danger" && styles.danger,
        isCurrent === true && styles.current,
        isCurrent === true && state.isFocusVisible && styles.currentFocusVisible,
        state.isDisabled && styles.disabled,
      ])}
    >
      {Icon !== undefined && <Icon size={ICON_SIZE.nav} aria-hidden="true" />}
      {/* 長いサイト名は省略記号で切る。全文は title で出す */}
      <span title={children} {...stylex.props(styles.label)}>
        {children}
      </span>
      {/* 地の色と check は見た目だけなので、現在であることを名前でも伝える */}
      {isCurrent === true && <VisuallyHidden elementType="span">(現在)</VisuallyHidden>}
      {isCurrent === true && <Check size={ICON_SIZE.inline} aria-hidden="true" />}
    </RacMenuItem>
  );
}

export function MenuSection({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <RacMenuSection>
      {title !== undefined && (
        <Header className={stylex.props(styles.header).className ?? ""}>{title}</Header>
      )}
      {children}
    </RacMenuSection>
  );
}

export function MenuSeparator() {
  return <Separator className={stylex.props(styles.separator).className ?? ""} />;
}
