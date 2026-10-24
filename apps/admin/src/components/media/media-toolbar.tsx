import * as stylex from "@stylexjs/stylex";
import { Button, SearchField, SegmentedControl } from "@plyrs/ui";
import { font, space, status, text } from "@plyrs/ui/semantic.stylex";
import { LayoutGrid, List } from "lucide-react";
import { MEDIA_KINDS, hasMediaFilters, DEFAULT_MEDIA_QUERY } from "../../lib/media-list";
import type { MediaKind, MediaQuery, MediaSort, MediaView } from "../../lib/media-list";
import { MEDIA_LABELS } from "../../lib/labels";
import { MediaFilterSelect } from "./media-filter-select";

const styles = stylex.create({
  root: { display: "flex", alignItems: "center", gap: space.sm, flexWrap: "wrap" },
  // F21: 検索は伸びるが 320px まで
  search: { flex: 1, minWidth: 0, maxWidth: "320px" },
  spacer: { marginInlineStart: "auto" },
  meta: { display: "flex", alignItems: "center", gap: space.sm },
  count: { fontSize: font.caption, color: text.muted },
  error: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.sm,
    fontSize: font.caption,
    color: status.danger,
  },
});

export interface MediaToolbarProps {
  query: MediaQuery;
  onQueryChange: (next: MediaQuery) => void;
  /** 絞り込み後の件数 */
  count: number;
  view: MediaView;
  onViewChange: (view: MediaView) => void;
  /** 未使用一覧の取得失敗(F7) */
  usageError: { onRetry: () => void } | null;
}

const KIND_ITEMS = [
  { value: "all", label: MEDIA_LABELS.kinds.all },
  ...MEDIA_KINDS.map((kind) => ({ value: kind, label: MEDIA_LABELS.kinds[kind] })),
];
const USAGE_ITEMS = [
  { value: "all", label: MEDIA_LABELS.usage.all },
  { value: "unused", label: MEDIA_LABELS.usage.unused },
];
const SORT_ITEMS = [
  { value: "newest", label: MEDIA_LABELS.sorts.newest },
  { value: "name", label: MEDIA_LABELS.sorts.name },
];
const VIEW_ITEMS = [
  { value: "grid", label: MEDIA_LABELS.views.grid, icon: LayoutGrid },
  { value: "list", label: MEDIA_LABELS.views.list, icon: List },
];

function isKind(value: string): value is MediaKind | "all" {
  return value === "all" || (MEDIA_KINDS as readonly string[]).includes(value);
}
function isSort(value: string): value is MediaSort {
  return value === "newest" || value === "name";
}
function isView(value: string): value is MediaView {
  return value === "grid" || value === "list";
}

export function MediaToolbar({
  query,
  onQueryChange,
  count,
  view,
  onViewChange,
  usageError,
}: MediaToolbarProps) {
  return (
    <div {...stylex.props(styles.root)}>
      <MediaFilterSelect
        label={MEDIA_LABELS.kindLabel}
        items={KIND_ITEMS}
        selectedValue={query.kind}
        onChange={(value) => {
          if (isKind(value)) onQueryChange({ ...query, kind: value });
        }}
      />
      <MediaFilterSelect
        label={MEDIA_LABELS.usageLabel}
        items={USAGE_ITEMS}
        selectedValue={query.usage}
        onChange={(value) => {
          if (value === "all" || value === "unused") onQueryChange({ ...query, usage: value });
        }}
      />
      <MediaFilterSelect
        label={MEDIA_LABELS.sortLabel}
        items={SORT_ITEMS}
        selectedValue={query.sort}
        onChange={(value) => {
          if (isSort(value)) onQueryChange({ ...query, sort: value });
        }}
      />
      <div {...stylex.props(styles.search)}>
        <SearchField
          label={MEDIA_LABELS.search}
          placeholder={MEDIA_LABELS.search}
          value={query.q}
          onChange={(q) => onQueryChange({ ...query, q })}
        />
      </div>
      <div {...stylex.props(styles.meta, styles.spacer)}>
        <span {...stylex.props(styles.count)}>
          {query.usage === "unused" ? MEDIA_LABELS.unusedCount(count) : MEDIA_LABELS.count(count)}
        </span>
        {usageError !== null && (
          <span role="alert" {...stylex.props(styles.error)}>
            {MEDIA_LABELS.usageFailed}
            <Button variant="link" size="sm" onPress={usageError.onRetry}>
              {MEDIA_LABELS.retry}
            </Button>
          </span>
        )}
        {hasMediaFilters(query) && (
          <Button
            variant="link"
            size="sm"
            onPress={() => onQueryChange({ ...DEFAULT_MEDIA_QUERY, sort: query.sort })}
          >
            {MEDIA_LABELS.clearFilters}
          </Button>
        )}
        <SegmentedControl
          label={MEDIA_LABELS.viewLabel}
          items={VIEW_ITEMS}
          value={view}
          onChange={(value) => {
            if (isView(value)) onViewChange(value);
          }}
        />
      </div>
    </div>
  );
}
