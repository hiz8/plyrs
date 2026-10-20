import { createFileRoute } from "@tanstack/react-router";
import { PageBody, TenantPageHeader } from "../../../../../components/tenant-page-header";
import {
  currentCrumb,
  homeCrumb,
  settingsContentTypesCrumb,
  settingsCrumb,
} from "../../../../../lib/breadcrumbs";
import { CONTENT_TYPE_LABELS } from "../../../../../lib/labels";

export const Route = createFileRoute("/t/$tenantSlug/settings/content-types/new")({
  component: NewContentTypePage,
});

function NewContentTypePage() {
  const { tenantSlug } = Route.useParams();
  return (
    <>
      {/* h-common-surface.md 2 章 / a-navigation.md 5 章: 見出し・パンくず・主操作は PageHeader に集約 */}
      <TenantPageHeader
        title={CONTENT_TYPE_LABELS.createTitle}
        breadcrumbs={[
          homeCrumb(tenantSlug),
          settingsCrumb(tenantSlug),
          settingsContentTypesCrumb(tenantSlug),
          currentCrumb(CONTENT_TYPE_LABELS.createCrumb),
        ]}
      />
      <PageBody>
        <p>{CONTENT_TYPE_LABELS.createTitle}</p>
      </PageBody>
    </>
  );
}
