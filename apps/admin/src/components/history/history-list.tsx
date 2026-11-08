import * as stylex from "@stylexjs/stylex";
import { Badge, Button, RelativeTime } from "@plyrs/ui";
import { accent, bg, border, font, radius, space, text } from "@plyrs/ui/semantic.stylex";
import { formatDateTime } from "../../lib/datetime";
import {
  kindLabel,
  summarizeEntry,
  viaLabel,
  type HistorySelection,
  type MemberName,
} from "../../lib/history";
import type { HistoryEntry } from "../../lib/api-contracts";
import { HISTORY_LABELS } from "../../lib/labels";

const styles = stylex.create({
  list: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    display: "flex",
    flexDirection: "column",
    gap: space.xs,
  },
  item: {
    display: "flex",
    flexDirection: "column",
    alignItems: "stretch",
    gap: space.xs,
    width: "100%",
    padding: space.sm,
    textAlign: "left",
    fontFamily: font.family,
    fontSize: font.body,
    color: text.default,
    backgroundColor: { default: bg.surface, ":hover": bg.hover },
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: border.default,
    borderRadius: radius.control,
    cursor: "pointer",
  },
  selected: { borderColor: accent.default, backgroundColor: accent.surface },
  row: { display: "flex", alignItems: "center", gap: space.xs, flexWrap: "wrap" },
  summary: { margin: 0 },
  time: { fontSize: font.caption, color: text.muted },
  more: { marginTop: space.sm },
});

export interface PublishedRow {
  sourceVersion: number;
  publishedAt: string;
}

export interface HistoryListProps {
  entries: readonly HistoryEntry[];
  /** 公開版があれば一覧の先頭に疑似行として出す */
  published: PublishedRow | null;
  selected: HistorySelection | null;
  onSelect: (selection: HistorySelection) => void;
  members?: readonly MemberName[];
  hasMore: boolean;
  isLoadingMore: boolean;
  onLoadMore: () => void;
}

function isSelected(selected: HistorySelection | null, candidate: HistorySelection): boolean {
  if (selected === null || selected.kind !== candidate.kind) return false;
  return (
    candidate.kind === "published" ||
    selected.kind !== "history" ||
    selected.historySeq === candidate.historySeq
  );
}

function kindTone(kind: HistoryEntry["kind"]) {
  switch (kind) {
    case "publish":
      return "success";
    case "unpublish":
    case "delete":
      return "warning";
    case "restore":
      return "accent";
    case "write":
      return "neutral";
  }
}

// 版の一覧(左列)。選択は aria-pressed のボタンで表す(ラジオにすると矢印キーで即選択が走る)
export function HistoryList({
  entries,
  published,
  selected,
  onSelect,
  members = [],
  hasMore,
  isLoadingMore,
  onLoadMore,
}: HistoryListProps) {
  return (
    <div>
      <ul aria-label={HISTORY_LABELS.listLabel} {...stylex.props(styles.list)}>
        {published !== null && (
          <li>
            <button
              type="button"
              aria-pressed={isSelected(selected, { kind: "published" })}
              onClick={() => onSelect({ kind: "published" })}
              {...stylex.props(
                styles.item,
                isSelected(selected, { kind: "published" }) && styles.selected,
              )}
            >
              <span {...stylex.props(styles.row)}>
                <Badge tone="success" dot>
                  {HISTORY_LABELS.published}
                </Badge>
                <span {...stylex.props(styles.time)}>
                  {HISTORY_LABELS.version(published.sourceVersion)}
                </span>
              </span>
              <span {...stylex.props(styles.time)}>
                {HISTORY_LABELS.publishedAt(formatDateTime(published.publishedAt).absolute)}
              </span>
            </button>
          </li>
        )}
        {entries.map((entry) => {
          const candidate: HistorySelection = { kind: "history", historySeq: entry.historySeq };
          const pressed = isSelected(selected, candidate);
          return (
            <li key={entry.historySeq}>
              <button
                type="button"
                aria-pressed={pressed}
                onClick={() => onSelect(candidate)}
                {...stylex.props(styles.item, pressed && styles.selected)}
              >
                <span {...stylex.props(styles.row)}>
                  <Badge tone={kindTone(entry.kind)}>{kindLabel(entry.kind)}</Badge>
                  <Badge isMonospace>{viaLabel(entry.via)}</Badge>
                  <span {...stylex.props(styles.time)}>
                    {HISTORY_LABELS.version(entry.version)}
                  </span>
                </span>
                <span {...stylex.props(styles.summary)}>{summarizeEntry(entry, members)}</span>
                <span {...stylex.props(styles.time)}>
                  <RelativeTime value={formatDateTime(entry.updatedAt)} />
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {hasMore && (
        <div {...stylex.props(styles.more)}>
          <Button variant="secondary" size="sm" isDisabled={isLoadingMore} onPress={onLoadMore}>
            {HISTORY_LABELS.loadMore}
          </Button>
        </div>
      )}
    </div>
  );
}
