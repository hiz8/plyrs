import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import * as stylex from "@stylexjs/stylex";
import { LayoutGrid, Plus } from "lucide-react";
import { useState } from "react";
import { Button, EmptyState, toaster } from "@plyrs/ui";
import { font, space, text } from "@plyrs/ui/semantic.stylex";
import { DeleteTypeDialog } from "../../../../../components/content-types/delete-type-dialog";
import { PluginTypeGroups } from "../../../../../components/content-types/plugin-type-groups";
import { TypeTable } from "../../../../../components/content-types/type-table";
import { SettingsFrame } from "../../../../../components/settings/settings-frame";
import {
  menuOrderUpdates,
  pluginTypeGroups,
  userTypeRows,
  type TypeRow,
} from "../../../../../lib/content-types";
import { errorMessage } from "../../../../../lib/error-messages";
import { CONTENT_TYPE_LABELS } from "../../../../../lib/labels";
import { contentTypesQueryOptions, modulesQueryOptions } from "../../../../../lib/queries";
import { useSyncHasSynced, useSyncTypes, useTenantSync } from "../../../../../lib/sync-context";
import { useCan } from "../../../../../lib/use-can";
import { useRecordsOfTypes } from "../../../../../lib/use-collection";

const styles = stylex.create({
  description: { margin: 0, fontSize: font.caption, color: text.muted },
  content: { display: "flex", flexDirection: "column", gap: space.lg },
});

export const Route = createFileRoute("/t/$tenantSlug/settings/content-types/")({
  // invalidate → 一覧へ戻る経路があるため fetchQuery(ensureQueryData は stale でも返す — §11)。
  // 失敗はルートのエラーにせず、枠の中のエラーと再試行(useQuery 側)で見せる
  loader: async ({ context }) => {
    await context.queryClient
      .fetchQuery(contentTypesQueryOptions(context.adminApi, context.tenant.id))
      .catch(() => undefined);
  },
  component: ContentTypesPage,
});

function ContentTypesPage() {
  const { adminApi, tenant, queryClient } = Route.useRouteContext();
  const { tenantSlug } = Route.useParams();
  const navigate = useNavigate();
  const labels = CONTENT_TYPE_LABELS;
  const canManage = useCan("type:manage");
  const query = useQuery(contentTypesQueryOptions(adminApi, tenant.id));
  // モジュールの取得に失敗しても一覧は出す(グループ名が pluginId のままになるだけ)
  const modules = useQuery(modulesQueryOptions(adminApi, tenant.id));
  const sync = useTenantSync();
  const hasSynced = useSyncHasSynced(sync);
  const types = query.data ?? [];
  // registry のコレクションは welcome の型定義が届いてから作られる。購読の対象を同期済みの型に
  // 絞ることで、型定義が届いた時点で購読し直す(絞らないと先に取得した一覧の key のままで拾えない)
  const syncKeys = new Set(useSyncTypes(sync).map((type) => type.key));
  const records = useRecordsOfTypes(
    sync.registry,
    types.map((type) => type.key).filter((key) => syncKeys.has(key)),
  );
  const baseRows = userTypeRows(types, records, hasSynced);
  const groups = pluginTypeGroups(types, modules.data, records, hasSynced);

  // ドロップ直後から次の取得までの並び(保存が済んで取り直したら null に戻す)
  const [order, setOrder] = useState<string[] | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TypeRow | null>(null);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["content-types", tenant.id] });

  const reorder = useMutation({
    mutationFn: async (definitions: ReturnType<typeof menuOrderUpdates>) => {
      for (const definition of definitions) {
        await adminApi.putContentType(tenant.id, definition);
      }
    },
    onSuccess: async () => {
      await invalidate();
      setOrder(null);
    },
    onError: async () => {
      toaster.error(labels.reorderFailed);
      await invalidate();
      setOrder(null);
    },
  });

  const remove = useMutation({
    mutationFn: (key: string) => adminApi.deleteContentType(tenant.id, key),
    onSuccess: (_result, key) => {
      const name = types.find((type) => type.key === key)?.name ?? key;
      toaster.success(labels.deleteDialog.deleted(name));
      void invalidate();
    },
    onError: (cause) => {
      toaster.error(errorMessage(cause, labels.deleteDialog.failed));
      void invalidate();
    },
    onSettled: () => setDeleteTarget(null),
  });

  const rows =
    order === null
      ? baseRows
      : order.flatMap((key) => baseRows.filter((typeRow) => typeRow.row.key === key));

  const onReorder = (orderedKeys: string[]) => {
    const ordered = orderedKeys.flatMap((key) =>
      baseRows.filter((typeRow) => typeRow.row.key === key).map((typeRow) => typeRow.row),
    );
    const updates = menuOrderUpdates(ordered);
    if (updates.length === 0) return;
    setOrder(orderedKeys);
    reorder.mutate(updates);
  };

  const create = () =>
    void navigate({ to: "/t/$tenantSlug/settings/content-types/new", params: { tenantSlug } });

  return (
    <SettingsFrame
      tab="content-types"
      slug={tenantSlug}
      primaryAction={
        canManage ? (
          <Button variant="primary" icon={Plus} onPress={create}>
            {labels.create}
          </Button>
        ) : undefined
      }
      isLoading={query.isPending}
      error={
        query.isLoadingError
          ? {
              message: errorMessage(query.error, labels.loadFailed),
              onRetry: () => void query.refetch(),
            }
          : undefined
      }
    >
      <p {...stylex.props(styles.description)}>{labels.description}</p>
      {baseRows.length === 0 ? (
        <EmptyState
          icon={LayoutGrid}
          title={labels.empty.title}
          description={labels.empty.description}
          action={
            canManage ? (
              <Button variant="primary" icon={Plus} onPress={create}>
                {labels.create}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div {...stylex.props(styles.content)}>
          <TypeTable
            rows={rows}
            slug={tenantSlug}
            canManage={canManage}
            isReordering={reorder.isPending}
            onReorder={onReorder}
            onDelete={setDeleteTarget}
          />
        </div>
      )}
      <PluginTypeGroups groups={groups} slug={tenantSlug} />
      <DeleteTypeDialog
        target={deleteTarget === null ? null : { name: deleteTarget.row.name }}
        onConfirm={() => {
          if (deleteTarget !== null) remove.mutate(deleteTarget.row.key);
        }}
        onCancel={() => setDeleteTarget(null)}
        isPending={remove.isPending}
      />
    </SettingsFrame>
  );
}
