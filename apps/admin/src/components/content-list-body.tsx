import * as stylex from "@stylexjs/stylex";
import { Inbox, Search } from "lucide-react";
import type { ContentTypeDefinition } from "@plyrs/metamodel";
import type { ReactNode } from "react";
import { Button, EmptyState, Skeleton, Tabs } from "@plyrs/ui";
import { space } from "@plyrs/ui/semantic.stylex";
import {
  describeFilters,
  DEFAULT_LIST_QUERY,
  LIST_TABS,
  type ListQuery,
  type ListRow,
  type ListView,
} from "../lib/content-list";
import { errorMessage } from "../lib/error-messages";
import { LIST_LABELS, LOADING_LABEL, WORKFLOW_STATUS_LABELS } from "../lib/labels";
import { ContentTable } from "./content-table";
import { ListFilters } from "./list-filters";
import { ListPagination } from "./list-pagination";

const styles = stylex.create({
  stack: { display: "flex", flexDirection: "column", gap: space.md },
  loading: { display: "flex", flexDirection: "column", gap: space.sm },
  alert: { display: "flex", flexDirection: "column", alignItems: "flex-start", gap: space.sm },
});

export interface ContentListBodyProps {
  publications: { isPending: boolean; isError: boolean; error: unknown; refetch: () => void };
  /** 絞り込み前の行数(0 なら空状態) */
  totalRows: number;
  tenantSlug: string;
  typeKey: string;
  typeName: string;
  /** 型の説明。空でなければ空状態の説明文に使う(K1) */
  typeDescription?: string | undefined;
  /** 追加列(listColumns)の定義元(K2) */
  contentType: ContentTypeDefinition;
  query: ListQuery;
  view: ListView;
  canWrite: boolean;
  /** 空状態の導線(書き込み権限があるときだけ渡す) */
  addAction: ReactNode;
  updateQuery: (patch: Partial<ListQuery>, options?: { replace?: boolean }) => void;
  /** 絞り込みの行と表の間に出す一括操作バー(無ければ null) */
  bulkBar: ReactNode;
  selected: ReadonlySet<string>;
  onSelectionChange: (keys: Set<string>) => void;
  selectionDisabled: boolean;
  failedIds: ReadonlySet<string>;
  onDelete: (row: ListRow) => void;
}

// 一覧の本文: 公開状態の読み込み中・失敗・空状態・タブ付きの表を出し分ける
export function ContentListBody({
  publications,
  totalRows,
  tenantSlug,
  typeKey,
  typeName,
  typeDescription,
  contentType,
  query,
  view,
  canWrite,
  addAction,
  updateQuery,
  bulkBar,
  selected,
  onSelectionChange,
  selectionDisabled,
  failedIds,
  onDelete,
}: ContentListBodyProps) {
  if (publications.isPending) {
    return (
      <div role="status" aria-label={LOADING_LABEL} {...stylex.props(styles.loading)}>
        <Skeleton height={14} width="100%" />
        <Skeleton height={14} width="80%" />
        <Skeleton height={14} width="60%" />
      </div>
    );
  }
  if (publications.isError) {
    return (
      <div role="alert" {...stylex.props(styles.alert)}>
        <p>{errorMessage(publications.error, LIST_LABELS.publicationsFailed)}</p>
        <Button variant="secondary" onPress={() => publications.refetch()}>
          {LIST_LABELS.retry}
        </Button>
      </div>
    );
  }
  if (totalRows === 0) {
    return (
      <EmptyState
        icon={Inbox}
        title={LIST_LABELS.empty.title(typeName)}
        description={
          typeDescription !== undefined && typeDescription !== ""
            ? typeDescription
            : LIST_LABELS.empty.description(typeName)
        }
        action={addAction}
      />
    );
  }
  const filters = describeFilters(query, {
    tabs: LIST_LABELS.tabs,
    statuses: WORKFLOW_STATUS_LABELS,
    statusLabel: LIST_LABELS.statusFilter,
  });
  return (
    <Tabs
      label={LIST_LABELS.tabsName}
      items={LIST_TABS.map((id) => ({
        id,
        label: LIST_LABELS.tabs[id],
        count: view.counts[id],
      }))}
      selectedKey={query.tab}
      onSelectionChange={(id) => {
        const tab = LIST_TABS.find((t) => t === id);
        if (tab !== undefined) updateQuery({ tab, page: 1 });
      }}
    >
      {() => (
        <div {...stylex.props(styles.stack)}>
          <ListFilters
            status={query.status}
            q={query.q}
            onStatusChange={(status) => updateQuery({ status, page: 1 })}
            onSearchChange={(q) => updateQuery({ q, page: 1 }, { replace: true })}
          />
          {bulkBar}
          {view.total === 0 ? (
            <div role="status">
              <EmptyState
                size="compact"
                icon={Search}
                title={LIST_LABELS.noResults.title(query.q, typeName)}
                description={
                  filters === "" ? undefined : LIST_LABELS.noResults.description(filters)
                }
                action={
                  <Button
                    variant="link"
                    onPress={() =>
                      updateQuery({
                        tab: DEFAULT_LIST_QUERY.tab,
                        status: DEFAULT_LIST_QUERY.status,
                        q: DEFAULT_LIST_QUERY.q,
                        page: 1,
                      })
                    }
                  >
                    {LIST_LABELS.noResults.clear}
                  </Button>
                }
              />
            </div>
          ) : (
            <ContentTable
              tenantSlug={tenantSlug}
              typeKey={typeKey}
              typeName={typeName}
              contentType={contentType}
              rows={view.items}
              sort={{ column: query.sort, order: query.order }}
              onSortChange={(sort, order) => updateQuery({ sort, order, page: 1 })}
              selection={
                canWrite
                  ? {
                      selectedKeys: selected,
                      onSelectionChange,
                      isDisabled: selectionDisabled,
                    }
                  : undefined
              }
              failedIds={failedIds}
              canWrite={canWrite}
              onDelete={onDelete}
              now={new Date()}
            />
          )}
          <ListPagination
            page={view.page}
            pageCount={view.pageCount}
            total={view.total}
            perPage={query.perPage}
            onPageChange={(page) => updateQuery({ page })}
            onPerPageChange={(perPage) => updateQuery({ perPage, page: 1 })}
          />
        </div>
      )}
    </Tabs>
  );
}
