import * as stylex from "@stylexjs/stylex";
import { CircleAlert, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { ICON_SIZE } from "./icon";
import { border, font, space, status, stroke, text } from "./semantic.stylex";

// D1 ボード 3e / 4: シェル上部に 1 か所だけ置く画面全体のお知らせ。角丸なし、下に罫線
const styles = stylex.create({
  banner: {
    display: "flex",
    alignItems: "center",
    gap: space.inset,
    paddingBlock: space.inset,
    paddingInline: space.pageGutter,
    fontFamily: font.family,
    fontSize: font.body,
    color: text.default,
    borderBottomWidth: stroke.default,
    borderBottomStyle: "solid",
    borderBottomColor: border.default,
  },
  warning: { backgroundColor: status.warningSurface },
  danger: { backgroundColor: status.dangerSurface },
  warningIcon: { color: status.warning, display: "inline-flex", flexShrink: 0 },
  dangerIcon: { color: status.danger, display: "inline-flex", flexShrink: 0 },
  message: { flex: 1 },
});

export interface BannerProps {
  tone: "warning" | "danger";
  children: ReactNode;
  /** 小型の枠線ボタン(例: 今すぐ再接続) */
  action?: ReactNode;
}

export function Banner({ tone, children, action }: BannerProps) {
  const Icon = tone === "warning" ? TriangleAlert : CircleAlert;
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      {...stylex.props(styles.banner, styles[tone])}
    >
      <span {...stylex.props(tone === "warning" ? styles.warningIcon : styles.dangerIcon)}>
        <Icon size={ICON_SIZE.inline} aria-hidden="true" />
      </span>
      <span {...stylex.props(styles.message)}>{children}</span>
      {action}
    </div>
  );
}
