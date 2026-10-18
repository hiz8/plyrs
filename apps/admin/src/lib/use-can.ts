import { getRouteApi } from "@tanstack/react-router";
import { can, type Operation } from "./permissions";

// permissions.ts を router に依存しない純関数のまま保つため、フックはこちらに分ける
const tenantRoute = getRouteApi("/t/$tenantSlug");

// テナント配下(/t/$tenantSlug 以下)の画面で、ログイン中の利用者のロールで判定する
export function useCan(operation: Operation): boolean {
  const { tenant } = tenantRoute.useRouteContext();
  return can(tenant.role, operation);
}
