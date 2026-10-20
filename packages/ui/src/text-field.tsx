import * as stylex from "@stylexjs/stylex";
import {
  Input,
  TextField as RacTextField,
  type InputRenderProps,
  type TextFieldProps as RacTextFieldProps,
  type ValidationResult,
} from "react-aria-components";
import { stylexRenderProps } from "./compose";
import { FieldDescription, FieldErrorMessage, FieldLabel, fieldClassName } from "./field";
import {
  bg,
  border,
  focus,
  font,
  radius,
  size,
  space,
  status,
  stroke,
  text,
} from "./semantic.stylex";

// D1 ボード 3b。フォーカスは focus.ring だけで示し、枠線の色は通常 / ホバー / エラーの区別に使う
const styles = stylex.create({
  input: {
    height: size.control,
    paddingInline: space.inset,
    fontFamily: font.family,
    fontSize: font.body,
    color: text.default,
    backgroundColor: bg.canvas,
    borderWidth: stroke.default,
    borderStyle: "solid",
    borderColor: border.default,
    borderRadius: radius.control,
    outline: "none",
    "::placeholder": { color: text.muted },
  },
  mono: { fontFamily: font.familyMono },
  hovered: { borderColor: border.hover },
  invalid: { borderColor: status.danger },
  focused: {
    outlineWidth: stroke.focus,
    outlineStyle: "solid",
    outlineColor: focus.ring,
    outlineOffset: stroke.focus,
  },
  disabled: { opacity: 0.5, backgroundColor: bg.surface, cursor: "not-allowed" },
  // 閲覧者向け: 枠線を消して下罫線だけにし、地は透明にする
  readOnly: {
    paddingInline: 0,
    backgroundColor: "transparent",
    borderTopWidth: 0,
    borderInlineWidth: 0,
    borderBottomWidth: stroke.default,
    borderRadius: 0,
    cursor: "default",
  },
});

export interface TextFieldProps extends Omit<RacTextFieldProps, "className" | "style"> {
  label: string;
  /** 入力欄の空欄時に薄く表示する記入例(react-aria の Input へそのまま渡る)。 */
  placeholder?: string;
  /** ラベル直下に表示する短い補足説明(react-aria の description スロット経由)。 */
  description?: string;
  errorMessage?: string | ((validation: ValidationResult) => string);
  /** 識別子(スラッグ・API で使う名前)の入力欄は等幅にする(D1 ボード 3b) */
  isMonospace?: boolean;
}

export function TextField({
  label,
  placeholder,
  description,
  errorMessage,
  isMonospace,
  ...props
}: TextFieldProps) {
  return (
    <RacTextField {...props} className={fieldClassName()}>
      <FieldLabel isRequired={props.isRequired}>{label}</FieldLabel>
      <Input
        placeholder={placeholder}
        className={stylexRenderProps<InputRenderProps>((state) => [
          styles.input,
          isMonospace === true && styles.mono,
          state.isHovered && styles.hovered,
          state.isInvalid && styles.invalid,
          state.isFocused && styles.focused,
          state.isDisabled && styles.disabled,
          props.isReadOnly === true && styles.readOnly,
        ])}
      />
      {description !== undefined && <FieldDescription>{description}</FieldDescription>}
      <FieldErrorMessage errorMessage={errorMessage} />
    </RacTextField>
  );
}
