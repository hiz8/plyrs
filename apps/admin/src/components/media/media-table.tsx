import * as stylex from "@stylexjs/stylex";
import { Badge, Cell, Column, RelativeTime, Row, Table, TableBody, TableHeader } from "@plyrs/ui";
import { font, space, text } from "@plyrs/ui/semantic.stylex";
import { Link, type Selection } from "react-aria-components";
import { formatDateTime } from "../../lib/datetime";
import { MEDIA_LABELS } from "../../lib/labels";
import { formatBytes } from "../../lib/media-list";
import { MediaThumb } from "./media-thumb";
import type { MediaGridProps } from "./media-grid";
import type { MediaThumbProps } from "./media-thumb";
import type { MediaRow } from "../../lib/media-list";

const styles = stylex.create({
  name: {
    display: "block",
    maxWidth: "100%",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontFamily: font.familyMono,
    fontWeight: font.weightMedium,
    color: "inherit",
    textDecoration: "none",
  },
  alt: {
    marginTop: space.xs,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontSize: font.caption,
    color: text.muted,
  },
  mono: { fontFamily: font.familyMono },
  // F20: サムネイル列は 56px(40px のサムネイル + 余白)
  thumb: { width: "56px" },
});

export interface MediaTableProps {
  tenantSlug: string;
  rows: readonly MediaRow[];
  resolveUrl: MediaThumbProps["resolveUrl"];
  orphanIds: ReadonlySet<string> | null;
  selection: MediaGridProps["selection"];
  now?: Date;
}

const COLUMNS = [
  { id: "thumb", narrow: false },
  { id: "name", narrow: false },
  { id: "kind", narrow: true },
  { id: "size", narrow: true },
  { id: "uploaded", narrow: true },
  { id: "usage", narrow: false },
] as const;

export function MediaTable({
  tenantSlug,
  rows,
  resolveUrl,
  orphanIds,
  selection,
  now,
}: MediaTableProps) {
  const handleSelection = (keys: Selection) => {
    if (selection === undefined) return;
    selection.onSelectionChange(
      keys === "all" ? new Set(rows.map((row) => row.id)) : new Set(Array.from(keys, String)),
    );
  };
  return (
    <Table
      aria-label={MEDIA_LABELS.tableLabel}
      selectionMode={selection === undefined ? "none" : "multiple"}
      selectionBehavior="toggle"
      selectedKeys={selection === undefined ? new Set<string>() : selection.selectedKeys}
      onSelectionChange={handleSelection}
      disabledKeys={selection?.isDisabled === true ? rows.map((row) => row.id) : new Set<string>()}
    >
      <TableHeader columns={COLUMNS}>
        {(c) => (
          <Column
            id={c.id}
            isRowHeader={c.id === "name"}
            hideOnNarrow={c.narrow}
            isLabelHidden={c.id === "thumb"}
          >
            {MEDIA_LABELS.columns[c.id]}
          </Column>
        )}
      </TableHeader>
      <TableBody items={rows}>
        {(row) => (
          <Row id={row.id} columns={COLUMNS}>
            {(c) => {
              switch (c.id) {
                case "thumb":
                  return (
                    <Cell>
                      <div {...stylex.props(styles.thumb)}>
                        <MediaThumb row={row} resolveUrl={resolveUrl} size="xs" />
                      </div>
                    </Cell>
                  );
                case "name":
                  return (
                    <Cell>
                      <Link
                        href={`/t/${tenantSlug}/media/${row.id}`}
                        {...stylex.props(styles.name)}
                      >
                        {row.filename}
                      </Link>
                      <div {...stylex.props(styles.alt)}>
                        {row.alt === "" ? MEDIA_LABELS.noAlt : row.alt}
                      </div>
                    </Cell>
                  );
                case "kind":
                  return <Cell hideOnNarrow>{MEDIA_LABELS.kinds[row.kind]}</Cell>;
                case "size":
                  return (
                    <Cell hideOnNarrow>
                      <span {...stylex.props(styles.mono)}>{formatBytes(row.size)}</span>
                    </Cell>
                  );
                case "uploaded":
                  return (
                    <Cell hideOnNarrow>
                      {row.uploadedAt === null ? (
                        MEDIA_LABELS.usageUnknown
                      ) : (
                        <RelativeTime
                          value={formatDateTime(row.uploadedAt, now === undefined ? {} : { now })}
                        />
                      )}
                    </Cell>
                  );
                case "usage":
                  return (
                    <Cell>
                      {orphanIds === null ? (
                        MEDIA_LABELS.usageUnknown
                      ) : orphanIds.has(row.id) ? (
                        <Badge tone="warning">{MEDIA_LABELS.unused}</Badge>
                      ) : (
                        <Badge tone="success">{MEDIA_LABELS.inUse}</Badge>
                      )}
                    </Cell>
                  );
              }
            }}
          </Row>
        )}
      </TableBody>
    </Table>
  );
}
