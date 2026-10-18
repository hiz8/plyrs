import * as stylex from "@stylexjs/stylex";
import { bg, radius } from "./semantic.stylex";

// D1 ボード 3e: 置き換える部品と同じ寸法で描く。各要素は aria-hidden、親(画面)に aria-busy を付ける
const pulse = stylex.keyframes({
  "0%": { opacity: 1 },
  "50%": { opacity: 0.55 },
  "100%": { opacity: 1 },
});

const styles = stylex.create({
  base: {
    display: "block",
    backgroundColor: bg.skeleton,
    borderRadius: radius.small,
    animationName: pulse,
    // 緩い明滅(キャンバスの指定)。開閉用の motion.normal(200ms)では速すぎるため部品内で持つ
    animationDuration: "1.6s",
    animationIterationCount: "infinite",
    animationTimingFunction: "ease-in-out",
    "@media (prefers-reduced-motion: reduce)": { animationName: "none" },
  },
  circle: { borderRadius: radius.full },
  dims: (width: string, height: string) => ({ width, height }),
});

export interface SkeletonProps {
  width?: number | string;
  height?: number | string;
  shape?: "text" | "block" | "circle";
}

function toCss(value: number | string): string {
  return typeof value === "number" ? `${value}px` : value;
}

export function Skeleton({ width = "100%", height = 14, shape = "block" }: SkeletonProps) {
  return (
    <span
      aria-hidden="true"
      {...stylex.props(
        styles.base,
        shape === "circle" && styles.circle,
        styles.dims(toCss(width), toCss(height)),
      )}
    />
  );
}
