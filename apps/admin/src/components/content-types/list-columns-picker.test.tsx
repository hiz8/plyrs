import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { CONTENT_TYPE_LABELS } from "../../lib/labels";
import { ListColumnsSelectMock } from "../../test-utils/list-columns-select-mock";
import { ListColumnsPicker } from "./list-columns-picker";

vi.mock("./list-columns-select", () => ({ ListColumnsSelect: ListColumnsSelectMock }));

const editor = CONTENT_TYPE_LABELS.editor;
const fields = [
  { key: "a", label: "甲" },
  { key: "b", label: "乙" },
  { key: "c", label: "丙" },
  { key: "d", label: "丁" },
];

it("選択中をチップで出し、外すと onChange、3 件で追加が無効", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  const { rerender } = render(
    <ListColumnsPicker fields={fields} value={["a", "b"]} onChange={onChange} isReadOnly={false} />,
  );
  expect(screen.getByText(editor.listColumns)).toBeInTheDocument();
  expect(screen.getByText(editor.listColumnsMax(3))).toBeInTheDocument();
  const select = screen.getByRole("combobox", { name: editor.addColumn });
  expect(select).toBeEnabled();
  await user.selectOptions(select, "c");
  expect(onChange).toHaveBeenLastCalledWith(["a", "b", "c"]);
  await user.click(screen.getByRole("button", { name: editor.removeColumn("甲") }));
  expect(onChange).toHaveBeenLastCalledWith(["b"]);
  rerender(
    <ListColumnsPicker
      fields={fields}
      value={["a", "b", "c"]}
      onChange={onChange}
      isReadOnly={false}
    />,
  );
  expect(screen.getByRole("combobox", { name: editor.addColumn })).toBeDisabled();
});

it("読み取り専用は外すボタンが無く追加も無効", () => {
  render(<ListColumnsPicker fields={fields} value={["a"]} onChange={vi.fn()} isReadOnly />);
  expect(screen.queryByRole("button", { name: editor.removeColumn("甲") })).not.toBeInTheDocument();
  expect(screen.getByRole("combobox", { name: editor.addColumn })).toBeDisabled();
});
