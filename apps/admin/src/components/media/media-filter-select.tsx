import { Select } from "@plyrs/ui";

// テストで素の <select> に差し替えるため 1 ファイルに分けている(test-utils/media-filter-select-mock.tsx)
export function MediaFilterSelect({
  label,
  items,
  selectedValue,
  onChange,
}: {
  label: string;
  items: { value: string; label: string }[];
  selectedValue: string;
  onChange: (value: string) => void;
}) {
  return (
    <Select
      label={label}
      isLabelHidden
      size="md"
      items={items}
      selectedValue={selectedValue}
      onChange={onChange}
    />
  );
}
