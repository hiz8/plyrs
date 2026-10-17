import { createFileRoute, redirect } from "@tanstack/react-router";

// 案 A 6 章: 旧 URL。ブックマークやリンクを切らないよう、新しい URL へ置き換えて転送する
export const Route = createFileRoute("/t/$tenantSlug/assets/")({
  beforeLoad: ({ params }) => {
    throw redirect({ to: "/t/$tenantSlug/media", params, replace: true });
  },
});
