import * as stylex from "@stylexjs/stylex";
import { bg, font, radius, space, text } from "@plyrs/ui/semantic.stylex";
import { ROLE_DESCRIPTIONS, ROLE_LABELS } from "../../lib/labels";
import { ROLES } from "../../lib/permissions";

const NARROW = "@media (max-width: 959px)";

const styles = stylex.create({
  grid: {
    display: "grid",
    gridTemplateColumns: { default: "repeat(3, minmax(0, 1fr))", [NARROW]: "minmax(0, 1fr)" },
    gap: space.sm,
  },
  card: {
    display: "flex",
    flexDirection: "column",
    gap: space.xs,
    padding: space.inset,
    backgroundColor: bg.surface,
    borderRadius: radius.container,
  },
  name: { fontSize: font.body, fontWeight: font.weightBold, color: text.default },
  description: { fontSize: font.caption, color: text.muted },
});

// ロールごとにできることの説明(G10)
export function RoleCards() {
  return (
    <div {...stylex.props(styles.grid)}>
      {ROLES.map((role) => (
        <div key={role} {...stylex.props(styles.card)}>
          <b {...stylex.props(styles.name)}>{ROLE_LABELS[role]}</b>
          <span {...stylex.props(styles.description)}>{ROLE_DESCRIPTIONS[role]}</span>
        </div>
      ))}
    </div>
  );
}
