import { useQuery } from "@tanstack/react-query";
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import * as stylex from "@stylexjs/stylex";
import { Image as ImageIcon, Upload } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button, DropZone, EmptyState, FileButton, FileDropTarget, toaster } from "@plyrs/ui";
import { ASSET_TYPE_KEY } from "@plyrs/metamodel";
import { createAssetServices } from "../../lib/asset-services";
import { currentCrumb, homeCrumb } from "../../lib/breadcrumbs";
import { MEDIA_LABELS, TERMS } from "../../lib/labels";
import {
  applyMediaQuery,
  buildMediaRows,
  hasMediaFilters,
  parseMediaQuery,
  readMediaView,
  saveMediaView,
  toMediaSearch,
  DEFAULT_MEDIA_QUERY,
  type MediaQuery,
  type MediaView,
} from "../../lib/media-list";
import { uploadSummaryMessage } from "../../lib/media";
import { orphanAssetsQueryOptions } from "../../lib/queries";
import { useSyncHasSynced, useSyncTypes, useTenantSync } from "../../lib/sync-context";
import { useCan } from "../../lib/use-can";
import { useRecordsOfTypes } from "../../lib/use-collection";
import { uploadStoreFor, useUploads } from "../../lib/use-uploads";
import { PageBody, PageLoading, TenantPageHeader } from "../tenant-page-header";
import { MediaBulkBar } from "./media-bulk-bar";
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
  const { tenant, adminApi, queryClient } = mediaRoute.useRouteContext();
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
  useEffect(() => {
    setSelectedKeys(new Set());
  }, [queryKey]);
  // 絞り込みの外に出た(削除された)ものも選択から落とす
  const selected = useMemo(() => {
    const ids = new Set(visible.map((row) => row.id));
    return new Set([...selectedKeys].filter((id) => ids.has(id)));
  }, [selectedKeys, visible]);

  if (!hasSynced) {
    return <PageLoading breadcrumbs={[homeCrumb(tenantSlug)]} />;
  }

  const changeQuery = (next: MediaQuery) =>
    void navigate({ to: ".", search: asSearch(next), replace: true });
  const changeView = (next: MediaView) => {
    setView(next);
    saveMediaView(next);
  };
  const open = (id: string) =>
    void navigate({
      to: "/t/$tenantSlug/media/$assetId",
      params: { tenantSlug, assetId: id },
      search: asSearch(query),
    });
  // リストの行のリンク。絞り込みの search を保つ(F5)
  const detailHref = (id: string) => {
    const params = new URLSearchParams(toMediaSearch(query)).toString();
    return `/t/${tenantSlug}/media/${id}${params === "" ? "" : `?${params}`}`;
  };
  const addFiles = (files: File[]) => void uploadStore.start(files);

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
                  onClear={() => setSelectedKeys(new Set())}
                  // 削除の確認と実行は Task 8 で足す
                  onDelete={() => undefined}
                  progress={null}
                  failure={null}
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
    </div>
  );
}
