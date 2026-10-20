import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import * as stylex from "@stylexjs/stylex";
import { useState } from "react";
import { toaster } from "@plyrs/ui";
import { font, space, text } from "@plyrs/ui/semantic.stylex";
import { PasswordForm, type PasswordFieldErrors } from "../../../components/account/password-form";
import { SiteList } from "../../../components/account/site-list";
import { CardError, CardLoading } from "../../../components/settings/card-state";
import { SettingsCard } from "../../../components/settings/settings-card";
import { PageBody, TenantPageHeader } from "../../../components/tenant-page-header";
import { ThemeSegment } from "../../../components/theme-segment";
import { ApiError } from "../../../lib/api-client";
import { currentCrumb, homeCrumb } from "../../../lib/breadcrumbs";
import { errorMessage } from "../../../lib/error-messages";
import { ACCOUNT_LABELS } from "../../../lib/labels";
import { meQueryOptions, tenantsQueryOptions } from "../../../lib/queries";

// 設定の各画面と同じ幅(settings-frame.tsx の SETTINGS_MAX_WIDTH)。StyleX は import した定数を解けないので写す
const MAX_WIDTH = "880px";

const styles = stylex.create({
  column: {
    display: "flex",
    flexDirection: "column",
    gap: space.lg,
    maxWidth: MAX_WIDTH,
  },
  email: { margin: 0, fontSize: font.body, color: text.default },
});

export const Route = createFileRoute("/t/$tenantSlug/account")({
  component: AccountPage,
});

function AccountPage() {
  const { tenant, api } = Route.useRouteContext();
  const { tenantSlug } = Route.useParams();
  const labels = ACCOUNT_LABELS;
  const me = useQuery(meQueryOptions(api));
  const tenants = useQuery(tenantsQueryOptions(api));
  const [fieldErrors, setFieldErrors] = useState<PasswordFieldErrors>({});
  const [resetKey, setResetKey] = useState(0);
  const change = useMutation({
    mutationFn: ({ current, next }: { current: string; next: string }) =>
      api.changePassword(current, next),
    onSuccess: ({ revokedSessions }) => {
      setResetKey((key) => key + 1);
      setFieldErrors({});
      toaster.success(
        revokedSessions > 0
          ? labels.password.changedWithRevoked(revokedSessions)
          : labels.password.changed,
      );
    },
    onError: (cause) => {
      if (cause instanceof ApiError && cause.code === "wrong_password") {
        setFieldErrors({ current: errorMessage(cause, labels.password.failed) });
      } else if (cause instanceof ApiError && cause.code === "same_password") {
        setFieldErrors({ next: errorMessage(cause, labels.password.failed) });
      } else {
        toaster.error(errorMessage(cause, labels.password.failed));
      }
    },
  });

  let email;
  if (me.isLoadingError) {
    email = <CardError message={labels.email.loadFailed} onRetry={() => void me.refetch()} />;
  } else if (me.data === undefined) {
    email = <CardLoading rows={1} />;
  } else {
    email = <p {...stylex.props(styles.email)}>{me.data.email}</p>;
  }

  let sites;
  if (tenants.isError) {
    sites = <CardError message={labels.sites.loadFailed} onRetry={() => void tenants.refetch()} />;
  } else if (tenants.data === undefined) {
    sites = <CardLoading rows={2} />;
  } else {
    sites = <SiteList tenants={tenants.data} currentId={tenant.id} />;
  }

  return (
    <>
      <TenantPageHeader
        title={labels.title}
        breadcrumbs={[homeCrumb(tenantSlug), currentCrumb(labels.title)]}
      />
      <PageBody>
        <div {...stylex.props(styles.column)}>
          <SettingsCard title={labels.email.title} description={labels.email.help}>
            {email}
          </SettingsCard>
          <SettingsCard title={labels.password.title}>
            <PasswordForm
              onSubmit={(current, next) => change.mutate({ current, next })}
              isPending={change.isPending}
              fieldErrors={fieldErrors}
              resetKey={resetKey}
            />
          </SettingsCard>
          <SettingsCard title={labels.theme.title} description={labels.theme.help}>
            <ThemeSegment />
          </SettingsCard>
          <SettingsCard title={labels.sites.title}>{sites}</SettingsCard>
        </div>
      </PageBody>
    </>
  );
}
