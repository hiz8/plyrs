import * as stylex from "@stylexjs/stylex";
import { accent, bg, border, focus, font, space, status, text } from "./semantic.stylex";

// h-design-tokens.md 5 章: 旧名はセマンティックトークンの別名として残し、画面ごとに
// semantic.stylex.ts へ置き換える(ロードマップ V2 以降)。新しいコードはここを使わない。
// ダークの切り替えは prefers-color-scheme の @media から、セマンティック側の light-dark() に移った。
// 注意: defineVars は .stylex.ts ファイルの named export でなければならず、消費側は
// このファイルを直接 import する（index.ts 経由の再 export はコンパイラが解決できない）。
export const colors = stylex.defineVars({
  bg: bg.canvas,
  surface: bg.surface,
  border: border.default,
  text: text.default,
  textMuted: text.muted,
  accent: accent.default,
  accentText: text.onAccent,
  danger: status.danger,
  focusRing: focus.ring,
});

export const spacing = stylex.defineVars({
  xs: space.xs,
  sm: space.sm,
  md: space.md,
  lg: space.lg,
  xl: space.xl,
});

export const typography = stylex.defineVars({
  fontFamily: font.family,
  sizeSm: font.caption,
  sizeMd: font.body,
  sizeLg: font.label,
  sizeXl: font.sectionTitle,
});
