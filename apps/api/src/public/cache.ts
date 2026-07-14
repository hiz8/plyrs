// 裁定（2026-07-14）/ §12.6: Cache API + 短 TTL。publish 時パージはしない —— 投影自体が
// publish から数秒の結果整合であり、Cache API のパージは同一 colo にしか効かないため、
// パージしても厳密さは得られない。短 TTL が陳腐化を有界化し、投影が常に正のため実害が小さい。
// キーは解決後の tenantId で刻む: tenantSlug の付け替えが起きても、古い slug のキャッシュが
// 別テナントの内容として生き残らないよう、恒久 ID に正規化する。

export const PUBLIC_CACHE_TTL_SECONDS = 30;

// 実在しない内部ホスト。Cache API のキーは URL 全体なので、公開ドメインと衝突しない
// 名前空間を切る（リクエスト URL をそのままキーにすると Host ヘッダ次第で分裂する）。
const CACHE_HOST = "https://plyrs-public-cache.internal";

export function canonicalCacheUrl(
  tenantId: string,
  pathSuffix: string,
  params: Record<string, string[]>,
): string {
  const search = new URLSearchParams();
  for (const key of Object.keys(params).sort()) {
    for (const value of [...(params[key] ?? [])].sort()) {
      search.append(key, value);
    }
  }
  const queryString = search.toString();
  return `${CACHE_HOST}/${tenantId}/${pathSuffix}${queryString === "" ? "" : `?${queryString}`}`;
}

export interface EdgeCacheContext {
  req: { raw: Request };
  executionCtx: ExecutionContext;
}

export async function withEdgeCache(
  context: EdgeCacheContext,
  cacheUrl: string,
  produce: () => Promise<Response>,
): Promise<Response> {
  const cache = caches.default;
  const key = new Request(cacheUrl, { method: "GET" });
  let response = await cache.match(key);
  if (response === undefined) {
    response = await produce();
    if (response.status === 200) {
      response.headers.set(
        "cache-control",
        `public, max-age=0, s-maxage=${PUBLIC_CACHE_TTL_SECONDS}`,
      );
      const stored = response.clone();
      let ctx: ExecutionContext | null = null;
      try {
        ctx = context.executionCtx;
      } catch {
        // ExecutionContext が無い環境（app.request 直呼びのテスト等）では同期で書く
        ctx = null;
      }
      const putPromise = cache.put(key, stored);
      if (ctx !== null) {
        ctx.waitUntil(putPromise);
      } else {
        await putPromise;
      }
    }
  }
  const etag = response.headers.get("etag");
  const ifNoneMatch = context.req.raw.headers.get("if-none-match");
  if (etag !== null && ifNoneMatch !== null && ifNoneMatch === etag) {
    return new Response(null, { status: 304, headers: response.headers });
  }
  return response;
}
