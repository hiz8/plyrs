import * as stylex from "@stylexjs/stylex";
import { accent, font, radius, text } from "./semantic.stylex";

// a-navigation.md: sm はサイドバー下段の 24px の円、md はサイト選択カードの 40px の角丸。
// 名前は隣のテキストが伝えるので装飾として読み上げから外す
const styles = stylex.create({
  base: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    fontFamily: font.family,
    fontWeight: font.weightBold,
    userSelect: "none",
  },
  // 部品固有の寸法
  sm: {
    width: "24px",
    height: "24px",
    borderRadius: radius.full,
    backgroundColor: accent.surface,
    color: accent.default,
    fontSize: font.caption,
  },
  md: {
    width: "40px",
    height: "40px",
    borderRadius: radius.control,
    backgroundColor: accent.default,
    color: text.onAccent,
    fontSize: font.label,
  },
});

export interface AvatarProps {
  name: string;
  size?: "sm" | "md";
}

export function Avatar({ name, size = "sm" }: AvatarProps) {
  // サロゲートペアを割らないよう、コードユニットではなく先頭の 1 文字で取る
  const initial = (Array.from(name)[0] ?? "?").toUpperCase();
  return (
    <span aria-hidden="true" {...stylex.props(styles.base, styles[size])}>
      {initial}
    </span>
  );
}
