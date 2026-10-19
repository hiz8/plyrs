import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { PageBody, TenantPageHeader } from "../../../../../components/tenant-page-header";
import {
  currentCrumb,
  homeCrumb,
  settingsContentTypesCrumb,
  settingsCrumb,
} from "../../../../../lib/breadcrumbs";
import { ContentTypeForm } from "../../../../../components/content-type-form";
import { contentTypesQueryOptions } from "../../../../../lib/queries";

export const Route = createFileRoute("/t/$tenantSlug/settings/content-types/new")({
  component: NewContentTypePage,
});

function NewContentTypePage() {
  const { adminApi, tenant, queryClient } = Route.useRouteContext();
  const { tenantSlug } = Route.useParams();
  const navigate = useNavigate();
  return (
    <>
      {/* h-common-surface.md 2 章 / a-navigation.md 5 章: 見出し・パンくず・主操作は PageHeader に集約 */}
      <TenantPageHeader
        title="コンテンツタイプを追加"
        breadcrumbs={[
          homeCrumb(tenantSlug),
          settingsCrumb(tenantSlug),
          settingsContentTypesCrumb(tenantSlug),
          currentCrumb("新規追加"),
        ]}
      />
      <PageBody>
        <ContentTypeForm
          existing={null}
          onSubmit={async (definition) => {
            await adminApi.putContentType(tenant.id, definition);
            await queryClient.invalidateQueries({
              queryKey: contentTypesQueryOptions(adminApi, tenant.id).queryKey,
            });
            await navigate({ to: "/t/$tenantSlug/settings/content-types", params: { tenantSlug } });
          }}
        />
      </PageBody>
    </>
  );
}
