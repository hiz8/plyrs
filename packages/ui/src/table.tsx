import * as stylex from "@stylexjs/stylex";
import { ChevronDown, ChevronsUpDown, ChevronUp } from "lucide-react";
import {
  Cell as RacCell,
  Checkbox as RacCheckbox,
  Collection,
  Column as RacColumn,
  Row as RacRow,
  Table as RacTable,
  TableBody as RacTableBody,
  TableHeader as RacTableHeader,
  useTableOptions,
  type CellProps,
  type CellRenderProps,
  type ColumnProps,
  type ColumnRenderProps,
  type RowProps,
  type RowRenderProps,
  type SortDirection,
  type TableBodyProps,
  type TableHeaderProps,
  type TableProps,
} from "react-aria-components";
import { CheckboxBox } from "./checkbox";
import { stylexRenderProps } from "./compose";
import { ICON_SIZE } from "./icon";
import { accent, bg, border, focus, font, size, space, stroke, text } from "./semantic.stylex";

// D1 ボード 3d / 案 D 5 章: 行 44px・見出し 40px、選択行は accent.surface、ホバーは bg.hover。
// 幅 960px 未満では hideOnNarrow の列を隠す(h-common-surface.md 10 章)
const NARROW = "@media (max-width: 959px)";

const styles = stylex.create({
  table: {
    width: "100%",
    borderCollapse: "collapse",
    fontFamily: font.family,
    fontSize: font.body,
    color: text.default,
  },
  column: {
    height: size.rowCompact,
    paddingInline: space.inset,
    textAlign: "start",
    fontSize: font.caption,
    fontWeight: font.weightMedium,
    color: text.muted,
    whiteSpace: "nowrap",
    borderBottomWidth: stroke.default,
    borderBottomStyle: "solid",
    borderBottomColor: border.default,
    outline: "none",
  },
  sortable: { cursor: "pointer" },
  sorted: { color: text.default },
  columnInner: { display: "inline-flex", alignItems: "center", gap: space.xs },
  sortIdle: { display: "inline-flex", opacity: 0.5 },
  sortActive: { display: "inline-flex" },
  // 部品固有の幅(D1 ボード 3d の先頭列)
  selection: { width: "32px", paddingInline: space.inset },
  row: { height: size.row, outline: "none" },
  rowHovered: { backgroundColor: bg.hover },
  rowSelected: { backgroundColor: accent.surface },
  cell: {
    paddingInline: space.inset,
    verticalAlign: "middle",
    borderBottomWidth: stroke.default,
    borderBottomStyle: "solid",
    borderBottomColor: border.default,
    outline: "none",
  },
  focusVisible: {
    outlineWidth: stroke.focus,
    outlineStyle: "solid",
    outlineColor: focus.ring,
    outlineOffset: `calc(-1 * ${stroke.focus})`,
  },
  hideOnNarrow: { display: { default: null, [NARROW]: "none" } },
  checkbox: { display: "inline-flex", cursor: "pointer" },
});

function SelectionCheckbox() {
  return (
    <RacCheckbox slot="selection" className={stylex.props(styles.checkbox).className ?? ""}>
      {(state) => <CheckboxBox {...state} />}
    </RacCheckbox>
  );
}

function SortIcon({ direction }: { direction: SortDirection | undefined }) {
  if (direction === undefined) {
    return (
      <span {...stylex.props(styles.sortIdle)}>
        <ChevronsUpDown size={ICON_SIZE.inline} aria-hidden="true" />
      </span>
    );
  }
  const Icon = direction === "ascending" ? ChevronUp : ChevronDown;
  return (
    <span {...stylex.props(styles.sortActive)}>
      <Icon size={ICON_SIZE.inline} aria-hidden="true" />
    </span>
  );
}

export function Table(props: Omit<TableProps, "className" | "style">) {
  return <RacTable {...props} className={stylex.props(styles.table).className ?? ""} />;
}

export function TableHeader<T extends object>({
  columns,
  children,
}: Omit<TableHeaderProps<T>, "className" | "style">) {
  const { selectionBehavior, selectionMode } = useTableOptions();
  return (
    <RacTableHeader>
      {selectionMode !== "none" && selectionBehavior === "toggle" && (
        <RacColumn className={stylex.props(styles.column, styles.selection).className ?? ""}>
          {selectionMode === "multiple" && <SelectionCheckbox />}
        </RacColumn>
      )}
      <Collection items={columns}>{children}</Collection>
    </RacTableHeader>
  );
}

export interface TableColumnProps extends Omit<ColumnProps, "className" | "style" | "children"> {
  children: string;
  hideOnNarrow?: boolean;
}

export function Column({ children, hideOnNarrow, ...props }: TableColumnProps) {
  return (
    <RacColumn
      {...props}
      className={stylexRenderProps<ColumnRenderProps>((state) => [
        styles.column,
        state.allowsSorting && styles.sortable,
        state.sortDirection !== undefined && styles.sorted,
        state.isFocusVisible && styles.focusVisible,
        hideOnNarrow === true && styles.hideOnNarrow,
      ])}
    >
      {({ allowsSorting, sortDirection }) => (
        <span {...stylex.props(styles.columnInner)}>
          {children}
          {allowsSorting && <SortIcon direction={sortDirection} />}
        </span>
      )}
    </RacColumn>
  );
}

export function TableBody<T extends object>(props: Omit<TableBodyProps<T>, "className" | "style">) {
  return <RacTableBody {...props} />;
}

export function Row<T extends object>({
  id,
  columns,
  children,
  ...props
}: Omit<RowProps<T>, "className" | "style">) {
  const { selectionBehavior, selectionMode } = useTableOptions();
  return (
    <RacRow
      id={id}
      {...props}
      className={stylexRenderProps<RowRenderProps>((state) => [
        styles.row,
        state.isHovered && styles.rowHovered,
        state.isSelected && styles.rowSelected,
        state.isFocusVisible && styles.focusVisible,
      ])}
    >
      {selectionMode !== "none" && selectionBehavior === "toggle" && (
        <RacCell className={stylex.props(styles.cell, styles.selection).className ?? ""}>
          <SelectionCheckbox />
        </RacCell>
      )}
      <Collection items={columns}>{children}</Collection>
    </RacRow>
  );
}

export interface TableCellProps extends Omit<CellProps, "className" | "style"> {
  hideOnNarrow?: boolean;
}

export function Cell({ hideOnNarrow, ...props }: TableCellProps) {
  return (
    <RacCell
      {...props}
      className={stylexRenderProps<CellRenderProps>((state) => [
        styles.cell,
        state.isFocusVisible && styles.focusVisible,
        hideOnNarrow === true && styles.hideOnNarrow,
      ])}
    />
  );
}
