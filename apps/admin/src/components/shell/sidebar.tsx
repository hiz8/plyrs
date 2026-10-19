import * as stylex from "@stylexjs/stylex";
import { FileText, House, Image, Plus, Settings } from "lucide-react";
import { Link } from "react-aria-components";
import { ICON_SIZE, Skeleton, stylexRenderProps, type NavItemContribution } from "@plyrs/ui";
import {
  accent,
  bg,
  border,
  font,
  space,
  stroke,
  text,
  focus,
  radius,
  size,
} from "@plyrs/ui/semantic.stylex";
import type { LinkRenderProps } from "react-aria-components";
import type { ModuleSummary } from "../../lib/admin-api";
import type { TenantSummary } from "../../lib/api-client";
import { NAV_LABELS } from "../../lib/labels";
import {
  activeNavKey,
  moduleNavGroups,
  resolveNavHref,
  sidebarContentTypes,
  type NavEntry,
  type NavType,
} from "../../lib/navigation";
import { can } from "../../lib/permissions";
import type { SyncIndicatorState } from "../../lib/sync-indicator";
import { AccountMenu } from "./account-menu";
import { NavChildLink, NavHeading, NavLink } from "./nav-link";
import { SiteSwitcher } from "./site-switcher";
import { SyncIndicator } from "./sync-indicator";

// a-navigation.md 3 章・3.5。幅 240px の 3 段(上段・下段は固定、中段だけスクロール)
const styles = stylex.create({
  root: {
    // サイドバーの幅 240px(部品固有の寸法)
    width: "240px",
    display: "flex",
    flexDirection: "column",
    height: "100%",
    backgroundColor: bg.surface,
    borderInlineEndWidth: stroke.default,
    borderInlineEndStyle: "solid",
    borderInlineEndColor: border.default,
    boxSizing: "border-box",
  },
  top: {
    flex: "none",
    padding: space.inset,
    borderBottomWidth: stroke.default,
    borderBottomStyle: "solid",
    borderBottomColor: border.default,
  },
  middle: {
    flex: 1,
    minHeight: 0,
    overflowY: "auto",
    padding: space.sm,
    display: "flex",
    flexDirection: "column",
    gap: space.xxs,
  },
  bottom: {
    flex: "none",
    padding: space.sm,
    display: "flex",
    flexDirection: "column",
    gap: space.xxs,
    borderTopWidth: stroke.default,
    borderTopStyle: "solid",
    borderTopColor: border.default,
  },
  group: { display: "flex", flexDirection: "column", gap: space.xxs, margin: 0, padding: 0 },
  groupGap: { marginTop: space.sm },
  skeletons: {
    display: "flex",
    flexDirection: "column",
    gap: space.sm,
    paddingBlock: space.sm,
    paddingInline: space.inset,
  },
  noTypes: {
    paddingBlock: space.xs,
    paddingInline: space.inset,
    fontFamily: font.family,
    fontSize: font.caption,
    color: text.muted,
  },
  createLink: {
    display: "flex",
    alignItems: "center",
    gap: space.sm,
    minHeight: size.control,
    paddingInline: space.inset,
    borderRadius: radius.item,
    fontFamily: font.family,
    fontSize: font.body,
    color: accent.default,
    textDecoration: "none",
    outline: "none",
    cursor: "pointer",
  },
  createHover: { backgroundColor: bg.hover },
  createFocus: {
    outlineWidth: stroke.focus,
    outlineStyle: "solid",
    outlineColor: focus.ring,
    outlineOffset: `calc(-1 * ${stroke.focus})`,
  },
});

export interface SidebarProps {
  tenant: TenantSummary;
  tenants: readonly TenantSummary[];
  email: string | undefined;
  types: readonly NavType[];
  /** 初回同期を終えたか。false の間は型 0 件でも案内を出さない */
  hasSynced: boolean;
  modules: readonly ModuleSummary[] | undefined;
  slotItems: readonly NavItemContribution[];
  syncState: SyncIndicatorState;
  pathname: string;
  onSwitchTenant: (slug: string) => void;
  onOpenTenantList: () => void;
  onLogout: () => void;
}

// 昇順、同順位は id の辞書順(slots.ts の契約)
function bySlotOrder(a: NavItemContribution, b: NavItemContribution): number {
  return a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

export function Sidebar(props: SidebarProps) {
  const { tenant, types, hasSynced, modules, slotItems, pathname } = props;
  const base = `/t/${tenant.slug}`;
  const canWrite = can(tenant.role, "record:write");
  const canManage = can(tenant.role, "type:manage");

  const contentTypes = sidebarContentTypes(types);
  const groups = moduleNavGroups(modules ?? [], types);
  const slotHref = (item: NavItemContribution) =>
    resolveNavHref(item.to, { ...item.params, tenantSlug: tenant.slug });
  const sortedSlots = slotItems.toSorted(bySlotOrder);
  const moduleSlots = (moduleId: string) =>
    sortedSlots.filter((item) => item.group === `module:${moduleId}`);
  const ungroupedSlots = sortedSlots.filter((item) => item.group === undefined);
  // "settings" 群は設定の直後に出すもの。設定が出ない役割には項目も出さない(案 A 4 章)
  const visibleSettingsSlots = canManage
    ? sortedSlots.filter((item) => item.group === "settings")
    : [];

  // 現在地は 1 つだけ。同じ型が 2 群に出ても最初の 1 つに決まる
  const typeEntry = (key: string): NavEntry => ({
    key: `type:${key}`,
    href: `${base}/content/${key}`,
  });
  const settingsEntry: NavEntry = {
    key: "settings",
    href: `${base}/settings/content-types`,
    matchPrefix: `${base}/settings`,
  };
  const entries: NavEntry[] = [
    { key: "home", href: base },
    ...contentTypes.map((t) => typeEntry(t.key)),
    { key: "media", href: `${base}/media` },
    ...groups.flatMap((g) => g.types.map((t) => typeEntry(t.key))),
    ...[
      ...groups.flatMap((g) => moduleSlots(g.moduleId)),
      ...ungroupedSlots,
      ...visibleSettingsSlots,
    ].map((item) => ({ key: `slot:${item.id}`, href: slotHref(item) })),
    ...(canManage ? [settingsEntry] : []),
  ];
  const active = activeNavKey(entries, pathname);

  const typeLinks = (list: readonly { key: string; name: string }[]) =>
    list.map((t) => {
      const entry = typeEntry(t.key);
      const isActive = active === entry.key;
      return (
        <div key={t.key} {...stylex.props(styles.group)}>
          <NavLink href={entry.href} label={t.name} icon={FileText} isCurrent={isActive} />
          {isActive && (
            <>
              <NavChildLink
                href={entry.href}
                label={NAV_LABELS.list}
                isCurrent={pathname === entry.href}
              />
              {canWrite && (
                <NavChildLink
                  href={`${entry.href}/new`}
                  label={NAV_LABELS.add}
                  icon={Plus}
                  isCurrent={pathname === `${entry.href}/new`}
                />
              )}
            </>
          )}
        </div>
      );
    });

  const slotLinks = (list: readonly NavItemContribution[]) =>
    list.map((item) => (
      <NavLink
        key={item.id}
        href={slotHref(item)}
        label={item.label}
        isCurrent={active === `slot:${item.id}`}
      />
    ));

  return (
    <aside {...stylex.props(styles.root)}>
      <div {...stylex.props(styles.top)}>
        <SiteSwitcher
          tenant={tenant}
          tenants={props.tenants}
          onSwitch={props.onSwitchTenant}
          onOpenList={props.onOpenTenantList}
        />
      </div>
      <nav aria-label={NAV_LABELS.mainNav} {...stylex.props(styles.middle)}>
        <NavLink href={base} label={NAV_LABELS.home} icon={House} isCurrent={active === "home"} />
        <NavHeading id="nav-content">{NAV_LABELS.content}</NavHeading>
        <div role="group" aria-labelledby="nav-content" {...stylex.props(styles.group)}>
          {contentTypes.length > 0 ? (
            typeLinks(contentTypes)
          ) : !hasSynced ? (
            // 型がまだ届いていないだけ。案内ではなく項目 36px に合わせた骨組みを出す
            <div aria-busy="true" {...stylex.props(styles.skeletons)}>
              <Skeleton height={20} />
              <Skeleton height={20} />
            </div>
          ) : canManage ? (
            <Link
              href={`${base}/settings/content-types/new`}
              className={stylexRenderProps<LinkRenderProps>((state) => [
                styles.createLink,
                state.isHovered && styles.createHover,
                state.isFocusVisible && styles.createFocus,
              ])}
            >
              <Plus size={ICON_SIZE.inline} aria-hidden="true" />
              {NAV_LABELS.createFirstType}
            </Link>
          ) : (
            <div {...stylex.props(styles.noTypes)}>{NAV_LABELS.noTypes}</div>
          )}
        </div>
        <div {...stylex.props(styles.groupGap)}>
          <NavLink
            href={`${base}/media`}
            label={NAV_LABELS.media}
            icon={Image}
            isCurrent={active === "media"}
          />
        </div>
        {groups.map((group) => {
          const slots = moduleSlots(group.moduleId);
          // 型も slot 項目も無い群は見出しごと出さない
          if (group.types.length === 0 && slots.length === 0) return null;
          return (
            <div
              key={group.moduleId}
              role="group"
              aria-labelledby={`nav-module-${group.moduleId}`}
              {...stylex.props(styles.group, styles.groupGap)}
            >
              <NavHeading id={`nav-module-${group.moduleId}`}>{group.name}</NavHeading>
              {typeLinks(group.types)}
              {slotLinks(slots)}
            </div>
          );
        })}
        {slotLinks(ungroupedSlots)}
      </nav>
      <div {...stylex.props(styles.bottom)}>
        {canManage && (
          <NavLink
            href={settingsEntry.href}
            label={NAV_LABELS.settings}
            icon={Settings}
            isCurrent={active === "settings"}
          />
        )}
        {slotLinks(visibleSettingsSlots)}
        <SyncIndicator state={props.syncState} />
        <AccountMenu
          email={props.email}
          canSwitchSite={props.tenants.length > 1}
          onOpenSiteList={props.onOpenTenantList}
          onLogout={props.onLogout}
        />
      </div>
    </aside>
  );
}
