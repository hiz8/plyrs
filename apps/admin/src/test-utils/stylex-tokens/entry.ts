import * as stylex from "@stylexjs/stylex";
import { accentTheme } from "./accent-theme.stylex";
import { semantic } from "./semantic.stylex";

const styles = stylex.create({
  root: { backgroundColor: semantic.bgCanvas, color: semantic.textPrimary },
});

export const props = stylex.props(accentTheme, styles.root);
