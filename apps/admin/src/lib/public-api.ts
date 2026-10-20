// 公開 API の URL の組み立て(案 G 3 章、裁定 G1・G8)
function trimTrailingSlash(origin: string): string {
  return origin.replace(/\/+$/, "");
}

export function publicApiBase(origin: string, slug: string): string {
  return `${trimTrailingSlash(origin)}/public/v1/${slug}/`;
}

export function publicRecordsUrl(origin: string, slug: string, typeKey: string): string {
  return `${publicApiBase(origin, slug)}records/${typeKey}`;
}

// /_config の publicApiOrigin が空(同一オリジン配信)のときは、画面を開いているオリジンを使う
export function resolvePublicOrigin(configured: string, locationOrigin: string): string {
  return configured === "" ? locationOrigin : configured;
}
