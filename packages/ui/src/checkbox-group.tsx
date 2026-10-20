import { useId } from "react";
import * as stylex from "@stylexjs/stylex";
import { VisuallyHidden } from "react-aria-components";
import { Checkbox } from "./checkbox";
import { FieldErrorText, FieldLabel, fieldClassName } from "./field";
import { space } from "./semantic.stylex";

const styles = stylex.create({
  options: { display: "flex", flexDirection: "column", gap: space.xxs },
});

export interface CheckboxGroupProps {
  label: string;
  options: { value: string; label: string }[];
  value: string[];
  onChange: (next: string[]) => void;
  errorMessage?: string;
  isRequired?: boolean;
  /** 閲覧者向け。中のチェックを読み取り専用にする */
  isReadOnly?: boolean;
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
  isRequired,
  isReadOnly,
}: CheckboxGroupProps) {
  const errorId = useId();
  const requiredId = useId();
  const isInvalid = errorMessage !== undefined;
  // role="group" に aria-required は許されない(aria-allowed-attr)。必須は説明として結ぶ
  const describedBy = [isRequired === true && requiredId, isInvalid && errorId]
    .filter((id) => id !== false)
    .join(" ");

  return (
    <div
      role="group"
      aria-label={label}
      aria-describedby={describedBy === "" ? undefined : describedBy}
      className={fieldClassName()}
    >
      <FieldLabel elementType="span" isRequired={isRequired}>
        {label}
      </FieldLabel>
      {isRequired === true && (
        <VisuallyHidden elementType="span" id={requiredId}>
          必須
        </VisuallyHidden>
      )}
      <div {...stylex.props(styles.options)}>
        {options.map((option) => (
          <Checkbox
            key={option.value}
            isSelected={value.includes(option.value)}
            isInvalid={isInvalid}
            isReadOnly={isReadOnly ?? false}
            onChange={(selected) =>
              onChange(
                selected ? [...value, option.value] : value.filter((v) => v !== option.value),
              )
            }
          >
            {option.label}
          </Checkbox>
        ))}
      </div>
      {isInvalid && <FieldErrorText id={errorId}>{errorMessage}</FieldErrorText>}
    </div>
  );
}
