import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import * as stylex from "@stylexjs/stylex";
import { Puzzle } from "lucide-react";
import { useState } from "react";
import { EmptyState, toaster } from "@plyrs/ui";
import { font, space, text } from "@plyrs/ui/semantic.stylex";
import { DisableModuleDialog } from "../../../../../components/settings/disable-module-dialog";
import { ModuleCard } from "../../../../../components/settings/module-card";
import { SettingsFrame } from "../../../../../components/settings/settings-frame";
import type { ModuleSummary } from "../../../../../lib/admin-api";
import { errorMessage } from "../../../../../lib/error-messages";
import { MODULE_LABELS } from "../../../../../lib/labels";
import { moduleAddLinks, moduleContentCounts } from "../../../../../lib/modules";
import { modulesQueryOptions } from "../../../../../lib/queries";
import { useSyncHasSynced, useSyncTypes, useTenantSync } from "../../../../../lib/sync-context";
import { useRecordsOfTypes } from "../../../../../lib/use-collection";

const styles = stylex.create({
  list: { display: "flex", flexDirection: "column", gap: space.md },
  description: { margin: 0, fontSize: font.body, color: text.muted },
});

export const Route = createFileRoute("/t/$tenantSlug/settings/modules/")({
  component: ModulesPage,
});

function ModulesPage() {
  const { tenant, adminApi, queryClient } = Route.useRouteContext();
  const { tenantSlug } = Route.useParams();
  const labels = MODULE_LABELS;
  const modules = useQuery(modulesQueryOptions(adminApi, tenant.id));
  const sync = useTenantSync();
  const types = useSyncTypes(sync);
  const hasSynced = useSyncHasSynced(sync);
  const list = modules.data ?? [];
  // 同期の welcome より先にモジュール一覧が届くと、未着の型の key では購読が空のまま固まる。
  // 届いた型に絞れば、型が届いた時点で key が変わり購読し直す
  const navKeys = list
    .filter((m) => m.enabled)
    .flatMap((m) => m.navTypes)
    .filter((key) => types.some((type) => type.key === key));
  const records = useRecordsOfTypes(sync.registry, navKeys);

  const [justEnabled, setJustEnabled] = useState<string | null>(null);
  const [disableTarget, setDisableTarget] = useState<ModuleSummary | null>(null);

  const toggle = useMutation({
    mutationFn: ({ module, enabled }: { module: ModuleSummary; enabled: boolean }) =>
      adminApi.setModuleEnabled(tenant.id, module.moduleId, enabled),
    onSuccess: (_result, { module, enabled }) => {
      void queryClient.invalidateQueries({ queryKey: ["modules", tenant.id] });
      if (enabled) {
        setJustEnabled(module.moduleId);
        toaster.success(labels.enabledToast(module.name));
      } else {
        setJustEnabled(null);
        toaster.success(labels.disabledToast(module.name));
      }
    },
    onError: (cause, { enabled }) => {
      toaster.error(errorMessage(cause, enabled ? labels.enableFailed : labels.disableFailed));
    },
    onSettled: () => setDisableTarget(null),
  });

  return (
    <SettingsFrame
      tab="modules"
      slug={tenantSlug}
      isLoading={modules.isPending}
      error={
        modules.isLoadingError
          ? {
              message: errorMessage(modules.error, labels.loadFailed),
              onRetry: () => void modules.refetch(),
            }
          : undefined
      }
    >
      <p {...stylex.props(styles.description)}>{labels.description}</p>
      {list.length === 0 ? (
        <EmptyState icon={Puzzle} title={labels.empty} />
      ) : (
        <div {...stylex.props(styles.list)}>
          {list.map((module) => (
            <ModuleCard
              key={module.moduleId}
              module={module}
              addLinks={moduleAddLinks(module.navTypes, types, tenantSlug)}
              justEnabled={justEnabled === module.moduleId}
              isBusy={toggle.isPending}
              onEnable={() => toggle.mutate({ module, enabled: true })}
              onDisable={() => setDisableTarget(module)}
            />
          ))}
        </div>
      )}
      <DisableModuleDialog
        target={
          disableTarget === null
            ? null
            : {
                module: disableTarget,
                counts: hasSynced
                  ? moduleContentCounts(records, disableTarget.navTypes, types)
                  : null,
              }
        }
        onConfirm={() => {
          if (disableTarget !== null) toggle.mutate({ module: disableTarget, enabled: false });
        }}
        onCancel={() => setDisableTarget(null)}
        isPending={toggle.isPending}
      />
    </SettingsFrame>
  );
}
