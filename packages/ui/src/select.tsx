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
    // react-aria の useOverlayPosition が inline の style に zIndex: 100000 を書くため、実際の重なり順は
    // その値になり、この layer.dropdown は上書きされる。将来 inline の値が外れたときの拠り所として残す
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
  // sm: 公開ボックスなどの 28px セレクト
  triggerSm: {
    height: size.controlSm,
    paddingInline: space.sm,
    fontSize: font.caption,
  },
  // 閲覧者向け: トリガーの代わりに文字だけを下罫線付きで出す
  readOnlyValue: {
    display: "flex",
    alignItems: "center",
    minHeight: size.control,
    fontFamily: font.family,
    fontSize: font.body,
    color: text.default,
    borderBottomWidth: stroke.default,
    borderBottomStyle: "solid",
    borderBottomColor: border.default,
  },
  readOnlyPlaceholder: { color: text.muted },
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
  /** 閲覧者向け。選択中の文字(無ければ placeholder)だけを下罫線付きで出す */
  isReadOnly?: boolean;
  /** sm は高さ size.controlSm・文字 font.caption(公開ボックス用) */
  size?: "md" | "sm";
}

export function Select({
  label,
  items,
  selectedValue,
  onChange,
  placeholder,
  isDisabled,
  errorMessage,
  isReadOnly,
  size: controlSize = "md",
}: SelectProps) {
  const isInvalid = errorMessage !== undefined;
  if (isReadOnly === true) {
    // RAC の Select に isReadOnly は無いため、Select 自体を描かない(隠し input も出ない)
    const selected = items.find((item) => item.value === selectedValue);
    return (
      <div role="group" aria-label={label} className={fieldClassName()}>
        <FieldLabel elementType="span">{label}</FieldLabel>
        <span
          {...stylex.props(
            styles.readOnlyValue,
            selected === undefined && styles.readOnlyPlaceholder,
          )}
        >
          {selected?.label ?? placeholder ?? "選択してください"}
        </span>
      </div>
    );
  }
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
              controlSize === "sm" && styles.triggerSm,
              state.isHovered && styles.triggerHovered,
              isInvalid && styles.triggerInvalid,
              (isOpen || isFocusVisible) && styles.triggerFocused,
              disabled && styles.triggerDisabled,
            ])}
          >
            {/* 既定の SelectValue は選択中の候補の中身(check 用の空き枠を含む)を複製して描き、
                文字がずれるため、トリガーには選択中の文字だけを出す */}
            <SelectValue>
              {({ isPlaceholder, selectedText, defaultChildren }) =>
                isPlaceholder ? defaultChildren : selectedText
              }
            </SelectValue>
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
