import * as stylex from "@stylexjs/stylex";
import { accent, font, radius, space, stroke, text } from "@plyrs/ui/semantic.stylex";

// 案 D の一括操作のバーと、メディアの一括操作・アップロードの進捗の帯で共有(F11)
export const bulkBarStyles = stylex.create({
  root: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: space.inset,
    padding: `${space.sm} ${space.inset}`,
    backgroundColor: accent.surface,
    borderWidth: stroke.default,
    borderStyle: "solid",
    borderColor: accent.default,
    borderRadius: radius.control,
    fontSize: font.body,
  },
  selected: { fontWeight: font.weightBold, color: accent.default },
  note: { color: text.muted },
  spacer: { marginInlineStart: "auto", display: "flex", alignItems: "center", gap: space.inset },
  // 部品固有の幅(D2 L3): 進捗バーは伸ばしすぎない
  progress: { flex: 1, minWidth: 0, maxWidth: "320px" },
});
