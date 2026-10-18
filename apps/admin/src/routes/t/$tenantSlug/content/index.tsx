import { createFileRoute, redirect } from "@tanstack/react-router";

// 案 A 3.2: コンテンツの階層は型ごとの一覧だけを持つ。URL の末尾を削って開いたときに
// Not Found にならないよう、サイトのトップへ転送する(どの型を開くかはトップに任せる)
export const Route = createFileRoute("/t/$tenantSlug/content/")({
  beforeLoad: ({ params }) => {
    throw redirect({ to: "/t/$tenantSlug", params });
  },
});
