import * as stylex from "@stylexjs/stylex";
import {
  Button,
  Cell,
  Column,
  ICON_SIZE,
  RelativeTime,
  Row,
  Table,
  TableBody,
  TableHeader,
} from "@plyrs/ui";
import { accent, font, space, status } from "@plyrs/ui/semantic.stylex";
import { CircleAlert } from "lucide-react";
import type { ContentTypeDefinition } from "@plyrs/metamodel";
import { Link, type Selection } from "react-aria-components";
import { LIST_SORTS, type ListRow, type ListSort, type SortOrder } from "../lib/content-list";
import { formatDateTime } from "../lib/datetime";
import { listColumnsOf, rowCells, type ListColumn } from "../lib/list-cells";
import { LIST_LABELS } from "../lib/labels";
import { PublicationBadge, WorkflowStatusBadge } from "./publication-badge";

const styles = stylex.create({
  title: {
    display: "block",
    maxWidth: "100%",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontWeight: font.weightMedium,
    color: "inherit",
    textDecoration: "none",
  },
  fieldCell: {
    display: "block",
    maxWidth: "100%",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  mono: { fontFamily: font.familyMono },
  actions: { display: "flex", alignItems: "center", gap: space.inset, fontSize: font.caption },
  edit: { color: accent.default },
  publication: { display: "inline-flex", alignItems: "center", gap: space.sm },
  failed: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.xs,
    fontSize: font.caption,
    fontWeight: font.weightMedium,
    color: status.danger,
  },
});

export interface ContentTableProps {
  tenantSlug: string;
  typeKey: string;
  /** aria-label「{型名}の一覧」に使う型の表示名(API 名は出さない) */
  typeName: string;
  /** 追加列(listColumns)の定義元(K2) */
  contentType: ContentTypeDefinition;
  rows: readonly ListRow[];
  sort: { column: ListSort; order: SortOrder };
  onSortChange: (column: ListSort, order: SortOrder) => void;
  /** undefined = 選択列なし(閲覧者) */
  selection:
    | {
        selectedKeys: ReadonlySet<string>;
        onSelectionChange: (keys: Set<string>) => void;
        isDisabled: boolean;
      }
    | undefined;
  failedIds: ReadonlySet<string>;
  canWrite: boolean;
  onDelete: (row: ListRow) => void;
  now?: Date;
}

type FixedColumnId = keyof typeof LIST_LABELS.columns;
interface TableColumn {
  id: string;
  sortable: boolean;
  narrow: boolean;
  label: string;
  /** 型の追加列(listColumns)なら定義 */
  field?: ListColumn;
}

const fixed = (id: FixedColumnId, sortable: boolean, narrow: boolean): TableColumn => ({
  id,
  sortable,
  narrow,
  label: LIST_LABELS.columns[id],
});

// K2: タイトル | 型の追加列(並べ替え無し・狭い画面で隠す) | 公開 | ステータス | 更新
function columnsOf(contentType: ContentTypeDefinition): TableColumn[] {
  return [
    fixed("title", true, false),
    ...listColumnsOf(contentType).map((field) => ({
      id: `field:${field.key}`,
      sortable: false,
      narrow: true,
      label: field.label,
      field,
    })),
    fixed("publication", false, false),
    fixed("status", false, true),
    fixed("updated", true, true),
  ];
}

function isListSort(value: unknown): value is ListSort {
  return (LIST_SORTS as readonly unknown[]).includes(value);
}

export function ContentTable({
  tenantSlug,
  typeKey,
  typeName,
  contentType,
  rows,
  sort,
  onSortChange,
  selection,
  failedIds,
  canWrite,
  onDelete,
  now,
}: ContentTableProps) {
  const columns = columnsOf(contentType);
  const handleSelection = (keys: Selection) => {
    if (selection === undefined) return;
    selection.onSelectionChange(
      keys === "all" ? new Set(rows.map((r) => r.record.id)) : new Set(Array.from(keys, String)),
    );
  };
  return (
    <Table
      aria-label={LIST_LABELS.tableLabel(typeName)}
      selectionMode={selection === undefined ? "none" : "multiple"}
      selectionBehavior="toggle"
      selectedKeys={selection === undefined ? new Set<string>() : selection.selectedKeys}
      onSelectionChange={handleSelection}
      disabledKeys={
        selection?.isDisabled === true ? rows.map((r) => r.record.id) : new Set<string>()
      }
      sortDescriptor={{
        column: sort.column,
        direction: sort.order === "asc" ? "ascending" : "descending",
      }}
      onSortChange={(d) => {
        if (isListSort(d.column)) {
          onSortChange(d.column, d.direction === "ascending" ? "asc" : "desc");
        }
      }}
    >
      <TableHeader columns={columns}>
        {(c) => (
          <Column
            id={c.id}
            isRowHeader={c.id === "title"}
            allowsSorting={c.sortable}
            hideOnNarrow={c.narrow}
          >
            {c.label}
          </Column>
        )}
      </TableHeader>
      <TableBody items={rows.map((r) => ({ ...r, id: r.record.id }))}>
        {(row) => {
          const href = `/t/${tenantSlug}/content/${typeKey}/${row.record.id}`;
          return (
            <Row id={row.record.id} columns={columns}>
              {(c) => {
                if (c.id === "title") {
                  return (
                    <Cell>
                      <Link href={href} {...stylex.props(styles.title)}>
                        {row.title}
                      </Link>
                      <div data-row-actions="" {...stylex.props(styles.actions)}>
                        {canWrite ? (
                          <>
                            <Link href={href} {...stylex.props(styles.edit)}>
                              {LIST_LABELS.rowActions.edit}
                            </Link>
                            <Button variant="dangerLink" size="sm" onPress={() => onDelete(row)}>
                              {LIST_LABELS.rowActions.delete}
                            </Button>
                          </>
                        ) : (
                          <Link href={href} {...stylex.props(styles.edit)}>
                            {LIST_LABELS.rowActions.view}
                          </Link>
                        )}
                      </div>
                    </Cell>
                  );
                }
                if (c.field !== undefined) {
                  const text = rowCells(contentType, row.record, [c.field])[0] ?? "";
                  return (
                    <Cell hideOnNarrow>
                      <span
                        title={text}
                        {...stylex.props(styles.fieldCell, c.field.mono && styles.mono)}
                      >
                        {text}
                      </span>
                    </Cell>
                  );
                }
                if (c.id === "publication") {
                  return (
                    <Cell>
                      <span {...stylex.props(styles.publication)}>
                        <PublicationBadge state={row.publication} />
                        {failedIds.has(row.record.id) && (
                          <span {...stylex.props(styles.failed)}>
                            <CircleAlert size={ICON_SIZE.inline} aria-hidden="true" />
                            {LIST_LABELS.failed}
                          </span>
                        )}
                      </span>
                    </Cell>
                  );
                }
                if (c.id === "status") {
                  return (
                    <Cell hideOnNarrow>
                      <WorkflowStatusBadge status={row.record.status} />
                    </Cell>
                  );
                }
                return (
                  <Cell hideOnNarrow>
                    <RelativeTime
                      value={formatDateTime(row.record.updatedAt, now === undefined ? {} : { now })}
                    />
                  </Cell>
                );
              }}
            </Row>
          );
        }}
      </TableBody>
    </Table>
  );
}
