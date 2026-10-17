import { queryOptions } from "@tanstack/react-query";
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

export function contentTypesQueryOptions(adminApi: AdminApi, tenantId: string) {
  return queryOptions({
    queryKey: ["content-types", tenantId],
    queryFn: () => adminApi.listContentTypes(tenantId),
    staleTime: 10_000,
  });
}

// 案 D 9 章: 公開は同期経路を通らないため、他の利用者の公開は即時には届かない。
// 画面にフォーカスが戻ったときの再取得(React Query の既定)と、自分の公開・取り下げ直後の
// invalidate(publicationsQueryKey の前方一致)で補う。
export function publicationsQueryKey(tenantId: string) {
  return ["publications", tenantId] as const;
}

export function publicationsQueryOptions(adminApi: AdminApi, tenantId: string, type?: string) {
  return queryOptions({
    queryKey: [...publicationsQueryKey(tenantId), type ?? null],
    queryFn: () => adminApi.listPublications(tenantId, type),
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
