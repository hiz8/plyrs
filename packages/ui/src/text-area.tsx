import * as stylex from "@stylexjs/stylex";
import {
  TextArea as RacTextArea,
  TextField as RacTextField,
  type InputRenderProps,
} from "react-aria-components";
import { stylexRenderProps } from "./compose";
import { FieldErrorMessage, FieldLabel, fieldClassName } from "./field";
import { bg, border, focus, font, radius, space, status, stroke, text } from "./semantic.stylex";

const styles = stylex.create({
  area: {
    // 部品固有の最小高(D1 ボード 3b)
    minHeight: "96px",
    paddingBlock: space.sm,
    paddingInline: space.inset,
    fontFamily: font.family,
    fontSize: font.body,
    lineHeight: font.lineHeightNormal,
    color: text.default,
    backgroundColor: bg.canvas,
    borderWidth: stroke.default,
    borderStyle: "solid",
    borderColor: border.default,
    borderRadius: radius.control,
    outline: "none",
    resize: "vertical",
  },
  hovered: { borderColor: border.hover },
  invalid: { borderColor: status.danger },
  focused: {
    outlineWidth: stroke.focus,
    outlineStyle: "solid",
    outlineColor: focus.ring,
    outlineOffset: stroke.focus,
  },
  disabled: { opacity: 0.5, backgroundColor: bg.surface, cursor: "not-allowed" },
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
      className={fieldClassName()}
    >
      <FieldLabel isRequired={isRequired}>{label}</FieldLabel>
      <RacTextArea
        rows={rows ?? 6}
        className={stylexRenderProps<InputRenderProps>((state) => [
          styles.area,
          state.isHovered && styles.hovered,
          state.isInvalid && styles.invalid,
          state.isFocused && styles.focused,
          state.isDisabled && styles.disabled,
        ])}
      />
      <FieldErrorMessage errorMessage={errorMessage} />
    </RacTextField>
  );
}
