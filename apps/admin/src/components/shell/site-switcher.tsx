import * as stylex from "@stylexjs/stylex";
import { ChevronDown } from "lucide-react";
import { Button, type ButtonRenderProps } from "react-aria-components";
import {
  ICON_SIZE,
  Menu,
  MenuItem,
  MenuSection,
  MenuSeparator,
  stylexRenderProps,
} from "@plyrs/ui";
import { bg, focus, font, radius, size, space, stroke, text } from "@plyrs/ui/semantic.stylex";
import type { TenantSummary } from "../../lib/api-client";
import { NAV_LABELS, roleLabel } from "../../lib/labels";

// a-navigation.md 3.5: 上段。「plyrs」の下にサイト名
const styles = stylex.create({
  root: { display: "flex", flexDirection: "column", gap: space.xxs, minWidth: 0 },
  brand: {
    paddingInline: space.inset,
    fontFamily: font.family,
    fontSize: font.caption,
    fontWeight: font.weightBold,
    letterSpacing: "0.04em",
    color: text.muted,
  },
  name: {
    display: "block",
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  plainName: {
    display: "flex",
    alignItems: "center",
    minHeight: size.control,
    paddingInline: space.inset,
    fontFamily: font.family,
    fontSize: font.label,
    fontWeight: font.weightBold,
    color: text.default,
  },
  trigger: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.sm,
    // 36px(size.control)
    minHeight: size.control,
    width: "100%",
    paddingInline: space.inset,
    borderWidth: 0,
    borderRadius: radius.item,
    backgroundColor: "transparent",
    color: text.default,
    fontFamily: font.family,
    fontSize: font.label,
    fontWeight: font.weightBold,
    textAlign: "start",
    outline: "none",
    cursor: "pointer",
    boxSizing: "border-box",
  },
  hovered: { backgroundColor: bg.hover },
  focusVisible: {
    outlineWidth: stroke.focus,
    outlineStyle: "solid",
    outlineColor: focus.ring,
    outlineOffset: `calc(-1 * ${stroke.focus})`,
  },
  chevron: { display: "inline-flex", flexShrink: 0, color: text.muted },
});

export interface SiteSwitcherProps {
  tenant: TenantSummary;
  tenants: readonly TenantSummary[];
  onSwitch: (slug: string) => void;
  onOpenList: () => void;
}

const LIST_ID = "__list";

export function SiteSwitcher({ tenant, tenants, onSwitch, onOpenList }: SiteSwitcherProps) {
  return (
    <div {...stylex.props(styles.root)}>
      <span {...stylex.props(styles.brand)}>plyrs</span>
      {tenants.length > 1 ? (
        <Menu
          label={NAV_LABELS.switchSite}
          onAction={(id) => (id === LIST_ID ? onOpenList() : onSwitch(id))}
          trigger={
            <Button
              className={stylexRenderProps<ButtonRenderProps>((state) => [
                styles.trigger,
                state.isHovered && styles.hovered,
                state.isFocusVisible && styles.focusVisible,
              ])}
            >
              {/* RAC の Button は title を受けないので、名前の span に付ける(長い名前の全文) */}
              <span title={tenant.name} {...stylex.props(styles.name)}>
                {tenant.name}
              </span>
              <span {...stylex.props(styles.chevron)}>
                <ChevronDown size={ICON_SIZE.inline} aria-hidden="true" />
              </span>
            </Button>
          }
        >
          <MenuSection title={NAV_LABELS.switchSite}>
            {tenants.map((t) => (
              <MenuItem
                key={t.slug}
                id={t.slug}
                detail={roleLabel(t.role)}
                isCurrent={t.slug === tenant.slug}
              >
                {t.name}
              </MenuItem>
            ))}
          </MenuSection>
          <MenuSeparator />
          <MenuItem id={LIST_ID}>{NAV_LABELS.openSiteList}</MenuItem>
        </Menu>
      ) : (
        <span title={tenant.name} {...stylex.props(styles.plainName)}>
          <span {...stylex.props(styles.name)}>{tenant.name}</span>
        </span>
      )}
    </div>
  );
}
