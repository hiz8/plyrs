import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import * as stylex from "@stylexjs/stylex";
import { colors, spacing, typography } from "@plyrs/ui/tokens.stylex";
import { contentTypesQueryOptions } from "../../../../lib/queries";

const styles = stylex.create({
  title: { fontSize: typography.sizeXl, marginTop: 0 },
  toolbar: { display: "flex", justifyContent: "flex-end", marginBottom: spacing.md },
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
  },
  muted: { color: colors.textMuted },
  link: { color: colors.accent, marginRight: spacing.sm },
});

export const Route = createFileRoute("/t/$tenantSlug/content-types/")({
  // invalidate → 一覧へ戻る経路があるため fetchQuery(ensureQueryData は stale でも返す — §11)
  loader: ({ context }) =>
    context.queryClient.fetchQuery(contentTypesQueryOptions(context.adminApi, context.tenant.id)),
  component: ContentTypesPage,
});

function ContentTypesPage() {
  const { adminApi, tenant } = Route.useRouteContext();
  const { tenantSlug } = Route.useParams();
  const { data: contentTypes } = useSuspenseQuery(contentTypesQueryOptions(adminApi, tenant.id));

  return (
    <>
      <h1 {...stylex.props(styles.title)}>コンテンツタイプ</h1>
      <div {...stylex.props(styles.toolbar)}>
        <Link
          to="/t/$tenantSlug/content-types/new"
          params={{ tenantSlug }}
          {...stylex.props(styles.link)}
        >
          新規コンテンツタイプ
        </Link>
      </div>
      {contentTypes.length === 0 ? (
        <p {...stylex.props(styles.muted)}>コンテンツタイプはまだありません</p>
      ) : (
        <table {...stylex.props(styles.table)}>
          <caption {...stylex.props(styles.caption)}>登録済みコンテンツタイプの一覧</caption>
          <thead>
            <tr>
              <th {...stylex.props(styles.cell)}>key</th>
              <th {...stylex.props(styles.cell)}>名前</th>
              <th {...stylex.props(styles.cell)}>フィールド数</th>
              <th {...stylex.props(styles.cell)}>source</th>
              <th {...stylex.props(styles.cell)}>version</th>
              <th {...stylex.props(styles.cell)}>操作</th>
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
                <td {...stylex.props(styles.cell)}>
                  {contentType.source === "user" && (
                    <Link
                      to="/t/$tenantSlug/content-types/$typeKey/edit"
                      params={{ tenantSlug, typeKey: contentType.key }}
                      {...stylex.props(styles.link)}
                    >
                      編集
                    </Link>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
