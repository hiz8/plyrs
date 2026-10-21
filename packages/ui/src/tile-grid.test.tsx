import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { expect, it, vi } from "vitest";
import { TileGrid, type TileItem } from "./tile-grid";

const items: TileItem[] = [
  { id: "a", textValue: "a.png" },
  { id: "b", textValue: "b.png" },
  { id: "c", textValue: "c.png" },
];

function renderGrid(props: Partial<ComponentProps<typeof TileGrid<TileItem>>> = {}) {
  return render(
    <TileGrid
      label="メディア"
      items={items}
      renderThumb={(item) => <img alt="" src={`/${item.id}.png`} />}
      {...props}
    />,
  );
}

it("タイルを grid の row として描き、名前と renderThumb / renderBadge の中身を出す", () => {
  renderGrid({ renderBadge: (item) => (item.id === "a" ? <span>未使用</span> : undefined) });
  const grid = screen.getByRole("grid", { name: "メディア" });
  expect(grid).toBeInTheDocument();
  expect(screen.getAllByRole("row")).toHaveLength(3);
  expect(screen.getByText("a.png")).toBeInTheDocument();
  expect(screen.getByText("未使用")).toBeInTheDocument();
  expect(grid.querySelectorAll("img")).toHaveLength(3);
});

it("multiple は各タイルにチェックボックスを出し、チェックで onSelectionChange、タイルのクリックで onAction", async () => {
  const onSelectionChange = vi.fn();
  const onAction = vi.fn();
  renderGrid({ selectionMode: "multiple", onSelectionChange, onAction });
  // 選択が無いうちはタイル本体のクリックが action になる
  await userEvent.click(screen.getByText("b.png"));
  expect(onAction).toHaveBeenCalledWith("b");
  expect(onSelectionChange).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("checkbox", { name: "選択 a.png" }));
  expect(onSelectionChange).toHaveBeenLastCalledWith(new Set(["a"]));
  expect(onAction).toHaveBeenCalledTimes(1);
});

it("single はチェックボックスを出さず、クリックで 1 件だけ選ぶ(置き換え)", async () => {
  const onSelectionChange = vi.fn();
  renderGrid({ selectionMode: "single", onSelectionChange });
  expect(screen.queryByRole("checkbox")).toBeNull();
  await userEvent.click(screen.getByText("a.png"));
  await userEvent.click(screen.getByText("b.png"));
  expect(onSelectionChange).toHaveBeenLastCalledWith(new Set(["b"]));
});

it("disabledKeys のタイルは aria-disabled", () => {
  renderGrid({ selectionMode: "multiple", disabledKeys: new Set(["b"]) });
  const rows = screen.getAllByRole("row");
  expect(rows[1]).toHaveAttribute("aria-disabled", "true");
  expect(rows[0]).not.toHaveAttribute("aria-disabled", "true");
});

it("leading はグリッドの先頭に描かれる", () => {
  renderGrid({ leading: <div data-testid="lead">仮</div> });
  const lead = screen.getByTestId("lead");
  const first = screen.getAllByRole("row")[0] as HTMLElement;
  expect(lead.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

it("全選択(Ctrl+A)は disabledKeys のタイルを含めない", async () => {
  const onSelectionChange = vi.fn();
  renderGrid({
    selectionMode: "multiple",
    disabledKeys: new Set(["b"]),
    onSelectionChange,
  });
  (screen.getAllByRole("row")[0] as HTMLElement).focus();
  await userEvent.keyboard("{Control>}a{/Control}");
  const last = onSelectionChange.mock.calls.at(-1)?.[0] as Set<string>;
  expect(last.has("b")).toBe(false);
  expect(last.has("a")).toBe(true);
  expect(last.has("c")).toBe(true);
});
