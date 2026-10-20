import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import * as stylex from "@stylexjs/stylex";
import { Button, Skeleton, toaster } from "@plyrs/ui";
import { font, space, status } from "@plyrs/ui/semantic.stylex";
import { CopyField } from "../../../../components/settings/copy-field";
import { SettingsCard } from "../../../../components/settings/settings-card";
import { SettingsFrame } from "../../../../components/settings/settings-frame";
import { SiteNameForm } from "../../../../components/settings/site-name-form";
import { errorMessage } from "../../../../lib/error-messages";
import { SETTINGS_LABELS } from "../../../../lib/labels";
import { sidebarContentTypes } from "../../../../lib/navigation";
import { publicApiBase, publicRecordsUrl, resolvePublicOrigin } from "../../../../lib/public-api";
import { configQueryOptions } from "../../../../lib/queries";
import { useSyncTypes, useTenantSync } from "../../../../lib/sync-context";

const styles = stylex.create({
  stack: { display: "flex", flexDirection: "column", gap: space.md },
  alert: { margin: 0, fontSize: font.body, color: status.danger },
});

export const Route = createFileRoute("/t/$tenantSlug/settings/general")({
  component: GeneralPage,
});

function GeneralPage() {
  const { tenant, api, adminApi, queryClient } = Route.useRouteContext();
  const { tenantSlug } = Route.useParams();
  const labels = SETTINGS_LABELS;
  const config = useQuery(configQueryOptions(api));
  const types = useSyncTypes(useTenantSync());
  const rename = useMutation({
    mutationFn: (name: string) => adminApi.renameSite(tenant.id, name),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["tenants"] });
      toaster.success(labels.site.saved);
    },
    onError: (cause) => toaster.error(errorMessage(cause, labels.site.saveFailed)),
  });

  const firstType = sidebarContentTypes(types)[0];
  let publicApi;
  if (config.isLoadingError) {
    publicApi = (
      <div {...stylex.props(styles.stack)}>
        <p role="alert" {...stylex.props(styles.alert)}>
          {labels.loadFailed}
        </p>
        <div>
          <Button variant="secondary" onPress={() => void config.refetch()}>
            {labels.retry}
          </Button>
        </div>
      </div>
    );
  } else if (config.data === undefined) {
    publicApi = (
      <div aria-hidden="true" {...stylex.props(styles.stack)}>
        <Skeleton height={14} width="100%" />
        <Skeleton height={14} width="80%" />
      </div>
    );
  } else {
    const origin = resolvePublicOrigin(config.data.publicApiOrigin, window.location.origin);
    publicApi = (
      <div {...stylex.props(styles.stack)}>
        <CopyField label={labels.publicApi.baseUrl} value={publicApiBase(origin, tenantSlug)} />
        {firstType === undefined ? null : (
          <CopyField
            label={labels.publicApi.example(firstType.name)}
            value={publicRecordsUrl(origin, tenantSlug, firstType.key)}
            help={labels.publicApi.exampleHelp}
          />
        )}
      </div>
    );
  }

  return (
    <SettingsFrame tab="general" slug={tenantSlug}>
      <SiteNameForm
        // 保存後に tenants が取り直されて name が変わったら、入力欄の初期値も合わせる
        key={tenant.name}
        name={tenant.name}
        slug={tenant.slug}
        onSave={async (name) => {
          await rename.mutateAsync(name).catch(() => undefined);
        }}
        isPending={rename.isPending}
      />
      <SettingsCard title={labels.publicApi.title} description={labels.publicApi.description}>
        {publicApi}
      </SettingsCard>
    </SettingsFrame>
  );
}
