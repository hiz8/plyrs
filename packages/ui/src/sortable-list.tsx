import * as stylex from "@stylexjs/stylex";
import { GripVertical } from "lucide-react";
import type { ReactNode } from "react";
import {
  Button,
  DropIndicator,
  GridList,
  GridListItem,
  useDragAndDrop,
  type ButtonRenderProps,
  type GridListItemRenderProps,
} from "react-aria-components";
import { stylexRenderProps } from "./compose";
import { ICON_SIZE } from "./icon";
import {
  accent,
  bg,
  border,
  elevation,
  focus,
  font,
  radius,
  size,
  space,
  stroke,
  text,
} from "./semantic.stylex";

// E1: 並べ替えのできる行の列。外枠は呼び出し側。つまみ(slot="drag")でつかみ、キーボードでも並べ替えられる
const styles = stylex.create({
  list: { display: "flex", flexDirection: "column", fontFamily: font.family, outline: "none" },
  row: {
    display: "flex",
    alignItems: "center",
    gap: space.sm,
    paddingInline: space.inset,
    minHeight: size.row,
    fontSize: font.body,
    color: text.default,
    outline: "none",
    borderTopWidth: stroke.default,
    borderTopStyle: "solid",
    borderTopColor: border.default,
  },
  rowTall: { minHeight: "48px" },
  rowFirst: { borderTopWidth: 0 },
  rowDragging: { backgroundColor: bg.raised, boxShadow: elevation.menu, opacity: 0.9 },
  focusVisible: {
    outlineWidth: stroke.focus,
    outlineStyle: "solid",
    outlineColor: focus.ring,
    outlineOffset: `calc(${stroke.focus} * -1)`,
  },
  handle: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    width: size.controlSm,
    height: size.controlSm,
    padding: 0,
    color: text.muted,
    backgroundColor: "transparent",
    borderWidth: 0,
    borderRadius: radius.button,
    cursor: "grab",
    outline: "none",
  },
  handleFocusVisible: {
    outlineWidth: stroke.focus,
    outlineStyle: "solid",
    outlineColor: focus.ring,
    outlineOffset: stroke.focus,
  },
  content: { flex: 1, minWidth: 0 },
  indicator: {
    height: space.xs,
    borderTopWidth: "2px",
    borderTopStyle: "dashed",
    borderTopColor: accent.default,
  },
  indicatorHidden: { display: "none" },
});

export interface SortableItem {
  id: string;
  textValue: string;
}

export interface SortableListProps<T extends SortableItem> {
  /** GridList の aria-label */
  label: string;
  items: readonly T[];
  /** つまみの右に描く中身(幅いっぱい) */
  renderItem: (item: T) => ReactNode;
  /** つまみの aria-label(「{名前}を並べ替え」) */
  dragLabel: (item: T) => string;
  /** ドロップ後の id の並び(全件) */
  onReorder: (orderedIds: string[]) => void;
  /** true: DnD を無効にし、つまみを描かない(読み取り専用・保存中) */
  isDisabled?: boolean;
  /** default = size.row(44px)、tall = 48px(フィールドの行) */
  rowHeight?: "default" | "tall";
}

/** moving を抜いてから targetId の前 / 後に挿す("on" は "after" と同じ)。targetId が moving に含まれるときは元の並び */
export function reorderIds(
  ids: readonly string[],
  moving: readonly string[],
  targetId: string,
  position: "before" | "after" | "on",
): string[] {
  if (moving.includes(targetId)) return [...ids];
  const moved = ids.filter((id) => moving.includes(id));
  const rest = ids.filter((id) => !moving.includes(id));
  const at = rest.indexOf(targetId);
  if (at < 0) return [...ids];
  const index = position === "before" ? at : at + 1;
  return [...rest.slice(0, index), ...moved, ...rest.slice(index)];
}

export function SortableList<T extends SortableItem>({
  label,
  items,
  renderItem,
  dragLabel,
  onReorder,
  isDisabled = false,
  rowHeight = "default",
}: SortableListProps<T>) {
  const { dragAndDropHooks } = useDragAndDrop({
    getItems: (keys) =>
      [...keys].map((key) => ({
        "text/plain": items.find((item) => item.id === key)?.textValue ?? "",
      })),
    onReorder: (e) => {
      onReorder(
        reorderIds(
          items.map((item) => item.id),
          [...e.keys].map(String),
          String(e.target.key),
          e.target.dropPosition,
        ),
      );
    },
    renderDropIndicator: (target) => (
      <DropIndicator
        target={target}
        className={stylexRenderProps<{ isDropTarget: boolean }>((state) => [
          styles.indicator,
          !state.isDropTarget && styles.indicatorHidden,
        ])}
      />
    ),
  });

  return (
    <GridList
      // DnD の有無でフックの数が変わるため、切り替えでは作り直す
      key={isDisabled ? "static" : "sortable"}
      aria-label={label}
      items={items}
      selectionMode="none"
      layout="stack"
      dragAndDropHooks={isDisabled ? undefined : dragAndDropHooks}
      className={stylex.props(styles.list).className ?? ""}
    >
      {(item) => (
        <GridListItem
          id={item.id}
          textValue={item.textValue}
          className={stylexRenderProps<GridListItemRenderProps>((state) => [
            styles.row,
            rowHeight === "tall" && styles.rowTall,
            items[0]?.id === item.id && styles.rowFirst,
            state.isDragging && styles.rowDragging,
            state.isFocusVisible && styles.focusVisible,
          ])}
        >
          {!isDisabled && (
            <Button
              slot="drag"
              aria-label={dragLabel(item)}
              className={stylexRenderProps<ButtonRenderProps>((state) => [
                styles.handle,
                state.isFocusVisible && styles.handleFocusVisible,
              ])}
            >
              <GripVertical size={ICON_SIZE.inline} aria-hidden="true" />
            </Button>
          )}
          <div {...stylex.props(styles.content)}>{renderItem(item)}</div>
        </GridListItem>
      )}
    </GridList>
  );
}
