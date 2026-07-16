import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import * as stylex from "@stylexjs/stylex";
import { colors, spacing, typography } from "@plyrs/ui/tokens.stylex";
import { contentTypesQueryOptions } from "../../../lib/queries";

const styles = stylex.create({
  title: { fontSize: typography.sizeXl, marginTop: 0 },
  table: { borderCollapse: "collapse", width: "100%", fontSize: typography.sizeMd },
  cell: {
    textAlign: "left",
    padding: spacing.sm,
    borderBottomWidth: "1px",
    borderBottomStyle: "solid",
    borderBottomColor: colors.border,
  },
  muted: { color: colors.textMuted },
});

export const Route = createFileRoute("/t/$tenantSlug/content-types")({
  // 読み取り表示のみ（編集・作成は Phase 6b の content_type ビルダー）
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(
      contentTypesQueryOptions(context.adminApi, context.tenant.id),
    ),
  component: ContentTypesPage,
});

function ContentTypesPage() {
  const { adminApi, tenant } = Route.useRouteContext();
  const { data: contentTypes } = useSuspenseQuery(contentTypesQueryOptions(adminApi, tenant.id));

  return (
    <>
      <h1 {...stylex.props(styles.title)}>コンテンツタイプ</h1>
      {contentTypes.length === 0 ? (
        <p {...stylex.props(styles.muted)}>
          コンテンツタイプはまだありません（作成は Phase 6b のビルダーで対応します）
        </p>
      ) : (
        <table {...stylex.props(styles.table)}>
          <thead>
            <tr>
              <th {...stylex.props(styles.cell)}>key</th>
              <th {...stylex.props(styles.cell)}>名前</th>
              <th {...stylex.props(styles.cell)}>フィールド数</th>
              <th {...stylex.props(styles.cell)}>source</th>
              <th {...stylex.props(styles.cell)}>version</th>
            </tr>
          </thead>
          <tbody>
            {contentTypes.map((contentType) => (
              <tr key={contentType.id}>
                <td {...stylex.props(styles.cell)}>{contentType.key}</td>
                <td {...stylex.props(styles.cell)}>{contentType.name}</td>
                <td {...stylex.props(styles.cell)}>{contentType.fields.length}</td>
                <td {...stylex.props(styles.cell)}>{contentType.source}</td>
                <td {...stylex.props(styles.cell)}>{contentType.version}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
