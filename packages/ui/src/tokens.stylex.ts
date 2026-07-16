import * as stylex from "@stylexjs/stylex";

// design-spec §9.9 / tech-selection §1.3: テーマは defineVars で型安全に持つ。
// ダークは prefers-color-scheme 追従（テナント別アクセント等の動的テーマは将来 createTheme で重ねる）。
// 注意: defineVars は .stylex.ts ファイルの named export でなければならず、消費側は
// このファイルを直接 import する（index.ts 経由の再 export はコンパイラが解決できない）。
const DARK = "@media (prefers-color-scheme: dark)";

export const colors = stylex.defineVars({
  bg: { default: "#ffffff", [DARK]: "#111418" },
  surface: { default: "#f6f7f8", [DARK]: "#1a1f24" },
  border: { default: "#d8dde3", [DARK]: "#333a42" },
  text: { default: "#1a1f24", [DARK]: "#e8eaed" },
  textMuted: { default: "#5f6b76", [DARK]: "#9aa5af" },
  accent: { default: "#2563eb", [DARK]: "#60a5fa" },
  accentText: { default: "#ffffff", [DARK]: "#0b1220" },
  danger: { default: "#dc2626", [DARK]: "#f87171" },
  focusRing: { default: "#2563eb", [DARK]: "#60a5fa" },
});

export const spacing = stylex.defineVars({
  xs: "4px",
  sm: "8px",
  md: "16px",
  lg: "24px",
  xl: "32px",
});

export const typography = stylex.defineVars({
  fontFamily:
    "system-ui, -apple-system, 'Segoe UI', 'Hiragino Kaku Gothic ProN', 'Noto Sans JP', sans-serif",
  sizeSm: "12px",
  sizeMd: "14px",
  sizeLg: "16px",
  sizeXl: "20px",
});
