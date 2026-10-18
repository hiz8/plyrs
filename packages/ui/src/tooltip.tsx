import * as stylex from "@stylexjs/stylex";
import type { ReactElement, ReactNode } from "react";
import { Tooltip as RacTooltip, TooltipTrigger } from "react-aria-components";
import { bg, elevation, font, layer, radius, space, text } from "./semantic.stylex";

// D1 ボード 3c。地は bg.inverse で、bg.raised の面ではないため枠線は付けない(h-design-tokens.md 3.1)
const styles = stylex.create({
  tooltip: {
    backgroundColor: bg.inverse,
    color: text.inverse,
    fontFamily: font.family,
    fontSize: font.caption,
    lineHeight: font.lineHeightNormal,
    paddingBlock: space.xs,
    paddingInline: space.sm,
    borderRadius: radius.item,
    boxShadow: elevation.menu,
    whiteSpace: "nowrap",
    // モーダルやトーストの中の要素にも出すため、最も上の重なり順にする
    zIndex: layer.toast,
  },
});

export interface TooltipProps {
  content: ReactNode;
  /** RAC のフォーカスできる要素(Button など)。素の要素は Focusable で包む(relative-time.tsx) */
  children: ReactElement;
  placement?: "top" | "bottom" | "start" | "end";
  delay?: number;
}

export function Tooltip({ content, children, placement = "top", delay = 600 }: TooltipProps) {
  return (
    <TooltipTrigger delay={delay}>
      {children}
      <RacTooltip
        placement={placement}
        offset={8}
        className={stylex.props(styles.tooltip).className ?? ""}
      >
        {content}
      </RacTooltip>
    </TooltipTrigger>
  );
}
