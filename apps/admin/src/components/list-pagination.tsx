import * as stylex from "@stylexjs/stylex";
import { Button, IconButton, Select } from "@plyrs/ui";
import { accent, font, space, text } from "@plyrs/ui/semantic.stylex";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { PER_PAGE_OPTIONS, pageWindow, type PerPage } from "../lib/content-list";
import { LIST_LABELS } from "../lib/labels";

const styles = stylex.create({
  root: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.inset,
    fontSize: font.caption,
    color: text.muted,
  },
  right: { display: "flex", alignItems: "center", gap: space.xs },
  range: { marginInlineEnd: space.sm },
  current: { backgroundColor: accent.surface, color: accent.default },
});

const ITEMS = PER_PAGE_OPTIONS.map((n) => ({ value: String(n), label: LIST_LABELS.perPage(n) }));

function isPerPage(value: number): value is PerPage {
  return (PER_PAGE_OPTIONS as readonly number[]).includes(value);
}

export function ListPagination({
  page,
  pageCount,
  total,
  perPage,
  onPageChange,
  onPerPageChange,
}: {
  page: number;
  pageCount: number;
  total: number;
  perPage: PerPage;
  onPageChange: (page: number) => void;
  onPerPageChange: (perPage: PerPage) => void;
}) {
  if (total === 0) return null;
  const from = (page - 1) * perPage + 1;
  const to = Math.min(page * perPage, total);
  return (
    <nav aria-label={LIST_LABELS.pager} {...stylex.props(styles.root)}>
      <Select
        label={LIST_LABELS.perPageLabel}
        size="sm"
        items={ITEMS}
        selectedValue={String(perPage)}
        onChange={(v) => {
          const n = Number(v);
          if (isPerPage(n)) onPerPageChange(n);
        }}
      />
      <div {...stylex.props(styles.right)}>
        <span {...stylex.props(styles.range)}>{LIST_LABELS.range(total, from, to)}</span>
        <IconButton
          icon={ChevronLeft}
          label={LIST_LABELS.prev}
          size="sm"
          isDisabled={page <= 1}
          onPress={() => onPageChange(page - 1)}
        />
        {pageWindow(page, pageCount).map((item, i) =>
          item === "gap" ? (
            <span key={`gap-${i}`} aria-hidden="true">
              …
            </span>
          ) : (
            <PageButton
              key={item}
              n={item}
              isCurrent={item === page}
              onPress={() => onPageChange(item)}
            />
          ),
        )}
        <IconButton
          icon={ChevronRight}
          label={LIST_LABELS.next}
          size="sm"
          isDisabled={page >= pageCount}
          onPress={() => onPageChange(page + 1)}
        />
      </div>
    </nav>
  );
}

function PageButton({
  n,
  isCurrent,
  onPress,
}: {
  n: number;
  isCurrent: boolean;
  onPress: () => void;
}) {
  return (
    <span {...(isCurrent ? stylex.props(styles.current) : {})}>
      <Button
        size="sm"
        variant="secondary"
        aria-label={LIST_LABELS.page(n)}
        aria-current={isCurrent ? "page" : undefined}
        onPress={onPress}
      >
        {String(n)}
      </Button>
    </span>
  );
}
