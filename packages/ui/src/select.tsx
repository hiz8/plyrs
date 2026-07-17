import * as stylex from "@stylexjs/stylex";
import {
  Button as RacButton,
  Label,
  ListBox,
  ListBoxItem,
  Popover,
  Select as RacSelect,
  SelectValue,
  Text,
  type ListBoxItemRenderProps,
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
  trigger: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    fontSize: typography.sizeMd,
    paddingBlock: spacing.xs,
    paddingInline: spacing.sm,
    borderRadius: "6px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: colors.border,
    backgroundColor: colors.bg,
    color: colors.text,
    cursor: "pointer",
  },
  popover: {
    backgroundColor: colors.bg,
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: colors.border,
    borderRadius: "6px",
    minWidth: "180px",
  },
  item: {
    padding: spacing.sm,
    fontSize: typography.sizeMd,
    fontFamily: typography.fontFamily,
    color: colors.text,
    cursor: "pointer",
    outline: "none",
  },
  itemFocused: { backgroundColor: colors.surface },
  error: { fontSize: typography.sizeSm, color: colors.danger },
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
  return (
    <RacSelect
      selectedKey={selectedValue === "" ? null : selectedValue}
      onSelectionChange={(key) => onChange(key === null ? "" : String(key))}
      isDisabled={isDisabled ?? false}
      placeholder={placeholder ?? "選択してください"}
      className={stylex.props(styles.field).className ?? ""}
    >
      <Label className={stylex.props(styles.label).className ?? ""}>{label}</Label>
      <RacButton className={stylex.props(styles.trigger).className ?? ""}>
        <SelectValue />
        <span aria-hidden="true">▾</span>
      </RacButton>
      {errorMessage !== undefined && (
        <Text slot="errorMessage" className={stylex.props(styles.error).className ?? ""}>
          {errorMessage}
        </Text>
      )}
      <Popover className={stylex.props(styles.popover).className ?? ""}>
        <ListBox>
          {items.map((item) => (
            <ListBoxItem
              key={item.value}
              id={item.value}
              textValue={item.label}
              className={stylexRenderProps<ListBoxItemRenderProps>((state) => [
                styles.item,
                state.isFocused && styles.itemFocused,
              ])}
            >
              {item.label}
            </ListBoxItem>
          ))}
        </ListBox>
      </Popover>
    </RacSelect>
  );
}
