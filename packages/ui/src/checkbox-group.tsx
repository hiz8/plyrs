import { useId } from "react";
import * as stylex from "@stylexjs/stylex";
import { Checkbox } from "./checkbox";
import { colors, spacing, typography } from "./tokens.stylex";

const styles = stylex.create({
  group: {
    display: "flex",
    flexDirection: "column",
    gap: spacing.xs,
    fontFamily: typography.fontFamily,
  },
  label: { fontSize: typography.sizeSm, color: colors.textMuted },
  error: { fontSize: typography.sizeSm, color: colors.danger },
});

export interface CheckboxGroupProps {
  label: string;
  options: { value: string; label: string }[];
  value: string[];
  onChange: (next: string[]) => void;
  errorMessage?: string;
}

// 実装注意: RAC の CheckboxGroup（useCheckboxGroupState）は value を state に取り込み、
// 子の Checkbox に CheckboxGroupContext 経由で isSelected を注入し直す。本コンポーネントは
// 配列合成をこの関数側で自前管理しており、Checkbox に渡した isSelected/onChange と RAC 側の
// group state が二重管理になって競合し、テスト（クリックで配列が正しく更新されること）が
// 落ちた（`toBeChecked()` が失敗）。ブリーフに記載の逃げ道どおり、RacCheckboxGroup を使わず
// `<div role="group" aria-label>` に落として自前合成のみで完結させる。
export function CheckboxGroup({
  label,
  options,
  value,
  onChange,
  errorMessage,
}: CheckboxGroupProps) {
  const errorId = useId();

  return (
    <div
      role="group"
      aria-label={label}
      aria-describedby={errorMessage !== undefined ? errorId : undefined}
      className={stylex.props(styles.group).className ?? ""}
    >
      <span className={stylex.props(styles.label).className ?? ""}>{label}</span>
      {options.map((option) => (
        <Checkbox
          key={option.value}
          isSelected={value.includes(option.value)}
          onChange={(selected) =>
            onChange(selected ? [...value, option.value] : value.filter((v) => v !== option.value))
          }
        >
          {option.label}
        </Checkbox>
      ))}
      {errorMessage !== undefined && (
        <span id={errorId} className={stylex.props(styles.error).className ?? ""}>
          {errorMessage}
        </span>
      )}
    </div>
  );
}
