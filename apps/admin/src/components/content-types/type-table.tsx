import * as stylex from "@stylexjs/stylex";
import { Link, type LinkRenderProps } from "react-aria-components";
import { Button, Skeleton, SortableList, stylexRenderProps } from "@plyrs/ui";
import {
  bg,
  border,
  focus,
  font,
  radius,
  size,
  space,
  stroke,
  text,
} from "@plyrs/ui/semantic.stylex";
import type { TypeRow } from "../../lib/content-types";
import { CONTENT_TYPE_LABELS } from "../../lib/labels";

const NARROW = "@media (max-width: 959px)";

// 列幅(フィールド 110px・コンテンツ 120px・操作 180px)は、この表だけの部品固有の寸法
const styles = stylex.create({
  frame: {
    borderWidth: stroke.default,
    borderStyle: "solid",
    borderColor: border.default,
    borderRadius: radius.container,
    overflow: "hidden",
    backgroundColor: bg.surface,
    fontFamily: font.family,
  },
  header: {
    display: "grid",
    gridTemplateColumns: {
      default: "1fr 110px 120px 180px",
      [NARROW]: "1fr 120px 180px",
    },
    columnGap: space.sm,
    alignItems: "center",
    // つまみ(size.controlSm)と行の gap の分だけ左を空けて、行の中身と列を揃える
    paddingInlineStart: `calc(${space.inset} + ${size.controlSm} + ${space.sm})`,
    paddingInlineEnd: space.inset,
    minHeight: size.rowCompact,
    backgroundColor: bg.canvas,
    color: text.muted,
    fontSize: font.caption,
    fontWeight: font.weightMedium,
  },
  headerNoHandle: { paddingInlineStart: space.inset },
  headerRight: { textAlign: "right" },
  hideOnNarrow: { display: { default: "block", [NARROW]: "none" } },
  row: {
    display: "grid",
    gridTemplateColumns: {
      default: "1fr 110px 120px 180px",
      [NARROW]: "1fr 120px 180px",
    },
    columnGap: space.sm,
    alignItems: "center",
    width: "100%",
  },
  nameCell: { display: "flex", flexDirection: "column", minWidth: 0 },
  name: {
    color: text.default,
    fontWeight: font.weightMedium,
    textDecoration: { default: "none", ":hover": "underline" },
    borderRadius: radius.small,
    outline: "none",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  sub: {
    color: text.muted,
    fontSize: font.caption,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  mono: { fontFamily: font.familyMono },
  muted: { color: text.muted },
  actions: { display: "flex", justifyContent: "flex-end", alignItems: "center", gap: space.sm },
  editLink: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    height: size.controlSm,
    paddingInline: space.inset,
    fontSize: font.caption,
    fontWeight: font.weightMedium,
    whiteSpace: "nowrap",
    color: text.default,
    textDecoration: "none",
    backgroundColor: { default: bg.canvas, ":hover": bg.hover },
    borderWidth: stroke.default,
    borderStyle: "solid",
    borderColor: { default: border.default, ":hover": border.hover },
    borderRadius: radius.button,
    cursor: "pointer",
    outline: "none",
  },
  linkFocus: {
    outlineWidth: stroke.focus,
    outlineStyle: "solid",
    outlineColor: focus.ring,
    outlineOffset: stroke.focus,
  },
});

export interface TypeTableProps {
  rows: readonly TypeRow[];
  slug: string;
  /** false: つまみ無し、削除・編集の代わりに「フィールドを見る」 */
  canManage: boolean;
  /** true: 並べ替えを無効にする(保存中) */
  isReordering: boolean;
  onReorder: (orderedKeys: string[]) => void;
  onDelete: (row: TypeRow) => void;
}

interface Item {
  id: string;
  textValue: string;
  typeRow: TypeRow;
}

// 案 E 5.1(E6・E7): コンテンツタイプの表。行は SortableList、見出しの行は別に描く
export function TypeTable({
  rows,
  slug,
  canManage,
  isReordering,
  onReorder,
  onDelete,
}: TypeTableProps) {
  const labels = CONTENT_TYPE_LABELS;
  const items: Item[] = rows.map((typeRow) => ({
    id: typeRow.row.key,
    textValue: typeRow.row.name,
    typeRow,
  }));
  const editHref = (key: string) => `/t/${slug}/settings/content-types/${key}/edit`;
  return (
    <div {...stylex.props(styles.frame)}>
      <div aria-hidden="true" {...stylex.props(styles.header, !canManage && styles.headerNoHandle)}>
        <span>{labels.columns.name}</span>
        <span {...stylex.props(styles.hideOnNarrow)}>{labels.columns.fields}</span>
        <span>{labels.columns.contents}</span>
        <span {...stylex.props(styles.headerRight)}>{labels.columns.actions}</span>
      </div>
      <SortableList
        label={labels.tableLabel}
        items={items}
        isDisabled={!canManage}
        isBusy={isReordering}
        dragLabel={(item) => labels.dragLabel(item.typeRow.row.name)}
        onReorder={onReorder}
        renderItem={({ typeRow }) => {
          const { row, count, canDelete } = typeRow;
          return (
            <div {...stylex.props(styles.row)}>
              <div {...stylex.props(styles.nameCell)}>
                <Link
                  href={editHref(row.key)}
                  className={stylexRenderProps<LinkRenderProps>((state) => [
                    styles.name,
                    state.isFocusVisible && styles.linkFocus,
                  ])}
                >
                  {row.name}
                </Link>
                <span {...stylex.props(styles.sub)}>
                  {row.description === null || row.description === "" ? null : (
                    <>
                      {row.description}
                      {labels.separator}
                    </>
                  )}
                  <span {...stylex.props(styles.mono)}>{labels.apiName(row.key)}</span>
                </span>
              </div>
              <span {...stylex.props(styles.hideOnNarrow)}>{row.fields.length}</span>
              <span {...stylex.props(count === 0 && styles.muted)}>
                {count === null ? <Skeleton height={14} width="40px" /> : labels.count(count)}
              </span>
              <div {...stylex.props(styles.actions)}>
                {canDelete && canManage ? (
                  <Button variant="dangerLink" size="sm" onPress={() => onDelete(typeRow)}>
                    {labels.delete}
                  </Button>
                ) : null}
                <Link
                  href={editHref(row.key)}
                  className={stylexRenderProps<LinkRenderProps>((state) => [
                    styles.editLink,
                    state.isFocusVisible && styles.linkFocus,
                  ])}
                >
                  {canManage ? labels.edit : labels.viewFields}
                </Link>
              </div>
            </div>
          );
        }}
      />
    </div>
  );
}
