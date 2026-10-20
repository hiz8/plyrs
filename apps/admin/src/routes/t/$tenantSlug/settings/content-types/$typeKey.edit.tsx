import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import * as stylex from "@stylexjs/stylex";
import { text } from "@plyrs/ui/semantic.stylex";
import { PageBody, TenantPageHeader } from "../../../../../components/tenant-page-header";
import {
  currentCrumb,
  homeCrumb,
  settingsContentTypesCrumb,
  settingsCrumb,
} from "../../../../../lib/breadcrumbs";
import { CONTENT_TYPE_LABELS } from "../../../../../lib/labels";
import { contentTypesQueryOptions } from "../../../../../lib/queries";

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
  const { adminApi, tenant } = Route.useRouteContext();
  const { tenantSlug, typeKey } = Route.useParams();
  const { data: contentTypes } = useSuspenseQuery(contentTypesQueryOptions(adminApi, tenant.id));
  const existing = contentTypes.find((contentType) => contentType.key === typeKey);
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
          <p {...stylex.props(styles.muted)}>{CONTENT_TYPE_LABELS.editor.notFound(typeKey)}</p>
        </PageBody>
      </>
    );
  }
  return (
    <>
      {/* h-common-surface.md 2 章 / a-navigation.md 5 章: 見出し・パンくず・主操作は PageHeader に集約 */}
      <TenantPageHeader
        title={existing.name}
        breadcrumbs={[
          homeCrumb(tenantSlug),
          settingsCrumb(tenantSlug),
          settingsContentTypesCrumb(tenantSlug),
          currentCrumb(existing.name),
        ]}
      />
      <PageBody>
        <p>{existing.name}</p>
      </PageBody>
    </>
  );
}
