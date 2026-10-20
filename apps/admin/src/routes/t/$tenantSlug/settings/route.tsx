import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { can } from "../../../../lib/permissions";

// 設定は site:manage を持つ人だけ。権限の無い人はホームへ返す
export const Route = createFileRoute("/t/$tenantSlug/settings")({
  beforeLoad: ({ context, params }) => {
    if (!can(context.tenant.role, "site:manage")) {
      throw redirect({ to: "/t/$tenantSlug", params });
    }
  },
  component: () => <Outlet />,
});
