import { createFileRoute, redirect } from "@tanstack/react-router";

// 案 A 3.3: 設定の階層そのものには画面を持たない。URL の末尾を削って開いたときに
// Not Found にならないよう、先頭の「一般」へ転送する
export const Route = createFileRoute("/t/$tenantSlug/settings/")({
  beforeLoad: ({ params }) => {
    throw redirect({ to: "/t/$tenantSlug/settings/general", params });
  },
});
