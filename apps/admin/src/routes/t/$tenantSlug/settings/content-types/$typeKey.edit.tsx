import { useMutation, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import * as stylex from "@stylexjs/stylex";
import { toaster } from "@plyrs/ui";
import { text } from "@plyrs/ui/semantic.stylex";
import { TypeEditor } from "../../../../../components/content-types/type-editor";
import { PageBody, TenantPageHeader } from "../../../../../components/tenant-page-header";
import {
  currentCrumb,
  homeCrumb,
  settingsContentTypesCrumb,
  settingsCrumb,
} from "../../../../../lib/breadcrumbs";
import { buildDefinition, toTypeDraft, type TypeDraft } from "../../../../../lib/content-type-form";
import { errorMessage } from "../../../../../lib/error-messages";
import { CONTENT_TYPE_LABELS } from "../../../../../lib/labels";
import { contentTypesQueryOptions } from "../../../../../lib/queries";
import { useSyncHasSynced, useSyncTypes, useTenantSync } from "../../../../../lib/sync-context";
import { useCan } from "../../../../../lib/use-can";
import { useRecordsOfTypes } from "../../../../../lib/use-collection";

const styles = stylex.create({
  muted: { color: text.muted },
});

export const Route = createFileRoute("/t/$tenantSlug/settings/content-types/$typeKey/edit")({
  // 編集フォームは常に最新定義から開く(invalidate 後の stale 回避 = fetchQuery。§11)
  loader: ({ context }) =>
    context.queryClient.fetchQuery(contentTypesQueryOptions(context.adminApi, context.tenant.id)),
  component: EditContentTypePage,
});

function EditContentTypePage() {
  const { adminApi, tenant, queryClient } = Route.useRouteContext();
  const { tenantSlug, typeKey } = Route.useParams();
  const navigate = useNavigate();
  const labels = CONTENT_TYPE_LABELS;
  const canManage = useCan("type:manage");
  const { data: contentTypes } = useSuspenseQuery(contentTypesQueryOptions(adminApi, tenant.id));
  const existing = contentTypes.find((contentType) => contentType.key === typeKey);

  const sync = useTenantSync();
  const hasSynced = useSyncHasSynced(sync);
  // welcome が届く前に固定の [typeKey] を渡すと購読が空のまま固まるため、型が届いてから渡す
  const isTypeSynced = useSyncTypes(sync).some((type) => type.key === typeKey);
  const syncedRecords = useRecordsOfTypes(sync.registry, isTypeSynced ? [typeKey] : []);

  const save = useMutation({
    mutationFn: async (draft: TypeDraft) => {
      if (existing === undefined) return false;
      const built = buildDefinition({
        id: existing.id,
        version: existing.version,
        menuOrder: existing.menuOrder ?? undefined,
        draft,
      });
      if (!built.ok) {
        // 描画側で検証済みなので通常は来ない(保険)
        console.error(built.errors);
        toaster.error(labels.editor.saveFailed);
        return false;
      }
      await adminApi.putContentType(tenant.id, built.definition);
      return true;
    },
    onSuccess: async (saved) => {
      if (!saved) return;
      await queryClient.invalidateQueries({ queryKey: ["content-types", tenant.id] });
      toaster.success(labels.editor.saved);
      await navigate({
        to: "/t/$tenantSlug/settings/content-types",
        params: { tenantSlug },
        ignoreBlocker: true,
      });
    },
    onError: (cause) => toaster.error(errorMessage(cause, labels.editor.saveFailed)),
  });

  if (existing === undefined) {
    return (
      <>
        <TenantPageHeader
          title={typeKey}
          breadcrumbs={[
            homeCrumb(tenantSlug),
            settingsCrumb(tenantSlug),
            settingsContentTypesCrumb(tenantSlug),
            currentCrumb(typeKey),
          ]}
        />
        <PageBody>
          <p {...stylex.props(styles.muted)}>{labels.editor.notFound(typeKey)}</p>
        </PageBody>
      </>
    );
  }
  return (
    <TypeEditor
      slug={tenantSlug}
      mode={existing.source === "user" && canManage ? "edit" : "view"}
      initial={toTypeDraft(existing)}
      original={existing.fields}
      typeName={existing.name}
      existingTypes={contentTypes}
      records={hasSynced ? syncedRecords : null}
      onSubmit={async (draft) => {
        await save.mutateAsync(draft).catch(() => undefined);
      }}
      onCancel={() =>
        void navigate({ to: "/t/$tenantSlug/settings/content-types", params: { tenantSlug } })
      }
      isPending={save.isPending}
    />
  );
}
