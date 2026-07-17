import { createFileRoute, useNavigate } from "@tanstack/react-router";
import * as stylex from "@stylexjs/stylex";
import { typography } from "@plyrs/ui/tokens.stylex";
import { ContentTypeForm } from "../../../../components/content-type-form";
import { contentTypesQueryOptions } from "../../../../lib/queries";

const styles = stylex.create({
  title: { fontSize: typography.sizeXl, marginTop: 0 },
});

export const Route = createFileRoute("/t/$tenantSlug/content-types/new")({
  component: NewContentTypePage,
});

function NewContentTypePage() {
  const { adminApi, tenant, queryClient } = Route.useRouteContext();
  const { tenantSlug } = Route.useParams();
  const navigate = useNavigate();
  return (
    <>
      <h1 {...stylex.props(styles.title)}>新規コンテンツタイプ</h1>
      <ContentTypeForm
        existing={null}
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
