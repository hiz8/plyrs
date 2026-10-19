import * as stylex from "@stylexjs/stylex";
import type { LucideIcon } from "lucide-react";
import { Link, type LinkRenderProps } from "react-aria-components";
import { ICON_SIZE, stylexRenderProps } from "@plyrs/ui";
import {
  accent,
  bg,
  focus,
  font,
  radius,
  size,
  space,
  stroke,
  text,
} from "@plyrs/ui/semantic.stylex";

// a-navigation.md 3.5。サイドバーはアプリ固有なので RAC の Link を直接使う
const styles = stylex.create({
  link: {
    display: "flex",
    alignItems: "center",
    gap: space.inset,
    // 項目 36px(size.control)
    minHeight: size.control,
    paddingInline: space.inset,
    borderRadius: radius.item,
    color: text.default,
    fontFamily: font.family,
    fontSize: font.label,
    textDecoration: "none",
    outline: "none",
    cursor: "pointer",
    boxSizing: "border-box",
  },
  child: {
    // 子項目 32px(size.controlSm)
    minHeight: size.controlSm,
    // アイコン 20 + 間隔 12 + 8 に寄せた字下げ(a-navigation.md 3.5)。寸法は部品固有
    paddingInlineStart: "40px",
    fontSize: font.body,
    color: text.muted,
  },
  hovered: { backgroundColor: bg.hover },
  current: {
    backgroundColor: accent.surface,
    color: accent.default,
    fontWeight: font.weightMedium,
  },
  focusVisible: {
    outlineWidth: stroke.focus,
    outlineStyle: "solid",
    outlineColor: focus.ring,
    outlineOffset: `calc(-1 * ${stroke.focus})`,
  },
  label: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  icon: { flexShrink: 0, display: "inline-flex" },
  heading: {
    paddingBlock: space.xs,
    paddingInline: space.inset,
    fontFamily: font.family,
    fontSize: font.caption,
    fontWeight: font.weightBold,
    color: text.muted,
  },
});

export interface NavLinkProps {
  href: string;
  label: string;
  icon?: LucideIcon;
  isCurrent: boolean;
}

function Item({ href, label, icon: Icon, isCurrent, child }: NavLinkProps & { child: boolean }) {
  return (
    <Link
      href={href}
      // 現在地の 1 項目だけに付ける(他に aria-current="false" は付けない)
      aria-current={isCurrent ? "page" : undefined}
      className={stylexRenderProps<LinkRenderProps>((state) => [
        styles.link,
        child && styles.child,
        state.isHovered && styles.hovered,
        isCurrent && styles.current,
        state.isFocusVisible && styles.focusVisible,
      ])}
    >
      {Icon !== undefined && (
        <span {...stylex.props(styles.icon)}>
          <Icon size={ICON_SIZE.nav} aria-hidden="true" />
        </span>
      )}
      <span {...stylex.props(styles.label)}>{label}</span>
    </Link>
  );
}

export function NavLink(props: NavLinkProps) {
  return <Item {...props} child={false} />;
}

export function NavChildLink(props: NavLinkProps) {
  return <Item {...props} child />;
}

// 見出し要素にはしない(案 A 3 章。ページの見出し階層を汚さない)
export function NavHeading({ id, children }: { id: string; children: string }) {
  return (
    <div id={id} {...stylex.props(styles.heading)}>
      {children}
    </div>
  );
}
