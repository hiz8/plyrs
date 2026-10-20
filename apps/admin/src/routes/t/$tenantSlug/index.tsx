import { createFileRoute, redirect } from "@tanstack/react-router";
import { FileText } from "lucide-react";
import { EmptyState } from "@plyrs/ui";
import { PageBody, TenantPageHeader } from "../../../components/tenant-page-header";
import { currentCrumb } from "../../../lib/breadcrumbs";
import { HOME_PLACEHOLDER, NAV_LABELS } from "../../../lib/labels";
import { sidebarContentTypes } from "../../../lib/navigation";
import { can } from "../../../lib/permissions";
import { contentTypesQueryOptions } from "../../../lib/queries";

// a-navigation.md 9 章・2026-10-19 裁定: ホームの本体(ダッシュボード)は後続フェーズ。
// それまでは先頭の型の一覧へ送り、型が無ければ管理者は型の作成画面へ、それ以外は案内を出す
export const Route = createFileRoute("/t/$tenantSlug/")({
  beforeLoad: async ({ context, params }) => {
    const types = await context.queryClient.fetchQuery(
      contentTypesQueryOptions(context.adminApi, context.tenant.id),
    );
    const first = sidebarContentTypes(types)[0];
    if (first !== undefined) {
      throw redirect({
        to: "/t/$tenantSlug/content/$typeKey",
        params: { tenantSlug: params.tenantSlug, typeKey: first.key },
      });
    }
    if (can(context.tenant.role, "type:manage")) {
      throw redirect({
        to: "/t/$tenantSlug/settings/content-types",
        params: { tenantSlug: params.tenantSlug },
      });
    }
  },
  component: HomePlaceholder,
});

function HomePlaceholder() {
  return (
    <>
      <TenantPageHeader title={NAV_LABELS.home} breadcrumbs={[currentCrumb(NAV_LABELS.home)]} />
      <PageBody>
        <EmptyState
          icon={FileText}
          title={HOME_PLACEHOLDER.title}
          description={HOME_PLACEHOLDER.description}
        />
      </PageBody>
    </>
  );
}
