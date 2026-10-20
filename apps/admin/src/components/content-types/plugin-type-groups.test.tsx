import { render, screen, within } from "@testing-library/react";
import { expect, it } from "vitest";
import { CONTENT_TYPE_LABELS } from "../../lib/labels";
import { typeRow } from "../../test-utils/type-rows";
import { PluginTypeGroups } from "./plugin-type-groups";

it("グループの見出しにモジュール名・バッジ・注記を出し、行には「フィールドを見る」だけ", () => {
  render(
    <PluginTypeGroups
      slug="blog"
      groups={[
        {
          pluginId: "booking",
          name: "予約",
          rows: [
            typeRow(
              { key: "booking.slot", name: "予約枠", source: "plugin", pluginId: "booking" },
              0,
            ),
          ],
        },
      ]}
    />,
  );
  expect(screen.getByRole("heading", { level: 2, name: "予約" })).toBeInTheDocument();
  expect(screen.getByText(CONTENT_TYPE_LABELS.moduleBadge)).toBeInTheDocument();
  expect(screen.getByText(CONTENT_TYPE_LABELS.moduleNote)).toBeInTheDocument();
  const grid = screen.getByRole("grid", { name: CONTENT_TYPE_LABELS.tableLabel });
  expect(within(grid).getByRole("link", { name: "フィールドを見る" })).toBeInTheDocument();
  expect(within(grid).queryByRole("link", { name: "編集" })).not.toBeInTheDocument();
  expect(within(grid).queryByRole("button")).not.toBeInTheDocument();
});

it("グループが無ければ何も描かない", () => {
  const { container } = render(<PluginTypeGroups slug="blog" groups={[]} />);
  expect(container).toBeEmptyDOMElement();
});
