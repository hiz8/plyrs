import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import * as stylex from "@stylexjs/stylex";
import { Lock, Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Banner, Button, ConfirmDialog, ICON_SIZE, toaster } from "@plyrs/ui";
import { space, text } from "@plyrs/ui/semantic.stylex";
import { BulkBar, type BulkMenuAction } from "../../../../../components/bulk-bar";
import { ContentListBody } from "../../../../../components/content-list-body";
import {
  PageBody,
  PageLoading,
  TenantPageHeader,
} from "../../../../../components/tenant-page-header";
import { currentCrumb, homeCrumb } from "../../../../../lib/breadcrumbs";
import {
  applyListQuery,
  buildListRows,
  parseListQuery,
  toListSearch,
  type BulkResult,
  type ListQuery,
  type ListRow,
} from "../../../../../lib/content-list";
import { errorMessage } from "../../../../../lib/error-messages";
import {
  BULK_LABELS,
  DIALOGS,
  EDITOR_LABELS,
  LIST_LABELS,
  TOASTS,
} from "../../../../../lib/labels";
import { publicationsQueryKey, publicationsQueryOptions } from "../../../../../lib/queries";
import { labelForRecord } from "../../../../../lib/record-label";
import { useSyncHasSynced, useSyncTypes, useTenantSync } from "../../../../../lib/sync-context";
import { useCan } from "../../../../../lib/use-can";
import {
  bulkResultMessage,
  useBulkAction,
  type BulkKind,
} from "../../../../../lib/use-bulk-action";
import { useCollectionRows } from "../../../../../lib/use-collection";

const styles = stylex.create({
  muted: { color: text.muted },
  meta: { display: "inline-flex", alignItems: "center", gap: space.xs },
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
  const { tenant, adminApi, queryClient } = Route.useRouteContext();
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
  const [failedIds, setFailedIds] = useState<Set<string>>(() => new Set());
  const [confirm, setConfirm] = useState<"unpublish" | "delete" | null>(null);
  const [rowDelete, setRowDelete] = useState<ListRow | null>(null);
  const [rowDeleting, setRowDeleting] = useState(false);
  const bulk = useBulkAction();
  const publications = useQuery({
    ...publicationsQueryOptions(adminApi, tenant.id, typeKey),
    enabled: hasSynced,
  });

  // 裁定 R18: 絞り込み・並べ替え・ページが変わったら選択を解除する
  const queryKey = JSON.stringify(toListSearch(query));
  useEffect(() => {
    setSelected(new Set());
    setFailedIds(new Set());
    bulk.dismiss();
    // bulk.dismiss は安定した参照。クエリが変わったときだけ走らせる
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
          <p {...stylex.props(styles.muted)}>{EDITOR_LABELS.unknownType(typeKey)}</p>
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

  const collection = sync.registry.get(typeKey);

  const invalidatePublications = () =>
    queryClient.invalidateQueries({ queryKey: publicationsQueryKey(tenant.id) });

  // 実行後の後始末(run と retry の両方から通す)
  const afterRun = (kind: BulkKind) => async (result: BulkResult) => {
    await invalidatePublications();
    const { tone, title } = bulkResultMessage(kind, result);
    toaster[tone === "success" ? "success" : "error"](title);
    const failed = new Set(result.failed.map((f) => f.id));
    setSelected(failed);
    setFailedIds(failed);
  };

  const startBulk = (kind: BulkKind, action: (rid: string) => Promise<void>) => {
    setFailedIds(new Set());
    return bulk.run(kind, selectedIds, action).then(afterRun(kind));
  };

  function runConfirmed(kind: "unpublish" | "delete") {
    setConfirm(null);
    if (kind === "unpublish") {
      return startBulk("unpublish", (rid) => adminApi.unpublishRecord(tenant.id, rid));
    }
    return startBulk("delete", (rid) => {
      if (collection === undefined) return Promise.reject(new Error("collection not found"));
      return collection.delete(rid).isPersisted.promise.then(() => undefined);
    });
  }

  function onBulkAction(action: BulkMenuAction) {
    if (action.kind === "publish") {
      void startBulk("publish", (rid) => adminApi.publishRecord(tenant.id, rid));
    } else if (action.kind === "status") {
      const next = action.status;
      void startBulk("status", (rid) => {
        if (collection === undefined) return Promise.reject(new Error("collection not found"));
        return collection
          .update(rid, (draft) => {
            draft.status = next;
          })
          .isPersisted.promise.then(() => undefined);
      });
    } else {
      setConfirm(action.kind);
    }
  }

  async function confirmRowDelete() {
    if (rowDelete === null || collection === undefined) return;
    setRowDeleting(true);
    try {
      await collection.delete(rowDelete.record.id).isPersisted.promise;
      const deletedId = rowDelete.record.id;
      const without = (ids: ReadonlySet<string>) =>
        new Set([...ids].filter((x) => x !== deletedId));
      setSelected(without);
      setFailedIds(without);
      await invalidatePublications();
      toaster.success(TOASTS.deleted);
    } catch (cause) {
      toaster.error(errorMessage(cause, TOASTS.deleteFailed));
    } finally {
      setRowDeleting(false);
      setRowDelete(null);
    }
  }

  const addButton = (
    <Button icon={Plus} onPress={goNew}>
      {LIST_LABELS.add(typeName)}
    </Button>
  );

  const selectedIds = view.items.map((r) => r.record.id).filter((rid) => selected.has(rid));
  const showBulkBar =
    canWrite && (selected.size > 0 || bulk.progress !== null || bulk.failure !== null);
  const bulkBar = showBulkBar ? (
    <BulkBar
      selectedCount={selectedIds.length}
      pageCount={view.items.length}
      onSelectPage={() => setSelected(new Set(view.items.map((r) => r.record.id)))}
      onClear={() => {
        setSelected(new Set());
        setFailedIds(new Set());
        bulk.dismiss();
      }}
      onAction={onBulkAction}
      progress={bulk.progress === null ? null : { ...bulk.progress, onCancel: bulk.cancel }}
      failure={
        bulk.failure === null
          ? null
          : {
              kind: bulk.failure.kind,
              onRetry: () => {
                const kind = bulk.failure?.kind;
                const retrying = bulk.retry();
                if (kind === undefined || retrying === null) return;
                setFailedIds(new Set());
                void retrying.then(afterRun(kind));
              },
            }
      }
    />
  ) : null;

  const body = (
    <ContentListBody
      publications={publications}
      totalRows={listRows.length}
      tenantSlug={tenantSlug}
      typeKey={typeKey}
      typeName={typeName}
      query={query}
      view={view}
      canWrite={canWrite}
      addAction={canWrite ? addButton : undefined}
      updateQuery={updateQuery}
      bulkBar={bulkBar}
      selected={selected}
      onSelectionChange={setSelected}
      selectionDisabled={bulk.progress !== null}
      failedIds={failedIds}
      onDelete={setRowDelete}
    />
  );

  const hasPublishedInRow = rowDelete !== null && rowDelete.publication !== "unpublished";

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
      <ConfirmDialog
        title={BULK_LABELS.confirmDelete.title(selectedIds.length, typeName)}
        isOpen={confirm === "delete"}
        onOpenChange={(open) => setConfirm(open ? "delete" : null)}
        tone="danger"
        confirmLabel={DIALOGS.delete.confirm}
        onConfirm={() => void runConfirmed("delete")}
      >
        <p>{BULK_LABELS.confirmDelete.body}</p>
      </ConfirmDialog>
      <ConfirmDialog
        title={BULK_LABELS.confirmUnpublish.title(selectedIds.length)}
        isOpen={confirm === "unpublish"}
        onOpenChange={(open) => setConfirm(open ? "unpublish" : null)}
        tone="danger"
        confirmLabel={DIALOGS.unpublish.confirm}
        onConfirm={() => void runConfirmed("unpublish")}
      >
        <p>{BULK_LABELS.confirmUnpublish.body}</p>
      </ConfirmDialog>
      <ConfirmDialog
        title={DIALOGS.delete.title(typeName)}
        isOpen={rowDelete !== null}
        onOpenChange={(open) => {
          if (!open) setRowDelete(null);
        }}
        tone="danger"
        confirmLabel={DIALOGS.delete.confirm}
        isPending={rowDeleting}
        onConfirm={() => void confirmRowDelete()}
      >
        <p>{DIALOGS.delete.body(rowDelete?.title ?? "")}</p>
        {hasPublishedInRow && (
          <Banner tone="warning">{DIALOGS.delete.publishedWarning(typeName)}</Banner>
        )}
      </ConfirmDialog>
    </>
  );
}
