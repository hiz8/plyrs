import * as stylex from "@stylexjs/stylex";
import type { LucideIcon } from "lucide-react";
import { Radio, RadioGroup, type RadioRenderProps } from "react-aria-components";
import { stylexRenderProps } from "./compose";
import { ICON_SIZE } from "./icon";
import {
  accent,
  bg,
  border,
  focus,
  font,
  radius,
  size,
  space,
  stroke,
  text,
} from "./semantic.stylex";

// 案 G 6.2 / 裁定 G2: 3 択のテーマ切り替え用。外枠 pill の中に内側のボタン pill を並べ、
// 選択中は accent.surface / accent.default で示す。
const styles = stylex.create({
  group: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.xs,
    height: size.control,
    boxSizing: "border-box",
    padding: "3px",
    fontFamily: font.family,
    backgroundColor: bg.canvas,
    borderWidth: stroke.default,
    borderStyle: "solid",
    borderColor: border.default,
    borderRadius: radius.full,
  },
  item: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.xs,
    height: size.controlSm,
    paddingInline: space.inset,
    fontSize: font.body,
    fontWeight: font.weightMedium,
    color: text.muted,
    backgroundColor: "transparent",
    borderRadius: radius.full,
    cursor: "pointer",
    outline: "none",
    whiteSpace: "nowrap",
  },
  hovered: { backgroundColor: bg.hover },
  selected: { color: accent.default, backgroundColor: accent.surface },
  readOnly: { cursor: "default" },
  disabled: { opacity: 0.5, cursor: "not-allowed" },
  focusVisible: {
    outlineWidth: stroke.focus,
    outlineStyle: "solid",
    outlineColor: focus.ring,
    outlineOffset: stroke.focus,
  },
});

export interface SegmentedItem {
  value: string;
  label: string;
  icon?: LucideIcon;
}

export interface SegmentedControlProps {
  /** RadioGroup の aria-label(例: テーマ) */
  label: string;
  items: SegmentedItem[];
  value: string;
  onChange: (value: string) => void;
  isDisabled?: boolean;
  /** 閲覧者向け。見た目は通常のまま(isDisabled と違い薄くしない)、選択は変わらず aria-readonly を付ける */
  isReadOnly?: boolean;
}

export function SegmentedControl({
  label,
  items,
  value,
  onChange,
  isDisabled,
  isReadOnly,
}: SegmentedControlProps) {
  return (
    <RadioGroup
      aria-label={label}
      orientation="horizontal"
      value={value}
      onChange={onChange}
      isDisabled={isDisabled}
      isReadOnly={isReadOnly ?? false}
      className={stylex.props(styles.group).className ?? ""}
    >
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <Radio
            key={item.value}
            value={item.value}
            className={stylexRenderProps<RadioRenderProps>((state) => [
              styles.item,
              state.isHovered && !state.isSelected && styles.hovered,
              state.isSelected && styles.selected,
              state.isReadOnly && styles.readOnly,
              state.isDisabled && styles.disabled,
              state.isFocusVisible && styles.focusVisible,
            ])}
          >
            {Icon && <Icon size={ICON_SIZE.inline} aria-hidden="true" />}
            {item.label}
          </Radio>
        );
      })}
    </RadioGroup>
  );
}
