import { createFileRoute } from "@tanstack/react-router";
import * as stylex from "@stylexjs/stylex";
import { useMemo } from "react";
import { text } from "@plyrs/ui/semantic.stylex";
import {
  PageBody,
  PageLoading,
  TenantPageHeader,
} from "../../../../../components/tenant-page-header";
import { RecordEditor } from "../../../../../components/record-editor";
import { createAssetServices } from "../../../../../lib/asset-services";
import { homeCrumb } from "../../../../../lib/breadcrumbs";
import { EDITOR_LABELS } from "../../../../../lib/labels";
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
          <p {...stylex.props(styles.muted)}>{EDITOR_LABELS.unknownType(typeKey)}</p>
        </PageBody>
      </>
    );
  }

  return (
    <RecordEditor
      tenantSlug={tenantSlug}
      contentType={contentType}
      types={types}
      collection={collection}
      record={null}
      assets={assets}
    />
  );
}
