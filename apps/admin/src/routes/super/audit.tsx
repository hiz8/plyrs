import * as stylex from "@stylexjs/stylex";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
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
      <h1 {...stylex.props(styles.title)}>監査ログ</h1>
      {audit.isError ? (
        <p role="alert" {...stylex.props(styles.banner)}>
          監査ログを取得できませんでした
        </p>
      ) : null}
      {audit.isPending ? (
        <p {...stylex.props(styles.muted)}>読み込み中…</p>
      ) : rows.length === 0 ? (
        <p {...stylex.props(styles.muted)}>監査ログはありません</p>
      ) : (
        <table {...stylex.props(styles.table)}>
          <caption {...stylex.props(styles.caption)}>監査ログの一覧</caption>
          <thead>
            <tr>
              <th {...stylex.props(styles.cell)}>操作</th>
              <th {...stylex.props(styles.cell)}>実行者</th>
              <th {...stylex.props(styles.cell)}>対象</th>
              <th {...stylex.props(styles.cell)}>日時</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td {...stylex.props(styles.cell)}>{row.action}</td>
                <td {...stylex.props(styles.cell)}>{row.actorId}</td>
                <td {...stylex.props(styles.cell)}>
                  {row.targetType}:{row.targetId}
                </td>
                <td {...stylex.props(styles.cell)}>{row.createdAt}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
