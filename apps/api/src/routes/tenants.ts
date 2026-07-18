// Finding 2（important）: 公開 read API（routes/public.ts）が tenantSlug を KV/コントロールプレーン
// D1 へ渡す前に同じ規則で早期検証できるよう、slug の形と長さの上限を共有定数として公開する。
// Phase 10 裁定 9: テナント作成ルート（旧 tenantAdminRoutes、POST /v1/tenants）は self-serve
// 作成の廃止に伴い撤去し、特権 API（routes/super.ts の POST /super/v1/tenants）へ一本化した。
// この定数だけは公開 read 側の tenant-resolver 前段検証が使い続けるため残す。
export const TENANT_SLUG_PATTERN = /^[a-z][a-z0-9-]*$/;
export const TENANT_SLUG_MAX_LENGTH = 63;
