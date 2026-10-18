// h-common-surface.md 12 章: Lucide の大きさと線幅。色は常に currentColor(lucide の既定)
export const ICON_SIZE = {
  /** 本文・ボタン・バッジ・入力欄の中 */
  inline: 16,
  /** サイドバー・メニュー */
  nav: 20,
  /** 空状態・ドロップ領域 */
  empty: 32,
} as const;

export const ICON_STROKE = {
  default: 2,
  /** 32px 以上 */
  large: 1.75,
} as const;
