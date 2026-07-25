import * as stylex from "@stylexjs/stylex";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { superStyles } from "./-styles";

interface AuditLogRow {
  id: string;
  actorId: string;
  action: string;
  targetType: string;
  targetId: string;
  detail: string;
  createdAt: string;
}

export const Route = createFileRoute("/super/audit")({
  component: SuperAuditPage,
});

function SuperAuditPage() {
  const { superApi } = Route.useRouteContext();

  const audit = useQuery({
    queryKey: ["super", "audit-logs"],
    queryFn: () => superApi.get<{ auditLogs: AuditLogRow[] }>("/super/v1/audit-logs"),
  });

  const rows = audit.data?.auditLogs ?? [];

  return (
    <>
      <h1 {...stylex.props(superStyles.title)}>監査ログ</h1>
      {audit.isError ? (
        <p role="alert" {...stylex.props(superStyles.banner)}>
          監査ログを取得できませんでした
        </p>
      ) : null}
      {audit.isPending ? (
        <p {...stylex.props(superStyles.muted)}>読み込み中…</p>
      ) : rows.length === 0 ? (
        <p {...stylex.props(superStyles.muted)}>監査ログはありません</p>
      ) : (
        <table {...stylex.props(superStyles.table)}>
          <caption {...stylex.props(superStyles.caption)}>監査ログの一覧</caption>
          <thead>
            <tr>
              <th {...stylex.props(superStyles.cell)}>操作</th>
              <th {...stylex.props(superStyles.cell)}>実行者</th>
              <th {...stylex.props(superStyles.cell)}>対象</th>
              <th {...stylex.props(superStyles.cell)}>日時</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td {...stylex.props(superStyles.cell)}>{row.action}</td>
                <td {...stylex.props(superStyles.cell)}>{row.actorId}</td>
                <td {...stylex.props(superStyles.cell)}>
                  {row.targetType}:{row.targetId}
                </td>
                <td {...stylex.props(superStyles.cell)}>{row.createdAt}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
