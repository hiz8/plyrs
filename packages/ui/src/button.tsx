import * as stylex from "@stylexjs/stylex";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import {
  Button as RacButton,
  type ButtonProps as RacButtonProps,
  type ButtonRenderProps,
} from "react-aria-components";
import { stylexRenderProps } from "./compose";
import { ICON_SIZE } from "./icon";
import {
  accent,
  bg,
  border,
  focus,
  font,
  motion,
  radius,
  size,
  space,
  status,
  stroke,
  text,
} from "./semantic.stylex";
import { Tooltip } from "./tooltip";

// D1 ボード 3a: 塗り / 枠線 / 危険 / テキストリンク(+ 危険色)と、アイコンのみのゴースト(IconButton)。
// 角丸はすべて radius.button(案 R)。危険の押下はキャンバスの inset 影を採らず dangerHover だけにした
// (h-design-tokens.md 3.1 の用途「危険ボタンのホバー・押下」)
const styles = stylex.create({
  base: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: space.sm,
    height: size.control,
    paddingInline: space.md,
    fontFamily: font.family,
    fontSize: font.body,
    fontWeight: font.weightMedium,
    lineHeight: 1,
    whiteSpace: "nowrap",
    textDecoration: "none",
    borderWidth: stroke.default,
    borderStyle: "solid",
    borderColor: "transparent",
    borderRadius: radius.button,
    cursor: "pointer",
    outline: "none",
    transitionProperty: "background-color, border-color, color",
    transitionDuration: motion.fast,
  },
  sm: { height: size.controlSm, paddingInline: space.inset, fontSize: font.caption },
  primary: { backgroundColor: accent.default, color: text.onAccent },
  primaryHovered: { backgroundColor: accent.hover },
  primaryPressed: { backgroundColor: accent.active },
  secondary: { backgroundColor: bg.canvas, color: text.default, borderColor: border.default },
  secondaryHovered: { backgroundColor: bg.hover, borderColor: border.hover },
  secondaryPressed: { backgroundColor: bg.pressed, borderColor: border.hover },
  danger: { backgroundColor: status.danger, color: text.onAccent },
  dangerHovered: { backgroundColor: status.dangerHover },
  dangerPressed: { backgroundColor: status.dangerHover },
  link: {
    height: "auto",
    paddingBlock: space.xxs,
    paddingInline: space.xs,
    borderRadius: radius.small,
    backgroundColor: "transparent",
    color: accent.default,
  },
  linkHovered: { color: accent.hover, textDecoration: "underline" },
  linkPressed: { color: accent.active, textDecoration: "underline" },
  dangerLink: {
    height: "auto",
    paddingBlock: space.xxs,
    paddingInline: space.xs,
    borderRadius: radius.small,
    backgroundColor: "transparent",
    color: status.danger,
  },
  dangerLinkHovered: { color: status.dangerHover, textDecoration: "underline" },
  ghost: { backgroundColor: "transparent", color: text.muted, paddingInline: 0 },
  ghostHovered: { backgroundColor: bg.hover, color: text.default },
  ghostPressed: { backgroundColor: bg.pressed, color: text.default },
  iconMd: { width: size.control },
  iconSm: { width: size.controlSm, height: size.controlSm },
  focusVisible: {
    outlineWidth: stroke.focus,
    outlineStyle: "solid",
    outlineColor: focus.ring,
    outlineOffset: stroke.focus,
  },
  disabled: { opacity: 0.5, cursor: "not-allowed" },
});

export type ButtonVariant = "primary" | "secondary" | "danger" | "link" | "dangerLink";
export type ButtonSize = "md" | "sm";

const VARIANT_STYLES = {
  primary: [styles.primary, styles.primaryHovered, styles.primaryPressed],
  secondary: [styles.secondary, styles.secondaryHovered, styles.secondaryPressed],
  danger: [styles.danger, styles.dangerHovered, styles.dangerPressed],
  link: [styles.link, styles.linkHovered, styles.linkPressed],
  dangerLink: [styles.dangerLink, styles.dangerLinkHovered, styles.dangerLinkHovered],
} as const;

export interface ButtonProps extends Omit<RacButtonProps, "className" | "style" | "children"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** 文字の左に置く Lucide のアイコン(装飾。読み上げない) */
  icon?: LucideIcon;
  children?: ReactNode;
}

export function Button({
  variant = "primary",
  size: buttonSize = "md",
  icon: Icon,
  children,
  ...props
}: ButtonProps) {
  const [normal, hovered, pressed] = VARIANT_STYLES[variant];
  return (
    <RacButton
      {...props}
      className={stylexRenderProps<ButtonRenderProps>((state) => [
        styles.base,
        buttonSize === "sm" && styles.sm,
        normal,
        state.isHovered && hovered,
        state.isPressed && pressed,
        state.isFocusVisible && styles.focusVisible,
        state.isDisabled && styles.disabled,
      ])}
    >
      {Icon !== undefined && <Icon size={ICON_SIZE.inline} aria-hidden="true" />}
      {children}
    </RacButton>
  );
}

export interface IconButtonProps extends Omit<
  RacButtonProps,
  "className" | "style" | "children" | "aria-label"
> {
  icon: LucideIcon;
  /** aria-label とツールチップの文言(h-common-surface.md 12 章: アイコンのみのボタンは必須) */
  label: string;
  size?: ButtonSize;
}

export function IconButton({
  icon: Icon,
  label,
  size: buttonSize = "md",
  ...props
}: IconButtonProps) {
  return (
    <Tooltip content={label}>
      <RacButton
        {...props}
        aria-label={label}
        className={stylexRenderProps<ButtonRenderProps>((state) => [
          styles.base,
          styles.ghost,
          buttonSize === "sm" ? styles.iconSm : styles.iconMd,
          state.isHovered && styles.ghostHovered,
          state.isPressed && styles.ghostPressed,
          state.isFocusVisible && styles.focusVisible,
          state.isDisabled && styles.disabled,
        ])}
      >
        <Icon size={ICON_SIZE.inline} aria-hidden="true" />
      </RacButton>
    </Tooltip>
  );
}
