import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import * as stylex from "@stylexjs/stylex";
import { Inbox, Lock, Plus, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button, EmptyState, ICON_SIZE, Skeleton, Tabs } from "@plyrs/ui";
import { space, text } from "@plyrs/ui/semantic.stylex";
import { ContentTable } from "../../../../../components/content-table";
import { ListFilters } from "../../../../../components/list-filters";
import { ListPagination } from "../../../../../components/list-pagination";
import {
  PageBody,
  PageLoading,
  TenantPageHeader,
} from "../../../../../components/tenant-page-header";
import { currentCrumb, homeCrumb } from "../../../../../lib/breadcrumbs";
import {
  applyListQuery,
  buildListRows,
  DEFAULT_LIST_QUERY,
  describeFilters,
  LIST_TABS,
  parseListQuery,
  toListSearch,
  type ListQuery,
} from "../../../../../lib/content-list";
import { errorMessage } from "../../../../../lib/error-messages";
import { LIST_LABELS, LOADING_LABEL, WORKFLOW_STATUS_LABELS } from "../../../../../lib/labels";
import { publicationsQueryOptions } from "../../../../../lib/queries";
import { labelForRecord } from "../../../../../lib/record-label";
import { useSyncHasSynced, useSyncTypes, useTenantSync } from "../../../../../lib/sync-context";
import { useCan } from "../../../../../lib/use-can";
import { useCollectionRows } from "../../../../../lib/use-collection";

const styles = stylex.create({
  muted: { color: text.muted },
  meta: { display: "inline-flex", alignItems: "center", gap: space.xs },
  stack: { display: "flex", flexDirection: "column", gap: space.md },
  loading: { display: "flex", flexDirection: "column", gap: space.sm },
  alert: { display: "flex", flexDirection: "column", alignItems: "flex-start", gap: space.sm },
});

// URL に載せる search。型は Partial<ListQuery> のままだが、実体は既定値を省いた toListSearch の結果。
// Partial にしておくと、他の画面からの一覧へのリンクが search を省略できる
// (読み戻すときは validateSearch の parseListQuery が既定値を補う)
function asSearch(query: Partial<ListQuery>): Partial<ListQuery> {
  return toListSearch(query) as Partial<ListQuery>;
}

export const Route = createFileRoute("/t/$tenantSlug/content/$typeKey/")({
  validateSearch: (search: Record<string, unknown>): Partial<ListQuery> => parseListQuery(search),
  search: {
    // validateSearch の戻り値は既定値を含み、そのまま URL に出てしまう。toListSearch の規則(既定値は省く)に揃える
    middlewares: [({ search, next }) => asSearch(next(search))],
  },
  component: RecordListPage,
});

function RecordListPage() {
  const { tenant, adminApi } = Route.useRouteContext();
  const { tenantSlug, typeKey } = Route.useParams();
  const search = Route.useSearch();
  const query = useMemo(() => parseListQuery(search), [search]);
  const sync = useTenantSync();
  const navigate = useNavigate();
  const canWrite = useCan("record:write");
  const types = useSyncTypes(sync);
  const hasSynced = useSyncHasSynced(sync);
  const contentType = types.find((type) => type.key === typeKey);
  const rows = useCollectionRows(sync.registry.get(typeKey));
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const publications = useQuery({
    ...publicationsQueryOptions(adminApi, tenant.id, typeKey),
    enabled: hasSynced,
  });

  // 裁定 R18: 絞り込み・並べ替え・ページが変わったら選択を解除する
  const queryKey = JSON.stringify(toListSearch(query));
  useEffect(() => {
    setSelected(new Set());
  }, [queryKey]);

  const publicationMap = useMemo(
    () =>
      new Map(
        (publications.data ?? []).map((p) => [p.recordId, { sourceVersion: p.sourceVersion }]),
      ),
    [publications.data],
  );
  const listRows = useMemo(
    () => buildListRows(rows, publicationMap, (record) => labelForRecord(types, record)),
    [rows, publicationMap, types],
  );
  const view = useMemo(() => applyListQuery(listRows, query), [listRows, query]);

  // §12 必須①(2026-07-17 裁定): ゲートは初回同期の完了までに限る。以降の切断・再同期は
  // バナー表示のみでフォーム(未保存入力)を維持する。
  if (!hasSynced) {
    return <PageLoading breadcrumbs={[homeCrumb(tenantSlug)]} />;
  }
  if (contentType === undefined) {
    return (
      <>
        <TenantPageHeader title={typeKey} breadcrumbs={[homeCrumb(tenantSlug)]} />
        <PageBody>
          <p {...stylex.props(styles.muted)}>未知のコンテンツタイプです: {typeKey}</p>
        </PageBody>
      </>
    );
  }
  const typeName = contentType.name;

  const goNew = () =>
    void navigate({ to: "/t/$tenantSlug/content/$typeKey/new", params: { tenantSlug, typeKey } });
  const updateQuery = (patch: Partial<ListQuery>, options?: { replace?: boolean }) =>
    void navigate({
      to: "/t/$tenantSlug/content/$typeKey",
      params: { tenantSlug, typeKey },
      search: asSearch({ ...query, ...patch }),
      replace: options?.replace ?? false,
    });

  const addButton = (
    <Button icon={Plus} onPress={goNew}>
      {typeName}を追加
    </Button>
  );

  let body;
  if (publications.isPending) {
    body = (
      <div role="status" aria-label={LOADING_LABEL} {...stylex.props(styles.loading)}>
        <Skeleton height={14} width="100%" />
        <Skeleton height={14} width="80%" />
        <Skeleton height={14} width="60%" />
      </div>
    );
  } else if (publications.isError) {
    body = (
      <div role="alert" {...stylex.props(styles.alert)}>
        <p>{errorMessage(publications.error, LIST_LABELS.publicationsFailed)}</p>
        <Button variant="secondary" onPress={() => void publications.refetch()}>
          {LIST_LABELS.retry}
        </Button>
      </div>
    );
  } else if (listRows.length === 0) {
    body = (
      <EmptyState
        icon={Inbox}
        title={LIST_LABELS.empty.title(typeName)}
        description={LIST_LABELS.empty.description(typeName)}
        action={canWrite ? addButton : undefined}
      />
    );
  } else {
    const filters = describeFilters(query, {
      tabs: LIST_LABELS.tabs,
      statuses: WORKFLOW_STATUS_LABELS,
      statusLabel: LIST_LABELS.statusFilter,
    });
    const now = new Date();
    body = (
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
                    <Button variant="link" onPress={() => updateQuery(DEFAULT_LIST_QUERY)}>
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
                rows={view.items}
                sort={{ column: query.sort, order: query.order }}
                onSortChange={(sort, order) => updateQuery({ sort, order, page: 1 })}
                selection={
                  canWrite
                    ? { selectedKeys: selected, onSelectionChange: setSelected, isDisabled: false }
                    : undefined
                }
                failedIds={new Set<string>()}
                canWrite={canWrite}
                onDelete={() => {}}
                now={now}
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

  return (
    <>
      {/* h-common-surface.md 2 章 / a-navigation.md 5 章: 見出し・パンくず・主操作は PageHeader に集約。
          閲覧者(record:write なし)には主操作を出さず「閲覧のみ」を添える */}
      <TenantPageHeader
        title={typeName}
        breadcrumbs={[homeCrumb(tenantSlug), currentCrumb(typeName)]}
        primaryAction={canWrite ? addButton : undefined}
        meta={
          canWrite ? undefined : (
            <span {...stylex.props(styles.meta)}>
              <Lock size={ICON_SIZE.inline} aria-hidden="true" />
              {LIST_LABELS.readOnly}
            </span>
          )
        }
      />
      <PageBody>{body}</PageBody>
    </>
  );
}
