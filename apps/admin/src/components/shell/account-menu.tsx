import * as stylex from "@stylexjs/stylex";
import { ArrowRightLeft, ChevronUp, LogOut, UserCog } from "lucide-react";
import { Button, type ButtonRenderProps } from "react-aria-components";
import {
  Avatar,
  ICON_SIZE,
  Menu,
  MenuItem,
  MenuSection,
  MenuSeparator,
  stylexRenderProps,
} from "@plyrs/ui";
import { bg, focus, font, radius, size, space, stroke, text } from "@plyrs/ui/semantic.stylex";
import { NAV_LABELS } from "../../lib/labels";

// a-navigation.md 3.5: 下段のアカウント。Avatar + メール(1 行省略)+ chevron-up
const styles = stylex.create({
  trigger: {
    display: "flex",
    alignItems: "center",
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
    fontSize: font.body,
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
  email: {
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  chevron: { display: "inline-flex", flexShrink: 0, color: text.muted },
});

export interface AccountMenuProps {
  email: string | undefined;
  canSwitchSite: boolean;
  onOpenAccount: () => void;
  onOpenSiteList: () => void;
  onLogout: () => void;
}

export function AccountMenu({
  email,
  canSwitchSite,
  onOpenAccount,
  onOpenSiteList,
  onLogout,
}: AccountMenuProps) {
  return (
    <Menu
      label={NAV_LABELS.account}
      placement="top start"
      onAction={(id) =>
        id === "account"
          ? onOpenAccount()
          : id === "sites"
            ? onOpenSiteList()
            : id === "logout"
              ? onLogout()
              : undefined
      }
      trigger={
        <Button
          aria-label={NAV_LABELS.account}
          className={stylexRenderProps<ButtonRenderProps>((state) => [
            styles.trigger,
            state.isHovered && styles.hovered,
            state.isFocusVisible && styles.focusVisible,
          ])}
        >
          <Avatar size="sm" name={email ?? "?"} />
          <span title={email} {...stylex.props(styles.email)}>
            {email}
          </span>
          <span {...stylex.props(styles.chevron)}>
            <ChevronUp size={ICON_SIZE.inline} aria-hidden="true" />
          </span>
        </Button>
      }
    >
      <MenuSection {...(email === undefined ? {} : { title: email })}>
        <MenuItem id="account" icon={UserCog}>
          {NAV_LABELS.accountSettings}
        </MenuItem>
        <MenuSeparator />
        {canSwitchSite && (
          <>
            <MenuItem id="sites" icon={ArrowRightLeft}>
              {NAV_LABELS.switchSite}
            </MenuItem>
            <MenuSeparator />
          </>
        )}
        <MenuItem id="logout" icon={LogOut}>
          {NAV_LABELS.logout}
        </MenuItem>
      </MenuSection>
    </Menu>
  );
}
