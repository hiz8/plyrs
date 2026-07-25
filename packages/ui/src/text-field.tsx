import * as stylex from "@stylexjs/stylex";
import {
  FieldError,
  Input,
  Label,
  Text,
  TextField as RacTextField,
  type InputRenderProps,
  type TextFieldProps as RacTextFieldProps,
  type ValidationResult,
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
  input: {
    fontSize: typography.sizeMd,
    paddingBlock: spacing.xs,
    paddingInline: spacing.sm,
    borderRadius: "6px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: colors.border,
    backgroundColor: colors.bg,
    color: colors.text,
    outline: "none",
  },
  inputFocused: { borderColor: colors.focusRing },
  description: { fontSize: typography.sizeSm, color: colors.textMuted },
  error: { fontSize: typography.sizeSm, color: colors.danger },
});

export interface TextFieldProps extends Omit<RacTextFieldProps, "className" | "style"> {
  label: string;
  /** 入力欄の空欄時に薄く表示する記入例(react-aria の Input へそのまま渡る)。 */
  placeholder?: string;
  /** ラベル直下に表示する短い補足説明(react-aria の description スロット経由)。 */
  description?: string;
  errorMessage?: string | ((validation: ValidationResult) => string);
}

export function TextField({
  label,
  placeholder,
  description,
  errorMessage,
  ...props
}: TextFieldProps) {
  return (
    <RacTextField {...props} className={stylex.props(styles.field).className ?? ""}>
      <Label className={stylex.props(styles.label).className ?? ""}>{label}</Label>
      <Input
        placeholder={placeholder}
        className={stylexRenderProps<InputRenderProps>((state) => [
          styles.input,
          state.isFocused && styles.inputFocused,
        ])}
      />
      {description !== undefined && (
        <Text slot="description" className={stylex.props(styles.description).className ?? ""}>
          {description}
        </Text>
      )}
      <FieldError className={stylex.props(styles.error).className ?? ""}>{errorMessage}</FieldError>
    </RacTextField>
  );
}
