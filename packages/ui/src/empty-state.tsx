import * as stylex from "@stylexjs/stylex";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { ICON_SIZE, ICON_STROKE } from "./icon";
import { bg, border, font, radius, space, stroke, text } from "./semantic.stylex";

// D1 ボード 3e。アイコンは 12 章の 32px(線幅 1.75)を 64px の円に置く。
// compact は閲覧者向けなど、アイコンもボタンも無い小さい表示
const styles = stylex.create({
  root: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    textAlign: "center",
    gap: space.sm,
    paddingBlock: space.xl,
    paddingInline: space.lg,
    fontFamily: font.family,
    borderWidth: stroke.default,
    borderStyle: "dashed",
    borderColor: border.default,
    borderRadius: radius.container,
  },
  iconCircle: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "64px",
    height: "64px",
    borderRadius: radius.full,
    backgroundColor: bg.surface,
    color: text.muted,
  },
  title: { margin: 0, fontSize: font.label, fontWeight: font.weightBold, color: text.default },
  titleCompact: { fontSize: font.body },
  description: { margin: 0, maxWidth: "320px", fontSize: font.body, color: text.muted },
  action: { marginTop: space.sm },
});

export interface EmptyStateProps {
  title: string;
  description?: ReactNode;
  icon?: LucideIcon;
  /** 塗りのボタン、または「絞り込みを解除」のテキストリンク */
  action?: ReactNode;
  size?: "default" | "compact";
}

export function EmptyState({
  title,
  description,
  icon: Icon,
  action,
  size = "default",
}: EmptyStateProps) {
  return (
    <div {...stylex.props(styles.root)}>
      {Icon !== undefined && (
        <span {...stylex.props(styles.iconCircle)}>
          <Icon size={ICON_SIZE.empty} strokeWidth={ICON_STROKE.large} aria-hidden="true" />
        </span>
      )}
      <p {...stylex.props(styles.title, size === "compact" && styles.titleCompact)}>{title}</p>
      {description !== undefined && <p {...stylex.props(styles.description)}>{description}</p>}
      {action !== undefined && <div {...stylex.props(styles.action)}>{action}</div>}
    </div>
  );
}
