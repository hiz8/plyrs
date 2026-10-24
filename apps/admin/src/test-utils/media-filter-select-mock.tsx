// vi.mock("./media-filter-select", ...) の差し替え先。RAC のセレクトは jsdom で扱いにくいので素の select にする
export function MediaFilterSelectMock(props: {
  label: string;
  items: { value: string; label: string }[];
  selectedValue: string;
  onChange: (value: string) => void;
}) {
  return (
    <select
      aria-label={props.label}
      value={props.selectedValue}
      onChange={(event) => props.onChange(event.target.value)}
    >
      {props.items.map((item) => (
        <option key={item.value} value={item.value}>
          {item.label}
        </option>
      ))}
    </select>
  );
}
