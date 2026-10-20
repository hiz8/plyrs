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

// 自分の情報はセッションの間は変わらないため取り直さない。セッションが切り替わるときは
// resetClientSession(ログアウト・ログイン・サインアップ)で捨てる。
export function meQueryOptions(api: ApiClient) {
  return queryOptions({
    queryKey: ["me"],
    queryFn: () => api.getMe(),
    staleTime: Infinity,
  });
}

// デプロイ単位で固定(案 G 3 章、裁定 G1)
export function configQueryOptions(api: ApiClient) {
  return queryOptions({
    queryKey: ["config"],
    queryFn: () => api.getConfig(),
    staleTime: Infinity,
  });
}

export function contentTypesQueryOptions(adminApi: AdminApi, tenantId: string) {
  return queryOptions({
    queryKey: ["content-types", tenantId],
    queryFn: () => adminApi.listContentTypes(tenantId),
    staleTime: 10_000,
  });
}

// 案 G 4 章: メンバーの変更の直後に必ず取り直す(古い一覧で最後の管理者の判定を誤らない)
export function membersQueryOptions(adminApi: AdminApi, tenantId: string) {
  return queryOptions({
    queryKey: ["members", tenantId],
    queryFn: () => adminApi.listMembers(tenantId),
    staleTime: 0,
    retry: 1,
  });
}

// 案 D 9 章: 公開は同期経路を通らないため、他の利用者の公開は即時には届かない。
// 画面にフォーカスが戻ったときの再取得(React Query の既定)と、自分の公開・取り下げ直後の
// invalidate(publicationsQueryKey の前方一致。公開版を消すレコード削除も含む)で補う。
export function publicationsQueryKey(tenantId: string) {
  return ["publications", tenantId] as const;
}

export function publicationsQueryOptions(adminApi: AdminApi, tenantId: string, type?: string) {
  return queryOptions({
    queryKey: [...publicationsQueryKey(tenantId), type ?? null],
    queryFn: () => adminApi.listPublications(tenantId, type),
    // publicationQueryOptions と揃える(画面往復のたびに DO を起こして全件取り直さない)
    staleTime: 5_000,
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
    // 取得の失敗で最大 7 秒ほどホームがスケルトンのままにならないよう 1 回だけ(V4-B の申し送り)
    retry: 1,
  });
}
