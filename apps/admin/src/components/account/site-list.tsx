import * as stylex from "@stylexjs/stylex";
import { ArrowRightLeft } from "lucide-react";
import { Link, type LinkRenderProps } from "react-aria-components";
import { Avatar, Badge, ICON_SIZE, stylexRenderProps } from "@plyrs/ui";
import { border, focus, font, radius, size, space, stroke, text } from "@plyrs/ui/semantic.stylex";
import type { TenantSummary } from "../../lib/api-client";
import { ACCOUNT_LABELS, roleLabel } from "../../lib/labels";
import { can } from "../../lib/permissions";

const styles = stylex.create({
  list: { display: "flex", flexDirection: "column", margin: 0, padding: 0, listStyle: "none" },
  row: {
    display: "flex",
    alignItems: "center",
    gap: space.inset,
    minHeight: size.rowCompact,
    minWidth: 0,
    borderTopWidth: stroke.default,
    borderTopStyle: "solid",
    borderTopColor: border.default,
    fontSize: font.body,
    color: text.default,
  },
  name: {
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  current: { fontSize: font.caption, color: text.muted },
  link: {
    borderRadius: radius.small,
    color: text.default,
    textDecoration: { default: "none", ":hover": "underline" },
    cursor: "pointer",
    outline: "none",
  },
  linkInner: { display: "inline-flex", alignItems: "center", gap: space.xs },
  linkFocus: {
    outlineWidth: stroke.focus,
    outlineStyle: "solid",
    outlineColor: focus.ring,
    outlineOffset: stroke.focus,
  },
});

export function SiteList({
  tenants,
  currentId,
}: {
  tenants: readonly TenantSummary[];
  currentId: string;
}) {
  const labels = ACCOUNT_LABELS.sites;
  return (
    <ul {...stylex.props(styles.list)}>
      {tenants.map((tenant) => (
        <li key={tenant.id} {...stylex.props(styles.row)}>
          <Avatar size="sm" name={tenant.name} />
          <span title={tenant.name} {...stylex.props(styles.name)}>
            {tenant.name}
          </span>
          <Badge tone={can(tenant.role, "member:manage") ? "accent" : "neutral"}>
            {roleLabel(tenant.role)}
          </Badge>
          {tenant.id === currentId ? (
            <span {...stylex.props(styles.current)}>{labels.current}</span>
          ) : (
            <Link
              href={`/t/${tenant.slug}`}
              className={stylexRenderProps<LinkRenderProps>((state) => [
                styles.link,
                state.isFocusVisible && styles.linkFocus,
              ])}
            >
              <span {...stylex.props(styles.linkInner)}>
                <ArrowRightLeft size={ICON_SIZE.inline} aria-hidden="true" />
                {labels.switch}
              </span>
            </Link>
          )}
        </li>
      ))}
    </ul>
  );
}
