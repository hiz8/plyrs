import * as stylex from "@stylexjs/stylex";
import { SearchField, Select } from "@plyrs/ui";
import { space } from "@plyrs/ui/semantic.stylex";
import { LIST_STATUSES, type ListStatus } from "../lib/content-list";
import { LIST_LABELS, WORKFLOW_STATUS_LABELS } from "../lib/labels";

const NARROW = "@media (max-width: 959px)";

const styles = stylex.create({
  root: {
    display: "flex",
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: space.inset,
  },
  // 部品固有の幅(案 D 5 章): 狭い画面ではステータスを 150px、検索は残りの幅いっぱい
  status: { width: { default: "180px", [NARROW]: "150px" } },
  search: { width: { default: "280px", [NARROW]: null }, flex: { default: null, [NARROW]: 1 } },
});

const ITEMS = [
  { value: "", label: LIST_LABELS.statusAll },
  ...LIST_STATUSES.map((s) => ({ value: s, label: WORKFLOW_STATUS_LABELS[s] })),
];

function isListStatus(value: string): value is ListStatus {
  return (LIST_STATUSES as readonly string[]).includes(value);
}

export function ListFilters({
  status,
  q,
  onStatusChange,
  onSearchChange,
}: {
  status: ListStatus | undefined;
  q: string;
  onStatusChange: (s: ListStatus | undefined) => void;
  onSearchChange: (q: string) => void;
}) {
  return (
    <div {...stylex.props(styles.root)}>
      <div {...stylex.props(styles.status)}>
        <Select
          label={LIST_LABELS.statusFilter}
          items={ITEMS}
          selectedValue={status ?? ""}
          onChange={(v) => {
            if (v === "") onStatusChange(undefined);
            else if (isListStatus(v)) onStatusChange(v);
          }}
        />
      </div>
      <div {...stylex.props(styles.search)}>
        <SearchField
          label={LIST_LABELS.search}
          placeholder={LIST_LABELS.search}
          value={q}
          onChange={onSearchChange}
        />
      </div>
    </div>
  );
}
