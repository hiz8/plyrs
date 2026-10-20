import * as stylex from "@stylexjs/stylex";
import { useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { Button, Skeleton, Tabs } from "@plyrs/ui";
import { font, space, status } from "@plyrs/ui/semantic.stylex";
import { currentCrumb, homeCrumb, settingsCrumb } from "../../lib/breadcrumbs";
import { SETTINGS_LABELS } from "../../lib/labels";
import { PageBody, TenantPageHeader } from "../tenant-page-header";

export type SettingsTab = "general" | "content-types" | "members" | "modules";

export const SETTINGS_MAX_WIDTH = "880px";

const TAB_ORDER: readonly SettingsTab[] = ["general", "content-types", "members", "modules"];

const styles = stylex.create({
  content: {
    display: "flex",
    flexDirection: "column",
    gap: space.lg,
    maxWidth: SETTINGS_MAX_WIDTH,
    paddingTop: space.lg,
  },
  loading: { display: "flex", flexDirection: "column", gap: space.sm },
  alert: { margin: 0, fontSize: font.body, color: status.danger },
});

export function SettingsFrame({
  tab,
  slug,
  primaryAction,
  isLoading,
  error,
  children,
}: {
  tab: SettingsTab;
  slug: string;
  primaryAction?: ReactNode;
  isLoading?: boolean;
  error?: { message: string; onRetry: () => void };
  children: ReactNode;
}) {
  const navigate = useNavigate();
  const labels = SETTINGS_LABELS;
  let body: ReactNode = children;
  if (error !== undefined) {
    body = (
      <>
        <p role="alert" {...stylex.props(styles.alert)}>
          {error.message}
        </p>
        <div>
          <Button variant="secondary" onPress={error.onRetry}>
            {labels.retry}
          </Button>
        </div>
      </>
    );
  } else if (isLoading === true) {
    body = (
      <div aria-hidden="true" {...stylex.props(styles.loading)}>
        <Skeleton height={14} width="100%" />
        <Skeleton height={14} width="80%" />
        <Skeleton height={14} width="60%" />
      </div>
    );
  }
  return (
    <>
      <TenantPageHeader
        title={labels.title}
        breadcrumbs={[homeCrumb(slug), settingsCrumb(slug), currentCrumb(labels.tabs[tab])]}
        primaryAction={primaryAction}
      />
      <PageBody>
        <Tabs
          label={labels.tabsName}
          items={TAB_ORDER.map((id) => ({ id, label: labels.tabs[id] }))}
          selectedKey={tab}
          onSelectionChange={(id) => void navigate({ href: `/t/${slug}/settings/${id}` })}
        >
          {(id) =>
            id === tab ? (
              <div
                aria-busy={isLoading === true ? true : undefined}
                {...stylex.props(styles.content)}
              >
                {body}
              </div>
            ) : null
          }
        </Tabs>
      </PageBody>
    </>
  );
}
