// vi.mock("./components/content-types/list-columns-select", ...) の差し替え先。
// RAC のセレクトは jsdom で扱いにくいので素の select にする(先頭に空の option)
export function ListColumnsSelectMock(props: {
  label: string;
  items: { value: string; label: string }[];
  onChange: (value: string) => void;
  isDisabled: boolean;
}) {
  return (
    <select
      aria-label={props.label}
      value=""
      disabled={props.isDisabled}
      onChange={(event) => {
        if (event.target.value !== "") props.onChange(event.target.value);
      }}
    >
      <option value="" />
      {props.items.map((item) => (
        <option key={item.value} value={item.value}>
          {item.label}
        </option>
      ))}
    </select>
  );
}
