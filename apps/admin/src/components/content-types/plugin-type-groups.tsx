import * as stylex from "@stylexjs/stylex";
import { Badge } from "@plyrs/ui";
import { font, space, text } from "@plyrs/ui/semantic.stylex";
import type { PluginTypeGroup } from "../../lib/content-types";
import { CONTENT_TYPE_LABELS } from "../../lib/labels";
import { TypeTable } from "./type-table";

const styles = stylex.create({
  groups: { display: "flex", flexDirection: "column", gap: space.lg },
  group: { display: "flex", flexDirection: "column", gap: space.sm },
  heading: { display: "flex", alignItems: "center", flexWrap: "wrap", gap: space.sm },
  title: { margin: 0, fontSize: font.body, fontWeight: font.weightBold, color: text.default },
  note: { fontSize: font.caption, color: text.muted },
});

const noop = () => {};

// E8: モジュールの型は編集できないため、モジュールごとに分けて読み取りの表で出す
export function PluginTypeGroups({
  groups,
  slug,
}: {
  groups: readonly PluginTypeGroup[];
  slug: string;
}) {
  if (groups.length === 0) return null;
  return (
    <div {...stylex.props(styles.groups)}>
      {groups.map((group) => (
        <section key={group.pluginId} {...stylex.props(styles.group)}>
          <div {...stylex.props(styles.heading)}>
            <h2 {...stylex.props(styles.title)}>{group.name}</h2>
            <Badge tone="neutral">{CONTENT_TYPE_LABELS.moduleBadge}</Badge>
            <span {...stylex.props(styles.note)}>{CONTENT_TYPE_LABELS.moduleNote}</span>
          </div>
          <TypeTable
            rows={group.rows}
            slug={slug}
            canManage={false}
            isReordering={false}
            onReorder={noop}
            onDelete={noop}
          />
        </section>
      ))}
    </div>
  );
}
