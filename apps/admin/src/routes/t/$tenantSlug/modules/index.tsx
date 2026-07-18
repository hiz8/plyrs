import { createFileRoute } from "@tanstack/react-router";
import * as stylex from "@stylexjs/stylex";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@plyrs/ui";
import { colors, spacing, typography } from "@plyrs/ui/tokens.stylex";
import { modulesQueryOptions } from "../../../../lib/queries";

const styles = stylex.create({
  title: { fontSize: typography.sizeXl, marginTop: 0 },
  table: { borderCollapse: "collapse", width: "100%", fontSize: typography.sizeMd },
  cell: {
    textAlign: "left",
    padding: spacing.sm,
    borderBottomWidth: "1px",
    borderBottomStyle: "solid",
    borderBottomColor: colors.border,
    verticalAlign: "middle",
  },
  muted: { color: colors.textMuted },
  error: { color: colors.danger, fontSize: typography.sizeMd },
});

export const Route = createFileRoute("/t/$tenantSlug/modules/")({
  component: ModulesPage,
});

function ModulesPage() {
  const { tenant, adminApi } = Route.useRouteContext();
  const queryClient = useQueryClient();
  const modules = useQuery(modulesQueryOptions(adminApi, tenant.id));
  const toggle = useMutation({
    mutationFn: ({ moduleId, enabled }: { moduleId: string; enabled: boolean }) =>
      adminApi.setModuleEnabled(tenant.id, moduleId, enabled),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["modules", tenant.id] }),
  });

  return (
    <section>
      <h2 {...stylex.props(styles.title)}>モジュール</h2>
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
    </section>
  );
}
