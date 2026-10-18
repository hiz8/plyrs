import * as stylex from "@stylexjs/stylex";
import { bg, elevation, text } from "../semantic.stylex";
import { colors, spacing } from "../tokens.stylex";

// tokens-build.test.ts のビルド入口。セマンティックと旧名の別名を 1 つずつ使い、
// 両方の defineVars が出力 CSS に載るようにする
const styles = stylex.create({
  root: {
    backgroundColor: bg.canvas,
    color: text.default,
    boxShadow: elevation.menu,
    borderColor: colors.border,
    padding: spacing.md,
  },
});

export const props = stylex.props(styles.root);
