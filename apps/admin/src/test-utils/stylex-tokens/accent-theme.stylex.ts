import * as stylex from "@stylexjs/stylex";
import { primitives } from "./primitives.stylex";
import { semantic } from "./semantic.stylex";

export const accentTheme = stylex.createTheme(semantic, {
  bgCanvas: `light-dark(${primitives.gray950}, ${primitives.white})`,
  textPrimary: primitives.white,
});
