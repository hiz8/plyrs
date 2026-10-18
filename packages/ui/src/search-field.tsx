import * as stylex from "@stylexjs/stylex";
import { Search, X } from "lucide-react";
import { Input, SearchField as RacSearchField, type InputRenderProps } from "react-aria-components";
import { IconButton } from "./button";
import { stylexRenderProps } from "./compose";
import { ICON_SIZE } from "./icon";
import { bg, border, focus, font, radius, size, space, stroke, text } from "./semantic.stylex";

// D1 ボード 3b。入力欄と同じ寸法で、左に search、入力中は右に消去ボタン
const styles = stylex.create({
  root: { position: "relative", display: "flex", alignItems: "center", fontFamily: font.family },
  icon: {
    position: "absolute",
    insetInlineStart: space.inset,
    display: "inline-flex",
    color: text.muted,
    pointerEvents: "none",
  },
  input: {
    width: "100%",
    height: size.control,
    // 左の search アイコン(ICON_SIZE.inline = 16px)の分を空ける
    paddingInlineStart: `calc(${space.inset} + 16px + ${space.sm})`,
    paddingInlineEnd: `calc(${size.controlSm} + ${space.sm})`,
    fontFamily: font.family,
    fontSize: font.body,
    color: text.default,
    backgroundColor: bg.canvas,
    borderWidth: stroke.default,
    borderStyle: "solid",
    borderColor: border.default,
    borderRadius: radius.control,
    outline: "none",
    "::placeholder": { color: text.muted },
    // ブラウザ既定の消去ボタンを隠す(自前の消去ボタンと二重になる)
    "::-webkit-search-cancel-button": { display: "none" },
  },
  hovered: { borderColor: border.hover },
  focused: {
    outlineWidth: stroke.focus,
    outlineStyle: "solid",
    outlineColor: focus.ring,
    outlineOffset: stroke.focus,
  },
  clear: { position: "absolute", insetInlineEnd: space.xs, display: "inline-flex" },
});

export interface SearchFieldProps {
  /** aria-label(見えるラベルは置かない) */
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export function SearchField({ label, value, onChange, placeholder }: SearchFieldProps) {
  return (
    <RacSearchField
      aria-label={label}
      value={value}
      onChange={onChange}
      className={stylex.props(styles.root).className ?? ""}
    >
      {({ isEmpty }) => (
        <>
          <span {...stylex.props(styles.icon)}>
            <Search size={ICON_SIZE.inline} aria-hidden="true" />
          </span>
          <Input
            placeholder={placeholder}
            className={stylexRenderProps<InputRenderProps>((state) => [
              styles.input,
              state.isHovered && styles.hovered,
              state.isFocused && styles.focused,
            ])}
          />
          {!isEmpty && (
            <span {...stylex.props(styles.clear)}>
              {/* SearchField の ButtonContext が消去の動作を与える */}
              <IconButton icon={X} label="検索語を消す" size="sm" />
            </span>
          )}
        </>
      )}
    </RacSearchField>
  );
}
