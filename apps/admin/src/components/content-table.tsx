import * as stylex from "@stylexjs/stylex";
import { Button, Cell, Column, RelativeTime, Row, Table, TableBody, TableHeader } from "@plyrs/ui";
import { accent, font, space, status } from "@plyrs/ui/semantic.stylex";
import { CircleAlert } from "lucide-react";
import { Link, type Selection } from "react-aria-components";
import { LIST_SORTS, type ListRow, type ListSort, type SortOrder } from "../lib/content-list";
import { formatDateTime } from "../lib/datetime";
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
  /** aria-label「{型名}の一覧」に使う型の表示名。省略時は typeKey */
  typeName?: string;
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

const COLUMNS = [
  { id: "title", sortable: true, narrow: false },
  { id: "publication", sortable: false, narrow: false },
  { id: "status", sortable: false, narrow: true },
  { id: "updated", sortable: true, narrow: true },
] as const;

function isListSort(value: unknown): value is ListSort {
  return (LIST_SORTS as readonly unknown[]).includes(value);
}

export function ContentTable({
  tenantSlug,
  typeKey,
  typeName,
  rows,
  sort,
  onSortChange,
  selection,
  failedIds,
  canWrite,
  onDelete,
  now,
}: ContentTableProps) {
  const handleSelection = (keys: Selection) => {
    if (selection === undefined) return;
    selection.onSelectionChange(
      keys === "all" ? new Set(rows.map((r) => r.record.id)) : new Set(Array.from(keys, String)),
    );
  };
  return (
    <Table
      aria-label={LIST_LABELS.tableLabel(typeName ?? typeKey)}
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
      <TableHeader columns={COLUMNS}>
        {(c) => (
          <Column
            id={c.id}
            isRowHeader={c.id === "title"}
            allowsSorting={c.sortable}
            hideOnNarrow={c.narrow}
          >
            {LIST_LABELS.columns[c.id]}
          </Column>
        )}
      </TableHeader>
      <TableBody items={rows.map((r) => ({ ...r, id: r.record.id }))}>
        {(row) => {
          const href = `/t/${tenantSlug}/content/${typeKey}/${row.record.id}`;
          return (
            <Row id={row.record.id} columns={COLUMNS}>
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
                if (c.id === "publication") {
                  return (
                    <Cell>
                      <span {...stylex.props(styles.publication)}>
                        <PublicationBadge state={row.publication} />
                        {failedIds.has(row.record.id) && (
                          <span {...stylex.props(styles.failed)}>
                            <CircleAlert size={16} aria-hidden="true" />
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
