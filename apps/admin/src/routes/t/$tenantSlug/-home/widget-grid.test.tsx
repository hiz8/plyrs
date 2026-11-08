import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { WidgetGrid } from "./widget-grid";

it("ウィジェットを h2 の題付きで描き、full は 2 列分", () => {
  render(
    <WidgetGrid
      widgets={[
        { id: "a.x", order: 1, title: "今日の予約", render: () => <p>予約本体</p>, size: "full" },
        { id: "a.y", order: 2, title: "売上", render: () => <p>売上本体</p> },
      ]}
    />,
  );
  expect(screen.getByRole("region", { name: "モジュールのウィジェット" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { level: 2, name: "今日の予約" })).toBeInTheDocument();
  expect(screen.getByText("売上本体")).toBeInTheDocument();
  const full = screen.getByRole("region", { name: "今日の予約" }).parentElement;
  expect(full).toHaveStyle({ gridColumn: "1 / -1" });
  const half = screen.getByRole("region", { name: "売上" }).parentElement;
  expect(half).not.toHaveStyle({ gridColumn: "1 / -1" });
});

it("0 件なら何も描かない", () => {
  const { container } = render(<WidgetGrid widgets={[]} />);
  expect(container).toBeEmptyDOMElement();
});
