import { Select } from "@plyrs/ui";

// テストで素の <select> に差し替えるため 1 ファイルに分けている(test-utils/list-columns-select-mock.tsx)。
// 選ぶと onChange を呼び、表示は未選択(placeholder)に戻る = 「追加するたびに選び直す」操作
export function ListColumnsSelect({
  label,
  items,
  onChange,
  isDisabled,
}: {
  label: string;
  items: { value: string; label: string }[];
  onChange: (value: string) => void;
  isDisabled: boolean;
}) {
  return (
    <Select
      label={label}
      isLabelHidden
      placeholder={label}
      items={items}
      selectedValue=""
      onChange={onChange}
      isDisabled={isDisabled}
    />
  );
}
