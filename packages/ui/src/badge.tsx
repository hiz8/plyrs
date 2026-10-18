import * as stylex from "@stylexjs/stylex";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { ICON_SIZE } from "./icon";
import { accent, bg, border, font, radius, space, status, stroke, text } from "./semantic.stylex";

// D1 ボード 3d。radius.badge(4px)の長方形で、pill のボタンと形で区別する(案 R)。
// 色だけで状態を伝えないよう、文字は必ず出す(h-common-surface.md 11 章)
const styles = stylex.create({
  badge: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.xs,
    paddingBlock: space.xxs,
    paddingInline: space.sm,
    fontFamily: font.family,
    fontSize: font.caption,
    fontWeight: font.weightMedium,
    lineHeight: font.lineHeightNormal,
    whiteSpace: "nowrap",
    borderWidth: stroke.default,
    borderStyle: "solid",
    borderColor: "transparent",
    borderRadius: radius.badge,
  },
  neutral: { backgroundColor: bg.surface, color: text.muted, borderColor: border.default },
  accent: { backgroundColor: accent.surface, color: accent.default },
  success: { backgroundColor: status.successSurface, color: status.success },
  warning: { backgroundColor: status.warningSurface, color: status.warning },
  danger: { backgroundColor: status.dangerSurface, color: status.danger },
  struck: { textDecoration: "line-through" },
  mono: { fontFamily: font.familyMono },
  // h-common-surface.md 12 章: 公開状態は 6px の点を基本にする
  dot: {
    width: "6px",
    height: "6px",
    flexShrink: 0,
    borderRadius: radius.full,
    backgroundColor: "currentColor",
  },
});

export type BadgeTone = "neutral" | "accent" | "success" | "warning" | "danger";

export interface BadgeProps {
  tone?: BadgeTone;
  /** 公開状態の 6px の点 */
  dot?: boolean;
  /** アイコン付きは公開ボックスの大きい表示でだけ使う(12 章) */
  icon?: LucideIcon;
  /** アーカイブの取り消し線 */
  isStruck?: boolean;
  /** 識別子の表示 */
  isMonospace?: boolean;
  children: ReactNode;
}

export function Badge({
  tone = "neutral",
  dot,
  icon: Icon,
  isStruck,
  isMonospace,
  children,
}: BadgeProps) {
  return (
    <span
      {...stylex.props(
        styles.badge,
        styles[tone],
        isStruck === true && styles.struck,
        isMonospace === true && styles.mono,
      )}
    >
      {dot === true && <span aria-hidden="true" {...stylex.props(styles.dot)} />}
      {Icon !== undefined && <Icon size={ICON_SIZE.inline} aria-hidden="true" />}
      {children}
    </span>
  );
}
