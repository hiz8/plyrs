import { useQuery } from "@tanstack/react-query";
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import * as stylex from "@stylexjs/stylex";
import { Image as ImageIcon, Upload } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button, DropZone, EmptyState, FileButton, FileDropTarget, toaster } from "@plyrs/ui";
import { ASSET_TYPE_KEY } from "@plyrs/metamodel";
import { createAssetServices } from "../../lib/asset-services";
import { currentCrumb, homeCrumb } from "../../lib/breadcrumbs";
import { errorMessage } from "../../lib/error-messages";
import { MEDIA_LABELS, TERMS, TOASTS } from "../../lib/labels";
import {
  applyMediaQuery,
  buildMediaRows,
  hasMediaFilters,
  parseMediaQuery,
  readMediaView,
  saveMediaView,
  toMediaSearch,
  inUseCount,
  DEFAULT_MEDIA_QUERY,
  type MediaQuery,
  type MediaRow,
  type MediaView,
} from "../../lib/media-list";
import { uploadSummaryMessage } from "../../lib/media";
import { orphanAssetsQueryOptions, publicationsQueryKey } from "../../lib/queries";
import { useSyncHasSynced, useSyncTypes, useTenantSync } from "../../lib/sync-context";
import { bulkResultMessage, useBulkAction } from "../../lib/use-bulk-action";
import { useCan } from "../../lib/use-can";
import { useRecordsOfTypes } from "../../lib/use-collection";
import { uploadStoreFor, useUploads } from "../../lib/use-uploads";
import { PageBody, PageLoading, TenantPageHeader } from "../tenant-page-header";
import { DeleteMediaDialog, type DeleteMediaTarget } from "./delete-media-dialog";
import { MediaBulkBar } from "./media-bulk-bar";
import { MediaDetailPanel } from "./media-detail-panel";
import { useAssetPublication, useAssetUsage } from "./media-library-data";
import { MediaGrid } from "./media-grid";
import { MediaTable } from "./media-table";
import { MediaToolbar } from "./media-toolbar";
import { UploadProgressBar } from "./upload-progress-bar";

// 幅 960px 未満では詳細パネルがシートになるため、本文の右余白は要らない
const NARROW = "@media (max-width: 959px)";

const styles = stylex.create({
  // F28: 詳細パネル(360px)を開いている間、見出しと本文の右を空ける
  root: { flex: 1, display: "flex", flexDirection: "column" },
  panelOpen: { paddingInlineEnd: { default: "360px", [NARROW]: 0 } },
  content: { display: "flex", flexDirection: "column", flex: 1, gap: "16px" },
});

// URL に載せる search。型は Partial<MediaQuery> のままだが、実体は既定値を省いた toMediaSearch の結果
function asSearch(next: Partial<MediaQuery>): Partial<MediaQuery> {
  return toMediaSearch(next) as Partial<MediaQuery>;
}

const mediaRoute = getRouteApi("/t/$tenantSlug/media");

export interface MediaLibraryProps {
  tenantSlug: string;
  /** 詳細パネルを開く対象(Task 8 で描く)。一覧だけのときは null */
  assetId: string | null;
}

export function MediaLibrary({ tenantSlug, assetId }: MediaLibraryProps) {
  const { tenant, adminApi, queryClient, api } = mediaRoute.useRouteContext();
  const search = mediaRoute.useSearch();
  const navigate = useNavigate();
  const query = useMemo(() => parseMediaQuery(search), [search]);
  const sync = useTenantSync();
  const types = useSyncTypes(sync);
  const hasSynced = useSyncHasSynced(sync);
  const canWrite = useCan("record:write");
  const canDelete = useCan("record:delete");

  // 同じ identity を保つ(MediaThumb は resolveUrl が変わると枠を空に戻す。store は最初の upload だけを使う)
  const assets = useMemo(() => createAssetServices(adminApi, tenant.id), [adminApi, tenant.id]);
  const uploadStore = useMemo(() => uploadStoreFor(tenant.id, assets.upload), [tenant.id, assets]);
  const uploads = useUploads(uploadStore);

  useEffect(() => {
    uploadStore.setOptions({
      onSettled: (summary) => {
        // 全部取り消したときなど、何も起きていなければ知らせない
        if (summary.succeeded > 0 || summary.failed > 0) {
          const message = uploadSummaryMessage(summary);
          if (summary.failed > 0) toaster.error(message);
          else toaster.success(message);
        }
        void queryClient.invalidateQueries({
          queryKey: orphanAssetsQueryOptions(adminApi, tenant.id).queryKey,
        });
      },
    });
  }, [uploadStore, queryClient, adminApi, tenant.id]);

  const [view, setView] = useState<MediaView>(() => readMediaView());
  const [selectedKeys, setSelectedKeys] = useState<ReadonlySet<string>>(() => new Set());
  const bulk = useBulkAction();

  // F34: asset 型が同期で届いてから購読する
  const hasAssetType = types.some((type) => type.key === ASSET_TYPE_KEY);
  const records = useRecordsOfTypes(sync.registry, hasAssetType ? [ASSET_TYPE_KEY] : []);
  // F40: 仮タイルが「完了」を見せている間は、届いた実レコードを隠して二重に出さない
  const rows = useMemo(
    () => buildMediaRows(records).filter((row) => !uploads.doneIds.has(row.id)),
    [records, uploads.doneIds],
  );

  // F7: 使用状況は画面を開いている間ずっと取得する(バッジと使用状況の列に要る)
  const orphans = useQuery(orphanAssetsQueryOptions(adminApi, tenant.id));
  const orphanIds = useMemo(
    () => (orphans.data === undefined ? null : new Set(orphans.data)),
    [orphans.data],
  );
  const visible = useMemo(() => applyMediaQuery(rows, query, orphanIds), [rows, query, orphanIds]);

  // 絞り込みが変わったら選択を空にする
  const queryKey = JSON.stringify(toMediaSearch(query));
  const dismissBulk = bulk.dismiss;
  useEffect(() => {
    setSelectedKeys(new Set());
    dismissBulk();
  }, [queryKey, dismissBulk]);
  // 絞り込みの外に出た(削除された)ものも選択から落とす
  const selected = useMemo(() => {
    const ids = new Set(visible.map((row) => row.id));
    return new Set([...selectedKeys].filter((id) => ids.has(id)));
  }, [selectedKeys, visible]);

  // F11/F12: 削除の確認の対象。1 件は開いている詳細パネルのファイル、一括は選択中
  const [deleteTarget, setDeleteTarget] = useState<
    { kind: "one"; id: string; row: MediaRow } | { kind: "many"; ids: string[] } | null
  >(null);
  const [isDeleting, setIsDeleting] = useState(false);
  // F29: パネルを開いた要素。閉じたときにフォーカスを戻す
  const panelReturnRef = useRef<HTMLElement | null>(null);

  const usageId = deleteTarget?.kind === "one" ? deleteTarget.id : assetId;
  const usage = useAssetUsage(adminApi, tenant.id, usageId, sync.registry, types);
  const publicationStatus = useAssetPublication(api, adminApi, tenant.id, tenantSlug, assetId);

  if (!hasSynced) {
    return <PageLoading breadcrumbs={[homeCrumb(tenantSlug)]} />;
  }

  const changeQuery = (next: MediaQuery) =>
    void navigate({ to: ".", search: asSearch(next), replace: true });
  const changeView = (next: MediaView) => {
    setView(next);
    saveMediaView(next);
  };
  const open = (id: string) => {
    rememberReturn();
    void navigate({
      to: "/t/$tenantSlug/media/$assetId",
      params: { tenantSlug, assetId: id },
      search: asSearch(query),
    });
  };
  // F29: パネルを開く前に押していた要素を覚える(グリッドのタイルとリストのリンクで共通)
  const rememberReturn = () => {
    const active = document.activeElement;
    panelReturnRef.current = active instanceof HTMLElement ? active : null;
  };
  const closePanel = () =>
    void navigate({
      to: "/t/$tenantSlug/media",
      params: { tenantSlug },
      search: asSearch(query),
    });
  // リストの行のリンク。絞り込みの search を保つ(F5)
  const detailHref = (id: string) => {
    const params = new URLSearchParams(toMediaSearch(query)).toString();
    return `/t/${tenantSlug}/media/${id}${params === "" ? "" : `?${params}`}`;
  };
  const addFiles = (files: File[]) => void uploadStore.start(files);

  // F13: 代替テキストとキャプションは同期経路で保存する(空は項目ごと落とす)
  const saveDetail = async (id: string, input: { alt: string; caption: string }) => {
    try {
      const collection = sync.registry.get(ASSET_TYPE_KEY);
      if (collection === undefined) throw new Error("asset collection unavailable");
      const tx = collection.update(id, (draft) => {
        const next: Record<string, unknown> = { ...draft.input };
        delete next["alt"];
        delete next["caption"];
        if (input.alt !== "") next["alt"] = input.alt;
        if (input.caption !== "") next["caption"] = input.caption;
        // WritableDeep<SyncRecord>["input"] は SyncRecord["input"] と構造同一だが TS が同一視できないため境界 cast
        draft.input = next as typeof draft.input;
      });
      await tx.isPersisted.promise;
      toaster.success(TOASTS.saved);
    } catch (cause) {
      toaster.error(errorMessage(cause, TOASTS.saveFailed));
    }
  };

  // F12: 削除後は未使用一覧と公開状態を取り直し、選択から外す
  const afterDelete = (ids: readonly string[]) => {
    void queryClient.invalidateQueries({
      queryKey: orphanAssetsQueryOptions(adminApi, tenant.id).queryKey,
    });
    void queryClient.invalidateQueries({ queryKey: publicationsQueryKey(tenant.id) });
    const gone = new Set(ids);
    setSelectedKeys((keys) => new Set([...keys].filter((id) => !gone.has(id))));
  };
  const reportBulk = (result: Parameters<typeof bulkResultMessage>[1]) => {
    const message = bulkResultMessage("delete", result);
    if (message.tone === "success") toaster.success(message.title);
    else toaster.error(message.title);
    afterDelete(result.succeeded);
    // F12: 開いているパネルのファイルが消えたら閉じる
    if (assetId !== null && result.succeeded.includes(assetId)) closePanel();
  };
  const deleteOne = async (id: string) => {
    setIsDeleting(true);
    try {
      await adminApi.deleteRecord(tenant.id, id);
      toaster.success(TOASTS.deleted);
      afterDelete([id]);
      if (id === assetId) closePanel();
    } catch (cause) {
      toaster.error(errorMessage(cause, TOASTS.deleteFailed));
    } finally {
      setIsDeleting(false);
      setDeleteTarget(null);
    }
  };
  const deleteMany = (ids: string[]) => {
    setDeleteTarget(null);
    void bulk.run("delete", ids, (id) => adminApi.deleteRecord(tenant.id, id)).then(reportBulk);
  };
  const confirmDelete = () => {
    if (deleteTarget === null) return;
    if (deleteTarget.kind === "one") void deleteOne(deleteTarget.id);
    else deleteMany(deleteTarget.ids);
  };

  const liveRow = assetId === null ? null : (rows.find((row) => row.id === assetId) ?? null);
  // 削除中にトゥームストーンが先に届いても、確認とパネルは削除前の行で描き続ける
  const detailRow =
    liveRow ??
    (isDeleting && deleteTarget?.kind === "one" && deleteTarget.id === assetId
      ? deleteTarget.row
      : null);
  const dialogTarget: DeleteMediaTarget | null =
    deleteTarget === null
      ? null
      : deleteTarget.kind === "many"
        ? {
            kind: "many",
            ids: deleteTarget.ids,
            inUse: orphanIds === null ? null : inUseCount(deleteTarget.ids, orphanIds),
          }
        : { kind: "one", row: deleteTarget.row, usage: usage.dialog };

  const isEmpty = rows.length === 0 && !hasMediaFilters(query) && uploads.entries.length === 0;
  const selection = canDelete
    ? {
        selectedKeys: selected,
        onSelectionChange: (keys: Set<string>) => setSelectedKeys(keys),
        isDisabled: false,
      }
    : undefined;
  const clearFilters = () => changeQuery({ ...DEFAULT_MEDIA_QUERY, sort: query.sort });

  return (
    <div {...stylex.props(styles.root, assetId !== null && styles.panelOpen)}>
      <TenantPageHeader
        title={TERMS.media}
        breadcrumbs={[homeCrumb(tenantSlug), currentCrumb(TERMS.media)]}
        meta={!canWrite ? MEDIA_LABELS.readOnly : undefined}
        primaryAction={
          canWrite ? (
            <FileButton variant="primary" icon={Upload} onFiles={addFiles}>
              {MEDIA_LABELS.add}
            </FileButton>
          ) : undefined
        }
      />
      <FileDropTarget isDisabled={!canWrite} hint={MEDIA_LABELS.dropLimit} onFiles={addFiles}>
        <PageBody isFill>
          {isEmpty ? (
            canWrite ? (
              <DropZone
                isFill
                onFiles={addFiles}
                allowsMultiple
                title={MEDIA_LABELS.empty.title}
                description={MEDIA_LABELS.empty.description}
                buttonLabel={MEDIA_LABELS.select}
              />
            ) : (
              <EmptyState
                icon={ImageIcon}
                title={MEDIA_LABELS.empty.title}
                description={MEDIA_LABELS.empty.viewerDescription}
              />
            )
          ) : (
            <div {...stylex.props(styles.content)}>
              <MediaToolbar
                query={query}
                onQueryChange={changeQuery}
                count={visible.length}
                view={view}
                onViewChange={changeView}
                usageError={
                  orphans.isLoadingError ? { onRetry: () => void orphans.refetch() } : null
                }
              />
              {uploads.progress !== null && (
                <UploadProgressBar {...uploads.progress} onCancel={uploadStore.cancel} />
              )}
              {selected.size > 0 && (
                <MediaBulkBar
                  selectedCount={selected.size}
                  totalCount={visible.length}
                  onSelectAll={() => setSelectedKeys(new Set(visible.map((row) => row.id)))}
                  onClear={() => {
                    setSelectedKeys(new Set());
                    bulk.dismiss();
                  }}
                  onDelete={() => setDeleteTarget({ kind: "many", ids: [...selected] })}
                  progress={
                    bulk.progress === null
                      ? null
                      : {
                          done: bulk.progress.done,
                          total: bulk.progress.total,
                          onCancel: bulk.cancel,
                        }
                  }
                  failure={
                    bulk.failure === null
                      ? null
                      : { onRetry: () => void bulk.retry()?.then(reportBulk) }
                  }
                />
              )}
              {visible.length === 0 && hasMediaFilters(query) ? (
                <EmptyState
                  icon={ImageIcon}
                  title={MEDIA_LABELS.noResults.title}
                  description={MEDIA_LABELS.noResults.description}
                  action={
                    <Button variant="link" onPress={clearFilters}>
                      {MEDIA_LABELS.clearFilters}
                    </Button>
                  }
                />
              ) : view === "grid" ? (
                <MediaGrid
                  rows={visible}
                  resolveUrl={assets.resolveUrl}
                  orphanIds={orphanIds}
                  uploads={uploads.entries}
                  onRetryUpload={uploadStore.retry}
                  onRemoveUpload={uploadStore.remove}
                  selection={selection}
                  onOpen={open}
                  showDropHint={canWrite}
                />
              ) : (
                <MediaTable
                  onBeforeOpen={rememberReturn}
                  detailHref={detailHref}
                  rows={visible}
                  resolveUrl={assets.resolveUrl}
                  orphanIds={orphanIds}
                  selection={selection}
                />
              )}
            </div>
          )}
        </PageBody>
      </FileDropTarget>
      <MediaDetailPanel
        tenantSlug={tenantSlug}
        tenantId={tenant.id}
        row={detailRow}
        isOpen={assetId !== null}
        notFound={assetId !== null && detailRow === null}
        resolveUrl={assets.resolveUrl}
        usage={usage.panel}
        publication={publicationStatus}
        canWrite={canWrite}
        canDelete={canDelete}
        onSave={(input) => (assetId === null ? Promise.resolve() : saveDetail(assetId, input))}
        onDelete={() =>
          detailRow !== null && setDeleteTarget({ kind: "one", id: detailRow.id, row: detailRow })
        }
        onClose={closePanel}
        returnFocusTo={panelReturnRef}
      />
      <DeleteMediaDialog
        target={dialogTarget}
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
        isPending={isDeleting}
      />
    </div>
  );
}
