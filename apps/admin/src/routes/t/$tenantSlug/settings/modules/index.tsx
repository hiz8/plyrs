import { createFileRoute } from "@tanstack/react-router";
import * as stylex from "@stylexjs/stylex";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@plyrs/ui";
import { border, font, space, status, stroke, text } from "@plyrs/ui/semantic.stylex";
import { PageBody, TenantPageHeader } from "../../../../../components/tenant-page-header";
import { currentCrumb, homeCrumb, settingsCrumb } from "../../../../../lib/breadcrumbs";
import { TERMS } from "../../../../../lib/labels";
import { modulesQueryOptions } from "../../../../../lib/queries";

const styles = stylex.create({
  table: { borderCollapse: "collapse", width: "100%", fontSize: font.body },
  cell: {
    textAlign: "left",
    padding: space.sm,
    borderBottomWidth: stroke.default,
    borderBottomStyle: "solid",
    borderBottomColor: border.default,
    verticalAlign: "middle",
  },
  muted: { color: text.muted },
  error: { color: status.danger, fontSize: font.body },
});

export const Route = createFileRoute("/t/$tenantSlug/settings/modules/")({
  component: ModulesPage,
});

function ModulesPage() {
  const { tenant, adminApi } = Route.useRouteContext();
  const { tenantSlug } = Route.useParams();
  const queryClient = useQueryClient();
  const modules = useQuery(modulesQueryOptions(adminApi, tenant.id));
  const toggle = useMutation({
    mutationFn: ({ moduleId, enabled }: { moduleId: string; enabled: boolean }) =>
      adminApi.setModuleEnabled(tenant.id, moduleId, enabled),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["modules", tenant.id] }),
  });

  return (
    <>
      {/* h-common-surface.md 2 章 / a-navigation.md 5 章: 見出し・パンくず・主操作は PageHeader に集約 */}
      <TenantPageHeader
        title={TERMS.module}
        breadcrumbs={[homeCrumb(tenantSlug), settingsCrumb(tenantSlug), currentCrumb(TERMS.module)]}
      />
      <PageBody>
        {modules.isError ? (
          <p {...stylex.props(styles.error)}>モジュール一覧を取得できませんでした</p>
        ) : null}
        {modules.isPending ? <p {...stylex.props(styles.muted)}>読み込み中…</p> : null}
        {modules.data ? (
          <table {...stylex.props(styles.table)}>
            <caption {...stylex.props(styles.muted)}>
              有効化したモジュールだけがこのテナントで動作します
            </caption>
            <thead>
              <tr>
                <th {...stylex.props(styles.cell)}>名前</th>
                <th {...stylex.props(styles.cell)}>状態</th>
                <th {...stylex.props(styles.cell)}>バージョン</th>
                <th {...stylex.props(styles.cell)}>操作</th>
              </tr>
            </thead>
            <tbody>
              {modules.data.map((module) => (
                <tr key={module.moduleId}>
                  <td {...stylex.props(styles.cell)}>
                    {module.name} <span {...stylex.props(styles.muted)}>({module.moduleId})</span>
                  </td>
                  <td {...stylex.props(styles.cell)}>{module.enabled ? "有効" : "無効"}</td>
                  <td {...stylex.props(styles.cell)}>
                    v{module.version}(適用済み v{module.appliedVersion})
                  </td>
                  <td {...stylex.props(styles.cell)}>
                    <Button
                      isDisabled={toggle.isPending}
                      onPress={() =>
                        toggle.mutate({ moduleId: module.moduleId, enabled: !module.enabled })
                      }
                    >
                      {module.enabled ? "無効化" : "有効化"}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
        {toggle.isError ? (
          <p {...stylex.props(styles.error)}>操作に失敗しました(権限を確認してください)</p>
        ) : null}
      </PageBody>
    </>
  );
}
