import * as stylex from "@stylexjs/stylex";
import { Focusable } from "react-aria-components";
import { focus, font, radius, stroke, text } from "./semantic.stylex";
import { Tooltip } from "./tooltip";

// h-common-surface.md 5 章 / D1 ボード 3e。書式は admin の lib/datetime.ts(formatDateTime)が作り、
// ここは表示だけを持つ。相対表記のときだけ点線の下線とツールチップで日時を添える
const styles = stylex.create({
  time: { fontFamily: font.family, fontSize: font.body, color: text.muted },
  relative: {
    textDecorationLine: "underline",
    textDecorationStyle: "dotted",
    textUnderlineOffset: "3px",
    borderRadius: radius.small,
    cursor: "default",
    // 素の <time> のため RAC の isFocusVisible が無い。:focus-visible で同じリングを出す
    outlineStyle: { default: "none", ":focus-visible": "solid" },
    outlineWidth: stroke.focus,
    outlineColor: focus.ring,
    outlineOffset: stroke.focus,
  },
});

export interface RelativeTimeValue {
  /** 画面に出す文字列(相対表記、または日時) */
  text: string;
  /** 日時の文字列 */
  absolute: string;
  /** <time dateTime> に入れる ISO 8601 */
  iso: string;
}

export function RelativeTime({ value }: { value: RelativeTimeValue }) {
  if (value.text === value.absolute) {
    return (
      <time dateTime={value.iso} {...stylex.props(styles.time)}>
        {value.text}
      </time>
    );
  }
  return (
    <Tooltip content={value.absolute}>
      <Focusable>
        <time tabIndex={0} dateTime={value.iso} {...stylex.props(styles.time, styles.relative)}>
          {value.text}
        </time>
      </Focusable>
    </Tooltip>
  );
}
