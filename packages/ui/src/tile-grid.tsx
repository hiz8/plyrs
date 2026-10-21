import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import {
  Checkbox as RacCheckbox,
  GridList,
  GridListItem,
  type CheckboxRenderProps,
  type GridListItemRenderProps,
  type Selection,
} from "react-aria-components";
import { CheckboxBox } from "./checkbox";
import { stylexRenderProps } from "./compose";
import { accent, bg, border, focus, font, radius, space, stroke, text } from "./semantic.stylex";

// F17(D3 M1・M9・M10・C2)。幅 960px 未満はタイルが列幅いっぱいに伸びる
const NARROW = "@media (max-width: 959px)";

const styles = stylex.create({
  grid: {
    display: "grid",
    gap: space.inset,
    fontFamily: font.family,
  },
  // 部品固有の寸法(D3 M1): md 160px / sm 140px。狭い画面は 120px 以上で伸びる
  colsMd: {
    gridTemplateColumns: {
      default: "repeat(auto-fill, 160px)",
      [NARROW]: "repeat(auto-fill, minmax(120px, 1fr))",
    },
  },
  colsSm: {
    gridTemplateColumns: {
      default: "repeat(auto-fill, 140px)",
      [NARROW]: "repeat(auto-fill, minmax(120px, 1fr))",
    },
  },
  // GridListItem が入れ物の grid のセルとして並ぶ
  list: { display: "contents" },
  tile: {
    display: "flex",
    flexDirection: "column",
    gap: space.xs,
    position: "relative",
    minWidth: 0,
    outline: "none",
    cursor: "pointer",
  },
  tileDisabled: { opacity: 0.5, cursor: "not-allowed" },
  frame: {
    position: "relative",
    width: "100%",
    aspectRatio: "1",
    overflow: "hidden",
    backgroundColor: bg.surface,
    borderWidth: stroke.default,
    borderStyle: "solid",
    borderColor: border.default,
    borderRadius: radius.control,
  },
  ring: {
    outlineWidth: stroke.focus,
    outlineStyle: "solid",
    outlineColor: focus.ring,
    outlineOffset: stroke.focus,
  },
  corner: { position: "absolute", top: space.sm, left: space.sm, display: "inline-flex" },
  cornerBox: {
    display: "inline-flex",
    backgroundColor: bg.canvas,
    borderRadius: radius.small,
  },
  // D3 M9: 装飾のラジオは 18px。選択中は 5px の枠で内側を抜く
  radio: {
    boxSizing: "border-box",
    width: "18px",
    height: "18px",
    backgroundColor: bg.canvas,
    borderRadius: radius.full,
    borderWidth: stroke.default,
    borderStyle: "solid",
    borderColor: border.hover,
  },
  // D3 M10: 5px
  radioOn: { borderWidth: "5px", borderColor: accent.default },
  badge: { position: "absolute", top: space.sm, right: space.sm, display: "inline-flex" },
  name: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontFamily: font.familyMono,
    fontSize: font.caption,
    color: text.muted,
  },
});

export interface TileItem {
  id: string;
  textValue: string;
}

export interface TileGridProps<T extends TileItem> {
  /** GridList の aria-label */
  label: string;
  items: readonly T[];
  /** 正方形の中身(画像 / アイコン + 拡張子)。幅・高さは TileGrid が決める */
  renderThumb: (item: T) => ReactNode;
  /** 右上(「未使用」/ 選択順の番号)。undefined を返せば無し */
  renderBadge?: (item: T) => ReactNode;
  selectionMode?: "none" | "single" | "multiple";
  selectedKeys?: ReadonlySet<string>;
  /** "all" は items 全部に展開する */
  onSelectionChange?: (keys: Set<string>) => void;
  /** タイルを押す(Enter / クリック)。multiple ではチェックボックス以外の領域 */
  onAction?: (id: string) => void;
  disabledKeys?: ReadonlySet<string>;
  /** md = 160px(一覧)、sm = 140px(ダイアログ)。間隔はどちらも space.inset */
  size?: "md" | "sm";
  /** グリッドの先頭に差し込む仮タイル(UploadTile の列) */
  leading?: ReactNode;
}

export function TileGrid<T extends TileItem>({
  label,
  items,
  renderThumb,
  renderBadge,
  selectionMode = "none",
  selectedKeys,
  onSelectionChange,
  onAction,
  disabledKeys,
  size = "md",
  leading,
}: TileGridProps<T>) {
  return (
    <div {...stylex.props(styles.grid, size === "sm" ? styles.colsSm : styles.colsMd)}>
      {leading}
      <GridList
        aria-label={label}
        items={items}
        layout="grid"
        selectionMode={selectionMode}
        selectionBehavior={selectionMode === "multiple" ? "toggle" : "replace"}
        {...(selectedKeys === undefined ? {} : { selectedKeys: new Set<string>(selectedKeys) })}
        {...(disabledKeys === undefined ? {} : { disabledKeys: new Set<string>(disabledKeys) })}
        // 選択が無いときだけ action、選択中はクリックで切り替え(RAC の既定を許容、V4-F Task 4 の裁定)
        {...(onAction === undefined ? {} : { onAction: (key) => onAction(String(key)) })}
        onSelectionChange={(selection: Selection) => {
          onSelectionChange?.(
            selection === "all"
              ? new Set(items.filter((item) => !disabledKeys?.has(item.id)).map((item) => item.id))
              : new Set([...selection].map(String)),
          );
        }}
        className={stylex.props(styles.list).className ?? ""}
      >
        {(item) => (
          <GridListItem
            id={item.id}
            textValue={item.textValue}
            className={stylexRenderProps<GridListItemRenderProps>((state) => [
              styles.tile,
              state.isDisabled && styles.tileDisabled,
            ])}
          >
            {(state) => {
              const badge = renderBadge?.(item);
              return (
                <>
                  <div
                    {...stylex.props(
                      styles.frame,
                      (state.isSelected || state.isFocusVisible) && styles.ring,
                    )}
                  >
                    {renderThumb(item)}
                    {selectionMode === "multiple" && (
                      <span {...stylex.props(styles.corner)}>
                        <RacCheckbox
                          slot="selection"
                          aria-label="選択"
                          {...stylex.props(styles.cornerBox)}
                        >
                          {(box: CheckboxRenderProps) => <CheckboxBox {...box} />}
                        </RacCheckbox>
                      </span>
                    )}
                    {selectionMode === "single" && (
                      <span
                        aria-hidden="true"
                        {...stylex.props(
                          styles.corner,
                          styles.radio,
                          state.isSelected && styles.radioOn,
                        )}
                      />
                    )}
                    {badge !== undefined && badge !== null && (
                      <span {...stylex.props(styles.badge)}>{badge}</span>
                    )}
                  </div>
                  <span {...stylex.props(styles.name)} title={item.textValue}>
                    {item.textValue}
                  </span>
                </>
              );
            }}
          </GridListItem>
        )}
      </GridList>
    </div>
  );
}
