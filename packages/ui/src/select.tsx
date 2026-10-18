import * as stylex from "@stylexjs/stylex";
import { Check, ChevronsUpDown } from "lucide-react";
import {
  Button as RacButton,
  ListBox,
  ListBoxItem,
  Popover,
  Select as RacSelect,
  SelectValue,
  type ListBoxItemRenderProps,
} from "react-aria-components";
import { stylexRenderProps } from "./compose";
import { FieldErrorText, FieldLabel, fieldClassName } from "./field";
import { ICON_SIZE } from "./icon";
import {
  accent,
  bg,
  border,
  elevation,
  focus,
  font,
  layer,
  radius,
  size,
  space,
  status,
  stroke,
  text,
} from "./semantic.stylex";

// D1 ボード 3b。候補の一覧は浮いた面(bg.raised + 枠線 + elevation.menu)
const styles = stylex.create({
  trigger: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.sm,
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
    cursor: "pointer",
    outline: "none",
    textAlign: "start",
  },
  triggerHovered: { borderColor: border.hover },
  triggerInvalid: { borderColor: status.danger },
  triggerFocused: {
    outlineWidth: stroke.focus,
    outlineStyle: "solid",
    outlineColor: focus.ring,
    outlineOffset: stroke.focus,
  },
  triggerDisabled: { opacity: 0.5, backgroundColor: bg.surface, cursor: "not-allowed" },
  chevron: { color: text.muted, flexShrink: 0 },
  popover: {
    minWidth: "var(--trigger-width)",
    padding: space.xs,
    backgroundColor: bg.raised,
    borderWidth: stroke.default,
    borderStyle: "solid",
    borderColor: border.default,
    borderRadius: radius.container,
    boxShadow: elevation.menu,
    zIndex: layer.dropdown,
    outline: "none",
  },
  listBox: { outline: "none" },
  item: {
    display: "flex",
    alignItems: "center",
    gap: space.sm,
    minHeight: size.control,
    paddingInline: space.inset,
    borderRadius: radius.item,
    fontFamily: font.family,
    fontSize: font.body,
    color: text.default,
    cursor: "pointer",
    outline: "none",
  },
  itemFocused: { backgroundColor: bg.hover },
  // 選択中は文字と check で示し、地は塗らない(D1 ボード 3b)
  itemSelected: { color: accent.default, fontWeight: font.weightMedium },
  checkSlot: { display: "inline-flex", width: "16px", flexShrink: 0 },
});

export interface SelectProps {
  label: string;
  items: { value: string; label: string }[];
  /** 空文字 = 未選択（placeholder 表示） */
  selectedValue: string;
  onChange: (value: string) => void;
  placeholder?: string;
  isDisabled?: boolean;
  errorMessage?: string;
}

export function Select({
  label,
  items,
  selectedValue,
  onChange,
  placeholder,
  isDisabled,
  errorMessage,
}: SelectProps) {
  const isInvalid = errorMessage !== undefined;
  return (
    <RacSelect
      selectedKey={selectedValue === "" ? null : selectedValue}
      onSelectionChange={(key) => onChange(key === null ? "" : String(key))}
      isDisabled={isDisabled ?? false}
      isInvalid={isInvalid}
      placeholder={placeholder ?? "選択してください"}
      className={fieldClassName()}
    >
      {({ isOpen, isFocusVisible, isDisabled: disabled }) => (
        <>
          <FieldLabel>{label}</FieldLabel>
          <RacButton
            className={stylexRenderProps<{ isHovered: boolean }>((state) => [
              styles.trigger,
              state.isHovered && styles.triggerHovered,
              isInvalid && styles.triggerInvalid,
              (isOpen || isFocusVisible) && styles.triggerFocused,
              disabled && styles.triggerDisabled,
            ])}
          >
            <SelectValue />
            <ChevronsUpDown
              size={ICON_SIZE.inline}
              aria-hidden="true"
              {...stylex.props(styles.chevron)}
            />
          </RacButton>
          {isInvalid && <FieldErrorText slot="errorMessage">{errorMessage}</FieldErrorText>}
          <Popover offset={2} className={stylex.props(styles.popover).className ?? ""}>
            <ListBox className={stylex.props(styles.listBox).className ?? ""}>
              {items.map((item) => (
                <ListBoxItem
                  key={item.value}
                  id={item.value}
                  textValue={item.label}
                  className={stylexRenderProps<ListBoxItemRenderProps>((state) => [
                    styles.item,
                    (state.isFocused || state.isHovered) && styles.itemFocused,
                    state.isSelected && styles.itemSelected,
                  ])}
                >
                  {({ isSelected }) => (
                    <>
                      <span {...stylex.props(styles.checkSlot)}>
                        {isSelected && <Check size={ICON_SIZE.inline} aria-hidden="true" />}
                      </span>
                      {item.label}
                    </>
                  )}
                </ListBoxItem>
              ))}
            </ListBox>
          </Popover>
        </>
      )}
    </RacSelect>
  );
}
