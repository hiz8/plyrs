import * as stylex from "@stylexjs/stylex";
import { primitives as p } from "./primitives.stylex";

// h-design-tokens.md 3 章: 用途の名前。値は必ずプリミティブを参照し、ライト / ダークの対は
// light-dark(ライト, ダーク) で持つ(4 章)。どちらを使うかはルートの color-scheme が決める
// (admin の styles.css が既定の `light dark` を宣言し、lib/theme.ts が上書きする)。
// 部品と画面はこのファイルだけを参照する。消費側は index.ts を経由せず直接 import する。

export const bg = stylex.defineVars({
  canvas: `light-dark(${p.white}, ${p.gray950})`,
  surface: `light-dark(${p.gray50}, ${p.gray900})`,
  // 常に border.default の枠線を伴う(モーダル・メニュー・トースト)
  raised: `light-dark(${p.white}, ${p.gray800})`,
  overlay: `light-dark(${p.blackAlpha50}, ${p.blackAlpha70})`,
  hover: `light-dark(${p.blackAlpha5}, ${p.whiteAlpha8})`,
  pressed: `light-dark(${p.blackAlpha10}, ${p.whiteAlpha12})`,
  skeleton: `light-dark(${p.gray100}, ${p.whiteAlpha8})`,
  inverse: `light-dark(${p.gray900}, ${p.gray100})`,
});

export const text = stylex.defineVars({
  default: `light-dark(${p.gray900}, ${p.gray100})`,
  muted: `light-dark(${p.gray600}, ${p.gray400})`,
  onAccent: `light-dark(${p.white}, ${p.gray950})`,
  inverse: `light-dark(${p.gray50}, ${p.gray900})`,
});

export const border = stylex.defineVars({
  default: `light-dark(${p.gray200}, ${p.gray700})`,
  hover: `light-dark(${p.gray300}, ${p.gray600})`,
});

export const accent = stylex.defineVars({
  default: `light-dark(${p.blue600}, ${p.blue400})`,
  hover: `light-dark(${p.blue700}, ${p.blue300})`,
  active: `light-dark(${p.blue800}, ${p.blue200})`,
  surface: `light-dark(${p.blue50}, ${p.blue950})`,
});

export const focus = stylex.defineVars({
  // 2px、2px 外側。入力欄の枠線色はフォーカスで変えない
  ring: `light-dark(${p.blue600}, ${p.blue400})`,
});

export const status = stylex.defineVars({
  danger: `light-dark(${p.red600}, ${p.red400})`,
  dangerHover: `light-dark(${p.red700}, ${p.red300})`,
  dangerSurface: `light-dark(${p.red50}, ${p.red950})`,
  success: `light-dark(${p.green700}, ${p.green400})`,
  successSurface: `light-dark(${p.green50}, ${p.green950})`,
  warning: `light-dark(${p.amber700}, ${p.amber400})`,
  warningSurface: `light-dark(${p.amber50}, ${p.amber950})`,
});

// 3.2: 余白・文字・その他はテーマで変えない(elevation の色だけが例外)
export const space = stylex.defineVars({
  xxs: p.space1,
  xs: p.space2,
  sm: p.space3,
  inset: p.space4,
  md: p.space5,
  lg: p.space6,
  xl: p.space7,
  pageGutter: p.space6,
});

export const size = stylex.defineVars({
  control: `calc(${p.space7} + ${p.space2})`,
  controlSm: `calc(${p.space6} + ${p.space2})`,
  row: `calc(${p.space7} + ${p.space4})`,
  rowCompact: `calc(${p.space7} + ${p.space3})`,
});

export const font = stylex.defineVars({
  family: p.fontSans,
  familyMono: p.fontMono,
  body: p.fontSize2,
  caption: p.fontSize1,
  label: p.fontSize3,
  sectionTitle: p.fontSize4,
  pageTitle: p.fontSize5,
  weightRegular: p.fontWeightRegular,
  weightMedium: p.fontWeightMedium,
  weightBold: p.fontWeightBold,
  lineHeightTight: p.lineHeightTight,
  lineHeightNormal: p.lineHeightNormal,
  lineHeightRelaxed: p.lineHeightRelaxed,
});

export const radius = stylex.defineVars({
  button: p.radiusFull,
  badge: p.radius1,
  small: p.radius1,
  control: p.radius2,
  item: p.radius2,
  container: p.radius3,
  full: p.radiusFull,
});

export const stroke = stylex.defineVars({
  default: p.borderWidth1,
  focus: p.borderWidth2,
});

// 2.4 の注記: 形は shadow1/3(menu)、shadow2/4(modal)で共通。色だけを切り替える
export const elevation = stylex.defineVars({
  menu: `0 1px 2px light-dark(${p.blackAlpha6}, ${p.blackAlpha40}), 0 4px 12px light-dark(${p.blackAlpha10}, ${p.blackAlpha50})`,
  modal: `0 4px 8px light-dark(${p.blackAlpha8}, ${p.blackAlpha50}), 0 16px 40px light-dark(${p.blackAlpha18}, ${p.blackAlpha70})`,
});

export const motion = stylex.defineVars({
  fast: p.duration1,
  normal: p.duration2,
});

export const layer = stylex.defineVars({
  dropdown: p.zIndexDropdown,
  modal: p.zIndexModal,
  toast: p.zIndexToast,
});
