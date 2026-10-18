import * as stylex from "@stylexjs/stylex";
import { primitives } from "./primitives.stylex";

export const semantic = stylex.defineVars({
  bgCanvas: `light-dark(${primitives.white}, ${primitives.gray950})`,
  textPrimary: primitives.gray950,
});
