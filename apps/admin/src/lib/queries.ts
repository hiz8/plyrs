import { queryOptions, type QueryClient } from "@tanstack/react-query";
import type { AdminApi } from "./admin-api";
import type { ApiClient } from "./api-client";

// ルート間で共有するクエリ定義。テナント一覧は /tenants と /t/$tenantSlug ガードの両方が
// 使うため、queryClient 経由でキャッシュして往復を 1 回に抑える。
export function tenantsQueryOptions(api: ApiClient) {
  return queryOptions({
    queryKey: ["tenants"],
    queryFn: () => api.listTenants(),
    staleTime: 30_000,
  });
}

// 自分の情報はセッションの間は変わらないため取り直さない。セッションの切り替わりは
// ログアウト(queryClient.clear())とログイン・サインアップ成功(startSession)の両方で捨てる。
// セッション失効で /login へ戻された場合はログアウトを経ないため、ログイン側でも捨てる必要がある。
export function meQueryOptions(api: ApiClient) {
  return queryOptions({
    queryKey: ["me"],
    queryFn: () => api.getMe(),
    staleTime: Infinity,
  });
}

// ログイン・サインアップの成功直後に呼ぶ。前の利用者のキャッシュ(自分の情報・サイト一覧など)を
// 新しいセッションへ持ち越さない。
export function startSession(queryClient: QueryClient): void {
  queryClient.clear();
}

export function contentTypesQueryOptions(adminApi: AdminApi, tenantId: string) {
  return queryOptions({
    queryKey: ["content-types", tenantId],
    queryFn: () => adminApi.listContentTypes(tenantId),
    staleTime: 10_000,
  });
}

export function publicationQueryOptions(adminApi: AdminApi, tenantId: string, recordId: string) {
  return queryOptions({
    queryKey: ["publication", tenantId, recordId],
    queryFn: () => adminApi.getPublication(tenantId, recordId),
    staleTime: 5_000,
  });
}

export function orphanAssetsQueryOptions(adminApi: AdminApi, tenantId: string) {
  return queryOptions({
    queryKey: ["assets", tenantId, "orphans"],
    queryFn: () => adminApi.listOrphanAssetIds(tenantId),
    // 参照の付け外しは同期経路で頻繁に起きるため常に取り直す(フィルタ ON のたびに最新)
    staleTime: 0,
  });
}

export function assetUsageQueryOptions(adminApi: AdminApi, tenantId: string, assetId: string) {
  return queryOptions({
    queryKey: ["assets", tenantId, "usage", assetId],
    queryFn: () => adminApi.getAssetUsage(tenantId, assetId),
    staleTime: 0,
  });
}

export function modulesQueryOptions(adminApi: AdminApi, tenantId: string) {
  return queryOptions({
    queryKey: ["modules", tenantId],
    queryFn: () => adminApi.listModules(tenantId),
    // トグル直後の状態を確実に映す(設定ページは低頻度アクセスなのでキャッシュ不要)
    staleTime: 0,
  });
}
