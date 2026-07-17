import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import { Checkbox as RacCheckbox, type CheckboxRenderProps } from "react-aria-components";
import { stylexRenderProps } from "./compose";
import { colors, spacing, typography } from "./tokens.stylex";

const styles = stylex.create({
  root: {
    display: "flex",
    alignItems: "center",
    gap: spacing.xs,
    fontFamily: typography.fontFamily,
    fontSize: typography.sizeMd,
    color: colors.text,
    cursor: "pointer",
  },
  rootDisabled: { color: colors.textMuted, cursor: "not-allowed" },
});

export interface CheckboxProps {
  children: ReactNode;
  isSelected: boolean;
  onChange: (isSelected: boolean) => void;
  isDisabled?: boolean;
}

export function Checkbox({ children, isSelected, onChange, isDisabled }: CheckboxProps) {
  return (
    <RacCheckbox
      isSelected={isSelected}
      onChange={onChange}
      isDisabled={isDisabled ?? false}
      className={stylexRenderProps<CheckboxRenderProps>((state) => [
        styles.root,
        state.isDisabled && styles.rootDisabled,
      ])}
    >
      {({ isSelected: selected }) => (
        <>
          <span aria-hidden="true">{selected ? "☑" : "☐"}</span>
          {children}
        </>
      )}
    </RacCheckbox>
  );
}
