import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import * as stylex from "@stylexjs/stylex";
import { colors, typography } from "@plyrs/ui/tokens.stylex";
import { ContentTypeForm } from "../../../../components/content-type-form";
import { contentTypesQueryOptions } from "../../../../lib/queries";

const styles = stylex.create({
  title: { fontSize: typography.sizeXl, marginTop: 0 },
  muted: { color: colors.textMuted },
});

export const Route = createFileRoute("/t/$tenantSlug/content-types/$typeKey/edit")({
  // 編集フォームは常に最新定義から開く(invalidate 後の stale 回避 = fetchQuery。§11)
  loader: ({ context }) =>
    context.queryClient.fetchQuery(contentTypesQueryOptions(context.adminApi, context.tenant.id)),
  component: EditContentTypePage,
});

function EditContentTypePage() {
  const { adminApi, tenant, queryClient } = Route.useRouteContext();
  const { tenantSlug, typeKey } = Route.useParams();
  const navigate = useNavigate();
  const { data: contentTypes } = useSuspenseQuery(contentTypesQueryOptions(adminApi, tenant.id));
  const existing = contentTypes.find((contentType) => contentType.key === typeKey);
  if (existing === undefined) {
    return <p {...stylex.props(styles.muted)}>コンテンツタイプ {typeKey} が見つかりません</p>;
  }
  return (
    <>
      <h1 {...stylex.props(styles.title)}>コンテンツタイプを編集: {existing.name}</h1>
      <ContentTypeForm
        existing={existing}
        onSubmit={async (definition) => {
          await adminApi.putContentType(tenant.id, definition);
          await queryClient.invalidateQueries({
            queryKey: contentTypesQueryOptions(adminApi, tenant.id).queryKey,
          });
          await navigate({ to: "/t/$tenantSlug/content-types", params: { tenantSlug } });
        }}
      />
    </>
  );
}
