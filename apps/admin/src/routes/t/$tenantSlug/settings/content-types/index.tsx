import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import * as stylex from "@stylexjs/stylex";
import { Plus } from "lucide-react";
import { Button } from "@plyrs/ui";
import { accent, border, font, space, stroke, text } from "@plyrs/ui/semantic.stylex";
import { SettingsFrame } from "../../../../../components/settings/settings-frame";
import { contentTypesQueryOptions } from "../../../../../lib/queries";

const styles = stylex.create({
  table: { borderCollapse: "collapse", width: "100%", fontSize: font.body },
  caption: {
    captionSide: "top",
    textAlign: "left",
    color: text.muted,
    fontSize: font.caption,
    paddingBottom: space.xs,
  },
  cell: {
    textAlign: "left",
    padding: space.sm,
    borderBottomWidth: stroke.default,
    borderBottomStyle: "solid",
    borderBottomColor: border.default,
  },
  muted: { color: text.muted },
  link: { color: accent.default, marginRight: space.sm },
});

export const Route = createFileRoute("/t/$tenantSlug/settings/content-types/")({
  // invalidate → 一覧へ戻る経路があるため fetchQuery(ensureQueryData は stale でも返す — §11)
  loader: ({ context }) =>
    context.queryClient.fetchQuery(contentTypesQueryOptions(context.adminApi, context.tenant.id)),
  component: ContentTypesPage,
});

function ContentTypesPage() {
  const { adminApi, tenant } = Route.useRouteContext();
  const { tenantSlug } = Route.useParams();
  const navigate = useNavigate();
  const { data: contentTypes } = useSuspenseQuery(contentTypesQueryOptions(adminApi, tenant.id));

  return (
    <SettingsFrame
      tab="content-types"
      slug={tenantSlug}
      primaryAction={
        <Button
          icon={Plus}
          onPress={() =>
            void navigate({
              to: "/t/$tenantSlug/settings/content-types/new",
              params: { tenantSlug },
            })
          }
        >
          コンテンツタイプを追加
        </Button>
      }
    >
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
                  <Link
                    to="/t/$tenantSlug/content/$typeKey"
                    params={{ tenantSlug, typeKey: contentType.key }}
                    {...stylex.props(styles.link)}
                  >
                    レコード
                  </Link>
                  {contentType.source === "user" && (
                    <Link
                      to="/t/$tenantSlug/settings/content-types/$typeKey/edit"
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
    </SettingsFrame>
  );
}
