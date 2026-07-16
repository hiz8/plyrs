import * as stylex from "@stylexjs/stylex";
import {
  Button as RacButton,
  type ButtonProps as RacButtonProps,
  type ButtonRenderProps,
} from "react-aria-components";
import { stylexRenderProps } from "./compose";
import { colors, spacing, typography } from "./tokens.stylex";

const styles = stylex.create({
  base: {
    fontFamily: typography.fontFamily,
    fontSize: typography.sizeMd,
    paddingBlock: spacing.xs,
    paddingInline: spacing.md,
    borderRadius: "6px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: "transparent",
    cursor: "pointer",
    outline: "none",
  },
  primary: {
    backgroundColor: colors.accent,
    color: colors.accentText,
  },
  secondary: {
    backgroundColor: colors.surface,
    color: colors.text,
    borderColor: colors.border,
  },
  danger: {
    backgroundColor: colors.danger,
    color: colors.accentText,
  },
  hovered: { opacity: 0.9 },
  pressed: { opacity: 0.8 },
  focusVisible: {
    outlineWidth: "2px",
    outlineStyle: "solid",
    outlineColor: colors.focusRing,
    outlineOffset: "2px",
  },
  disabled: { opacity: 0.5, cursor: "default" },
});

export type ButtonVariant = "primary" | "secondary" | "danger";

export interface ButtonProps extends Omit<RacButtonProps, "className" | "style"> {
  variant?: ButtonVariant;
}

export function Button({ variant = "primary", ...props }: ButtonProps) {
  return (
    <RacButton
      {...props}
      className={stylexRenderProps<ButtonRenderProps>((state) => [
        styles.base,
        styles[variant],
        state.isHovered && styles.hovered,
        state.isPressed && styles.pressed,
        state.isFocusVisible && styles.focusVisible,
        state.isDisabled && styles.disabled,
      ])}
    />
  );
}
