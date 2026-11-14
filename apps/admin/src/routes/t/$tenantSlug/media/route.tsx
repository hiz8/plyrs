import { createFileRoute, useParams } from "@tanstack/react-router";
import { MediaLibrary, parseMediaQuery, toMediaSearch, type MediaQuery } from "~/features/media";

// F5: /media(一覧)と /media/:assetId(詳細パネル付き)は同じ MediaLibrary を描く。
// 子ルート(index / $assetId)は component を持たず、URL の違いだけをここで読む
export const Route = createFileRoute("/t/$tenantSlug/media")({
  validateSearch: (search: Record<string, unknown>): Partial<MediaQuery> => parseMediaQuery(search),
  search: {
    // validateSearch の戻り値は既定値を含み、そのまま URL に出てしまう。toMediaSearch の規則(既定値は省く)に揃える
    middlewares: [({ search, next }) => toMediaSearch(next(search)) as Partial<MediaQuery>],
  },
  component: MediaRoute,
});

function MediaRoute() {
  const { tenantSlug } = Route.useParams();
  const { assetId } = useParams({ strict: false });
  return <MediaLibrary tenantSlug={tenantSlug} assetId={assetId ?? null} />;
}
