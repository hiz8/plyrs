import * as stylex from "@stylexjs/stylex";
import { Check, Minus } from "lucide-react";
import { useId, type ReactNode } from "react";
import { Checkbox as RacCheckbox, type CheckboxRenderProps } from "react-aria-components";
import { stylexRenderProps } from "./compose";
import {
  accent,
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

// D1 ボード 3b。箱はキャンバスの 18px を 16px に寄せた(表の中の箱と同じ大きさ)
const BOX = "16px";
const MARK = 12;

const styles = stylex.create({
  root: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.sm,
    minHeight: size.controlSm,
    fontFamily: font.family,
    fontSize: font.body,
    color: text.default,
    cursor: "pointer",
  },
  rootDisabled: { opacity: 0.5, cursor: "not-allowed" },
  rootReadOnly: { cursor: "default" },
  box: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    boxSizing: "border-box",
    width: BOX,
    height: BOX,
    color: text.onAccent,
    backgroundColor: bg.canvas,
    borderWidth: stroke.default,
    borderStyle: "solid",
    borderColor: border.hover,
    borderRadius: radius.small,
  },
  withDescription: { display: "flex", flexDirection: "column", gap: space.xxs },
  description: {
    margin: 0,
    // 箱の幅 + gap より少し右へ寄せ、文の頭に揃える
    paddingInlineStart: space.xl,
    fontFamily: font.family,
    fontSize: font.caption,
    color: text.muted,
  },
  boxHovered: { borderColor: text.muted },
  boxFilled: { backgroundColor: accent.default, borderColor: accent.default },
  boxInvalid: { borderColor: status.danger },
  boxFocus: {
    outlineWidth: stroke.focus,
    outlineStyle: "solid",
    outlineColor: focus.ring,
    outlineOffset: stroke.focus,
  },
});

type BoxState = Pick<
  CheckboxRenderProps,
  "isSelected" | "isIndeterminate" | "isHovered" | "isFocusVisible" | "isInvalid"
>;

/** 箱だけの描画。表の選択列(table.tsx)も使う */
export function CheckboxBox({
  isSelected,
  isIndeterminate,
  isHovered,
  isFocusVisible,
  isInvalid,
}: BoxState) {
  return (
    <span
      aria-hidden="true"
      {...stylex.props(
        styles.box,
        isHovered && styles.boxHovered,
        (isSelected || isIndeterminate) && styles.boxFilled,
        isInvalid && styles.boxInvalid,
        isFocusVisible && styles.boxFocus,
      )}
    >
      {isIndeterminate ? (
        <Minus size={MARK} strokeWidth={3} />
      ) : isSelected ? (
        <Check size={MARK} strokeWidth={3} />
      ) : null}
    </span>
  );
}

export interface CheckboxProps {
  children: ReactNode;
  isSelected: boolean;
  onChange: (isSelected: boolean) => void;
  isDisabled?: boolean;
  /** 一部選択(表の見出しの全選択など) */
  isIndeterminate?: boolean;
  isInvalid?: boolean;
  /** 閲覧者向け。箱はそのまま、押しても変わらない(RAC が aria-readonly を付ける) */
  isReadOnly?: boolean;
  /** 箱の文の下に出す補足(font.caption / text.muted)。aria-describedby で入力に結ぶ。ラベルの外に置くので、補足の文字を押しても切り替わらない */
  description?: string;
}

export function Checkbox({
  children,
  isSelected,
  onChange,
  isDisabled,
  isIndeterminate,
  isInvalid,
  isReadOnly,
  description,
}: CheckboxProps) {
  const descId = useId();
  const box = (
    <RacCheckbox
      isSelected={isSelected}
      onChange={onChange}
      isDisabled={isDisabled ?? false}
      isIndeterminate={isIndeterminate ?? false}
      isInvalid={isInvalid ?? false}
      isReadOnly={isReadOnly ?? false}
      {...(description !== undefined ? { "aria-describedby": descId } : {})}
      className={stylexRenderProps<CheckboxRenderProps>((state) => [
        styles.root,
        state.isDisabled && styles.rootDisabled,
        state.isReadOnly && styles.rootReadOnly,
      ])}
    >
      {(state) => (
        <>
          <CheckboxBox {...state} />
          {children}
        </>
      )}
    </RacCheckbox>
  );
  if (description === undefined) return box;
  return (
    <div {...stylex.props(styles.withDescription)}>
      {box}
      <p id={descId} {...stylex.props(styles.description)}>
        {description}
      </p>
    </div>
  );
}
