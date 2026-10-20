import * as stylex from "@stylexjs/stylex";
import type { HomeWidgetContribution } from "@plyrs/ui";
import { space } from "@plyrs/ui/semantic.stylex";
import { HOME_LABELS } from "../../lib/labels";
import { HomeCard } from "./home-card";

const NARROW = "@media (max-width: 959px)";

const styles = stylex.create({
  grid: {
    display: "grid",
    gridTemplateColumns: { default: "repeat(2, minmax(0, 1fr))", [NARROW]: "minmax(0, 1fr)" },
    gap: space.md,
  },
});

// b-home.md 2.5: home:widget スロットの寄与を 2 列のグリッドに並べる
export function WidgetGrid({ widgets }: { widgets: readonly HomeWidgetContribution[] }) {
  if (widgets.length === 0) return null;
  return (
    <div role="region" aria-label={HOME_LABELS.widgets} {...stylex.props(styles.grid)}>
      {widgets.map((widget) => {
        const Render = widget.render;
        return (
          <div
            key={widget.id}
            // 1 列表示でも "1 / -1" は 1 列分になるので、狭い幅の分岐は要らない
            style={widget.size === "full" ? { gridColumn: "1 / -1" } : undefined}
          >
            <HomeCard title={widget.title}>
              <Render />
            </HomeCard>
          </div>
        );
      })}
    </div>
  );
}
