import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { reorderIds, SortableList } from "./sortable-list";

const ITEMS = [
  { id: "a", textValue: "A" },
  { id: "b", textValue: "B" },
  { id: "c", textValue: "C" },
];

function renderList(props: { isDisabled?: boolean; onReorder?: (ids: string[]) => void }) {
  return (
    <SortableList
      label="並び順"
      items={ITEMS}
      renderItem={(item) => <span>{item.textValue}</span>}
      dragLabel={(item) => `${item.textValue}を並べ替え`}
      onReorder={props.onReorder ?? (() => {})}
      isDisabled={props.isDisabled}
    />
  );
}

describe("reorderIds", () => {
  it("動かす id を抜いてから目標の前後に挿す", () => {
    expect(reorderIds(["a", "b", "c"], ["c"], "a", "before")).toStrictEqual(["c", "a", "b"]);
    expect(reorderIds(["a", "b", "c"], ["a"], "c", "after")).toStrictEqual(["b", "c", "a"]);
    expect(reorderIds(["a", "b", "c"], ["a"], "a", "after")).toStrictEqual(["a", "b", "c"]);
  });
});

describe("SortableList", () => {
  it("行ごとにつまみ(aria-label)を描き、isDisabled ならつまみが無い", () => {
    const { rerender } = render(renderList({}));
    expect(screen.getByRole("button", { name: "Aを並べ替え" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Bを並べ替え" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cを並べ替え" })).toBeInTheDocument();
    rerender(renderList({ isDisabled: true }));
    expect(screen.queryByRole("button", { name: "Aを並べ替え" })).not.toBeInTheDocument();
  });

  it("キーボードで並べ替えると onReorder に新しい並びが渡る", async () => {
    const user = userEvent.setup();
    const onReorder = vi.fn();
    render(renderList({ onReorder }));
    screen.getByRole("button", { name: "Aを並べ替え" }).focus();
    await user.keyboard("{Enter}");
    await user.keyboard("{ArrowDown}");
    await user.keyboard("{Enter}");
    await vi.waitFor(() => expect(onReorder).toHaveBeenCalledTimes(1));
    expect(onReorder).toHaveBeenCalledWith(["b", "a", "c"]);
  });
});
