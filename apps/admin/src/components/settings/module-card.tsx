import * as stylex from "@stylexjs/stylex";
import { CircleCheck, Puzzle } from "lucide-react";
import { useId } from "react";
import { Link, type LinkRenderProps } from "react-aria-components";
import { Badge, Button, ICON_SIZE, stylexRenderProps } from "@plyrs/ui";
import {
  accent,
  bg,
  border,
  focus,
  font,
  radius,
  space,
  status,
  stroke,
  text,
} from "@plyrs/ui/semantic.stylex";
import type { ModuleSummary } from "../../lib/admin-api";
import { MODULE_LABELS } from "../../lib/labels";

const NARROW = "@media (max-width: 959px)";

const styles = stylex.create({
  card: {
    display: "flex",
    alignItems: "flex-start",
    flexWrap: { default: "nowrap", [NARROW]: "wrap" },
    gap: space.md,
    minWidth: 0,
    backgroundColor: bg.surface,
    borderWidth: stroke.default,
    borderStyle: "solid",
    borderColor: border.default,
    borderRadius: radius.container,
    padding: { default: space.lg, [NARROW]: space.md },
    fontFamily: font.family,
    color: text.default,
  },
  icon: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    width: "44px",
    height: "44px",
    borderRadius: radius.item,
  },
  iconOn: { backgroundColor: accent.surface, color: accent.default },
  iconOff: {
    backgroundColor: bg.canvas,
    color: text.muted,
    borderWidth: stroke.default,
    borderStyle: "solid",
    borderColor: border.default,
  },
  main: {
    flex: 1,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: space.xs,
  },
  heading: { display: "flex", alignItems: "center", gap: space.sm, flexWrap: "wrap" },
  title: { margin: 0, fontSize: font.body, fontWeight: font.weightBold, color: text.default },
  off: { fontSize: font.caption, color: text.muted },
  description: { margin: 0, fontSize: font.body, color: text.muted },
  band: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    columnGap: space.sm,
    rowGap: space.xs,
    marginTop: space.xs,
    padding: space.inset,
    borderRadius: radius.item,
    backgroundColor: status.successSurface,
    fontSize: font.caption,
    color: text.default,
  },
  bandIcon: { display: "inline-flex", flexShrink: 0, color: status.success },
  bandLink: {
    borderRadius: radius.small,
    color: text.default,
    textDecoration: { default: "underline", ":hover": "none" },
    cursor: "pointer",
    outline: "none",
  },
  bandFocus: {
    outlineWidth: stroke.focus,
    outlineStyle: "solid",
    outlineColor: focus.ring,
    outlineOffset: stroke.focus,
  },
  action: { flexShrink: 0 },
});

export function ModuleCard({
  module,
  addLinks,
  justEnabled,
  onEnable,
  onDisable,
  isBusy,
}: {
  module: ModuleSummary;
  addLinks: { key: string; label: string; href: string }[];
  justEnabled: boolean;
  onEnable: () => void;
  onDisable: () => void;
  isBusy?: boolean;
}) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} {...stylex.props(styles.card)}>
      <span
        aria-hidden="true"
        {...stylex.props(styles.icon, module.enabled ? styles.iconOn : styles.iconOff)}
      >
        <Puzzle size={ICON_SIZE.nav} />
      </span>
      <div {...stylex.props(styles.main)}>
        <div {...stylex.props(styles.heading)}>
          <h2 id={headingId} {...stylex.props(styles.title)}>
            {module.name}
          </h2>
          {module.enabled ? (
            <Badge tone="success" dot>
              {MODULE_LABELS.enabled}
            </Badge>
          ) : (
            <span {...stylex.props(styles.off)}>{MODULE_LABELS.disabled}</span>
          )}
        </div>
        {module.description === null ? null : (
          <p {...stylex.props(styles.description)}>{module.description}</p>
        )}
        {justEnabled && module.enabled ? (
          <div role="status" {...stylex.props(styles.band)}>
            <span {...stylex.props(styles.bandIcon)}>
              <CircleCheck size={ICON_SIZE.inline} aria-hidden="true" />
            </span>
            <span>{MODULE_LABELS.justEnabled}</span>
            {addLinks.map((link) => (
              <Link
                key={link.key}
                href={link.href}
                className={stylexRenderProps<LinkRenderProps>((state) => [
                  styles.bandLink,
                  state.isFocusVisible && styles.bandFocus,
                ])}
              >
                {link.label} ›
              </Link>
            ))}
          </div>
        ) : null}
      </div>
      <div {...stylex.props(styles.action)}>
        {module.enabled ? (
          <Button variant="secondary" isDisabled={isBusy === true} onPress={onDisable}>
            {MODULE_LABELS.disable}
          </Button>
        ) : (
          <Button variant="primary" isDisabled={isBusy === true} onPress={onEnable}>
            {MODULE_LABELS.enable}
          </Button>
        )}
      </div>
    </section>
  );
}
