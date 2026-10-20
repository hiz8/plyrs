import * as stylex from "@stylexjs/stylex";
import { LoaderCircle } from "lucide-react";
import { ProgressBar as RacProgressBar } from "react-aria-components";
import { ICON_SIZE } from "./icon";
import { accent, bg, border, font, radius, space, status, stroke, text } from "./semantic.stylex";

// D1 ボード 3e(バー)/ D2・D3(回転アイコン)
const spin = stylex.keyframes({
  from: { transform: "rotate(0deg)" },
  to: { transform: "rotate(360deg)" },
});

const styles = stylex.create({
  root: { display: "flex", flexDirection: "column", gap: space.xs, fontFamily: font.family },
  header: { display: "flex", justifyContent: "space-between", gap: space.sm, fontSize: font.body },
  headerEnd: { justifyContent: "flex-end" },
  label: { color: text.default },
  value: { color: text.muted },
  track: {
    height: space.sm,
    overflow: "hidden",
    backgroundColor: bg.surface,
    borderWidth: stroke.default,
    borderStyle: "solid",
    borderColor: border.default,
    borderRadius: radius.full,
  },
  fill: { height: "100%", borderRadius: radius.full, backgroundColor: accent.default },
  fillSuccess: { backgroundColor: status.success },
  fillWidth: (percentage: number) => ({ width: `${percentage}%` }),
  spinner: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.sm,
    fontFamily: font.family,
    fontSize: font.body,
    fontWeight: font.weightBold,
    color: accent.default,
  },
  spinIcon: {
    display: "inline-flex",
    animationName: spin,
    animationDuration: "1s",
    animationIterationCount: "infinite",
    animationTimingFunction: "linear",
    // skeleton.tsx と同じ: 動きを減らす設定では回さない(文言で実行中が伝わる)
    "@media (prefers-reduced-motion: reduce)": { animationName: "none" },
  },
});

export interface ProgressBarProps {
  label: string;
  value: number;
  maxValue?: number;
  /** 右上の件数などの文言(aria-valuetext にも使う) */
  valueLabel?: string;
  tone?: "accent" | "success";
  /** 見た目の題を出さない(aria-label は残す)。近くに同じ文言がある場合の二重読み上げ・二重表示の回避 */
  isLabelHidden?: boolean;
}

export function ProgressBar({
  label,
  value,
  maxValue = 100,
  valueLabel,
  tone = "accent",
  isLabelHidden = false,
}: ProgressBarProps) {
  return (
    <RacProgressBar
      value={value}
      maxValue={maxValue}
      aria-label={label}
      valueLabel={valueLabel}
      className={stylex.props(styles.root).className ?? ""}
    >
      {({ percentage = 0, valueText }) => (
        <>
          <div {...stylex.props(styles.header, isLabelHidden && styles.headerEnd)}>
            {!isLabelHidden && (
              <span aria-hidden="true" {...stylex.props(styles.label)}>
                {label}
              </span>
            )}
            <span aria-hidden="true" {...stylex.props(styles.value)}>
              {valueText}
            </span>
          </div>
          <div {...stylex.props(styles.track)}>
            <div
              {...stylex.props(
                styles.fill,
                tone === "success" && styles.fillSuccess,
                styles.fillWidth(percentage),
              )}
            />
          </div>
        </>
      )}
    </RacProgressBar>
  );
}

/** 一括操作・アップロードの実行中。親(画面)に aria-busy を付ける */
export function Spinner({ label }: { label: string }) {
  return (
    <span {...stylex.props(styles.spinner)}>
      <span {...stylex.props(styles.spinIcon)}>
        <LoaderCircle size={ICON_SIZE.inline} aria-hidden="true" />
      </span>
      <span>{label}</span>
    </span>
  );
}
