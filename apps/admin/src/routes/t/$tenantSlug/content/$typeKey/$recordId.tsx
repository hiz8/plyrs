import { createFileRoute, useNavigate } from "@tanstack/react-router";
import * as stylex from "@stylexjs/stylex";
import { useMemo, useState } from "react";
import { Button } from "@plyrs/ui";
import { border, bg, font, radius, space, status, stroke, text } from "@plyrs/ui/semantic.stylex";
import {
  PageBody,
  PageLoading,
  TenantPageHeader,
} from "../../../../../components/tenant-page-header";
import { contentTypeCrumb, currentCrumb, homeCrumb } from "../../../../../lib/breadcrumbs";
import { RecordForm, syncErrorMessage } from "../../../../../components/record-form";
import { createAssetServices } from "../../../../../lib/asset-services";
import { publicationQueryOptions, publicationsQueryKey } from "../../../../../lib/queries";
import { useSyncHasSynced, useSyncTypes, useTenantSync } from "../../../../../lib/sync-context";
import { useCan } from "../../../../../lib/use-can";
import { useCollectionRows } from "../../../../../lib/use-collection";

const styles = stylex.create({
  muted: { color: text.muted },
  layout: { display: "grid", gridTemplateColumns: "1fr 280px", gap: space.lg },
  toolbar: {
    display: "flex",
    alignItems: "center",
    gap: space.sm,
    marginBottom: space.md,
    flexWrap: "wrap",
  },
  panelColumn: { display: "flex", flexDirection: "column", gap: space.md },
  panel: {
    padding: space.md,
    borderRadius: radius.container,
    borderWidth: stroke.default,
    borderStyle: "solid",
    borderColor: border.default,
    backgroundColor: bg.surface,
  },
  panelTitle: { fontSize: font.caption, color: text.muted, marginTop: 0 },
  banner: { color: status.danger, fontSize: font.body },
  dangerZone: { display: "flex", gap: space.sm, marginTop: space.lg },
});

export const Route = createFileRoute("/t/$tenantSlug/content/$typeKey/$recordId")({
  component: RecordEditorPage,
});

function RecordEditorPage() {
  const { slots, tenant, adminApi, queryClient } = Route.useRouteContext();
  const { tenantSlug, typeKey, recordId } = Route.useParams();
  const sync = useTenantSync();
  const types = useSyncTypes(sync);
  const hasSynced = useSyncHasSynced(sync);
  const navigate = useNavigate();
  const assets = useMemo(() => createAssetServices(adminApi, tenant.id), [adminApi, tenant.id]);
  const collection = sync.registry.get(typeKey);
  const rows = useCollectionRows(collection);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  // 案 H 7 章: viewer には削除を押させない(守りは同期経路のサーバー判定)
  const canDelete = useCan("record:delete");

  // §12 必須①(2026-07-17 裁定): ゲートは初回同期の完了までに限る。以降の切断・再同期は
  // バナー表示のみでフォーム(未保存入力)を維持する。
  if (!hasSynced) {
    return <PageLoading breadcrumbs={[homeCrumb(tenantSlug)]} />;
  }
  const contentType = types.find((type) => type.key === typeKey);
  if (contentType === undefined || collection === undefined) {
    return (
      <>
        <TenantPageHeader title={typeKey} breadcrumbs={[homeCrumb(tenantSlug)]} />
        <PageBody>
          <p {...stylex.props(styles.muted)}>未知のコンテンツタイプです: {typeKey}</p>
        </PageBody>
      </>
    );
  }
  const record = rows.find((row) => row.id === recordId);
  if (record === undefined) {
    return (
      <>
        <TenantPageHeader
          title={`${contentType.name}を編集`}
          breadcrumbs={[homeCrumb(tenantSlug), contentTypeCrumb(tenantSlug, contentType)]}
        />
        <PageBody>
          <p {...stylex.props(styles.muted)}>
            レコードが見つかりません（削除された可能性があります）
          </p>
        </PageBody>
      </>
    );
  }

  async function deleteRecord() {
    setDeleteError(null);
    try {
      if (collection === undefined) return;
      const tx = collection.delete(recordId);
      await tx.isPersisted.promise;
      // 削除は DO 側で公開版(published_snapshots)も消すため、publish-toolbar と同じく公開状態を取り直す
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: publicationQueryOptions(adminApi, tenant.id, recordId).queryKey,
        }),
        queryClient.invalidateQueries({ queryKey: publicationsQueryKey(tenant.id) }),
      ]);
      await navigate({ to: "/t/$tenantSlug/content/$typeKey", params: { tenantSlug, typeKey } });
    } catch (cause) {
      setDeleteError(syncErrorMessage(cause));
    }
  }

  return (
    <>
      {/* h-common-surface.md 2 章 / a-navigation.md 5 章: 主操作は置かない(公開は案 C で公開ボックスへ) */}
      <TenantPageHeader
        title={`${contentType.name}を編集`}
        breadcrumbs={[
          homeCrumb(tenantSlug),
          contentTypeCrumb(tenantSlug, contentType),
          currentCrumb("編集"),
        ]}
      />
      <PageBody>
        <div {...stylex.props(styles.toolbar)}>
          {slots.get("record-editor:toolbar").map((contribution) => (
            <contribution.render key={contribution.id} typeKey={typeKey} recordId={recordId} />
          ))}
        </div>
        <div {...stylex.props(styles.layout)}>
          <div>
            <RecordForm
              contentType={contentType}
              types={types}
              registry={sync.registry}
              record={record}
              submitLabel="保存"
              assets={assets}
              onSubmit={async (input) => {
                const tx = collection.update(recordId, (draft) => {
                  // WritableDeep<SyncRecord>["input"] は SyncRecord["input"] と構造同一だが
                  // WritableDeep の再帰展開で TS が同一視できないため境界 cast(rpc-unwrap 様式)。
                  draft.input = input as typeof draft.input;
                });
                await tx.isPersisted.promise;
              }}
            />
            <div {...stylex.props(styles.dangerZone)}>
              {confirmingDelete ? (
                <>
                  <Button variant="secondary" onPress={() => void deleteRecord()}>
                    削除を確定
                  </Button>
                  <Button variant="secondary" onPress={() => setConfirmingDelete(false)}>
                    キャンセル
                  </Button>
                </>
              ) : (
                <Button
                  variant="secondary"
                  isDisabled={!canDelete}
                  onPress={() => setConfirmingDelete(true)}
                >
                  削除
                </Button>
              )}
              {deleteError !== null && <span {...stylex.props(styles.banner)}>{deleteError}</span>}
            </div>
          </div>
          <aside {...stylex.props(styles.panelColumn)}>
            {slots.get("record-editor:panel").map((contribution) => (
              <section key={contribution.id} {...stylex.props(styles.panel)}>
                <h2 {...stylex.props(styles.panelTitle)}>{contribution.title}</h2>
                <contribution.render typeKey={typeKey} recordId={recordId} />
              </section>
            ))}
          </aside>
        </div>
      </PageBody>
    </>
  );
}
