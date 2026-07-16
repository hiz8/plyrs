import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/t/$tenantSlug/")({
  beforeLoad: ({ params }) => {
    throw redirect({ to: "/t/$tenantSlug/content-types", params });
  },
});
