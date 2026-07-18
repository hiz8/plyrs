import * as stylex from "@stylexjs/stylex";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@plyrs/ui";
import { colors, spacing, typography } from "@plyrs/ui/tokens.stylex";

const styles = stylex.create({
  title: { fontSize: typography.sizeXl, marginTop: 0 },
  muted: { color: colors.textMuted },
  banner: { color: colors.danger, fontSize: typography.sizeMd, margin: 0 },
  table: { borderCollapse: "collapse", width: "100%", fontSize: typography.sizeMd },
  caption: {
    captionSide: "top",
    textAlign: "left",
    color: colors.textMuted,
    fontSize: typography.sizeSm,
    paddingBottom: spacing.xs,
  },
  cell: {
    textAlign: "left",
    padding: spacing.sm,
    borderBottomWidth: "1px",
    borderBottomStyle: "solid",
    borderBottomColor: colors.border,
    verticalAlign: "middle",
  },
});

interface ModuleRow {
  moduleId: string;
  version: number;
  name: string;
  enabledTenants: number;
}

const MODULES_QUERY_KEY = ["super", "modules"] as const;

export const Route = createFileRoute("/super/modules")({
  component: SuperModulesPage,
});

function SuperModulesPage() {
  const { superApi } = Route.useRouteContext();
  const queryClient = useQueryClient();

  const modules = useQuery({
    queryKey: MODULES_QUERY_KEY,
    queryFn: () => superApi.get<{ modules: ModuleRow[] }>("/super/v1/modules"),
  });

  const [redistributeError, setRedistributeError] = useState<string | null>(null);
  const redistributeMutation = useMutation({
    mutationFn: (moduleId: string) =>
      superApi.post<{ ok: boolean }>(`/super/v1/modules/${moduleId}/redistribute`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: MODULES_QUERY_KEY }),
  });

  async function redistribute(moduleId: string) {
    setRedistributeError(null);
    try {
      await redistributeMutation.mutateAsync(moduleId);
    } catch {
      setRedistributeError("型定義の再配布に失敗しました");
    }
  }

  const rows = modules.data?.modules ?? [];

  return (
    <>
      <h1 {...stylex.props(styles.title)}>モジュール</h1>
      {modules.isError ? (
        <p role="alert" {...stylex.props(styles.banner)}>
          モジュール一覧を取得できませんでした
        </p>
      ) : null}
      {modules.isPending ? (
        <p {...stylex.props(styles.muted)}>読み込み中…</p>
      ) : rows.length === 0 ? (
        <p {...stylex.props(styles.muted)}>モジュールはありません</p>
      ) : (
        <table {...stylex.props(styles.table)}>
          <caption {...stylex.props(styles.caption)}>モジュールの一覧</caption>
          <thead>
            <tr>
              <th {...stylex.props(styles.cell)}>モジュールID</th>
              <th {...stylex.props(styles.cell)}>名前</th>
              <th {...stylex.props(styles.cell)}>バージョン</th>
              <th {...stylex.props(styles.cell)}>有効テナント数</th>
              <th {...stylex.props(styles.cell)}>操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.moduleId}>
                <td {...stylex.props(styles.cell)}>{row.moduleId}</td>
                <td {...stylex.props(styles.cell)}>{row.name}</td>
                <td {...stylex.props(styles.cell)}>{row.version}</td>
                <td {...stylex.props(styles.cell)}>{row.enabledTenants}</td>
                <td {...stylex.props(styles.cell)}>
                  <Button variant="secondary" onPress={() => void redistribute(row.moduleId)}>
                    型定義を再配布
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {redistributeError !== null ? (
        <p role="alert" {...stylex.props(styles.banner)}>
          {redistributeError}
        </p>
      ) : null}
    </>
  );
}
