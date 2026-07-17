import * as stylex from "@stylexjs/stylex";
import {
  FieldError,
  Label,
  TextArea as RacTextArea,
  TextField as RacTextField,
  type InputRenderProps,
} from "react-aria-components";
import { stylexRenderProps } from "./compose";
import { colors, spacing, typography } from "./tokens.stylex";

const styles = stylex.create({
  field: {
    display: "flex",
    flexDirection: "column",
    gap: spacing.xs,
    fontFamily: typography.fontFamily,
  },
  label: { fontSize: typography.sizeSm, color: colors.textMuted },
  area: {
    fontSize: typography.sizeMd,
    fontFamily: typography.fontFamily,
    paddingBlock: spacing.xs,
    paddingInline: spacing.sm,
    borderRadius: "6px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: colors.border,
    backgroundColor: colors.bg,
    color: colors.text,
    outline: "none",
    resize: "vertical",
  },
  areaFocused: { borderColor: colors.focusRing },
  error: { fontSize: typography.sizeSm, color: colors.danger },
});

export interface TextAreaProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  errorMessage?: string;
  isInvalid?: boolean;
  isRequired?: boolean;
  isDisabled?: boolean;
}

export function TextArea({
  label,
  value,
  onChange,
  rows,
  errorMessage,
  isInvalid,
  isRequired,
  isDisabled,
}: TextAreaProps) {
  return (
    <RacTextField
      value={value}
      onChange={onChange}
      isInvalid={isInvalid ?? false}
      isRequired={isRequired ?? false}
      isDisabled={isDisabled ?? false}
      className={stylex.props(styles.field).className ?? ""}
    >
      <Label className={stylex.props(styles.label).className ?? ""}>{label}</Label>
      <RacTextArea
        rows={rows ?? 6}
        className={stylexRenderProps<InputRenderProps>((state) => [
          styles.area,
          state.isFocused && styles.areaFocused,
        ])}
      />
      <FieldError className={stylex.props(styles.error).className ?? ""}>{errorMessage}</FieldError>
    </RacTextField>
  );
}
