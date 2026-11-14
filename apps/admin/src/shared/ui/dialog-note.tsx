import * as stylex from "@stylexjs/stylex";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { ICON_SIZE } from "@plyrs/ui";
import { accent, font, radius, space, status, text } from "@plyrs/ui/semantic.stylex";

const styles = stylex.create({
  note: {
    display: "flex",
    alignItems: "flex-start",
    gap: space.sm,
    padding: space.inset,
    borderRadius: radius.item,
    fontSize: font.caption,
    color: text.default,
  },
  warning: { backgroundColor: status.warningSurface },
  danger: { backgroundColor: status.dangerSurface },
  accent: { backgroundColor: accent.surface },
  icon: { display: "inline-flex", flexShrink: 0 },
  warningIcon: { color: status.warning },
  dangerIcon: { color: status.danger },
  accentIcon: { color: accent.default },
  body: { flex: 1, minWidth: 0 },
});

// ダイアログ内のコンパクトな注記(Banner はページ上部用なのでここでは使わない)
export function DialogNote({
  tone,
  icon: Icon,
  children,
  role,
}: {
  tone: "warning" | "danger" | "accent";
  icon?: LucideIcon;
  children: ReactNode;
  role?: "alert" | "status";
}) {
  return (
    <div role={role} {...stylex.props(styles.note, styles[tone])}>
      {Icon === undefined ? null : (
        <span {...stylex.props(styles.icon, styles[`${tone}Icon`])}>
          <Icon size={ICON_SIZE.inline} aria-hidden="true" />
        </span>
      )}
      <div {...stylex.props(styles.body)}>{children}</div>
    </div>
  );
}
