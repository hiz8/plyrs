import { createFileRoute, Link } from "@tanstack/react-router";
import * as stylex from "@stylexjs/stylex";
import type { WorkflowStatus } from "@plyrs/metamodel";
import { colors, spacing, typography } from "@plyrs/ui/tokens.stylex";
import { labelForRecord } from "../../../../../components/record-form";
import { useSyncStatus, useSyncTypes, useTenantSync } from "../../../../../lib/sync-context";
import { useCollectionRows } from "../../../../../lib/use-collection";

const styles = stylex.create({
  title: { fontSize: typography.sizeXl, marginTop: 0 },
  toolbar: { display: "flex", justifyContent: "flex-end", marginBottom: spacing.md },
  table: { borderCollapse: "collapse", width: "100%", fontSize: typography.sizeMd },
  cell: {
    textAlign: "left",
    padding: spacing.sm,
    borderBottomWidth: "1px",
    borderBottomStyle: "solid",
    borderBottomColor: colors.border,
  },
  muted: { color: colors.textMuted },
  link: { color: colors.accent },
});

export const STATUS_LABELS: Record<WorkflowStatus, string> = {
  draft: "下書き",
  in_review: "レビュー中",
  ready: "公開準備完了",
  archived: "アーカイブ",
};

export const Route = createFileRoute("/t/$tenantSlug/records/$typeKey/")({
  component: RecordListPage,
});

function RecordListPage() {
  const { tenantSlug, typeKey } = Route.useParams();
  const sync = useTenantSync();
  const status = useSyncStatus(sync);
  const types = useSyncTypes(sync);
  const contentType = types.find((type) => type.key === typeKey);
  const rows = useCollectionRows(sync.registry.get(typeKey));

  if (status !== "ready") {
    return <p {...stylex.props(styles.muted)}>同期中…（状態: {status}）</p>;
  }
  if (contentType === undefined) {
    return <p {...stylex.props(styles.muted)}>未知のコンテンツタイプです: {typeKey}</p>;
  }

  const sorted = rows.toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return (
    <>
      <h1 {...stylex.props(styles.title)}>{contentType.name}</h1>
      <div {...stylex.props(styles.toolbar)}>
        <Link
          to="/t/$tenantSlug/records/$typeKey/new"
          params={{ tenantSlug, typeKey }}
          {...stylex.props(styles.link)}
        >
          新規レコード
        </Link>
      </div>
      {sorted.length === 0 ? (
        <p {...stylex.props(styles.muted)}>レコードはまだありません</p>
      ) : (
        <table {...stylex.props(styles.table)}>
          <thead>
            <tr>
              <th {...stylex.props(styles.cell)}>タイトル</th>
              <th {...stylex.props(styles.cell)}>ステータス</th>
              <th {...stylex.props(styles.cell)}>更新日時</th>
              <th {...stylex.props(styles.cell)}>version</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((record) => (
              <tr key={record.id}>
                <td {...stylex.props(styles.cell)}>
                  <Link
                    to="/t/$tenantSlug/records/$typeKey/$recordId"
                    params={{ tenantSlug, typeKey, recordId: record.id }}
                    {...stylex.props(styles.link)}
                  >
                    {labelForRecord(types, record)}
                  </Link>
                </td>
                <td {...stylex.props(styles.cell)}>{STATUS_LABELS[record.status]}</td>
                <td {...stylex.props(styles.cell)}>{record.updatedAt}</td>
                <td {...stylex.props(styles.cell)}>{record.version}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
