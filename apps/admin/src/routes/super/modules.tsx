import * as stylex from "@stylexjs/stylex";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@plyrs/ui";
import { superStyles } from "./-styles";

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
      <h1 {...stylex.props(superStyles.title)}>モジュール</h1>
      {modules.isError ? (
        <p role="alert" {...stylex.props(superStyles.banner)}>
          モジュール一覧を取得できませんでした
        </p>
      ) : null}
      {modules.isPending ? (
        <p {...stylex.props(superStyles.muted)}>読み込み中…</p>
      ) : rows.length === 0 ? (
        <p {...stylex.props(superStyles.muted)}>モジュールはありません</p>
      ) : (
        <table {...stylex.props(superStyles.table)}>
          <caption {...stylex.props(superStyles.caption)}>モジュールの一覧</caption>
          <thead>
            <tr>
              <th {...stylex.props(superStyles.cell)}>モジュールID</th>
              <th {...stylex.props(superStyles.cell)}>名前</th>
              <th {...stylex.props(superStyles.cell)}>バージョン</th>
              <th {...stylex.props(superStyles.cell)}>有効テナント数</th>
              <th {...stylex.props(superStyles.cell)}>操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.moduleId}>
                <td {...stylex.props(superStyles.cell)}>{row.moduleId}</td>
                <td {...stylex.props(superStyles.cell)}>{row.name}</td>
                <td {...stylex.props(superStyles.cell)}>{row.version}</td>
                <td {...stylex.props(superStyles.cell)}>{row.enabledTenants}</td>
                <td {...stylex.props(superStyles.cell)}>
                  <Button
                    variant="secondary"
                    isDisabled={redistributeMutation.isPending}
                    onPress={() => void redistribute(row.moduleId)}
                  >
                    型定義を再配布
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {redistributeError !== null ? (
        <p role="alert" {...stylex.props(superStyles.banner)}>
          {redistributeError}
        </p>
      ) : null}
    </>
  );
}
