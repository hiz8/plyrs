import { createFileRoute, useNavigate } from "@tanstack/react-router";
import * as stylex from "@stylexjs/stylex";
import { useMemo } from "react";
import { v7 as uuidv7 } from "uuid";
import type { SyncRecord } from "@plyrs/sync-protocol";
import { text } from "@plyrs/ui/semantic.stylex";
import {
  PageBody,
  PageLoading,
  TenantPageHeader,
} from "../../../../../components/tenant-page-header";
import { contentTypeCrumb, currentCrumb, homeCrumb } from "../../../../../lib/breadcrumbs";
import { RecordForm } from "../../../../../components/record-form";
import { createAssetServices } from "../../../../../lib/asset-services";
import { useSyncHasSynced, useSyncTypes, useTenantSync } from "../../../../../lib/sync-context";

const styles = stylex.create({
  muted: { color: text.muted },
});

export const Route = createFileRoute("/t/$tenantSlug/content/$typeKey/new")({
  component: NewRecordPage,
});

function NewRecordPage() {
  const { tenantSlug, typeKey } = Route.useParams();
  const { tenant, adminApi } = Route.useRouteContext();
  const sync = useTenantSync();
  const types = useSyncTypes(sync);
  const hasSynced = useSyncHasSynced(sync);
  const navigate = useNavigate();
  const assets = useMemo(() => createAssetServices(adminApi, tenant.id), [adminApi, tenant.id]);
  const contentType = types.find((type) => type.key === typeKey);
  const collection = sync.registry.get(typeKey);

  // §12 必須①(2026-07-17 裁定): ゲートは初回同期の完了までに限る。以降の切断・再同期は
  // バナー表示のみでフォーム(未保存入力)を維持する。
  if (!hasSynced) {
    return <PageLoading breadcrumbs={[homeCrumb(tenantSlug)]} />;
  }
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

  return (
    <>
      {/* h-common-surface.md 2 章 / a-navigation.md 5 章: パンくずは home › 型 › 新規追加 */}
      <TenantPageHeader
        title={`${contentType.name}を追加`}
        breadcrumbs={[
          homeCrumb(tenantSlug),
          contentTypeCrumb(tenantSlug, contentType),
          currentCrumb("新規追加"),
        ]}
      />
      <PageBody>
        <RecordForm
          contentType={contentType}
          types={types}
          registry={sync.registry}
          record={null}
          submitLabel="作成"
          assets={assets}
          onSubmit={async (input) => {
            // design-spec §5: ID はクライアント生成（UUIDv7）。updatedAt/updatedBy/seq/version は
            // サーバー権威 — ack の確定レコードで上書きされる仮値を入れる。
            const record: SyncRecord = {
              id: uuidv7(),
              type: typeKey,
              input,
              fieldVersions: {},
              status: "draft",
              seq: 0,
              version: 0,
              deletedAt: null,
              updatedAt: new Date().toISOString(),
              updatedBy: "",
            };
            const tx = collection.insert(record);
            await tx.isPersisted.promise;
            await navigate({
              to: "/t/$tenantSlug/content/$typeKey",
              params: { tenantSlug, typeKey },
            });
          }}
        />
      </PageBody>
    </>
  );
}
